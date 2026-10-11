import crypto from "node:crypto"
import prisma from "../../config/db.js"
import { loadLiveSales } from "../pricing/pricing.service.js"
import { getSettings } from "../settings/settings.service.js"
import { takeStock, returnStock } from "../inventory/inventory.service.js"
import { recordStatusChange } from "../orders/order-history.service.js"
import { changeCredits, creditBalanceCents } from "../wallet/wallet.service.js"
import { cancelShipments } from "../marketplace/seller-orders.service.js"
import {
    bestSaleFor, salePriceCents, toCents, fromCents, couponProblem, matchShippingZone, computeTotals,
} from "../../utils/pricing.helpers.js"

const MAX_LINES = 50
const MAX_QUANTITY = 99

/**
 * Checks and normalises requested lines: [{ product_id, variant_id?, quantity }].
 * Duplicate product/variant pairs are merged. Returns { lines } or { error }.
 */
export const parseLineInput = (items) => {
    if (!Array.isArray(items) || items.length === 0) return { error: "items must be a non-empty list" }
    if (items.length > MAX_LINES) return { error: `at most ${MAX_LINES} different items per order` }
    const merged = new Map()
    for (const item of items) {
        const productId = Number(item?.product_id)
        const variantId = item?.variant_id == null ? null : Number(item.variant_id)
        const quantity = Number(item?.quantity ?? 1)
        if (!Number.isInteger(productId) || productId < 1) return { error: "each item needs a valid product_id" }
        if (variantId !== null && (!Number.isInteger(variantId) || variantId < 1)) return { error: "variant_id must be a positive integer" }
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return { error: `quantity must be a whole number from 1 to ${MAX_QUANTITY}` }
        const key = `${productId}:${variantId ?? ""}`
        const prev = merged.get(key)
        merged.set(key, { productId, variantId, quantity: Math.min(MAX_QUANTITY, (prev?.quantity ?? 0) + quantity) })
    }
    return { lines: [...merged.values()] }
}

/** A signed-in customer's cart as lines. */
export const cartLines = async (userId, db = prisma) => {
    const cart = await db.cart.findUnique({ where: { user_id: userId }, include: { items: true } })
    return (cart?.items ?? []).map((i) => ({ productId: i.product_id, variantId: i.variant_id, quantity: i.quantity }))
}

/**
 * Prices lines against the database: product/variant availability, sale prices,
 * coupon, shipping zone and tax. Nothing is written. Used for the checkout
 * preview (quote) and again, inside the order transaction, when placing.
 *
 * Returns:
 *   lines      priced lines (with problems flagged per line)
 *   problems   human-readable reasons the order can't be placed as-is
 *   coupon     the coupon row when one applies, couponError otherwise
 *   totals     cents: { subtotal, discount, shipping, tax, total }
 *   credits    cents: { balance, applied, due } — store credit (signed-in customers with useCredits)
 */
