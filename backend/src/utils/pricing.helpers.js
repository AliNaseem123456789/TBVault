/**
 * Pure money maths for carts, quotes and orders. Everything works in integer
 * cents so totals never drift from floating-point rounding; convert at the edges.
 *
 * Order of operations (documented here because it's a business decision):
 *   1. list price  -> sale price         (best active Sale for the product or its category)
 *   2. subtotal    = sum(sale price x quantity)
 *   3. discount    = coupon on the subtotal (PERCENT capped by max_discount, FIXED capped by subtotal)
 *   4. shipping    = zone rate, free when (subtotal - discount) reaches the zone's free_over,
 *                    or when the coupon is FREE_SHIPPING
 *   5. tax         = tax_rate% of (subtotal - discount)   (shipping is not taxed)
 *   6. total       = subtotal - discount + shipping + tax
 */

export const toCents = (value) => Math.round(Number(value ?? 0) * 100)
export const fromCents = (cents) => Math.round(cents) / 100
export const formatCents = (cents) => fromCents(cents).toFixed(2)

/** Sale price for a list price and a percent off (0 = no sale). */
export const salePriceCents = (listCents, percentOff) =>
    percentOff > 0 ? Math.round((listCents * (100 - percentOff)) / 100) : listCents

/** True when a Sale row applies at `now`. */
export const isSaleLive = (sale, now = new Date()) =>
    Boolean(sale?.is_active) && new Date(sale.starts_at) <= now && new Date(sale.ends_at) > now

/**
 * Best live sale for one product: product-specific and category-wide sales both
 * count, the biggest percentage wins. Returns { percent, ends_at } or null.
 */
export const bestSaleFor = (sales, { productId, categoryId, now = new Date() }) => {
    let best = null
    for (const sale of sales) {
        if (!isSaleLive(sale, now)) continue
        const matches = (sale.product_id != null && sale.product_id === productId) ||
            (sale.category_id != null && sale.category_id === categoryId)
        if (matches && (!best || sale.percent_off > best.percent)) {
            best = { percent: sale.percent_off, ends_at: sale.ends_at, sale_id: sale.id }
        }
    }
    return best
}

/**
 * Why a coupon can't be used right now, or null when it can.
 * `customerUses` = how many times this customer (account or guest email) has already used it.
 */
export const couponProblem = (coupon, { now = new Date(), subtotalCents, customerUses = 0 }) => {
    if (!coupon || !coupon.is_active) return "This coupon code isn't valid"
    if (coupon.starts_at && new Date(coupon.starts_at) > now) return "This coupon isn't active yet"
    if (coupon.expires_at && new Date(coupon.expires_at) <= now) return "This coupon has expired"
    if (coupon.usage_limit != null && coupon.times_used >= coupon.usage_limit) return "This coupon has been fully redeemed"
    if (coupon.per_user_limit != null && customerUses >= coupon.per_user_limit) return "You've already used this coupon"
    if (coupon.min_order_amount != null && subtotalCents < toCents(coupon.min_order_amount)) {
        return `Spend at least $${Number(coupon.min_order_amount).toFixed(2)} to use this coupon`
    }
    return null
}

/** Discount (cents) a valid coupon takes off the subtotal. FREE_SHIPPING discounts shipping instead. */
export const couponDiscountCents = (coupon, subtotalCents) => {
    if (!coupon) return 0
    if (coupon.type === "PERCENT") {
        let discount = Math.round((subtotalCents * Number(coupon.value)) / 100)
        if (coupon.max_discount != null) discount = Math.min(discount, toCents(coupon.max_discount))
        return Math.min(discount, subtotalCents)
    }
    if (coupon.type === "FIXED") return Math.min(toCents(coupon.value), subtotalCents)
    return 0
}

const norm = (value) => String(value ?? "").trim().toLowerCase()

/**
 * Shipping zone for an address: the first zone listing the address's city, state
 * or country; otherwise the default zone; otherwise null (shipping is free).
 */
export const matchShippingZone = (zones, address) => {
    if (!zones?.length) return null
    if (address) {
        const keys = [address.city, address.state, address.country].map(norm).filter(Boolean)
        const hit = zones.find((zone) => (zone.regions ?? []).some((region) => keys.includes(norm(region))))
        if (hit) return hit
    }
    return zones.find((zone) => zone.is_default) ?? null
}

export const shippingCents = (zone, discountedSubtotalCents, { freeShipping = false } = {}) => {
    if (!zone || freeShipping) return 0
    if (zone.free_over != null && discountedSubtotalCents >= toCents(zone.free_over)) return 0
    return toCents(zone.rate)
}

export const taxCents = (ratePercent, taxableCents) =>
    ratePercent > 0 ? Math.round((taxableCents * Number(ratePercent)) / 100) : 0

/**
 * Totals for priced lines. `lines` = [{ unitCents, quantity }]; `coupon` must already
 * have passed couponProblem() (or be null).
 */
export const computeTotals = ({ lines, coupon = null, zone = null, taxRate = 0 }) => {
    const subtotal = lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0)
    const discount = couponDiscountCents(coupon, subtotal)
    const afterDiscount = subtotal - discount
    const shipping = shippingCents(zone, afterDiscount, { freeShipping: coupon?.type === "FREE_SHIPPING" })
    const tax = taxCents(taxRate, afterDiscount)
    return { subtotal, discount, shipping, tax, total: afterDiscount + shipping + tax }
}
