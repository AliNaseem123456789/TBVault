"""
All settings in one place, read from environment variables.

Values come from chatbot/.env first. Anything missing there (database, S3,
RabbitMQ) is read from backend/.env, so you don't have to copy them twice.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

CHATBOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = CHATBOT_DIR.parent / "backend"

load_dotenv(CHATBOT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")  # does not override values already set above


def _str(name, default=""):
    return os.getenv(name, default).strip()


def _int(name, default):
    return int(os.getenv(name, default))


def _float(name, default):
    return float(os.getenv(name, default))


# --- Postgres (the source of truth) ---------------------------------------
DATABASE_URL = _str("DATABASE_URL")
DB_SSL_CA_FILE = _str("DB_SSL_CA_FILE")  # set for AWS RDS; relative paths are resolved from backend/

# --- Pinecone (the search index) --------------------------------------------
PINECONE_API_KEY = _str("PINECONE_API_KEY")
PINECONE_CLOUD = _str("PINECONE_CLOUD", "aws")
PINECONE_REGION = _str("PINECONE_REGION", "us-east-1")  # the free plan only offers aws/us-east-1
TEXT_INDEX_NAME = _str("PINECONE_TEXT_INDEX", "tbvault-products")
IMAGE_INDEX_NAME = _str("PINECONE_IMAGE_INDEX", "tbvault-images")

# --- Models ----------------------------------------------------------------
# Text: all-MiniLM-L6-v2 gives 384 numbers per text.
TEXT_MODEL = _str("TEXT_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
TEXT_DIM = 384
# Images: CLIP. The text half and the image half put their vectors in the SAME
# space, so "red sneakers" (text) can be compared with a photo of sneakers.
CLIP_TEXT_MODEL = _str("CLIP_TEXT_MODEL", "Qdrant/clip-ViT-B-32-text")
CLIP_IMAGE_MODEL = _str("CLIP_IMAGE_MODEL", "Qdrant/clip-ViT-B-32-vision")
IMAGE_DIM = 512
MODEL_CACHE_DIR = CHATBOT_DIR / "data" / "models"   # downloaded once (~600 MB for all three)

# Bump this when you change how products are turned into text or vectors,
# then run `python -m app.cli reindex`. It is stored on every vector.
INDEX_VERSION = _str("INDEX_VERSION", "v1")
BM25_PARAMS_FILE = CHATBOT_DIR / "data" / "bm25_params.json"

# --- Retrieval knobs -------------------------------------------------------
HYBRID_ALPHA = _float("HYBRID_ALPHA", "0.5")      # 1.0 = only meaning, 0.0 = only keywords
CANDIDATES = _int("SEARCH_CANDIDATES", "40")      # how many hits to pull from Pinecone before checking Postgres
# Pinecone always returns top_k hits, even unrelated ones. Hits scoring below
# MIN_SCORE_RATIO x the best hit's score are dropped (0 = keep everything).
MIN_SCORE_RATIO = _float("MIN_SCORE_RATIO", "0.4")
# CLIP photo scores are bunched together (unrelated photos still score ~0.5-0.7),
# so photo search needs a much tighter cutoff.
IMAGE_MIN_SCORE_RATIO = _float("IMAGE_MIN_SCORE_RATIO", "0.8")
DEFAULT_LIMIT = _int("SEARCH_DEFAULT_LIMIT", "8")
MAX_LIMIT = 20
IMAGES_PER_PRODUCT = _int("IMAGES_PER_PRODUCT", "3")
MAX_IMAGE_BYTES = 5 * 1024 * 1024

# --- LLM (optional: search works without it) ---------------------------------
GROQ_API_KEY = _str("GROQ_API_KEY")
LLM_MODEL = _str("LLM_MODEL", "openai/gpt-oss-120b")
LLM_TIMEOUT_SECONDS = _int("LLM_TIMEOUT_SECONDS", "30")
CHAT_PRODUCTS_IN_PROMPT = 6   # how many products the LLM sees
CHAT_HISTORY_TURNS = 6        # how many earlier messages the LLM sees

# --- Images in S3 (same settings as the backend) ----------------------------
S3_BUCKET = _str("S3_BUCKET", "tbvault")
S3_REGION = _str("S3_REGION", "us-east-1")
S3_ENDPOINT = _str("S3_ENDPOINT")          # only for MinIO
S3_ACCESS_KEY_ID = _str("S3_ACCESS_KEY_ID")
S3_SECRET_ACCESS_KEY = _str("S3_SECRET_ACCESS_KEY")

# --- RabbitMQ (keeps the index in sync when products change) -----------------
RABBITMQ_URL = _str("RABBITMQ_URL", "amqp://localhost")
CATALOG_EXCHANGE = "catalog.events"
SYNC_QUEUE = "chatbot.catalog-sync"
SYNC_FAILED_QUEUE = "chatbot.catalog-sync.failed"
SYNC_MAX_ATTEMPTS = 5

# --- API -------------------------------------------------------------------
# When set, every request must send the same value in the X-Internal-Key header.
# The Node backend does; browsers never talk to this service directly.
INTERNAL_KEY = _str("CHATBOT_INTERNAL_KEY")
