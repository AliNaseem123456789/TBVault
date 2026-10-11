import prisma from "../../config/db.js"
import { getSettings } from "../../services/settings/settings.service.js"
import { returnStock, notifyBackInStock } from "../../services/inventory/inventory.service.js"
import { issueRefund } from "../../services/payments/refund.service.js"
import { publishOrderEmailEvent } from "../../services/orders/order-events.service.js"
import { ORDER_EVENTS } from "../../events/eventNames.js"
import { toCents, fromCents } from "../../utils/pricing.helpers.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

const RETURN_INCLUDE = {
    items: { include: { order_item: { select: { id: true, product_name: true, variant_name: true, unit_price: true, quantity: true, product_id: true } } } },
    refunds: { select: { id: true, amount: true, status: true, method: true, created_at: true } },
}

// Which status each return status may move to (refunding goes through its own endpoint).
const NEXT_RETURN_STATUS = {
    REQUESTED: ["APPROVED", "REJECTED"],
    APPROVED: ["RECEIVED", "REJECTED"],
    RECEIVED: [],
    REJECTED: [],
    REFUNDED: [],
}

/**
 * Suggested refund for returned items: what was paid for them after the order's
 * discount, plus their share of the tax. Shipping isn't refunded.
 */
export const suggestedRefundCents = (order, returnItems) => {
    const itemsCents = returnItems.reduce((sum, ri) => sum + toCents(ri.order_item.unit_price) * ri.quantity, 0)
    const subtotal = toCents(order.subtotal)
    if (subtotal <= 0) return 0
    const paidForGoods = subtotal - toCents(order.discount_total) + toCents(order.tax_total)
    const refundable = toCents(order.total_amount) - toCents(order.amount_refunded)
    return Math.max(0, Math.min(refundable, Math.round((itemsCents * paidForGoods) / subtotal)))
}

// ---------- customer ----------

const createReturnFor = async (res, order, body, userId) => {
    const settings = await getSettings()
    if (order.status !== "delivered" || !order.delivered_at) {
        return res.status(400).json({ message: "Returns open once your order has been delivered" })
    }
    const windowDays = settings.return_window_days
    const deadline = new Date(order.delivered_at.getTime() + windowDays * 24 * 60 * 60 * 1000)
    if (windowDays <= 0 || deadline < new Date()) {
        return res.status(400).json({ message: windowDays > 0 ? `Returns are accepted within ${windowDays} days of delivery` : "This store doesn't accept returns" })
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (reason.length < 5 || reason.length > 1000) return res.status(400).json({ message: "Tell us why you're returning it (5-1000 characters)" })
    if (!Array.isArray(body.items) || body.items.length === 0) return res.status(400).json({ message: "Choose at least one item to return" })

    // Already in a return that wasn't rejected can't be returned again.
    const previous = await prisma.returnItem.groupBy({
        by: ["order_item_id"],
        where: { return_request: { order_id: order.id, status: { not: "REJECTED" } } },
        _sum: { quantity: true },
    })
    const alreadyReturned = Object.fromEntries(previous.map((p) => [p.order_item_id, p._sum.quantity ?? 0]))

    const items = []
    for (const raw of body.items) {
        const orderItemId = Number(raw?.order_item_id)
        const quantity = Number(raw?.quantity ?? 1)
        const orderItem = order.items.find((i) => i.id === orderItemId)
        if (!orderItem) return res.status(400).json({ message: "That item isn't part of this order" })
        const left = orderItem.quantity - (alreadyReturned[orderItemId] ?? 0)
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > left) {
            return res.status(400).json({ message: left > 0 ? `You can return up to ${left} of ${orderItem.product_name ?? "this item"}` : `${orderItem.product_name ?? "This item"} is already being returned` })
        }
        if (items.some((i) => i.order_item_id === orderItemId)) return res.status(400).json({ message: "Each item can only be listed once" })
        items.push({ order_item_id: orderItemId, quantity })
    }

    const request = await prisma.returnRequest.create({
        data: { order_id: order.id, user_id: userId, reason, items: { create: items } },
        include: RETURN_INCLUDE,
    })
    publishOrderEmailEvent(ORDER_EVENTS.RETURN_UPDATED, order.id, { returnId: request.id, returnStatus: request.status })
    return res.status(201).json({ message: "Return requested", data: { return: request } })
}

