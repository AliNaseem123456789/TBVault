import {
    sendResetPasswordEmail,
    sendVerifyEmail,
    sendOrderPlacedEmail,
    sendOrderStatusEmail,
} from "../services/email.service.js";

export async function handleEmailEvent(routingKey, data) {
    switch (routingKey) {
        case "auth.password.reset.requested":
            await sendResetPasswordEmail(data.email, data.resetLink);
            break;
        case "auth.email.verification.requested":
            await sendVerifyEmail(data.email, data.verifyLink);
            break;
        case "order.created":
            await sendOrderPlacedEmail(data.email, data);
            break;
        case "order.status.changed":
            await sendOrderStatusEmail(data.email, data);
            break;
        default:
            // Acked and ignored: an unhandled event isn't worth retrying.
            console.log(`[email.handler] ignoring ${routingKey}`);
    }
}
