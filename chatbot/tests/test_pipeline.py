"""Indexing + search + chat against a real Postgres, with fake models and a fake Pinecone."""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import chat, config, indexer, retrieval, sync_worker
from app.main import app
from app.query_parser import Filters, parse
from tests.conftest import png


def ids_of(result):
    return [p["id"] for p in result["products"]]


def test_reindex_indexes_only_public_products(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    indexed = {int(i.split(":")[1]) for i in fake_world.text.vectors}
    assert {shop["headphones"], shop["earbuds"], shop["pan"], shop["kettle"]} <= indexed
    assert shop["secret"] not in indexed        # hidden
    assert shop["banned"] not in indexed        # seller suspended
    assert f"image:{shop['headphones']}:" in "".join(fake_world.images.vectors)
    vec = fake_world.text.vectors[f"product:{shop['headphones']}"]
    assert vec["metadata"]["brand"] == "Zqsony" and vec["metadata"]["index_version"] == config.INDEX_VERSION
    assert vec["sparse_values"]["indices"]       # BM25 part is there


def test_reindex_twice_creates_no_duplicates(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    counts = (len(fake_world.text.vectors), len(fake_world.images.vectors))
    indexer.rebuild(progress=lambda *_: None)
    indexer.sync_products([shop["headphones"], shop["pan"]])
    assert (len(fake_world.text.vectors), len(fake_world.images.vectors)) == counts


def test_model_number_is_found_by_keywords(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    for alpha in (0.0, 0.5):
        assert ids_of(retrieval.search_products("WH-CH720N", alpha=alpha))[0] == shop["headphones"]
    assert ids_of(retrieval.search_products("whch720n", alpha=0.0))[0] == shop["headphones"]


def test_paraphrase_is_found_by_meaning(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    # "music" never appears in any product text, so keywords alone find nothing
    # (what's left is the tiny dense weight hybrid_query keeps so Pinecone accepts the query) ...
    sparse_only = retrieval.search_products("music", alpha=0.0)
    assert all(d["score"] < 0.001 for d in sparse_only["debug"])
    # ... but the meaning side knows music ~ headphones/earbuds
    found = ids_of(retrieval.search_products("music", alpha=1.0))
    assert shop["headphones"] in found and shop["earbuds"] in found


def test_exact_sku_comes_first(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    assert ids_of(retrieval.search_products("ZQ-PAN-L"))[0] == shop["pan"]


def test_hard_rules_use_postgres_prices_and_stock(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    in_stock = ids_of(retrieval.search_products("earbuds headphones", Filters(in_stock=True)))
    assert shop["earbuds"] not in in_stock and shop["headphones"] in in_stock

    # pan: list price 40, but the Small option costs 30 -> cheapest price 30
    cheap = retrieval.search_products("pan kettle", Filters(max_price=35))
    assert ids_of(cheap) == [shop["pan"]]
    assert cheap["products"][0]["lowest_price"] == "30.00"

    # kettle: $100 with a 50% sale -> $50
    sale = retrieval.search_products("kettle", Filters(on_sale=True, max_price=60))
    assert ids_of(sale) == [shop["kettle"]]
    assert sale["products"][0]["sale_price"] == "50.00"


def test_category_and_brand_filters(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    kitchen = ids_of(retrieval.search_products("zqacme", Filters(category_id=shop["kitchen"])))
    assert set(kitchen) == {shop["pan"], shop["kettle"]}
    sony = ids_of(retrieval.search_products("headphones earbuds", Filters(brand_id=shop["sony"])))
    assert sony == [shop["headphones"]]


def test_hidden_product_never_leaks_even_before_resync(fake_world, shop, sql):
    indexer.rebuild(progress=lambda *_: None)
    sql("UPDATE products SET is_hidden = true WHERE id = %s", (shop["headphones"],))
    # the vector is still in Pinecone (stale), but Postgres has the final say
    assert f"product:{shop['headphones']}" in fake_world.text.vectors
    assert shop["headphones"] not in ids_of(retrieval.search_products("WH-CH720N"))
    # after the sync the vectors are gone too
    report = indexer.sync_products([shop["headphones"]])
    assert report["removed"] == 1
    assert f"product:{shop['headphones']}" not in fake_world.text.vectors
    assert not [i for i in fake_world.images.vectors if i.startswith(f"image:{shop['headphones']}:")]


def test_stale_category_in_index_is_corrected_by_postgres(fake_world, shop, sql):
    indexer.rebuild(progress=lambda *_: None)
    sql("UPDATE products SET category_id = %s WHERE id = %s", (shop["audio"], shop["kettle"]))
    # Pinecone still says kitchen; Postgres says audio -> not a kitchen result any more
    kitchen = ids_of(retrieval.search_products("kettle", Filters(category_id=shop["kitchen"])))
    assert shop["kettle"] not in kitchen


def test_deleted_product_is_removed(fake_world, shop, sql):
    indexer.rebuild(progress=lambda *_: None)
    sql("DELETE FROM products WHERE id = %s", (shop["earbuds"],))
    indexer.sync_products([shop["earbuds"]])
    assert f"product:{shop['earbuds']}" not in fake_world.text.vectors


def test_guessed_brand_is_dropped_when_nothing_matches(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    text, filters = parse("zqsony frying pan")
    assert filters.brand_id == shop["sony"]
    result = retrieval.search_products(text, filters)
    assert result["products"][0]["id"] == shop["pan"]        # the brand guess was ignored
    assert "brand_id" not in result["applied"]

    # a guess that fits is kept
    text, filters = parse("zqsony headphones")
    result = retrieval.search_products(text, filters)
    assert result["applied"]["brand_id"] == shop["sony"] and ids_of(result) == [shop["headphones"]]


def test_photo_search_and_text_to_photo(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    assert ids_of(retrieval.search_by_image(png("red")))[0] == shop["headphones"]
    assert ids_of(retrieval.search_by_image(png("green")))[0] == shop["pan"]
    assert ids_of(retrieval.search_images_by_text("something red"))[0] == shop["headphones"]
    with pytest.raises(ValueError):
        retrieval.search_by_image(b"not an image")


def test_no_results(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    assert retrieval.search_products("zzzz", Filters(max_price=0.01))["products"] == []


def test_chat_without_llm_still_answers(fake_world, shop):
    indexer.rebuild(progress=lambda *_: None)
    result = chat.answer("zqsony WH-CH720N under $150")
    assert result["llm"] is False
    assert result["products"][0]["id"] == shop["headphones"]
    assert "Zqsony WH-CH720N Headphones" in result["answer"]
    assert result["applied"]["max_price"] == 150


def test_chat_with_llm_gets_only_retrieved_facts(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    seen = {}

    def fake_llm(question, history, context):
        seen["context"], seen["history"] = context, history
        return "The Zqacme Steel Kettle is $50.00 on sale."

    monkeypatch.setattr(config, "GROQ_API_KEY", "x")
    monkeypatch.setattr(chat, "_ask_llm", fake_llm)
    result = chat.answer("kettle on sale", history=[{"role": "user", "content": "hi"}])
    assert result["llm"] is True and result["answer"].startswith("The Zqacme")
    assert "PRODUCTS:" in seen["context"] and "$50.00 (on sale, 50% off; was $100.00)" in seen["context"]
    assert "Zqsony Secret Speaker" not in seen["context"]


def test_chat_falls_back_when_llm_fails(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "GROQ_API_KEY", "x")
    monkeypatch.setattr(chat, "_ask_llm", lambda *a: (_ for _ in ()).throw(TimeoutError("slow")))
    result = chat.answer("kettle")
    assert result["llm"] is False and result["products"]


def test_build_context_is_bounded():
    product = {"name": "X", "lowest_price": "1.00", "price": "1.00", "sale_percent": None, "variants": [],
               "in_stock": True, "category": {"name": "C"}, "brand": None, "seller": {"store_name": "S"},
               "rating": None, "description": "word " * 500}
    context = chat.build_context([product] * 20)
    assert context.count("\n[") == config.CHAT_PRODUCTS_IN_PROMPT
    assert len(context) < 3000


# ---------------------------------------------------------------------------- API
def test_api_search_chat_and_errors(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    client = TestClient(app)

    r = client.get("/search", params={"query": "WH-CH720N", "debug": "true"})
    assert r.status_code == 200 and r.json()["products"][0]["id"] == shop["headphones"]
    assert "debug" in r.json()
    assert "debug" not in client.get("/search", params={"query": "pan"}).json()

    assert client.get("/search", params={"query": "pan", "min_price": 50, "max_price": 10}).status_code == 400
    assert client.get("/search", params={"query": ""}).status_code == 422
    assert client.get("/search", params={"query": "pan", "limit": 500}).status_code == 422

    r = client.post("/search/image", files={"image": ("a.png", png("blue"), "image/png")})
    assert r.json()["products"][0]["id"] == shop["earbuds"]
    assert client.post("/search/image", data={"query": "blue thing"}).json()["products"][0]["id"] == shop["earbuds"]
    assert client.post("/search/image").status_code == 400
    assert client.post("/search/image", files={"image": ("a.png", b"junk", "image/png")}).status_code == 400

    r = client.post("/chat", json={"message": "kettle", "history": [{"role": "assistant", "content": "hello"}]})
    assert r.status_code == 200 and r.json()["products"][0]["id"] == shop["kettle"]
    assert client.post("/chat", json={"message": ""}).status_code == 422
    assert client.post("/chat", json={"message": "x", "history": [{"role": "system", "content": "x"}]}).status_code == 422

    r = client.post("/chat/image", files={"image": ("a.png", png("green"), "image/png")}, data={"message": "like this"})
    assert r.json()["products"][0]["id"] == shop["pan"]

    fake_world.text.down = True   # Pinecone outage -> clear 503, no crash
    r = client.get("/search", params={"query": "pan"})
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]


def test_api_internal_key(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(config, "INTERNAL_KEY", "secret")
    client = TestClient(app)
    assert client.get("/search", params={"query": "pan"}).status_code == 401
    assert client.get("/search", params={"query": "pan"}, headers={"X-Internal-Key": "secret"}).status_code == 200
    assert client.get("/health").status_code == 200


# ---------------------------------------------------------------------------- sync worker
class FakeChannel:
    def __init__(self):
        self.published, self.acked = [], []

    def basic_publish(self, exchange, routing_key, body, properties):
        self.published.append((routing_key, properties.headers["x-attempts"]))

    def basic_ack(self, delivery_tag):
        self.acked.append(delivery_tag)


def test_sync_worker_handles_seller_events(fake_world, shop, sql):
    indexer.rebuild(progress=lambda *_: None)
    sql("UPDATE sellers SET status = 'SUSPENDED' WHERE id = %s", (shop["store"],))
    sync_worker.handle(json.dumps({"data": {"seller_id": shop["store"]}}))
    assert not [i for i in fake_world.text.vectors if int(i.split(":")[1]) in
                (shop["headphones"], shop["pan"], shop["kettle"], shop["earbuds"])]


def test_sync_worker_retries_then_parks_failed_messages(fake_world, shop, monkeypatch):
    indexer.rebuild(progress=lambda *_: None)
    monkeypatch.setattr(sync_worker.time, "sleep", lambda s: None)
    fake_world.text.down = True
    channel = FakeChannel()
    body = json.dumps({"data": {"product_ids": [shop["pan"]]}})

    sync_worker.on_message(channel, SimpleNamespace(delivery_tag=1), SimpleNamespace(headers=None), body)
    assert channel.published[-1] == (config.SYNC_QUEUE, 1) and channel.acked == [1]

    last = SimpleNamespace(headers={"x-attempts": config.SYNC_MAX_ATTEMPTS - 1})
    sync_worker.on_message(channel, SimpleNamespace(delivery_tag=2), last, body)
    assert channel.published[-1] == (config.SYNC_FAILED_QUEUE, config.SYNC_MAX_ATTEMPTS)

    fake_world.text.down = False
    sync_worker.on_message(channel, SimpleNamespace(delivery_tag=3), SimpleNamespace(headers=None), body)
    assert len(channel.published) == 2      # success: nothing re-published


def test_evaluation_runs(fake_world, shop, monkeypatch, tmp_path, capsys):
    from app import evaluate
    indexer.rebuild(progress=lambda *_: None)
    cases = {"text": [{"type": "keyword", "query": "WH-CH720N", "expect": ["Zqsony WH-CH720N"]},
                      {"type": "filtered", "query": "pan under $35", "expect": ["Zqacme Frying"], "check_rules": True},
                      {"type": "keyword", "query": "nothing", "expect": ["No Such Product Anywhere"]}],
             "text_to_image": [{"query": "red", "expect": ["Zqsony WH"]}]}
    path = tmp_path / "eval.json"
    path.write_text(json.dumps(cases))
    monkeypatch.setattr(evaluate, "EVAL_FILE", path)
    evaluate.run(image_samples=50)
    out = capsys.readouterr().out
    assert "skip  'nothing'" in out
    assert "hybrid   hit@5 1.00   MRR 1.00" in out