// POST /orders/:orderId/returns   body: { items: [{ order_item_id, quantity }], reason }
export const createReturn = async (req, res) => {
    const orderId = parseId(req.params.orderId)
    const userId = Number(req.user.sub)
    if (!orderId) return res.status(400).json({ message: "order id missing or invalid" })
    try {
        const order = await prisma.order.findFirst({ where: { id: orderId, user_id: userId }, include: { items: true } })
        if (!order) return res.status(404).json({ message: "Order not found" })
        return await createReturnFor(res, order, req.body, userId)
    } catch (err) {
        console.error("createReturn error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /order/track/:token/returns — same, for guest orders.
export const createReturnByToken = async (req, res) => {
    if (!/^[a-f0-9]{32,64}$/.test(req.params.token)) return res.status(404).json({ message: "Order not found" })
    try {
        const order = await prisma.order.findUnique({ where: { public_token: req.params.token }, include: { items: true } })
        if (!order) return res.status(404).json({ message: "Order not found" })
        return await createReturnFor(res, order, req.body, order.user_id)
    } catch (err) {
        console.error("createReturnByToken error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /orders/:orderId/returns
export const getOrderReturns = async (req, res) => {
    const orderId = parseId(req.params.orderId)
    if (!orderId) return res.status(400).json({ message: "order id missing or invalid" })
    try {
        const order = await prisma.order.findFirst({ where: { id: orderId, user_id: Number(req.user.sub) }, select: { id: true } })
        if (!order) return res.status(404).json({ message: "Order not found" })
        const returns = await prisma.returnRequest.findMany({ where: { order_id: orderId }, orderBy: { created_at: "desc" }, include: RETURN_INCLUDE })
        return res.status(200).json({ message: "Returns fetched", data: { returns } })
    } catch (err) {
        console.error("getOrderReturns error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// ---------- admin ----------

// GET /admin/returns?status=REQUESTED&page=1&limit=20
export const listReturns = async (req, res) => {
    const page = req.query.page !== undefined ? Number(req.query.page) : 1
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20
    const { status } = req.query
    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: "invalid page" })
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: "invalid limit" })
    if (status !== undefined && !Object.keys(NEXT_RETURN_STATUS).includes(status)) return res.status(400).json({ message: "invalid status" })
    const where = status ? { status } : {}
    try {
        const [returns, totalItems] = await Promise.all([
            prisma.returnRequest.findMany({
                where,
                orderBy: { created_at: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    ...RETURN_INCLUDE,
                    order: {
                        select: {
                            id: true, total_amount: true, subtotal: true, discount_total: true, tax_total: true, amount_refunded: true,
                            payment_method: true, payment_status: true, guest_email: true,
                            user: { select: { id: true, name: true, email: true } },
                        },
                    },
                },
            }),
            prisma.returnRequest.count({ where }),
        ])
        const totalPages = Math.ceil(totalItems / limit)
        return res.status(200).json({
            message: "Returns fetched",
            data: { returns: returns.map((r) => ({ ...r, suggested_refund: fromCents(suggestedRefundCents(r.order, r.items)).toFixed(2) })) },
            metaData: { totalPages, currentPage: page, hasNext: totalPages > page, hasPrev: page > 1, itemsPerPage: limit, totalItems },
        })
    } catch (err) {
        console.error("listReturns error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /admin/returns/:returnId   body: { status: APPROVED|REJECTED|RECEIVED, admin_note?, restock? }
// RECEIVED puts the items back in stock unless restock is false (e.g. damaged).
export const updateReturnStatus = async (req, res) => {
    const returnId = parseId(req.params.returnId)
    const { status } = req.body
    if (!returnId) return res.status(400).json({ message: "invalid return id" })
    if (!["APPROVED", "REJECTED", "RECEIVED"].includes(status)) return res.status(400).json({ message: "status must be APPROVED, REJECTED or RECEIVED" })
    const note = typeof req.body.admin_note === "string" ? req.body.admin_note.trim().slice(0, 1000) || null : undefined
    const restock = req.body.restock !== false
    try {
        let restocked = []
        const updated = await prisma.$transaction(async (tx) => {
            const request = await tx.returnRequest.findUnique({ where: { id: returnId }, include: { items: { include: { order_item: true } } } })
            if (!request) throw new Error("NOT_FOUND")
            if (!NEXT_RETURN_STATUS[request.status].includes(status)) throw new Error(`BAD_TRANSITION:${request.status}`)
            const data = { status }
            if (note !== undefined) data.admin_note = note
            if (status === "RECEIVED" && restock) {
                restocked = await returnStock(tx, request.items.map((ri) => ({ productId: ri.order_item.product_id, variantId: ri.order_item.variant_id, quantity: ri.quantity })))
                data.restocked = true
            }
            return tx.returnRequest.update({ where: { id: returnId }, data, include: RETURN_INCLUDE })
        })
        restocked.forEach((r) => notifyBackInStock(r))
        publishOrderEmailEvent(ORDER_EVENTS.RETURN_UPDATED, updated.order_id, { returnId: updated.id, returnStatus: updated.status, adminNote: updated.admin_note })
        return res.status(200).json({ message: "Return updated", data: { return: updated } })
    } catch (err) {
        if (err.message === "NOT_FOUND") return res.status(404).json({ message: "Return not found" })
        if (err.message.startsWith("BAD_TRANSITION:")) return res.status(400).json({ message: `A ${err.message.split(":")[1].toLowerCase()} return can't be ${status.toLowerCase()}` })
        console.error("updateReturnStatus error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /admin/returns/:returnId/refund   body: { amount?, destination? }
// amount defaults to the suggested amount; destination "original" (default) or "credits"
export const refundReturn = async (req, res) => {
    const returnId = parseId(req.params.returnId)
    if (!returnId) return res.status(400).json({ message: "invalid return id" })
    const destination = req.body.destination ?? "original"
    if (!["original", "credits"].includes(destination)) return res.status(400).json({ message: "destination must be original or credits" })
    try {
        const request = await prisma.returnRequest.findUnique({ where: { id: returnId }, include: { items: { include: { order_item: true } }, order: true } })
        if (!request) return res.status(404).json({ message: "Return not found" })
        if (!["APPROVED", "RECEIVED"].includes(request.status)) {
            return res.status(400).json({ message: "Approve the return before refunding it" })
        }
        let amountCents = suggestedRefundCents(request.order, request.items)
        if (req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== "") {
            const amount = Number(req.body.amount)
            if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: "amount must be a positive number" })
            amountCents = toCents(amount)
        }
        if (amountCents < 1) return res.status(400).json({ message: "Nothing left to refund on this order" })

        const { refund } = await issueRefund({ orderId: request.order_id, amountCents, reason: `Return #${request.id}`, returnId: request.id, destination, actorUserId: Number(req.user.sub) })
        const updated = await prisma.returnRequest.update({
            where: { id: returnId },
            data: { status: "REFUNDED", refund_amount: fromCents(amountCents) },
            include: RETURN_INCLUDE,
        })
        publishOrderEmailEvent(ORDER_EVENTS.RETURN_UPDATED, request.order_id, { returnId: updated.id, returnStatus: "REFUNDED", refundAmount: fromCents(amountCents).toFixed(2) })
        return res.status(201).json({ message: "Return refunded", data: { return: updated, refund } })
    } catch (err) {
        const [code, ...rest] = String(err.message).split(":")
        if (["NOT_PAID", "BAD_AMOUNT"].includes(code)) return res.status(400).json({ message: rest.join(":") })
        if (code === "REFUND_FAILED" || err.type?.startsWith?.("Stripe")) {
            console.error("refundReturn stripe error:", err)
            return res.status(502).json({ message: `Stripe refused the refund: ${err.raw?.message ?? rest.join(":")}` })
        }
        console.error("refundReturn error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
