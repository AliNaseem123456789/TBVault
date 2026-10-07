import prisma from "../../config/db.js"

const DAY_MS = 24 * 60 * 60 * 1000

// Orders that count as sales: not cancelled, and card orders only once paid.
const saleSql = (alias = "") =>
    `${alias}status <> 'cancelled' AND NOT (${alias}payment_method = 'card' AND ${alias}payment_status = 'unpaid')`
const saleWhere = (from, to) => ({
    created_at: { gte: from, lt: to },
    status: { not: "cancelled" },
    NOT: { payment_method: "card", payment_status: "unpaid" },
})

const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

const periodTotals = async (from, to) => {
    const agg = await prisma.order.aggregate({
        where: saleWhere(from, to),
        _count: true,
        _sum: { total_amount: true, amount_refunded: true, discount_total: true },
    })
    const gross = Number(agg._sum.total_amount ?? 0)
    const refunded = Number(agg._sum.amount_refunded ?? 0)
    return { orders: agg._count, gross, refunded, revenue: gross - refunded, discounts: Number(agg._sum.discount_total ?? 0) }
}

const pctChange = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null)

// GET /admin/analytics?days=30 — sales dashboard numbers. Days are UTC.
export const getSalesDashboard = async (req, res) => {
    const days = req.query.days !== undefined ? Number(req.query.days) : 30
    if (!Number.isInteger(days) || days < 1 || days > 365) return res.status(400).json({ message: "days must be a whole number from 1 to 365" })

    const to = new Date(startOfUtcDay(new Date()).getTime() + DAY_MS)    // end of today
    const from = new Date(to.getTime() - days * DAY_MS)
    const prevFrom = new Date(from.getTime() - days * DAY_MS)

    try {
        const [current, previous, daily, topItems, statusRows, visits, prevVisits, newCustomers] = await Promise.all([
            periodTotals(from, to),
            periodTotals(prevFrom, from),
            prisma.$queryRawUnsafe(
                `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                        COUNT(*)::int AS orders,
                        COALESCE(SUM(total_amount - amount_refunded), 0)::float AS revenue
                   FROM orders
                  WHERE created_at >= $1 AND created_at < $2 AND ${saleSql()}
                  GROUP BY 1 ORDER BY 1`,
                from, to
            ),
            prisma.$queryRawUnsafe(
                `SELECT oi.product_id, MAX(COALESCE(oi.product_name, p.name)) AS name,
                        SUM(oi.quantity)::int AS quantity, SUM(oi.total_price)::float AS revenue
                   FROM order_items oi
                   JOIN orders o ON o.id = oi.order_id
                   LEFT JOIN products p ON p.id = oi.product_id
                  WHERE o.created_at >= $1 AND o.created_at < $2 AND ${saleSql("o.")}
                  GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 5`,
                from, to
            ),
            prisma.order.groupBy({ by: ["status"], where: { created_at: { gte: from, lt: to } }, _count: true }),
            prisma.siteVisit.count({ where: { day: { gte: from, lt: to } } }),
            prisma.siteVisit.count({ where: { day: { gte: prevFrom, lt: from } } }),
            prisma.user.count({ where: { created_at: { gte: from, lt: to }, role: "CUSTOMER" } }),
        ])

        // One point per day, zero-filled, so the chart has no gaps.
        const byDay = Object.fromEntries(daily.map((d) => [d.day, d]))
        const series = Array.from({ length: days }, (_, i) => {
            const day = new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10)
            return { day, orders: byDay[day]?.orders ?? 0, revenue: Math.round((byDay[day]?.revenue ?? 0) * 100) / 100 }
        })

        const round = (n) => Math.round(n * 100) / 100
        const conversion = visits > 0 ? Math.round((current.orders / visits) * 1000) / 10 : null
        const prevConversion = prevVisits > 0 ? Math.round((previous.orders / prevVisits) * 1000) / 10 : null
        return res.status(200).json({
            message: "Dashboard",
            data: {
                range: { from, to, days },
                totals: {
                    revenue: round(current.revenue),
                    orders: current.orders,
                    average_order_value: current.orders ? round(current.revenue / current.orders) : 0,
                    refunded: round(current.refunded),
                    discounts: round(current.discounts),
                    visits,
                    conversion_rate: conversion,
                    new_customers: newCustomers,
                },
                change: {
                    revenue: pctChange(current.revenue, previous.revenue),
                    orders: pctChange(current.orders, previous.orders),
                    conversion_rate: conversion != null && prevConversion ? Math.round((conversion - prevConversion) * 10) / 10 : null,
                },
                series,
                top_products: topItems.map((t) => ({ ...t, revenue: round(t.revenue) })),
                status_breakdown: Object.fromEntries(statusRows.map((r) => [r.status, r._count])),
            },
        })
    } catch (err) {
        console.error("getSalesDashboard error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /analytics/visits   body: { visitor_id }
// The storefront sends this once per browser per day. visitor_id is a random id the
// browser keeps; no personal data. Powers the conversion rate.
export const recordVisit = async (req, res) => {
    const visitorId = typeof req.body.visitor_id === "string" ? req.body.visitor_id.trim() : ""
    if (!/^[A-Za-z0-9-]{8,64}$/.test(visitorId)) return res.status(400).json({ message: "invalid visitor_id" })
    try {
        await prisma.siteVisit.upsert({
            where: { visitor_id_day: { visitor_id: visitorId, day: startOfUtcDay(new Date()) } },
            update: {},
            create: { visitor_id: visitorId, day: startOfUtcDay(new Date()) },
        })
        return res.status(204).send()
    } catch (err) {
        console.error("recordVisit error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
