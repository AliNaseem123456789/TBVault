import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
    enabled, setup, teardown, resetDatabase, api, createUser, createSeller, createProduct,
    addToCart, placeOrder, sendWebhook, stripeCalls, db,
} from "./helpers.js"

const t = enabled ? test : test.skip
before(async () => { if (enabled) await setup() })
after(async () => { if (enabled) await teardown() })
beforeEach(async () => { if (enabled) await resetDatabase() })

const admin = () => createUser({ role: "ADMIN" })
const advance = (token, orderId, status, extra = {}) =>
    api("PATCH", `/admin/orders/${orderId}/status`, { token, body: { status, ...extra } })

// ==============================
// SELLER ONBOARDING AND RBAC
// ==============================

t("a customer applies, an admin approves, and the new seller manages only their own products", async () => {
    const prisma = db()
    const { user, token } = await createUser()
    const { token: adminToken } = await admin()

    const applied = await api("POST", "/seller/apply", { token, body: { store_name: "Ali's Lamps", description: "Hand-made lamps" } })
    assert.equal(applied.status, 201, JSON.stringify(applied.body))
    assert.equal(applied.body.data.seller.slug, "ali-s-lamps")
    assert.equal((await api("POST", "/seller/apply", { token, body: { store_name: "Again" } })).status, 409)

    // Not approved yet: seller routes are closed.
    assert.equal((await api("GET", "/seller/products", { token })).status, 403)
    // Customers can't approve anyone.
    assert.equal((await api("PATCH", `/admin/sellers/${applied.body.data.seller.id}/status`, { token, body: { status: "APPROVED" } })).status, 403)

    const approved = await api("PATCH", `/admin/sellers/${applied.body.data.seller.id}/status`, { token: adminToken, body: { status: "APPROVED" } })
    assert.equal(approved.status, 200)
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).role, "SELLER")

    const category = await prisma.category.create({ data: { name: "Lighting" } })
    // seller_id in the body is ignored: a seller always creates in their own store.
    const created = await api("POST", "/seller/products", { token, body: { name: "Desk lamp", price: 40, stock: 3, category_id: category.id, seller_id: 999 } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    assert.equal(created.body.data.product.seller_id, applied.body.data.seller.id)

    const theirs = await createProduct({ name: "Store lamp" })
    assert.equal((await api("PUT", `/seller/products/${theirs.id}`, { token, body: { price: 1 } })).status, 404)
    assert.equal((await api("DELETE", `/seller/products/${theirs.id}`, { token })).status, 404)
    assert.equal((await api("PUT", `/products/${created.body.data.product.id}`, { token, body: { price: 1 } })).status, 403)

    const mine = await api("GET", "/seller/products", { token })
    assert.deepEqual(mine.body.data.products.map((p) => p.name), ["Desk lamp"])

    // Public store page and product show the seller.
    const store = await api("GET", "/stores/ali-s-lamps")
    assert.equal(store.status, 200)
    assert.equal(store.body.data.store._count.products, 1)
    const product = await api("GET", `/products/${created.body.data.product.id}`)
    assert.equal(product.body.data.product.seller.store_name, "Ali's Lamps")
})

t("suspending a seller hides their products and blocks checkout; reinstating brings them back", async () => {
    const { token: adminToken } = await admin()
    const { seller } = await createSeller()
    const lamp = await createProduct({ name: "Seller lamp", sellerId: seller.id })
    const { token } = await createUser()
    await addToCart(token, lamp.id, 1)

    const suspended = await api("PATCH", `/admin/sellers/${seller.id}/status`, { token: adminToken, body: { status: "SUSPENDED", note: "Policy check" } })
    assert.equal(suspended.status, 200)
    assert.equal((await api("GET", `/products/${lamp.id}`)).status, 404)
    assert.equal((await api("GET", "/products")).body.data.products.length, 0)
    const order = await placeOrder(token)
    assert.equal(order.status, 409)

    await api("PATCH", `/admin/sellers/${seller.id}/status`, { token: adminToken, body: { status: "APPROVED" } })
    assert.equal((await api("GET", `/products/${lamp.id}`)).status, 200)
})

// ==============================
// SPLIT ORDERS, COMMISSION, PAYOUTS
// ==============================

