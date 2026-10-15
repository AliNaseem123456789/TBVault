import amqp from "amqplib"
import { EXCHANGES } from "../events/eventNames.js"

/**
 * RabbitMQ connection for the API. Works with a local broker (amqp://127.0.0.1:5672)
 * or a hosted one such as CloudAMQP (amqps://user:pass@host/vhost).
 *
 * startRabbitMQ() never blocks or crashes the API: if the broker is unreachable it keeps
 * retrying in the background (2 s, 4 s, ... up to 30 s), and it reconnects the same way
 * whenever the connection drops. While disconnected, publishes fail the way they already
 * handle errors: order/stock emails are logged and skipped, password-reset returns an error.
 */

let channel
let connection
let retryTimer = null
let attempt = 0
let stopping = false

// Heartbeats let both sides notice a dead connection (important over the internet).
export const withHeartbeat = (url, seconds = 30) => {
    if (!url || /[?&]heartbeat=/.test(url)) return url
    return `${url}${url.includes("?") ? "&" : "?"}heartbeat=${seconds}`
}

export async function connectRabbitMQ() {
    connection = await amqp.connect(withHeartbeat(process.env.RABBITMQ_URL))
    channel = await connection.createConfirmChannel();   // assign, no `const`

    await channel.assertExchange(EXCHANGES.AUTH, "topic", { durable: true })
    await channel.assertExchange(EXCHANGES.ORDER, "topic", { durable: true })
    await channel.assertExchange(EXCHANGES.INVENTORY, "topic", { durable: true })
    await channel.assertExchange(EXCHANGES.CATALOG, "topic", { durable: true })
    await channel.assertExchange(EXCHANGES.SUPPORT, "topic", { durable: true })

    connection.on("error", (err) => console.error("[rabbitmq] connection error:", err.message))
    connection.on("close", () => {
        channel = null
        connection = null
        if (!stopping) {
            console.error("[rabbitmq] connection closed; reconnecting")
            scheduleReconnect()
        }
    })

    attempt = 0
    console.log("Connected to Rabbitmq")
    return channel;
}

function scheduleReconnect() {
    if (retryTimer || stopping) return
    const delay = Math.min(30000, 2000 * 2 ** attempt)
    attempt++
    retryTimer = setTimeout(async () => {
        retryTimer = null
        try {
            await connectRabbitMQ()
        } catch (err) {
            console.error(`[rabbitmq] connect failed: ${err.message}`)
            scheduleReconnect()
        }
    }, delay)
    console.error(`[rabbitmq] next connection attempt in ${delay / 1000} s`)
    retryTimer.unref?.()   // a pending retry must not keep the process alive on shutdown
}

/** Connects in the background; the API starts serving right away either way. */
export function startRabbitMQ() {
    stopping = false
    connectRabbitMQ().catch((err) => {
        console.error(`[rabbitmq] not reachable at startup (${err.message}); retrying in the background`)
        scheduleReconnect()
    })
}

export function getRabbitMQChannel(){
    if(!channel){
        throw new Error("Rabbitmq channel not initialized")
    }
    return channel;
}

// Tests run without a broker: they hand in a stand-in channel that records publishes.
export function setRabbitMQChannel(testChannel){
    channel = testChannel
}

export async function closeRabbitMQ() {
    stopping = true
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    try {
        if (channel) await channel.close()
        if (connection) await connection.close()
    } finally {
        channel = null
        connection = null
    }
}
