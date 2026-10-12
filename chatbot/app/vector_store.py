"""
Everything that talks to Pinecone.

Two indexes:
  tbvault-products  384-dim, metric "dotproduct"  -> MiniLM vector + BM25 sparse vector per product
                    (hybrid search in a single index requires the dotproduct metric)
  tbvault-images    512-dim, metric "cosine"      -> one CLIP vector per product photo

Vector ids are stable, so indexing the same thing twice overwrites instead of duplicating:
  product:{product_id}
  policy:{file}#{section}:{n}       (Phase 2, in the "policies" namespace of the products index)
  image:{product_id}:{image_id}     (the product id in the middle lets us list/delete
                                     all photos of one product by prefix)
"""
from functools import lru_cache

from app import config


@lru_cache(maxsize=None)
def _client():
    from pinecone import Pinecone
    if not config.PINECONE_API_KEY:
        raise RuntimeError("PINECONE_API_KEY is not set in chatbot/.env")
    return Pinecone(api_key=config.PINECONE_API_KEY)


@lru_cache(maxsize=None)
def text_index():
    return _client().Index(config.TEXT_INDEX_NAME)


@lru_cache(maxsize=None)
def image_index():
    return _client().Index(config.IMAGE_INDEX_NAME)


def create_indexes():
    """Creates both indexes if they don't exist yet. Safe to run again."""
    from pinecone import ServerlessSpec
    pc = _client()
    wanted = [
        (config.TEXT_INDEX_NAME, config.TEXT_DIM, "dotproduct"),
        (config.IMAGE_INDEX_NAME, config.IMAGE_DIM, "cosine"),
    ]
    created = []
    for name, dimension, metric in wanted:
        if not pc.has_index(name):
            pc.create_index(name=name, dimension=dimension, metric=metric,
                            spec=ServerlessSpec(cloud=config.PINECONE_CLOUD, region=config.PINECONE_REGION))
            created.append(name)
    return created


# ----------------------------------------------------------------------------
# ids
# ----------------------------------------------------------------------------
def product_vector_id(product_id):
    return f"product:{product_id}"


def image_vector_id(product_id, image_id):
    return f"image:{product_id}:{image_id}"


def image_prefix(product_id):
    return f"image:{product_id}:"


def product_id_from(vector_id):
    return int(vector_id.split(":")[1])


# ----------------------------------------------------------------------------
# writing
# ----------------------------------------------------------------------------
def _ns(namespace):
    # The default namespace is left out of the call entirely (works with every SDK version).
    return {"namespace": namespace} if namespace else {}


def upsert(index, vectors, batch_size=100, namespace=""):
    """vectors: dicts with id, values, optional sparse_values, metadata."""
    for start in range(0, len(vectors), batch_size):
        index.upsert(vectors=vectors[start:start + batch_size], show_progress=False, **_ns(namespace))


def delete(index, ids, namespace=""):
    ids = list(ids)
    for start in range(0, len(ids), 1000):
        index.delete(ids=ids[start:start + 1000], **_ns(namespace))


def list_ids(index, prefix, namespace=""):
    """All vector ids starting with prefix."""
    ids = []
    for page in index.list(prefix=prefix, **_ns(namespace)):
        for item in page:
            ids.append(item if isinstance(item, str) else item.id)
    return ids


# ----------------------------------------------------------------------------
# searching
# ----------------------------------------------------------------------------
def hybrid_query(dense, sparse, alpha, top_k, metadata_filter=None, namespace=""):
    """
    Pinecone adds the dense dot product and the sparse dot product together.
    To control the mix we scale both sides first (the "convex combination"):
        dense  * alpha        sparse * (1 - alpha)
    alpha = 1 -> meaning only, alpha = 0 -> keywords only.
    Raw dense and sparse scores aren't on the same scale, so alpha is a knob
    to tune with the evaluation set, not a percentage.
    """
    dense_weight = max(alpha, 1e-4)   # Pinecone rejects an all-zero dense vector, so never scale to exactly 0
    dense = [v * dense_weight for v in dense]
    kwargs = {"vector": dense, "top_k": top_k, "include_metadata": True}
    if sparse and sparse["indices"] and alpha < 1:
        kwargs["sparse_vector"] = {"indices": sparse["indices"],
                                   "values": [v * (1 - alpha) for v in sparse["values"]]}
    if metadata_filter:
        kwargs["filter"] = metadata_filter
    return text_index().query(**kwargs, **_ns(namespace)).matches


def image_query(vector, top_k, metadata_filter=None):
    kwargs = {"vector": vector, "top_k": top_k, "include_metadata": True}
    if metadata_filter:
        kwargs["filter"] = metadata_filter
    return image_index().query(**kwargs).matches
