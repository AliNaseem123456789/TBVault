"""Phase 3: metrics, logs, answer checks, feedback, stats, evaluation maths."""
import json
import math
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import chat, config, evaluate, indexer, llm, metrics, quality, retrieval, reranker, router, stats
from app.main import app
from app.router import Route, Task


def value(name, **labels):
    return metrics.REGISTRY.get_sample_value(name, labels) or 0.0


def usage(prompt, completion, reasoning=0):
    return SimpleNamespace(prompt_tokens=prompt, completion_tokens=completion,
                           completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning),
                           prompt_tokens_details=SimpleNamespace(cached_tokens=0))


class FakeGroq:
    """Scripted replies with token usage."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        text = reply if isinstance(reply, str) else json.dumps(reply)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text, tool_calls=None))],
                               usage=usage(1000, 200, 50))


@pytest.fixture
def groq(monkeypatch):
    def install(replies):
        fake = FakeGroq(replies)
        monkeypatch.setattr(config, "GROQ_API_KEY", "test")
        monkeypatch.setattr(llm, "_client", lambda: fake)
        return fake
    return install


@pytest.fixture(autouse=True)
def tiny_catalog(request, monkeypatch):
    if "shop" in request.fixturenames:
        return
    from app import catalog, query_parser
    monkeypatch.setattr(catalog, "brands", lambda: [])
    monkeypatch.setattr(catalog, "categories", lambda: [])
    query_parser._cache["at"] = 0


# ----------------------------------------------------------------------------
# tokens and cost
# ----------------------------------------------------------------------------
def test_cost_uses_price_per_million():
    assert metrics.cost_usd("openai/gpt-oss-120b", 1_000_000, 0) == pytest.approx(0.15)
    assert metrics.cost_usd("openai/gpt-oss-20b", 0, 2_000_000) == pytest.approx(1.00)
    assert metrics.cost_usd("unknown-model", 5000, 5000) == 0


def test_llm_calls_record_tokens_cost_and_request_usage(groq):
    groq(["hello", RuntimeError("boom")])
    before = value("chatbot_llm_tokens_total", model=config.LLM_MODEL, purpose="answer", type="prompt")
    errors_before = value("chatbot_llm_calls_total", model=config.LLM_MODEL, purpose="answer", status="error")
    current = metrics.start_request()
    llm.chat([{"role": "user", "content": "hi"}], purpose="answer")
    with pytest.raises(llm.LLMError):
        llm.chat([{"role": "user", "content": "hi"}], purpose="answer")
    assert value("chatbot_llm_tokens_total", model=config.LLM_MODEL, purpose="answer", type="prompt") == before + 1000
    assert value("chatbot_llm_calls_total", model=config.LLM_MODEL, purpose="answer", status="error") == errors_before + 1
    # a failed call still counts as a call (an attempt), but has no tokens
    assert current["llm_calls"] == 2 and current["prompt_tokens"] == 1000 and current["reasoning_tokens"] == 50
    assert current["cost_usd"] == pytest.approx(metrics.cost_usd(config.LLM_MODEL, 1000, 200))
    assert current["by_purpose"] == {"answer": {"calls": 2, "tokens": 1200}}


def test_invalid_json_is_counted(groq):
    groq(["nope", {"tasks": [{"intent": "greeting"}]}])
    before = value("chatbot_llm_calls_total", model=config.FAST_LLM_MODEL, purpose="route", status="invalid_json")
    router.route("tell me something")
    assert value("chatbot_llm_calls_total", model=config.FAST_LLM_MODEL, purpose="route", status="invalid_json") == before + 1


# ----------------------------------------------------------------------------
# per-request metrics + log
# ----------------------------------------------------------------------------
def test_request_metrics_and_log_line(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    before = value("chatbot_requests_total", intent="product_search", routed_by="rules", status="ok")
    stage_before = value("chatbot_stage_seconds_count", stage="search")
    result = chat.answer("kettle for me@example.com, call 0300 1234567")
    assert result["request_id"] and len(result["request_id"]) == 16
    assert value("chatbot_requests_total", intent="product_search", routed_by="rules", status="ok") == before + 1
    assert value("chatbot_stage_seconds_count", stage="search") == stage_before + 1
    assert value("chatbot_request_cpu_seconds_count", intent="product_search") >= 1

    lines = [json.loads(line) for path in config.LOG_DIR.glob("chat-*.jsonl") for line in path.read_text().splitlines()]
    record = next(r for r in lines if r["request_id"] == result["request_id"])
    text = json.dumps(record)
    assert "me@example.com" not in text and "1234567" not in text and "[email]" in text
    assert record["intent"] == "product_search" and record["results"] >= 1 and "contexts" not in record
    assert {s["step"] for s in record["steps"]} >= {"route", "search", "answer"}


def test_errors_are_counted_and_still_raise(monkeypatch):
    monkeypatch.setattr(router, "route", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    before = value("chatbot_requests_total", intent="unknown", routed_by="rules", status="error")
    with pytest.raises(RuntimeError):
        chat.answer("lamps")
    assert value("chatbot_requests_total", intent="unknown", routed_by="rules", status="error") == before + 1


def test_zero_results_and_rerank_change_are_counted(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    zero_before = value("chatbot_zero_results_total", intent="product_search")
    chat.answer("kettle under $0.01")   # nothing costs that little
    assert value("chatbot_zero_results_total", intent="product_search") == zero_before + 1

    monkeypatch.setattr(config, "RERANK", True)
    monkeypatch.setattr(reranker, "score", lambda q, docs: [5.0 if "Kettle" in d else -3.0 for d in docs])
    changed_before = value("chatbot_rerank_total", changed_top="yes")
    monkeypatch.setattr(router, "route", lambda *a, **k: (Route(tasks=[Task(intent="product_search", query="zqacme zqsony")]), "rules"))
    chat.answer("zqacme zqsony")
    assert value("chatbot_rerank_total", changed_top="yes") == changed_before + 1


def test_template_fallback_is_counted(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "GROQ_API_KEY", "x")
    monkeypatch.setattr(router, "_llm_route", lambda *a: router.rule_route("kettle"))

    def broken(*a, **k):
        raise llm.LLMError("down")
    monkeypatch.setattr(llm, "chat", broken)
    before = value("chatbot_fallbacks_total", kind="answer_template")
    chat.answer("kettle")
    assert value("chatbot_fallbacks_total", kind="answer_template") == before + 1


# ----------------------------------------------------------------------------
# answer checks
# ----------------------------------------------------------------------------
def test_invented_prices_are_detected():
    products = [{"id": 1, "name": "Brass Lamp", "price": "80.00", "sale_price": "60.00", "lowest_price": "60.00",
                 "variants": [{"effective_list_price": "95.00", "sale_price": None}]}]
    context = "PRODUCTS:\n[1] Brass Lamp | price $60.00 (on sale, 25% off; was $80.00)"
    ok = quality.check_answer("The Brass Lamp is $60 now (was $80.00); the large one is $95.", context, products)
    assert ok == {"unsupported_prices": [], "products_cited": 1, "products_shown": 1}
    bad = quality.check_answer("It costs $1,299.99 or $45.", context, products)
    assert bad["unsupported_prices"] == ["1299.99", "45.00"] and bad["products_cited"] == 0


def test_answer_checks_feed_metrics(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "GROQ_API_KEY", "x")
    monkeypatch.setattr(router, "_llm_route", lambda *a: router.rule_route("kettle"))
    monkeypatch.setattr(llm, "chat", lambda *a, **k: SimpleNamespace(content="The Zqacme Steel Kettle is $12.00!"))
    fail_before = value("chatbot_answer_checks_total", check="prices_grounded", result="fail")
    result = chat.answer("kettle", )
    assert value("chatbot_answer_checks_total", check="prices_grounded", result="fail") == fail_before + 1
    assert result["debug"]["checks"][0]["unsupported_prices"] == ["12.00"]
    assert "PRODUCTS:" in result["debug"]["contexts"][0]


# ----------------------------------------------------------------------------
# endpoints
# ----------------------------------------------------------------------------
def test_metrics_endpoint_and_feedback(monkeypatch):
    monkeypatch.setattr(config, "INTERNAL_KEY", "")
    client = TestClient(app)
    before = value("chatbot_feedback_total", intent="product_search", rating="down")
    r = client.post("/chat/feedback", json={"request_id": "abcdef0123456789", "rating": "down",
                                            "intent": "product_search", "comment": "wrong price, mail me a@b.co"})
    assert r.status_code == 200
    assert value("chatbot_feedback_total", intent="product_search", rating="down") == before + 1
    saved = json.loads(next(config.LOG_DIR.glob("feedback-*.jsonl")).read_text().splitlines()[-1])
    assert saved["rating"] == "down" and "a@b.co" not in saved["comment"]

    assert client.post("/chat/feedback", json={"request_id": "not-hex!", "rating": "up"}).status_code == 422
    assert client.post("/chat/feedback", json={"request_id": "abcdef0123456789", "rating": "meh"}).status_code == 422
    assert client.post("/chat/feedback", json={"request_id": "abcdef0123456789", "rating": "up", "intent": "hack"}).status_code == 422

    text = client.get("/metrics").text
    assert "chatbot_feedback_total" in text and "chatbot_process_memory_bytes" in text
    assert "_created" not in text


# ----------------------------------------------------------------------------
# stats from logs
# ----------------------------------------------------------------------------
def test_stats_summarize_logs():
    config.LOG_DIR.mkdir(parents=True, exist_ok=True)
    from datetime import datetime, timezone
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = []
    for n in range(10):
        rows.append({"request_id": f"{n:016x}", "intent": "product_search" if n < 8 else "greeting", "routed_by": "llm",
                     "status": "ok", "total_ms": (n + 1) * 100, "cpu_ms": 20, "results": 0 if n == 0 else 3,
                     "llm": {"prompt_tokens": 900, "completion_tokens": 100, "cost_usd": 0.0002,
                             "by_purpose": {"route": {"calls": 1, "tokens": 500}, "answer": {"calls": 1, "tokens": 500}}},
                     "checks": [{"unsupported_prices": ["9.99"] if n == 1 else [], "products_cited": 1, "products_shown": 3}]})
    (config.LOG_DIR / f"chat-{day}.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    (config.LOG_DIR / f"feedback-{day}.jsonl").write_text(
        json.dumps({"request_id": "0" * 16, "rating": "up", "intent": "product_search"}) + "\n")
    s = stats.summarize(days=1)
    assert s["requests"] == 10 and s["latency_ms"] == {"p50": 500, "p95": 1000}   # nearest-rank percentiles
    assert s["tokens_per_request"] == 1000 and s["cost_usd_per_1000_requests"] == pytest.approx(0.2)
    assert s["zero_result_rate"] == pytest.approx(1 / 8) and s["bad_price_rate"] == 0.1
    assert s["by_purpose"]["route"] == {"calls": 10, "tokens": 5000}
    assert s["intents"]["product_search"]["thumbs_up"] == 1


# ----------------------------------------------------------------------------
# evaluation maths, reports, judge
# ----------------------------------------------------------------------------
def test_ranking_metrics():
    relevant = {1, 2}
    assert evaluate.first_rank([9, 2, 1], relevant) == 2
    assert evaluate.precision([1, 9, 2, 8, 7], relevant) == 0.4
    assert evaluate.ndcg([1, 2, 9], relevant) == pytest.approx(1.0)
    expected = (1 / math.log2(3) + 1 / math.log2(4)) / (1 + 1 / math.log2(3))
    assert evaluate.ndcg([9, 1, 2], relevant) == pytest.approx(expected)
    summary = evaluate.summarize([{"ids": [1, 9], "relevant": {1}, "ms": 10}, {"ids": [9, 8], "relevant": {1}, "ms": 30}])
    assert summary["hit@5"] == 0.5 and summary["MRR"] == 0.5 and summary["ms"] == 20


def test_reports_are_saved_and_listed(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(config, "EVAL_REPORT_DIR", tmp_path / "reports")
    evaluate.save_report("routing", {"accuracy": 0.9, "median_ms": 300, "cost_usd": 0.001, "cases": 3})
    evaluate.history()
    out = capsys.readouterr().out
    assert "routing    accuracy 0.9" in out


def test_answer_eval_with_judge(fake_world, shop, groq, tmp_path, monkeypatch, capsys):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "EVAL_REPORT_DIR", tmp_path / "reports")
    cases = {"cases": [
        {"question": "kettle?", "intent": "product_search", "must_mention": ["Kettle", "boil|unicorn"]},
        {"question": "do you have unicorns", "requires_products": ["No Such Thing Zz"]},
    ]}
    path = tmp_path / "answers.json"
    path.write_text(json.dumps(cases))
    monkeypatch.setattr(evaluate, "ANSWER_FILE", path)
    groq([{"tasks": [{"intent": "product_search", "query": "zqacme steel kettle"}]},
          "The Zqacme Steel Kettle is $50.00 and boils water fast.",
          {"faithfulness": 5, "relevance": 4, "unsupported_claims": [], "reason": "fine"}])
    summary = evaluate.run_answers()
    assert summary["cases"] == 1 and summary["faithfulness"] == 1.0 and summary["relevance"] == 0.75
    assert summary["must_mention"] == 1.0 and summary["intent"] == 1.0 and summary["bad_prices"] == 0
    assert "skip  'do you have unicorns'" in capsys.readouterr().out
    assert list((tmp_path / "reports").glob("answers-*.json"))
