"""
Cheap automatic checks on every LLM answer (no extra LLM call).

  unsupported_prices  prices in the answer that appear nowhere in the facts it was given.
                      An invented price is the most damaging hallucination in a shop,
                      and it's easy to catch: every real price is in the fact sheet.
  products_cited      how many of the products shown as cards the answer actually names.
                      0 of 5 usually means the answer ignored the retrieved products.

Results go to chatbot_answer_checks_total and the request log. For a deeper,
LLM-graded measure of faithfulness, run `python -m app.cli eval-answers`.
"""
import re

PRICE = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)")


def prices_in(text):
    return {f"{float(m.replace(',', '')):.2f}" for m in PRICE.findall(text or "")}


def check_answer(answer, context, products=()):
    known = prices_in(context)
    for p in products:   # the cards' prices (and their options' prices) count as known facts too
        values = [p.get("price"), p.get("sale_price"), p.get("lowest_price")]
        for v in p.get("variants") or []:
            values += [v.get("effective_list_price"), v.get("sale_price")]
        known |= {f"{float(v):.2f}" for v in values if v}
    unsupported = sorted(prices_in(answer) - known)
    lowered = (answer or "").lower()
    cited = [p["id"] for p in products if p.get("name") and p["name"].lower() in lowered]
    return {"unsupported_prices": unsupported, "products_cited": len(cited), "products_shown": len(products)}
