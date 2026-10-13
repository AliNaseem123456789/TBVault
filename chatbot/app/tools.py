"""
Order tools: live, per-customer data the LLM may look up — never from vectors.

The model may only:
  - pick a tool from the list allowed for this request,
  - fill in arguments, which are validated here (an order id must be a positive number).
The APPLICATION runs the tool, by calling the existing Node API *as the customer*
(their own login token). So the backend's ownership checks apply: someone else's
order is simply "not found". Nothing here can read another customer's data.

    get_my_orders                recent orders (number, date, status, total)
    get_order_details            items, shipments, tracking, refunds, returns
    get_order_status             status, tracking and recent status changes
    request_order_cancellation   checks the order CAN be cancelled and returns a
                                 confirmation action. It does NOT cancel anything:
                                 the customer must press the button, which calls
                                 POST /api/orders/:id/cancel (the backend checks again).

Results given to the model leave out addresses and payment ids (not needed to answer).
"""
import json
import logging
import time

import httpx
from pydantic import BaseModel, Field, ValidationError

from app import config, llm, metrics

log = logging.getLogger("tools")

CANCELLABLE = ("pending", "confirmed")   # same rule as the backend (order.controller.js)


class ToolError(Exception):
    """code: login_required | not_found | not_permitted | bad_arguments | unavailable"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


# ----------------------------------------------------------------------------
# argument schemas
# ----------------------------------------------------------------------------
class NoArgs(BaseModel, extra="forbid"):
    limit: int = Field(default=5, ge=1, le=10)


class OrderArg(BaseModel, extra="forbid"):
    order_id: int = Field(ge=1, le=10**9)


SCHEMAS = {
    "get_my_orders": (NoArgs, "List the customer's most recent orders (newest first)."),
    "get_order_details": (OrderArg, "Full details of one of the customer's orders: items, shipments, tracking, refunds, returns."),
    "get_order_status": (OrderArg, "Current status, tracking and recent status changes of one of the customer's orders."),
    "request_order_cancellation": (OrderArg, "Check whether an order can be cancelled and prepare a cancellation "
                                   "the customer must confirm with a button. Does not cancel by itself."),
}
ALLOWED = {
    "order_tracking": ["get_my_orders", "get_order_details", "get_order_status"],
    "order_cancellation": ["get_my_orders", "get_order_details", "request_order_cancellation"],
}


def tool_specs(names):
    """OpenAI/Groq tool definitions, generated from the pydantic schemas."""
    specs = []
    for name in names:
        schema, description = SCHEMAS[name]
        params = schema.model_json_schema()
        params.pop("title", None)
        specs.append({"type": "function", "function": {"name": name, "description": description, "parameters": params}})
    return specs


# ----------------------------------------------------------------------------
# calling the Node API as the customer
# ----------------------------------------------------------------------------
def _get(path, token):
    if not token:
        raise ToolError("login_required", "The customer is not signed in")
    try:
        res = httpx.get(f"{config.NODE_API_URL}{path}", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    except httpx.HTTPError as err:
        raise ToolError("unavailable", f"Order service unreachable ({type(err).__name__})") from err
    if res.status_code == 401:
        raise ToolError("login_required", "The customer's session has expired")
    if res.status_code in (400, 404):
        raise ToolError("not_found", "No order with that number on this account")
    if res.status_code != 200:
        raise ToolError("unavailable", f"Order service answered {res.status_code}")
    return res.json().get("data", {})


def _money(value):
    return f"${float(value or 0):.2f}"


def _summary(order):
    return {"order_id": order["id"], "placed": str(order.get("order_date") or order.get("created_at"))[:10],
            "status": order["status"], "payment": f"{order.get('payment_method')} / {order.get('payment_status')}",
            "total": _money(order.get("total_amount"))}


def _details(order):
    out = _summary(order)
    out["items"] = [{"name": i.get("product_name") or (i.get("product") or {}).get("name"), "option": i.get("variant_name"),
                     "quantity": i.get("quantity"), "unit_price": _money(i.get("unit_price"))} for i in order.get("items", [])]
    out["shipments"] = [{"seller": (s.get("seller") or {}).get("store_name"), "status": s.get("status"),
                         "tracking": " ".join(x for x in (s.get("tracking_carrier"), s.get("tracking_number")) if x) or None}
                        for s in order.get("seller_orders", [])]
    if order.get("tracking_number"):
        out["tracking"] = " ".join(x for x in (order.get("tracking_carrier"), order.get("tracking_number")) if x)
    if float(order.get("credits_applied") or 0):
        out["paid_with_store_credit"] = _money(order["credits_applied"])
    if order.get("refunds"):
        out["refunds"] = [{"amount": _money(r["amount"]), "to": r.get("method"), "status": r.get("status")} for r in order["refunds"]]
    if order.get("return_requests"):
        out["returns"] = [{"return_id": r["id"], "status": r["status"]} for r in order["return_requests"]]
    return out


def get_my_orders(token, limit=5):
    orders = _get("/order", token).get("orders", [])
    return {"orders": [_summary(o) for o in orders[:limit]], "total_orders": len(orders)}


def get_order_details(token, order_id):
    return _details(_get(f"/order-details/{order_id}", token)["order"])


def get_order_status(token, order_id):
    order = _get(f"/order-details/{order_id}", token)["order"]
    details = _details(order)
    history = [{"status": h.get("to_status"), "at": str(h.get("created_at"))[:16]} for h in order.get("status_history", [])[-4:]]
    return {k: details[k] for k in ("order_id", "placed", "status", "total", "shipments") if k in details} | {
        "tracking": details.get("tracking"), "recent_changes": history}


def request_order_cancellation(token, order_id):
    order = _get(f"/order-details/{order_id}", token)["order"]
    if order["status"] not in CANCELLABLE:
        return {"order_id": order_id, "can_cancel": False, "status": order["status"],
                "reason": "Only pending or confirmed orders can be cancelled. Once shipped, it can be returned after delivery."}
    paid = order.get("payment_status") in ("paid", "partially_refunded")
    return {"order_id": order_id, "can_cancel": True, "needs_confirmation": True, "status": order["status"],
            "total": _money(order.get("total_amount")),
            "refund_note": "The card payment will be refunded automatically." if paid and order.get("payment_method") == "card" else None,
            "action": {"type": "cancel_order", "order_id": order_id, "label": f"Yes, cancel order #{order_id}"}}


RUNNERS = {"get_my_orders": get_my_orders, "get_order_details": get_order_details,
           "get_order_status": get_order_status, "request_order_cancellation": request_order_cancellation}


def execute(name, raw_args, token, allowed):
    """Validate and run one tool call. Returns (result dict, log entry). Never raises."""
    started = time.perf_counter()
    entry = {"tool": name}
    try:
        if name not in allowed:
            raise ToolError("not_permitted", f"Tool {name} is not available for this request")
        args = SCHEMAS[name][0].model_validate(json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {}))
        entry["args"] = args.model_dump()
        result = RUNNERS[name](token, **args.model_dump())
        entry["outcome"] = "ok"
    except (ValidationError, json.JSONDecodeError) as err:
        result = {"error": "bad_arguments", "message": str(err)[:200]}
        entry["outcome"] = "bad_arguments"
    except ToolError as err:
        result = {"error": err.code, "message": str(err)}
        entry["outcome"] = err.code
    entry["ms"] = round((time.perf_counter() - started) * 1000)
    metrics.TOOL_CALLS.labels(name if name in SCHEMAS else "unknown", entry["outcome"]).inc()
    log.info("tool %s", entry)
    return result, entry


# ----------------------------------------------------------------------------
# the tool loop
# ----------------------------------------------------------------------------
SYSTEM = """You are TBVault's order assistant. Use the tools to look up the signed-in customer's orders,
then answer briefly from the tool results only. Never invent orders, statuses, dates or tracking numbers.
- If the customer didn't say which order, use get_my_orders and ask which one (or answer about the latest
  if they clearly mean it).
