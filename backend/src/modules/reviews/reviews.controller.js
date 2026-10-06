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
export const createReview = async (req, res) => {
    const user_id = Number(req.user.sub)
    if (!user_id) return res.status(401).json({ message: "Unauthorized" })
         const idempotencyKey=req.headers["idempotency-key"];

    if(!idempotencyKey){
        return res.status(400).json({message:"Idempotency-Key is missing"})
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

// model Review {
//   id         Int      @id @default(autoincrement())
//   product_id Int
//   rating     Int
//   comment    String?  @db.Text
//   created_at DateTime @default(now())

//   product    Product  @relation(fields: [product_id], references: [id], onDelete: Cascade)

//   @@index([product_id])
//   @@map("reviews")
// }
