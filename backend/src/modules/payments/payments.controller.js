import express from "express"
import prisma from "../../config/db.js"
import { webhookVerifier, isCardPaymentEnabled } from "../../config/stripe.js"
import { ORDER_EVENTS } from "../../events/eventNames.js"
import { createCheckoutSession, expireCheckoutSession } from "../../services/payments/stripe.service.js"
import { issueRefund } from "../../services/payments/refund.service.js"
import { cancelOrderInTx } from "../../services/checkout/checkout.service.js"
import { recordStatusChange } from "../../services/orders/order-history.service.js"
import { publishOrderEmailEvent, orderEmail, orderUrl } from "../../services/orders/order-events.service.js"
import { notifyBackInStock } from "../../services/inventory/inventory.service.js"
import { toCents } from "../../utils/pricing.helpers.js"

const parseOrderId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

// ==============================
// PAY (or retry paying) FOR A CARD ORDER
// ==============================

/**
 * New Stripe Checkout page for an unpaid card order. The previous page is expired
 * afterwards so the customer can't pay twice; its "expired" webhook is ignored
 * because the order now points at the new session.
 */
const startPayment = async (res, order) => {
    if (!isCardPaymentEnabled()) return res.status(400).json({ message: "Card payments aren't available" })
    if (order.payment_method !== "card") return res.status(400).json({ message: "This order is paid on delivery" })
    if (order.payment_status !== "unpaid") return res.status(400).json({ message: "This order has already been paid" })
    if (order.status !== "pending") return res.status(400).json({ message: "This order can no longer be paid" })
    try {
        const touched = await prisma.order.update({ where: { id: order.id }, data: { updated_at: new Date() }, include: { items: true, user: { select: { email: true } } } })
        const viewUrl = orderUrl(touched)
        const session = await createCheckoutSession(touched, {
            email: orderEmail(touched),
            successUrl: `${viewUrl}?payment=success`,
            cancelUrl: `${viewUrl}?payment=cancelled`,
        })
        await prisma.order.update({ where: { id: order.id }, data: { stripe_checkout_session_id: session.id } })
        if (order.stripe_checkout_session_id && order.stripe_checkout_session_id !== session.id) {
            expireCheckoutSession(order.stripe_checkout_session_id)
        }
        return res.status(200).json({ message: "Payment started", data: { checkout_url: session.url } })
    } catch (err) {
        console.error("startPayment error:", err)
        return res.status(502).json({ message: "Card payment is unavailable right now. Please try again." })
    }
}

// POST /orders/:orderId/pay
export const payOrder = async (req, res) => {
    const orderId = parseOrderId(req.params.orderId)
    if (!orderId) return res.status(400).json({ message: "order id missing or invalid" })
    const order = await prisma.order.findFirst({ where: { id: orderId, user_id: Number(req.user.sub) } })
    if (!order) return res.status(404).json({ message: "Order not found" })
    return startPayment(res, order)
}

// POST /order/track/:token/pay
export const payOrderByToken = async (req, res) => {
    if (!/^[a-f0-9]{32,64}$/.test(req.params.token)) return res.status(404).json({ message: "Order not found" })
    const order = await prisma.order.findUnique({ where: { public_token: req.params.token } })
    if (!order) return res.status(404).json({ message: "Order not found" })
    return startPayment(res, order)
}

// ==============================
// STRIPE WEBHOOK
// ==============================

const markOrderPaid = async (session) => {
    const orderId = Number(session.metadata?.order_id ?? session.client_reference_id)
    if (!Number.isInteger(orderId)) return
    const result = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId } })
        if (!order || order.payment_status !== "unpaid") return null   // already handled

        const amountMatches = session.amount_total === toCents(order.total_amount)
        await tx.order.update({
            where: { id: order.id },
            data: {
                payment_status: "paid",
                paid_at: new Date(),
                stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
                stripe_checkout_session_id: session.id,
                ...(order.status === "pending" ? { status: "confirmed" } : {}),
            },
        })
        if (order.status === "pending") {
            await recordStatusChange(tx, {
                orderId: order.id, from: "pending", to: "confirmed", actorType: "payment",
                note: amountMatches ? "Card payment received" : `Card payment received, but Stripe charged ${session.amount_total / 100} instead of ${order.total_amount}`,
            })
        } else {
            // Paid after it was cancelled (e.g. the page expired as they paid): flag it for a refund.
            await recordStatusChange(tx, {
                orderId: order.id, from: order.status, to: order.status, actorType: "payment",
                note: "Card payment received after the order was cancelled. Refund it from the admin dashboard.",
            })
        }
        return { wasPending: order.status === "pending" }
    })
    // Card orders get their confirmation email once the money is in, not when the page opens.
    if (result?.wasPending) publishOrderEmailEvent(ORDER_EVENTS.ORDER_CREATED, orderId)
}

