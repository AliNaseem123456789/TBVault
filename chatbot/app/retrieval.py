"""
Search: the "R" in RAG.

search_products(query, filters)   hybrid text search
    1. exact SKU match in Postgres (if the query looks like one)
    2. query -> MiniLM vector + BM25 sparse vector
    3. Pinecone hybrid query, with metadata filters for category / brand / seller;
       hits far weaker than the best one are dropped.
       Brand/category guessed from chat text are kept only if they don't hurt the results.
    4. take the product ids, load them from Postgres (only public products come back)
    5. enforce hard rules on the REAL data: price range, in stock, on sale
    6. if guessed filters left nothing after the Postgres checks, retry without them
    7. (Phase 2) rerank the top RERANK_CANDIDATES with a cross-encoder (see reranker.py)

search_by_image(image_bytes)      photo -> CLIP image vector -> images index
search_images_by_text(query)      text  -> CLIP text vector  -> images index
    Several photos can belong to one product, so hits are grouped: each product
    keeps its best-scoring photo.

Every function returns {"products": [...], "applied": {...}, "debug": [...]}.
"debug" (scores, which side found what) is only for logs and the evaluation script.
"""
import logging
import re

from app import bm25, catalog, config, embeddings, metrics, reranker, vector_store
from app.query_parser import Filters
from app.text_builder import product_document

log = logging.getLogger("retrieval")

SKU_LIKE = re.compile(r"^(?=.*\d)(?=.*[a-z])[a-z0-9][a-z0-9\-_]{3,40}$", re.I)


def _pinecone_filter(filters):
    """Only fields that rarely change go to Pinecone. Price and stock are checked in Postgres."""
    parts = {}
    if filters.category_id:
        parts["category_id"] = {"$eq": filters.category_id}
    if filters.brand_id:
        parts["brand_id"] = {"$eq": filters.brand_id}
    if filters.seller_id:
        parts["seller_id"] = {"$eq": filters.seller_id}
    return parts or None


def _passes(row, filters):
    """Hard constraints, checked on authoritative Postgres data."""
    price = catalog.lowest_price(row)
    if filters.min_price is not None and price < filters.min_price:
        return False
    if filters.max_price is not None and price > filters.max_price:
        return False
    if filters.in_stock and not catalog.in_stock(row):
        return False
    if filters.on_sale and not row["sale_percent"]:
        return False
    if filters.category_id and row["category_id"] != filters.category_id:
        return False  # the index may be stale; Postgres has the final say
    if filters.brand_id and row["brand_id"] != filters.brand_id:
        return False
    if filters.seller_id and row["seller_id"] != filters.seller_id:
        return False
    return True


def _drop_weak(matches, ratio=None):
    """Keep hits that score at least `ratio` of the best one (MIN_SCORE_RATIO by default).
    Scores aren't calibrated (no "0.7 = relevant" rule), but within one query
    a hit far below the best one is almost always noise."""
    if not matches or matches[0].score <= 0:
        return []
    cutoff = matches[0].score * (config.MIN_SCORE_RATIO if ratio is None else ratio)
    return [m for m in matches if m.score >= cutoff and m.score > 0]


def _resolve_rows(ranked_ids, filters):
    """Ids in rank order -> Postgres rows of public products that pass the filters."""
    rows = catalog.get_products(ranked_ids)          # hidden / deleted / unapproved drop out here
    return [row for row in rows if _passes(row, filters)]


def _resolve(ranked_ids, filters, limit):
    return [catalog.to_public(row) for row in _resolve_rows(ranked_ids, filters)[:limit]]


def _rerank_rows(query, rows, exact_match):
    """Phase 2: cross-encoder re-ordering of the top candidates. Returns (rows, scores or None)."""
    candidates = rows[:config.RERANK_CANDIDATES]
    if not reranker.should_rerank(candidates, exact_match):
        return rows, None
    try:
        ordered, scores = reranker.rerank(query, candidates, product_document)
    except Exception as err:   # model missing/broken: keep the hybrid order rather than fail the search
        log.warning("reranking skipped: %s", err)
        metrics.FALLBACKS.labels("rerank_error").inc()
        return rows, None
    return ordered, scores


