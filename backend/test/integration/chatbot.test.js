import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { enabled, setup, teardown, resetDatabase, api, createUser, createSeller, published, db } from "./helpers.js"

// A stand-in for the Python chatbot service that records what the backend sends it.
const received = []
const fakeChatbot = http.createServer((req, res) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
        const body = Buffer.concat(chunks).toString("latin1")
        const url = new URL(req.url, "http://x")
        received.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body })
        const send = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)) }
        if (body.includes("boom")) return send(503, { detail: "Search is unavailable right now (ConnectionError)" })
        if (body.includes("bad-input")) return send(400, { detail: "That file isn't an image we can read" })
        send(200, { answer: "Here you go", products: [{ id: 1, name: "Lamp" }], applied: {}, llm: false })
    })
})

const t = enabled ? test : test.skip
before(async () => {
    if (!enabled) return
    await new Promise((resolve) => fakeChatbot.listen(0, "127.0.0.1", resolve))
    process.env.CHATBOT_URL = `http://127.0.0.1:${fakeChatbot.address().port}`
    process.env.CHATBOT_INTERNAL_KEY = "shared-secret"
    await setup()
})
after(async () => {
    if (!enabled) return
    await teardown()
    fakeChatbot.close()
})
beforeEach(async () => {
    if (!enabled) return
    await resetDatabase()
    received.length = 0
    published.length = 0
})

const imageUpload = (fields = {}) => {
    const form = new FormData()
    form.append("image", new Blob([Buffer.from("fake png bytes")], { type: "image/png" }), "photo.png")
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    return form
}

t("chat messages are validated and passed to the chatbot service with the shared key", async () => {
    assert.equal((await api("POST", "/chat", { body: {} })).status, 400)
    assert.equal((await api("POST", "/chat", { body: { message: "x".repeat(1001) } })).status, 400)
    assert.equal((await api("POST", "/chat", { body: { message: "hi", history: [{ role: "system", content: "x" }] } })).status, 400)
    assert.equal(received.length, 0)

    const { token } = await createUser()
    const reply = await api("POST", "/chat", {
        token,
        body: { message: "  a lamp for my desk  ", history: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi!" }] },
    })
    assert.equal(reply.status, 200)
    assert.equal(reply.body.message, "Chat reply")
    assert.equal(reply.body.data.answer, "Here you go")
    const sent = received.at(-1)
    assert.equal(sent.path, "/chat")
    assert.equal(sent.headers["x-internal-key"], "shared-secret")
    assert.equal(sent.headers["x-user-token"], token)       // signed in: the chatbot may look up *their* orders
    assert.deepEqual(JSON.parse(sent.body), {
        message: "a lamp for my desk",
        history: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi!" }],
    })
})

t("guests send no user token; the search state is passed along and checked", async () => {
    const state = { query: "desk lamps", filters: { max_price: 50 } }
    assert.equal((await api("POST", "/chat", { body: { message: "only brass ones", state } })).status, 200)
    const sent = received.at(-1)
    assert.equal(sent.headers["x-user-token"], undefined)
    assert.deepEqual(JSON.parse(sent.body).state, state)

    assert.equal((await api("POST", "/chat", { body: { message: "x", state: "nope" } })).status, 400)
    assert.equal((await api("POST", "/chat", { body: { message: "x", state: { q: "y".repeat(3000) } } })).status, 400)
    // a forged/expired token is rejected, not silently forwarded
    assert.equal((await api("POST", "/chat", { token: "forged.token.here", body: { message: "my orders" } })).status, 401)
})

t("chatbot errors become clear 400 / 503 answers", async () => {
    const down = await api("POST", "/chat", { body: { message: "boom" } })
    assert.equal(down.status, 503)
    assert.match(down.body.message, /unavailable/)
    const bad = await api("POST", "/chat", { body: { message: "bad-input" } })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.message, "That file isn't an image we can read")
})

t("smart search forwards only valid filters", async () => {
    assert.equal((await api("GET", "/search/smart")).status, 400)
    assert.equal((await api("GET", "/search/smart?query=lamp&min_price=50&max_price=10")).status, 400)
    assert.equal((await api("GET", "/search/smart?query=lamp&brand_id=abc")).status, 400)
    assert.equal((await api("GET", "/search/smart?query=lamp&limit=99")).status, 400)

    const ok = await api("GET", "/search/smart?query=desk%20lamp&max_price=50&in_stock=true&category_id=3&limit=5")
    assert.equal(ok.status, 200)
    assert.deepEqual(received.at(-1).query, { query: "desk lamp", max_price: "50", in_stock: "true", category_id: "3", limit: "5" })
})

t("photos are passed on as multipart uploads", async () => {
    assert.equal((await api("POST", "/chat/image", { raw: new FormData() })).status, 400)

    const chat = await api("POST", "/chat/image", { raw: imageUpload({ message: "cheaper ones like this" }) })
    assert.equal(chat.status, 200)
    let sent = received.at(-1)
    assert.equal(sent.path, "/chat/image")
    assert.match(sent.headers["content-type"], /^multipart\/form-data/)
    assert.match(sent.body, /name="image"; filename="photo.png"/)
    assert.match(sent.body, /fake png bytes/)
    assert.match(sent.body, /cheaper ones like this/)

    const byText = await api("POST", "/search/image", { raw: (() => { const f = new FormData(); f.append("query", "red shoes"); return f })() })
    assert.equal(byText.status, 200)
    sent = received.at(-1)
    assert.equal(sent.path, "/search/image")
    assert.match(sent.body, /red shoes/)
    assert.doesNotMatch(sent.body, /name="image"/)
    assert.equal((await api("POST", "/search/image", { raw: new FormData() })).status, 400)
})

t("product, option, photo and seller changes publish catalog.changed for the chatbot's index", async () => {
    const prisma = db()
    const { token: adminToken } = await createUser({ role: "ADMIN" })
    const category = await prisma.category.create({ data: { name: "Lighting" } })
    const created = await api("POST", "/products", { token: adminToken, body: { name: "Desk lamp", price: 20, stock: 3, category_id: category.id } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const productId = created.body.data.product.id

    await api("PUT", `/products/${productId}`, { token: adminToken, body: { price: 25 } })
    await api("POST", `/products/${productId}/variants`, { token: adminToken, body: { name: "Brass", stock: 2 } })
    const { seller } = await createSeller({ storeName: "Lamp Works" })
    await api("PATCH", `/admin/sellers/${seller.id}/status`, { token: adminToken, body: { status: "SUSPENDED" } })
    await api("DELETE", `/products/${productId}`, { token: adminToken })

    const events = published.filter((p) => p.exchange === "catalog.events")
    assert.ok(events.every((e) => e.routingKey === "catalog.changed"))
    assert.deepEqual(events.map((e) => e.body.data), [
        { product_ids: [productId] },   // created
        { product_ids: [productId] },   // updated
        { product_ids: [productId] },   // option added
        { seller_id: seller.id },       // seller suspended
        { product_ids: [productId] },   // deleted
    ])
})
