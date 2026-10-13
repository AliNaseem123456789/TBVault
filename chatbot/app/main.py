"""
The HTTP API (FastAPI). Run it with:   uvicorn app.main:app --port 8000

Browsers don't call this directly: the Node backend forwards /api/chat and
/api/search/... here (backend/src/modules/chatbot).

  GET  /health                     is everything configured?
  GET  /search?query=...           hybrid product search (+ optional filters)
  POST /search/image               form-data: image=<file>  OR  query=<text describing a look>
  POST /chat                       JSON {message, history, state?}   header X-User-Token (optional)
  POST /chat/image                 form-data: image=<file>, message=<optional text>
  POST /chat/feedback              JSON {request_id, rating: up|down, intent?, comment?}
  GET  /metrics                    Prometheus metrics (Phase 3)

Add ?debug=true to see retrieval scores (kept out of normal responses).
"""
import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi.concurrency import run_in_threadpool
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

from app import chat, config, metrics, retrieval
from app.query_parser import Filters
from app.router import SearchFilters

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")

app = FastAPI(title="TBVault chatbot")


def check_key(x_internal_key: str | None = Header(default=None)):
    if config.INTERNAL_KEY and x_internal_key != config.INTERNAL_KEY:
        raise HTTPException(status_code=401, detail="Missing or wrong X-Internal-Key")


def _run(work):
    """Runs a search and turns failures into clear HTTP errors.
    (Image endpoints are async to read the upload, so they run this in a worker thread
    with run_in_threadpool: model and network calls would otherwise block the server.)"""
    try:
        return work()
    except ValueError as err:          # bad input, e.g. not an image
        raise HTTPException(status_code=400, detail=str(err))
    except HTTPException:
        raise
    except Exception as err:           # Pinecone / database / model problem
        log.exception("search failed")
        raise HTTPException(status_code=503, detail=f"Search is unavailable right now ({type(err).__name__})")


def _public(result, debug):
    return result if debug else {k: v for k, v in result.items() if k != "debug"}


async def _read_image(image):
    data = await image.read()
    if len(data) > config.MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Images must be 5 MB or smaller")
    if not data:
        raise HTTPException(status_code=400, detail="The image is empty")
    return data


@app.get("/metrics")
def prometheus_metrics():
    """Prometheus scrapes this (see backend/monitoring/prometheus.yml). Keep port 8000 private."""
    return Response(metrics.exposition(), media_type="text/plain; version=0.0.4")


class Feedback(BaseModel, extra="forbid"):
    request_id: str = Field(pattern=r"^[a-f0-9]{8,32}$")
    rating: Literal["up", "down"]
    intent: Literal["greeting", "general_conversation", "product_search", "product_comparison", "policy_question",
                    "order_tracking", "order_cancellation", "out_of_scope", "clarification_needed",
                    "multiple_intents", "photo_search", "unknown"] = "unknown"
    comment: str | None = Field(default=None, max_length=500)


@app.post("/chat/feedback", dependencies=[Depends(check_key)])
def chat_feedback(body: Feedback):
    """Thumbs up/down on one answer. Joined to the request log by request_id."""
    metrics.FEEDBACK.labels(body.intent, body.rating).inc()
    record = body.model_dump()
    record["comment"] = metrics.redact(record["comment"])
    metrics.write_log({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **record}, kind="feedback")
    return {"ok": True}


@app.get("/health")
def health():
    llm_on = chat.llm_enabled()
    return {"ok": True, "llm": llm_on, "llm_model": config.LLM_MODEL if llm_on else None,
            "fast_llm_model": config.FAST_LLM_MODEL if llm_on else None, "rerank": config.RERANK,
            "text_index": config.TEXT_INDEX_NAME, "image_index": config.IMAGE_INDEX_NAME}


@app.get("/search", dependencies=[Depends(check_key)])
def search(
    query: str = Query(min_length=1, max_length=200),
    category_id: int | None = Query(default=None, ge=1),
    brand_id: int | None = Query(default=None, ge=1),
    seller_id: int | None = Query(default=None, ge=1),
    min_price: float | None = Query(default=None, ge=0),
    max_price: float | None = Query(default=None, ge=0),
    in_stock: bool = False,
    on_sale: bool = False,
    limit: int = Query(default=config.DEFAULT_LIMIT, ge=1, le=config.MAX_LIMIT),
    debug: bool = False,
):
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(status_code=400, detail="min_price can't be more than max_price")
    filters = Filters(category_id=category_id, brand_id=brand_id, seller_id=seller_id,
                      min_price=min_price, max_price=max_price, in_stock=in_stock, on_sale=on_sale)
    return _public(_run(lambda: retrieval.search_products(query.strip(), filters, limit)), debug)


@app.post("/search/image", dependencies=[Depends(check_key)])
async def search_image(
    image: UploadFile | None = File(default=None),
    query: str | None = Form(default=None, max_length=200),
    limit: int = Form(default=config.DEFAULT_LIMIT, ge=1, le=config.MAX_LIMIT),
    debug: bool = False,
):
    if image is not None:
        data = await _read_image(image)
        return _public(await run_in_threadpool(_run, lambda: retrieval.search_by_image(data, None, limit)), debug)
    if query and query.strip():
        return _public(await run_in_threadpool(_run, lambda: retrieval.search_images_by_text(query.strip(), None, limit)), debug)
    raise HTTPException(status_code=400, detail="Send an image or a query")


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class SearchState(BaseModel, extra="forbid"):
    """What the last answer searched for; sent back by the browser so follow-ups can refine it."""
    query: str | None = Field(default=None, max_length=300)
    filters: SearchFilters = Field(default_factory=SearchFilters)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=20)
    state: SearchState | None = None


@app.post("/chat", dependencies=[Depends(check_key)])
def chat_message(body: ChatRequest, debug: bool = False, x_user_token: str | None = Header(default=None)):
    """X-User-Token: the signed-in customer's access token, forwarded by the Node backend.
    It's only used to call the Node API *as that customer* (order tools); never logged."""
    history = [turn.model_dump() for turn in body.history]
    state = body.state.model_dump(exclude_defaults=True) if body.state else None
    return _public(_run(lambda: chat.answer(body.message.strip(), history, state=state, user_token=x_user_token)), debug)


@app.post("/chat/image", dependencies=[Depends(check_key)])
async def chat_image(
    image: UploadFile = File(...),
    message: str | None = Form(default=None, max_length=1000),
    debug: bool = False,
):
    data = await _read_image(image)
    answer = await run_in_threadpool(_run, lambda: chat.answer((message or "").strip(), None, image_bytes=data))
    return _public(answer, debug)
