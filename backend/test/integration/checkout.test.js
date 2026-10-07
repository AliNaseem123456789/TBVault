import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { enabled, setup, teardown, resetDatabase, api, createUser, createProduct, addToCart, placeOrder, ADDRESS, eventsOf, waitForEvents, db } from "./helpers.js"

const t = enabled ? test : test.skip
before(async () => { if (enabled) await setup() })
after(async () => { if (enabled) await teardown() })
beforeEach(async () => { if (enabled) await resetDatabase() })

// Store with: 10% tax, a $5 default shipping zone free over $50, Karachi shipping $3.
const seedStore = async () => {
    const prisma = db()
    await prisma.setting.createMany({ data: [{ key: "tax_rate", value: "10" }, { key: "low_stock_threshold", value: "3" }, { key: "alert_email", value: "ops@example.com" }] })
    await prisma.shippingZone.create({ data: { name: "Standard", regions: [], rate: 5, free_over: 50, is_default: true } })
    await prisma.shippingZone.create({ data: { name: "Karachi", regions: ["karachi"], rate: 3 } })
}

t("quote applies sale, coupon, regional shipping and tax in the documented order", async () => {
    await seedStore()
    const prisma = db()
    const lamp = await createProduct({ name: "Lamp", price: 20, stock: 10 })
    await prisma.sale.create({ data: { name: "Lamp week", percent_off: 25, product_id: lamp.id, starts_at: new Date(Date.now() - 1000), ends_at: new Date(Date.now() + 86400000) } })
    await prisma.coupon.create({ data: { code: "TENOFF", type: "PERCENT", value: 10 } })

    const { status, body } = await api("POST", "/order/quote", {
        body: { items: [{ product_id: lamp.id, quantity: 2 }], address: ADDRESS, coupon_code: "tenoff" },
    })
    assert.equal(status, 200)
    // 2 x (20 - 25%) = 30.00; -10% = 27.00; Karachi zone $3; tax 10% of 27 = 2.70
    assert.deepEqual(body.data.totals, { subtotal: "30.00", discount: "3.00", shipping: "3.00", tax: "2.70", total: "32.70" })
    assert.equal(body.data.items[0].list_price, "20.00")
    assert.equal(body.data.items[0].unit_price, "15.00")
    assert.equal(body.data.shipping_zone.name, "Karachi")
    assert.equal(body.data.coupon.code, "TENOFF")
})

t("quote explains why a coupon can't be used", async () => {
    await seedStore()
    const lamp = await createProduct({ price: 20 })
    await db().coupon.create({ data: { code: "BIG", type: "FIXED", value: 5, min_order_amount: 100 } })
    const { body } = await api("POST", "/order/quote", { body: { items: [{ product_id: lamp.id, quantity: 1 }], coupon_code: "BIG" } })
    assert.match(body.data.coupon_error, /Spend at least \$100\.00/)
    assert.equal(body.data.totals.discount, "0.00")
})

