import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { enabled, setup, teardown, resetDatabase, api, createUser, createProduct, addToCart, placeOrder, eventsOf, db } from "./helpers.js"

const t = enabled ? test : test.skip
before(async () => { if (enabled) await setup() })
after(async () => { if (enabled) await teardown() })
beforeEach(async () => { if (enabled) await resetDatabase() })

const buy = async (token, product, quantity) => {
    await addToCart(token, product.id, quantity)
    const res = await placeOrder(token, { payment_method: "cod" })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.data.order
}

t("sortBy=best_selling ranks by units sold, ignores cancelled orders, then newest first", async () => {
    const { token } = await createUser()
    const lamp = await createProduct({ name: "Lamp", stock: 50 })
    const mug = await createProduct({ name: "Mug", stock: 50 })
    const kettle = await createProduct({ name: "Kettle", stock: 50 })
    const rug = await createProduct({ name: "Rug", stock: 50 })   // never sold, newest

    await buy(token, mug, 3)
    await buy(token, lamp, 1)
    const cancelled = await buy(token, kettle, 9)
    await api("POST", `/orders/${cancelled.id}/cancel`, { token })

    const { status, body } = await api("GET", "/products?sortBy=best_selling&limit=10")
    assert.equal(status, 200)
    const names = body.data.products.map((p) => p.name)
    assert.deepEqual(names.slice(0, 2), ["Mug", "Lamp"])
    // Unsold ones (the cancelled kettle counts as unsold) come after, newest first.
    assert.deepEqual(names.slice(2), ["Rug", "Kettle"])
    assert.equal(body.data.products[0].units_sold, 3)
    assert.equal(body.metaData.totalPages, 1)

    const page2 = await api("GET", "/products?sortBy=best_selling&limit=1&page=2")
    assert.deepEqual(page2.body.data.products.map((p) => p.name), ["Lamp"])
    assert.ok(rug)
})

t("categories carry the newest public product's main photo", async () => {
    const prisma = db()
    const older = await createProduct({ name: "Old lamp", categoryName: "Home" })
    await prisma.productImage.create({ data: { product_id: older.id, key: "products/old.jpg", is_primary: true } })
    const newer = await createProduct({ name: "New lamp", categoryName: "Home" })
    await prisma.productImage.create({ data: { product_id: newer.id, key: "products/new-side.jpg", is_primary: false } })
    await prisma.productImage.create({ data: { product_id: newer.id, key: "products/new-main.jpg", is_primary: true } })
    const hidden = await createProduct({ name: "Hidden", categoryName: "Home" })
    await prisma.product.update({ where: { id: hidden.id }, data: { is_hidden: true } })
    await prisma.productImage.create({ data: { product_id: hidden.id, key: "products/hidden.jpg", is_primary: true } })
    await createProduct({ name: "Pan", categoryName: "Kitchen" })   // no photo

    const { status, body } = await api("GET", "/categories")
    assert.equal(status, 200)
    const byName = Object.fromEntries(body.data.map((c) => [c.name, c]))
    assert.equal(byName.Home.image_key, "products/new-main.jpg")
    assert.equal(byName.Home._count.products, 2)
    assert.equal(byName.Kitchen.image_key, null)
    assert.equal(byName.Home.products, undefined)
})

t("newsletter sign-up is idempotent and validates the email", async () => {
    const first = await api("POST", "/newsletter", { body: { email: "  Fan@Example.com " } })
    assert.equal(first.status, 201)
    const again = await api("POST", "/newsletter", { body: { email: "fan@example.com" } })
    assert.equal(again.status, 201)
    assert.equal(await db().newsletterSubscriber.count(), 1)
    assert.equal((await db().newsletterSubscriber.findFirst()).email, "fan@example.com")

    const bad = await api("POST", "/newsletter", { body: { email: "not-an-email" } })
    assert.equal(bad.status, 400)
})

t("contact form saves the message and emails the store inbox", async () => {
    await db().setting.create({ data: { key: "store_email", value: "help@shop.test" } })
    const before = eventsOf("support.contact.received").length

    const missing = await api("POST", "/contact", { body: { name: "Ali", email: "ali@example.com", topic: "Order help", message: "short" } })
    assert.equal(missing.status, 400)
    const badTopic = await api("POST", "/contact", { body: { name: "Ali", email: "ali@example.com", topic: "Spam", message: "Where is my order please?" } })
    assert.equal(badTopic.status, 400)

    const { status, body } = await api("POST", "/contact", {
        body: { name: "Ali", email: "ali@example.com", topic: "Order help", order_ref: "1042", message: "Where is my order please?" },
    })
    assert.equal(status, 201)
    const saved = await db().contactMessage.findUnique({ where: { id: body.data.id } })
    assert.equal(saved.topic, "Order help")
    assert.equal(saved.order_ref, "1042")

    const events = eventsOf("support.contact.received").slice(before)
    assert.equal(events.length, 1)
    assert.equal(events[0].exchange, "support.events")
    assert.deepEqual(events[0].body.data.recipients, ["help@shop.test"])
    assert.equal(events[0].body.data.messageId, saved.id)

    const topics = await api("GET", "/contact/topics")
    assert.ok(topics.body.data.includes("Payments"))
})
