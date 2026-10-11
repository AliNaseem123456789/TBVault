import prisma from "../../config/db.js"
import { withSalePricing } from "../../services/pricing/pricing.service.js"
import { parseLineInput } from "../../services/checkout/checkout.service.js"
import { isPublicProduct } from "../../utils/visibility.js"

const MAX_QUANTITY = 99

// variantId comes from the body on add, and from ?variantId= on update/delete.
const parseVariantId = (value) => {
    if (value === undefined || value === null || value === "") return null
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : NaN
}

/**
 * Checks a product/variant pair can go in a cart. Products with active variants
 * need one of them picked; products without variants take no variant.
 * Returns an error message, or null when it's fine.
 */
const checkPurchasable = async (productId, variantId, db = prisma) => {
    const product = await db.product.findUnique({
        where: { id: productId },
        select: { is_hidden: true, name: true, seller: { select: { status: true } }, variants: { where: { is_active: true }, select: { id: true } } },
    })
    if (!isPublicProduct(product)) return { status: 404, message: "Product not found" }
    if (product.variants.length > 0) {
        if (!variantId) return { status: 400, message: `Choose an option for ${product.name}` }
        if (!product.variants.some((v) => v.id === variantId)) return { status: 404, message: "That option isn't available" }
    } else if (variantId) {
        return { status: 400, message: `${product.name} has no options` }
    }
    return null
}

const findItem = (db, cartId, productId, variantId) =>
    db.cartItem.findFirst({ where: { cart_id: cartId, product_id: productId, variant_id: variantId } })

// Adds to an existing line (same product + option) or creates one. Quantity is capped at MAX_QUANTITY.
const addToCart = async (tx, userId, productId, variantId, quantity) => {
    const cart = await tx.cart.upsert({ where: { user_id: userId }, update: {}, create: { user_id: userId } })
    const existing = await findItem(tx, cart.id, productId, variantId)
    if (existing) {
        return tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: Math.min(MAX_QUANTITY, existing.quantity + quantity) },
        })
    }
    return tx.cartItem.create({ data: { cart_id: cart.id, product_id: productId, variant_id: variantId, quantity: Math.min(MAX_QUANTITY, quantity) } })
}

export const addCartItems=async(req,res)=>{
    const product_id=Number(req.body.product_id)
    const user_id=Number(req.user.sub)
    const variant_id=parseVariantId(req.body.variant_id)
    if(!Number.isInteger(product_id) || product_id < 1){
        return res.status(400).json({message:"product id is needed"})
    }
    if(Number.isNaN(variant_id)){
        return res.status(400).json({message:"variant_id must be a positive integer"})
    }
    const quantity=req.body.quantity !==undefined ? Number(req.body.quantity):1
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        return res.status(400).json({ message: `quantity must be a whole number from 1 to ${MAX_QUANTITY}` });
    }
    try{
        const problem = await checkPurchasable(product_id, variant_id)
        if (problem) return res.status(problem.status).json({ message: problem.message })
        const item = await prisma.$transaction((tx) => addToCart(tx, user_id, product_id, variant_id, quantity))
        return res.status(201).json({message: "Added to cart",data: { item },})
    }catch(err){
        console.error("addCartItems error:",err)
        return res.status(500).json({ message: "Database Error" });
    }
}

export const getCartItems=async(req,res)=>{
    const user_id=Number(req.user.sub)
    try{
        const cart=await prisma.cart.findMany({
            where:{user_id:user_id},
            include:{items:{
                orderBy:{created_at:"asc"},
                include:{
                    variant:true,
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
        // Show sale prices in the cart the same way the shop does.
        for (const c of cart) {
            const priced = await withSalePricing(c.items.map((i) => ({ ...i.product, variants: i.variant ? [i.variant] : [] })))
            c.items = c.items.map((item, idx) => ({
                ...item,
                product: { ...priced[idx], variants: undefined },
                variant: priced[idx].variants[0] ?? null,
            }))
        }
        res.status(200).json({message:"Cart fecthed",data:{cart}})
    }catch(err){
        console.error("getCartItems error:",err)
        return res.status(500).json({ message: "Database Error" });
    }
}

// PATCH /cart/items/:productId?variantId=3   body: { quantity }
export const updateCartItems = async (req, res) => {
    const product_id = Number(req.params.productId)
    const user_id = Number(req.user.sub)
    const variant_id = parseVariantId(req.query.variantId)
    const quantity = req.body.quantity !== undefined ? Number(req.body.quantity) : 1

    if (!Number.isInteger(product_id) || product_id < 1) {
        return res.status(400).json({ message: "id should be an integer" })
    }
    if (Number.isNaN(variant_id)) return res.status(400).json({ message: "variantId must be a positive integer" })
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        return res.status(400).json({ message: `quantity must be a whole number from 1 to ${MAX_QUANTITY}` });
    }

    try {
        const cart = await prisma.cart.findUnique({ where: { user_id: user_id } })
        if (!cart) {
            return res.status(404).json({ message: "cart not found" })
        }
        const item = await findItem(prisma, cart.id, product_id, variant_id)
        if (!item) return res.status(404).json({ message: "Item isn't in your cart" })
        const cartUpdated = await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } })
        return res.status(200).json({ message: "Quantity updated", data: { cartUpdated } })
    } catch (err) {
        console.error("updateCartItems error:", err)
        return res.status(500).json({ message: "Database Error" });
    }
}

// DELETE /cart/items/:productId?variantId=3
export const deleteCartItems = async (req, res) => {
    const product_id = Number(req.params.productId)
    const user_id = Number(req.user.sub)
    const variant_id = parseVariantId(req.query.variantId)
    if (!Number.isInteger(product_id) || product_id < 1) {
        return res.status(400).json({ message: "id should be an integer" })
    }
    if (Number.isNaN(variant_id)) return res.status(400).json({ message: "variantId must be a positive integer" })
    try {
        const cart = await prisma.cart.findUnique({ where: { user_id: user_id } })
        if (!cart) {
            return res.status(404).json({ message: "cart not found" })
        }
        const deleted = await prisma.cartItem.deleteMany({ where: { cart_id: cart.id, product_id, variant_id } })
        if (deleted.count === 0) return res.status(404).json({ message: "Item isn't in your cart" })
        return res.status(204).send()
    } catch (err) {
        console.error("deleteCartItems error:", err)
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
        console.error("deleteCart error:", err)
        return res.status(500).json({ message: "Database Error" });

    }
}

// POST /cart/merge   body: { items: [{ product_id, variant_id?, quantity }] }
// Called right after login with the cart the visitor built as a guest. Items that
// can't be bought any more are skipped and reported, not treated as an error.
export const mergeCart = async (req, res) => {
    const user_id = Number(req.user.sub)
    const parsed = parseLineInput(req.body.items)
    if (parsed.error) return res.status(400).json({ message: parsed.error })
    try {
        const skipped = []
        let merged = 0
        for (const line of parsed.lines) {
            const problem = await checkPurchasable(line.productId, line.variantId)
            if (problem) {
                skipped.push({ product_id: line.productId, variant_id: line.variantId, reason: problem.message })
                continue
            }
            await prisma.$transaction((tx) => addToCart(tx, user_id, line.productId, line.variantId, line.quantity))
            merged++
        }
        return res.status(200).json({ message: "Cart merged", data: { merged, skipped } })
    } catch (err) {
        console.error("mergeCart error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
