import prisma from "../../config/db.js"
import { isPublicProduct } from "../../utils/visibility.js"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// POST /products/:productId/stock-alerts   body: { email? (guests), variant_id? }
// "Email me when it's back." Signed-in customers don't need to send an email.
export const createStockAlert = async (req, res) => {
    const productId = Number(req.params.productId)
    if (!Number.isInteger(productId) || productId < 1) return res.status(400).json({ message: "invalid product id" })
    const variantId = req.body.variant_id == null || req.body.variant_id === "" ? null : Number(req.body.variant_id)
    if (variantId !== null && (!Number.isInteger(variantId) || variantId < 1)) return res.status(400).json({ message: "variant_id must be a positive integer" })

    const userId = req.user ? Number(req.user.sub) : null
    try {
        let email
        if (userId) {
            email = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email
        } else {
            email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : ""
            if (!EMAIL_RE.test(email) || email.length > 255) return res.status(400).json({ message: "A valid email is required" })
        }

        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { is_hidden: true, stock: true, seller: { select: { status: true } }, variants: { where: { is_active: true }, select: { id: true, stock: true } } },
        })
        if (!isPublicProduct(product)) return res.status(404).json({ message: "Product not found" })
        const variant = variantId ? product.variants.find((v) => v.id === variantId) : null
        if (variantId && !variant) return res.status(404).json({ message: "That option isn't available" })
        if (!variantId && product.variants.length > 0) return res.status(400).json({ message: "Choose an option first" })
        const stock = variant ? variant.stock : product.stock
        if (stock > 0) return res.status(400).json({ message: "This is in stock right now" })

        // One pending alert per person per product/option.
        const existing = await prisma.stockNotification.findFirst({ where: { product_id: productId, variant_id: variantId, email, notified_at: null } })
        if (!existing) {
            await prisma.stockNotification.create({ data: { product_id: productId, variant_id: variantId, email, user_id: userId } })
        }
        return res.status(201).json({ message: "We'll email you when it's back in stock" })
    } catch (err) {
        console.error("createStockAlert error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
