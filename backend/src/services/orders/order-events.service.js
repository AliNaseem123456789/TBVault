import prisma from "../../config/db.js"
import { publishOrderEvent } from "../../events/publishers/order.publisher.js"

/** Where an order's emails go: the account's email, or the guest's. */
export const orderEmail = (order) => order.user?.email ?? order.guest_email

/** Link the customer uses to view this order: their account page, or the guest tracking page. */
export const orderUrl = (order) =>
    order.user_id
        ? `${process.env.FRONTEND_URL}/orders/${order.id}`
        : `${process.env.FRONTEND_URL}/track/${order.public_token}`

/**
 * Publishes an order event with everything the email worker needs (it has no
 * database access). Never throws: the order change is already committed, so a
 * failed publish only costs an email.
 */
export const publishOrderEmailEvent = async (routingKey, orderId, extra = {}) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { user: { select: { email: true, name: true } }, items: true },
        })
        if (!order) return
        const email = orderEmail(order)
        if (!email) return
        await publishOrderEvent(routingKey, {
            orderId: order.id,
            email,
            name: order.user?.name ?? null,
            status: order.status,
            paymentMethod: order.payment_method,
            paymentStatus: order.payment_status,
            subtotal: Number(order.subtotal).toFixed(2),
            discountTotal: Number(order.discount_total).toFixed(2),
            shippingTotal: Number(order.shipping_total).toFixed(2),
            taxTotal: Number(order.tax_total).toFixed(2),
            totalAmount: Number(order.total_amount).toFixed(2),
            creditsApplied: Number(order.credits_applied ?? 0).toFixed(2),
            couponCode: order.coupon_code,
            shippingAddress: order.shipping_address,
            trackingCarrier: order.tracking_carrier,
            trackingNumber: order.tracking_number,
            trackingUrl: order.tracking_url,
            items: order.items.map((i) => ({
                name: i.variant_name ? `${i.product_name ?? `Product #${i.product_id}`} (${i.variant_name})` : i.product_name ?? `Product #${i.product_id}`,
                quantity: i.quantity,
                totalPrice: Number(i.total_price).toFixed(2),
            })),
            orderUrl: orderUrl(order),
            ...extra,
        })
    } catch (err) {
        console.error(`[orders] failed to publish ${routingKey}:`, err.message)
    }
}
