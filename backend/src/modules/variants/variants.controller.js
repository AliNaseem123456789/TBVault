import prisma from "../../config/db.js"
import { parseVariantInput } from "./variant.validation.js"
import { notifyBackInStock } from "../../services/inventory/inventory.service.js"
import { notifyCatalogChanged } from "../../events/publishers/catalog.publisher.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

// GET /admin/products/:productId/variants — all of them, including inactive ones.
export const getVariantsAdmin = async (req, res) => {
    const productId = parseId(req.params.productId)
    if (!productId) return res.status(400).json({ message: "invalid product id" })
    try {
        const variants = await prisma.productVariant.findMany({
            where: { product_id: productId },
            orderBy: [{ sort_order: "asc" }, { id: "asc" }],
        })
        return res.status(200).json({ message: "Variants fetched", data: { variants } })
    } catch (err) {
        console.error("getVariantsAdmin error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /products/:productId/variants   body: { name, sku?, options?, price?, stock, is_active?, sort_order? }
export const createVariant = async (req, res) => {
    const productId = parseId(req.params.productId)
    if (!productId) return res.status(400).json({ message: "invalid product id" })
    const { data, error } = parseVariantInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
        if (!product) return res.status(404).json({ message: "Product doesn't exist" })
        const variant = await prisma.productVariant.create({ data: { ...data, product_id: productId } })
        notifyCatalogChanged({ product_ids: [productId] })
        return res.status(201).json({ message: "Variant created", data: { variant } })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "Another variant already uses that SKU" })
        console.error("createVariant error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PUT /variants/:variantId
export const updateVariant = async (req, res) => {
    const variantId = parseId(req.params.variantId)
    if (!variantId) return res.status(400).json({ message: "invalid variant id" })
    const { data, error } = parseVariantInput(req.body, { partial: true })
    if (error) return res.status(400).json({ message: error })
    try {
        const before = await prisma.productVariant.findUnique({ where: { id: variantId } })
        if (!before) return res.status(404).json({ message: "Variant not found" })
        const variant = await prisma.productVariant.update({ where: { id: variantId }, data })
        if (before.stock <= 0 && variant.stock > 0 && variant.is_active) {
            notifyBackInStock({ productId: variant.product_id, variantId: variant.id })
        }
        notifyCatalogChanged({ product_ids: [variant.product_id] })
        return res.status(200).json({ message: "Variant updated", data: { variant } })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "Another variant already uses that SKU" })
        console.error("updateVariant error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// DELETE /variants/:variantId — variants that were ordered are kept (deactivate them instead).
export const deleteVariant = async (req, res) => {
    const variantId = parseId(req.params.variantId)
    if (!variantId) return res.status(400).json({ message: "invalid variant id" })
    try {
        const ordered = await prisma.orderItem.count({ where: { variant_id: variantId } })
        if (ordered > 0) {
            return res.status(409).json({ message: "This option is in past orders. Turn it off instead of deleting it." })
        }
        const deleted = await prisma.productVariant.delete({ where: { id: variantId } })
        notifyCatalogChanged({ product_ids: [deleted.product_id] })
        return res.status(204).send()
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Variant not found" })
        console.error("deleteVariant error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
