import prisma from "../../config/db.js"
import { withSalePricing } from "../../services/pricing/pricing.service.js"
import { PUBLIC_PRODUCT_WHERE } from "../../utils/visibility.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

const parseName = (value) => {
    const name = typeof value === "string" ? value.trim() : ""
    return name && name.length <= 100 ? name : null
}

export const createCategories = async (req, res) => {
    const name = parseName(req.body.name)
    if (!name) return res.status(400).json({ message: "name must be 1-100 characters" })
    try {
        const category = await prisma.category.create({ data: { name } })
        return res.status(201).json({ message: "Category created", data: category })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "Category already exists" })
        console.error("createCategories error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

export const getCategoriesById = async (req, res) => {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ message: "id must be a positive integer" })
    try {
        const category = await prisma.category.findUnique({ where: { id } })
        if (!category) return res.status(404).json({ message: "Category not found" })
        return res.status(200).json({ message: "Category fetched", data: category })
    } catch (err) {
        console.error("getCategoriesById error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

export const getCategories = async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            orderBy: { name: "asc" },
            include: { _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } } },
        })
        return res.status(200).json({ message: "Category fetched", data: categories })
    } catch (err) {
        console.error("getCategories error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

export const updateCategoryName = async (req, res) => {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ message: "id must be a positive integer" })
    const name = parseName(req.body.name)
    if (!name) return res.status(400).json({ message: "name must be 1-100 characters" })
    try {
        const category = await prisma.category.update({ where: { id }, data: { name } })
        return res.status(200).json({ message: "Category updated", data: category })
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Category not found" })
        if (err.code === "P2002") return res.status(409).json({ message: "Category already exists" })
        console.error("updateCategoryName error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

export const deleteCategory = async (req, res) => {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ message: "id must be a positive integer" })
    try {
        await prisma.category.delete({ where: { id } })
        return res.status(204).send()
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Category not found" })
        // P2003: products still point at this category (foreign key).
        if (err.code === "P2003") return res.status(409).json({ message: "Move or delete this category's products first" })
        console.error("deleteCategory error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

export const getProductsByCategory = async (req, res) => {
    const id = parseId(req.params.id)
    if (!id) return res.status(400).json({ message: "id must be a positive integer" })
    try {
        const category = await prisma.category.findUnique({
            where: { id },
            include: {
                products: {
                    where: PUBLIC_PRODUCT_WHERE,
                    orderBy: { created_at: "desc" },
                    include: { images: { orderBy: [{ is_primary: "desc" }, { created_at: "asc" }], take: 2 } },
                },
            },
        })
        if (!category) return res.status(404).json({ message: "Category not found" })
        category.products = await withSalePricing(category.products)
        return res.status(200).json({ message: "Category fetched", data: category })
    } catch (err) {
        console.error("getProductsByCategory error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
