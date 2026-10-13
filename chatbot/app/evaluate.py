"""
Offline evaluation: fixed test sets, repeatable numbers. Every run is saved to
data/eval_reports/ so you can compare before/after a change (`python -m app.cli eval-history`).

  eval          retrieval quality   (eval/eval_set.json)
  eval-routing  intent + rewriting  (eval/routing_set.json)
  eval-answers  answer quality      (eval/answer_set.json), graded by an LLM judge

RETRIEVAL metrics (higher is better, 1.0 is perfect):
  hit@5     share of queries with an expected product in the top 5
  MRR       mean reciprocal rank: 1 if the first expected product is #1, 1/2 if #2 ... (0 if not in top 10)
  nDCG@10   like MRR but rewards ALL relevant products being high, not just the first
  P@5       precision: share of the top 5 that are relevant (matters for "show me laptops")
  rules     for price/stock cases: share of returned products that really obey the rule
  ms        average search time — what each stage costs
Text cases run four ways so you can SEE what each stage buys you:
  dense (meaning only), sparse (keywords only), hybrid, +rerank (hybrid then cross-encoder).
Photo search is tested by "self-retrieval": each product's own main photo should find that product.

ANSWER metrics (eval-answers):
  faithfulness   judge: are all claims supported by the facts the bot was given? (RAGAS-style, 0-1)
  relevance      judge: does it actually answer the question? (0-1)
  must_mention   share of required facts present (deterministic)
  intent         share routed to the expected intent
  bad_prices     share of answers containing a price that isn't in the facts
  latency, tokens and US$ per answer
The judge is another LLM (JUDGE_MODEL), so treat its scores as a trend, not as truth.
"""
import json
import math
import random
import statistics
import time
from datetime import datetime

from pydantic import BaseModel, Field

from app import catalog, config, db, llm, metrics, query_parser, retrieval, storage

EVAL_FILE = config.CHATBOT_DIR / "eval" / "eval_set.json"
ROUTING_FILE = config.CHATBOT_DIR / "eval" / "routing_set.json"
ANSWER_FILE = config.CHATBOT_DIR / "eval" / "answer_set.json"


# ----------------------------------------------------------------------------
# metric formulas
# ----------------------------------------------------------------------------
def first_rank(ids, relevant, k=10):
    for n, pid in enumerate(ids[:k], 1):
        if pid in relevant:
            return n
    return None


def ndcg(ids, relevant, k=10):
    """Binary relevance: gain 1 for a relevant item at position i, discounted by log2(i+1)."""
    dcg = sum(1 / math.log2(i + 2) for i, pid in enumerate(ids[:k]) if pid in relevant)
    ideal = sum(1 / math.log2(i + 2) for i in range(min(len(relevant), k)))
    return dcg / ideal if ideal else 0.0


def precision(ids, relevant, k=5):
    top = ids[:k]
    return sum(1 for pid in top if pid in relevant) / len(top) if top else 0.0


def summarize(cases):
    """cases: [{"ids": [...], "relevant": set, "ms": float, "rules": float|None}] -> headline numbers."""
    n = len(cases)
    if not n:
        return {"cases": 0}
    ranks = [first_rank(c["ids"], c["relevant"]) for c in cases]
    out = {
        "cases": n,
        "hit@5": sum(1 for r in ranks if r and r <= 5) / n,
        "MRR": sum(1 / r for r in ranks if r) / n,
        "nDCG@10": sum(ndcg(c["ids"], c["relevant"]) for c in cases) / n,
        "P@5": sum(precision(c["ids"], c["relevant"]) for c in cases) / n,
        "ms": statistics.mean(c["ms"] for c in cases),
    }
    rules = [c["rules"] for c in cases if c.get("rules") is not None]
    if rules:
        out["rules"] = sum(rules) / len(rules)
    return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in out.items()}


def _line(label, s):
    if not s.get("cases"):
        return f"{label:<8} (no cases)"
    text = (f"{label:<8} hit@5 {s['hit@5']:.2f}  MRR {s['MRR']:.2f}  nDCG@10 {s['nDCG@10']:.2f}  "
            f"P@5 {s['P@5']:.2f}  {s['ms']:6.0f} ms  ({s['cases']} cases)")
    if "rules" in s:
        text += f"  rules {s['rules']:.2f}"
    return text


