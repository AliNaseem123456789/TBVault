"""
`python -m app.cli stats [--days 7]` — a summary of real traffic from the request logs
(data/logs/chat-*.jsonl and feedback-*.jsonl), without Prometheus or Grafana.

  traffic     requests per intent, how they were routed (LLM vs rules), errors
  speed       median and 95th-percentile latency, per intent, and CPU time
  cost        tokens and US$ per request and in total, per purpose (route / answer / tools ...)
  retrieval   zero-result rate for searches
  answers     grounding check failures (invented prices), product citation rate
  customers   thumbs up / down per intent
"""
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from app import config

SEARCH_INTENTS = {"product_search", "product_comparison", "policy_question", "photo_search"}


def _read(kind, days):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = []
    for path in sorted(config.LOG_DIR.glob(f"{kind}-*.jsonl")) if config.LOG_DIR.exists() else []:
        if path.stem.split("-", 1)[1] < since:
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def _pct(values, q):
    if not values:
        return 0
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q * (len(values) - 1))))]


def summarize(days=7):
    chats = _read("chat", days)
    feedback = _read("feedback", days)
    if not chats:
        return None
    by_intent = defaultdict(list)
    for c in chats:
        by_intent[c["intent"]].append(c)
    searches = [c for c in chats if c["intent"] in SEARCH_INTENTS]
    checks = [chk for c in chats for chk in c.get("checks", [])]
    purposes = defaultdict(lambda: {"calls": 0, "tokens": 0})
    for c in chats:
        for purpose, used in (c.get("llm") or {}).get("by_purpose", {}).items():
            purposes[purpose]["calls"] += used["calls"]
            purposes[purpose]["tokens"] += used["tokens"]
    cost = sum((c.get("llm") or {}).get("cost_usd", 0) for c in chats)
    tokens = sum((c.get("llm") or {}).get("prompt_tokens", 0) + (c.get("llm") or {}).get("completion_tokens", 0) for c in chats)
    ratings = Counter((f.get("intent", "unknown"), f["rating"]) for f in feedback)
    return {
        "days": days,
        "requests": len(chats),
        "errors": sum(c["status"] != "ok" for c in chats),
        "routed_by": dict(Counter(c.get("routed_by", "?") for c in chats)),
        "latency_ms": {"p50": _pct([c["total_ms"] for c in chats], 0.5), "p95": _pct([c["total_ms"] for c in chats], 0.95)},
        "cpu_ms_avg": round(sum(c.get("cpu_ms", 0) for c in chats) / len(chats)),
        "tokens_total": tokens,
        "tokens_per_request": round(tokens / len(chats)),
        "cost_usd_total": round(cost, 4),
        "cost_usd_per_1000_requests": round(cost / len(chats) * 1000, 3),
        "by_purpose": dict(purposes),
        "zero_result_rate": round(sum(c.get("results", 0) == 0 for c in searches) / len(searches), 3) if searches else None,
        "bad_price_rate": round(sum(bool(k["unsupported_prices"]) for k in checks) / len(checks), 3) if checks else None,
        "citation_rate": (round(sum(k["products_cited"] > 0 for k in checks if k["products_shown"]) /
                                max(1, sum(1 for k in checks if k["products_shown"])), 3)),
        "intents": {intent: {"requests": len(rows), "p50_ms": _pct([r["total_ms"] for r in rows], 0.5),
                             "p95_ms": _pct([r["total_ms"] for r in rows], 0.95),
                             "thumbs_up": ratings.get((intent, "up"), 0), "thumbs_down": ratings.get((intent, "down"), 0)}
                    for intent, rows in sorted(by_intent.items(), key=lambda kv: -len(kv[1]))},
        "feedback": {"up": sum(f["rating"] == "up" for f in feedback), "down": sum(f["rating"] == "down" for f in feedback)},
    }


def print_summary(days=7):
    s = summarize(days)
    if not s:
        print(f"No chat logs in the last {days} days (they're written to {config.LOG_DIR}).")
        return
    print(f"Last {days} days: {s['requests']} requests, {s['errors']} errors, routed by {s['routed_by']}")
    print(f"Latency: p50 {s['latency_ms']['p50']} ms, p95 {s['latency_ms']['p95']} ms   CPU {s['cpu_ms_avg']} ms/request")
    print(f"LLM: {s['tokens_total']} tokens ({s['tokens_per_request']}/request), ${s['cost_usd_total']} total, "
          f"${s['cost_usd_per_1000_requests']} per 1000 requests")
    for purpose, used in s["by_purpose"].items():
        print(f"     {purpose:<8} {used['calls']} calls, {used['tokens']} tokens")
    print(f"Retrieval: zero-result rate {s['zero_result_rate']}   Answers: invented-price rate {s['bad_price_rate']}, "
          f"citation rate {s['citation_rate']}")
    print(f"Feedback: {s['feedback']['up']} up / {s['feedback']['down']} down")
    print(f"\n  {'intent':<22}{'requests':>9}{'p50 ms':>9}{'p95 ms':>9}{'up':>5}{'down':>6}")
    for intent, row in s["intents"].items():
        print(f"  {intent:<22}{row['requests']:>9}{row['p50_ms']:>9}{row['p95_ms']:>9}{row['thumbs_up']:>5}{row['thumbs_down']:>6}")
