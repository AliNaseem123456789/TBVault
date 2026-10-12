"""
Store policies: retrieval over long documents, with parent-child chunks.

Source: the markdown files in chatbot/knowledge/ (edit them freely, then run
`python -m app.cli index-policies`). Placeholders such as {{return_window_days}} are
filled from the live settings in Postgres, so policy answers follow your admin settings.

    file  "Returns and refunds"                      the document
     └─ ## section  "Where the money goes"           PARENT  (what the LLM reads)
          └─ chunk 0, chunk 1, ...                   CHILDREN (what we search)

Why two levels: small chunks match a question precisely ("how long do card refunds take")
but alone lack context; the whole section gives the answer its context. So we SEARCH the
children and ANSWER from their parents. A very long section is not sent whole: only the
matching chunk and its neighbours.

Each child is embedded with a context prefix ("Policy: Returns and refunds. Section: Where
the money goes. ...") — the same contextual-retrieval idea as product documents.
Children live in the products index under the "policies" namespace, with their own BM25 stats.
"""
import logging
import re
import time

from app import bm25, config, db, embeddings, vector_store

log = logging.getLogger("policies")

MAX_PARENT_CHARS = 2000   # longer sections are trimmed to the matching chunk +- 1 neighbour


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# ----------------------------------------------------------------------------
# live values for {{placeholders}}
# ----------------------------------------------------------------------------
_values_cache = {"at": 0.0, "values": {}}


def _live_values():
    if time.time() - _values_cache["at"] < 300:
        return _values_cache["values"]
    settings = {row["key"]: row["value"] for row in db.query("SELECT key, value FROM settings")}
    zones = db.query("SELECT name, rate, free_over, is_default FROM shipping_zones ORDER BY is_default DESC, name")
    zone_lines = []
    for z in zones:
        line = f"- {z['name']}: ${float(z['rate']):.2f}"
        if z["free_over"] is not None:
            line += f", free on orders over ${float(z['free_over']):.2f}"
        if z["is_default"]:
            line += " (used when no other zone matches your address)"
        zone_lines.append(line)
    email = settings.get("store_email") or ""
    values = {
        "store_name": settings.get("store_name") or "TBVault",
        "return_window_days": settings.get("return_window_days") or "30",
        "tax_rate": settings.get("tax_rate") or "0",
        "commission_rate": settings.get("commission_rate") or "10",
        "store_email": email or "our Contact page",
        "shipping_zones": "\n".join(zone_lines) or "- Shipping is calculated at checkout.",
    }
    _values_cache.update(at=time.time(), values=values)
    return values


def _fill(text, values):
    return re.sub(r"\{\{(\w+)\}\}", lambda m: str(values.get(m.group(1), m.group(0))), text)


# ----------------------------------------------------------------------------
# documents -> parents -> children
# ----------------------------------------------------------------------------
def load_parents():
    """Every '## section' of every knowledge file, placeholders filled. {parent_id: {...}}"""
    values = _live_values()
    parents = {}
    for path in sorted(config.KNOWLEDGE_DIR.glob("*.md")):
        text = _fill(path.read_text(encoding="utf-8"), values)
        title_match = re.search(r"^# (.+)$", text, re.M)
        title = title_match.group(1).strip() if title_match else path.stem.replace("-", " ").title()
        for part in re.split(r"^## ", text, flags=re.M)[1:]:
            heading, _, body = part.partition("\n")
            body = body.strip()
            if body:
                pid = f"{path.stem}#{_slug(heading)}"
                parents[pid] = {"id": pid, "file": path.name, "title": title, "section": heading.strip(), "text": body}
    return parents


def split_children(body, max_chars=None):
    """Chunks of whole paragraphs / list items / sentences, each at most ~max_chars."""
    max_chars = max_chars or config.POLICY_CHUNK_CHARS
    pieces = []
    for block in re.split(r"\n\s*\n|\n(?=- |\d+\. )", body):
        block = " ".join(block.split())
        if len(block) <= max_chars:
            pieces.append(block)
        else:  # a very long paragraph: cut between sentences
            pieces += [s for s in re.split(r"(?<=[.!?])\s+", block) if s]
    chunks, current = [], ""
    for piece in pieces:
        if current and len(current) + len(piece) + 1 > max_chars:
            chunks.append(current)
            current = piece
        else:
            current = f"{current} {piece}".strip()
    if current:
        chunks.append(current)
    return chunks


