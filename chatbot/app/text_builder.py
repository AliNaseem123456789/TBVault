"""
Turns one product into the text we search over ("the document").

One product = one document. Product descriptions are short, so we don't cut
them into chunks. Instead we put a fixed "context prefix" in front (name,
category, brand, seller, options), so the description is always read together
with what it describes. That is "contextual retrieval" done without an LLM:
the same input always gives the same text.

The most important facts go first: the text model reads at most ~256 word-pieces,
so if anything gets cut off, it's the end of a long description.
"""
MAX_DESCRIPTION_CHARS = 1200


def product_document(row):
    parts = [f"Product: {row['name']}."]
    parts.append(f"Category: {row['category_name']}.")
    if row.get("brand_name"):
        parts.append(f"Brand: {row['brand_name']}.")
    parts.append(f"Sold by: {row['seller_name']}.")
    options = [v["name"] for v in row.get("variants") or []]
    if options:
        parts.append("Options: " + ", ".join(options[:12]) + ".")
    description = " ".join((row.get("description") or "").split())   # squash newlines and extra spaces
    if description:
        parts.append("Description: " + description[:MAX_DESCRIPTION_CHARS])
    return " ".join(parts)
