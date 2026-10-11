import { toCents, fromCents } from "../../utils/pricing.helpers.js"

/** A seller's balance: everything earned minus refunds and payouts. */
export const sellerBalanceCents = async (db, sellerId) => {
    const sum = await db.sellerTransaction.aggregate({ where: { seller_id: sellerId }, _sum: { amount: true } })
    return toCents(sum._sum.amount ?? 0)
}

/** Earnings still on their way: delivered-or-not shipments whose money hasn't reached the balance yet. */
export const pendingEarningsCents = async (db, sellerId) => {
    const sum = await db.sellerOrder.aggregate({
        where: { seller_id: sellerId, earnings_credited_at: null, status: { not: "cancelled" } },
        _sum: { seller_earnings: true },
    })
    return toCents(sum._sum.seller_earnings ?? 0)
}

/**
 * Moves earnings to sellers' balances for every shipment of the order that is delivered,
 * once the order itself is paid. Safe to call repeatedly: credited shipments are skipped
 * (the update is conditional on earnings_credited_at being null).
 * The platform's own shipments are marked but never earn anything.
 */
export const creditSellerEarnings = async (tx, orderId) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { payment_status: true } })
    if (!order || !["paid", "partially_refunded", "refunded"].includes(order.payment_status)) return
    const due = await tx.sellerOrder.findMany({
        where: { order_id: orderId, status: "delivered", earnings_credited_at: null },
        include: { seller: { select: { is_platform: true } } },
    })
    for (const shipment of due) {
        const claimed = await tx.sellerOrder.updateMany({
            where: { id: shipment.id, earnings_credited_at: null },
            data: { earnings_credited_at: new Date() },
        })
        if (claimed.count === 0 || shipment.seller.is_platform) continue
        if (toCents(shipment.seller_earnings) > 0) {
            await tx.sellerTransaction.create({
                data: {
                    seller_id: shipment.seller_id,
                    seller_order_id: shipment.id,
                    type: "earning",
                    amount: shipment.seller_earnings,
                    note: `Order #${orderId} delivered`,
                },
            })
        }
    }
}

/**
 * When returned items are refunded, the seller gives back what they earned on them
 * (the item price minus the commission they paid). Only for shipments already credited;
 * uncredited earnings are reduced instead, so they are never paid out in the first place.
 */
export const chargeSellersForReturn = async (tx, { returnId, actorUserId = null }) => {
    const items = await tx.returnItem.findMany({
        where: { return_id: returnId },
        include: { order_item: { include: { seller_order: { include: { seller: { select: { is_platform: true } } } } } } },
    })
    const bySellerOrder = new Map()
    for (const ri of items) {
        const so = ri.order_item.seller_order
        if (!so || so.seller.is_platform) continue
        const valueCents = toCents(ri.order_item.unit_price) * ri.quantity
        const shareCents = Math.round(valueCents * (1 - Number(so.commission_rate) / 100))
        const entry = bySellerOrder.get(so.id) ?? { so, cents: 0 }
        entry.cents += shareCents
        bySellerOrder.set(so.id, entry)
    }
    for (const { so, cents } of bySellerOrder.values()) {
        if (cents <= 0) continue
        if (so.earnings_credited_at) {
            await tx.sellerTransaction.create({
                data: { seller_id: so.seller_id, seller_order_id: so.id, type: "refund", amount: fromCents(-cents), note: `Return #${returnId} refunded`, created_by: actorUserId },
            })
        } else {
            const remaining = Math.max(0, toCents(so.seller_earnings) - cents)
            await tx.sellerOrder.update({ where: { id: so.id }, data: { seller_earnings: fromCents(remaining) } })
        }
    }
}