def children_of(parent):
    return [
        {"id": f"policy:{parent['id']}:{n}", "parent_id": parent["id"], "n": n, "text": chunk,
         "context_text": f"Policy: {parent['title']}. Section: {parent['section']}. {chunk}"}
        for n, chunk in enumerate(split_children(parent["text"]))
    ]


# ----------------------------------------------------------------------------
# indexing
# ----------------------------------------------------------------------------
_bm25 = None


def _encoder():
    global _bm25
    if _bm25 is None:
        if not config.POLICY_BM25_FILE.exists():
            raise RuntimeError("Policies aren't indexed yet. Run: python -m app.cli index-policies")
        _bm25 = bm25.BM25.load(config.POLICY_BM25_FILE)
    return _bm25


def index_policies():
    global _bm25
    parents = load_parents()
    children = [child for parent in parents.values() for child in children_of(parent)]
    texts = [c["context_text"] for c in children]
    model = bm25.BM25().fit(texts)
    model.save(config.POLICY_BM25_FILE)
    _bm25 = model

    dense = embeddings.embed_texts(texts)
    vectors = []
    for child, values in zip(children, dense):
        parent = parents[child["parent_id"]]
        vector = {"id": child["id"], "values": values, "metadata": {
            "record_type": "policy_chunk", "parent_id": child["parent_id"], "chunk": child["n"],
            "title": parent["title"], "section": parent["section"], "text": child["text"][:800],
            "index_version": config.INDEX_VERSION}}
        sparse = model.encode_document(child["context_text"])
        if sparse["indices"]:
            vector["sparse_values"] = sparse
        vectors.append(vector)
    index = vector_store.text_index()
    vector_store.upsert(index, vectors, namespace=config.POLICY_NAMESPACE)
    keep = {v["id"] for v in vectors}
    stale = [vid for vid in vector_store.list_ids(index, "policy:", namespace=config.POLICY_NAMESPACE) if vid not in keep]
    vector_store.delete(index, stale, namespace=config.POLICY_NAMESPACE)
    return {"documents": len({p["file"] for p in parents.values()}), "sections": len(parents),
            "chunks": len(children), "removed": len(stale)}


# ----------------------------------------------------------------------------
# search: children -> parents
# ----------------------------------------------------------------------------
def _parent_context(parent, chunk_numbers):
    """The whole section, or for a very long one the matched chunks and their neighbours."""
    if len(parent["text"]) <= MAX_PARENT_CHARS:
        return parent["text"]
    chunks = split_children(parent["text"])
    keep = sorted({i for n in chunk_numbers for i in (n - 1, n, n + 1) if 0 <= i < len(chunks)})
    return " ... ".join(chunks[i] for i in keep)


def search(question, max_sections=3):
    """Returns the best policy sections for a question: [{id, title, section, text, score}]."""
    dense = embeddings.embed_query(question)
    sparse = _encoder().encode_query(question)
    matches = vector_store.hybrid_query(dense, sparse, config.HYBRID_ALPHA, 12, namespace=config.POLICY_NAMESPACE)
    if not matches or matches[0].score <= 0:
        return []
    cutoff = matches[0].score * config.MIN_SCORE_RATIO
    parents = load_parents()      # current text, current settings
    found = {}
    for m in matches:
        if m.score < cutoff:
            continue
        pid = m.metadata["parent_id"]
        if pid not in parents:    # file edited since indexing: skip stale chunks
            continue
        hit = found.setdefault(pid, {"score": m.score, "chunks": []})
        hit["chunks"].append(int(m.metadata["chunk"]))
    ranked = sorted(found.items(), key=lambda item: -item[1]["score"])[:max_sections]
    return [{"id": pid, "title": parents[pid]["title"], "section": parents[pid]["section"],
             "text": _parent_context(parents[pid], hit["chunks"]), "score": round(hit["score"], 4)}
            for pid, hit in ranked]
