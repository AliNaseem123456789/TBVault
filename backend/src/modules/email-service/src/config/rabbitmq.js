import amqp from "amqplib";

export const EXCHANGES = { AUTH: "auth.events", ORDER: "order.events" };

let connection;
let channel;

export async function connectRabbitMQ() {
    connection = await amqp.connect(process.env.RABBITMQ_URL);
    connection.on("error", (err) => console.error("[rabbitmq] connection error:", err.message));
    connection.on("close", () => {
        console.error("[rabbitmq] connection closed, exiting so the process manager restarts the worker");
        process.exit(1);
    });

    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGES.AUTH, "topic", { durable: true });
    await channel.assertExchange(EXCHANGES.ORDER, "topic", { durable: true });
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
