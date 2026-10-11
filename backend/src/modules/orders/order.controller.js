import prisma from "../../config/db.js"
import redis from "../../config/redis.client.js"
import { ORDER_EVENTS } from "../../events/eventNames.js"
import { ORDER_STATUSES, canTransition } from "./order.status.js"
import { parseAddressInput, formatAddress } from "../addresses/address.validation.js"
import { isCardPaymentEnabled } from "../../config/stripe.js"
import {
    parseLineInput, cartLines, buildQuote, serializeQuote, placeOrder, cancelOrderInTx,
} from "../../services/checkout/checkout.service.js"
import { alertLowStock, notifyBackInStock } from "../../services/inventory/inventory.service.js"
import { recordStatusChange } from "../../services/orders/order-history.service.js"
import { publishOrderEmailEvent } from "../../services/orders/order-events.service.js"
import { createCheckoutSession, expireCheckoutSession } from "../../services/payments/stripe.service.js"
import { issueRefund } from "../../services/payments/refund.service.js"
import { cascadeOrderStatusToShipments } from "../../services/marketplace/seller-orders.service.js"
import { PUBLIC_SELLER_SELECT } from "../../utils/visibility.js"

const ORDER_IDEMPOTENCY_TTL = 24 * 60 * 60   // remember a finished order for 24h
const ORDER_PROCESSING_TTL = 5 * 60          // lock while an order is being placed
const PAYMENT_METHODS = ["cod", "card", "credits"]   // "credits" = paid entirely with store credit
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Everything the order pages show: items with their current photo, timeline, refunds, returns.
const ORDER_DETAIL_INCLUDE = {
    items: {
        include: {
            product: { include: { images: { where: { is_primary: true }, take: 1 } } },
        },
    },
    status_history: { orderBy: { created_at: "asc" } },
    refunds: { orderBy: { created_at: "asc" } },
    return_requests: { orderBy: { created_at: "desc" }, include: { items: true } },
    seller_orders: { orderBy: { id: "asc" }, include: { seller: { select: PUBLIC_SELLER_SELECT } } },
}

// Shipment fields a customer sees (not the sellers' commission and earnings).
const toCustomerShipment = ({ commission_rate, commission_amount, seller_earnings, earnings_credited_at, ...shipment }) => shipment

// What a customer (or a guest with the tracking link) may see: no internal ids.
const toCustomerOrder = (order) => {
    if (!order) return order
    const { stripe_checkout_session_id, stripe_payment_intent_id, coupon_id, ...rest } = order
    return {
        ...rest,
        status_history: order.status_history?.map(({ actor_user_id, ...h }) => h),
        refunds: order.refunds?.map(({ stripe_refund_id, created_by, ...r }) => r),
        seller_orders: order.seller_orders?.map(toCustomerShipment),
    }
}

const parseOrderId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

// "CODE:detail" errors from the checkout service -> HTTP responses.
const sendCheckoutError = (res, err) => {
    const [code, ...rest] = String(err.message).split(":")
    const detail = rest.join(":")
    if (code === "CART_EMPTY") return res.status(400).json({ message: "Cart is empty" })
    if (code === "INSUFFICIENT_STOCK") return res.status(409).json({ message: `${detail} is out of stock` })
    if (code === "UNAVAILABLE") return res.status(409).json({ message: detail })
    if (code === "COUPON") return res.status(400).json({ message: detail })
    if (code === "CREDITS") return res.status(400).json({ message: detail })
    if (code === "BLOCKED") return res.status(403).json({ message: "This account can't place orders. Please contact support." })
    return null
}

/**
 * Shipping details from the body, in order of preference:
 *   address_id (a saved address), address (an object), shipping_address (legacy free text).
 */
const resolveAddress = async (body, userId) => {
    if (body.address_id !== undefined && userId) {
        const id = Number(body.address_id)
        const saved = Number.isInteger(id) ? await prisma.address.findFirst({ where: { id, user_id: userId } }) : null
        if (!saved) return { error: "Saved address not found" }
        return { address: saved, text: formatAddress(saved) }
    }
    if (body.address !== undefined) {
        const { data, error } = parseAddressInput(body.address)
        if (error) return { error }
        return { address: data, text: formatAddress(data) }
    }
    if (typeof body.shipping_address === "string" && body.shipping_address.trim()) {
        return { address: null, text: body.shipping_address.trim().slice(0, 1000) }
    }
    return { error: "A shipping address is required" }
}