def save_report(kind, summary):
    config.EVAL_REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = config.EVAL_REPORT_DIR / f"{kind}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    summary = {"kind": kind, "at": datetime.now().isoformat(timespec="seconds"),
               "settings": {"HYBRID_ALPHA": config.HYBRID_ALPHA, "RERANK": config.RERANK,
                            "RERANK_CANDIDATES": config.RERANK_CANDIDATES, "MIN_SCORE_RATIO": config.MIN_SCORE_RATIO,
                            "LLM_MODEL": config.LLM_MODEL, "FAST_LLM_MODEL": config.FAST_LLM_MODEL,
                            "INDEX_VERSION": config.INDEX_VERSION},
               **summary}
    path.write_text(json.dumps(summary, indent=2, default=str))
    print(f"\nSaved: {path}")
    return path


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def _expected_ids(names):
    ids = set()
    for name in names:
        rows = db.query("SELECT p.id FROM products p JOIN sellers s ON s.id = p.seller_id "
                        "WHERE p.name ILIKE %s AND NOT p.is_hidden AND s.status = 'APPROVED'", (f"%{name}%",))
        ids.update(row["id"] for row in rows)
    return ids


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


def _timed(fn):
    started = time.perf_counter()
    result = fn()
    return result, (time.perf_counter() - started) * 1000


# ----------------------------------------------------------------------------
# retrieval
# ----------------------------------------------------------------------------
def run(image_samples=25):
    cases = json.loads(EVAL_FILE.read_text())
    modes = {"dense": (1.0, False), "sparse": (0.0, False), "hybrid": (config.HYBRID_ALPHA, False),
             "+rerank": (config.HYBRID_ALPHA, True)}

    print("\n=== Text search === (rank of the first expected product per mode; '-' = not in top 10)")
    results = {}   # type -> mode -> [case results]
    for case in cases["text"]:
        relevant = _expected_ids(case["expect"])
        if not relevant:
            print(f"  skip  {case['query']!r} (no matching products in your catalog)")
            continue
        text, filters = query_parser.parse(case["query"])
        line = f"  [{case['type']:<10}] {case['query'][:42]:<42}"
        for mode, (alpha, rerank) in modes.items():
            found, ms = _timed(lambda: retrieval.search_products(text, filters, limit=10, alpha=alpha, rerank=rerank))
            ids = [p["id"] for p in found["products"]]
            rules = _rules_ok(found["products"], filters) if case.get("check_rules") else None
            results.setdefault(case["type"], {}).setdefault(mode, []).append(
                {"ids": ids, "relevant": relevant, "ms": ms, "rules": rules})
            line += f"  {mode} {first_rank(ids, relevant) or '-':>2}"
        print(line)

    report = {"text": {}, "text_to_image": None, "image": None}
    print("\nBy query type:")
    for kind, per_mode in results.items():
        print(f"  {kind}")
        report["text"][kind] = {}
        for mode in modes:
            summary = summarize(per_mode.get(mode, []))
            report["text"][kind][mode] = summary
            print("    " + _line(mode, summary))
    print("  all types")
    report["text"]["all"] = {}
    for mode in modes:
        summary = summarize([c for per_mode in results.values() for c in per_mode.get(mode, [])])
        report["text"]["all"][mode] = summary
        print("    " + _line(mode, summary))

    print("\n=== Text -> photo search (CLIP text encoder) ===")
    clip_cases = []
    for case in cases.get("text_to_image", []):
        relevant = _expected_ids(case["expect"])
        if not relevant:
            print(f"  skip  {case['query']!r}")
            continue
        found, ms = _timed(lambda: retrieval.search_images_by_text(case["query"], limit=10))
        ids = [p["id"] for p in found["products"]]
        clip_cases.append({"ids": ids, "relevant": relevant, "ms": ms})
        print(f"  {case['query'][:50]:<50} rank {first_rank(ids, relevant) or '-'}")
    report["text_to_image"] = summarize(clip_cases)
    print("  " + _line("clip", report["text_to_image"]))

    print(f"\n=== Photo -> photo search (each product's own main photo, {image_samples} products) ===")
    rows = [row for row in catalog.get_products(catalog.public_product_ids()) if row["images"]]
    random.Random(42).shuffle(rows)            # same sample every run, so results are comparable
    photo_cases = []
    for row in rows[:image_samples]:
        try:
            data = storage.download(row["images"][0]["key"])
        except Exception as err:
            print(f"  skip #{row['id']} (photo download failed: {err})")
            continue
        found, ms = _timed(lambda: retrieval.search_by_image(data, limit=10))
        photo_cases.append({"ids": [p["id"] for p in found["products"]], "relevant": {row["id"]}, "ms": ms})
    report["image"] = summarize(photo_cases)
    print("  " + _line("clip", report["image"]))
    save_report("retrieval", report)
    return report


