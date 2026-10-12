# TBVault shopping assistant (Phase 1: retrieval)

A Python service that finds products by **meaning**, by **keywords** and by **photo**, and
answers questions about them with an LLM that may only use what was retrieved.

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
python -m app.cli reindex      # loads all products + photos into Pinecone (first time: downloads ~600 MB of models)
python -m app.cli search "wireless earbuds under $100"
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
editing products. Without `GROQ_API_KEY`, search works and replies use a simple template.

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
python -m app.cli eval
```

It prints hit@5 and MRR for each query type (paraphrases, model numbers, filtered queries)
three ways: dense only, sparse only and hybrid. Then it does the same for photo search. Change
`HYBRID_ALPHA`, `MIN_SCORE_RATIO` or `IMAGE_MIN_SCORE_RATIO` in `.env`, run it again and
compare. Add your own cases to `eval/eval_set.json`.

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
| `app/chat.py` | **The G in RAG**: a bounded fact sheet plus strict instructions, with a fallback when the LLM is down. |
| `app/main.py` | The HTTP API. |
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

## Known limitations (Phase 1)

- Only the current message is searched. Follow-ups like "cheaper ones?" aren't rewritten
  into a full query, though the LLM does see the last few messages.
- Brand and category are recognised only when their exact name appears in the message.
- No reranking: the order is the hybrid score order.
- Questions about orders, shipping or returns aren't answered yet (no FAQ documents indexed).
- Indexing photos is the slow part: each one is downloaded and run through CLIP on your CPU.

## Where Phase 2 plugs in

| Phase 2 feature | Where it goes |
|---|---|
| Reranking | `retrieval.search_products`, after `_resolve`. Rerank the ~20 products with a cross-encoder. |
| Query rewriting | `chat.answer`, before `query_parser.parse`. The LLM turns history + message into a standalone query. |
| LLM tool calling | Replaces `query_parser.parse`. The LLM fills the same `Filters` and can call order/account tools through the Node API. |
| Parent-child retrieval (FAQs, policies) | A new `documents` index. `indexer` gains a chunker; `retrieval` gains a document search. Keep `product:` ids as they are. |
| Phase 3 metrics | The `debug` field every search already returns (scores, ids), plus timings around each step. |
