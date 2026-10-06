import prisma from "../../config/db.js"
import redis from "../../config/redis.client.js"
export const getOrders=async(req,res)=>{
    const user_id=Number(req.user.sub)
    try{
        const orders=await prisma.order.findMany({where:{user_id:user_id}})
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
        const order=await prisma.order.findUnique({
            where:{id:order_id},
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
        res.status(200).json({message:"orders fetched",data:{order}})
    }catch(err){
        console.log(err)
        return res.status(500).json({message:"Database error"})
    }
}
export const createOrder = async (req, res) => {
    const user_id = Number(req.user.sub)
    const shipping_address = req.body.shipping_address

    if (!user_id) return res.status(401).json({ message: "Unauthorized" })
         const idempotencyKey=req.headers["idempotency-key"];

    if(!idempotencyKey){
        return res.status(400).json({message:"Idempotency-Key is missing"})
    }

    const redisKey=`idempotency:order:${userId}:${idempotencyKey}`
    const existing=await redis.get(redisKey)
    if(existing){
        const data=JSON.parse(existing)
    }
    if(data.status==="SUCCEEDED"){
        return res.status(400).json({})
    }
     if(data.status==="PROCESSING"){
        return res.status(409).json({message:"Order is alreadybeing processed"})
    }
    const claimed=await redis.set(redisKey,JSON.stringify({status:"PROCESSING"}),{NX:true,EX:300})
    if(claimed===null){
        return res.status(409).json({message:"Order is already being processed"})
    }
    try {
        const order = await prisma.$transaction(async (tx) => {
            const cart = await tx.cart.findUnique({
                where: { user_id },
                include: {
                    items: {
                        include: {
                            product: {
                                include: {
                                    images: { where: { is_primary: true }, take: 1 }
                                }
                            }
                        }
                    }
                }
            })

            if (!cart)                 throw new Error("CART_NOT_FOUND")
            if (cart.items.length === 0) throw new Error("CART_EMPTY")

            let totalAmount = 0
            for (const item of cart.items) {
                const product = item.product

                if (product.stock < item.quantity) {
                    throw new Error(`INSUFFICIENT_STOCK:${product.name}`)
                }

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
                                quantity:   item.quantity,
                                unit_price: price,
                                total_price: price * item.quantity
                            }
                        })
                    }
                },
                include: { items: true }
            })

            for (const item of cart.items) {
                const result = await tx.product.updateMany({
                    where: { id: item.product_id, stock: { gte: item.quantity } },
                    data:  { stock: { decrement: item.quantity } }
                })
                if (result.count === 0) {
                    throw new Error(`INSUFFICIENT_STOCK:${item.product.name}`)
                }
            }

            await tx.cartItem.deleteMany({ where: { cart_id: cart.id } })
            await redis.set(redisKey,JSON.stringify({status: "SUCCEEDED",statusCode: 201,response}),
      {
        EX: 86400
      }
    );
            return newOrder
        })
        return res.status(201).json({ message: "Order Created", data: { order } })
    } catch (err) {
        if (err.message === "CART_NOT_FOUND")
            return res.status(404).json({ message: "Cart not found" })
        if (err.message === "CART_EMPTY")
            return res.status(400).json({ message: "Cart is empty" })
        if (err.message.startsWith("INSUFFICIENT_STOCK:"))
            return res.status(409).json({ message: `${err.message.split(":")[1]} is out of stock` })

        console.log(err)
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
// model Order {
//   id               Int      @id @default(autoincrement())
//   user_id          Int
//   order_date       DateTime @default(now())
//   status           String   @default("pending") @db.VarChar(20)
//   total_amount     Decimal  @db.Decimal(10, 2)
//   shipping_address String?  @db.Text
//   created_at       DateTime @default(now())
//   updated_at       DateTime @updatedAt

//   // Relationships
//   user             User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
//   items            OrderItem[]

//   @@map("orders")
// }

// // ==============================
// // ORDER ITEMS
// // ==============================
// model OrderItem {
//   id          Int      @id @default(autoincrement())
//   order_id    Int
//   product_id  Int
//   quantity    Int
//   unit_price  Decimal  @db.Decimal(10, 2)
//   total_price Decimal  @db.Decimal(10, 2)
//   created_at  DateTime @default(now())

//   // Relationships
//   order       Order    @relation(fields: [order_id], references: [id], onDelete: Cascade)
//   product     Product  @relation(fields: [product_id], references: [id], onDelete: Cascade)

//   @@map("order_items")
// }