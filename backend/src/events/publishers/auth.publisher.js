import { connectRabbitMQ,getRabbitMQChannel } from "../../config/rabbitmq.js";
const EXCHANGE="auth.events"
export function publishAuthEvents(routingKey,data){
    const channel=getRabbitMQChannel();
    channel.publish(EXCHANGE,routingKey,Buffer.from(JSON.stringify(data)),{
        persistent:true,
        contentType:"application/json"
    })
}