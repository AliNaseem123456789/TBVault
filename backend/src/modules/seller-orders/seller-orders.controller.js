import prisma from "../../config/db.js"
import { ORDER_EVENTS } from "../../events/eventNames.js"
import { advanceShipment, SHIPMENT_STATUSES, SHIPMENT_NEXT } from "../../services/marketplace/seller-orders.service.js"
import { publishOrderEmailEvent } from "../../services/orders/order-events.service.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

// What a seller sees of the parent order: who to ship to, and whether it's paid. Not other sellers' items.
const ORDER_FOR_SELLER = {
    select: {
        id: true, status: true, payment_method: true, payment_status: true, shipping_address: true, created_at: true,
        user: { select: { name: true } },
    },
}
const SHIPMENT_INCLUDE = {
    order: ORDER_FOR_SELLER,
    items: { include: { product: { select: { id: true, images: { where: { is_primary: true }, take: 1, select: { key: true } } } } } },
}

// Unpaid card orders can't be worked on yet; everything else can.
const withActions = (shipment) => ({
    ...shipment,
    next_statuses: shipment.order.status === "cancelled" || (shipment.order.payment_method === "card" && shipment.order.payment_status === "unpaid")
        ? []
        : SHIPMENT_NEXT[shipment.status] ?? [],
})

// GET /seller/orders?status=pending&search=12&page=1
export const listSellerOrders = async (req, res) => {
    const page = req.query.page !== undefined ? Number(req.query.page) : 1
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20
    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: "invalid page" })
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: "invalid limit" })
    const where = { seller_id: req.seller.id }
    if (req.query.status !== undefined) {
        if (!SHIPMENT_STATUSES.includes(req.query.status)) return res.status(400).json({ message: "invalid status" })
        where.status = req.query.status
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim().replace(/^#/, "") : ""
    if (search) {
        const asId = Number(search)
        if (!Number.isInteger(asId) || asId < 1) return res.status(400).json({ message: "search by order number" })
        where.order_id = asId
    }
    try {
        const [shipments, totalItems, counts] = await Promise.all([
            prisma.sellerOrder.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * limit, take: limit, include: SHIPMENT_INCLUDE }),
            prisma.sellerOrder.count({ where }),
            prisma.sellerOrder.groupBy({ by: ["status"], where: { seller_id: req.seller.id }, _count: true }),
        ])
        const totalPages = Math.ceil(totalItems / limit)
        return res.status(200).json({
            message: "Seller orders",
            data: { orders: shipments.map(withActions), counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) },
            metaData: { totalPages, currentPage: page, hasNext: totalPages > page, hasPrev: page > 1, itemsPerPage: limit, totalItems },
        })
    } catch (err) {
        console.error("listSellerOrders error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /seller/orders/:shipmentId
export const getSellerOrder = async (req, res) => {
    const id = parseId(req.params.shipmentId)
    if (!id) return res.status(400).json({ message: "invalid order id" })
    try {
        const shipment = await prisma.sellerOrder.findFirst({ where: { id, seller_id: req.seller.id }, include: SHIPMENT_INCLUDE })
        if (!shipment) return res.status(404).json({ message: "Order not found" })
        return res.status(200).json({ message: "Seller order", data: { order: withActions(shipment) } })
    } catch (err) {
        console.error("getSellerOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

const parseTracking = (body) => {
    const data = {}
    for (const [field, max] of [["tracking_carrier", 100], ["tracking_number", 100], ["tracking_url", 500]]) {
        if (body[field] === undefined) continue
        if (body[field] !== null && typeof body[field] !== "string") return { error: `${field} must be text` }
        const value = body[field]?.trim() || null
        if (value && value.length > max) return { error: `${field} must be at most ${max} characters` }
        data[field] = value
    }
    if (data.tracking_url && !/^https?:\/\/\S+$/i.test(data.tracking_url)) return { error: "tracking_url must start with http:// or https://" }
    return { data }
}

// PATCH /seller/orders/:shipmentId/status   body: { status, tracking_carrier?, tracking_number?, tracking_url? }
export const updateSellerOrderStatus = async (req, res) => {
    const id = parseId(req.params.shipmentId)
    if (!id) return res.status(400).json({ message: "invalid order id" })
    const { status } = req.body
    if (!["confirmed", "shipped", "delivered"].includes(status)) return res.status(400).json({ message: "status must be confirmed, shipped or delivered" })
    const tracking = parseTracking(req.body)
    if (tracking.error) return res.status(400).json({ message: tracking.error })
    try {
        const { shipment, orderChanged } = await prisma.$transaction((tx) =>
            advanceShipment(tx, { shipmentId: id, sellerId: req.seller.id, status, tracking: tracking.data, actorUserId: Number(req.user.sub) })
        )
        if (orderChanged) publishOrderEmailEvent(ORDER_EVENTS.ORDER_STATUS_CHANGED, shipment.order_id)
        const full = await prisma.sellerOrder.findUnique({ where: { id }, include: SHIPMENT_INCLUDE })
        return res.status(200).json({ message: "Order updated", data: { order: withActions(full) } })
    } catch (err) {
        if (err.message === "NOT_FOUND") return res.status(404).json({ message: "Order not found" })
        if (err.message === "ORDER_CANCELLED") return res.status(400).json({ message: "This order was cancelled" })
        if (err.message === "UNPAID") return res.status(400).json({ message: "The customer hasn't paid for this order yet" })
        if (String(err.message).startsWith("BAD_TRANSITION:")) return res.status(400).json({ message: `Cannot move an order from ${err.message.split(":")[1]} to ${status}` })
        console.error("updateSellerOrderStatus error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
