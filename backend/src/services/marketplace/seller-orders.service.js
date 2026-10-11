import { recordStatusChange } from "../orders/order-history.service.js"
import { creditSellerEarnings } from "./seller-ledger.service.js"

/**
 * A marketplace order is split into one shipment (seller_orders row) per seller.
 * Each seller moves their own shipment forward; the customer-facing order status
 * follows the slowest shipment:
 *   order "shipped"   = every shipment has shipped
 *   order "delivered" = every shipment has been delivered (cash on delivery is then marked paid)
 */
export const SHIPMENT_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"]
const RANK = { pending: 0, confirmed: 1, shipped: 2, delivered: 3 }
const BY_RANK = ["pending", "confirmed", "shipped", "delivered"]

// What a seller may do with their shipment.
export const SHIPMENT_NEXT = {
    pending: ["confirmed"],
    confirmed: ["shipped"],
    shipped: ["delivered"],
    delivered: [],
    cancelled: [],
}

const AGGREGATE_NOTE = {
    confirmed: "Every seller has confirmed their items",
    shipped: "Every seller has shipped their items",
    delivered: "Everything has been delivered",
}

/**
 * Moves the order forward to match its shipments (never backwards).
 * Returns true when the order status changed.
 */
export const syncOrderFromShipments = async (tx, orderId, { actorType = "seller", actorUserId = null } = {}) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { seller_orders: true } })
    if (!order || order.status === "cancelled") return false
    const active = order.seller_orders.filter((s) => s.status !== "cancelled")
    if (active.length === 0) return false

    const target = BY_RANK[Math.min(...active.map((s) => RANK[s.status] ?? 0))]
    if ((RANK[target] ?? 0) <= (RANK[order.status] ?? 0)) return false

    const now = new Date()
    const data = { status: target }
    if (RANK[target] >= RANK.shipped && !order.shipped_at) data.shipped_at = now
    if (target === "delivered") {
        data.delivered_at = now
        // Cash on delivery is collected when the last parcel is handed over.
        if (order.payment_method === "cod" && order.payment_status === "unpaid") Object.assign(data, { payment_status: "paid", paid_at: now })
    }
    // With a single shipment its tracking is the order's tracking (used by the emails).
    if (active.length === 1 && RANK[target] >= RANK.shipped && !order.tracking_number && !order.tracking_url) {
        const [only] = active
        Object.assign(data, { tracking_carrier: only.tracking_carrier, tracking_number: only.tracking_number, tracking_url: only.tracking_url })
    }
    await tx.order.update({ where: { id: orderId }, data })
    await recordStatusChange(tx, { orderId, from: order.status, to: target, actorType, actorUserId, note: active.length > 1 ? AGGREGATE_NOTE[target] : null })
    await creditSellerEarnings(tx, orderId)
    return true
}

const shipmentData = (status, tracking = {}) => {
    const now = new Date()
    const data = { status }
    if (status === "shipped") Object.assign(data, tracking, { shipped_at: now })
    if (status === "delivered") data.delivered_at = now
    if (status === "cancelled") data.cancelled_at = now
    return data
}

/**
 * A seller moves their shipment one step. Throws Error("CODE:detail"):
 *   NOT_FOUND, BAD_TRANSITION, ORDER_CANCELLED, UNPAID
 * Returns { shipment, orderChanged }.
 */
export const advanceShipment = async (tx, { shipmentId, sellerId, status, tracking = {}, actorUserId }) => {
    const shipment = await tx.sellerOrder.findUnique({ where: { id: shipmentId }, include: { order: true } })
    if (!shipment || shipment.seller_id !== sellerId) throw new Error("NOT_FOUND")
    if (shipment.order.status === "cancelled") throw new Error("ORDER_CANCELLED")
    if (!SHIPMENT_NEXT[shipment.status]?.includes(status)) throw new Error(`BAD_TRANSITION:${shipment.status}`)
    if (shipment.order.payment_method === "card" && shipment.order.payment_status === "unpaid") throw new Error("UNPAID")

    const updated = await tx.sellerOrder.update({ where: { id: shipment.id }, data: shipmentData(status, tracking) })
    if (status === "delivered") await creditSellerEarnings(tx, shipment.order_id)
    const orderChanged = await syncOrderFromShipments(tx, shipment.order_id, { actorType: "seller", actorUserId })
    return { shipment: updated, orderChanged }
}

/**
 * An admin changed the whole order's status: bring every shipment that is behind up to it.
 * (Cancelling is handled by cancelOrderInTx.)
 */
export const cascadeOrderStatusToShipments = async (tx, orderId, status, tracking = {}) => {
    const shipments = await tx.sellerOrder.findMany({ where: { order_id: orderId, status: { not: "cancelled" } } })
    for (const s of shipments) {
        if ((RANK[s.status] ?? 0) >= (RANK[status] ?? 0)) continue
        await tx.sellerOrder.update({ where: { id: s.id }, data: shipmentData(status, status === "shipped" ? tracking : {}) })
    }
    await creditSellerEarnings(tx, orderId)
}

export const cancelShipments = (tx, orderId) =>
    tx.sellerOrder.updateMany({
        where: { order_id: orderId, status: { notIn: ["cancelled", "delivered"] } },
        data: { status: "cancelled", cancelled_at: new Date() },
    })
