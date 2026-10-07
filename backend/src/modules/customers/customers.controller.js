import prisma from "../../config/db.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

const CUSTOMER_SELECT = {
    id: true, name: true, email: true, role: true, is_verified: true, is_blocked: true, blocked_at: true, created_at: true,
}

// Spend per customer: non-cancelled orders, minus refunds, card orders only once paid.
const spendByUser = async (userIds) => {
    if (!userIds.length) return {}
    const rows = await prisma.order.groupBy({
        by: ["user_id"],
        where: { user_id: { in: userIds }, status: { not: "cancelled" }, NOT: { payment_method: "card", payment_status: "unpaid" } },
        _count: true,
        _sum: { total_amount: true, amount_refunded: true },
        _max: { created_at: true },
    })
    return Object.fromEntries(rows.map((r) => [r.user_id, {
        order_count: r._count,
        total_spent: (Number(r._sum.total_amount ?? 0) - Number(r._sum.amount_refunded ?? 0)).toFixed(2),
        last_order_at: r._max.created_at,
    }]))
}

// GET /admin/customers?search=ali&blocked=true&page=1&limit=20
export const listCustomers = async (req, res) => {
    const page = req.query.page !== undefined ? Number(req.query.page) : 1
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20
    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: "invalid page" })
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: "invalid limit" })
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""

    const where = {}
    if (search) where.OR = [{ email: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }]
    if (req.query.blocked === "true") where.is_blocked = true
    if (req.query.blocked === "false") where.is_blocked = false
    try {
        const [users, totalItems] = await Promise.all([
            prisma.user.findMany({ where, select: CUSTOMER_SELECT, orderBy: { created_at: "desc" }, skip: (page - 1) * limit, take: limit }),
            prisma.user.count({ where }),
        ])
        const spend = await spendByUser(users.map((u) => u.id))
        const totalPages = Math.ceil(totalItems / limit)
        return res.status(200).json({
            message: "Customers fetched",
            data: { customers: users.map((u) => ({ ...u, order_count: 0, total_spent: "0.00", last_order_at: null, ...spend[u.id] })) },
            metaData: { totalPages, currentPage: page, hasNext: totalPages > page, hasPrev: page > 1, itemsPerPage: limit, totalItems },
        })
    } catch (err) {
        console.error("listCustomers error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /admin/customers/:userId — profile, stats, recent orders and saved addresses.
export const getCustomer = async (req, res) => {
    const userId = parseId(req.params.userId)
    if (!userId) return res.status(400).json({ message: "invalid user id" })
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                ...CUSTOMER_SELECT,
                addresses: { orderBy: [{ is_default: "desc" }, { created_at: "asc" }] },
                orders: {
                    orderBy: { created_at: "desc" },
                    take: 50,
                    select: { id: true, status: true, total_amount: true, amount_refunded: true, payment_method: true, payment_status: true, created_at: true, _count: { select: { items: true } } },
                },
                _count: { select: { reviews: true, return_requests: true } },
            },
        })
        if (!user) return res.status(404).json({ message: "Customer not found" })
        const spend = await spendByUser([userId])
        return res.status(200).json({ message: "Customer fetched", data: { customer: { ...user, order_count: 0, total_spent: "0.00", ...spend[userId] } } })
    } catch (err) {
        console.error("getCustomer error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /admin/customers/:userId/block   body: { blocked: true|false }
// Blocking signs the customer out everywhere and stops logins and new orders.
export const setCustomerBlocked = async (req, res) => {
    const userId = parseId(req.params.userId)
    if (!userId) return res.status(400).json({ message: "invalid user id" })
    if (typeof req.body.blocked !== "boolean") return res.status(400).json({ message: "blocked must be true or false" })
    if (userId === Number(req.user.sub)) return res.status(400).json({ message: "You can't block yourself" })
    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
        if (!user) return res.status(404).json({ message: "Customer not found" })
        if (user.role === "ADMIN") return res.status(400).json({ message: "Admins can't be blocked" })
        const updates = [
            prisma.user.update({
                where: { id: userId },
                data: { is_blocked: req.body.blocked, blocked_at: req.body.blocked ? new Date() : null },
                select: CUSTOMER_SELECT,
            }),
        ]
        if (req.body.blocked) {
            updates.push(prisma.session.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } }))
        }
        const [customer] = await prisma.$transaction(updates)
        return res.status(200).json({ message: req.body.blocked ? "Customer blocked" : "Customer unblocked", data: { customer } })
    } catch (err) {
        console.error("setCustomerBlocked error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
