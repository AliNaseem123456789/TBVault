import prisma from "../../config/db.js"
import { refundPayment } from "./stripe.service.js"
import { toCents, fromCents } from "../../utils/pricing.helpers.js"
import { publishOrderEmailEvent } from "../orders/order-events.service.js"
import { ORDER_EVENTS } from "../../events/eventNames.js"
import { changeCredits } from "../wallet/wallet.service.js"
import { chargeSellersForReturn } from "../marketplace/seller-ledger.service.js"

export const REFUND_DESTINATIONS = ["original", "credits"]

/**
 * Refunds part or all of an order. amountCents defaults to everything not yet refunded.
 *
 * destination "original" (default) gives the money back the way it was paid:
 *   - the card part through Stripe, the cash-on-delivery part as a manual refund (you hand cash back),
 *   - then any part paid with store credit back to store credit.
 * destination "credits" puts the whole amount on the customer's store credit (instant; not for guests).
 *
 * With returnId, the sellers of the returned items give back their earnings on them.
 * Throws Error("CODE:detail"); see the controllers for the HTTP mapping.
 */
export const issueRefund = async ({ orderId, amountCents = null, reason = null, returnId = null, actorUserId = null, destination = "original" }) => {
    if (!REFUND_DESTINATIONS.includes(destination)) throw new Error("BAD_AMOUNT:destination must be original or credits")
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { _count: { select: { refunds: true } }, refunds: { select: { amount: true, method: true } } },
    })
    if (!order) throw new Error("ORDER_NOT_FOUND")
    if (!["paid", "partially_refunded"].includes(order.payment_status)) {
        throw new Error("NOT_PAID:This order hasn't been paid, so there is nothing to refund")
    }

    const refundableCents = toCents(order.total_amount) - toCents(order.amount_refunded)
    const amount = amountCents ?? refundableCents
    if (!Number.isInteger(amount) || amount < 1) throw new Error("BAD_AMOUNT:Refund amount must be at least $0.01")
    if (amount > refundableCents) throw new Error(`BAD_AMOUNT:At most $${fromCents(refundableCents).toFixed(2)} can still be refunded`)
    if (destination === "credits" && !order.user_id) throw new Error("BAD_AMOUNT:Guest orders can't be refunded to store credit")

    // Split the amount between the card/cash part and the store-credit part.
    const externalPaid = toCents(order.total_amount) - toCents(order.credits_applied)
    const externalRefunded = order.refunds.filter((r) => r.method !== "credits").reduce((s, r) => s + toCents(r.amount), 0)
    const externalCents = destination === "credits" ? 0 : Math.min(amount, Math.max(0, externalPaid - externalRefunded))
    const creditCents = amount - externalCents

    let external = null
    if (externalCents > 0) {
        external = { method: "manual", status: "succeeded", stripeRefundId: null }
        if (order.payment_method === "card") {
            if (!order.stripe_payment_intent_id) throw new Error("NOT_PAID:No card payment is linked to this order")
            const refund = await refundPayment({
                paymentIntentId: order.stripe_payment_intent_id,
                amountCents: externalCents,
                // Same order + same refund count + same amount = same Stripe refund, so a double click can't refund twice.
                idempotencyKey: `refund-${order.id}-${order._count.refunds}-${externalCents}`,
                metadata: { order_id: String(order.id), return_id: returnId ? String(returnId) : "" },
            })
            if (refund.status === "failed" || refund.status === "canceled") throw new Error("REFUND_FAILED:Stripe declined the refund")
            external = { method: "stripe", status: refund.status === "succeeded" ? "succeeded" : "pending", stripeRefundId: refund.id }
        }
    }

    const newRefundedCents = toCents(order.amount_refunded) + amount
    const fullyRefunded = newRefundedCents >= toCents(order.total_amount)
    const result = await prisma.$transaction(async (tx) => {
        const rows = []
        const base = { order_id: order.id, return_id: returnId, reason: reason ? String(reason).slice(0, 500) : null, created_by: actorUserId }
        if (external) {
            rows.push(await tx.refund.create({
                data: { ...base, amount: fromCents(externalCents), method: external.method, stripe_refund_id: external.stripeRefundId, status: external.status },
            }))
        }
        if (creditCents > 0) {
            await changeCredits(tx, { userId: order.user_id, amountCents: creditCents, type: "refund", orderId: order.id, note: reason ?? `Refund for order #${order.id}`, createdBy: actorUserId })
            rows.push(await tx.refund.create({ data: { ...base, amount: fromCents(creditCents), method: "credits", status: "succeeded" } }))
        }
        const updated = await tx.order.update({
            where: { id: order.id },
            data: { amount_refunded: fromCents(newRefundedCents), payment_status: fullyRefunded ? "refunded" : "partially_refunded" },
        })
        if (returnId) await chargeSellersForReturn(tx, { returnId, actorUserId })
        return { refunds: rows, order: updated }
    })

    publishOrderEmailEvent(ORDER_EVENTS.ORDER_REFUNDED, order.id, { refundAmount: fromCents(amount).toFixed(2), refundToCredits: creditCents === amount })
    return { refund: result.refunds[0], refunds: result.refunds, order: result.order }
}
