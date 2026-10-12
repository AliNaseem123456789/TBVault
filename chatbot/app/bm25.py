"""
BM25 keyword vectors ("sparse vectors"), written out in full so you can see how they work.

Why: the meaning model (MiniLM) is great at paraphrases ("something to cook eggs in"
-> "frying pan") but weak at exact words like model numbers ("WH-CH720N"). BM25 is
the classic keyword-search formula and is strong exactly there. Hybrid search uses both.

How a sparse vector looks: only the words that appear get a slot.
    {"indices": [token_id, ...], "values": [weight, ...]}
token_id is a stable number for each word (a CRC32 hash). We can't use Python's
hash(): it changes every run, and the index must use the same ids forever.

BM25 score(query, doc) = sum over query words w of  IDF(w) * TF_part(w, doc)
    IDF(w)        = how rare w is in the whole catalog (rare words matter more)
    TF_part(w,d)  = tf * (k1 + 1) / (tf + k1 * (1 - b + b * doc_len / avg_doc_len))
                    (more mentions help, but with diminishing returns; long docs are penalised a bit)

Pinecone scores sparse vectors with a dot product, so we split the formula:
    document vector holds TF_part, query vector holds IDF.
Their dot product is exactly the BM25 score.

IDF needs statistics about the whole catalog (how many products contain each word).
`fit()` counts them during a full reindex and saves them to data/bm25_params.json.
Query-time encoding must load the same file, or the scores won't line up.
"""
import json
import math
import re
import zlib
from collections import Counter

K1 = 1.2
B = 0.75

STOPWORDS = set("""
a an and are as at be but by for from has have i in into is it its me my of on or our so
than that the their them then there these this to was we were what when where which who
with you your can could would should do does did will just any some show find need want
looking look please get give
""".split())

_WORD = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def tokenize(text):
    """Lower-case words. 'WH-CH720N' gives 'wh', 'ch720n' and 'whch720n',
    so "wh-ch720n", "WH CH720N" and "whch720n" all match each other."""
    tokens = []
    for word in _WORD.findall(text.lower()):
        pieces = word.split("-")
        if len(pieces) > 1:
            tokens.append("".join(pieces))
        for piece in pieces:
            if piece in STOPWORDS:
                continue
            # tiny plural rule: "phones" -> "phone" (but leave "glass", "us")
            if len(piece) > 3 and piece.endswith("s") and not piece.endswith("ss"):
                piece = piece[:-1]
            tokens.append(piece)
    return tokens


def token_id(token):
    return zlib.crc32(token.encode("utf-8"))


class BM25:
    def __init__(self, doc_freq=None, n_docs=0, avg_len=1.0):
        self.doc_freq = doc_freq or {}   # word -> number of products containing it
        self.n_docs = n_docs
        self.avg_len = avg_len

    # -- statistics -----------------------------------------------------------
    def fit(self, documents):
        counts = Counter()
        total_len = 0
        for doc in documents:
            tokens = tokenize(doc)
            total_len += len(tokens)
            counts.update(set(tokens))
        self.doc_freq = dict(counts)
        self.n_docs = len(documents)
        self.avg_len = total_len / max(1, len(documents))
        return self

    def save(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"n_docs": self.n_docs, "avg_len": self.avg_len, "doc_freq": self.doc_freq}))

    @classmethod
    def load(cls, path):
        data = json.loads(path.read_text())
        return cls(data["doc_freq"], data["n_docs"], data["avg_len"])

    # -- encoding -------------------------------------------------------------
    def encode_document(self, text):
        tf = Counter(tokenize(text))
        doc_len = sum(tf.values())
        weights = {}
        for word, count in tf.items():
            norm = K1 * (1 - B + B * doc_len / self.avg_len)
            weights[token_id(word)] = count * (K1 + 1) / (count + norm)
        return _as_sparse(weights)

    def idf(self, word):
        df = self.doc_freq.get(word, 0)
        return math.log((self.n_docs - df + 0.5) / (df + 0.5) + 1)

    def encode_query(self, text):
        weights = {token_id(word): self.idf(word) for word in set(tokenize(text))}
        return _as_sparse(weights)


def _as_sparse(weights):
    items = sorted(weights.items())
    return {"indices": [i for i, _ in items], "values": [float(v) for _, v in items]}


# The fitted statistics are loaded once and shared.
_current = None


def current():
    """The BM25 stats saved by the last full reindex."""
    global _current
    if _current is None:
        from app import config
        if not config.BM25_PARAMS_FILE.exists():
            raise RuntimeError("No BM25 statistics yet. Run: python -m app.cli reindex")
        _current = BM25.load(config.BM25_PARAMS_FILE)
    return _current


def set_current(model):
    global _current
    _current = model
