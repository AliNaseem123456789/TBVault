"""
Routing: what does the customer want? (intent classification + query rewriting)

    "hi"                                   -> greeting            (rules, no LLM, no search)
    "show me wireless headphones"          -> product_search
    "only Sony under $200"  (follow-up)    -> product_search, query rewritten to
                                              "Sony wireless headphones", max_price 200
    "compare iPhone 13 Pro and Galaxy S10" -> product_comparison
    "how long do refunds take?"            -> policy_question
    "where is order 52?"                   -> order_tracking (order_id 52)
    "cancel my order 52"                   -> order_cancellation
    "track order 52 and do you sell lamps" -> two tasks = "multiple_intents"
    "what's the weather"                   -> out_of_scope
    "I want the blue one"  (no context)    -> clarification_needed

How:
  1. Obvious greetings/thanks are matched by rules: instant and free.
  2. Everything else goes to the FAST model, which must answer in JSON. The JSON is
     validated against the Route schema below; anything outside it is rejected, so the
     model can only *describe* the request — it can't call functions or skip permissions.
  3. No LLM key, or the model fails twice -> keyword rules (Phase 1 behaviour).

The router only classifies and extracts. Deciding whether a task needs a multi-step
plan lives in planner.py; choosing order tools lives in tools.py.
"""
import json
import logging
import re
from typing import Literal

from pydantic import BaseModel, Field

from app import catalog, llm, query_parser

log = logging.getLogger("router")

Intent = Literal[
    "greeting", "general_conversation", "product_search", "product_comparison", "policy_question",
    "order_tracking", "order_cancellation", "out_of_scope", "clarification_needed",
]


class SearchFilters(BaseModel, extra="forbid"):
    category: str | None = None
    brand: str | None = None
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    in_stock: bool = False
    on_sale: bool = False


class Task(BaseModel, extra="forbid"):
    intent: Intent
    query: str = Field(default="", max_length=300)             # standalone search text / question
    filters: SearchFilters = Field(default_factory=SearchFilters)
    products: list[str] = Field(default_factory=list, max_length=4)   # named products (comparison)
    search: str | None = Field(default=None, max_length=300)   # a SET to find first ("phones under $500")
    goal: str | None = Field(default=None, max_length=300)     # "recommend one for photography"
    order_id: int | None = Field(default=None, ge=1)
    question: str | None = Field(default=None, max_length=300)  # clarifying question to ask back


class Route(BaseModel, extra="forbid"):
    tasks: list[Task] = Field(min_length=1, max_length=3)

    @property
    def intent(self):
        return "multiple_intents" if len(self.tasks) > 1 else self.tasks[0].intent


# ----------------------------------------------------------------------------
# 1. rules
# ----------------------------------------------------------------------------
SMALL_TALK = re.compile(
    r"^\s*(hi+|hello+|hey+|hiya|yo|salam|assalam[ -]?o?[ -]?alaikum|aoa|good (morning|afternoon|evening)"
    r"|thanks?( (so|very) much| a lot)?|thank you( (so|very) much| a lot)?|thx|ty|ok(ay)?|cool|great|nice|got it"
    r"|bye|goodbye|see you"
    r"|how are you|who are you|what can you do)[\s!.?,]*(there|team|bot)?[\s!.?,]*$", re.I)

ORDER_ID = re.compile(r"(?:order\s*(?:no\.?|number|#)?\s*#?|#)\s*(\d{1,9})\b", re.I)
POLICY_WORDS = re.compile(r"\b(returns?|refunds?|exchanges?|shipping|deliver(y|ies)?|cod|cash on delivery|payments?|pay|"
                          r"gift cards?|store credit|wallet|polic(y|ies)|warrant(y|ies)|sell on|become a seller|seller account|"
                          r"commission|payouts?|tax|coupons?)\b", re.I)


def rule_route(message):
    """Keyword routing, used for greetings and as the fallback when the LLM is unavailable."""
    if SMALL_TALK.match(message):
        return Route(tasks=[Task(intent="greeting")])
    text = message.lower()
    order_match = ORDER_ID.search(message)
    order_id = int(order_match.group(1)) if order_match else None
    if "cancel" in text and ("order" in text or order_id):
        return Route(tasks=[Task(intent="order_cancellation", order_id=order_id)])
    if re.search(r"\b(my orders?|track|where is my|order status|delivered yet|shipped yet)\b", text) or order_id:
        return Route(tasks=[Task(intent="order_tracking", order_id=order_id)])
    if " vs " in f" {text} " or re.search(r"\b(compare|difference between)\b", text):
        names = [n.strip(" ?.") for n in re.split(r"\bvs\.?\b|\bversus\b|\band\b|,", re.sub(r"(?i)compare|difference between", "", message))]
        return Route(tasks=[Task(intent="product_comparison", query=message, products=[n for n in names if n][:4])])
    if POLICY_WORDS.search(text) and not re.search(r"\b(show|find|buy|looking for|need)\b", text):
        return Route(tasks=[Task(intent="policy_question", query=message)])
    search_text, f = query_parser.parse(message)
    return Route(tasks=[Task(intent="product_search", query=search_text, filters=SearchFilters(
        min_price=f.min_price, max_price=f.max_price, in_stock=f.in_stock, on_sale=f.on_sale))])


