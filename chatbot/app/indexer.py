"""
Indexing: copying products from Postgres into Pinecone.

    Postgres row ──► product_document() text ──► MiniLM (dense) + BM25 (sparse) ──► products index
              └────► first few photos from S3 ──► CLIP image vectors ────────────► images index

Two entry points:
  sync_products(ids)  re-index just these products (called when the backend says they changed).
                      Products that are deleted, hidden or whose seller isn't approved
                      are REMOVED from both indexes, so they can't show up in search.
  rebuild()           full reindex: refits BM25 statistics on the whole catalog,
                      re-indexes everything and deletes vectors that shouldn't exist.
                      Run it after changing models/text format, or to repair the index.

Postgres and Pinecone can't be updated in one transaction. If Pinecone is down,
sync_products raises, and the caller (the RabbitMQ worker) retries later.
Search double-checks every hit against Postgres, so a stale index is never dangerous —
at worst a product is missing from results until the retry succeeds.
"""
import logging

from app import bm25, catalog, config, embeddings, storage, vector_store
from app.text_builder import product_document

log = logging.getLogger("indexer")


def _metadata(row, document):
    """What we store next to each vector. Used for filtering and debugging only —
    never as the final word on price or stock."""
    data = {
        "record_type": "product",
        "product_id": row["id"],
        "category_id": row["category_id"],
        "category": row["category_name"],
        "seller_id": row["seller_id"],
        "seller": row["seller_name"],
        "index_version": config.INDEX_VERSION,
        "text": document[:500],
    }
    if row["brand_id"]:  # Pinecone metadata can't hold None, so just leave it out
        data["brand_id"] = row["brand_id"]
        data["brand"] = row["brand_name"]
    return data


def _index_text(rows):
    if not rows:
        return
    documents = [product_document(row) for row in rows]
    dense = embeddings.embed_texts(documents)
    encoder = bm25.current()
    vectors = []
    for row, document, values in zip(rows, documents, dense):
        vector = {"id": vector_store.product_vector_id(row["id"]), "values": values,
                  "metadata": _metadata(row, document)}
        sparse = encoder.encode_document(document)
        if sparse["indices"]:
            vector["sparse_values"] = sparse
        vectors.append(vector)
    vector_store.upsert(vector_store.text_index(), vectors)


def _index_images(row):
    """Embeds the first few photos of one product. Returns (indexed, failed)."""
    index = vector_store.image_index()
    wanted = row["images"][:config.IMAGES_PER_PRODUCT]
    wanted_ids = {vector_store.image_vector_id(row["id"], img["id"]) for img in wanted}

    # Photos that were deleted or are no longer in the first few: remove their vectors.
    existing = vector_store.list_ids(index, vector_store.image_prefix(row["id"]))
    stale = [vid for vid in existing if vid not in wanted_ids]
    if stale:
        vector_store.delete(index, stale)

    vectors, failed = [], 0
    for img in wanted:
        try:
            picture = embeddings.open_image(storage.download(img["key"]))
            values = embeddings.clip_images([picture])[0]
        except Exception as err:  # a broken photo shouldn't stop the rest
            failed += 1
            log.warning("image %s of product %s skipped: %s", img["id"], row["id"], err)
            continue
        vectors.append({
            "id": vector_store.image_vector_id(row["id"], img["id"]),
            "values": values,
            "metadata": {
                "record_type": "image",
                "product_id": row["id"],
                "image_id": img["id"],
                "object_key": img["key"],
                "is_primary": bool(img["is_primary"]),
                "category_id": row["category_id"],
                "seller_id": row["seller_id"],
                "index_version": config.INDEX_VERSION,
                **({"brand_id": row["brand_id"]} if row["brand_id"] else {}),
            },
        })
    vector_store.upsert(index, vectors)
    return len(vectors), failed


def _remove(product_ids):
    if not product_ids:
        return
    vector_store.delete(vector_store.text_index(), [vector_store.product_vector_id(pid) for pid in product_ids])
    image_index = vector_store.image_index()
    for pid in product_ids:
        ids = vector_store.list_ids(image_index, vector_store.image_prefix(pid))
        if ids:
            vector_store.delete(image_index, ids)


def sync_products(product_ids, with_images=True):
    """Bring these products' vectors in line with Postgres. Returns a small report."""
    product_ids = [int(pid) for pid in dict.fromkeys(product_ids)]
    rows = catalog.get_products(product_ids, public_only=False)
    public = [row for row in rows if catalog.is_public(row)]
    public_ids = {row["id"] for row in public}
    removed = [pid for pid in product_ids if pid not in public_ids]

    _index_text(public)
    _remove(removed)
    images = failed = 0
    if with_images:
        for row in public:
            done, bad = _index_images(row)
            images += done
            failed += bad
    return {"indexed": len(public), "removed": len(removed), "images": images, "image_failures": failed}


def rebuild(with_images=True, progress=print):
    """Full reindex from Postgres."""
    ids = catalog.public_product_ids()
    rows = catalog.get_products(ids)
    progress(f"{len(rows)} public products in Postgres")

    # 1. BM25 statistics come from the whole catalog, so refit and save them first.
    model = bm25.BM25().fit([product_document(row) for row in rows])
    model.save(config.BM25_PARAMS_FILE)
    bm25.set_current(model)
    progress(f"BM25 fitted: {len(model.doc_freq)} distinct words, average {model.avg_len:.1f} words per product")

    # 2. Text vectors, in batches.
    for start in range(0, len(rows), 64):
        _index_text(rows[start:start + 64])
        progress(f"text: {min(start + 64, len(rows))}/{len(rows)}")

    # 3. Remove vectors of products that are gone or no longer public.
    keep = set(ids)
    stale_text = [vid for vid in vector_store.list_ids(vector_store.text_index(), "product:")
                  if vector_store.product_id_from(vid) not in keep]
    vector_store.delete(vector_store.text_index(), stale_text)
    stale_images = [vid for vid in vector_store.list_ids(vector_store.image_index(), "image:")
                    if vector_store.product_id_from(vid) not in keep]
    vector_store.delete(vector_store.image_index(), stale_images)
    progress(f"removed {len(stale_text)} stale product vectors and {len(stale_images)} stale image vectors")

    # 4. Photos (slowest part: download + CLIP for each one).
    images = failed = 0
    if with_images:
        for n, row in enumerate(rows, 1):
            done, bad = _index_images(row)
            images += done
            failed += bad
            if n % 20 == 0 or n == len(rows):
                progress(f"images: {n}/{len(rows)} products, {images} photos indexed, {failed} failed")
    return {"indexed": len(rows), "removed": len(stale_text), "images": images, "image_failures": failed}