const cancelExpiredOrder = async (session) => {
    const orderId = Number(session.metadata?.order_id ?? session.client_reference_id)
    if (!Number.isInteger(orderId)) return
    const restocked = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
        // Ignore sessions replaced by a retry, and orders that were paid or already cancelled.
        if (!order || order.stripe_checkout_session_id !== session.id) return null
        if (order.payment_status !== "unpaid" || order.status !== "pending") return null
        const result = await cancelOrderInTx(tx, { order, actorType: "payment", note: "Card payment wasn't completed in time" })
        return result.restocked
    })
    if (restocked === null) return
    restocked.forEach((r) => notifyBackInStock(r))
    publishOrderEmailEvent(ORDER_EVENTS.ORDER_STATUS_CHANGED, orderId)
}

const syncRefund = async (refund) => {
    const status = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending"
    await prisma.refund.updateMany({ where: { stripe_refund_id: refund.id }, data: { status } })
}

const HANDLERS = {
    "checkout.session.completed": (obj) => (obj.payment_status === "paid" ? markOrderPaid(obj) : null),
    "checkout.session.async_payment_succeeded": markOrderPaid,
    "checkout.session.expired": cancelExpiredOrder,
    "checkout.session.async_payment_failed": cancelExpiredOrder,
    "refund.updated": syncRefund,
    "refund.created": syncRefund,
}

// POST /payments/webhook — raw body; Stripe signs it with STRIPE_WEBHOOK_SECRET.
export const stripeWebhook = async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) return res.status(503).json({ message: "Webhook not configured" })
    let event
    try {
        event = webhookVerifier.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret)
    } catch (err) {
        return res.status(400).json({ message: "Invalid signature" })
    }

    const handler = HANDLERS[event.type]
    if (!handler) return res.status(200).json({ received: true })

    // Stripe retries and can deliver an event twice: record it first, skip if seen.
    try {
        await prisma.paymentEvent.create({ data: { id: event.id, type: event.type } })
    } catch (err) {
        if (err.code === "P2002") return res.status(200).json({ received: true, duplicate: true })
        console.error("stripeWebhook error:", err)
        return res.status(500).json({ message: "Database Error" })
    }

    try {
        await handler(event.data.object)
        return res.status(200).json({ received: true })
    } catch (err) {
        // Forget the event so Stripe's retry gets processed.
        await prisma.paymentEvent.delete({ where: { id: event.id } }).catch(() => {})
        console.error(`stripeWebhook ${event.type} error:`, err)
        return res.status(500).json({ message: "Webhook handling failed" })
    }
}

export const rawJson = express.raw({ type: "application/json", limit: "1mb" })

// ==============================
// ADMIN REFUNDS
// ==============================

// POST /admin/orders/:orderId/refunds   body: { amount?, reason? }  (amount defaults to the rest)
export const refundOrder = async (req, res) => {
    const orderId = parseOrderId(req.params.orderId)
    if (!orderId) return res.status(400).json({ message: "order id missing or invalid" })
    let amountCents = null
    if (req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== "") {
        const amount = Number(req.body.amount)
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: "amount must be a positive number" })
        amountCents = toCents(amount)
    }
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : null
    try {
        const { refund, order } = await issueRefund({ orderId, amountCents, reason, actorUserId: Number(req.user.sub) })
        return res.status(201).json({ message: "Refund issued", data: { refund, order } })
    } catch (err) {
        const [code, ...rest] = String(err.message).split(":")
        if (code === "ORDER_NOT_FOUND") return res.status(404).json({ message: "Order not found" })
        if (["NOT_PAID", "BAD_AMOUNT"].includes(code)) return res.status(400).json({ message: rest.join(":") })
        if (code === "REFUND_FAILED" || err.type?.startsWith?.("Stripe")) {
            console.error("refundOrder stripe error:", err)
            return res.status(502).json({ message: `Stripe refused the refund: ${err.raw?.message ?? rest.join(":") ?? "unknown error"}` })
        }
        if (err.code === "P2002") return res.status(409).json({ message: "This refund was already recorded" })
        console.error("refundOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
