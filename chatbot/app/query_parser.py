"""
Pulls hard filters out of a plain-English chat message, with simple rules (no LLM).

    "samsung phones under $300 in stock"
      -> query "samsung phones", brand Samsung, max_price 300, in_stock True

Why bother: vectors find what's *similar*, they can't enforce "under $300".
Numbers like that must be checked against real prices in Postgres.

Brand and category are only picked up when their exact name appears in the
message. If that turns out too strict (e.g. "apple juice" matching the brand
Apple), retrieval.py retries without them.

Phase 2 replaces these rules with LLM tool calling; the Filters it fills stay the same.
"""
import re
import time
from dataclasses import dataclass, field

from app import catalog


@dataclass
class Filters:
    category_id: int | None = None
    brand_id: int | None = None
    seller_id: int | None = None
    min_price: float | None = None
    max_price: float | None = None
    in_stock: bool = False
    on_sale: bool = False
    # which of category/brand came from guessing (so they may be dropped if nothing matches)
    guessed: list = field(default_factory=list)

    def describe(self):
        """For the response, so the UI/LLM can say what was applied."""
        return {k: v for k, v in self.__dict__.items() if v not in (None, False, [])}


NUMBER = r"\$?\s*(\d+(?:[.,]\d+)?)"
PRICE_RULES = [
    (re.compile(rf"\bbetween\s+{NUMBER}\s+(?:and|to|-)\s+{NUMBER}"), "range"),
    (re.compile(rf"\$\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*\$?\s*(\d+(?:\.\d+)?)"), "range"),
    (re.compile(rf"\b(?:under|below|less than|cheaper than|up to|max(?:imum)?|at most|within)\s+{NUMBER}"), "max"),
    (re.compile(rf"\b(?:over|above|more than|at least|min(?:imum)?|starting at|from)\s+{NUMBER}"), "min"),
]
IN_STOCK = re.compile(r"\b(?:in stock|available now|available)\b")
ON_SALE = re.compile(r"\b(?:on sale|discount(?:ed)?|deals?)\b")

_cache = {"at": 0.0, "brands": [], "categories": []}


def _names():
    """Brands and categories from Postgres, refreshed every 5 minutes."""
    if time.time() - _cache["at"] > 300:
        _cache["brands"] = catalog.brands()
        _cache["categories"] = catalog.categories()
        _cache["at"] = time.time()
    return _cache["brands"], _cache["categories"]


def _number(text):
    return float(text.replace(",", ""))


def _find_name(text, rows):
    """Longest name that appears as whole words in the text."""
    for row in sorted(rows, key=lambda r: -len(r["name"])):
        name = row["name"].lower().replace("-", " ")
        variants = {name, name.rstrip("s")}
        for variant in variants:
            if len(variant) >= 3 and re.search(rf"\b{re.escape(variant)}s?\b", text):
                return row
    return None


def parse(message, brands=None, categories=None):
    """Returns (search_text, Filters)."""
    text = " ".join(message.lower().split())
    filters = Filters()

    for pattern, kind in PRICE_RULES:
        match = pattern.search(text)
        if not match:
            continue
        if kind == "range":
            low, high = sorted((_number(match.group(1)), _number(match.group(2))))
            filters.min_price, filters.max_price = low, high
        elif kind == "max" and filters.max_price is None:
            filters.max_price = _number(match.group(1))
        elif kind == "min" and filters.min_price is None:
            filters.min_price = _number(match.group(1))
        text = text.replace(match.group(0), " ")

    if IN_STOCK.search(text):
        filters.in_stock = True
        text = IN_STOCK.sub(" ", text)
    if ON_SALE.search(text):
        filters.on_sale = True
        text = ON_SALE.sub(" ", text)

    if brands is None or categories is None:
        brands, categories = _names()
    brand = _find_name(text.replace("-", " "), brands)
    if brand:
        filters.brand_id = brand["id"]
        filters.guessed.append("brand_id")
    category = _find_name(text.replace("-", " "), categories)
    if category:
        filters.category_id = category["id"]
        filters.guessed.append("category_id")

    # The brand/category words stay in the search text: they help the keyword side too.
    search_text = " ".join(text.replace("$", " ").split()) or message
    return search_text, filters
