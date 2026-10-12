"""
Dense vectors ("embeddings"): lists of numbers where similar meaning = nearby vectors.

Three models, all run locally through fastembed (ONNX, no PyTorch needed).
The first use downloads each model from Hugging Face into chatbot/data/models.

  embed_texts / embed_query  -> all-MiniLM-L6-v2, 384 numbers. For the product text index.
  clip_text                  -> CLIP text encoder, 512 numbers.  For "describe a picture" searches.
  clip_images                -> CLIP image encoder, 512 numbers. For product photos / uploaded photos.

MiniLM vectors and CLIP vectors live in different "spaces" and must never be
compared with each other. That's why they go into two separate Pinecone indexes.
CLIP's text and image encoders were trained together, so clip_text("red shoe")
lands near clip_images([photo of a red shoe]).

All vectors are scaled to length 1, so a dot product equals cosine similarity.
"""
import io
from functools import lru_cache

import numpy as np
from PIL import Image

from app import config


@lru_cache(maxsize=None)
def _text_model():
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=config.TEXT_MODEL, cache_dir=str(config.MODEL_CACHE_DIR))


@lru_cache(maxsize=None)
def _clip_text_model():
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=config.CLIP_TEXT_MODEL, cache_dir=str(config.MODEL_CACHE_DIR))


@lru_cache(maxsize=None)
def _clip_image_model():
    from fastembed import ImageEmbedding
    return ImageEmbedding(model_name=config.CLIP_IMAGE_MODEL, cache_dir=str(config.MODEL_CACHE_DIR))


def _unit(vector):
    vector = np.asarray(vector, dtype=np.float32)
    norm = np.linalg.norm(vector)
    return (vector / norm if norm else vector).tolist()


def embed_texts(texts):
    return [_unit(v) for v in _text_model().embed(list(texts))]


def embed_query(text):
    return embed_texts([text])[0]


def clip_text(text):
    return _unit(next(iter(_clip_text_model().embed([text]))))


def open_image(data):
    """Bytes -> RGB picture. Raises ValueError for anything that isn't an image."""
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as err:
        raise ValueError("That file isn't an image we can read") from err
    return image.convert("RGB")


def clip_images(images):
    """images: list of PIL images (use open_image for bytes)."""
    return [_unit(v) for v in _clip_image_model().embed(list(images))]
