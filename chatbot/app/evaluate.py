"""
Retrieval evaluation: are the right products coming back, and near the top?

Each case in eval/eval_set.json names products we expect (by part of their name).
Cases whose products aren't in your database are skipped, so the file works
with any catalog — add your own cases as the catalog grows.

Metrics (higher is better, 1.0 is perfect):
  hit@5   share of queries where an expected product is in the top 5
  MRR     mean reciprocal rank: 1 if the expected product is first, 1/2 if second, ...
          (0 if not in the top 10)
  rules   for price/stock cases: share of returned products that really obey the rule

Text cases run three ways so you can SEE what hybrid search buys you:
  dense   (alpha=1)  meaning only — good at paraphrases
  sparse  (alpha=0)  keywords only — good at model numbers
  hybrid  (alpha=HYBRID_ALPHA)
Try different HYBRID_ALPHA values in .env and compare.

Photo search is tested by "self-retrieval": each product's own main photo is used as
the query and should find that product first.
"""
import json
import random

from app import catalog, config, db, query_parser, retrieval, storage

EVAL_FILE = config.CHATBOT_DIR / "eval" / "eval_set.json"


def _expected_ids(names):
    ids = set()
    for name in names:
        rows = db.query("SELECT p.id FROM products p JOIN sellers s ON s.id = p.seller_id "
                        "WHERE p.name ILIKE %s AND NOT p.is_hidden AND s.status = 'APPROVED'", (f"%{name}%",))
        ids.update(row["id"] for row in rows)
    return ids


def _rank(products, expected):
    for n, p in enumerate(products, 1):
        if p["id"] in expected:
            return n
    return None


def _rules_ok(products, filters):
    if not products:
        return None
    ok = 0
    for p in products:
        price = float(p["lowest_price"])
        good = ((filters.max_price is None or price <= filters.max_price)
                and (filters.min_price is None or price >= filters.min_price)
                and (not filters.in_stock or p["in_stock"])
                and (not filters.on_sale or p["sale_percent"]))
        ok += bool(good)
    return ok / len(products)


def _summary(label, ranks, rules=None):
    n = len(ranks)
    if not n:
        return f"{label:<8} (no cases)"
    hit5 = sum(1 for r in ranks if r and r <= 5) / n
    mrr = sum(1 / r for r in ranks if r) / n
    line = f"{label:<8} hit@5 {hit5:.2f}   MRR {mrr:.2f}   ({n} cases)"
    if rules:
        line += f"   rules {sum(rules) / len(rules):.2f}"
    return line


def run(image_samples=25):
    cases = json.loads(EVAL_FILE.read_text())
    modes = {"dense": 1.0, "sparse": 0.0, "hybrid": config.HYBRID_ALPHA}

    print("\n=== Text search ===")
    by_type = {}
    for case in cases["text"]:
        expected = _expected_ids(case["expect"])
        if not expected:
            print(f"  skip  {case['query']!r} (no matching products in your catalog)")
            continue
        text, filters = query_parser.parse(case["query"])
        line = f"  [{case['type']:<10}] {case['query'][:45]:<45}"
        for mode, alpha in modes.items():
            result = retrieval.search_products(text, filters, limit=10, alpha=alpha)
            rank = _rank(result["products"], expected)
            stats = by_type.setdefault(case["type"], {}).setdefault(mode, {"ranks": [], "rules": []})
            stats["ranks"].append(rank)
            rules = _rules_ok(result["products"], filters)
            if rules is not None and case.get("check_rules"):
                stats["rules"].append(rules)
            line += f"  {mode} {rank or '-':>2}"
        print(line)

    print("\nBy query type (rank shown above is where the first expected product came; '-' = not in top 10):")
    for kind, per_mode in by_type.items():
        print(f"  {kind}")
        for mode in modes:
            if mode in per_mode:
                print("    " + _summary(mode, per_mode[mode]["ranks"], per_mode[mode]["rules"]))
    print("  all types")
    for mode in modes:
        ranks = [r for per_mode in by_type.values() for r in per_mode.get(mode, {}).get("ranks", [])]
        print("    " + _summary(mode, ranks))

    print("\n=== Text -> photo search (CLIP text encoder) ===")
    ranks = []
    for case in cases.get("text_to_image", []):
        expected = _expected_ids(case["expect"])
        if not expected:
            print(f"  skip  {case['query']!r}")
            continue
        rank = _rank(retrieval.search_images_by_text(case["query"], limit=10)["products"], expected)
        ranks.append(rank)
        print(f"  {case['query'][:50]:<50} rank {rank or '-'}")
    print("  " + _summary("clip", ranks))

    print(f"\n=== Photo -> photo search (each product's own main photo, {image_samples} products) ===")
    rows = [row for row in catalog.get_products(catalog.public_product_ids()) if row["images"]]
    random.Random(42).shuffle(rows)            # same sample every run, so results are comparable
    ranks = []
    for row in rows[:image_samples]:
        try:
            data = storage.download(row["images"][0]["key"])
        except Exception as err:
            print(f"  skip #{row['id']} (photo download failed: {err})")
            continue
        rank = _rank(retrieval.search_by_image(data, limit=10)["products"], {row["id"]})
        ranks.append(rank)
    print("  " + _summary("clip", ranks))
