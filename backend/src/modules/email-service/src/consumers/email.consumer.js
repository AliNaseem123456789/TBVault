import { handleEmailEvent } from "../handlers/email.handler.js";
import { EXCHANGES, getConnection } from "../config/rabbitmq.js";

// email.jobs        work queue
// email.jobs.retry  failed jobs wait here RETRY_DELAY_MS, then expire back onto email.jobs
// email.jobs.dlq    jobs that failed MAX_ATTEMPTS times or can never succeed; inspect in the RabbitMQ UI
const QUEUE = "email.jobs";
const RETRY_QUEUE = `${QUEUE}.retry`;
const DLQ = `${QUEUE}.dlq`;
const MAX_ATTEMPTS = Number(process.env.EMAIL_MAX_ATTEMPTS || 5);
const RETRY_DELAY_MS = Number(process.env.EMAIL_RETRY_DELAY_MS || 10_000);

const BINDINGS = [
    [EXCHANGES.AUTH, "auth.password.reset.requested"],
    [EXCHANGES.AUTH, "auth.email.verification.requested"],
    [EXCHANGES.ORDER, "order.created"],
    [EXCHANGES.ORDER, "order.status.changed"],
    [EXCHANGES.ORDER, "order.refunded"],
    [EXCHANGES.ORDER, "order.return.updated"],
    [EXCHANGES.INVENTORY, "inventory.low_stock"],
    [EXCHANGES.INVENTORY, "inventory.back_in_stock"],
];

// The old queue name. Removed only if empty, on a throwaway channel so a
// failure (queue not empty) can't take down the main channel.
async function removeLegacyQueue() {
    try {
        const ch = await getConnection().createChannel();
        ch.on("error", () => {});
        await ch.deleteQueue("email.queue", { ifEmpty: true });
        await ch.close();
    } catch {
        console.warn("[email] legacy 'email.queue' still has messages; delete it in the RabbitMQ UI once drained");
    }
}

export async function startEmailConsumer(channel) {
    await channel.assertQueue(DLQ, { durable: true });
    await channel.assertQueue(RETRY_QUEUE, {
        durable: true,
        arguments: {
            "x-message-ttl": RETRY_DELAY_MS,
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": QUEUE,
        },
    });
    await channel.assertQueue(QUEUE, { durable: true });
    for (const [exchange, key] of BINDINGS) {
        await channel.bindQueue(QUEUE, exchange, key);
    }
    await removeLegacyQueue();
    await channel.prefetch(1);

    channel.consume(QUEUE, async (message) => {
        if (!message) return;

        const attempt = (message.properties.headers?.["x-attempt"] ?? 0) + 1;
        // Retried messages come back via the retry queue, so the original routing key is kept in a header.
        const routingKey = message.properties.headers?.["x-routing-key"] ?? message.fields.routingKey;
        const forward = (queue, extraHeaders) =>
            channel.sendToQueue(queue, message.content, {
                persistent: true,
                contentType: "application/json",
                headers: { ...message.properties.headers, "x-routing-key": routingKey, ...extraHeaders },
            });

        let envelope;
        try {
            envelope = JSON.parse(message.content.toString());
        } catch {
            forward(DLQ, { "x-failure-reason": "malformed JSON" });
            channel.ack(message);
            return;
        }
        // Publishers wrap payloads as { v, id, type, data }. Older messages were bare.
        const data = envelope?.data ?? envelope;

        try {
            await handleEmailEvent(routingKey, data);
            channel.ack(message);
        } catch (error) {
            const permanent = error.retryable === false;
            if (permanent || attempt >= MAX_ATTEMPTS) {
                forward(DLQ, { "x-attempt": attempt, "x-failure-reason": String(error.message).slice(0, 500) });
                console.error(`[email] ${routingKey} failed permanently after ${attempt} attempt(s): ${error.message}`);
            } else {
                forward(RETRY_QUEUE, { "x-attempt": attempt });
                console.error(`[email] ${routingKey} failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY_MS / 1000}s: ${error.message}`);
            }
            channel.ack(message);
        }
    });

    console.log(`[email] consuming ${QUEUE} (${BINDINGS.length} bindings)`);
}
