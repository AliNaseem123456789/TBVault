"""
The chat answer: routing + retrieval + generation.

    message ─► router (intent, rewritten query, filters)        "hi" stops here: no search
              │
              ├─ greeting / general_conversation / out_of_scope / clarification_needed
              │        short reply, no retrieval
              ├─ product_search      hybrid search ─► rerank ─► fact sheet ─► LLM
              ├─ product_comparison  look up each product (planner for complex ones) ─► LLM compares
              ├─ policy_question     policy chunks ─► their parent sections ─► LLM
              └─ order_tracking / order_cancellation
                                     LLM picks order tools ─► app runs them as the customer ─► LLM
    several tasks ("multiple_intents") -> each handled, answers joined.

Honesty rules for every LLM reply: it only sees the facts we retrieved (products from
Postgres, policy sections, tool results) and must not invent anything else.
No LLM key, or the LLM fails? Rules and templates take over; nothing crashes.

The response carries `state` (the last product search: query + filters). The browser
sends it back with the next message, so follow-ups like "only Sony" can be rewritten.
"""
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from app import config, llm, metrics, planner, policies, quality, query_parser, retrieval, router, tools
from app.router import Task

log = logging.getLogger("chat")

PRODUCT_RULES = """You are the shopping assistant of TBVault, an online marketplace. Prices are in US dollars.
Answer using ONLY the facts given in the user's message (PRODUCTS / POLICIES sections).
- Never invent products, prices, stock, specifications, discounts or policies.
- Mention products by their exact name and price as listed. If a product is on sale, say so.
- If something the customer asks about isn't in the facts (e.g. camera quality), say it isn't listed.
- If nothing fits, say so honestly and suggest how to rephrase.
- Keep it short and friendly: 2-6 sentences or a short list, no tables. Products are shown as cards
  under your reply, so don't paste links or image URLs."""

POLICY_RULES = """You are the help assistant of TBVault, an online marketplace.
Answer the question using ONLY the POLICIES given. Quote numbers (days, amounts, percentages) exactly.
If the policies don't cover the question, say you're not sure and suggest contacting support.
Keep it short: 2-5 sentences or a short list, no tables."""

GENERAL_RULES = """You are the friendly shopping assistant of TBVault, an online marketplace.
Reply in 1-2 short sentences. You can help customers find and compare products, search by photo,
answer questions about shipping, returns, payments and store credit, and check or cancel their orders.
Don't make claims about specific products, prices or policies here."""

HELLO = ("Hi! I can help you find and compare products (or search with a photo), answer questions about "
         "shipping, returns and payments, and check your orders. What are you looking for?")
OUT_OF_SCOPE = ("I can only help with shopping on TBVault: finding and comparing products, store policies, "
                "and your orders. What can I help you find?")


