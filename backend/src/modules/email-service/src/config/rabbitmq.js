import amqp from "amqplib";
let connection;
let channel;
export async function connectRabbitMQ() {
    connection = await amqp.connect(
        process.env.RABBITMQ_URL
    );
    channel = await connection.createChannel();
    await channel.assertExchange(
        "auth.events",
        "topic",
        {
            durable: true
        }
    );
    console.log("Connected to RabbitMQ");
    return channel;
}
export function getRabbitMQChannel() {

    if (!channel) {
        throw new Error(
            "RabbitMQ channel not initialized"
        );
    }

    return channel;
}