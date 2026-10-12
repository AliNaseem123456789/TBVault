"""
Reranking: a second, more careful opinion on the top candidates.

Hybrid search compares the query vector with each product vector separately
(a "bi-encoder"): fast enough for the whole catalog, but the two texts never
"see" each other. A cross-encoder reads query AND product text together and
outputs one relevance score — much more accurate, but too slow for the whole
catalog. So: hybrid search finds ~20 candidates, the cross-encoder re-orders them.

Model: Xenova/ms-marco-MiniLM-L-6-v2 (80 MB, runs locally via fastembed).
Scores are raw logits: higher = more relevant, roughly -11 (unrelated) to +10.

Skipped when it can't help: 3 or fewer candidates, an exact SKU match, or RERANK=false.
"""
import logging
from functools import lru_cache

from app import config

log = logging.getLogger("reranker")


@lru_cache(maxsize=None)
def _model():
    from fastembed.rerank.cross_encoder import TextCrossEncoder
    return TextCrossEncoder(model_name=config.RERANK_MODEL, cache_dir=str(config.MODEL_CACHE_DIR))


def score(query, documents):
    """One relevance score per document."""
    return [float(s) for s in _model().rerank(query, list(documents))]


def should_rerank(candidates, exact_match=False):
    return config.RERANK and not exact_match and len(candidates) > 3


def rerank(query, items, text_of):
    """
    items: candidates in hybrid order. text_of(item) -> the text the cross-encoder reads.
    Returns (items re-ordered, scores in the new order). Items scoring below
    RERANK_MIN_SCORE (if set) are dropped as not relevant.
    """
    scores = score(query, [text_of(item) for item in items])
    ranked = sorted(zip(items, scores), key=lambda pair: -pair[1])
    if config.RERANK_MIN_SCORE is not None:
        ranked = [(item, s) for item, s in ranked if s >= config.RERANK_MIN_SCORE]
    return [item for item, _ in ranked], [round(s, 3) for _, s in ranked]
