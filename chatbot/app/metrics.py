"""
Phase 3: measuring the chatbot.

Three ways to look at the numbers:
  1. Prometheus  GET /metrics  -> scraped every 5 s by the Prometheus you already run
                 (backend/docker-compose.monitoring.yml) and drawn by Grafana.
  2. Logs        one JSON line per chat in data/logs/chat-YYYY-MM-DD.jsonl
                 -> `python -m app.cli stats` summarises them (no Prometheus needed).
  3. Evaluations `python -m app.cli eval*` -> quality on fixed test sets, saved in data/eval_reports/.

What is measured (all names start with chatbot_):
  traffic      requests by intent / how they were routed / ok or error
  speed        whole-request latency, latency of every stage (route, search, rerank, answer...)
  CPU / memory CPU seconds per request, process CPU %, memory, machine CPU/memory
  LLM          calls, tokens (prompt / completion / reasoning / cached), seconds and US$ cost,
               per model and per purpose (route, plan, answer, tools, judge)
  retrieval    how many results, zero-result rate, top scores, whether the reranker changed #1,
               guessed filters dropped
  reliability  fallbacks (LLM failed -> rules/templates), tool outcomes, JSON retries
  answers      grounding checks (prices not in the facts), customer thumbs up/down

Cost = tokens x price per million (LLM_PRICES below; check console.groq.com for current prices).
"""
import contextvars
import json
import logging
import os
import re
import time
from datetime import datetime, timezone

import psutil
from prometheus_client import CollectorRegistry, Counter, Histogram, disable_created_metrics, generate_latest
from prometheus_client.core import GaugeMetricFamily

from app import config

log = logging.getLogger("metrics")

disable_created_metrics()   # skip the extra *_created series; they only clutter the dashboard

# A private registry: only our metrics (+ the process collector below), easy to reset in tests.
REGISTRY = CollectorRegistry()

LATENCY_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 13, 20, 30)
STAGE_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10)

REQUESTS = Counter("chatbot_requests_total", "Chat requests", ["intent", "routed_by", "status"], registry=REGISTRY)
REQUEST_SECONDS = Histogram("chatbot_request_seconds", "Whole chat request time", ["intent"],
                            buckets=LATENCY_BUCKETS, registry=REGISTRY)
REQUEST_CPU = Histogram("chatbot_request_cpu_seconds", "CPU time used while answering (process-wide, so "
                        "approximate when requests overlap)", ["intent"], buckets=STAGE_BUCKETS, registry=REGISTRY)
STAGE_SECONDS = Histogram("chatbot_stage_seconds", "Time per pipeline stage", ["stage"],
                          buckets=STAGE_BUCKETS, registry=REGISTRY)

LLM_CALLS = Counter("chatbot_llm_calls_total", "LLM calls", ["model", "purpose", "status"], registry=REGISTRY)
LLM_TOKENS = Counter("chatbot_llm_tokens_total", "LLM tokens", ["model", "purpose", "type"], registry=REGISTRY)
LLM_COST = Counter("chatbot_llm_cost_usd_total", "Estimated LLM cost in US dollars", ["model", "purpose"], registry=REGISTRY)
LLM_SECONDS = Histogram("chatbot_llm_seconds", "LLM call time", ["model", "purpose"],
                        buckets=STAGE_BUCKETS + (20, 30), registry=REGISTRY)

RESULTS = Histogram("chatbot_results_returned", "Products/sections returned per answer", ["intent"],
                    buckets=(0, 1, 2, 3, 5, 8, 13, 20), registry=REGISTRY)
ZERO_RESULTS = Counter("chatbot_zero_results_total", "Searches that found nothing", ["intent"], registry=REGISTRY)
TOP_SCORE = Histogram("chatbot_top_score", "Best score of a search (scales differ per kind)", ["kind"],
                      buckets=(-10, -5, -2, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, 5, 10),
                      registry=REGISTRY)
RERANKS = Counter("chatbot_rerank_total", "Reranker runs, and whether it changed the #1 result",
                  ["changed_top"], registry=REGISTRY)
FALLBACKS = Counter("chatbot_fallbacks_total", "Times a simpler path was used because something failed",
                    ["kind"], registry=REGISTRY)
TOOL_CALLS = Counter("chatbot_tool_calls_total", "Order tool calls", ["tool", "outcome"], registry=REGISTRY)
ANSWER_CHECKS = Counter("chatbot_answer_checks_total", "Automatic checks on answers", ["check", "result"],
                        registry=REGISTRY)
FEEDBACK = Counter("chatbot_feedback_total", "Customer thumbs up/down", ["intent", "rating"], registry=REGISTRY)


