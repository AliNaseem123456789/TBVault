import prisma from "../../config/db.js"
import redis from "../../config/redis.client.js"
import { publishOrderEvent } from "../../events/publishers/order.publisher.js"
import { ORDER_EVENTS } from "../../events/eventNames.js"
import { ORDER_STATUSES, canTransition } from "./order.status.js"
export const getOrders=async(req,res)=>{
    const user_id=Number(req.user.sub)
    try{
        const orders=await prisma.order.findMany({where:{user_id:user_id},orderBy:{created_at:"desc"}})
        res.status(200).json({message:"orders fetched",data:{orders}})
    }catch(err){
        console.log(err)
        return res.status(500).json({message:"Database error"})
    }
}
export const getOrderById=async(req,res)=>{
    const order_id=Number(req.params.order_id)
     if (!Number.isInteger(order_id) || order_id <= 0) {
        return res.status(400).json({ message: "order id missing or invalid" })
    }
    try{
        // findFirst with user_id: a user can only see their own orders
        const order=await prisma.order.findFirst({
            where:{id:order_id,user_id:Number(req.user.sub)},
           include: {
    items: {                              
        include: {
            product: {                    
                include: {
                    images: { where: { is_primary: true } }   
                }
            }
        }
    }
}
        })
        if(!order){
            return res.status(404).json({message:"Order not found"})
        }
        res.status(200).json({message:"orders fetched",data:{order}})
    }catch(err){
        console.log(err)
        return res.status(500).json({message:"Database error"})
    }
}
// Everything the email worker needs, since it has no database access.
const publishOrderEmailEvent = async (routingKey, orderId) => {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            user: { select: { email: true, name: true } },
            items: { include: { product: { select: { name: true } } } },
        },
    })
    if (!order) return
    await publishOrderEvent(routingKey, {
        orderId: order.id,
        email: order.user.email,
        name: order.user.name,
        status: order.status,
        totalAmount: Number(order.total_amount).toFixed(2),
        shippingAddress: order.shipping_address,
        items: order.items.map((i) => ({
            name: i.product?.name ?? `Product #${i.product_id}`,
            quantity: i.quantity,
            totalPrice: Number(i.total_price).toFixed(2),
        })),
        orderUrl: `${process.env.FRONTEND_URL}/orders/${order.id}`,
    })
}

const ORDER_IDEMPOTENCY_TTL = 24 * 60 * 60   // remember a finished order for 24h
const ORDER_PROCESSING_TTL = 5 * 60          // lock while an order is being placed

