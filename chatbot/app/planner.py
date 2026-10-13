"""
Planning, only for tasks that need several lookups before one answer.

    "Find phones under $500, compare their cameras with the iPhone 13 Pro, recommend one for photos"
      -> plan: search_products("phones", max_price 500)
               get_product("iPhone 13 Pro")
         goal: compare cameras, recommend for photography      (done by the answer model)

needs_plan() decides — with plain rules, separate from intent classification:
  only a product_comparison that must first FIND a set of products ("search") gets a plan.
  "compare iPhone 13 and Galaxy S10" is just two lookups -> no planner.
  "Samsung phones under $300 in stock" is one search, however many filters -> no planner.

The plan comes from the FAST model as JSON and is validated: only the operations in
Step.op exist, at most 5 steps. Anything else is rejected and a simple fixed plan is used.
"""
import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from app import llm
from app.router import SearchFilters, Task

log = logging.getLogger("planner")


class Step(BaseModel, extra="forbid"):
    op: Literal["search_products", "get_product", "lookup_policy"]
    query: str = Field(min_length=1, max_length=200)
    filters: SearchFilters = Field(default_factory=SearchFilters)


class Plan(BaseModel, extra="forbid"):
    steps: list[Step] = Field(min_length=1, max_length=5)
    goal: str = Field(default="", max_length=300)


def needs_plan(task: Task):
    return task.intent == "product_comparison" and bool(task.search)


SYSTEM = """You plan lookups for a shopping assistant. Reply with JSON only:
{"steps": [{"op": "search_products" | "get_product" | "lookup_policy", "query": "...",
            "filters": {"category": null, "brand": null, "min_price": null, "max_price": null,
                        "in_stock": false, "on_sale": false}}],
 "goal": "what the final answer must do"}
- search_products: find a SET of products (use filters for price/brand/stock).
- get_product: find ONE specific named product.
- lookup_policy: read a store policy (warranty, returns, shipping...).
- Use as few steps as possible (max 5). Don't add steps for comparing or recommending:
  the goal covers that."""


def fallback_plan(task: Task):
    steps = [Step(op="search_products", query=task.search, filters=task.filters)]
    steps += [Step(op="get_product", query=name) for name in task.products[:3]]
    return Plan(steps=steps, goal=task.goal or "compare these products")


def make_plan(task: Task, message):
    if llm.enabled():
        try:
            details = json.dumps(task.model_dump(include={"search", "products", "goal", "filters"}))
            return llm.ask_json(SYSTEM, f"REQUEST: {message}\nEXTRACTED: {details}", Plan, purpose="plan"), "llm"
        except llm.LLMError as err:
            log.warning("planner failed, using the simple plan: %s", err)
    return fallback_plan(task), "rules"