t("a mixed cart becomes one order with a shipment per seller; each seller ships their part and earns after delivery", async () => {
    const prisma = db()
    const { token: adminToken } = await admin()
    const { token: sellerToken, seller } = await createSeller({ commissionRate: 20 })
    const sellerLamp = await createProduct({ name: "Seller lamp", price: 50, sellerId: seller.id })
    const storeLamp = await createProduct({ name: "Store lamp", price: 30 })
    const { token } = await createUser()
    await addToCart(token, sellerLamp.id, 2)
    await addToCart(token, storeLamp.id, 1)

    const placed = await placeOrder(token, { payment_method: "cod" })
    assert.equal(placed.status, 201, JSON.stringify(placed.body))
    const orderId = placed.body.data.order.id
    const shipments = await prisma.sellerOrder.findMany({ where: { order_id: orderId }, orderBy: { id: "asc" } })
    assert.equal(shipments.length, 2)
    const sellerShipment = shipments.find((s) => s.seller_id === seller.id)
    // 2 x 50 = 100; 20% commission = 20; seller earns 80.
    assert.equal(sellerShipment.subtotal.toFixed(2), "100.00")
    assert.equal(sellerShipment.commission_amount.toFixed(2), "20.00")
    assert.equal(sellerShipment.seller_earnings.toFixed(2), "80.00")

    // The seller sees only their shipment and items.
    const list = await api("GET", "/seller/orders", { token: sellerToken })
    assert.equal(list.body.data.orders.length, 1)
    assert.deepEqual(list.body.data.orders[0].items.map((i) => i.product_name), ["Seller lamp"])
    assert.deepEqual(list.body.data.orders[0].next_statuses, ["confirmed"])

    // Customer's view hides commissions.
    const customerView = await api("GET", `/order-details/${orderId}`, { token })
    assert.equal(customerView.body.data.order.seller_orders.length, 2)
    assert.equal(customerView.body.data.order.seller_orders[0].seller_earnings, undefined)

    for (const status of ["confirmed", "shipped", "delivered"]) {
        const res = await api("PATCH", `/seller/orders/${sellerShipment.id}/status`, {
            token: sellerToken, body: { status, ...(status === "shipped" ? { tracking_carrier: "TCS", tracking_number: "T1" } : {}) },
        })
        assert.equal(res.status, 200, JSON.stringify(res.body))
    }
    // The store hasn't even confirmed its part, so the order follows the slowest shipment,
    // and cash on delivery isn't collected yet: no earnings.
    let order = await prisma.order.findUnique({ where: { id: orderId } })
    assert.equal(order.status, "pending")
    assert.equal((await api("GET", "/seller/dashboard", { token: sellerToken })).body.data.money.balance, "0.00")
    assert.equal((await api("GET", "/seller/dashboard", { token: sellerToken })).body.data.money.pending_earnings, "80.00")

    // The admin confirms, ships and delivers the rest; cash is collected and the seller's earnings land.
    assert.equal((await advance(adminToken, orderId, "confirmed")).status, 200)
    assert.equal((await advance(adminToken, orderId, "shipped")).status, 200)
    assert.equal((await advance(adminToken, orderId, "delivered")).status, 200)
    order = await prisma.order.findUnique({ where: { id: orderId }, include: { seller_orders: true } })
    assert.equal(order.payment_status, "paid")
    assert.ok(order.seller_orders.every((s) => s.status === "delivered"))
    const dashboard = await api("GET", "/seller/dashboard", { token: sellerToken })
    assert.equal(dashboard.body.data.money.balance, "80.00")

    // Payouts can't exceed the balance and reduce it.
    assert.equal((await api("POST", `/admin/sellers/${seller.id}/payouts`, { token: adminToken, body: { amount: 81 } })).status, 400)
    const payout = await api("POST", `/admin/sellers/${seller.id}/payouts`, { token: adminToken, body: { amount: 50, reference: "BANK-1" } })
    assert.equal(payout.status, 201, JSON.stringify(payout.body))
    assert.equal(payout.body.data.money.balance, "30.00")
    const ledger = await api("GET", "/seller/transactions", { token: sellerToken })
    assert.deepEqual(ledger.body.data.transactions.map((t) => [t.type, Number(t.amount)]), [["payout", -50], ["earning", 80]])

    // Earnings are credited once, even if the admin pokes the order again.
    await advance(adminToken, orderId, "delivered")
    assert.equal((await api("GET", "/seller/dashboard", { token: sellerToken })).body.data.money.balance, "30.00")
})

