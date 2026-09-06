import { handleEmailEvent } from "../handlers/email.handler.js";
const EXCHANGE="auth.events"
const QUEUE="email.queue"

export async function startEmailConsumer(channel) {
    await channel.assertExchange(EXCHANGE,"topic",{durable:true});
    await channel.assertQueue(QUEUE,{durable:true})
    await channel.bindQueue(QUEUE,EXCHANGE,"auth.password.reset.requested")
    await channel.bindQueue(QUEUE,EXCHANGE,"auth.email.verification.requested")
    await channel.prefetch(1);
    channel.consume(QUEUE,async(message)=>{
        if(!message){
            return
        }
    try{
        const routingKey=message.fields.routingKey;
        const data=JSON.parse(message.content.toString())
        await handleEmailEvent(routingKey,data)
        channel.ack(message)
    }catch(error){
        channel.nack(message,false,false)
        console.error("Email processing failed:",error)
    }
    })
}