class Trace:
    """
    Everything measured about one request (Phase 3). It feeds:
      - Prometheus: stage times, request time, CPU time, request counter
      - the request log (data/logs/chat-*.jsonl) and ?debug=true responses
    No tokens, emails or long numbers are recorded (see metrics.redact).
    """

    def __init__(self):
        self.request_id = uuid.uuid4().hex[:16]
        self.started = time.perf_counter()
        self.cpu_started = time.process_time()
        self.usage = metrics.start_request()   # llm.py adds tokens/cost of this request here
        self.steps = []
        self.checks = []
        self.results = 0
        self.contexts = []   # the facts the LLM saw; returned with ?debug=true (for eval-answers), never logged

    def add(self, step, started, **info):
        seconds = time.perf_counter() - started
        metrics.STAGE_SECONDS.labels(step).observe(seconds)
        self.steps.append({"step": step, "ms": round(seconds * 1000), **info})

    def done(self, intent, routed_by="rules", status="ok"):
        seconds = time.perf_counter() - self.started
        cpu = time.process_time() - self.cpu_started
        metrics.REQUESTS.labels(intent, routed_by, status).inc()
        metrics.REQUEST_SECONDS.labels(intent).observe(seconds)
        metrics.REQUEST_CPU.labels(intent).observe(cpu)
        usage = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in self.usage.items()}
        record = {"request_id": self.request_id, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                  "intent": intent, "routed_by": routed_by, "status": status, "total_ms": round(seconds * 1000),
                  "cpu_ms": round(cpu * 1000), "results": self.results, "llm": usage, "checks": self.checks,
                  "steps": self.steps}
        text = metrics.redact(json.dumps(record, default=str))
        log.info("chat %s", text)
        metrics.write_log(json.loads(text))
        return record

    def answered(self, intent, reply, context, products, llm_wrote):
        """Bookkeeping after a handler has its reply: result counts, fallbacks, grounding checks."""
        self.contexts.append(context)
        if llm_wrote:
            check = quality.check_answer(reply, context, products)
            self.checks.append({"intent": intent, **check})
            metrics.ANSWER_CHECKS.labels("prices_grounded", "fail" if check["unsupported_prices"] else "pass").inc()
            if products:
                metrics.ANSWER_CHECKS.labels("cites_products", "yes" if check["products_cited"] else "no").inc()
        elif llm.enabled():
            metrics.FALLBACKS.labels("answer_template").inc()


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def build_context(products, heading="PRODUCTS"):
    """A numbered fact sheet the LLM may quote from."""
    if not products:
        return f"{heading}: (none found)"
    lines = [f"{heading}:"]
    for n, p in enumerate(products[:config.CHAT_PRODUCTS_IN_PROMPT], 1):
        price = f"${p['lowest_price']}"
        if p["sale_percent"]:
            price += f" (on sale, {p['sale_percent']}% off; was ${p['price']})"
        facts = [
            f"[{n}] {p['name']}",
            f"price {price}" + (" (price depends on option)" if p["variants"] else ""),
            "in stock" if p["in_stock"] else "out of stock",
            f"category {p['category']['name']}",
        ]
        if p["brand"]:
            facts.append(f"brand {p['brand']['name']}")
        facts.append(f"sold by {p['seller']['store_name']}")
        if p["rating"]:
            facts.append(f"rating {p['rating']}/5")
        if p["variants"]:
            facts.append("options: " + ", ".join(v["name"] for v in p["variants"][:6]))
        description = " ".join((p["description"] or "").split())[:300]
        if description:
            facts.append(f"about: {description}")
        lines.append(" | ".join(facts))
    return "\n".join(lines)


def policy_context(sections):
    if not sections:
        return "POLICIES: (nothing relevant found)"
    return "POLICIES:\n" + "\n\n".join(f"[{s['title']} > {s['section']}]\n{s['text']}" for s in sections)


def _write(rules, context, question, history=None):
    """The answer model writes the reply from the given facts. Returns None if the LLM is unavailable."""
    if not llm.enabled():
        return None
    messages = [{"role": "system", "content": rules}]
    for turn in (history or [])[-config.CHAT_HISTORY_TURNS:]:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            messages.append({"role": turn["role"], "content": str(turn["content"])[:1000]})
    messages.append({"role": "user", "content": f"{context}\n\nCUSTOMER: {question}"})
    try:
        return (llm.chat(messages, purpose="answer").content or "").strip() or None
    except llm.LLMError as err:
        log.warning("answer LLM failed, using a template: %s", err)
        return None


def _product_list(products, lead):
    return lead + "\n" + "\n".join(f"- {p['name']} — ${p['lowest_price']}" for p in products[:5])


def _result(answer, **extra):
    return {"answer": answer, "products": [], "orders": [], "sources": [], "action": None, **extra}


# ----------------------------------------------------------------------------
# one handler per intent
# ----------------------------------------------------------------------------
def handle_small_talk(task, message, history, trace):
    if task.intent == "greeting":
        text = message.lower()
        if any(w in text for w in ("thank", "thx", "ty")):
            return _result("You're welcome! Anything else I can help you find?")
        if any(w in text for w in ("bye", "see you")):
            return _result("Bye! Come back any time.")
        return _result(HELLO)
    if task.intent == "out_of_scope":
        return _result(OUT_OF_SCOPE)
    if task.intent == "clarification_needed":
        return _result(task.question or "Could you tell me a bit more about what you're looking for?")
    started = time.perf_counter()   # general_conversation
    reply = _write(GENERAL_RULES, "(no facts needed)", message, history)
    trace.add("general_reply", started)
    return _result(reply or HELLO)


def handle_search(task, message, history, trace, limit):
    started = time.perf_counter()
    query = task.query or message
    filters = router.to_search_filters(task.filters)
    found = retrieval.search_products(query, filters, limit)
    trace.add("search", started, query=query, applied=found["applied"], hits=len(found["debug"]),
              top_scores=found["debug"][:5], reranked=found.get("reranked"), rerank=found.get("rerank", [])[:5])
    products = found["products"]
    _search_metrics("product_search", found)
    trace.results += len(products)
    started = time.perf_counter()
    question = message if not task.goal else f"{message}\n(Goal: {task.goal})"
    context = build_context(products)
    reply = _write(PRODUCT_RULES, context, question, history)
    trace.add("answer", started, llm=reply is not None)
    trace.answered("product_search", reply, context, products, reply is not None)
    if not reply:
        reply = (_product_list(products, "Here's what I found:") if products
                 else "I couldn't find a matching product. Try different words, or fewer filters.")
    return _result(reply, products=products, applied=found["applied"], search_query=query)


