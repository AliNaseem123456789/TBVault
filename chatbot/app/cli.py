"""
Command line tools. Run from the chatbot/ folder:

  python -m app.cli check                      test every connection (database, Pinecone, models, S3, Groq, RabbitMQ)
  python -m app.cli setup                      create the two Pinecone indexes
  python -m app.cli reindex [--no-images]      full rebuild: products from Postgres (refits BM25) + policies
  python -m app.cli index-policies             re-index only the policy files in knowledge/ (after editing them)
  python -m app.cli policy "how long do refunds take?"
  python -m app.cli route "only sony under 200"  show how a message is classified and rewritten
  python -m app.cli sync 12 13                 re-index just these products
  python -m app.cli search "wireless earbuds under $100" [--alpha 0.5]
  python -m app.cli image-search path/to/photo.jpg
  python -m app.cli image-search --text "red running shoes"
  python -m app.cli chat "do you have a gift for a coffee lover?"   (--token <access token> for order questions)
  python -m app.cli eval                       retrieval evaluation (see eval/eval_set.json), incl. reranking
  python -m app.cli eval-routing               intent classification evaluation (eval/routing_set.json)
"""
import argparse
import json
from pathlib import Path

from app import chat, indexer, query_parser, retrieval, vector_store


def _print_products(result):
    if not result["products"]:
        print("  (no results)")
    scores = {d["product_id"]: d["score"] for d in result.get("debug", [])}
    for n, p in enumerate(result["products"], 1):
        stock = "in stock" if p["in_stock"] else "OUT OF STOCK"
        brand = f" [{p['brand']['name']}]" if p["brand"] else ""
        print(f"  {n:>2}. #{p['id']} {p['name']}{brand} — ${p['lowest_price']} — {stock} — score {scores.get(p['id'], '-')}")
    if result.get("applied"):
        print(f"  filters: {result['applied']}")


def check():
    """Tries each outside service once and says what's wrong, in plain words."""
    from app import catalog, chat, config, embeddings, policies, reranker, storage

    def step(name, work, hint):
        try:
            print(f"  OK    {name}: {work()}")
        except Exception as err:
            print(f"  FAIL  {name}: {type(err).__name__}: {err}\n        -> {hint}")

    print("Checking connections:")
    step("Postgres", lambda: f"{len(catalog.public_product_ids())} public products",
         "check DATABASE_URL (and DB_SSL_CA_FILE for RDS) in backend/.env; is your IP allowed in the RDS security group?")
    step("MiniLM text model", lambda: f"{len(embeddings.embed_query('test'))} numbers per text",
         "first run downloads it from Hugging Face; check your internet connection")
    step("CLIP text model", lambda: f"{len(embeddings.clip_text('a red shoe'))} numbers per text",
         "first run downloads it from Hugging Face")
    step("CLIP image model",
         lambda: f"{len(embeddings.clip_images([embeddings.open_image(_tiny_png())])[0])} numbers per photo",
         "first run downloads it from Hugging Face")
    step("Pinecone", lambda: _pinecone_status(),
         "check PINECONE_API_KEY in chatbot/.env, then run: python -m app.cli setup")

    def first_photo():
        rows = catalog.get_products(catalog.public_product_ids()[:50])
        key = next((row["images"][0]["key"] for row in rows if row["images"]), None)
        if not key:
            return "no product photos yet (skipped)"
        return f"downloaded {key} ({len(storage.download(key)) // 1024} KB)"
    step("S3 photos", first_photo, "check S3_BUCKET / S3_REGION / S3 keys in backend/.env")

    if chat.llm_enabled():
        from app import llm
        for model in (config.LLM_MODEL, config.FAST_LLM_MODEL):
            step(f"Groq ({model})", lambda m=model: (llm.chat([{"role": "user", "content": "Reply with just: OK"}], model=m).content or "")[:40],
                 "check GROQ_API_KEY, LLM_MODEL and FAST_LLM_MODEL in chatbot/.env")
    else:
        print("  --    Groq: GROQ_API_KEY not set, answers will use simple rules and templates")
    step("Reranker model", lambda: f"score {reranker.score('lamp', ['Brass desk lamp'])[0]:.2f} for a test pair",
         "first run downloads it from Hugging Face")
    step("Policies index", lambda: f"{len(policies.search('how do returns work'))} sections found for a test question",
         "run: python -m app.cli index-policies")

    def rabbit():
        import pika
        pika.BlockingConnection(pika.URLParameters(config.RABBITMQ_URL)).close()
        return config.RABBITMQ_URL.split("@")[-1]
    step("RabbitMQ", rabbit, "start RabbitMQ, or skip it: the sync worker is only needed to auto-update the index")


