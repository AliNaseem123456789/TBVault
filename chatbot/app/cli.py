"""
Command line tools. Run from the chatbot/ folder:

  python -m app.cli check                      test every connection (database, Pinecone, models, S3, Groq, RabbitMQ)
  python -m app.cli setup                      create the two Pinecone indexes
  python -m app.cli reindex [--no-images]      full rebuild from Postgres (also refits BM25)
  python -m app.cli sync 12 13                 re-index just these products
  python -m app.cli search "wireless earbuds under $100" [--alpha 0.5]
  python -m app.cli image-search path/to/photo.jpg
  python -m app.cli image-search --text "red running shoes"
  python -m app.cli chat "do you have a gift for a coffee lover?"
  python -m app.cli eval                       run the evaluation set (see eval/eval_set.json)
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
    from app import catalog, chat, config, embeddings, storage

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
        step(f"Groq ({config.LLM_MODEL})", lambda: chat._ask_llm("Reply with just: OK", [], "PRODUCTS: (none found)")[:60],
             "check GROQ_API_KEY and LLM_MODEL in chatbot/.env")
    else:
        print("  --    Groq: GROQ_API_KEY not set, answers will use a simple template")

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
        result = chat.answer(args.message)
        print(result["answer"] + "\n")
        _print_products(result)
        print(f"  (LLM used: {result['llm']})")
    elif args.command == "eval":
        from app import evaluate
        evaluate.run(image_samples=args.images)


if __name__ == "__main__":
    main()