def _search_metrics(intent, found):
    metrics.RESULTS.labels(intent).observe(len(found["products"]))
    if not found["products"]:
        metrics.ZERO_RESULTS.labels(intent).inc()
    if found["debug"]:
        metrics.TOP_SCORE.labels("hybrid").observe(found["debug"][0]["score"])
    if found.get("rerank"):
        metrics.TOP_SCORE.labels("rerank").observe(found["rerank"][0]["score"])
        changed = found.get("top_before_rerank") != found["rerank"][0]["product_id"]
        metrics.RERANKS.labels("yes" if changed else "no").inc()


def _find_one(name):
    found = retrieval.search_products(name, limit=1)
    return found["products"][0] if found["products"] else None


def handle_comparison(task, message, history, trace, limit):
    started = time.perf_counter()
    found, missing, goal = [], [], task.goal or "compare these products"
    sections = []
    if planner.needs_plan(task):
        plan, how = planner.make_plan(task, message)
        trace.add("plan", started, by=how, steps=[s.model_dump() for s in plan.steps], goal=plan.goal)
        goal = plan.goal or goal
        started = time.perf_counter()
        for step in plan.steps:
            if step.op == "search_products":
                found += retrieval.search_products(step.query, router.to_search_filters(step.filters), 4)["products"]
            elif step.op == "get_product":
                product = _find_one(step.query)
                if product:
                    found.append(product)
                else:
                    missing.append(step.query)
            elif step.op == "lookup_policy":
                sections += policies.search(step.query, max_sections=1)
        trace.add("plan_steps", started, products=len(found), missing=missing)
    else:
        for name in task.products[:4]:
            product = _find_one(name)
            if product:
                found.append(product)
            else:
                missing.append(name)
        trace.add("lookups", started, products=[p["id"] for p in found], missing=missing)

    products = list({p["id"]: p for p in found}.values())   # dedupe, keep order
    context = build_context(products)
    if missing:
        context += "\nNOT FOUND IN THE SHOP: " + ", ".join(missing)
    if sections:
        context += "\n\n" + policy_context(sections)
    started = time.perf_counter()
    reply = _write(PRODUCT_RULES, context, f"{message}\n(Goal: {goal}. Compare only using the facts given.)", history)
    trace.add("answer", started, llm=reply is not None)
    trace.results += len(products)
    metrics.RESULTS.labels("product_comparison").observe(len(products))
    if not products:
        metrics.ZERO_RESULTS.labels("product_comparison").inc()
    trace.answered("product_comparison", reply, context, products, reply is not None)
    if not reply:
        reply = _product_list(products, "Here are the products to compare:") if products else \
            "I couldn't find those products in the shop."
        if missing:
            reply += f"\nI couldn't find: {', '.join(missing)}."
    return _result(reply, products=products[:limit])


def handle_policy(task, message, history, trace):
    started = time.perf_counter()
    question = task.query or message
    try:
        sections = policies.search(question)
    except Exception as err:     # policies not indexed yet / Pinecone down
        log.warning("policy search failed: %s", err)
        metrics.FALLBACKS.labels("policy_unavailable").inc()
        sections = []
    trace.add("policy_search", started, query=question, sections=[(s["id"], s["score"]) for s in sections])
    metrics.RESULTS.labels("policy_question").observe(len(sections))
    if sections:
        metrics.TOP_SCORE.labels("policy").observe(sections[0]["score"])
    else:
        metrics.ZERO_RESULTS.labels("policy_question").inc()
    trace.results += len(sections)
    started = time.perf_counter()
    context = policy_context(sections)
    reply = _write(POLICY_RULES, context, question, history)
    trace.add("answer", started, llm=reply is not None)
    trace.answered("policy_question", reply, context, [], reply is not None)
    if not reply:
        reply = (f"From our {sections[0]['title']} policy ({sections[0]['section']}):\n{sections[0]['text'][:700]}"
                 if sections else "I'm not sure about that one. Please check our help pages or contact support.")
    sources = [{"title": s["title"], "section": s["section"]} for s in sections]
    return _result(reply, sources=sources)


