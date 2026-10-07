import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
    enabled, setup, teardown, resetDatabase, api, createUser, createProduct, addToCart, placeOrder, waitForEvents, db,
} from "./helpers.js"

const t = enabled ? test : test.skip
before(async () => { if (enabled) await setup() })
after(async () => { if (enabled) await teardown() })
beforeEach(async () => { if (enabled) await resetDatabase() })

const deliveredOrder = async ({ admin, price = 20, quantity = 2, stock = 10 } = {}) => {
    const customer = await createUser()
    const product = await createProduct({ price, stock })
    await addToCart(customer.token, product.id, quantity)
    const order = (await placeOrder(customer.token)).body.data.order
    for (const status of ["confirmed", "shipped", "delivered"]) {
        await api("PATCH", `/admin/orders/${order.id}/status`, { token: admin.token, body: { status } })
    }
    return { ...customer, product, order }
}

t("shipping records tracking details and the timeline shows each step", async () => {
    const admin = await createUser({ role: "ADMIN" })
    const customer = await createUser()
    const product = await createProduct()
    await addToCart(customer.token, product.id)
    const order = (await placeOrder(customer.token)).body.data.order

    await api("PATCH", `/admin/orders/${order.id}/status`, { token: admin.token, body: { status: "confirmed" } })
    const badUrl = await api("PATCH", `/admin/orders/${order.id}/status`, { token: admin.token, body: { status: "shipped", tracking_url: "javascript:alert(1)" } })
    assert.equal(badUrl.status, 400)
    const shipped = await api("PATCH", `/admin/orders/${order.id}/status`, {
        token: admin.token,
        body: { status: "shipped", tracking_carrier: "TCS", tracking_number: "TCS123", tracking_url: "https://tcs.example/track/TCS123", note: "Left warehouse" },
    })
    assert.equal(shipped.status, 200)
    const skip = await api("PATCH", `/admin/orders/${order.id}/status`, { token: admin.token, body: { status: "cancelled" } })
    assert.equal(skip.status, 400)

    const detail = await api("GET", `/order-details/${order.id}`, { token: customer.token })
    const o = detail.body.data.order
    assert.equal(o.tracking_number, "TCS123")
    assert.ok(o.shipped_at)
    assert.deepEqual(o.status_history.map((h) => h.to_status), ["pending", "confirmed", "shipped"])
    assert.equal(o.status_history[2].note, "Left warehouse")
    assert.equal(o.status_history[2].actor_user_id, undefined)
    const emails = await waitForEvents("order.status.changed", 2)
    assert.equal(emails.at(-1).body.data.trackingNumber, "TCS123")
})

