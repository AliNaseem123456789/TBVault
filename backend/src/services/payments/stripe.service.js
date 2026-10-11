import { getStripe } from "../../config/stripe.js"
import { getSettings } from "../settings/settings.service.js"
import { toCents } from "../../utils/pricing.helpers.js"

// Stripe's minimum Checkout lifetime is 30 minutes; an unpaid order is cancelled when it expires.
const SESSION_LIFETIME_SECONDS = 31 * 60

/**
 * Hosted Stripe Checkout page for an order. Charged as one line ("Order #12") for
 * the order's server-computed total, so discounts, shipping and tax always match
 * what TBVault calculated rather than being recomputed by Stripe.
 */
export const createCheckoutSession = async (order, { email, successUrl, cancelUrl }) => {
    const stripe = getStripe()
    if (!stripe) throw new Error("CARD_DISABLED")
    const { currency, store_name } = await getSettings()
    const itemCount = order.items.reduce((sum, i) => sum + i.quantity, 0)
    return stripe.checkout.sessions.create(
        {
            mode: "payment",
            customer_email: email,
            client_reference_id: String(order.id),
            metadata: { order_id: String(order.id) },
            payment_intent_data: { metadata: { order_id: String(order.id) } },
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency,
                        // Whatever store credit didn't cover.
                        unit_amount: toCents(order.total_amount) - toCents(order.credits_applied ?? 0),
                        product_data: {
                            name: `${store_name} order #${order.id}`,
                            description: `${itemCount} item${itemCount === 1 ? "" : "s"}`,
                        },
                    },
                },
            ],
            expires_at: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
            success_url: successUrl,
            cancel_url: cancelUrl,
        },
        // A retry of the same request returns the same session instead of a second one.
        { idempotencyKey: `checkout-${order.id}-${order.updated_at?.getTime?.() ?? Date.now()}` }
    )
}

/** Best effort: a stale session can't be paid any more. */
export const expireCheckoutSession = async (sessionId) => {
    const stripe = getStripe()
    if (!stripe || !sessionId) return
    try {
        await stripe.checkout.sessions.expire(sessionId)
    } catch (err) {
        // Already expired or completed; nothing to do.
        if (err?.code !== "resource_missing") console.warn("[stripe] could not expire session:", err.message)
    }
}

/** Hosted Stripe Checkout page for buying store credit. */
export const createTopupSession = async (topup, { email, successUrl, cancelUrl }) => {
    const stripe = getStripe()
    if (!stripe) throw new Error("CARD_DISABLED")
    const { currency, store_name } = await getSettings()
    return stripe.checkout.sessions.create(
        {
            mode: "payment",
            customer_email: email,
            client_reference_id: `topup-${topup.id}`,
            metadata: { kind: "wallet_topup", topup_id: String(topup.id), user_id: String(topup.user_id) },
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency,
                        unit_amount: toCents(topup.amount),
                        product_data: { name: `${store_name} store credit` },
                    },
                },
            ],
            expires_at: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
            success_url: successUrl,
            cancel_url: cancelUrl,
        },
        { idempotencyKey: `topup-${topup.id}` }
    )
}

export const refundPayment = async ({ paymentIntentId, amountCents, idempotencyKey, metadata }) => {
    const stripe = getStripe()
    if (!stripe) throw new Error("CARD_DISABLED")
    return stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents, metadata }, { idempotencyKey })
}