t("sellers can't work on unpaid card orders or other sellers' shipments", async () => {
    const { token: sellerToken, seller } = await createSeller()
    const { token: otherToken } = await createSeller()
    const lamp = await createProduct({ price: 20, sellerId: seller.id })
    const { token } = await createUser()
    await addToCart(token, lamp.id, 1)
    const placed = await placeOrder(token, { payment_method: "card" })
    assert.equal(placed.status, 201, JSON.stringify(placed.body))
    const shipment = await db().sellerOrder.findFirst({ where: { order_id: placed.body.data.order.id } })

    assert.equal((await api("PATCH", `/seller/orders/${shipment.id}/status`, { token: otherToken, body: { status: "confirmed" } })).status, 404)
    const unpaid = await api("PATCH", `/seller/orders/${shipment.id}/status`, { token: sellerToken, body: { status: "confirmed" } })
    assert.equal(unpaid.status, 400)
    assert.match(unpaid.body.message, /hasn't paid/)
})

t("refunding a return takes the seller's earnings on those items back", async () => {
    const prisma = db()
    const { token: adminToken } = await admin()
    const { token: sellerToken, seller } = await createSeller({ commissionRate: 10 })
    const lamp = await createProduct({ price: 40, sellerId: seller.id })
    const { token } = await createUser()
    await addToCart(token, lamp.id, 2)
    const orderId = (await placeOrder(token)).body.data.order.id
    for (const s of ["confirmed", "shipped", "delivered"]) await advance(adminToken, orderId, s)
    assert.equal((await api("GET", "/seller/dashboard", { token: sellerToken })).body.data.money.balance, "72.00")

    const item = await prisma.orderItem.findFirst({ where: { order_id: orderId } })
    const ret = await api("POST", `/orders/${orderId}/returns`, { token, body: { reason: "Broken", items: [{ order_item_id: item.id, quantity: 1 }] } })
    assert.equal(ret.status, 201, JSON.stringify(ret.body))
    const approved = await api("PATCH", `/admin/returns/${ret.body.data.return.id}`, { token: adminToken, body: { status: "APPROVED" } })
    assert.equal(approved.status, 200, JSON.stringify(approved.body))
    const refunded = await api("POST", `/admin/returns/${ret.body.data.return.id}/refund`, { token: adminToken, body: { destination: "credits" } })
    assert.equal(refunded.status, 201, JSON.stringify(refunded.body))
    // One lamp: 40 - 10% = 36 taken back from 72.
    assert.equal((await api("GET", "/seller/dashboard", { token: sellerToken })).body.data.money.balance, "36.00")
})

// ==============================
// STORE CREDIT
// ==============================

t("store credit can pay a whole order; cancelling gives it back", async () => {
    const prisma = db()
    const { token: adminToken } = await admin()
    const { user, token } = await createUser()
    const lamp = await createProduct({ price: 25, stock: 5 })

    const granted = await api("POST", `/admin/customers/${user.id}/credits`, { token: adminToken, body: { amount: 60, note: "Welcome gift" } })
    assert.equal(granted.status, 201, JSON.stringify(granted.body))
    assert.equal(granted.body.data.balance, "60")

    await addToCart(token, lamp.id, 2)
    const quote = await api("POST", "/order/quote", { token, body: { use_credits: true } })
    assert.equal(quote.body.data.totals.credits_applied, "50.00")
    assert.equal(quote.body.data.totals.amount_due, "0.00")

    const placed = await placeOrder(token, { use_credits: true, payment_method: "card" })
    assert.equal(placed.status, 201, JSON.stringify(placed.body))
    assert.equal(placed.body.data.checkout_url, null)   // nothing left for the card
    let order = await prisma.order.findUnique({ where: { id: placed.body.data.order.id } })
    assert.equal(order.payment_method, "credits")
    assert.equal(order.payment_status, "paid")
    assert.equal(order.status, "confirmed")
    assert.equal((await api("GET", "/wallet", { token })).body.data.balance, "10")

    const cancelled = await api("POST", `/orders/${order.id}/cancel`, { token })
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
    order = await prisma.order.findUnique({ where: { id: order.id }, include: { refunds: true } })
    assert.equal(order.payment_status, "refunded")
    assert.deepEqual(order.refunds.map((r) => r.method), ["credits"])
    const wallet = await api("GET", "/wallet", { token })
    assert.equal(wallet.body.data.balance, "60")
    assert.deepEqual(wallet.body.data.transactions.map((t) => t.type), ["refund", "order_payment", "admin_grant"])
})

t("partial credit + card: Stripe charges the rest, and an expired payment returns the credit", async () => {
    const prisma = db()
    const { token: adminToken } = await admin()
    const { user, token } = await createUser()
    const lamp = await createProduct({ price: 40 })
    await api("POST", `/admin/customers/${user.id}/credits`, { token: adminToken, body: { amount: 15, note: "Goodwill" } })
    await addToCart(token, lamp.id, 1)

    const placed = await placeOrder(token, { use_credits: true, payment_method: "card" })
    assert.equal(placed.status, 201, JSON.stringify(placed.body))
    const session = stripeCalls.sessions.at(-1)
    assert.equal(session.params.line_items[0].price_data.unit_amount, 2500)   // 40 - 15
    assert.equal((await api("GET", "/wallet", { token })).body.data.balance, "0")

    const orderId = placed.body.data.order.id
    await sendWebhook("checkout.session.expired", { id: session.id, metadata: { order_id: String(orderId) }, client_reference_id: String(orderId) })
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    assert.equal(order.status, "cancelled")
    assert.equal((await api("GET", "/wallet", { token })).body.data.balance, "15")
})

t("a credit refund can't go to a guest, and a card refund splits card and credit parts", async () => {
    const prisma = db()
    const { token: adminToken } = await admin()
    const { user, token } = await createUser()
    const lamp = await createProduct({ price: 40 })
    await api("POST", `/admin/customers/${user.id}/credits`, { token: adminToken, body: { amount: 10, note: "Promo" } })
    await addToCart(token, lamp.id, 1)
    const placed = await placeOrder(token, { use_credits: true, payment_method: "card" })
    const orderId = placed.body.data.order.id
    const session = stripeCalls.sessions.at(-1)
    await sendWebhook("checkout.session.completed", { id: session.id, payment_status: "paid", amount_total: 3000, payment_intent: "pi_1", metadata: { order_id: String(orderId) } })

    // Full refund to the original payment: 30 back to the card, 10 back to credit.
    const refund = await api("POST", `/admin/orders/${orderId}/refunds`, { token: adminToken, body: {} })
    assert.equal(refund.status, 201, JSON.stringify(refund.body))
    assert.deepEqual(refund.body.data.refunds.map((r) => [r.method, Number(r.amount)]), [["stripe", 30], ["credits", 10]])
    assert.equal(stripeCalls.refunds.at(-1).params.amount, 3000)
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).credit_balance.toFixed(2), "10.00")
})