- To cancel: ALWAYS call request_order_cancellation. Never say an order was cancelled. If it can be
  cancelled, tell them to press the confirmation button below your message; if not, explain why.
- If a tool returns an error, explain it simply (e.g. "I can't find order 12 on your account")."""

MESSAGES = {
    "login_required": "Please sign in to see your orders. If you checked out as a guest, use the Track order page with your order number and email.",
    "not_found": "I can't find that order on your account. Check the number on your Orders page.",
    "unavailable": "I can't reach the order system right now. Please try again in a moment, or check your Orders page.",
}


def _fallback_answer(task, token):
    """No LLM: pick the tool by plain rules."""
    allowed = ALLOWED[task.intent]
    if task.order_id is None:
        result, entry = execute("get_my_orders", {}, token, allowed)
        if "error" in result:
            return MESSAGES.get(result["error"], MESSAGES["unavailable"]), [entry], result, None
        lines = [f"- Order #{o['order_id']} ({o['placed']}): {o['status']}, {o['total']}" for o in result["orders"]]
        lead = "Which order do you mean?" if task.intent == "order_cancellation" else "Your recent orders:"
        return (lead + "\n" + "\n".join(lines)) if lines else "You don't have any orders yet.", [entry], result, None
    name = "request_order_cancellation" if task.intent == "order_cancellation" else "get_order_status"
    result, entry = execute(name, {"order_id": task.order_id}, token, allowed)
    if "error" in result:
        return MESSAGES.get(result["error"], MESSAGES["unavailable"]), [entry], result, None
    if name == "request_order_cancellation":
        if result["can_cancel"]:
            text = f"Order #{task.order_id} ({result['total']}) can be cancelled. Press the button below to confirm."
            return text, [entry], result, result["action"]
        return f"Order #{task.order_id} is {result['status']}, so it can't be cancelled. {result['reason']}", [entry], result, None
    tracking = f" Tracking: {result['tracking']}." if result.get("tracking") else ""
    return f"Order #{task.order_id} is {result['status']}.{tracking}", [entry], result, None


def run(task, message, token, history=None, max_rounds=3):
    """
    Handles an order_tracking / order_cancellation task.
    Returns {"answer", "tool_calls": [log entries], "orders": [...], "action": {...} | None}.
    """
    if not token:
        return {"answer": MESSAGES["login_required"], "tool_calls": [], "orders": [], "action": None, "results": []}
    if not llm.enabled():
        answer, entries, result, action = _fallback_answer(task, token)
        return {"answer": answer, "tool_calls": entries, "orders": _orders_from([result]), "action": action,
                "results": [result]}

    allowed = ALLOWED[task.intent]
    hint = f" (order number mentioned: {task.order_id})" if task.order_id else ""
    messages = [{"role": "system", "content": SYSTEM}]
    for turn in (history or [])[-4:]:
        messages.append({"role": turn["role"], "content": str(turn["content"])[:600]})
    messages.append({"role": "user", "content": message + hint})
    entries, results, action = [], [], None
    try:
        for _ in range(max_rounds):
            reply = llm.chat(messages, tools=tool_specs(allowed), purpose="tools")
            calls = reply.tool_calls or []
            if not calls:
                return {"answer": (reply.content or "").strip() or MESSAGES["unavailable"], "tool_calls": entries,
                        "orders": _orders_from(results), "action": action, "results": results}
            messages.append({"role": "assistant", "content": reply.content or "", "tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in calls]})
            for call in calls:
                result, entry = execute(call.function.name, call.function.arguments, token, allowed)
                entries.append(entry)
                results.append(result)
                if result.get("action"):
                    action = result["action"]   # the button is created by the application, not by the model
                messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)})
    except llm.LLMError as err:
        log.warning("order tool loop failed, using rules: %s", err)
        answer, more, result, rule_action = _fallback_answer(task, token)
        return {"answer": answer, "tool_calls": entries + more, "orders": _orders_from(results + [result]),
                "action": rule_action or action, "results": results + [result]}
    return {"answer": "Sorry, I couldn't finish looking that up. Please check your Orders page.",
            "tool_calls": entries, "orders": _orders_from(results), "action": action, "results": results}


def _orders_from(results):
    """Order references for the UI to link to /orders/:id."""
    seen, out = set(), []
    for r in results:
        for o in (r.get("orders") or ([r] if r.get("order_id") and r.get("status") else [])):
            if o["order_id"] not in seen:
                seen.add(o["order_id"])
                out.append({"order_id": o["order_id"], "status": o.get("status"), "total": o.get("total")})
    return out