def _without_guesses(filters):
    relaxed = Filters(**{**filters.__dict__, "guessed": []})
    for name in filters.guessed:
        setattr(relaxed, name, None)
    return relaxed


GUESS_KEEP_RATIO = 0.8


def _search_with_guesses(run, filters, ratio=None):
    """
    run(filters) does the Pinecone query. Brand/category filters guessed from chat text
    can be wrong ("apple juice" is not the brand Apple), so when there are guesses we
    also search without them, and keep the guesses only if they don't make the best
    hit much worse. Returns (matches, filters actually used).
    """
    matches = _drop_weak(run(filters), ratio)
    if not filters.guessed:
        return matches, filters
    loose = _without_guesses(filters)
    loose_matches = _drop_weak(run(loose), ratio)
    best = matches[0].score if matches else 0
    loose_best = loose_matches[0].score if loose_matches else 0
    if best >= loose_best * GUESS_KEEP_RATIO:
        return matches, filters
    log.info("guessed filters %s made results worse; ignoring them", filters.guessed)
    metrics.FALLBACKS.labels("guessed_filter_ignored").inc()
    return loose_matches, loose


def search_products(query, filters=None, limit=None, alpha=None, rerank=True):
    filters = filters or Filters()
    limit = min(limit or config.DEFAULT_LIMIT, config.MAX_LIMIT)
    alpha = config.HYBRID_ALPHA if alpha is None else alpha

    # 1. exact SKU
    exact_ids = catalog.product_ids_by_sku(query) if SKU_LIKE.match(query.strip()) else []

    # 2-3. hybrid vector search
    dense = embeddings.embed_query(query)
    sparse = bm25.current().encode_query(query)
    matches, filters = _search_with_guesses(
        lambda f: vector_store.hybrid_query(dense, sparse, alpha, config.CANDIDATES, _pinecone_filter(f)), filters)
    debug = [{"product_id": int(m.metadata["product_id"]), "score": round(m.score, 4)} for m in matches]

    # 4-5. authoritative data + hard rules
    ranked = exact_ids + [d["product_id"] for d in debug]
    rows = _resolve_rows(ranked, filters)

    # 6. guessed filters left nothing after the Postgres checks -> try again without them
    if not rows and filters.guessed:
        return search_products(query, _without_guesses(filters), limit, alpha, rerank)

    # 7. (Phase 2) rerank the top candidates with the cross-encoder
    scores = None
    top_before = rows[0]["id"] if rows else None
    if rerank:
        rows, scores = _rerank_rows(query, rows, exact_match=bool(exact_ids))
    products = [catalog.to_public(row) for row in rows[:limit]]
    result = {"products": products, "applied": filters.describe(), "debug": debug, "reranked": scores is not None,
              "top_before_rerank": top_before}
    if scores is not None:
        result["rerank"] = [{"product_id": row["id"], "score": s} for row, s in zip(rows, scores)]
    return result


def _group_by_product(matches):
    """Best photo per product, in score order."""
    best = {}
    for m in matches:
        pid = int(m.metadata["product_id"])
        if pid not in best or m.score > best[pid]["score"]:
            best[pid] = {"product_id": pid, "image_id": int(m.metadata["image_id"]), "score": round(m.score, 4)}
    return sorted(best.values(), key=lambda d: -d["score"])


def _image_search(vector, filters, limit):
    filters = filters or Filters()
    limit = min(limit or config.DEFAULT_LIMIT, config.MAX_LIMIT)
    # pull extra photo hits: several can belong to the same product
    matches, filters = _search_with_guesses(
        lambda f: vector_store.image_query(vector, config.CANDIDATES * 2, _pinecone_filter(f)), filters,
        ratio=config.IMAGE_MIN_SCORE_RATIO)
    debug = _group_by_product(matches)
    products = _resolve([d["product_id"] for d in debug], filters, limit)
    if not products and filters.guessed:
        return _image_search(vector, _without_guesses(filters), limit)
    return {"products": products, "applied": filters.describe(), "debug": debug}


def search_by_image(image_bytes, filters=None, limit=None):
    picture = embeddings.open_image(image_bytes)
    return _image_search(embeddings.clip_images([picture])[0], filters, limit)


def search_images_by_text(query, filters=None, limit=None):
    return _image_search(embeddings.clip_text(query), filters, limit)
