"""
The chat answer: the "AG" in RAG (augmented generation).

    message ──► query_parser (filters) ──► retrieval (products from Postgres)
            ──► build_context(products)  (a short, numbered fact sheet)
            ──► LLM: "answer ONLY from this fact sheet"  ──► answer + the same products

Rules that keep the bot honest:
  - The LLM never sees the whole catalog, only the top few retrieved products.
  - Prices/stock in the fact sheet come from Postgres, not from Pinecone.
  - The system prompt forbids inventing anything not in the fact sheet.
  - No GROQ_API_KEY, or the LLM fails? We still return the products with a plain
    template answer. Search never depends on the LLM.

Only the current message is used for searching. Earlier messages are passed to the
LLM so replies read naturally, but rewriting follow-ups like "cheaper ones?" into a
full query is Phase 2 (query rewriting).
"""
import logging
from functools import lru_cache

from app import config, query_parser, retrieval

log = logging.getLogger("chat")

SYSTEM_PROMPT = """You are the shopping assistant of TBVault, an online marketplace.

Answer using ONLY the products in the PRODUCTS section of the user's message.
- Never invent products, prices, stock, specifications, discounts or policies.
- Mention products by their exact name and price as listed. If a product is on sale, say so.
- If none of the products fit what the customer asked, say so honestly and suggest how they could rephrase.
- If the PRODUCTS section is empty, say you couldn't find a match.
- Questions about orders, shipping, returns or accounts: say you can only help find products for now,
  and point them to the Orders or Help pages.
- Keep it short and friendly: 2-5 sentences, or a short list. The products are shown as cards
  under your reply, so don't paste links or image URLs."""


@lru_cache(maxsize=None)
def _groq():
    from groq import Groq
    return Groq(api_key=config.GROQ_API_KEY, timeout=config.LLM_TIMEOUT_SECONDS)


def llm_enabled():
    return bool(config.GROQ_API_KEY)


def build_context(products):
    """A numbered fact sheet the LLM may quote from."""
    if not products:
        return "PRODUCTS: (none found)"
    lines = ["PRODUCTS:"]
    for n, p in enumerate(products[:config.CHAT_PRODUCTS_IN_PROMPT], 1):
        price = f"${p['lowest_price']}"
        if p["sale_percent"]:
            price += f" (on sale, {p['sale_percent']}% off; was ${p['price']})"
        facts = [
            f"[{n}] {p['name']}",
            f"price {price}" + (" (price depends on option)" if p["variants"] else ""),
            "in stock" if p["in_stock"] else "out of stock",
            f"category {p['category']['name']}",
        ]
        if p["brand"]:
            facts.append(f"brand {p['brand']['name']}")
        facts.append(f"sold by {p['seller']['store_name']}")
        if p["rating"]:
            facts.append(f"rating {p['rating']}/5")
        if p["variants"]:
            facts.append("options: " + ", ".join(v["name"] for v in p["variants"][:6]))
        description = " ".join((p["description"] or "").split())[:300]
        if description:
            facts.append(f"about: {description}")
        lines.append(" | ".join(facts))
    return "\n".join(lines)


def _fallback_answer(products, from_image):
    if not products:
        return "I couldn't find a matching product. Try different words, or fewer filters."
    lead = "Here's what looks most like your photo:" if from_image else "Here's what I found:"
    return lead + "\n" + "\n".join(f"- {p['name']} — ${p['lowest_price']}" for p in products[:5])


def _ask_llm(message, history, context):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in (history or [])[-config.CHAT_HISTORY_TURNS:]:
        if turn.get("role") in ("user", "assistant") and turn.get("content"):
            messages.append({"role": turn["role"], "content": str(turn["content"])[:1000]})
    messages.append({"role": "user", "content": f"{context}\n\nCUSTOMER: {message}"})

    options = {"model": config.LLM_MODEL, "messages": messages, "temperature": 0.2, "max_tokens": 1024}
    if "gpt-oss" in config.LLM_MODEL:
        options["reasoning_effort"] = "low"   # quick answers; these questions don't need deep thinking
    reply = _groq().chat.completions.create(**options)
    return (reply.choices[0].message.content or "").strip()


def answer(message, history=None, image_bytes=None, limit=None):
    limit = limit or config.CHAT_PRODUCTS_IN_PROMPT   # show the same products the LLM talks about
    search_text, filters = query_parser.parse(message or "")
    if image_bytes:
        result = retrieval.search_by_image(image_bytes, filters, limit)
        question = message or "Find products that look like this photo."
    else:
        result = retrieval.search_products(search_text, filters, limit)
        question = message
    products = result["products"]

    reply, used_llm = None, False
    if llm_enabled():
        try:
            context = build_context(products)
            if image_bytes:
                context = "The customer uploaded a photo; these products looked most similar.\n" + context
            reply = _ask_llm(question, history, context)
            used_llm = bool(reply)
        except Exception as err:   # LLM down/slow: still answer with the products
            log.warning("LLM failed, using template answer: %s", err)
    if not reply:
        reply = _fallback_answer(products, bool(image_bytes))

    return {"answer": reply, "products": products, "applied": result["applied"],
            "llm": used_llm, "debug": result["debug"]}