const parseCouponCode = (value) => {
    if (value === undefined || value === null || value === "") return null
    if (typeof value !== "string" || value.trim().length > 40) return undefined
    return value.trim().toUpperCase()
}

// ==============================
// CUSTOMER
// ==============================
export const getOrders=async(req,res)=>{
    const user_id=Number(req.user.sub)
    try{
        const orders=await prisma.order.findMany({
            where:{user_id:user_id},
            orderBy:{created_at:"desc"},
            include:{_count:{select:{items:true}}},
        })
        res.status(200).json({message:"orders fetched",data:{orders:orders.map(toCustomerOrder)}})
    }catch(err){
        console.error("getOrders error:",err)
        return res.status(500).json({message:"Database error"})
    }
}

export const getOrderById=async(req,res)=>{
    const order_id=parseOrderId(req.params.order_id)
    if (!order_id) {
        return res.status(400).json({ message: "order id missing or invalid" })
    }
    try{
        // findFirst with user_id: a user can only see their own orders
        const order=await prisma.order.findFirst({
            where:{id:order_id,user_id:Number(req.user.sub)},
            include: ORDER_DETAIL_INCLUDE,
        })
        if(!order){
            return res.status(404).json({message:"Order not found"})
        }
        res.status(200).json({message:"orders fetched",data:{order:toCustomerOrder(order)}})
    }catch(err){
        console.error("getOrderById error:",err)
        return res.status(500).json({message:"Database error"})
    }
}

