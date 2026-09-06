import { sendResetPasswordEmail,sendVerifyEmail } from "../services/email.service.js";

export async function handleEmailEvent(routingKey,data) {
    console.log("[email.handler]", routingKey, JSON.stringify(data));
    switch(routingKey){
        case "auth.password.reset.requested":
            await sendResetPasswordEmail(data.email,data.resetLink);
            break
        case "auth.email.verification.requested":
            await sendVerifyEmail(data.email,data.verifyLink);
            break
        default:
            throw new Error(`Unknown email events:${routingKey}`) 
    }
}