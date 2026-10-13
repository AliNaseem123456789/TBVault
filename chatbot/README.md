# TBVault shopping assistant

A Python service that finds products by **meaning**, by **keywords** and by **photo**, answers
questions about store **policies**, and looks up or cancels the customer's **orders**, with an
LLM that may only use what was retrieved or what a tool returned.

- **Phase 1:** hybrid + photo retrieval (products).
- **Phase 2:** intent routing, query rewriting, planning, reranking, policies (parent-child),
  order tools.
- **Phase 3:** metrics: latency, CPU, memory, tokens and cost, retrieval and answer
  quality, feedback, a Grafana dashboard, offline evaluations.

```
message ─► router ──┬─ greeting / small talk / out of scope ─► short reply (no search)
 (rules, then       ├─ product_search ─► hybrid search ─► rerank ─► LLM
  gpt-oss-20b JSON) ├─ product_comparison ─► lookups (planner if complex) ─► LLM
                    ├─ policy_question ─► policy chunks ─► parent sections ─► LLM
                    └─ order_tracking / order_cancellation ─► LLM picks tools ─► app runs them
                       as the customer via the Node API ─► LLM (cancel = confirm button)
```

```
            ┌──────────────┐   /api/chat, /api/search/...   ┌──────────────────┐
 browser ──►│ Node backend │ ──────────────────────────────►│ chatbot (FastAPI)│
 (widget,   │ login, rate  │◄────────────────────────────── │ :8000            │
  /chat)    │ limits       │                                └──┬───────┬───────┘
            └──────┬───────┘                                   │       │
                   │ catalog.changed (RabbitMQ)                 │       │ ids ──► prices, stock,
                   ▼                                            │       │         visibility
            ┌──────────────┐  re-index changed products  ┌──────▼──┐  ┌─▼────────┐
            │ sync worker  │ ───────────────────────────►│Pinecone │  │ Postgres │ (source of truth)
            └──────────────┘                             └─────────┘  └──────────┘
```

## Run it locally (Windows / PowerShell)

You need Python 3.10–3.13, and your backend's `.env` already working (database, S3).

```powershell
cd chatbot
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env          # then put your PINECONE_API_KEY and GROQ_API_KEY in .env
```

The chatbot reads `DATABASE_URL`, `DB_SSL_CA_FILE`, `S3_*` and `RABBITMQ_URL` from
`backend/.env` by itself, so there's nothing to copy.

```powershell
python -m app.cli check        # tests database, models, Pinecone, S3, Groq, RabbitMQ one by one
python -m app.cli setup        # creates the two Pinecone indexes (once)
python -m app.cli reindex      # products + photos + policies into Pinecone (first time: downloads ~700 MB of models)
python -m app.cli search "wireless earbuds under $100"
python -m app.cli route "only sony under 200"     # see how a message is classified/rewritten
python -m app.cli policy "how long do refunds take?"
python -m app.cli chat "a gift for a coffee lover"
```

Then start it next to the backend (three terminals, all with the venv activated):

```powershell
uvicorn app.main:app --port 8000 --reload   # the API the backend talks to
python -m app.sync_worker                   # keeps Pinecone updated when products change (needs RabbitMQ)
```

…plus your usual `npm run dev` in `backend/` and `frontend/`. The chat button appears in
the bottom-right corner of the shop, and the full page is at `/chat`.

Without the sync worker, everything still works; run `python -m app.cli reindex` after
editing products. Without `GROQ_API_KEY`, routing falls back to keyword rules and replies
use simple templates, but search, policies and orders all still work.

**Policies** are the markdown files in `knowledge/`. They're drafts written from how the
shop actually works, so read them and change anything that isn't your policy. Values like
`{{return_window_days}}`, `{{tax_rate}}`, `{{shipping_zones}}` and `{{commission_rate}}` are
filled in live from your admin settings. After editing a file, run
`python -m app.cli index-policies`.

