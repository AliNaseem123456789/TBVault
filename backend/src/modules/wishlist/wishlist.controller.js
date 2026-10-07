import prisma from "../../config/db.js"
import { withSalePricing } from "../../services/pricing/pricing.service.js"

const MAX_WISHLIST = 200

// GET /wishlist — newest first, hidden products left out.
export const getWishlist = async (req, res) => {
    const userId = Number(req.user.sub)
    try {
        const items = await prisma.wishlistItem.findMany({
            where: { user_id: userId, product: { is_hidden: false } },
            orderBy: { created_at: "desc" },
            include: {
                product: {
                    include: {
                        category: { select: { id: true, name: true } },
                        images: { orderBy: [{ is_primary: "desc" }, { created_at: "asc" }], take: 2 },
                        variants: { where: { is_active: true }, select: { id: true, name: true, price: true, stock: true, is_active: true } },
                    },
                },
            },
        })
        const products = await withSalePricing(items.map((i) => i.product))
        return res.status(200).json({
            message: "Wishlist fetched",
            data: { items: items.map((item, idx) => ({ id: item.id, created_at: item.created_at, product: products[idx] })) },
        })
    } catch (err) {
        console.error("getWishlist error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /wishlist/items   body: { product_id } — adding twice is fine (no duplicate).
export const addWishlistItem = async (req, res) => {
    const userId = Number(req.user.sub)
    const productId = Number(req.body.product_id)
    if (!Number.isInteger(productId) || productId < 1) return res.status(400).json({ message: "product id is needed" })
    try {
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { is_hidden: true } })
        if (!product || product.is_hidden) return res.status(404).json({ message: "Product not found" })
        const count = await prisma.wishlistItem.count({ where: { user_id: userId } })
        if (count >= MAX_WISHLIST) return res.status(400).json({ message: `Your wishlist can hold up to ${MAX_WISHLIST} products` })
        const item = await prisma.wishlistItem.upsert({
            where: { user_id_product_id: { user_id: userId, product_id: productId } },
            update: {},
            create: { user_id: userId, product_id: productId },
        })
        return res.status(201).json({ message: "Saved to wishlist", data: { item } })
    } catch (err) {
        console.error("addWishlistItem error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// DELETE /wishlist/items/:productId
export const removeWishlistItem = async (req, res) => {
    const userId = Number(req.user.sub)
    const productId = Number(req.params.productId)
    if (!Number.isInteger(productId) || productId < 1) return res.status(400).json({ message: "invalid product id" })
    try {
        await prisma.wishlistItem.deleteMany({ where: { user_id: userId, product_id: productId } })
        return res.status(204).send()
    } catch (err) {
        console.error("removeWishlistItem error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