export const buildQuote = async ({ db = prisma, userId = null, email = null, lines, address = null, couponCode = null, useCredits = false, now = new Date() }) => {
    const productIds = [...new Set(lines.map((l) => l.productId))]
    const products = await db.product.findMany({
        where: { id: { in: productIds } },
        include: {
            variants: { where: { is_active: true } },
            images: { orderBy: [{ is_primary: "desc" }, { created_at: "asc" }], take: 1 },
            seller: { select: { id: true, store_name: true, status: true, is_platform: true, commission_rate: true } },
        },
    })
    const byId = new Map(products.map((p) => [p.id, p]))
    const sales = await loadLiveSales(products, db, now)

    const problems = []
    const priced = lines.map((line) => {
        const product = byId.get(line.productId)
        if (!product || product.is_hidden || product.seller.status !== "APPROVED") {
            problems.push(`Product #${line.productId} is no longer available`)
            return { ...line, available: false, problem: "unavailable" }
        }
        let variant = null
        if (product.variants.length > 0) {
            variant = product.variants.find((v) => v.id === line.variantId) ?? null
            if (!variant) {
                problems.push(line.variantId ? `The selected option of ${product.name} is no longer available` : `Choose an option for ${product.name}`)
                return { ...line, available: false, problem: "variant", productName: product.name }
            }
        } else if (line.variantId) {
            problems.push(`${product.name} has no options to choose from`)
            return { ...line, available: false, problem: "variant", productName: product.name }
        }

        const listCents = toCents(variant?.price ?? product.price)
        const sale = bestSaleFor(sales, { productId: product.id, categoryId: product.category_id, now })
        const unitCents = salePriceCents(listCents, sale?.percent ?? 0)
        const stock = variant ? variant.stock : product.stock
        if (stock < line.quantity) {
            problems.push(stock > 0 ? `Only ${stock} of ${product.name}${variant ? ` (${variant.name})` : ""} left` : `${product.name}${variant ? ` (${variant.name})` : ""} is out of stock`)
        }
        return {
            ...line,
            available: true,
            problem: stock < line.quantity ? "stock" : null,
            stock,
            productName: product.name,
            variantName: variant?.name ?? null,
            imageKey: product.images[0]?.key ?? null,
            seller: product.seller,
            listCents,
            unitCents,
            salePercent: sale?.percent ?? null,
        }
    })

    const settings = await getSettings(db)
    const zones = await db.shippingZone.findMany({ orderBy: { id: "asc" } })
    const zone = matchShippingZone(zones, address)
    const subtotalCents = priced.filter((l) => l.available).reduce((s, l) => s + l.unitCents * l.quantity, 0)

    let coupon = null
    let couponError = null
    if (couponCode) {
        const row = await db.coupon.findUnique({ where: { code: String(couponCode).trim().toUpperCase() } })
        const customerEmail = email?.toLowerCase() ?? null
        const customerUses = row && (userId || customerEmail)
            ? await db.couponRedemption.count({
                where: { coupon_id: row.id, OR: [userId ? { user_id: userId } : null, customerEmail ? { email: customerEmail } : null].filter(Boolean) },
            })
            : 0
        couponError = couponProblem(row, { now, subtotalCents, customerUses })
        if (!couponError) coupon = row
    }

    const totals = computeTotals({
        lines: priced.filter((l) => l.available),
        coupon,
        zone,
        taxRate: settings.tax_rate,
    })
    // Store credit: as much of the total as the balance covers.
    const balance = userId ? await creditBalanceCents(db, userId) : 0
    const applied = userId && useCredits ? Math.min(balance, totals.total) : 0
    const credits = { balance, applied, due: totals.total - applied }

    return { lines: priced, problems, coupon, couponError, zone, taxRate: settings.tax_rate, commissionRate: settings.commission_rate, totals, credits }
}

/** API shape of a quote (cents -> numbers with 2 decimals). */
export const serializeQuote = (quote) => ({
    items: quote.lines.map((l) => ({
        product_id: l.productId,
        variant_id: l.variantId,
        quantity: l.quantity,
        available: l.available,
        problem: l.problem,
        stock: l.stock ?? 0,
        product_name: l.productName ?? null,
        variant_name: l.variantName ?? null,
        image_key: l.imageKey ?? null,
        list_price: l.listCents != null ? fromCents(l.listCents).toFixed(2) : null,
        unit_price: l.unitCents != null ? fromCents(l.unitCents).toFixed(2) : null,
        total_price: l.unitCents != null ? fromCents(l.unitCents * l.quantity).toFixed(2) : null,
        sale_percent: l.salePercent ?? null,
        seller: l.seller ? { id: l.seller.id, store_name: l.seller.store_name, is_platform: l.seller.is_platform } : null,
    })),
    problems: quote.problems,
    coupon: quote.coupon ? { code: quote.coupon.code, type: quote.coupon.type, description: quote.coupon.description } : null,
    coupon_error: quote.couponError,
    shipping_zone: quote.zone ? { id: quote.zone.id, name: quote.zone.name } : null,
    tax_rate: quote.taxRate,
    totals: {
        ...Object.fromEntries(Object.entries(quote.totals).map(([k, v]) => [k, fromCents(v).toFixed(2)])),
        credits_applied: fromCents(quote.credits.applied).toFixed(2),
        amount_due: fromCents(quote.credits.due).toFixed(2),
    },
    credit_balance: fromCents(quote.credits.balance).toFixed(2),
})