def handle_orders(task, message, history, trace, user_token):
    started = time.perf_counter()
    out = tools.run(task, message, user_token, history)
    trace.add("order_tools", started, calls=out["tool_calls"], action=bool(out["action"]))
    trace.results += len(out["orders"])
    trace.contexts.append("TOOL RESULTS:\n" + json.dumps(out["results"], default=str)[:4000])
    return _result(out["answer"], orders=out["orders"], action=out["action"])


def handle(task: Task, message, history, trace, limit, user_token):
    if task.intent in ("greeting", "general_conversation", "out_of_scope", "clarification_needed"):
        return handle_small_talk(task, message, history, trace)
    if task.intent == "product_search":
        return handle_search(task, message, history, trace, limit)
    if task.intent == "product_comparison":
        return handle_comparison(task, message, history, trace, limit)
    if task.intent == "policy_question":
        return handle_policy(task, message, history, trace)
    return handle_orders(task, message, history, trace, user_token)


# ----------------------------------------------------------------------------
# entry points
# ----------------------------------------------------------------------------
def answer(message, history=None, image_bytes=None, limit=None, state=None, user_token=None):
    limit = limit or config.CHAT_PRODUCTS_IN_PROMPT
    if image_bytes:
        return answer_photo(message, image_bytes, limit)
    trace = Trace()
    route, how = None, "rules"
    try:
        started = time.perf_counter()
        route, how = router.route(message, history, previous=state)
        trace.add("route", started, by=how, intent=route.intent,
                  tasks=[t.model_dump(exclude_defaults=True) for t in route.tasks])
        if how == "rules" and llm.enabled() and route.intent != "greeting":
            metrics.FALLBACKS.labels("router_rules").inc()   # the LLM router failed; keywords took over

        parts = []
        for task in route.tasks:
            # each task gets its own question text when there are several
            question = message if len(route.tasks) == 1 else (task.query or message)
            parts.append(handle(task, question, history, trace, limit, user_token))
    except Exception:
        trace.done(route.intent if route else "unknown", how, status="error")
        raise

    products, orders, sources, seen = [], [], [], set()
    for part in parts:
        for p in part["products"]:
            if p["id"] not in seen:
                seen.add(p["id"])
                products.append(p)
        orders += part["orders"]
        sources += part["sources"]
    new_state = state
    for task, part in zip(route.tasks, parts):
        if task.intent == "product_search":
            new_state = {"query": part.get("search_query"), "filters": task.filters.model_dump(exclude_defaults=True)}
    record = trace.done(route.intent, how)
    record["contexts"] = trace.contexts
    return {
        "request_id": trace.request_id,
        "answer": "\n\n".join(part["answer"] for part in parts),
        "intent": route.intent,
        "products": products[:limit * len(parts)],
        "orders": orders,
        "sources": sources,
        "action": next((part["action"] for part in parts if part["action"]), None),
        "applied": next((part["applied"] for part in parts if part.get("applied")), {}),
        "state": new_state,
        "llm": llm.enabled(),
        "debug": record,
    }


def answer_photo(message, image_bytes, limit):
    """Photo search (Phase 1 flow): CLIP image search + optional price/stock words from the message."""
    trace = Trace()
    try:
        started = time.perf_counter()
        _, filters = query_parser.parse(message or "")
        found = retrieval.search_by_image(image_bytes, filters, limit)
        trace.add("photo_search", started, hits=len(found["debug"]), top_scores=found["debug"][:5])
        products = found["products"]
        trace.results = len(products)
        metrics.RESULTS.labels("photo_search").observe(len(products))
        if found["debug"]:
            metrics.TOP_SCORE.labels("image").observe(found["debug"][0]["score"])
        if not products:
            metrics.ZERO_RESULTS.labels("photo_search").inc()
        context = "The customer uploaded a photo; these products looked most similar.\n" + build_context(products)
        started = time.perf_counter()
        reply = _write(PRODUCT_RULES, context, message or "Find products that look like this photo.")
        trace.add("answer", started, llm=reply is not None)
        trace.answered("photo_search", reply, context, products, reply is not None)
        if not reply:
            reply = (_product_list(products, "Here's what looks most like your photo:") if products
                     else "I couldn't find anything that looks like that photo.")
    except Exception:
        trace.done("photo_search", "photo", status="error")
        raise
    record = trace.done("photo_search", "photo")
    record["contexts"] = trace.contexts
    return {"request_id": trace.request_id, "answer": reply, "intent": "photo_search", "products": products, "orders": [], "sources": [],
            "action": None, "applied": found["applied"], "state": None, "llm": llm.enabled(), "debug": record}


def llm_enabled():
    return llm.enabled()
