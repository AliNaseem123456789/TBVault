import amqp from "amqplib";

export const EXCHANGES = { AUTH: "auth.events", ORDER: "order.events", INVENTORY: "inventory.events" };

let connection;
let channel;

// Heartbeats let both sides notice a dead connection (important with a hosted broker like CloudAMQP).
const withHeartbeat = (url, seconds = 30) =>
    !url || /[?&]heartbeat=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}heartbeat=${seconds}`;

export async function connectRabbitMQ() {
    connection = await amqp.connect(withHeartbeat(process.env.RABBITMQ_URL));
    connection.on("error", (err) => console.error("[rabbitmq] connection error:", err.message));
    connection.on("close", () => {
        console.error("[rabbitmq] connection closed, exiting so the process manager restarts the worker");
        process.exit(1);
    });

    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGES.AUTH, "topic", { durable: true });
    await channel.assertExchange(EXCHANGES.ORDER, "topic", { durable: true });
    await channel.assertExchange(EXCHANGES.INVENTORY, "topic", { durable: true });
    console.log("Connected to RabbitMQ");
    return channel;
}

export function getConnection() {
    if (!connection) throw new Error("RabbitMQ connection not initialized");
    return connection;
}

export function getRabbitMQChannel() {
    if (!channel) throw new Error("RabbitMQ channel not initialized");
    return channel;
}
