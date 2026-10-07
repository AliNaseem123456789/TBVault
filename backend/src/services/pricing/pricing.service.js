import prisma from "../../config/db.js"
import { bestSaleFor, salePriceCents, toCents, formatCents } from "../../utils/pricing.helpers.js"

/** Live sales that could apply to these products (by product id or category id). */
export const loadLiveSales = async (products, db = prisma, now = new Date()) => {
    if (!products.length) return []
    const productIds = [...new Set(products.map((p) => p.id))]
    const categoryIds = [...new Set(products.map((p) => p.category_id).filter(Boolean))]
    return db.sale.findMany({
        where: {
            is_active: true,
            starts_at: { lte: now },
            ends_at: { gt: now },
            OR: [{ product_id: { in: productIds } }, { category_id: { in: categoryIds } }],
        },
    })
}

/**
 * Adds sale pricing to products for the storefront:
 *   product.sale_percent / sale_price / sale_ends_at  (null when not on sale)
 *   variant.sale_price for each loaded variant
 * `price` stays the list price, so the UI can strike it through.
 */
export const withSalePricing = async (products, db = prisma, now = new Date()) => {
    const list = Array.isArray(products) ? products : [products]
    const sales = await loadLiveSales(list, db, now)
    const priced = list.map((product) => {
        const sale = bestSaleFor(sales, { productId: product.id, categoryId: product.category_id, now })
        const percent = sale?.percent ?? 0
        const out = {
            ...product,
            sale_percent: percent || null,
            sale_price: percent ? formatCents(salePriceCents(toCents(product.price), percent)) : null,
            sale_ends_at: sale?.ends_at ?? null,
        }
        if (Array.isArray(product.variants)) {
            out.variants = product.variants.map((variant) => {
                const list_price = variant.price ?? product.price
                return {
                    ...variant,
                    effective_list_price: Number(list_price).toFixed(2),
                    sale_price: percent ? formatCents(salePriceCents(toCents(list_price), percent)) : null,
                }
            })
        }
        return out
    })
    return Array.isArray(products) ? priced : priced[0]
}
