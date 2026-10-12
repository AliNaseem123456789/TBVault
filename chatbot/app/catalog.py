"""
Reading products from Postgres — the source of truth.

Pinecone only tells us WHICH products look relevant. Prices, stock, sales and
whether a product may be shown at all always come from here, so a stale
vector can never show a wrong price or a hidden product.

"Public" means the same as on the shop: not hidden, and sold by an approved seller.
"""
from app import db

PRODUCT_SQL = """
SELECT p.id, p.name, p.description, p.price, p.stock, p.is_hidden, p.updated_at,
       p.category_id, c.name AS category_name,
       p.brand_id, b.name AS brand_name,
       s.id AS seller_id, s.store_name AS seller_name, s.slug AS seller_slug,
       s.status::text AS seller_status,
       -- the biggest live sale for this product or its category (same rule as the shop)
       (SELECT MAX(sa.percent_off) FROM sales sa
         WHERE sa.is_active AND sa.starts_at <= now() AND sa.ends_at > now()
           AND (sa.product_id = p.id OR sa.category_id = p.category_id)) AS sale_percent,
       (SELECT ROUND(AVG(r.rating)::numeric, 1) FROM reviews r
         WHERE r.product_id = p.id AND NOT r.is_hidden) AS rating,
       COALESCE((SELECT json_agg(json_build_object('id', v.id, 'name', v.name, 'sku', v.sku,
                                                   'price', v.price, 'stock', v.stock)
                                 ORDER BY v.sort_order, v.id)
                   FROM product_variants v WHERE v.product_id = p.id AND v.is_active), '[]') AS variants,
       COALESCE((SELECT json_agg(json_build_object('id', i.id, 'key', i.key, 'is_primary', i.is_primary)
                                 ORDER BY i.is_primary DESC, i.id)
                   FROM product_images i WHERE i.product_id = p.id), '[]') AS images
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN sellers s ON s.id = p.seller_id
  LEFT JOIN brands b ON b.id = p.brand_id
"""

PUBLIC_WHERE = "NOT p.is_hidden AND s.status = 'APPROVED'"


def is_public(row):
    return not row["is_hidden"] and row["seller_status"] == "APPROVED"


def get_products(ids, public_only=True):
    """Products by id, in the same order as `ids`. Missing/hidden ones are left out."""
    ids = [int(i) for i in dict.fromkeys(ids)]   # unique, order kept
    if not ids:
        return []
    where = "p.id = ANY(%s)" + (f" AND {PUBLIC_WHERE}" if public_only else "")
    rows = db.query(f"{PRODUCT_SQL} WHERE {where}", (ids,))
    by_id = {row["id"]: row for row in rows}
    return [by_id[i] for i in ids if i in by_id]


def public_product_ids():
    rows = db.query(f"SELECT p.id FROM products p JOIN sellers s ON s.id = p.seller_id WHERE {PUBLIC_WHERE} ORDER BY p.id")
    return [row["id"] for row in rows]


def product_ids_where(seller_id=None, brand_id=None, category_id=None):
    """Every product (public or not) of a seller / brand / category. Used when one of those changes."""
    column, value = next((c, v) for c, v in
                         (("seller_id", seller_id), ("brand_id", brand_id), ("category_id", category_id))
                         if v is not None)
    rows = db.query(f"SELECT id FROM products WHERE {column} = %s", (int(value),))
    return [row["id"] for row in rows]


def product_ids_by_sku(text):
    """Exact SKU lookup — vectors are fuzzy, an SKU must match exactly."""
    rows = db.query("SELECT DISTINCT product_id FROM product_variants WHERE is_active AND lower(sku) = lower(%s)",
                    (text.strip(),))
    return [row["product_id"] for row in rows]


def brands():
    return db.query("SELECT id, name FROM brands ORDER BY name")


def categories():
    return db.query("SELECT id, name FROM categories ORDER BY name")


# ----------------------------------------------------------------------------
# Prices and stock, computed exactly like the shop does
# ----------------------------------------------------------------------------
def _sale_price(list_price, percent):
    cents = round(float(list_price) * 100)
    return round(cents * (100 - percent) / 100) / 100 if percent else None


def in_stock(row):
    variants = row["variants"]
    return any(v["stock"] > 0 for v in variants) if variants else row["stock"] > 0


def lowest_price(row):
    """What the cheapest option costs right now (sale included)."""
    percent = row["sale_percent"] or 0
    list_prices = [v["price"] if v["price"] is not None else row["price"] for v in row["variants"]] or [row["price"]]
    return min(_sale_price(p, percent) or float(p) for p in list_prices)


def to_public(row):
    """Shape a row like GET /api/products returns it, so the frontend can reuse its product helpers."""
    percent = row["sale_percent"] or 0
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "price": f"{float(row['price']):.2f}",
        "sale_percent": percent or None,
        "sale_price": f"{_sale_price(row['price'], percent):.2f}" if percent else None,
        "stock": row["stock"],
        "in_stock": in_stock(row),
        "lowest_price": f"{lowest_price(row):.2f}",
        "rating": float(row["rating"]) if row["rating"] is not None else None,
        "category": {"id": row["category_id"], "name": row["category_name"]},
        "brand": {"id": row["brand_id"], "name": row["brand_name"]} if row["brand_id"] else None,
        "seller": {"id": row["seller_id"], "store_name": row["seller_name"], "slug": row["seller_slug"]},
        "images": [{"id": i["id"], "key": i["key"]} for i in row["images"]],
        "variants": [
            {
                "id": v["id"], "name": v["name"], "stock": v["stock"], "is_active": True,
                "price": None if v["price"] is None else f"{float(v['price']):.2f}",
                "effective_list_price": f"{float(v['price'] if v['price'] is not None else row['price']):.2f}",
                "sale_price": (f"{_sale_price(v['price'] if v['price'] is not None else row['price'], percent):.2f}"
                               if percent else None),
            }
            for v in row["variants"]
        ],
    }