t("placing an order stores the price breakdown, takes stock, records the coupon and empties the cart", async () => {
    await seedStore()
    const prisma = db()
    const { user, token } = await createUser()
    const lamp = await createProduct({ price: 30, stock: 5 })
    await prisma.coupon.create({ data: { code: "FIVE", type: "FIXED", value: 5, per_user_limit: 1 } })
    await addToCart(token, lamp.id, 2)

    const res = await placeOrder(token, { coupon_code: "FIVE" })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const order = await prisma.order.findUnique({ where: { id: res.body.data.order.id }, include: { items: true, status_history: true } })
    // 60 - 5 = 55 (>= 50 so the default... but Karachi zone matches: $3); tax 5.50
    assert.equal(order.subtotal.toFixed(2), "60.00")
    assert.equal(order.discount_total.toFixed(2), "5.00")
    assert.equal(order.shipping_total.toFixed(2), "3.00")
    assert.equal(order.tax_total.toFixed(2), "5.50")
    assert.equal(order.total_amount.toFixed(2), "63.50")
    assert.equal(order.items[0].product_name, "Lamp")
    assert.equal(order.status_history.length, 1)
    assert.equal(order.payment_method, "cod")

    assert.equal((await prisma.product.findUnique({ where: { id: lamp.id } })).stock, 3)
    assert.equal((await prisma.coupon.findUnique({ where: { code: "FIVE" } })).times_used, 1)
    assert.equal(await prisma.couponRedemption.count({ where: { user_id: user.id } }), 1)
    assert.equal(await prisma.cartItem.count(), 0)
    const created = await waitForEvents("order.created")
    assert.equal(created.length, 1)
    assert.equal(created[0].body.data.totalAmount, "63.50")
    // Stock went 5 -> 3, which crosses the threshold of 3.
    const low = await waitForEvents("inventory.low_stock")
    assert.equal(low.length, 1)
    assert.deepEqual(low[0].body.data.recipients, ["ops@example.com"])
    assert.equal(low[0].body.data.items[0].stock, 3)

    // Per-customer limit of 1.
    await addToCart(token, lamp.id, 1)
    const again = await placeOrder(token, { coupon_code: "FIVE" })
    assert.equal(again.status, 400)
    assert.match(again.body.message, /already used this coupon/)
})

t("a coupon's total usage limit can't be exceeded", async () => {
    await seedStore()
    const lamp = await createProduct({ price: 10, stock: 50 })
    await db().coupon.create({ data: { code: "ONCE", type: "PERCENT", value: 50, usage_limit: 1 } })
    const a = await createUser()
    const b = await createUser()
    await addToCart(a.token, lamp.id)
    await addToCart(b.token, lamp.id)
    assert.equal((await placeOrder(a.token, { coupon_code: "ONCE" })).status, 201)
    const second = await placeOrder(b.token, { coupon_code: "ONCE" })
    assert.equal(second.status, 400)
    assert.match(second.body.message, /fully redeemed/)
})

t("an order that would oversell is rejected and changes nothing", async () => {
    const { token } = await createUser()
    const lamp = await createProduct({ stock: 1 })
    await addToCart(token, lamp.id, 2)
    const res = await placeOrder(token)
    assert.equal(res.status, 409)
    assert.match(res.body.message, /Only 1 of Lamp left/)
    assert.equal(await db().order.count(), 0)
    assert.equal((await db().product.findUnique({ where: { id: lamp.id } })).stock, 1)
})

t("products with options need one picked, and stock comes from the option", async () => {
    const { token } = await createUser()
    const shirt = await createProduct({ name: "Shirt", price: 25, stock: 0, variants: [{ name: "M", stock: 2 }, { name: "L", stock: 0, price: 27 }] })
    const [medium, large] = shirt.variants

    assert.equal((await addToCart(token, shirt.id, 1)).status, 400)
    assert.equal((await addToCart(token, shirt.id, 1, medium.id)).status, 201)
    const cart = await api("GET", "/cart", { token })
    assert.equal(cart.body.data.cart[0].items[0].variant.name, "M")

    const res = await placeOrder(token)
    assert.equal(res.status, 201)
    assert.equal((await db().productVariant.findUnique({ where: { id: medium.id } })).stock, 1)
    const item = (await db().orderItem.findFirst())
    assert.equal(item.variant_name, "M")

    // Out-of-stock option can be added to the cart but not bought.
    await addToCart(token, shirt.id, 1, large.id)
    const out = await placeOrder(token)
    assert.equal(out.status, 409)
})

t("the same Idempotency-Key returns the first order instead of placing a second", async () => {
    const { token } = await createUser()
    const lamp = await createProduct({ stock: 10 })
    await addToCart(token, lamp.id)
    const key = crypto.randomUUID()
    const first = await placeOrder(token, {}, key)
    const second = await placeOrder(token, {}, key)
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    assert.equal(second.body.data.order.id, first.body.data.order.id)
    assert.equal(await db().order.count(), 1)
})