# ----------------------------------------------------------------------------
# routing
# ----------------------------------------------------------------------------
def run_routing():
    """Intent accuracy + rewriting checks. Uses the real router (LLM if GROQ_API_KEY is set)."""
    from app import router
    cases = json.loads(ROUTING_FILE.read_text())["cases"]
    correct, wrong, by_intent, times = 0, [], {}, []
    usage = metrics.start_request()   # collects the router's tokens/cost for the whole run
    for case in cases:
        (route, how), ms = _timed(lambda: router.route(case["message"], case.get("history"), case.get("previous")))
        times.append(ms)
        got = sorted(t.intent for t in route.tasks)
        want = sorted(case["intents"])
        ok = got == want
        checks = []
        task = route.tasks[0]
        for key, value in (case.get("expect") or {}).items():
            actual = getattr(task.filters, key, None) if key in router.SearchFilters.model_fields else getattr(task, key, None)
            if isinstance(value, str) and isinstance(actual, str):
                good = value.lower() in actual.lower()
            else:
                good = actual == value
            checks.append(good)
            if not good:
                wrong.append(f"{case['message']!r}: {key} = {actual!r}, expected {value!r}")
        ok = ok and all(checks)
        correct += ok
        stats = by_intent.setdefault("+".join(want), [0, 0])
        stats[0] += ok
        stats[1] += 1
        print(f"  {'ok ' if ok else 'BAD'} [{how:<5}] {case['message'][:55]:<55} -> {'+'.join(got)}  ({ms:.0f} ms)")
        if got != want:
            wrong.append(f"{case['message']!r}: got {got}, expected {want}")
    accuracy = correct / max(1, len(cases))
    print(f"\nRouting accuracy: {correct}/{len(cases)} = {accuracy:.2f}   "
          f"median {statistics.median(times):.0f} ms, {usage['prompt_tokens'] + usage['completion_tokens']} tokens, "
          f"${usage['cost_usd']:.4f}")
    for intent, (good, total) in sorted(by_intent.items()):
        print(f"  {intent:<40} {good}/{total}")
    if wrong:
        print("\nMistakes:\n" + "\n".join(f"  {w}" for w in wrong))
    report = {"accuracy": round(accuracy, 3), "cases": len(cases), "median_ms": round(statistics.median(times)),
              "tokens": usage["prompt_tokens"] + usage["completion_tokens"], "cost_usd": round(usage["cost_usd"], 5),
              "by_intent": {k: f"{g}/{t}" for k, (g, t) in by_intent.items()}, "mistakes": wrong}
    save_report("routing", report)
    return report


# ----------------------------------------------------------------------------
# answers (LLM as judge)
# ----------------------------------------------------------------------------
class Judgement(BaseModel, extra="forbid"):
    faithfulness: int = Field(ge=1, le=5)
    relevance: int = Field(ge=1, le=5)
    unsupported_claims: list[str] = Field(default_factory=list, max_length=10)
    reason: str = Field(default="", max_length=400)


JUDGE_SYSTEM = """You grade a shopping assistant's answer. Reply with JSON only:
{"faithfulness": 1-5, "relevance": 1-5, "unsupported_claims": ["..."], "reason": "one sentence"}
faithfulness: 5 = every factual claim (products, prices, stock, numbers, policy rules) is supported by FACTS;
              1 = several claims are invented or contradict FACTS. Polite filler and "I couldn't find" are fine.
relevance:    5 = directly and fully answers the QUESTION; 1 = ignores it.
List each claim not supported by FACTS in unsupported_claims (empty list if none)."""


def _judge(question, answer, contexts):
    facts = "\n\n".join(contexts) or "(no facts were given to the assistant)"
    return llm.ask_json(JUDGE_SYSTEM, f"FACTS:\n{facts[:6000]}\n\nQUESTION: {question}\n\nANSWER: {answer}",
                        Judgement, model=config.JUDGE_MODEL, purpose="judge")


def _mentions(answer, wanted):
    """'a|b' means either is fine."""
    lowered = answer.lower()
    return [w for w in wanted if not any(alt.lower() in lowered for alt in w.split("|"))]