def _tiny_png():
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (200, 40, 40)).save(buf, format="PNG")
    return buf.getvalue()


def _pinecone_status():
    from app import config
    parts = []
    for name, index in ((config.TEXT_INDEX_NAME, vector_store.text_index()), (config.IMAGE_INDEX_NAME, vector_store.image_index())):
        stats = index.describe_index_stats()
        parts.append(f"{name}: {stats.total_vector_count} vectors")
    return ", ".join(parts)


def main():
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    sub.add_parser("setup")
    sub.add_parser("index-policies")
    p = sub.add_parser("policy")
    p.add_argument("question")
    p = sub.add_parser("route")
    p.add_argument("message")
    sub.add_parser("eval-routing")
    p = sub.add_parser("reindex")
    p.add_argument("--no-images", action="store_true")
    p = sub.add_parser("sync")
    p.add_argument("product_ids", nargs="+", type=int)
    p = sub.add_parser("search")
    p.add_argument("query")
    p.add_argument("--alpha", type=float)
    p.add_argument("--limit", type=int, default=8)
    p = sub.add_parser("image-search")
    p.add_argument("path", nargs="?")
    p.add_argument("--text")
    p = sub.add_parser("chat")
    p.add_argument("message")
    p.add_argument("--token", help="a customer's access token, to try order questions")
    p = sub.add_parser("eval")
    p.add_argument("--images", type=int, default=25, help="how many products to test photo search with")
    args = parser.parse_args()

    if args.command == "check":
        check()
    elif args.command == "setup":
        created = vector_store.create_indexes()
        print("created: " + (", ".join(created) if created else "nothing (both indexes already exist)"))
    elif args.command == "reindex":
        print(json.dumps(indexer.rebuild(with_images=not args.no_images), indent=2))
        from app import policies
        print("policies:", json.dumps(policies.index_policies()))
    elif args.command == "index-policies":
        from app import policies
        print(json.dumps(policies.index_policies(), indent=2))
    elif args.command == "policy":
        from app import policies
        for s in policies.search(args.question):
            print(f"\n[{s['score']}] {s['title']} > {s['section']}\n{s['text']}")
    elif args.command == "route":
        from app import router
        result, how = router.route(args.message)
        print(f"by {how}: {result.intent}")
        print(json.dumps([t.model_dump(exclude_defaults=True) for t in result.tasks], indent=2))
    elif args.command == "eval-routing":
        from app import evaluate
        evaluate.run_routing()
    elif args.command == "sync":
        print(json.dumps(indexer.sync_products(args.product_ids), indent=2))
    elif args.command == "search":
        text, filters = query_parser.parse(args.query)
        print(f'searching "{text}"')
        _print_products(retrieval.search_products(text, filters, args.limit, args.alpha))
    elif args.command == "image-search":
        if args.text:
            _print_products(retrieval.search_images_by_text(args.text))
        else:
            _print_products(retrieval.search_by_image(Path(args.path).read_bytes()))
    elif args.command == "chat":
        result = chat.answer(args.message, user_token=args.token)
        print(f"[{result['intent']}]\n{result['answer']}\n")
        if result["products"]:
            _print_products(result)
        for o in result["orders"]:
            print(f"  order #{o['order_id']}: {o['status']} {o.get('total') or ''}")
        for src in result["sources"]:
            print(f"  source: {src['title']} > {src['section']}")
        if result["action"]:
            print(f"  [button] {result['action']['label']}")
        print(f"  steps: {[(s['step'], s['ms']) for s in result['debug']['steps']]}")
    elif args.command == "eval":
        from app import evaluate
        evaluate.run(image_samples=args.images)


if __name__ == "__main__":
    main()