t("returns: request, approve, receive (restock), refund", async () => {
    const admin = await createUser({ role: "ADMIN" })
    const { token, order, product } = await deliveredOrder({ admin, price: 20, quantity: 2, stock: 10 })
    const item = (await db().orderItem.findFirst({ where: { order_id: order.id } }))

    const tooMany = await api("POST", `/orders/${order.id}/returns`, { token, body: { reason: "Wrong size", items: [{ order_item_id: item.id, quantity: 3 }] } })
    assert.equal(tooMany.status, 400)
    const created = await api("POST", `/orders/${order.id}/returns`, { token, body: { reason: "Wrong size", items: [{ order_item_id: item.id, quantity: 1 }] } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const returnId = created.body.data.return.id

    const list = await api("GET", "/admin/returns?status=REQUESTED", { token: admin.token })
    assert.equal(list.body.data.returns.length, 1)
    assert.equal(list.body.data.returns[0].suggested_refund, "20.00")

    const early = await api("POST", `/admin/returns/${returnId}/refund`, { token: admin.token, body: {} })
    assert.equal(early.status, 400)
    assert.equal((await api("PATCH", `/admin/returns/${returnId}`, { token: admin.token, body: { status: "APPROVED" } })).status, 200)
    const stockBefore = (await db().product.findUnique({ where: { id: product.id } })).stock
    assert.equal((await api("PATCH", `/admin/returns/${returnId}`, { token: admin.token, body: { status: "RECEIVED" } })).status, 200)
    assert.equal((await db().product.findUnique({ where: { id: product.id } })).stock, stockBefore + 1)

    const refunded = await api("POST", `/admin/returns/${returnId}/refund`, { token: admin.token, body: {} })
    assert.equal(refunded.status, 201, JSON.stringify(refunded.body))
    assert.equal(refunded.body.data.return.status, "REFUNDED")
    const row = await db().order.findUnique({ where: { id: order.id } })
    assert.equal(row.amount_refunded.toFixed(2), "20.00")
    assert.equal(row.payment_status, "partially_refunded")
    assert.ok((await waitForEvents("order.return.updated", 4)).length >= 4)
})

t("blocked customers can't log in or order, and admins can't be blocked", async () => {
    const admin = await createUser({ role: "ADMIN" })
    const customer = await createUser()
    const product = await createProduct()
    await addToCart(customer.token, product.id)

    assert.equal((await api("PATCH", `/admin/customers/${admin.user.id}/block`, { token: admin.token, body: { blocked: true } })).status, 400)
    const blocked = await api("PATCH", `/admin/customers/${customer.user.id}/block`, { token: admin.token, body: { blocked: true } })
    assert.equal(blocked.status, 200)
    const order = await placeOrder(customer.token)
    assert.equal(order.status, 403)

    const list = await api("GET", "/admin/customers?blocked=true", { token: admin.token })
    assert.equal(list.body.data.customers.length, 1)
    assert.equal(list.body.data.customers[0].email, customer.user.email)
})

t("hidden reviews disappear from the product page and its average", async () => {
    const admin = await createUser({ role: "ADMIN" })
    const { token, product } = await deliveredOrder({ admin })
    const review = await api("POST", `/products/${product.id}/reviews`, { token, body: { rating: 1, comment: "spam spam" } })
    assert.equal(review.status, 201)
    const before = await api("GET", `/products/${product.id}/reviews`)
    assert.equal(before.body.data.summary.count, 1)

    const hidden = await api("PATCH", `/admin/reviews/${review.body.data.review.id}/visibility`, { token: admin.token, body: { is_hidden: true } })
    assert.equal(hidden.status, 200)
    const after = await api("GET", `/products/${product.id}/reviews`)
    assert.equal(after.body.data.summary.count, 0)
    assert.equal(after.body.data.reviews.length, 0)
    const adminList = await api("GET", "/admin/reviews?visibility=hidden", { token: admin.token })
    assert.equal(adminList.body.data.reviews.length, 1)
})

t("CSV export escapes formulas and quotes", async () => {
    const admin = await createUser({ role: "ADMIN" })
    const customer = await createUser()
    const product = await createProduct({ name: '=HYPERLINK("http://evil")' })
    await addToCart(customer.token, product.id)
    await placeOrder(customer.token)
    const orders = await api("GET", "/admin/exports/orders.csv", { token: admin.token })
    assert.equal(orders.status, 200)
    assert.match(orders.headers.get("content-disposition"), /orders-\d{4}-\d{2}-\d{2}\.csv/)
    const lines = orders.body.replace(/^﻿/, "").trim().split("\r\n")
    assert.equal(lines.length, 2)
    // Mid-cell "=" is harmless (spreadsheets only evaluate cells that start with it); quotes are doubled.
    assert.match(lines[1], /"1 x =HYPERLINK\(""http:\/\/evil""\)"/)
    const products = await api("GET", "/admin/exports/products.csv", { token: admin.token })
    assert.match(products.body, /"'=HYPERLINK/)
    assert.equal((await api("GET", "/admin/exports/orders.csv", { token: customer.token })).status, 403)
})

t("dashboard totals count paid and cash orders, not cancelled or unpaid card ones", async () => {
    const admin = await createUser({ role: "ADMIN" })
    const customer = await createUser()
    const product = await createProduct({ price: 10, stock: 100 })
    for (let i = 0; i < 2; i++) {
        await addToCart(customer.token, product.id, 1)
        await placeOrder(customer.token)
    }
    await addToCart(customer.token, product.id, 3)
    const cancelled = (await placeOrder(customer.token)).body.data.order
    await api("POST", `/orders/${cancelled.id}/cancel`, { token: customer.token })
    await api("POST", "/analytics/visits", { body: { visitor_id: "visitor-0001" } })
    await api("POST", "/analytics/visits", { body: { visitor_id: "visitor-0001" } })   // same day: counted once
    await api("POST", "/analytics/visits", { body: { visitor_id: "visitor-0002" } })
    await api("POST", "/analytics/visits", { body: { visitor_id: "visitor-0003" } })
    await api("POST", "/analytics/visits", { body: { visitor_id: "visitor-0004" } })

    const res = await api("GET", "/admin/analytics?days=7", { token: admin.token })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const { totals, series, top_products, status_breakdown } = res.body.data
    assert.equal(totals.orders, 2)
    assert.equal(totals.revenue, 20)
    assert.equal(totals.average_order_value, 10)
    assert.equal(totals.visits, 4)
    assert.equal(totals.conversion_rate, 50)
    assert.equal(series.length, 7)
    assert.equal(series.at(-1).orders, 2)
    assert.equal(top_products[0].quantity, 2)
    assert.equal(status_breakdown.cancelled, 1)
})

t("back-in-stock: signing up, then restocking emails each person once", async () => {
    const admin = await createUser({ role: "ADMIN" })
    const product = await createProduct({ stock: 0 })
    const customer = await createUser()
    assert.equal((await api("POST", `/products/${product.id}/stock-alerts`, { body: { email: "guest@example.com" } })).status, 201)
    assert.equal((await api("POST", `/products/${product.id}/stock-alerts`, { body: { email: "guest@example.com" } })).status, 201)
    assert.equal((await api("POST", `/products/${product.id}/stock-alerts`, { token: customer.token, body: {} })).status, 201)
    assert.equal(await db().stockNotification.count(), 2)

    await api("PUT", `/products/${product.id}`, { token: admin.token, body: { stock: 5 } })
    const events = await waitForEvents("inventory.back_in_stock", 2)
    assert.deepEqual(events.map((e) => e.body.data.email).sort(), ["guest@example.com", customer.user.email].sort())
    assert.equal(await db().stockNotification.count({ where: { notified_at: null } }), 0)
    assert.equal((await api("POST", `/products/${product.id}/stock-alerts`, { body: { email: "x@example.com" } })).status, 400)
})

t("admin catalog tools: variants, sales, coupons, shipping zones and settings", async () => {
    const admin = await createUser({ role: "ADMIN" })
    const customer = await createUser()
    const product = await createProduct({ price: 40, stock: 0 })

    const variant = await api("POST", `/products/${product.id}/variants`, { token: admin.token, body: { name: "Blue", stock: 3, price: 45, options: { Color: "Blue" } } })
    assert.equal(variant.status, 201, JSON.stringify(variant.body))
    assert.equal((await api("POST", `/products/${product.id}/variants`, { token: customer.token, body: { name: "x" } })).status, 403)

    const sale = await api("POST", "/admin/sales", {
        token: admin.token,
        body: { name: "Launch", percent_off: 20, product_id: product.id, starts_at: new Date(Date.now() - 1000).toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString() },
    })
    assert.equal(sale.status, 201, JSON.stringify(sale.body))
    const deals = await api("GET", "/products?onSale=true")
    assert.deepEqual(deals.body.data.products.map((p) => p.id), [product.id])
    const detail = await api("GET", `/products/${product.id}`)
    assert.equal(detail.body.data.product.sale_percent, 20)
    assert.equal(detail.body.data.product.variants[0].sale_price, "36.00")

    const both = await api("POST", "/admin/sales", { token: admin.token, body: { name: "x", percent_off: 5, product_id: product.id, category_id: product.category_id, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 1000).toISOString() } })
    assert.equal(both.status, 400)

    const coupon = await api("POST", "/admin/coupons", { token: admin.token, body: { code: "spring-10", type: "PERCENT", value: 10, max_discount: 3 } })
    assert.equal(coupon.status, 201, JSON.stringify(coupon.body))
    assert.equal(coupon.body.data.coupon.code, "SPRING-10")
    const paused = await api("PATCH", `/admin/coupons/${coupon.body.data.coupon.id}/status`, { token: admin.token, body: { is_active: false } })
    assert.equal(paused.status, 200)
    const coupons = await api("GET", "/admin/coupons", { token: admin.token })
    assert.equal(coupons.body.data.coupons[0].state, "paused")

    const zone = await api("POST", "/admin/shipping-zones", { token: admin.token, body: { name: "Lahore", regions: ["Lahore", "  lahore "], rate: 4, is_default: true } })
    assert.deepEqual(zone.body.data.zone.regions, ["lahore"])

    const settings = await api("PUT", "/admin/settings", { token: admin.token, body: { tax_rate: 17, store_name: "TBVault PK" } })
    assert.equal(settings.status, 200)
    assert.equal((await api("PUT", "/admin/settings", { token: admin.token, body: { tax_rate: 900 } })).status, 400)
    const config = await api("GET", "/store/config")
    assert.equal(config.body.data.tax_rate, 17)
    assert.equal(config.body.data.alert_email, undefined)
})

t("wishlist add, list and remove; related products skip hidden ones", async () => {
    const { token } = await createUser()
    const a = await createProduct({ name: "A" })
    const b = await createProduct({ name: "B" })
    const hidden = await createProduct({ name: "Hidden" })
    await db().product.update({ where: { id: hidden.id }, data: { is_hidden: true } })

    await api("POST", "/wishlist/items", { token, body: { product_id: a.id } })
    await api("POST", "/wishlist/items", { token, body: { product_id: a.id } })
    assert.equal((await api("POST", "/wishlist/items", { token, body: { product_id: hidden.id } })).status, 404)
    let list = await api("GET", "/wishlist", { token })
    assert.equal(list.body.data.items.length, 1)
    await api("DELETE", `/wishlist/items/${a.id}`, { token })
    list = await api("GET", "/wishlist", { token })
    assert.equal(list.body.data.items.length, 0)

    const related = await api("GET", `/products/${a.id}/related`)
    assert.deepEqual(related.body.data.products.map((p) => p.name), ["B"])
    const byIds = await api("GET", `/products?ids=${b.id},${hidden.id}`)
    assert.deepEqual(byIds.body.data.products.map((p) => p.name), ["B"])
})
