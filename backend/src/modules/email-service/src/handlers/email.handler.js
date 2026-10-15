import {
    sendResetPasswordEmail,
    sendVerifyEmail,
    sendOrderPlacedEmail,
    sendOrderStatusEmail,
    sendOrderRefundedEmail,
    sendReturnUpdateEmail,
    sendLowStockEmail,
    sendBackInStockEmail,
    sendContactMessageEmail,
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
        case "order.refunded":
            await sendOrderRefundedEmail(data.email, data);
            break;
        case "order.return.updated":
            await sendReturnUpdateEmail(data.email, data);
            break;
        case "inventory.low_stock":
            // One email to all admins (BCC-free: they're our own staff).
            await sendLowStockEmail(data.recipients.join(","), data);
            break;
        case "inventory.back_in_stock":
            // The API publishes one message per customer, so a failed send retries just that one.
            await sendBackInStockEmail(data.email, data);
            break;
        case "support.contact.received":
            // To the store's own inbox; the customer's address is in the message.
            await sendContactMessageEmail(data.recipients.join(","), data);
            break;
        default:
            // Acked and ignored: an unhandled event isn't worth retrying.
            console.log(`[email.handler] ignoring ${routingKey}`);
    }
}
