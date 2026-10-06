import amqp from "amqplib"
import { EXCHANGES } from "../events/eventNames.js"

let channel
let connection

export async function connectRabbitMQ() {
    connection = await amqp.connect(process.env.RABBITMQ_URL)
    channel = await connection.createConfirmChannel();   // assign, no `const`

    await channel.assertExchange(EXCHANGES.AUTH, "topic", { durable: true })
    await channel.assertExchange(EXCHANGES.ORDER, "topic", { durable: true })

    connection.on("error", (err) => console.error("[rabbitmq] connection error:", err.message))
    connection.on("close", () => { channel = null; console.error("[rabbitmq] connection closed") })

    console.log("Connected to Rabbitmq")
    return channel;
}

export function getRabbitMQChannel(){
    if(!channel){
        throw new Error("Rabbitmq channel not initialized")
    }
    return channel;
}

export async function closeRabbitMQ() {
    try {
        if (channel) await channel.close()
        if (connection) await connection.close()
    } finally {
        channel = null
        connection = null
    }
}