def run_answers(token=None):
    from app import chat
    if not llm.enabled():
        print("eval-answers needs GROQ_API_KEY (the answers and the judge are LLM calls).")
        return None
    cases = json.loads(ANSWER_FILE.read_text())["cases"]
    rows = []
    for case in cases:
        if case.get("requires_products") and not _expected_ids(case["requires_products"]):
            print(f"  skip  {case['question']!r} (products not in your catalog)")
            continue
        if case.get("needs_login") and not token:
            print(f"  skip  {case['question']!r} (needs --token)")
            continue
        (result, ms) = _timed(lambda: chat.answer(case["question"], case.get("history"), user_token=token))
        debug = result["debug"]
        missing = _mentions(result["answer"], case.get("must_mention", []))
        forbidden = [w for w in case.get("must_not_mention", []) if w.lower() in result["answer"].lower()]
        judged = None
        if case.get("judge", True):
            try:
                judged = _judge(case["question"], result["answer"], debug.get("contexts", []))
            except llm.LLMError as err:
                print(f"  judge failed: {err}")
        bad_prices = any(c["unsupported_prices"] for c in debug.get("checks", []))
        row = {
            "question": case["question"], "intent": result["intent"], "intent_ok": result["intent"] == case.get("intent", result["intent"]),
            "mention_rate": 1 - len(missing) / max(1, len(case.get("must_mention", []))) if case.get("must_mention") else None,
            "missing": missing, "forbidden": forbidden, "bad_prices": bad_prices,
            "faithfulness": (judged.faithfulness - 1) / 4 if judged else None,
            "relevance": (judged.relevance - 1) / 4 if judged else None,
            "unsupported_claims": judged.unsupported_claims if judged else [],
            "ms": round(ms), "tokens": debug["llm"]["prompt_tokens"] + debug["llm"]["completion_tokens"],
            "cost_usd": debug["llm"]["cost_usd"], "answer": result["answer"][:300],
        }
        rows.append(row)
        flag = "ok " if row["intent_ok"] and not missing and not forbidden and not bad_prices and (
            row["faithfulness"] is None or row["faithfulness"] >= 0.75) else "BAD"
        print(f"  {flag} {case['question'][:50]:<50} faith {row['faithfulness'] if row['faithfulness'] is not None else '-'}"
              f"  rel {row['relevance'] if row['relevance'] is not None else '-'}  {row['ms']} ms  {row['tokens']} tok")
        for claim in row["unsupported_claims"]:
            print(f"        unsupported: {claim}")
        if missing:
            print(f"        missing: {missing}")

    def avg(key):
        values = [r[key] for r in rows if r[key] is not None]
        return round(sum(values) / len(values), 3) if values else None

    latencies = sorted(r["ms"] for r in rows)
    summary = {
        "cases": len(rows), "faithfulness": avg("faithfulness"), "relevance": avg("relevance"),
        "must_mention": avg("mention_rate"),
        "intent": round(sum(r["intent_ok"] for r in rows) / max(1, len(rows)), 3),
        "bad_prices": round(sum(r["bad_prices"] for r in rows) / max(1, len(rows)), 3),
        "median_ms": latencies[len(latencies) // 2] if latencies else None,
        "p95_ms": latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))] if latencies else None,
        "avg_tokens": avg("tokens"), "avg_cost_usd": round(sum(r["cost_usd"] for r in rows) / max(1, len(rows)), 6),
    }
    print("\nAnswer quality: " + "  ".join(f"{k} {v}" for k, v in summary.items()))
    save_report("answers", {**summary, "rows": rows})
    return summary


# ----------------------------------------------------------------------------
# history
# ----------------------------------------------------------------------------
HEADLINES = {
    "retrieval": lambda r: {m: r["text"]["all"][m].get("nDCG@10") for m in r["text"].get("all", {})} | {
        "photo hit@5": (r.get("image") or {}).get("hit@5")},
    "routing": lambda r: {"accuracy": r["accuracy"], "median_ms": r["median_ms"], "cost_usd": r["cost_usd"]},
    "answers": lambda r: {k: r[k] for k in ("faithfulness", "relevance", "must_mention", "bad_prices", "median_ms", "avg_cost_usd")},
}


def history(limit=10):
    """Headline numbers of the last saved runs, oldest first, so trends are visible."""
    files = sorted(config.EVAL_REPORT_DIR.glob("*.json"), key=lambda p: p.stem.split("-", 1)[1]) if config.EVAL_REPORT_DIR.exists() else []
    files = files[-limit * 3:]
    if not files:
        print("No saved evaluation runs yet. Run: python -m app.cli eval / eval-routing / eval-answers")
        return
    for path in files:
        report = json.loads(path.read_text())
        try:
            numbers = HEADLINES[report["kind"]](report)
        except (KeyError, TypeError):
            continue
        shown = "  ".join(f"{k} {v}" for k, v in numbers.items())
        print(f"  {report['at']}  {report['kind']:<9}  {shown}")