t("guests can check out, then track and cancel with their link", async () => {
    const lamp = await createProduct({ stock: 4 })
    const res = await api("POST", "/order/guest", {
        body: { email: "Guest@Example.com", items: [{ product_id: lamp.id, quantity: 2 }], address: ADDRESS },
        headers: { "Idempotency-Key": crypto.randomUUID() },
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const token = res.body.data.tracking_token
    assert.match(token, /^[a-f0-9]{48}$/)
    assert.equal(res.body.data.order.guest_email, "guest@example.com")

    const tracked = await api("GET", `/order/track/${token}`)
    assert.equal(tracked.status, 200)
    assert.equal(tracked.body.data.order.status_history[0].to_status, "pending")
    assert.equal(tracked.body.data.order.stripe_payment_intent_id, undefined)

    const lookup = await api("POST", "/order/track", { body: { order_id: res.body.data.order.id, email: "guest@example.com" } })
    assert.equal(lookup.body.data.token, token)
    const wrong = await api("POST", "/order/track", { body: { order_id: res.body.data.order.id, email: "someone@else.com" } })
    assert.equal(wrong.status, 404)

    const cancelled = await api("POST", `/order/track/${token}/cancel`)
    assert.equal(cancelled.status, 200)
    assert.equal((await db().product.findUnique({ where: { id: lamp.id } })).stock, 4)
})

t("cancelling puts stock back and frees the coupon use", async () => {
    const { token } = await createUser()
    const lamp = await createProduct({ stock: 3 })
    await db().coupon.create({ data: { code: "BACK", type: "FREE_SHIPPING", per_user_limit: 1 } })
    await addToCart(token, lamp.id, 3)
    const order = (await placeOrder(token, { coupon_code: "BACK" })).body.data.order
    assert.equal((await db().product.findUnique({ where: { id: lamp.id } })).stock, 0)

    const res = await api("POST", `/orders/${order.id}/cancel`, { token })
    assert.equal(res.status, 200)
    assert.equal((await db().product.findUnique({ where: { id: lamp.id } })).stock, 3)
    assert.equal((await db().coupon.findUnique({ where: { code: "BACK" } })).times_used, 0)
    assert.equal(await db().couponRedemption.count(), 0)
    const history = await db().orderStatusHistory.findMany({ where: { order_id: order.id }, orderBy: { id: "asc" } })
    assert.deepEqual(history.map((h) => h.to_status), ["pending", "cancelled"])
})

t("a guest cart merges into the account after login", async () => {
    const { token } = await createUser()
    const lamp = await createProduct()
    const gone = await createProduct({ name: "Gone" })
    await db().product.update({ where: { id: gone.id }, data: { is_hidden: true } })
    await addToCart(token, lamp.id, 1)
    const res = await api("POST", "/cart/merge", { token, body: { items: [{ product_id: lamp.id, quantity: 2 }, { product_id: gone.id, quantity: 1 }] } })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.merged, 1)
    assert.equal(res.body.data.skipped.length, 1)
    assert.equal((await db().cartItem.findFirst()).quantity, 3)
})

t("saved addresses: first is default, deleting the default promotes the next", async () => {
    const { token } = await createUser()
    const a = (await api("POST", "/addresses", { token, body: ADDRESS })).body.data.address
    const b = (await api("POST", "/addresses", { token, body: { ...ADDRESS, label: "Office" } })).body.data.address
    assert.equal(a.is_default, true)
    assert.equal(b.is_default, false)
    await api("DELETE", `/addresses/${a.id}`, { token })
    const list = (await api("GET", "/addresses", { token })).body.data.addresses
    assert.equal(list.length, 1)
    assert.equal(list[0].is_default, true)

    // Order with a saved address id.
    const lamp = await createProduct()
    await addToCart(token, lamp.id)
    const res = await api("POST", "/order", { token, body: { address_id: b.id }, headers: { "Idempotency-Key": crypto.randomUUID() } })
    assert.equal(res.status, 201)
    assert.match(res.body.data.order.shipping_address, /1 Main Street/)

    const other = await createUser()
    const stolen = await api("POST", "/order", { token: other.token, body: { address_id: b.id }, headers: { "Idempotency-Key": crypto.randomUUID() } })
    assert.equal(stolen.status, 400)
})
