/**
 * Integration test harness: the real Express app against a real, migrated
 * Postgres database, with RabbitMQ and Stripe replaced by in-memory stand-ins.
 *
 *   TEST_DATABASE_URL=postgresql://...  (a throwaway database; it is wiped before each test file)
 *   REDIS_URL=redis://localhost:6379/15  (optional; db 15 is flushed)
 *
 * Without TEST_DATABASE_URL the integration tests are skipped.
 */
export const enabled = Boolean(process.env.TEST_DATABASE_URL)

if (enabled) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379/15"
    process.env.ACCESS_TOKEN = "test-access-secret"
    process.env.REFRESH_TOKEN = "test-refresh-secret"
    process.env.FRONTEND_URL = "http://shop.test"
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret"
}

// Records everything the app publishes instead of sending it to RabbitMQ.
export const published = []
const fakeChannel = {
    publish(exchange, routingKey, content, options, callback) {
        published.push({ exchange, routingKey, body: JSON.parse(content.toString()) })
        callback?.(null)
        return true
    },
}

// Stand-in for the Stripe SDK's checkout + refunds calls.
export const stripeCalls = { sessions: [], expired: [], refunds: [] }
export const fakeStripe = {
    checkout: {
        sessions: {
            create: async (params, options) => {
                const id = `cs_test_${stripeCalls.sessions.length + 1}`
                stripeCalls.sessions.push({ id, params, options })
                return { id, url: `https://checkout.stripe.test/${id}` }
            },
            expire: async (id) => {
                stripeCalls.expired.push(id)
                return { id, status: "expired" }
            },
        },
    },
    refunds: {
        create: async (params, options) => {
            const refund = { id: `re_test_${stripeCalls.refunds.length + 1}`, status: "succeeded", amount: params.amount }
            stripeCalls.refunds.push({ params, options, refund })
            return refund
        },
    },
}

let app, prisma, server, baseUrl, redis, jwtHelpers, webhookVerifier

export const setup = async () => {
    ;({ default: app } = await import("../../src/app.js"))
    ;({ default: prisma } = await import("../../src/config/db.js"))
    ;({ default: redis } = await import("../../src/config/redis.client.js"))
    jwtHelpers = await import("../../src/utils/jwt.helpers.js")
    const rabbit = await import("../../src/config/rabbitmq.js")
    const stripe = await import("../../src/config/stripe.js")
    rabbit.setRabbitMQChannel(fakeChannel)
    stripe.setStripeClient(fakeStripe)
    webhookVerifier = stripe.webhookVerifier
    await resetDatabase()
    await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", () => {
            baseUrl = `http://127.0.0.1:${server.address().port}/api`
            resolve()
        })
    })
    return { prisma }
}

export const teardown = async () => {
    await new Promise((resolve) => server.close(resolve))
    await prisma.$disconnect()
    redis.disconnect()
}

export const resetDatabase = async () => {
    const tables = await prisma.$queryRawUnsafe(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
    )
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`)
    await redis.flushdb()
    published.length = 0
    stripeCalls.sessions.length = 0
    stripeCalls.expired.length = 0
    stripeCalls.refunds.length = 0
}

/** fetch wrapper: api("POST", "/order", { token, body, headers }) -> { status, body } */
export const api = async (method, path, { token, body, headers = {}, raw } = {}) => {
    const res = await fetch(baseUrl + path, {
        method,
        headers: {
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
        },
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = text }
    return { status: res.status, body: json, headers: res.headers }
}

let userCounter = 0
export const createUser = async ({ role = "CUSTOMER", email } = {}) => {
    userCounter++
    const user = await prisma.user.create({
        data: { email: email ?? `user${userCounter}@example.com`, name: `User ${userCounter}`, role, password: null, is_verified: true },
    })
    return { user, token: jwtHelpers.generateAccessToken(user.id, user.role) }
}

export const createProduct = async ({ name = "Lamp", price = 10, stock = 10, categoryName = "Home", variants } = {}) => {
    const category = await prisma.category.upsert({ where: { name: categoryName }, update: {}, create: { name: categoryName } })
    return prisma.product.create({
        data: {
            name, price, stock, category_id: category.id,
            ...(variants ? { variants: { create: variants } } : {}),
        },
        include: { variants: true },
    })
}

export const addToCart = (token, productId, quantity = 1, variantId) =>
    api("POST", "/cart/items", { token, body: { product_id: productId, quantity, ...(variantId ? { variant_id: variantId } : {}) } })

export const ADDRESS = {
    full_name: "Ali Test", phone: "+92 300 1234567", line1: "1 Main Street", city: "Karachi", state: "Sindh", country: "Pakistan",
}

export const placeOrder = (token, body = {}, key = crypto.randomUUID()) =>
    api("POST", "/order", { token, body: { address: ADDRESS, ...body }, headers: { "Idempotency-Key": key } })

/** Sends a Stripe-signed webhook. */
export const sendWebhook = async (type, object, { id = `evt_${crypto.randomUUID()}`, secret = process.env.STRIPE_WEBHOOK_SECRET } = {}) => {
    const payload = JSON.stringify({ id, type, object: "event", data: { object } })
    const signature = webhookVerifier.webhooks.generateTestHeaderString({ payload, secret })
    return api("POST", "/payments/webhook", { raw: payload, headers: { "Content-Type": "application/json", "stripe-signature": signature } })
}

export const eventsOf = (routingKey) => published.filter((p) => p.routingKey === routingKey)

/** Events are published after the response is sent; wait until `count` of them arrived. */
export const waitForEvents = async (routingKey, count = 1, timeoutMs = 2000) => {
    const start = Date.now()
    while (eventsOf(routingKey).length < count && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 20))
    }
    return eventsOf(routingKey)
}

export const db = () => prisma
