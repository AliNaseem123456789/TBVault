import prisma from "../../config/db.js"
import { toCsv } from "../../utils/csv.helpers.js"
import { ORDER_STATUSES } from "../orders/order.status.js"
import { withSalePricing } from "../../services/pricing/pricing.service.js"

const MAX_ROWS = 50000

const parseDateParam = (value) => {
    if (value === undefined || value === "") return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
}

const sendCsv = (res, filename, csv) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    // BOM so Excel opens UTF-8 (names with accents) correctly.
    return res.status(200).send("﻿" + csv)
}

// GET /admin/exports/orders.csv?from=2026-09-01&to=2026-10-01&status=delivered
export const exportOrders = async (req, res) => {
    const from = parseDateParam(req.query.from)
    const to = parseDateParam(req.query.to)
    if (from === undefined || to === undefined) return res.status(400).json({ message: "from and to must be dates" })
    if (req.query.status !== undefined && !ORDER_STATUSES.includes(req.query.status)) return res.status(400).json({ message: "invalid status" })

    const where = {}
    if (from || to) where.created_at = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) }
    if (req.query.status) where.status = req.query.status
    try {
        const orders = await prisma.order.findMany({
            where,
            orderBy: { created_at: "asc" },
            take: MAX_ROWS,
            include: { user: { select: { name: true, email: true } }, items: true },
        })
        const header = [
            "order_id", "created_at", "status", "customer_name", "email", "guest", "items", "item_count",
            "subtotal", "discount", "shipping", "tax", "total", "refunded", "coupon",
            "payment_method", "payment_status", "paid_at", "shipping_address",
            "tracking_carrier", "tracking_number", "shipped_at", "delivered_at", "cancelled_at",
        ]
        const rows = orders.map((o) => [
            o.id, o.created_at, o.status, o.user?.name ?? "", o.user?.email ?? o.guest_email ?? "", o.user_id ? "no" : "yes",
            o.items.map((i) => `${i.quantity} x ${i.product_name ?? `#${i.product_id}`}${i.variant_name ? ` (${i.variant_name})` : ""}`).join("; "),
            o.items.reduce((s, i) => s + i.quantity, 0),
            o.subtotal, o.discount_total, o.shipping_total, o.tax_total, o.total_amount, o.amount_refunded, o.coupon_code ?? "",
            o.payment_method, o.payment_status, o.paid_at, (o.shipping_address ?? "").replace(/\s*\n\s*/g, ", "),
            o.tracking_carrier ?? "", o.tracking_number ?? "", o.shipped_at, o.delivered_at, o.cancelled_at,
        ])
        return sendCsv(res, `orders-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, rows))
    } catch (err) {
        console.error("exportOrders error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /admin/exports/products.csv — one row per product, options listed in one cell.
export const exportProducts = async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            orderBy: { id: "asc" },
            take: MAX_ROWS,
            include: { category: { select: { name: true } }, variants: { orderBy: [{ sort_order: "asc" }, { id: "asc" }] } },
        })
        const priced = await withSalePricing(products)
        const header = ["product_id", "name", "category", "price", "sale_price", "sale_percent", "stock", "hidden", "variants", "created_at", "updated_at"]
        const rows = priced.map((p) => [
            p.id, p.name, p.category?.name ?? "", p.price, p.sale_price ?? "", p.sale_percent ?? "",
            p.variants.length ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock,
            p.is_hidden ? "yes" : "no",
            p.variants.map((v) => `${v.name}${v.sku ? ` [${v.sku}]` : ""}: ${v.stock} @ ${v.effective_list_price}${v.is_active ? "" : " (off)"}`).join("; "),
            p.created_at, p.updated_at,
        ])
        return sendCsv(res, `products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, rows))
    } catch (err) {
        console.error("exportProducts error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
