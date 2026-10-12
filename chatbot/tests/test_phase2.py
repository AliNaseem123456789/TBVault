"""Phase 2: routing, rewriting, planning, reranking, policies, order tools."""
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app import chat, config, indexer, llm, planner, policies, reranker, retrieval, router, tools
from app.main import app
from app.router import Route, SearchFilters, Task


# ----------------------------------------------------------------------------
# a fake Groq client: answers come from a list, requests are recorded
# ----------------------------------------------------------------------------
class FakeGroq:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        if isinstance(reply, dict) and "tool_calls" in reply:
            message = SimpleNamespace(content=reply.get("content"), tool_calls=[
                SimpleNamespace(id=f"call{n}", function=SimpleNamespace(name=name, arguments=json.dumps(args)))
                for n, (name, args) in enumerate(reply["tool_calls"])])
        else:
            message = SimpleNamespace(content=reply if isinstance(reply, str) else json.dumps(reply), tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


@pytest.fixture
def groq(monkeypatch):
    """Turns the LLM on with scripted replies: groq(["...", {...}])."""
    def install(replies):
        fake = FakeGroq(replies)
        monkeypatch.setattr(config, "GROQ_API_KEY", "test-key")
        monkeypatch.setattr(llm, "_client", lambda: fake)
        return fake
    return install


@pytest.fixture(autouse=True)
def small_catalog(request, monkeypatch):
    """Tests without the database get a tiny brand/category list for the router and parser."""
    if "shop" in request.fixturenames:
        return
    from app import catalog, query_parser
    monkeypatch.setattr(catalog, "brands", lambda: [{"id": 1, "name": "Samsung"}, {"id": 2, "name": "Sony"}])
    monkeypatch.setattr(catalog, "categories", lambda: [{"id": 10, "name": "Smartphones"}, {"id": 11, "name": "Audio"}])
    query_parser._cache["at"] = 0


def no_search(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("search must not run for this message")
    monkeypatch.setattr(retrieval, "search_products", boom)


# ----------------------------------------------------------------------------
# intent classification
# ----------------------------------------------------------------------------
@pytest.mark.parametrize("message", ["hi", "Hello!", "hey there", "thanks a lot", "ok", "bye", "assalam o alaikum"])
def test_greetings_skip_the_llm_and_search(monkeypatch, message):
    monkeypatch.setattr(llm, "ask_json", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no LLM")))
    no_search(monkeypatch)
    result = chat.answer(message)
    assert result["intent"] == "greeting" and result["products"] == []
    assert result["answer"]


def test_llm_route_is_validated_and_retried(groq):
    fake = groq(["not json at all", {"tasks": [{"intent": "product_search", "query": "red shoes"}]}])
    route, how = router.route("got any red shoes")
    assert how == "llm" and route.intent == "product_search" and route.tasks[0].query == "red shoes"
    assert len(fake.requests) == 2 and "invalid" in fake.requests[1]["messages"][-1]["content"]
    assert fake.requests[0]["model"] == config.FAST_LLM_MODEL
    assert fake.requests[0]["response_format"] == {"type": "json_object"}


@pytest.mark.parametrize("bad", [
    {"tasks": [{"intent": "delete_database"}]},                                    # unknown intent
    {"tasks": [{"intent": "order_tracking", "order_id": -4}]},                     # invalid id
    {"tasks": [{"intent": "product_search", "run_sql": "DROP TABLE"}]},            # unknown field
    {"tasks": []},                                                                 # nothing
    {"tasks": [{"intent": "greeting"}] * 4},                                       # too many
])
def test_invalid_llm_output_falls_back_to_rules(groq, bad):
    groq([bad, bad])
    route, how = router.route("where is my order 52")
    assert how == "rules"
    assert route.intent == "order_tracking" and route.tasks[0].order_id == 52


@pytest.mark.parametrize("message, intent, check", [
    ("where is order 52?", "order_tracking", {"order_id": 52}),
    ("show my orders", "order_tracking", {}),
    ("cancel order #77", "order_cancellation", {"order_id": 77}),
    ("compare iPhone 13 vs Galaxy S10", "product_comparison", {"products": ["iPhone 13", "Galaxy S10"]}),
    ("how long do refunds take?", "policy_question", {}),
    ("lamps under $50", "product_search", {}),
])
def test_keyword_rules_without_llm(message, intent, check):
    route = router.rule_route(message)
    assert route.intent == intent
    for key, value in check.items():
        assert getattr(route.tasks[0], key) == value
    if intent == "product_search":
        assert route.tasks[0].filters.max_price == 50


def test_out_of_scope_and_clarification_dont_search(groq, monkeypatch):
    no_search(monkeypatch)
    groq([{"tasks": [{"intent": "out_of_scope"}]}])
    assert "only help with shopping" in chat.answer("what's the weather")["answer"]
    groq([{"tasks": [{"intent": "clarification_needed", "question": "Which product do you mean?"}]}])
    assert chat.answer("I want the blue one")["answer"] == "Which product do you mean?"


# ----------------------------------------------------------------------------
# rewriting + filters carried over
# ----------------------------------------------------------------------------
def test_follow_up_is_rewritten_with_previous_filters(fake_world, shop, groq):
    indexer.rebuild(progress=lambda *_: None)
    previous = {"query": "headphones earbuds", "filters": {"in_stock": True}}
    rewritten = {"tasks": [{"intent": "product_search", "query": "Zqsony headphones",
                            "filters": {"brand": "Zqsony", "max_price": 150, "in_stock": True}}]}
    fake = groq([rewritten, "The Zqsony WH-CH720N Headphones are $99.00."])
    result = chat.answer("only zqsony under 150", history=[{"role": "user", "content": "headphones earbuds in stock"}],
                         state=previous)
    prompt = fake.requests[0]["messages"][1]["content"]
    assert 'PREVIOUS SEARCH: {"query": "headphones earbuds", "filters": {"in_stock": true}}' in prompt
    assert [p["id"] for p in result["products"]] == [shop["headphones"]]
    assert result["applied"]["brand_id"] == shop["sony"] and result["applied"]["max_price"] == 150
    assert result["state"] == {"query": "Zqsony headphones", "filters": {"brand": "Zqsony", "max_price": 150.0, "in_stock": True}}


def test_state_survives_a_policy_question_in_between(fake_world, shop, groq, monkeypatch):
    monkeypatch.setattr(policies, "search", lambda q, **k: [])
    groq([{"tasks": [{"intent": "policy_question", "query": "refund time"}]}, "Not sure."])
    state = {"query": "lamps", "filters": {"max_price": 50}}
    assert chat.answer("how long do refunds take", state=state)["state"] == state


def test_unknown_brand_name_is_not_used_as_a_filter(fake_world, shop):
    filters = router.to_search_filters(SearchFilters(brand="NoSuchBrandZz", category="zqkitchen", min_price=80, max_price=20))
    assert filters.brand_id is None and filters.category_id == shop["kitchen"]
    assert (filters.min_price, filters.max_price) == (20, 80)


# ----------------------------------------------------------------------------
# multiple intents
# ----------------------------------------------------------------------------
def test_multiple_intents_are_each_answered(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(policies, "search", lambda q, **k: [
        {"id": "returns#window", "title": "Returns and refunds", "section": "Return window", "text": "30 days.", "score": 1}])
    route = Route(tasks=[Task(intent="product_search", query="kettle"), Task(intent="policy_question", query="return window")])
    monkeypatch.setattr(router, "route", lambda *a, **k: (route, "llm"))
    result = chat.answer("do you have kettles, and what's the return window?")
    assert result["intent"] == "multiple_intents"
    assert result["products"][0]["id"] == shop["kettle"]
    assert "Zqacme Steel Kettle" in result["answer"] and "30 days." in result["answer"]
    assert result["sources"] == [{"title": "Returns and refunds", "section": "Return window"}]


# ----------------------------------------------------------------------------
# planning (complex vs simple)
# ----------------------------------------------------------------------------
def test_only_complex_comparisons_get_a_plan():
    assert planner.needs_plan(Task(intent="product_comparison", search="phones under $500", products=["iPhone 13 Pro"]))
    assert not planner.needs_plan(Task(intent="product_comparison", products=["iPhone 13", "Galaxy S10"]))
    many_filters = Task(intent="product_search", query="samsung phones",
                        filters=SearchFilters(brand="Samsung", max_price=300, in_stock=True, on_sale=True))
    assert not planner.needs_plan(many_filters)


def test_plan_with_unknown_operation_is_rejected(groq):
    task = Task(intent="product_comparison", search="audio under $150", products=["WH-CH720N"], goal="pick one")
    groq([{"steps": [{"op": "send_email", "query": "x"}]}] * 2)
    plan, how = planner.make_plan(task, "...")
    assert how == "rules" and [s.op for s in plan.steps] == ["search_products", "get_product"]


def test_complex_comparison_runs_the_plan(fake_world, shop, groq):
    indexer.rebuild(progress=lambda *_: None)
    route = {"tasks": [{"intent": "product_comparison", "search": "zqacme earbuds", "products": ["Zqsony WH-CH720N"],
                        "goal": "recommend one for running"}]}
    plan = {"steps": [{"op": "search_products", "query": "zqacme earbuds", "filters": {"max_price": 30}},
                      {"op": "get_product", "query": "Zqsony WH-CH720N"}], "goal": "recommend one for running"}
    fake = groq([route, plan, "For running, the Zqacme Earbuds Mini..."])
    result = chat.answer("find earbuds under $30 and compare with the WH-CH720N for running")
    ids = [p["id"] for p in result["products"]]
    assert ids == [shop["earbuds"], shop["headphones"]]
    steps = [s["step"] for s in result["debug"]["steps"]]
    assert steps == ["route", "plan", "plan_steps", "answer"]
    assert "Goal: recommend one for running" in fake.requests[-1]["messages"][-1]["content"]


def test_simple_comparison_skips_the_planner(fake_world, shop, groq):
    indexer.rebuild(progress=lambda *_: None)
    groq([{"tasks": [{"intent": "product_comparison", "products": ["Zqacme Frying Pan", "Zqacme Steel Kettle", "Unicorn Toaster 9000"]}]},
          "Both are kitchen items..."])
    result = chat.answer("compare the frying pan, the steel kettle and the unicorn toaster")
    assert [p["id"] for p in result["products"]] == [shop["pan"], shop["kettle"]]
    lookups = next(s for s in result["debug"]["steps"] if s["step"] == "lookups")
    assert lookups["missing"] == ["Unicorn Toaster 9000"]


# ----------------------------------------------------------------------------
# reranking
# ----------------------------------------------------------------------------
def test_reranker_reorders_candidates(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "RERANK", True)
    monkeypatch.setattr(reranker, "score", lambda q, docs: [5.0 if "Kettle" in d else -3.0 for d in docs])
    plain = retrieval.search_products("zqacme zqsony", rerank=False)
    reranked = retrieval.search_products("zqacme zqsony")
    assert len(plain["products"]) >= 4 and plain["products"][0]["id"] != shop["kettle"]
    assert reranked["reranked"] and reranked["products"][0]["id"] == shop["kettle"]
    assert reranked["rerank"][0] == {"product_id": shop["kettle"], "score": 5.0}
    assert {p["id"] for p in plain["products"]} == {p["id"] for p in reranked["products"]}   # nothing lost


def test_reranker_is_skipped_when_it_cant_help(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "RERANK", True)
    calls = []
    monkeypatch.setattr(reranker, "score", lambda q, docs: calls.append(len(docs)) or [0.0] * len(docs))
    assert not retrieval.search_products("ZQ-PAN-L")["reranked"]             # exact SKU
    assert not retrieval.search_products("kettle")["reranked"]               # 3 or fewer candidates
    assert calls == []


def test_reranker_failure_keeps_hybrid_order(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "RERANK", True)
    monkeypatch.setattr(reranker, "score", lambda q, docs: (_ for _ in ()).throw(RuntimeError("model missing")))
    plain = retrieval.search_products("zqacme zqsony", rerank=False)
    result = retrieval.search_products("zqacme zqsony")
    assert not result["reranked"] and [p["id"] for p in result["products"]] == [p["id"] for p in plain["products"]]


def test_rerank_min_score_drops_irrelevant(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "RERANK", True)
    monkeypatch.setattr(config, "RERANK_MIN_SCORE", 0.0)
    monkeypatch.setattr(reranker, "score", lambda q, docs: [5.0 if "Kettle" in d else -3.0 for d in docs])
    assert [p["id"] for p in retrieval.search_products("zqacme zqsony")["products"]] == [shop["kettle"]]


# ----------------------------------------------------------------------------
# policies: parent-child
# ----------------------------------------------------------------------------
@pytest.fixture
def knowledge(tmp_path, monkeypatch):
    folder = tmp_path / "knowledge"
    folder.mkdir()
    (folder / "returns.md").write_text(
        "# Returns and refunds\n\n## Return window\nYou can return items within {{return_window_days}} days.\n\n"
        "## Card refunds\nCard refunds take 5 to 10 business days to appear.\n\n"
        "## Long section\n" + "\n\n".join(f"Paragraph {n} about the zebra topic number {n}." * 3 for n in range(40)) + "\n")
    (folder / "shipping.md").write_text("# Shipping\n\n## Zones\n{{shipping_zones}}\n")
    monkeypatch.setattr(config, "KNOWLEDGE_DIR", folder)
    monkeypatch.setattr(policies, "_live_values", lambda: {"return_window_days": "14", "store_name": "TBVault",
                                                           "shipping_zones": "- Karachi: $2.00"})
    return folder


def test_policies_are_split_into_parents_and_children(fake_world, knowledge):
    parents = policies.load_parents()
    assert set(parents) == {"returns#return-window", "returns#card-refunds", "returns#long-section", "shipping#zones"}
    assert parents["returns#return-window"]["text"] == "You can return items within 14 days."   # placeholder filled
    assert parents["shipping#zones"]["text"] == "- Karachi: $2.00"
    long_children = policies.children_of(parents["returns#long-section"])
    assert len(long_children) > 5 and all(len(c["text"]) <= config.POLICY_CHUNK_CHARS + 60 for c in long_children)
    assert long_children[0]["context_text"].startswith("Policy: Returns and refunds. Section: Long section. ")

    report = policies.index_policies()
    assert report["sections"] == 4 and report["chunks"] == len(fake_world.text.spaces["policies"])
    assert not [i for i in fake_world.text.vectors if i.startswith("policy:")]      # kept out of the products


def test_policy_search_returns_parent_sections(fake_world, knowledge):
    policies.index_policies()
    hits = policies.search("how long do card refunds take")
    assert hits[0]["id"] == "returns#card-refunds"
    assert hits[0]["text"] == "Card refunds take 5 to 10 business days to appear."
    long_hit = policies.search("zebra topic number 17")[0]
    assert long_hit["id"] == "returns#long-section"
    assert "number 17" in long_hit["text"] and len(long_hit["text"]) < policies.MAX_PARENT_CHARS   # trimmed


def test_policy_answer_without_llm_quotes_the_section(fake_world, knowledge, monkeypatch):
    policies.index_policies()
    monkeypatch.setattr(router, "route", lambda *a, **k: (Route(tasks=[Task(intent="policy_question", query="return window days")]), "rules"))
    result = chat.answer("how many days do I have to return?")
    assert "14 days" in result["answer"] and result["sources"][0]["section"] == "Return window"


def test_policy_question_when_not_indexed(fake_world, knowledge, monkeypatch):
    monkeypatch.setattr(router, "route", lambda *a, **k: (Route(tasks=[Task(intent="policy_question", query="refunds")]), "rules"))
    assert "not sure" in chat.answer("refunds?")["answer"]


# ----------------------------------------------------------------------------
# order tools
# ----------------------------------------------------------------------------
ORDERS = {   # token -> that customer's orders
    "alice": {5: {"id": 5, "status": "pending", "payment_method": "card", "payment_status": "paid", "total_amount": "40.00",
                  "order_date": "2026-10-01T10:00:00Z", "shipping_address": "SECRET STREET 1", "items": [
                      {"product_name": "Lamp", "variant_name": None, "quantity": 1, "unit_price": "40.00"}],
                  "seller_orders": [{"status": "pending", "seller": {"store_name": "Lamp Works"}}],
                  "status_history": [{"to_status": "pending", "created_at": "2026-10-01T10:00:00Z"}]},
              6: {"id": 6, "status": "shipped", "payment_method": "cod", "payment_status": "unpaid", "total_amount": "15.00",
                  "order_date": "2026-09-20T10:00:00Z", "tracking_carrier": "TCS", "tracking_number": "T-99",
                  "items": [], "seller_orders": [], "status_history": []}},
}


@pytest.fixture
def node_api(monkeypatch):
    calls = []

    def fake_get(url, headers, timeout):
        token = headers["Authorization"].removeprefix("Bearer ")
        calls.append(url)
        if token == "expired":
            return httpx.Response(401, json={"message": "Not authenticated"})
        if token == "down":
            raise httpx.ConnectError("refused")
        orders = ORDERS.get(token, {})
        path = url.removeprefix(config.NODE_API_URL)
        if path == "/order":
            return httpx.Response(200, json={"data": {"orders": list(orders.values())}})
        order_id = int(path.rsplit("/", 1)[1])
        if order_id not in orders:      # the backend answers 404 for other people's orders
            return httpx.Response(404, json={"message": "Order not found"})
        return httpx.Response(200, json={"data": {"order": orders[order_id]}})

    monkeypatch.setattr(httpx, "get", fake_get)
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("tools must never POST")))
    return calls


def test_tools_validate_arguments_and_permissions(node_api):
    allowed = tools.ALLOWED["order_tracking"]
    assert tools.execute("get_order_status", '{"order_id": "abc"}', "alice", allowed)[0]["error"] == "bad_arguments"
    assert tools.execute("get_order_status", {"order_id": -1}, "alice", allowed)[0]["error"] == "bad_arguments"
    assert tools.execute("get_order_status", {"order_id": 5, "sql": "x"}, "alice", allowed)[0]["error"] == "bad_arguments"
    result, entry = tools.execute("request_order_cancellation", {"order_id": 5}, "alice", allowed)
    assert result["error"] == "not_permitted" and entry["outcome"] == "not_permitted"
    assert tools.execute("delete_everything", {}, "alice", allowed)[0]["error"] == "not_permitted"
    assert node_api == []    # nothing reached the API


def test_tools_respect_login_and_ownership(node_api):
    allowed = tools.ALLOWED["order_tracking"]
    assert tools.execute("get_my_orders", {}, None, allowed)[0]["error"] == "login_required"
    assert tools.execute("get_my_orders", {}, "expired", allowed)[0]["error"] == "login_required"
    assert tools.execute("get_order_details", {"order_id": 6}, "bob", allowed)[0]["error"] == "not_found"   # alice's order
    assert tools.execute("get_my_orders", {}, "down", allowed)[0]["error"] == "unavailable"
    details, _ = tools.execute("get_order_details", {"order_id": 5}, "alice", allowed)
    assert details["items"][0]["name"] == "Lamp" and "SECRET" not in json.dumps(details)   # no address
    status, _ = tools.execute("get_order_status", {"order_id": 6}, "alice", allowed)
    assert status["status"] == "shipped" and status["tracking"] == "TCS T-99"


def test_cancellation_needs_the_button(node_api):
    allowed = tools.ALLOWED["order_cancellation"]
    ok, _ = tools.execute("request_order_cancellation", {"order_id": 5}, "alice", allowed)
    assert ok["can_cancel"] and ok["action"] == {"type": "cancel_order", "order_id": 5, "label": "Yes, cancel order #5"}
    assert ok["refund_note"]
    shipped, _ = tools.execute("request_order_cancellation", {"order_id": 6}, "alice", allowed)
    assert not shipped["can_cancel"] and "action" not in shipped


def test_order_questions_without_login(monkeypatch):
    monkeypatch.setattr(router, "route", lambda *a, **k: (Route(tasks=[Task(intent="order_tracking", order_id=5)]), "rules"))
    result = chat.answer("where is order 5")
    assert "sign in" in result["answer"] and result["orders"] == []


def test_order_rules_without_llm(node_api):
    task = Task(intent="order_cancellation", order_id=5)
    out = tools.run(task, "cancel order 5", "alice")
    assert out["action"]["order_id"] == 5 and "button" in out["answer"]
    out = tools.run(Task(intent="order_tracking"), "my orders", "alice")
    assert [o["order_id"] for o in out["orders"]] == [5, 6]
    out = tools.run(Task(intent="order_tracking", order_id=6), "where is 6", "alice")
    assert "shipped" in out["answer"] and "T-99" in out["answer"]


def test_llm_tool_loop(node_api, groq):
    fake = groq([
        {"tool_calls": [("delete_orders", {}), ("request_order_cancellation", {"order_id": 5})]},
        "Order #5 can be cancelled. Press the button below to confirm.",
    ])
    out = tools.run(Task(intent="order_cancellation", order_id=5), "cancel my order 5", "alice")
    assert out["answer"].startswith("Order #5 can be cancelled")
    assert [c["outcome"] for c in out["tool_calls"]] == ["not_permitted", "ok"]
    assert out["action"]["order_id"] == 5                                     # set by the app, not the model
    tool_messages = [m for m in fake.requests[1]["messages"] if m["role"] == "tool"]
    assert json.loads(tool_messages[0]["content"])["error"] == "not_permitted"
    names = [t["function"]["name"] for t in fake.requests[0]["tools"]]
    assert names == tools.ALLOWED["order_cancellation"]
    assert fake.requests[0]["model"] == config.LLM_MODEL


def test_llm_tool_loop_failure_falls_back_to_rules(node_api, groq):
    groq([llm.LLMError("groq down")])
    out = tools.run(Task(intent="order_tracking", order_id=6), "where is order 6", "alice")
    assert "shipped" in out["answer"]


# ----------------------------------------------------------------------------
# API
# ----------------------------------------------------------------------------
def test_api_forwards_user_token_and_validates_state(monkeypatch):
    seen = {}

    def fake_answer(message, history, state=None, user_token=None, **kwargs):
        seen.update(state=state, token=user_token)
        return {"answer": "ok", "intent": "order_tracking", "products": [], "orders": [], "sources": [],
                "action": None, "applied": {}, "state": state, "llm": False, "debug": {"steps": []}}

    monkeypatch.setattr(config, "INTERNAL_KEY", "")
    monkeypatch.setattr(chat, "answer", fake_answer)
    client = TestClient(app)
    r = client.post("/chat", json={"message": "my orders", "state": {"query": "lamps", "filters": {"max_price": 50}}},
                    headers={"X-User-Token": "alice"})
    assert r.status_code == 200 and "debug" not in r.json()
    assert seen == {"state": {"query": "lamps", "filters": {"max_price": 50.0}}, "token": "alice"}
    assert client.post("/chat", json={"message": "x", "state": {"filters": {"hack": 1}}}).status_code == 422
    assert client.post("/chat", json={"message": "x", "state": {"query": "y" * 400}}).status_code == 422