**Orders**: the backend forwards a signed-in customer's own access token, and the
chatbot calls `/api/order` and `/api/order-details/:id` with it, so the backend's ownership
checks apply. Cancelling is never done by the bot: it checks the order can be cancelled and
shows a button, and the click calls the normal `POST /api/orders/:id/cancel`.

## Tests and evaluation

```powershell
# logic tests (BM25, parser...) run anywhere:
pytest
# the full pipeline tests need a throwaway, migrated database whose name contains "test":
$env:TEST_DATABASE_URL="postgresql://USER:PASS@localhost:5432/tbvault_test"; pytest
```

Tests swap Pinecone and the models for small stand-ins, so they're fast and free. The
**evaluation** uses the real thing and tells you how good retrieval actually is:

```powershell
python -m app.cli eval            # retrieval
python -m app.cli eval-routing    # intent classification + rewriting
```

`eval` prints hit@5 and MRR for each query type (paraphrases, model numbers, filtered
queries) four ways: dense only, sparse only, hybrid, and hybrid **+ rerank**. That last column
is how you check whether the reranker earns its ~50 ms. Then it does the same for photo
search. `eval-routing` runs 28 labelled messages (greetings, follow-ups, comparisons, policies,
orders, multiple intents, out of scope) through the real router and lists every mistake.
Change settings in `.env`, run again and compare. Add your own cases to `eval/*.json`.

## The files, in the order to read them

