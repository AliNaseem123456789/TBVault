"""
Test setup.

The real models and Pinecone are replaced by small stand-ins so tests are fast,
free and run offline:
  FakeIndex      an in-memory Pinecone index (dense + sparse dot product, $eq filters, prefix list)
  fake_embed     "meaning" vectors from words, with a tiny synonym table
                 (so "earbuds" and "headphones" count as similar, like a real model would)
  fake_clip      colour-based picture vectors; the words red/green/blue map to the same vectors

Everything else is real: SQL, BM25, filters, ranking, the API.

Tests that need Postgres use TEST_DATABASE_URL (a database with the backend's
migrations applied, whose name contains "test"). They add their own rows, all
named with "Zq" so they can't clash with other data, and remove them afterwards.
"""
import io
import os
import zlib
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from app import bm25, config, db, embeddings, storage, vector_store

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "")


# ----------------------------------------------------------------------------
# Fake Pinecone
# ----------------------------------------------------------------------------
class FakeIndex:
    def __init__(self):
        self.vectors = {}
        self.down = False   # set True to simulate an outage

    def _check(self):
        if self.down:
            raise ConnectionError("pinecone is down")

    def upsert(self, vectors, show_progress=False):
        self._check()
        for v in vectors:
            self.vectors[v["id"]] = v

    def delete(self, ids):
        self._check()
        for i in ids:
            self.vectors.pop(i, None)

    def list(self, prefix):
        self._check()
        ids = sorted(i for i in self.vectors if i.startswith(prefix))
        yield [SimpleNamespace(id=i) for i in ids]

    @staticmethod
    def _matches(metadata, flt):
        return all(metadata.get(key) == cond["$eq"] for key, cond in (flt or {}).items())

    def query(self, vector, top_k, include_metadata=True, sparse_vector=None, filter=None):
        self._check()
        hits = []
        for v in self.vectors.values():
            if not self._matches(v["metadata"], filter):
                continue
            score = float(np.dot(vector, v["values"]))
            if sparse_vector and v.get("sparse_values"):
                doc = dict(zip(v["sparse_values"]["indices"], v["sparse_values"]["values"]))
                score += sum(w * doc.get(i, 0.0) for i, w in zip(sparse_vector["indices"], sparse_vector["values"]))
            hits.append(SimpleNamespace(id=v["id"], score=score, metadata=v["metadata"]))
        hits.sort(key=lambda h: -h.score)
        return SimpleNamespace(matches=hits[:top_k])


# ----------------------------------------------------------------------------
# Fake models
# ----------------------------------------------------------------------------
SYNONYMS = {
    "earbud": "audio", "earbuds": "audio", "headphone": "audio", "headphones": "audio",
    "earphones": "audio", "music": "audio", "listening": "audio",
    "pan": "cookware", "pot": "cookware", "kettle": "cookware", "cooking": "cookware", "eggs": "cookware",
}


def fake_embed(texts):
    out = []
    for text in texts:
        vec = np.zeros(config.TEXT_DIM)
        for word in bm25.tokenize(text):
            concept = SYNONYMS.get(word, word)
            vec[zlib.crc32(concept.encode()) % config.TEXT_DIM] += 1
        norm = np.linalg.norm(vec)
        out.append((vec / norm if norm else vec).tolist())
    return out


COLOURS = {"red": (220, 30, 30), "green": (30, 200, 60), "blue": (30, 60, 220)}


def _colour_vector(rgb):
    vec = np.zeros(config.IMAGE_DIM)
    vec[:3] = np.array(rgb, dtype=float)
    vec[3] = 40.0
    return (vec / np.linalg.norm(vec)).tolist()


def fake_clip_images(images):
    return [_colour_vector(np.asarray(img.convert("RGB")).reshape(-1, 3).mean(axis=0)) for img in images]


def fake_clip_text(text):
    for name, rgb in COLOURS.items():
        if name in text.lower():
            return _colour_vector(rgb)
    return _colour_vector((128, 128, 128))


def png(colour):
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), COLOURS[colour]).save(buf, format="PNG")
    return buf.getvalue()