// POST /order/quote  (guests and customers)
// body: { items? (required for guests), address_id? | address?, coupon_code? }
// Prices the cart without placing anything, for the checkout page's live totals.
export const quoteOrder = async (req, res) => {
    const userId = req.user ? Number(req.user.sub) : null
    const couponCode = parseCouponCode(req.body.coupon_code)
    if (couponCode === undefined) return res.status(400).json({ message: "invalid coupon code" })

    let lines
    if (req.body.items !== undefined) {
        const parsed = parseLineInput(req.body.items)
        if (parsed.error) return res.status(400).json({ message: parsed.error })
        lines = parsed.lines
    } else if (userId) {
        lines = await cartLines(userId)
    } else {
        return res.status(400).json({ message: "items are required" })
    }
    if (lines.length === 0) return res.status(400).json({ message: "Cart is empty" })

    try {
        let address = null
        if (req.body.address_id !== undefined || req.body.address !== undefined) {
            const resolved = await resolveAddress(req.body, userId)
            // A half-filled address form shouldn't break the preview; fall back to the default zone.
            address = resolved.address ?? null
        }
        let email = null
        if (userId) email = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email
        else if (typeof req.body.email === "string" && EMAIL_RE.test(req.body.email.trim())) email = req.body.email.trim().toLowerCase()

        const quote = await buildQuote({ userId, email, lines, address, couponCode, useCredits: req.body.use_credits === true })
        return res.status(200).json({
            message: "Quote",
            data: { ...serializeQuote(quote), card_payments_enabled: isCardPaymentEnabled() },
        })
    } catch (err) {
        console.error("quoteOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

/**
 * Shared by createOrder (signed in) and createGuestOrder: idempotency, placing the
 * order, starting card payment, and the follow-up emails/alerts.
 */
const submitOrder = async (req, res, { userId, email, lines, address, shippingText, couponCode, paymentMethod, useCredits = false, idempotencyScope }) => {
    const idempotencyKey = req.headers["idempotency-key"]
    if (!idempotencyKey || String(idempotencyKey).length > 100) {
        return res.status(400).json({ message: "Idempotency-Key header is missing" })
    }
    const redisKey = `idempotency:order:${idempotencyScope}:${idempotencyKey}`

    // A retry of a request we already finished: replay the original response.
    const existing = await redis.get(redisKey)
    if (existing) {
        const saved = JSON.parse(existing)
        if (saved.status === "SUCCEEDED") return res.status(saved.statusCode).json(saved.body)
        return res.status(409).json({ message: "Order is already being processed" })
    }
    // Claim the key atomically. ioredis takes flat args: SET key value EX seconds NX.
    const claimed = await redis.set(redisKey, JSON.stringify({ status: "PROCESSING" }), "EX", ORDER_PROCESSING_TTL, "NX")
    if (claimed === null) return res.status(409).json({ message: "Order is already being processed" })

    try {
        const { order, stockChanges } = await prisma.$transaction(async (tx) => {
            if (userId) {
                const user = await tx.user.findUnique({ where: { id: userId }, select: { is_blocked: true } })
                if (!user || user.is_blocked) throw new Error("BLOCKED")
            }
            if (lines.length === 0) throw new Error("CART_EMPTY")
            return placeOrder(tx, { userId, email, lines, address, shippingAddressText: shippingText, couponCode, paymentMethod, useCredits })
        })

        let checkoutUrl = null
        // placeOrder switches the method to "credits" when store credit covers everything.
        if (order.payment_method === "card") {
            const viewUrl = userId
                ? `${process.env.FRONTEND_URL}/orders/${order.id}`
                : `${process.env.FRONTEND_URL}/track/${order.public_token}`
            try {
                const session = await createCheckoutSession(order, {
                    email,
                    successUrl: `${viewUrl}?payment=success`,
                    cancelUrl: `${viewUrl}?payment=cancelled`,
                })
                await prisma.order.update({ where: { id: order.id }, data: { stripe_checkout_session_id: session.id } })
                checkoutUrl = session.url
            } catch (err) {
                // No payment page means no way to pay: undo the order so stock and coupon are released.
                console.error("createCheckoutSession error:", err)
                await prisma.$transaction((tx) => cancelOrderInTx(tx, { order, actorType: "system", note: "Card payment could not be started" }))
                await redis.del(redisKey).catch(() => {})
                return res.status(502).json({ message: "Card payment is unavailable right now. Try again or choose cash on delivery." })
            }
        } else {
            publishOrderEmailEvent(ORDER_EVENTS.ORDER_CREATED, order.id)
        }
        alertLowStock(stockChanges)

        const body = {
            message: "Order Created",
            data: { order: toCustomerOrder(order), checkout_url: checkoutUrl, tracking_token: userId ? undefined : order.public_token },
        }
        // Only cache after the transaction commits, so a replay never returns an order that rolled back.
        await redis.set(redisKey, JSON.stringify({ status: "SUCCEEDED", statusCode: 201, body }), "EX", ORDER_IDEMPOTENCY_TTL)
        return res.status(201).json(body)
    } catch (err) {
        // Failed attempts release the key so the client can retry with the same one.
        await redis.del(redisKey).catch(() => {})
        const handled = sendCheckoutError(res, err)
        if (handled) return handled
        console.error("createOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /order   body: { address_id | address | shipping_address, coupon_code?, payment_method? }
export const createOrder = async (req, res) => {
    const user_id = Number(req.user.sub)
    if (!user_id) return res.status(401).json({ message: "Unauthorized" })

    const paymentMethod = req.body.payment_method ?? "cod"
    if (!PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ message: "payment_method must be cod, card or credits" })
    if (paymentMethod === "card" && !isCardPaymentEnabled()) return res.status(400).json({ message: "Card payments aren't available" })
    if (req.body.use_credits !== undefined && typeof req.body.use_credits !== "boolean") return res.status(400).json({ message: "use_credits must be true or false" })
    const couponCode = parseCouponCode(req.body.coupon_code)
    if (couponCode === undefined) return res.status(400).json({ message: "invalid coupon code" })

    try {
        const resolved = await resolveAddress(req.body, user_id)
        if (resolved.error) return res.status(400).json({ message: resolved.error })
        const user = await prisma.user.findUnique({ where: { id: user_id }, select: { email: true } })
        if (!user) return res.status(401).json({ message: "Unauthorized" })
        const lines = await cartLines(user_id)
        return submitOrder(req, res, {
            userId: user_id,
            email: user.email,
            lines,
            address: resolved.address,
            shippingText: resolved.text,
            couponCode,
            paymentMethod,
            useCredits: req.body.use_credits === true,
            idempotencyScope: `user:${user_id}`,
        })
    } catch (err) {
        console.error("createOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /order/guest   body: { email, items, address, coupon_code?, payment_method? }
// Checkout without an account. The response's tracking_token is the guest's link to the order.
export const createGuestOrder = async (req, res) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : ""
    if (!EMAIL_RE.test(email) || email.length > 255) return res.status(400).json({ message: "A valid email is required" })
    const parsed = parseLineInput(req.body.items)
    if (parsed.error) return res.status(400).json({ message: parsed.error })
    if (req.body.address === undefined) return res.status(400).json({ message: "A shipping address is required" })
    const { data: address, error } = parseAddressInput(req.body.address)
    if (error) return res.status(400).json({ message: error })

    const paymentMethod = req.body.payment_method ?? "cod"
    if (!["cod", "card"].includes(paymentMethod)) return res.status(400).json({ message: "payment_method must be cod or card" })
    if (paymentMethod === "card" && !isCardPaymentEnabled()) return res.status(400).json({ message: "Card payments aren't available" })
    const couponCode = parseCouponCode(req.body.coupon_code)
    if (couponCode === undefined) return res.status(400).json({ message: "invalid coupon code" })

    try {
        // An email that belongs to a blocked account can't check out as a guest either.
        const account = await prisma.user.findUnique({ where: { email }, select: { is_blocked: true } })
        if (account?.is_blocked) return res.status(403).json({ message: "This email can't place orders. Please contact support." })
        return submitOrder(req, res, {
            userId: null,
            email,
            lines: parsed.lines,
            address,
            shippingText: formatAddress(address),
            couponCode,
            paymentMethod,
            idempotencyScope: `guest:${email}`,
        })
    } catch (err) {
        console.error("createGuestOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// Who may cancel: customers and guests before the order ships. Paid card orders are refunded first.
const CANCELLABLE = ["pending", "confirmed"]

const cancelForCustomer = async (res, order, { actorUserId }) => {
    if (!CANCELLABLE.includes(order.status)) {
        return res.status(400).json({ message: "Order cannot be cancelled in its current state" })
    }
    try {
        if (order.payment_status === "paid" || order.payment_status === "partially_refunded") {
            await issueRefund({ orderId: order.id, reason: "Cancelled by customer", actorUserId })
        }
        const { order: cancelled, restocked } = await prisma.$transaction(async (tx) => {
            // Re-read inside the transaction: it may have shipped or been cancelled meanwhile.
            const fresh = await tx.order.findUnique({ where: { id: order.id }, include: { items: true } })
            if (!CANCELLABLE.includes(fresh.status)) throw new Error("CANNOT_CANCEL")
            return cancelOrderInTx(tx, { order: fresh, actorType: "customer", actorUserId })
        })
        if (order.payment_method === "card" && order.payment_status === "unpaid") {
            expireCheckoutSession(order.stripe_checkout_session_id)
        }
        restocked.forEach((r) => notifyBackInStock(r))
        publishOrderEmailEvent(ORDER_EVENTS.ORDER_STATUS_CHANGED, order.id)
        const full = await prisma.order.findUnique({ where: { id: order.id }, include: ORDER_DETAIL_INCLUDE })
        return res.status(200).json({ message: "Order cancelled", data: { order: toCustomerOrder(full ?? cancelled) } })
    } catch (err) {
        if (err.message === "CANNOT_CANCEL") return res.status(400).json({ message: "Order cannot be cancelled in its current state" })
        if (String(err.message).startsWith("REFUND_FAILED") || err.type?.startsWith?.("Stripe")) {
            console.error("cancel refund error:", err)
            return res.status(502).json({ message: "We couldn't refund your card, so the order wasn't cancelled. Please try again or contact us." })
        }
        console.error("cancelOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

export const cancelOrder = async (req, res) => {
    const user_id  = Number(req.user.sub)
    const order_id = parseOrderId(req.params.orderId)
    if (!user_id) return res.status(401).json({ message: "Unauthorized" })
    if (!order_id) return res.status(400).json({ message: "order id missing or invalid" })
    try {
        const order = await prisma.order.findFirst({ where: { id: order_id, user_id }, include: { items: true } })
        if (!order) return res.status(404).json({ message: "Order not found" })
        return cancelForCustomer(res, order, { actorUserId: user_id })
    } catch (err) {
        console.error("cancelOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// ==============================
// TRACKING (no account needed)
// ==============================
const TOKEN_RE = /^[a-f0-9]{32,64}$/

// GET /order/track/:token — the link in guest emails and after guest checkout.
export const getOrderByToken = async (req, res) => {
    const { token } = req.params
    if (!TOKEN_RE.test(token)) return res.status(404).json({ message: "Order not found" })
    try {
        const order = await prisma.order.findUnique({ where: { public_token: token }, include: ORDER_DETAIL_INCLUDE })
        if (!order) return res.status(404).json({ message: "Order not found" })
        return res.status(200).json({ message: "order fetched", data: { order: toCustomerOrder(order) } })
    } catch (err) {
        console.error("getOrderByToken error:", err)
        return res.status(500).json({ message: "Database error" })
    }
}

// POST /order/track   body: { order_id, email } — "track your order" form. Rate limited.
export const lookupOrder = async (req, res) => {
    const order_id = parseOrderId(req.body.order_id)
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : ""
    if (!order_id || !email) return res.status(400).json({ message: "Order number and email are required" })
    try {
        const order = await prisma.order.findUnique({ where: { id: order_id }, include: { user: { select: { email: true } } } })
        const owner = order?.user?.email ?? order?.guest_email
        // Same answer for "no such order" and "wrong email", so order numbers can't be probed.
        if (!order || owner?.toLowerCase() !== email) {
            return res.status(404).json({ message: "We couldn't find an order with that number and email" })
        }
        return res.status(200).json({ message: "order found", data: { token: order.public_token } })
    } catch (err) {
        console.error("lookupOrder error:", err)
        return res.status(500).json({ message: "Database error" })
    }
}

// POST /order/track/:token/cancel
export const cancelOrderByToken = async (req, res) => {
    const { token } = req.params
    if (!TOKEN_RE.test(token)) return res.status(404).json({ message: "Order not found" })
    try {
        const order = await prisma.order.findUnique({ where: { public_token: token }, include: { items: true } })
        if (!order) return res.status(404).json({ message: "Order not found" })
        return cancelForCustomer(res, order, { actorUserId: order.user_id })
    } catch (err) {
        console.error("cancelOrderByToken error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// ==============================
// ADMIN
// ==============================

// GET /admin/orders?status=pending&search=12|email&page=1&limit=20
export const listAllOrders = async (req, res) => {
    const page = req.query.page !== undefined ? Number(req.query.page) : 1
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20
    const { status } = req.query
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""

    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: "invalid page" })
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: "invalid limit" })
    if (status !== undefined && !ORDER_STATUSES.includes(status)) return res.status(400).json({ message: "invalid status" })

    const where = status ? { status } : {}
    if (req.query.sellerId !== undefined) {
        const sellerId = Number(req.query.sellerId)
        if (!Number.isInteger(sellerId) || sellerId < 1) return res.status(400).json({ message: "invalid seller id" })
        where.seller_orders = { some: { seller_id: sellerId } }
    }
    if (search) {
        const asId = Number(search.replace(/^#/, ""))
        where.OR = [
            ...(Number.isInteger(asId) && asId > 0 ? [{ id: asId }] : []),
            { guest_email: { contains: search, mode: "insensitive" } },
            { user: { email: { contains: search, mode: "insensitive" } } },
            { user: { name: { contains: search, mode: "insensitive" } } },
        ]
    }
    try {
        const [orders, totalItems] = await Promise.all([
            prisma.order.findMany({
                where,
                orderBy: { created_at: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    items: { include: { product: { select: { id: true, name: true } } } },
                    seller_orders: { select: { id: true, status: true, seller: { select: PUBLIC_SELLER_SELECT } } },
                },
            }),
            prisma.order.count({ where }),
        ])
        const totalPages = Math.ceil(totalItems / limit)
        return res.status(200).json({
            message: "orders fetched",
            data: { orders },
            metaData: { totalPages, currentPage: page, hasNext: totalPages > page, hasPrev: page > 1, itemsPerPage: limit, totalItems },
        })
    } catch (err) {
        console.error("listAllOrders error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /admin/orders/:orderId — everything about one order, including refunds and returns.
export const getOrderAdmin = async (req, res) => {
    const order_id = parseOrderId(req.params.orderId)
    if (!order_id) return res.status(400).json({ message: "order id missing or invalid" })
    try {
        const order = await prisma.order.findUnique({
            where: { id: order_id },
            include: { ...ORDER_DETAIL_INCLUDE, user: { select: { id: true, name: true, email: true } } },
        })
        if (!order) return res.status(404).json({ message: "Order not found" })
        return res.status(200).json({ message: "order fetched", data: { order } })
    } catch (err) {
        console.error("getOrderAdmin error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// Tracking fields an admin can set when shipping (all optional).
const parseTrackingInput = (body) => {
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

// PATCH /admin/orders/:orderId/status
// body: { status, note?, tracking_carrier?, tracking_number?, tracking_url? }
export const updateOrderStatus = async (req, res) => {
    const order_id = parseOrderId(req.params.orderId)
    const { status } = req.body
    const adminId = Number(req.user.sub)

    if (!order_id) return res.status(400).json({ message: "order id missing or invalid" })
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ message: `status must be one of: ${ORDER_STATUSES.join(", ")}` })
    const tracking = parseTrackingInput(req.body)
    if (tracking.error) return res.status(400).json({ message: tracking.error })
    const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 500) || null : null

    try {
        let restocked = []
        const updated = await prisma.$transaction(async (tx) => {
            const order = await tx.order.findUnique({ where: { id: order_id }, include: { items: true } })
            if (!order) throw new Error("ORDER_NOT_FOUND")
            if (!canTransition(order.status, status)) throw new Error(`BAD_TRANSITION:${order.status}`)
            if (order.payment_method === "card" && order.payment_status === "unpaid" && status !== "cancelled") {
                throw new Error("UNPAID")
            }

            if (status === "cancelled") {
                const result = await cancelOrderInTx(tx, { order, actorType: "admin", actorUserId: adminId, note })
                restocked = result.restocked
                return result.order
            }

            const data = { status }
            if (status === "shipped") Object.assign(data, tracking.data, { shipped_at: new Date() })
            if (status === "delivered") {
                data.delivered_at = new Date()
                // Cash on delivery is collected when the parcel is handed over.
                if (order.payment_method === "cod" && order.payment_status === "unpaid") {
                    Object.assign(data, { payment_status: "paid", paid_at: new Date() })
                }
            }
            const next = await tx.order.update({ where: { id: order.id }, data })
            await recordStatusChange(tx, { orderId: order.id, from: order.status, to: status, actorType: "admin", actorUserId: adminId, note })
            // Every seller's shipment follows the admin's decision (and delivered orders pay out sellers).
            await cascadeOrderStatusToShipments(tx, order.id, status, tracking.data)
            return next
        })

        restocked.forEach((r) => notifyBackInStock(r))
        publishOrderEmailEvent(ORDER_EVENTS.ORDER_STATUS_CHANGED, updated.id)

        const refundDue = status === "cancelled" && ["paid", "partially_refunded"].includes(updated.payment_status)
        return res.status(200).json({
            message: refundDue ? "Order cancelled. It was paid, so issue a refund from the order." : "Order status updated",
            data: { order: updated, refund_due: refundDue },
        })
    } catch (err) {
        if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ message: "Order not found" })
        if (err.message === "UNPAID") return res.status(400).json({ message: "This card order hasn't been paid yet" })
        if (err.message.startsWith("BAD_TRANSITION:")) {
            const from = err.message.split(":")[1]
            return res.status(400).json({ message: `Cannot move an order from ${from} to ${status}` })
        }
        console.error("updateOrderStatus error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /admin/orders/:orderId/tracking   body: { tracking_carrier?, tracking_number?, tracking_url? }
// Fix or add tracking details without changing the status.
export const updateOrderTracking = async (req, res) => {
    const order_id = parseOrderId(req.params.orderId)
    if (!order_id) return res.status(400).json({ message: "order id missing or invalid" })
    const { data, error } = parseTrackingInput(req.body)
    if (error) return res.status(400).json({ message: error })
    if (Object.keys(data).length === 0) return res.status(400).json({ message: "nothing to update" })
    try {
        const order = await prisma.order.update({ where: { id: order_id }, data })
        return res.status(200).json({ message: "Tracking updated", data: { order } })
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Order not found" })
        console.error("updateOrderTracking error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
