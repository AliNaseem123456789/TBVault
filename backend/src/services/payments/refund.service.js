import prisma from "../../config/db.js"
import { refundPayment } from "./stripe.service.js"
import { toCents, fromCents } from "../../utils/pricing.helpers.js"
import { publishOrderEmailEvent } from "../orders/order-events.service.js"
import { ORDER_EVENTS } from "../../events/eventNames.js"

/**
 * Refunds part or all of an order.
 *   - Card orders that were paid: refunded through Stripe.
 *   - Cash-on-delivery orders that were paid: recorded as a manual refund (you hand the cash back).
 * amountCents defaults to everything not yet refunded.
 * Throws Error("CODE:detail"); see the controllers for the HTTP mapping.
 */
export const issueRefund = async ({ orderId, amountCents = null, reason = null, returnId = null, actorUserId = null }) => {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { _count: { select: { refunds: true } } } })
    if (!order) throw new Error("ORDER_NOT_FOUND")
    if (!["paid", "partially_refunded"].includes(order.payment_status)) {
        throw new Error("NOT_PAID:This order hasn't been paid, so there is nothing to refund")
    }

    const refundableCents = toCents(order.total_amount) - toCents(order.amount_refunded)
    const amount = amountCents ?? refundableCents
    if (!Number.isInteger(amount) || amount < 1) throw new Error("BAD_AMOUNT:Refund amount must be at least $0.01")
    if (amount > refundableCents) throw new Error(`BAD_AMOUNT:At most $${fromCents(refundableCents).toFixed(2)} can still be refunded`)

    let method = "manual"
    let status = "succeeded"
    let stripeRefundId = null
    if (order.payment_method === "card") {
        if (!order.stripe_payment_intent_id) throw new Error("NOT_PAID:No card payment is linked to this order")
        const refund = await refundPayment({
            paymentIntentId: order.stripe_payment_intent_id,
            amountCents: amount,
            // Same order + same refund count + same amount = same Stripe refund, so a double click can't refund twice.
            idempotencyKey: `refund-${order.id}-${order._count.refunds}-${amount}`,
            metadata: { order_id: String(order.id), return_id: returnId ? String(returnId) : "" },
        })
        if (refund.status === "failed" || refund.status === "canceled") throw new Error("REFUND_FAILED:Stripe declined the refund")
        method = "stripe"
        status = refund.status === "succeeded" ? "succeeded" : "pending"
        stripeRefundId = refund.id
    }

    const newRefundedCents = toCents(order.amount_refunded) + amount
    const fullyRefunded = newRefundedCents >= toCents(order.total_amount)
    const [refund, updated] = await prisma.$transaction([
        prisma.refund.create({
            data: {
                order_id: order.id,
                return_id: returnId,
                amount: fromCents(amount),
                reason: reason ? String(reason).slice(0, 500) : null,
                method,
                stripe_refund_id: stripeRefundId,
                status,
                created_by: actorUserId,
            },
        }),
        prisma.order.update({
            where: { id: order.id },
            data: {
                amount_refunded: fromCents(newRefundedCents),
                payment_status: fullyRefunded ? "refunded" : "partially_refunded",
            },
        }),
    ])

    publishOrderEmailEvent(ORDER_EVENTS.ORDER_REFUNDED, order.id, { refundAmount: fromCents(amount).toFixed(2) })
    return { refund, order: updated }
}