| File | What it teaches |
|---|---|
| `app/config.py` | Every knob in one place. Notice the two vector sizes (384 vs 512). |
| `app/text_builder.py` | **Contextual retrieval**: what text represents a product, and why the context prefix goes first. |
| `app/bm25.py` | **Sparse vectors** written out by hand: tokenizing, IDF, TF saturation, and why the doc/query split gives exactly the BM25 score. |
| `app/embeddings.py` | **Dense vectors**: MiniLM for text, CLIP for photos, and why their spaces must never mix. |
| `app/vector_store.py` | **Pinecone**: two indexes, stable ids, and the alpha trick for hybrid scoring. |
| `app/indexer.py` | **Ingestion**: Postgres → text → vectors → Pinecone. Removal of hidden products; full rebuild. |
| `app/query_parser.py` | Pulling hard filters (price, stock, brand) out of plain English. |
| `app/retrieval.py` | **The R in RAG**: hybrid query → score cutoff → Postgres check → hard rules. Read this one twice. |
| `app/catalog.py` | Why Postgres, not Pinecone, decides prices, stock and visibility. |
| `app/chat.py` | **The orchestrator**: route → per-intent handler → answer. Fact sheets plus strict instructions, and a fallback when the LLM is down. |
| `app/main.py` | The HTTP API. |
| **Phase 2** | |
| `app/llm.py` | The only Groq code. `ask_json` = JSON mode + pydantic validation + one retry; that's how you get structured output you can trust. |
| `app/router.py` | **Intent classification + query rewriting**: rules for greetings, then the fast model fills a strict schema. Read the `SYSTEM` prompt. |
| `app/planner.py` | **Planning**: when a request needs several lookups (and when it doesn't), with a plan limited to three operations. |
| `app/reranker.py` | **Bi-encoder vs cross-encoder**, and when reranking is skipped. |
| `app/policies.py` | **Parent-child retrieval**: search small chunks, answer from their whole section. |
| `app/tools.py` | **Tool calling done safely**: allow-lists, validated arguments, the app executes, a confirmation for actions. |
| `knowledge/*.md` | The policy texts (yours to edit). |
| **Phase 3** | |
| `app/metrics.py` | Every metric in one place: Prometheus counters/histograms, CPU and memory via psutil, token cost, the request log. |
| `app/quality.py` | Cheap grounding checks on every answer. |
| `app/evaluate.py` | Retrieval, routing and answer evaluations. Read the docstring for what each metric means. |
| `app/stats.py` | Turning logs into numbers: percentiles, rates, cost per 1000 requests. |
| `app/sync_worker.py` | Keeping the index in sync without cross-system transactions: events + retries + reindex. |
| `app/evaluate.py` | Measuring retrieval quality (hit@k, MRR) instead of guessing. |

## Design decisions (and why)

- **Postgres is the truth, Pinecone is only an index.** Search takes product ids from
  Pinecone and loads them from Postgres, keeping only public ones (not hidden, approved
  seller). Prices, sales and stock come from there too, so a stale vector can never show a
  wrong price or a hidden product.
- **One document per product.** Descriptions are short, so chunking would only split
  facts apart. The prefix "Product / Category / Brand / Sold by / Options" gives every
  vector its context.
- **Hybrid in one index.** Each product vector carries both a dense part (MiniLM) and a
  sparse part (BM25), and Pinecone adds the two dot products. Scaling them by `alpha` and
  `1 - alpha` sets the mix. That requires the `dotproduct` metric.
- **BM25 statistics are saved** (`data/bm25_params.json`) because query weights depend on
  the whole catalog. `reindex` refits them; single-product syncs reuse them.
- **Hard rules are checked in Postgres**, not by vector similarity: price range, in stock,
  on sale. Category, brand and seller filters run in Pinecone for recall and are checked
  again in Postgres.
- **Guessed filters are tested before they're trusted.** "apple juice" mentions the brand
  Apple, so the search runs with and without the guess and keeps the guess only if it
  doesn't make the results clearly worse.
- **Scores aren't probabilities.** Pinecone always returns `top_k` hits, so results scoring
  far below the best one are dropped (a ratio, tuned with `eval`).
- **Photos get their own index** (CLIP, 512 numbers). A photo search groups hits by
  product and keeps each product's best photo.
- **No LLM needed for search.** If `GROQ_API_KEY` is missing or Groq fails, you still get the
  products and a template reply.

## Phase 2 design decisions

- **Rules before the LLM.** "hi", "thanks" and "bye" never cost a model call or a search.
- **Classification and extraction in one small JSON call** (gpt-oss-20b), validated by the
  `Route` schema: unknown intents or fields, invalid ids, more than 3 tasks → rejected →
  retried once → keyword rules. The router only describes the request; it can't run anything.
- **Complexity is decided separately, by rules** (`planner.needs_plan`). Only comparisons that
  must first *find* a set of products get a plan. Many filters on one search ≠ complex.
- **Conversation state is explicit.** Each reply returns `state` (the last search's query and
  filters). The browser sends it back, and the router sees it as `PREVIOUS SEARCH`, so "only
  Sony under $200" keeps "headphones" and replaces the price.
- **Fusion stays as it was.** Hybrid already merges dense and sparse inside Pinecone (alpha
  weighting), so RRF isn't needed; the cross-encoder re-reads the top `RERANK_CANDIDATES`.
- **Live data never comes from vectors.** Orders come from the backend API, prices and stock
  from Postgres, and placeholder values in policies from settings at answer time.
- **Actions need a human click.** The model can only *propose* a cancellation; the button the
  app attaches is what cancels, through the existing endpoint and its business rules.
- **Logs**: each chat writes one `chat {...}` JSON line: intent, routing method, rewritten query,
  filters, retrieval and rerank scores, tool names, outcomes and timings. Tokens, emails and
  addresses are never logged. Add `?debug=true` to `/chat` to get the same in the response.

## Known limitations

- Comparisons can only use what's in product descriptions. There's no specification table,
  so the bot says when something like camera quality isn't listed.
- Policies are drafts: review `knowledge/*.md` before going live.
- Guests can't use order tools; they're pointed to the Track order page.
- Photo search doesn't use routing (a photo is always a product search).
- Indexing photos is the slow part: each one is downloaded and run through CLIP on your CPU.

## Phase 3: metrics

Three ways to see how the chatbot is doing:

**1. Live dashboard (Prometheus + Grafana).** The chatbot exposes `GET /metrics`. Your
existing monitoring stack now scrapes it and opens a ready-made dashboard:

```powershell
cd backend
docker compose -f docker-compose.monitoring.yml up -d
# Grafana: http://localhost:3001 (admin / admin the first time) -> Dashboards -> TBVault -> TBVault chatbot
```

Prometheus runs in Docker and reaches your PC via `host.docker.internal`. If the chatbot target
shows as DOWN on http://localhost:9090/targets, start uvicorn with
`--host 0.0.0.0` (Node already listens on all interfaces).

Dashboard sections:
- **Overview:** requests, p95 latency, cost over the last 24 hours, zero-result rate, thumbs-up rate, memory.
- **Traffic and speed:** requests per intent, latency per intent, time per stage, LLM vs rules routing, errors.
- **CPU and memory:** process and machine CPU %, CPU seconds per request, memory.
- **LLM:** tokens per minute by model and type, cost per hour by purpose, LLM latency, average tokens per request, failures.
- **Quality:** results per answer, best scores, how often the reranker changed the #1 result, fallbacks, invented-price rate, order tool outcomes, feedback.

**2. Request logs + `stats`** (no Docker needed). Every chat writes one JSON line to
`data/logs/chat-YYYY-MM-DD.jsonl`, with emails and phone-like numbers redacted. The line
holds the intent, routing, steps with timings, scores, tokens, cost, CPU and answer checks.

```powershell
python -m app.cli stats --days 7
```

That prints the request count, p50/p95 latency, CPU per request, tokens and US$ (in total,
per 1000 requests and per purpose), zero-result rate, invented-price rate, citation rate, and
thumbs up/down per intent.

**3. Offline evaluations** use fixed test sets and are saved to `data/eval_reports/`:

```powershell
python -m app.cli eval            # retrieval: hit@5, MRR, nDCG@10, P@5, ms (dense / sparse / hybrid / +rerank)
python -m app.cli eval-routing    # intent accuracy + rewriting, latency, tokens, cost
python -m app.cli eval-answers    # answer quality, graded by an LLM judge (see below)
python -m app.cli eval-history    # headline numbers of past runs, to see trends after changes
```

**Answer quality** is measured two ways:
- **On every reply, cheaply (`quality.py`):** every price in the answer must appear in the
  facts the LLM was given (an invented price is the worst shop hallucination). The check also
  counts how many of the shown products the answer names.
- **Offline, with an LLM judge (`eval-answers`):**
  - *faithfulness*: are all claims supported by the facts?
  - *relevance*: does it answer the question?
  - Plus deterministic checks: required facts mentioned, correct intent, no invented prices,
    and latency, tokens and cost per answer.

  The judge is itself an LLM, so read its scores as a trend.

**Customer feedback:** thumbs up/down under every reply goes to `POST /api/chat/feedback`,
then to the `chatbot_feedback_total` metric and `data/logs/feedback-*.jsonl`, linked to the
request log by `request_id`.

**Cost:** tokens × price per million tokens. Defaults are Groq's launch prices ($0.15 / $0.75
for gpt-oss-120b, $0.10 / $0.50 for 20b). Check console.groq.com and set `LLM_PRICES` in
`.env` if they've changed.

**CPU:** `chatbot_request_cpu_seconds` is the process CPU time used while a request ran. It's
exact with one user at a time and approximate when requests overlap. LLM calls cost almost
no CPU (they wait on Groq); embedding, reranking and photo encoding are the CPU work.

| Metric (Prometheus) | Meaning |
|---|---|
| `chatbot_requests_total{intent,routed_by,status}` | requests |
| `chatbot_request_seconds`, `chatbot_stage_seconds{stage}` | latency, whole request and per stage |
| `chatbot_request_cpu_seconds`, `chatbot_process_cpu_percent`, `chatbot_process_memory_bytes` | CPU / memory |
| `chatbot_llm_tokens_total{model,purpose,type}`, `chatbot_llm_cost_usd_total`, `chatbot_llm_seconds` | LLM usage |
| `chatbot_results_returned`, `chatbot_zero_results_total`, `chatbot_top_score{kind}`, `chatbot_rerank_total` | retrieval |
| `chatbot_fallbacks_total{kind}`, `chatbot_tool_calls_total`, `chatbot_llm_calls_total{status}` | reliability |
| `chatbot_answer_checks_total{check,result}`, `chatbot_feedback_total{rating}` | answer quality |