# ----------------------------------------------------------------------------
# 2. LLM
# ----------------------------------------------------------------------------
SYSTEM = """You route messages for TBVault, an online marketplace (prices in US dollars).
Read the conversation and the new MESSAGE, and reply with JSON only:

{"tasks": [ {
  "intent": one of greeting | general_conversation | product_search | product_comparison |
            policy_question | order_tracking | order_cancellation | out_of_scope | clarification_needed,
  "query": standalone text: for product_search the full product description to search for;
           for policy_question the full question,
  "filters": {"category": null, "brand": null, "min_price": null, "max_price": null,
              "in_stock": false, "on_sale": false},
  "products": [names of specific products, only for product_comparison],
  "search": null or a SET of products to find first for a comparison, e.g. "phones under $500",
  "goal": null or what to decide, e.g. "recommend one for photography" or "compare battery life",
  "order_id": null or the order number,
  "question": null or (clarification_needed only) the short question to ask back
} ] }

Rules:
- One task per distinct request. Most messages have exactly one. At most 3.
- Rewrite follow-ups into standalone requests using the conversation and PREVIOUS SEARCH.
  "only Sony under 200" after a headphones search -> query "Sony wireless headphones",
  brand "Sony", max_price 200. Keep earlier constraints unless the customer changes or drops them.
- A new, unrelated product request starts fresh: do not carry old filters into it.
- Put prices, brand, category, stock and sale constraints in filters, AND keep the product words
  in query. Use a category from CATEGORIES only if it clearly matches, else null.
- Several filters in one search are still ONE product_search task.
- "which is better / compare / vs" between named products -> product_comparison with products.
- Questions about shipping, returns, refunds, payment, cancellation rules, store credit, gift cards,
  selling on TBVault -> policy_question (unless they ask to act on a specific order).
- "where is my order", "status of order 12", "my orders" -> order_tracking.
- "cancel order 12" -> order_cancellation. Never invent an order_id.
- Requests unrelated to shopping here -> out_of_scope.
- Too vague to act on (e.g. "the blue one" with no context) -> clarification_needed with a question."""


def _llm_route(message, history, previous):
    categories = ", ".join(c["name"] for c in catalog.categories())
    turns = "\n".join(f"{t['role'].upper()}: {str(t['content'])[:400]}" for t in (history or [])[-6:])
    user = (f"CATEGORIES: {categories}\n"
            f"PREVIOUS SEARCH: {json.dumps(previous) if previous else 'none'}\n"
            f"CONVERSATION:\n{turns or '(start)'}\n\nMESSAGE: {message}")
    return llm.ask_json(SYSTEM, user, Route, purpose="route")


def route(message, history=None, previous=None):
    """previous = the state returned with the last answer: {"query", "filters"} of the last search."""
    if SMALL_TALK.match(message):
        return Route(tasks=[Task(intent="greeting")]), "rules"
    if llm.enabled():
        try:
            return _llm_route(message, history, previous), "llm"
        except llm.LLMError as err:
            log.warning("LLM routing failed, using keyword rules: %s", err)
    return rule_route(message), "rules"


# ----------------------------------------------------------------------------
# names -> ids
# ----------------------------------------------------------------------------
def _match(name, rows):
    if not name:
        return None
    name = name.strip().lower()
    exact = [r for r in rows if r["name"].lower() == name]
    if exact:
        return exact[0]
    loose = [r for r in rows if name in r["name"].lower() or r["name"].lower() in name]
    return loose[0] if len(loose) == 1 else None


def to_search_filters(f: SearchFilters):
    """Router filters (names) -> retrieval Filters (ids). Unknown names are simply dropped;
    the words are still in the query text, so the keyword side can use them."""
    brand = _match(f.brand, catalog.brands())
    category = _match(f.category, catalog.categories())
    filters = query_parser.Filters(min_price=f.min_price, max_price=f.max_price, in_stock=f.in_stock, on_sale=f.on_sale)
    if f.min_price is not None and f.max_price is not None and f.min_price > f.max_price:
        filters.min_price, filters.max_price = f.max_price, f.min_price
    if brand:
        filters.brand_id = brand["id"]
        filters.guessed.append("brand_id")       # still double-checked by retrieval
    if category:
        filters.category_id = category["id"]
        filters.guessed.append("category_id")
    return filters
