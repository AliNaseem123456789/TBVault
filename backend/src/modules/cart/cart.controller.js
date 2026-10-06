import prisma from "../../config/db.js"

export const addCartItems=async(req,res)=>{
    const product_id=Number(req.body.product_id)
    const user_id=Number(req.user.sub)
    if(!product_id){
        console.log("no id")
        return res.status(400).json({message:"product id is needed"})
    }
       if(!user_id){
                console.log("no user id")

        return res.status(400).json({message:"user id is needed"})
    }
    const quantity=req.body.quantity !==undefined ? Number(req.body.quantity):1
  if (!Number.isInteger(quantity) || quantity < 1) {
  return res.status(400).json({ message: "quantity must be a positive integer" });
}
    try{
      const cart=await prisma.cart.upsert({
        where:{user_id},
        update:{},
        create:{user_id}
      })
        const item=await prisma.cartItem.upsert({
            where:{cart_id_product_id:{
                cart_id:cart.id,
                product_id:product_id
            }},
            update:{
                 quantity: { increment: quantity }
            },
            create:{
                cart_id:cart.id,
                product_id:product_id,
                quantity:quantity
            }
        })
        return res.status(201).json({message: "Added to cart",data: { item },})
    }catch(err){
        console.log(err)
        return res.status(500).json({ message: "Database Error" });
    }
}
export const getCartItems=async(req,res)=>{
    const user_id=Number(req.user.sub)
    try{
        const cart=await prisma.cart.findMany({
            where:{user_id:user_id},
            include:{items:{
                include:{
                    product:{
                        include:{
                            images:{
                                where:{is_primary:true},
                                take:1
                            }
                        }
                    }
                }
            }}
        })
        res.status(200).json({message:"Cart fecthed",data:{cart}})
    }catch(err){
        console.log(err)
        return res.status(500).json({ message: "Database Error" });
    }
}
export const updateCartItems = async (req, res) => {
    const product_id = Number(req.params.productId)
    const user_id = Number(req.user.sub)
    const quantity = req.body.quantity !== undefined ? Number(req.body.quantity) : 1

    if (!product_id) {
        return res.status(400).json({ message: "id should be an integer" })
    }
    if (!user_id) {
        return res.status(400).json({ message: "id should be an integer" })
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ message: "quantity must be a positive integer" });
    }

    try {
        const cart = await prisma.cart.findUnique({ where: { user_id: user_id } })
        if (!cart) {
            return res.status(404).json({ message: "cart not found" })
        }
        const cartUpdated = await prisma.cartItem.update({
            where: { cart_id_product_id: { cart_id: cart.id, product_id: product_id } },
            data: { quantity: quantity }
        })
        return res.status(200).json({ message: "Quantity updated", data: { cartUpdated } })
    } catch (err) {
        if (err.code === "P2025") {
            return res.status(404).json({ message: "Product doesnt Exist" })
        }
        return res.status(500).json({ message: "Database Error" });
    }
}

export const deleteCartItems = async (req, res) => {
    const product_id = Number(req.params.productId)
    const user_id = Number(req.user.sub)
    if (!product_id) {
        return res.status(400).json({ message: "id should be an integer" })
    }
    try {
        const cart = await prisma.cart.findUnique({ where: { user_id: user_id } })
        if (!cart) {
            return res.status(404).json({ message: "cart not found" })
        }
        await prisma.cartItem.delete({
            where: { cart_id_product_id: { cart_id: cart.id, product_id: product_id } }
        })
        return res.status(204).send()
    } catch (err) {
        if (err.code === "P2025") {
            return res.status(404).json({ message: "Cart doesnt Exist" })
        }
        return res.status(500).json({ message: "Database Error" });
    }
}
export const deleteCart=async(req,res)=>{
    const user_id=Number(req.user.sub)
    if(!user_id){
        return res.status(400).json({message:"id should be an integer"})
    }
    try{
        await prisma.cart.delete({where:{user_id:user_id}})
        return res.status(204).send()
    }catch(err){
         if(err.code==="P2025"){
            return res.status(404).json({message:"Cart doesnt Exist"})
        }
        return res.status(500).json({ message: "Database Error" });

    }
}
// // ==============================
// // CART
// // ==============================
// model Cart {
//   id          Int      @id @default(autoincrement())
//   user_id     Int      @unique
//   created_at  DateTime @default(now())
//   updated_at  DateTime @updatedAt

//   // Relationships
//   user        User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
//   items       CartItem[]

//   @@map("cart")
// }

// // ==============================
// // CART ITEMS
// // ==============================
// model CartItem {
//   id          Int      @id @default(autoincrement())
//   cart_id     Int
//   product_id  Int
//   quantity    Int      @default(1)
//   created_at  DateTime @default(now())

//   // Relationships
//   cart        Cart     @relation(fields: [cart_id], references: [id], onDelete: Cascade)
//   product     Product  @relation(fields: [product_id], references: [id], onDelete: Cascade)

//   @@unique([cart_id, product_id])
//   @@map("cart_items")
// }
