import crypto from "node:crypto";
import { getRabbitMQChannel } from "../../config/rabbitmq.js";

/**
 * Publish an event and wait until RabbitMQ confirms it has the message.
 * The channel is a confirm channel, so the callback fires only after the
 * broker accepts it; a rejected or failed publish rejects this promise.
 */
export function publishEvent(exchange, routingKey, data) {
    const channel = getRabbitMQChannel();
    const message = {
        v: 1,
        id: crypto.randomUUID(),
        type: routingKey,
        data,
        published_at: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
        channel.publish(
            exchange,
            routingKey,
            Buffer.from(JSON.stringify(message)),
            { persistent: true, contentType: "application/json", messageId: message.id },
            (err) => (err ? reject(err) : resolve(message.id))
        );
    });
}