# ----------------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------------
@pytest.fixture
def fake_world(monkeypatch, tmp_path):
    """Fake Pinecone + fake models + photos served from memory."""
    text, images = FakeIndex(), FakeIndex()
    monkeypatch.setattr(vector_store, "text_index", lambda: text)
    monkeypatch.setattr(vector_store, "image_index", lambda: images)
    monkeypatch.setattr(embeddings, "embed_texts", fake_embed)
    monkeypatch.setattr(embeddings, "clip_images", fake_clip_images)
    monkeypatch.setattr(embeddings, "clip_text", fake_clip_text)
    photos = {"zq/red.png": png("red"), "zq/blue.png": png("blue"), "zq/green.png": png("green")}
    monkeypatch.setattr(storage, "download", lambda key: photos[key])
    monkeypatch.setattr(config, "BM25_PARAMS_FILE", tmp_path / "bm25.json")
    monkeypatch.setattr(config, "GROQ_API_KEY", "")
    monkeypatch.setattr(config, "INTERNAL_KEY", "")
    bm25.set_current(None)
    return SimpleNamespace(text=text, images=images)


def _sql(sql, params=None):
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _insert(table, **values):
    cols = ", ".join(values)
    marks = ", ".join(["%s"] * len(values))
    return _sql(f"INSERT INTO {table} ({cols}) VALUES ({marks}) RETURNING id", list(values.values()))[0]["id"]


def _cleanup():
    _sql("DELETE FROM sales WHERE name LIKE 'Zq%'")
    _sql("DELETE FROM products WHERE name LIKE 'Zq%'")
    _sql("DELETE FROM sellers WHERE store_name LIKE 'Zq%'")
    _sql("DELETE FROM brands WHERE name LIKE 'Zq%'")
    _sql("DELETE FROM categories WHERE name LIKE 'Zq%'")


@pytest.fixture
def shop(monkeypatch):
    """Sample catalog in the test database. Returns the ids by short name."""
    if not TEST_DATABASE_URL or "test" not in TEST_DATABASE_URL.rsplit("/", 1)[-1]:
        pytest.skip("set TEST_DATABASE_URL to a database whose name contains 'test'")
    monkeypatch.setattr(config, "DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setattr(config, "DB_SSL_CA_FILE", "")
    db._conn = None
    _cleanup()

    ids = {}
    ids["audio"] = _insert("categories", name="Zqaudio")
    ids["kitchen"] = _insert("categories", name="Zqkitchen")
    ids["sony"] = _insert("brands", name="Zqsony")
    ids["acme"] = _insert("brands", name="Zqacme")
    ids["store"] = _insert("sellers", store_name="Zq Store", slug="zq-store", status="APPROVED", updated_at="now()")
    ids["banned_store"] = _insert("sellers", store_name="Zq Banned", slug="zq-banned", status="SUSPENDED", updated_at="now()")

    def product(key, name, description, price, stock, category, brand=None, seller="store", hidden=False, photo=None):
        ids[key] = _insert("products", name=name, description=description, price=price, stock=stock,
                           category_id=ids[category], brand_id=ids[brand] if brand else None,
                           seller_id=ids[seller], is_hidden=hidden, updated_at="now()")
        if photo:
            _insert("product_images", product_id=ids[key], key=f"zq/{photo}.png", is_primary=True)

    product("headphones", "Zqsony WH-CH720N Headphones", "Wireless noise cancelling headphones with long battery life.",
            99, 5, "audio", "sony", photo="red")
    product("earbuds", "Zqacme Earbuds Mini", "Tiny earbuds for running.", 25, 0, "audio", "acme", photo="blue")
    product("pan", "Zqacme Frying Pan", "Non-stick pan, great for eggs.", 40, 0, "kitchen", "acme", photo="green")
    _insert("product_variants", product_id=ids["pan"], name="Small", price=30, stock=0, sku="ZQ-PAN-S", updated_at="now()")
    _insert("product_variants", product_id=ids["pan"], name="Large", price=45, stock=3, sku="ZQ-PAN-L", updated_at="now()")
    product("kettle", "Zqacme Steel Kettle", "Boils water fast.", 100, 2, "kitchen", "acme")
    _insert("sales", name="Zq kettle sale", percent_off=50, product_id=ids["kettle"],
            starts_at="2000-01-01", ends_at="2999-01-01", updated_at="now()")
    product("secret", "Zqsony Secret Speaker", "Hidden from the shop.", 10, 9, "audio", "sony", hidden=True)
    product("banned", "Zqacme Banned Blender", "Seller is suspended.", 10, 9, "kitchen", "acme", seller="banned_store")

    yield ids
    _cleanup()
    db._conn = None


@pytest.fixture
def sql():
    return _sql
