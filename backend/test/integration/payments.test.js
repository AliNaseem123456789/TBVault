import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
    enabled, setup, teardown, resetDatabase, api, createUser, createProduct, addToCart, placeOrder,
    sendWebhook, stripeCalls, waitForEvents, eventsOf, db,
} from "./helpers.js"

const t = enabled ? test : test.skip
before(async () => { if (enabled) await setup() })
after(async () => { if (enabled) await teardown() })
beforeEach(async () => { if (enabled) await resetDatabase() })

const cardOrder = async ({ price = 40, stock = 5, quantity = 1 } = {}) => {
    const customer = await createUser()
    const product = await createProduct({ price, stock })
    await addToCart(customer.token, product.id, quantity)
    const res = await placeOrder(customer.token, { payment_method: "card" })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return { ...customer, product, order: res.body.data.order, checkoutUrl: res.body.data.checkout_url }
}

const completedSession = (order, overrides = {}) => ({
    id: stripeCalls.sessions.at(-1).id,
    object: "checkout.session",
    payment_status: "paid",
    amount_total: Math.round(Number(order.total_amount) * 100),
    payment_intent: "pi_test_123",
    metadata: { order_id: String(order.id) },
    client_reference_id: String(order.id),
    ...overrides,
})

t("a card order opens Stripe Checkout for the server-computed total", async () => {
    const { order, checkoutUrl } = await cardOrder({ price: 40, quantity: 2 })
    assert.match(checkoutUrl, /^https:\/\/checkout\.stripe\.test\//)
    const { params } = stripeCalls.sessions[0]
    assert.equal(params.line_items[0].price_data.unit_amount, 8000)
    assert.equal(params.metadata.order_id, String(order.id))
    assert.match(params.success_url, new RegExp(`/orders/${order.id}\\?payment=success$`))
    const row = await db().order.findUnique({ where: { id: order.id } })
    assert.equal(row.payment_status, "unpaid")
    assert.equal(row.stripe_checkout_session_id, stripeCalls.sessions[0].id)
    // No confirmation email until the money arrives.
    assert.equal(eventsOf("order.created").length, 0)
})

t("the payment webhook marks the order paid and confirmed, once", async () => {
    const { order } = await cardOrder()
    const session = completedSession(order)
    const eventId = "evt_paid_1"
    const res = await sendWebhook("checkout.session.completed", session, { id: eventId })
    assert.equal(res.status, 200)
    const paid = await db().order.findUnique({ where: { id: order.id }, include: { status_history: { orderBy: { id: "asc" } } } })
    assert.equal(paid.payment_status, "paid")
    assert.equal(paid.status, "confirmed")
    assert.equal(paid.stripe_payment_intent_id, "pi_test_123")
    assert.deepEqual(paid.status_history.map((h) => [h.to_status, h.actor_type]), [["pending", "customer"], ["confirmed", "payment"]])
    assert.equal((await waitForEvents("order.created")).length, 1)

    const duplicate = await sendWebhook("checkout.session.completed", session, { id: eventId })
    assert.equal(duplicate.body.duplicate, true)
    assert.equal(await db().orderStatusHistory.count({ where: { order_id: order.id } }), 2)
})

t("webhooks with a bad signature are rejected", async () => {
    const { order } = await cardOrder()
    const res = await sendWebhook("checkout.session.completed", completedSession(order), { secret: "whsec_wrong" })
    assert.equal(res.status, 400)
    assert.equal((await db().order.findUnique({ where: { id: order.id } })).payment_status, "unpaid")
})

t("an expired checkout cancels the order and returns the stock", async () => {
    const { order, product } = await cardOrder({ stock: 3 })
    assert.equal((await db().product.findUnique({ where: { id: product.id } })).stock, 2)
    const res = await sendWebhook("checkout.session.expired", completedSession(order, { payment_status: "unpaid" }))
    assert.equal(res.status, 200)
    const row = await db().order.findUnique({ where: { id: order.id } })
    assert.equal(row.status, "cancelled")
    assert.equal((await db().product.findUnique({ where: { id: product.id } })).stock, 3)
})

t("retrying payment replaces the checkout page, and the old page's expiry is ignored", async () => {
    const { order, token } = await cardOrder()
    const oldSession = stripeCalls.sessions[0].id
    const retry = await api("POST", `/orders/${order.id}/pay`, { token })
    assert.equal(retry.status, 200)
    assert.notEqual(stripeCalls.sessions[1].id, oldSession)
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(stripeCalls.expired, [oldSession])

    await sendWebhook("checkout.session.expired", { id: oldSession, metadata: { order_id: String(order.id) }, payment_status: "unpaid" })
    assert.equal((await db().order.findUnique({ where: { id: order.id } })).status, "pending")
})

t("admins can refund part, then the rest; over-refunding is refused", async () => {
    const { order } = await cardOrder({ price: 50 })
    await sendWebhook("checkout.session.completed", completedSession(order))
    const admin = await createUser({ role: "ADMIN" })
    const total = Number(order.total_amount)

    const partial = await api("POST", `/admin/orders/${order.id}/refunds`, { token: admin.token, body: { amount: 10, reason: "Scratched" } })
    assert.equal(partial.status, 201, JSON.stringify(partial.body))
    assert.equal(partial.body.data.order.payment_status, "partially_refunded")
    assert.equal(stripeCalls.refunds[0].params.amount, 1000)
    assert.equal(stripeCalls.refunds[0].params.payment_intent, "pi_test_123")

    const tooMuch = await api("POST", `/admin/orders/${order.id}/refunds`, { token: admin.token, body: { amount: total } })
    assert.equal(tooMuch.status, 400)

    const rest = await api("POST", `/admin/orders/${order.id}/refunds`, { token: admin.token, body: {} })
    assert.equal(rest.status, 201)
    assert.equal(rest.body.data.order.payment_status, "refunded")
    assert.equal(Number(rest.body.data.order.amount_refunded), total)
    assert.equal((await waitForEvents("order.refunded", 2)).length, 2)

    const customer = await createUser()
    const forbidden = await api("POST", `/admin/orders/${order.id}/refunds`, { token: customer.token, body: {} })
    assert.equal(forbidden.status, 403)
})

t("a customer cancelling a paid card order gets refunded automatically", async () => {
    const { order, token, product } = await cardOrder({ stock: 2 })
    await sendWebhook("checkout.session.completed", completedSession(order))
    const res = await api("POST", `/orders/${order.id}/cancel`, { token })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const row = await db().order.findUnique({ where: { id: order.id } })
    assert.equal(row.status, "cancelled")
    assert.equal(row.payment_status, "refunded")
    assert.equal(stripeCalls.refunds.length, 1)
    assert.equal((await db().product.findUnique({ where: { id: product.id } })).stock, 2)
})

t("cash orders can't be refunded until they're paid; delivery marks them paid", async () => {
    const customer = await createUser()
    const admin = await createUser({ role: "ADMIN" })
    const product = await createProduct({ price: 20 })
    await addToCart(customer.token, product.id)
    const order = (await placeOrder(customer.token)).body.data.order

    const early = await api("POST", `/admin/orders/${order.id}/refunds`, { token: admin.token, body: {} })
    assert.equal(early.status, 400)

    for (const status of ["confirmed", "shipped", "delivered"]) {
        const res = await api("PATCH", `/admin/orders/${order.id}/status`, { token: admin.token, body: { status } })
        assert.equal(res.status, 200, JSON.stringify(res.body))
    }
    const delivered = await db().order.findUnique({ where: { id: order.id } })
    assert.equal(delivered.payment_status, "paid")

    const refund = await api("POST", `/admin/orders/${order.id}/refunds`, { token: admin.token, body: { amount: 5 } })
    assert.equal(refund.status, 201)
    assert.equal(refund.body.data.refund.method, "manual")
    assert.equal(stripeCalls.refunds.length, 0)
})

t("an unpaid card order can't be confirmed or shipped by an admin", async () => {
    const { order } = await cardOrder()
    const admin = await createUser({ role: "ADMIN" })
    const res = await api("PATCH", `/admin/orders/${order.id}/status`, { token: admin.token, body: { status: "confirmed" } })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /hasn't been paid/)
})