/**
 * Creates an order inside `tx`: re-prices everything server-side (the browser's
 * totals are never trusted), takes stock, records the coupon redemption, writes
 * the first timeline entry, and empties the customer's cart.
 * Throws Error("CODE:detail") for business failures; the controller maps them.
 * Returns { order, stockChanges } (stockChanges feeds low-stock alerts after commit).
 */
export const placeOrder = async (tx, { userId = null, email, lines, address = null, shippingAddressText, couponCode = null, paymentMethod, useCredits = false }) => {
    const quote = await buildQuote({ db: tx, userId, email, lines, address, couponCode, useCredits: Boolean(userId) && (useCredits || paymentMethod === "credits") })
    if (quote.problems.length) throw new Error(`UNAVAILABLE:${quote.problems[0]}`)
    if (couponCode && quote.couponError) throw new Error(`COUPON:${quote.couponError}`)

    const { totals, coupon, credits } = quote
    // Fully covered by store credit: nothing left to pay by card or cash.
    const paidByCredits = credits.applied > 0 && credits.due === 0
    if (paymentMethod === "credits" && !paidByCredits) throw new Error("CREDITS:Your store credit doesn't cover this order")
    const method = paidByCredits ? "credits" : paymentMethod

    const order = await tx.order.create({
        data: {
            user_id: userId,
            guest_email: userId ? null : email,
            public_token: crypto.randomBytes(24).toString("hex"),
            status: "pending",
            subtotal: fromCents(totals.subtotal),
            discount_total: fromCents(totals.discount),
            shipping_total: fromCents(totals.shipping),
            tax_total: fromCents(totals.tax),
            total_amount: fromCents(totals.total),
            coupon_id: coupon?.id ?? null,
            coupon_code: coupon?.code ?? null,
            credits_applied: fromCents(credits.applied),
            payment_method: method,
            payment_status: "unpaid",
            shipping_address: shippingAddressText,
        },
    })

    // One shipment per seller, holding that seller's items and their share of the money.
    // Coupons, shipping and tax stay with the store; sellers earn on the price of their items.
    const bySeller = new Map()
    for (const line of quote.lines) {
        const group = bySeller.get(line.seller.id) ?? { seller: line.seller, lines: [] }
        group.lines.push(line)
        bySeller.set(line.seller.id, group)
    }
    for (const { seller, lines: sellerLines } of bySeller.values()) {
        const rate = seller.is_platform ? 0 : Number(seller.commission_rate ?? quote.commissionRate)
        const subtotalCents = sellerLines.reduce((sum, l) => sum + l.unitCents * l.quantity, 0)
        const commissionCents = Math.round((subtotalCents * rate) / 100)
        await tx.sellerOrder.create({
            data: {
                order_id: order.id,
                seller_id: seller.id,
                subtotal: fromCents(subtotalCents),
                commission_rate: rate,
                commission_amount: fromCents(commissionCents),
                seller_earnings: fromCents(subtotalCents - commissionCents),
                items: {
                    create: sellerLines.map((l) => ({
                        order_id: order.id,
                        product_id: l.productId,
                        variant_id: l.variantId,
                        product_name: l.productName,
                        variant_name: l.variantName,
                        quantity: l.quantity,
                        list_price: fromCents(l.listCents),
                        unit_price: fromCents(l.unitCents),
                        total_price: fromCents(l.unitCents * l.quantity),
                    })),
                },
            },
        })
    }

    const stockChanges = []
    for (const line of quote.lines) {
        const name = line.variantName ? `${line.productName} (${line.variantName})` : line.productName
        const { before, after } = await takeStock(tx, { productId: line.productId, variantId: line.variantId, quantity: line.quantity, name })
        stockChanges.push({ productId: line.productId, variantId: line.variantId, name, before, after })
    }

    if (coupon) {
        // Conditional increment: if the last use was taken concurrently, this matches no row.
        const claimed = await tx.coupon.updateMany({
            where: coupon.usage_limit != null ? { id: coupon.id, times_used: { lt: coupon.usage_limit } } : { id: coupon.id },
            data: { times_used: { increment: 1 } },
        })
        if (claimed.count === 0) throw new Error("COUPON:This coupon has been fully redeemed")
        await tx.couponRedemption.create({
            data: { coupon_id: coupon.id, order_id: order.id, user_id: userId, email: email.toLowerCase(), discount_amount: fromCents(totals.discount) },
        })
    }

    await recordStatusChange(tx, { orderId: order.id, to: "pending", actorType: "customer", actorUserId: userId })

    if (credits.applied > 0) {
        try {
            await changeCredits(tx, { userId, amountCents: -credits.applied, type: "order_payment", orderId: order.id, note: `Order #${order.id}` })
        } catch (err) {
            if (err.message === "INSUFFICIENT_CREDITS") throw new Error("CREDITS:Your store credit balance changed. Please review your order again.")
            throw err
        }
    }
    let placed = order
    if (paidByCredits) {
        placed = await tx.order.update({ where: { id: order.id }, data: { payment_status: "paid", paid_at: new Date(), status: "confirmed" } })
        await recordStatusChange(tx, { orderId: order.id, from: "pending", to: "confirmed", actorType: "payment", note: "Paid with store credit" })
    }

    if (userId) {
        const cart = await tx.cart.findUnique({ where: { user_id: userId } })
        if (cart) await tx.cartItem.deleteMany({ where: { cart_id: cart.id } })
    }
    const full = await tx.order.findUnique({ where: { id: placed.id }, include: { items: true } })
    return { order: full, stockChanges }
}