export const createOrder = async (req, res) => {
    const user_id = Number(req.user.sub)
    const shipping_address = req.body.shipping_address

    if (!user_id) return res.status(401).json({ message: "Unauthorized" })
    if (!shipping_address || !String(shipping_address).trim()) {
        return res.status(400).json({ message: "shipping_address is required" })
    }

    const idempotencyKey = req.headers["idempotency-key"]
    if (!idempotencyKey) {
        return res.status(400).json({ message: "Idempotency-Key header is missing" })
    }

    const redisKey = `idempotency:order:${user_id}:${idempotencyKey}`

    // A retry of a request we already finished: replay the original response.
    const existing = await redis.get(redisKey)
    if (existing) {
        const saved = JSON.parse(existing)
        if (saved.status === "SUCCEEDED") {
            return res.status(saved.statusCode).json(saved.body)
        }
        return res.status(409).json({ message: "Order is already being processed" })
    }

    // Claim the key atomically. ioredis takes flat args: SET key value EX seconds NX.
    const claimed = await redis.set(redisKey, JSON.stringify({ status: "PROCESSING" }), "EX", ORDER_PROCESSING_TTL, "NX")
    if (claimed === null) {
        return res.status(409).json({ message: "Order is already being processed" })
    }

    try {
        const order = await prisma.$transaction(async (tx) => {
            const cart = await tx.cart.findUnique({
                where: { user_id },
                include: { items: { include: { product: true } } }
            })

            if (!cart) throw new Error("CART_NOT_FOUND")
            if (cart.items.length === 0) throw new Error("CART_EMPTY")

            let totalAmount = 0
            for (const item of cart.items) {
                const product = item.product
                if (product.is_hidden) throw new Error(`UNAVAILABLE:${product.name}`)
                if (product.stock < item.quantity) throw new Error(`INSUFFICIENT_STOCK:${product.name}`)
                totalAmount += Number(product.price) * item.quantity
            }

            const newOrder = await tx.order.create({
                data: {
                    user_id,
                    total_amount: totalAmount,
                    shipping_address,
                    items: {
                        create: cart.items.map((item) => {
                            const price = Number(item.product.price)
                            return {
                                product_id: item.product_id,
                                quantity: item.quantity,
                                unit_price: price,
                                total_price: price * item.quantity
                            }
                        })
                    }
                },
                include: { items: true }
            })

            // Conditional decrement: fails if someone else bought the stock first.
            for (const item of cart.items) {
                const result = await tx.product.updateMany({
                    where: { id: item.product_id, stock: { gte: item.quantity } },
                    data: { stock: { decrement: item.quantity } }
                })
                if (result.count === 0) throw new Error(`INSUFFICIENT_STOCK:${item.product.name}`)
            }

            await tx.cartItem.deleteMany({ where: { cart_id: cart.id } })
            return newOrder
        })

        const body = { message: "Order Created", data: { order } }
        // Only cache after the transaction commits, so a replay never returns an order that rolled back.
        await redis.set(redisKey, JSON.stringify({ status: "SUCCEEDED", statusCode: 201, body }), "EX", ORDER_IDEMPOTENCY_TTL)

        // The order is already committed, so a failed publish only costs the email; log it, don't fail the request.
        publishOrderEmailEvent(ORDER_EVENTS.ORDER_CREATED, order.id).catch((err) => console.error("[orders] failed to publish order.created:", err.message))

        return res.status(201).json(body)
    } catch (err) {
        // Failed attempts release the key so the client can retry with the same one.
        await redis.del(redisKey).catch(() => {})

        if (err.message === "CART_NOT_FOUND")
            return res.status(404).json({ message: "Cart not found" })
        if (err.message === "CART_EMPTY")
            return res.status(400).json({ message: "Cart is empty" })
        if (err.message.startsWith("INSUFFICIENT_STOCK:"))
            return res.status(409).json({ message: `${err.message.split(":")[1]} is out of stock` })
        if (err.message.startsWith("UNAVAILABLE:"))
            return res.status(409).json({ message: `${err.message.split(":")[1]} is no longer available` })

        console.error("createOrder error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

export const cancelOrder = async (req, res) => {
    const user_id  = Number(req.user.sub)
    const order_id = Number(req.params.orderId)  

    if (!user_id) return res.status(401).json({ message: "Unauthorized" })
    if (!Number.isInteger(order_id) || order_id <= 0)
        return res.status(400).json({ message: "order id missing or invalid" })

    const CANCELLABLE = ["pending", "confirmed"]

    try {
        const cancelledOrder = await prisma.$transaction(async (tx) => {
            const order = await tx.order.findFirst({
                where: { id: order_id, user_id },
                include: { items: true }
            })

            if (!order) throw new Error("ORDER_NOT_FOUND")
            if (!CANCELLABLE.includes(order.status)) throw new Error("CANNOT_CANCEL")

            const updated = await tx.order.update({
                where: { id: order.id },
                data: { status: "cancelled" },
                include: { items: true }
            })

            for (const item of order.items) {
                await tx.product.updateMany({
                    where: { id: item.product_id },
                    data: { stock: { increment: item.quantity } }
                })
            }

            return updated
        })

        return res.status(200).json({ message: "Order cancelled", data: { order: cancelledOrder } })
    } catch (err) {
        if (err.message === "ORDER_NOT_FOUND")
            return res.status(404).json({ message: "Order not found" })
        if (err.message === "CANNOT_CANCEL")
            return res.status(400).json({ message: "Order cannot be cancelled in its current state" })

        console.log(err)
        return res.status(500).json({ message: "Database Error" })
    }
}
// ==============================
// ADMIN
// ==============================
// GET /admin/orders?status=pending&page=1&limit=20
export const listAllOrders = async (req, res) => {
    const page = req.query.page !== undefined ? Number(req.query.page) : 1
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20
    const { status } = req.query

    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: "invalid page" })
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: "invalid limit" })
    if (status !== undefined && !ORDER_STATUSES.includes(status)) return res.status(400).json({ message: "invalid status" })

    const where = status ? { status } : {}
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

// PATCH /admin/orders/:orderId/status   body: { status }
export const updateOrderStatus = async (req, res) => {
    const order_id = Number(req.params.orderId)
    const { status } = req.body

    if (!Number.isInteger(order_id) || order_id <= 0) return res.status(400).json({ message: "order id missing or invalid" })
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ message: `status must be one of: ${ORDER_STATUSES.join(", ")}` })

    try {
        const updated = await prisma.$transaction(async (tx) => {
            const order = await tx.order.findUnique({ where: { id: order_id }, include: { items: true } })
            if (!order) throw new Error("ORDER_NOT_FOUND")
            if (!canTransition(order.status, status)) throw new Error(`BAD_TRANSITION:${order.status}`)

            const next = await tx.order.update({ where: { id: order.id }, data: { status } })

            // Cancelling puts the stock back, same as a customer cancel.
            if (status === "cancelled") {
                for (const item of order.items) {
                    await tx.product.update({
                        where: { id: item.product_id },
                        data: { stock: { increment: item.quantity } },
                    })
                }
            }
            return next
        })

        publishOrderEmailEvent(ORDER_EVENTS.ORDER_STATUS_CHANGED, updated.id).catch((err) => console.error("[orders] failed to publish status change:", err.message))

        return res.status(200).json({ message: "Order status updated", data: { order: updated } })
    } catch (err) {
        if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ message: "Order not found" })
        if (err.message.startsWith("BAD_TRANSITION:")) {
            const from = err.message.split(":")[1]
            return res.status(400).json({ message: `Cannot move an order from ${from} to ${status}` })
        }
        console.error("updateOrderStatus error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
