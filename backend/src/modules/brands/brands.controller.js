import prisma from "../../config/db.js"
import { PUBLIC_PRODUCT_WHERE } from "../../utils/visibility.js"

const parseBrandName = (value) => {
    const name = typeof value === "string" ? value.trim() : ""
    if (!name || name.length > 100) return { error: "name must be 1-100 characters" }
    return { name }
}

// GET /brands — every brand with how many products shoppers can see.
export const getBrands = async (req, res) => {
    try {
        const brands = await prisma.brand.findMany({
            orderBy: { name: "asc" },
            include: { _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } } },
        })
        return res.status(200).json({ message: "Brands", data: { brands } })
    } catch (err) {
        console.error("getBrands error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /admin/brands   body: { name }
export const createBrand = async (req, res) => {
    const { name, error } = parseBrandName(req.body.name)
    if (error) return res.status(400).json({ message: error })
    try {
        const brand = await prisma.brand.create({ data: { name } })
        return res.status(201).json({ message: "Brand created", data: { brand } })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "A brand with that name already exists" })
        console.error("createBrand error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PUT /admin/brands/:brandId   body: { name }
export const updateBrand = async (req, res) => {
    const id = Number(req.params.brandId)
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "invalid brand id" })
    const { name, error } = parseBrandName(req.body.name)
    if (error) return res.status(400).json({ message: error })
    try {
        const brand = await prisma.brand.update({ where: { id }, data: { name } })
        return res.status(200).json({ message: "Brand updated", data: { brand } })
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Brand not found" })
        if (err.code === "P2002") return res.status(409).json({ message: "A brand with that name already exists" })
        console.error("updateBrand error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// DELETE /admin/brands/:brandId — its products simply lose the brand.
export const deleteBrand = async (req, res) => {
    const id = Number(req.params.brandId)
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "invalid brand id" })
    try {
        await prisma.brand.delete({ where: { id } })
        return res.status(204).send()
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Brand not found" })
        console.error("deleteBrand error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