t("gift cards are redeemed once; top-ups are credited once even if Stripe repeats the webhook", async () => {
    const { token: adminToken } = await admin()
    const { user, token } = await createUser()
    const { token: otherToken } = await createUser()

    const created = await api("POST", "/admin/gift-cards", { token: adminToken, body: { amount: 25, quantity: 2 } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const [card] = created.body.data.gift_cards
    assert.match(card.code, /^TBV-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    const redeemed = await api("POST", "/wallet/redeem", { token, body: { code: card.code.toLowerCase() } })
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body))
    assert.equal((await api("POST", "/wallet/redeem", { token: otherToken, body: { code: card.code } })).status, 400)

    const topup = await api("POST", "/wallet/topup", { token, body: { amount: 20 } })
    assert.equal(topup.status, 201, JSON.stringify(topup.body))
    const session = stripeCalls.sessions.at(-1)
    assert.equal(session.params.metadata.kind, "wallet_topup")
    const paid = { id: session.id, payment_status: "paid", metadata: session.params.metadata }
    await sendWebhook("checkout.session.completed", paid)
    await sendWebhook("checkout.session.completed", paid)   // a different event id, same session
    const wallet = await api("GET", "/wallet", { token })
    assert.equal(wallet.body.data.balance, "45")
    assert.equal((await db().creditTopup.findFirst({ where: { user_id: user.id } })).status, "paid")

    assert.equal((await api("POST", "/wallet/topup", { token, body: { amount: 2 } })).status, 400)   // below the minimum
})

t("admins can't take more credit than a customer has", async () => {
    const { token: adminToken } = await admin()
    const { user } = await createUser()
    await api("POST", `/admin/customers/${user.id}/credits`, { token: adminToken, body: { amount: 5, note: "x" } })
    const res = await api("POST", `/admin/customers/${user.id}/credits`, { token: adminToken, body: { amount: -6, note: "oops" } })
    assert.equal(res.status, 400)
    assert.equal((await api("POST", `/admin/customers/${user.id}/credits`, { token: adminToken, body: { amount: -5, note: "undo" } })).status, 201)
})

// ==============================
// BRANDS
// ==============================

t("brands can be managed by admins and filter the catalogue", async () => {
    const prisma = db()
    const { token: adminToken } = await admin()
    const brand = await api("POST", "/admin/brands", { token: adminToken, body: { name: "Lumen" } })
    assert.equal(brand.status, 201)
    assert.equal((await api("POST", "/admin/brands", { token: adminToken, body: { name: "Lumen" } })).status, 409)
    const lamp = await createProduct({ name: "Branded lamp" })
    await createProduct({ name: "Plain lamp" })
    await prisma.product.update({ where: { id: lamp.id }, data: { brand_id: brand.body.data.brand.id } })

    const filtered = await api("GET", `/products?brandId=${brand.body.data.brand.id}`)
    assert.deepEqual(filtered.body.data.products.map((p) => p.name), ["Branded lamp"])
    assert.equal(filtered.body.data.products[0].brand.name, "Lumen")
    const list = await api("GET", "/brands")
    assert.equal(list.body.data.brands[0]._count.products, 1)
})
