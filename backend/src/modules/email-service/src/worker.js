import "dotenv/config";
import {connectRabbitMQ} from "./config/rabbitmq.js";
import {startEmailConsumer} from "./consumers/email.consumer.js";
async function startWorker() {
    try {
        // 1. Connect to RabbitMQ
        const channel =await connectRabbitMQ();
        // 2. Start listening to email.queue
        await startEmailConsumer(channel);
        console.log("Email worker is running");
    } catch (error) {
        console.error("Failed to start email worker:",error);
        process.exit(1);
    }
}
startWorker();