class _ProcessCollector:
    """CPU and memory, read at scrape time with psutil (works on Windows and Linux)."""

    def __init__(self):
        self.process = psutil.Process(os.getpid())
        self.process.cpu_percent(None)   # first call primes the counter

    def collect(self):
        with self.process.oneshot():
            cpu = self.process.cpu_percent(None)
            memory = self.process.memory_info().rss
            threads = self.process.num_threads()
        yield GaugeMetricFamily("chatbot_process_cpu_percent", "CPU % of the chatbot process (100 = one core)", value=cpu)
        yield GaugeMetricFamily("chatbot_process_memory_bytes", "Memory (RSS) of the chatbot process", value=memory)
        yield GaugeMetricFamily("chatbot_process_threads", "Threads in the chatbot process", value=threads)
        yield GaugeMetricFamily("chatbot_machine_cpu_percent", "CPU % of the whole machine", value=psutil.cpu_percent(None))
        yield GaugeMetricFamily("chatbot_machine_memory_percent", "Memory % used on the whole machine",
                                value=psutil.virtual_memory().percent)


REGISTRY.register(_ProcessCollector())


def exposition():
    """Text for GET /metrics."""
    return generate_latest(REGISTRY)


# ----------------------------------------------------------------------------
# LLM usage and cost
# ----------------------------------------------------------------------------
def _prices():
    """{model: (input $/1M, output $/1M)}. Defaults = Groq launch prices; override with LLM_PRICES, e.g.
    LLM_PRICES='{"openai/gpt-oss-120b": [0.15, 0.75], "openai/gpt-oss-20b": [0.10, 0.50]}'"""
    prices = {"openai/gpt-oss-120b": (0.15, 0.75), "openai/gpt-oss-20b": (0.10, 0.50)}
    try:
        prices.update({k: tuple(v) for k, v in json.loads(os.getenv("LLM_PRICES") or "{}").items()})
    except (ValueError, TypeError):
        log.warning("LLM_PRICES is not valid JSON; using defaults")
    return prices


PRICES = _prices()


def cost_usd(model, prompt_tokens, completion_tokens):
    price_in, price_out = PRICES.get(model, (0.0, 0.0))
    return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000


# Usage of the request being answered right now (each request runs in its own thread/context).
_current = contextvars.ContextVar("chatbot_request_usage", default=None)


def start_request():
    usage = {"llm_calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0,
             "cost_usd": 0.0, "llm_seconds": 0.0, "by_purpose": {}}
    _current.set(usage)
    return usage


def record_llm(model, purpose, seconds, usage=None, status="ok"):
    """Called by llm.py after every Groq call. usage = the response's .usage object (or None)."""
    LLM_CALLS.labels(model, purpose, status).inc()
    LLM_SECONDS.labels(model, purpose).observe(seconds)
    prompt = completion = reasoning = cached = 0
    if usage is not None:
        prompt = getattr(usage, "prompt_tokens", 0) or 0
        completion = getattr(usage, "completion_tokens", 0) or 0
        details = getattr(usage, "completion_tokens_details", None)
        reasoning = (getattr(details, "reasoning_tokens", 0) or 0) if details else 0
        prompt_details = getattr(usage, "prompt_tokens_details", None)
        cached = (getattr(prompt_details, "cached_tokens", 0) or 0) if prompt_details else 0
        for kind, n in (("prompt", prompt), ("completion", completion), ("reasoning", reasoning), ("cached", cached)):
            if n:
                LLM_TOKENS.labels(model, purpose, kind).inc(n)
    dollars = cost_usd(model, prompt, completion)
    if dollars:
        LLM_COST.labels(model, purpose).inc(dollars)
    current = _current.get()
    if current is not None:
        current["llm_calls"] += 1
        current["prompt_tokens"] += prompt
        current["completion_tokens"] += completion
        current["reasoning_tokens"] += reasoning
        current["cost_usd"] += dollars
        current["llm_seconds"] += seconds
        mine = current["by_purpose"].setdefault(purpose, {"calls": 0, "tokens": 0})
        mine["calls"] += 1
        mine["tokens"] += prompt + completion


# ----------------------------------------------------------------------------
# the per-request log file
# ----------------------------------------------------------------------------
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_LONG_NUMBER = re.compile(r"\b\d[\d -]{8,}\d\b")   # phone/card-like numbers; order ids (short) are kept


def redact(text):
    """Customers sometimes type emails or phone numbers; keep them out of the logs."""
    return _LONG_NUMBER.sub("[number]", _EMAIL.sub("[email]", text)) if isinstance(text, str) else text


def write_log(record, kind="chat"):
    """Appends one JSON line to data/logs/{kind}-YYYY-MM-DD.jsonl. Never raises."""
    if not config.REQUEST_LOG:
        return
    try:
        folder = config.LOG_DIR
        folder.mkdir(parents=True, exist_ok=True)
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with open(folder / f"{kind}-{day}.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, default=str) + "\n")
    except OSError as err:
        log.warning("could not write the %s log: %s", kind, err)


class Timer:
    """with Timer("search"): ...   -> chatbot_stage_seconds{stage="search"}"""

    def __init__(self, stage):
        self.stage = stage

    def __enter__(self):
        self.started = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.seconds = time.perf_counter() - self.started
        STAGE_SECONDS.labels(self.stage).observe(self.seconds)
        return False
