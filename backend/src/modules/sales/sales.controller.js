import prisma from "../../config/db.js"
import { parseSaleInput } from "./sale.validation.js"
import { isSaleLive } from "../../utils/pricing.helpers.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

const SALE_INCLUDE = {
    product: { select: { id: true, name: true } },
    category: { select: { id: true, name: true } },
}

const withState = (sale, now = new Date()) => ({
    ...sale,
    state: isSaleLive(sale, now) ? "live" : !sale.is_active ? "paused" : new Date(sale.starts_at) > now ? "scheduled" : "ended",
})

// GET /admin/sales
export const listSales = async (req, res) => {
    try {
        const sales = await prisma.sale.findMany({ orderBy: { starts_at: "desc" }, include: SALE_INCLUDE })
        return res.status(200).json({ message: "Sales fetched", data: { sales: sales.map((s) => withState(s)) } })
    } catch (err) {
        console.error("listSales error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /admin/sales   body: { name, percent_off, product_id | category_id, starts_at, ends_at }
export const createSale = async (req, res) => {
    const { data, error } = parseSaleInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        const sale = await prisma.sale.create({ data, include: SALE_INCLUDE })
        return res.status(201).json({ message: "Sale created", data: { sale: withState(sale) } })
    } catch (err) {
        if (err.code === "P2003") return res.status(400).json({ message: "That product or category doesn't exist" })
        console.error("createSale error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PUT /admin/sales/:saleId
export const updateSale = async (req, res) => {
    const saleId = parseId(req.params.saleId)
    if (!saleId) return res.status(400).json({ message: "invalid sale id" })
    try {
        const existing = await prisma.sale.findUnique({ where: { id: saleId } })
        if (!existing) return res.status(404).json({ message: "Sale not found" })
        const { data, error } = parseSaleInput(req.body, { partial: true, existing })
        if (error) return res.status(400).json({ message: error })
        const sale = await prisma.sale.update({ where: { id: saleId }, data, include: SALE_INCLUDE })
        return res.status(200).json({ message: "Sale updated", data: { sale: withState(sale) } })
    } catch (err) {
        if (err.code === "P2003") return res.status(400).json({ message: "That product or category doesn't exist" })
        console.error("updateSale error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// DELETE /admin/sales/:saleId — orders keep the price they were charged, so this is always safe.
export const deleteSale = async (req, res) => {
    const saleId = parseId(req.params.saleId)
    if (!saleId) return res.status(400).json({ message: "invalid sale id" })
    try {
        await prisma.sale.delete({ where: { id: saleId } })
        return res.status(204).send()
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Sale not found" })
        console.error("deleteSale error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