/**
 * Cancels an order inside `tx`: puts its stock back, frees its coupon use, cancels every
 * seller's shipment and, for an order that was never paid, gives back the store credit it held.
 * Does not touch card/cash payments; callers refund paid orders first (issueRefund).
 * Returns { order, restocked } (restocked feeds back-in-stock emails after commit).
 */
export const cancelOrderInTx = async (tx, { order, actorType, actorUserId = null, note = null }) => {
    const items = order.items ?? (await tx.orderItem.findMany({ where: { order_id: order.id } }))
    const restocked = await returnStock(tx, items.map((i) => ({ productId: i.product_id, variantId: i.variant_id, quantity: i.quantity })))

    const redemption = await tx.couponRedemption.findUnique({ where: { order_id: order.id } })
    if (redemption) {
        await tx.couponRedemption.delete({ where: { id: redemption.id } })
        await tx.coupon.updateMany({ where: { id: redemption.coupon_id, times_used: { gt: 0 } }, data: { times_used: { decrement: 1 } } })
    }

    await cancelShipments(tx, order.id)
    const creditsHeld = toCents(order.credits_applied ?? 0)
    if (creditsHeld > 0 && order.payment_status === "unpaid" && order.user_id) {
        await changeCredits(tx, { userId: order.user_id, amountCents: creditsHeld, type: "order_cancel", orderId: order.id, note: `Order #${order.id} cancelled` })
    }

    const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: "cancelled", cancelled_at: new Date() },
        include: { items: true },
    })
    await recordStatusChange(tx, { orderId: order.id, from: order.status, to: "cancelled", actorType, actorUserId, note })
    return { order: updated, restocked }
}
