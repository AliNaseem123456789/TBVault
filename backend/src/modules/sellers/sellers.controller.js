import prisma from "../../config/db.js"
import { getSettings } from "../../services/settings/settings.service.js"
import { sellerBalanceCents, pendingEarningsCents } from "../../services/marketplace/seller-ledger.service.js"
import { fromCents, toCents } from "../../utils/pricing.helpers.js"
import { PUBLIC_PRODUCT_WHERE } from "../../utils/visibility.js"
import { parseAmount } from "../wallet/wallet.validation.js"
import { SELLER_STATUSES, SELLER_NEXT, slugify, parseSellerApplication, parseSellerAdminInput } from "./sellers.validation.js"
import { notifyCatalogChanged } from "../../events/publishers/catalog.publisher.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}
const parsePaging = (query) => {
    const page = query.page !== undefined ? Number(query.page) : 1
    const limit = query.limit !== undefined ? Number(query.limit) : 20
    if (!Number.isInteger(page) || page < 1) return { error: "invalid page" }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: "invalid limit" }
    return { page, limit }
}
const pageMeta = (page, limit, totalItems) => {
    const totalPages = Math.ceil(totalItems / limit)
    return { totalPages, currentPage: page, hasNext: totalPages > page, hasPrev: page > 1, itemsPerPage: limit, totalItems }
}

// A free slug for a store name: "my-shop", then "my-shop-2", ...
const uniqueSlug = async (name, exceptId = null) => {
    const base = slugify(name)
    for (let n = 1; ; n++) {
        const slug = n === 1 ? base : `${base}-${n}`
        const taken = await prisma.seller.findUnique({ where: { slug }, select: { id: true } })
        if (!taken || taken.id === exceptId) return slug
    }
}

// Balance figures for one seller, as strings with 2 decimals.
const moneySummary = async (sellerId) => {
    const [balance, pending, paidOut] = await Promise.all([
        sellerBalanceCents(prisma, sellerId),
        pendingEarningsCents(prisma, sellerId),
        prisma.sellerPayout.aggregate({ where: { seller_id: sellerId }, _sum: { amount: true } }),
    ])
    return {
        balance: fromCents(balance).toFixed(2),
        pending_earnings: fromCents(pending).toFixed(2),
        paid_out: fromCents(toCents(paidOut._sum.amount ?? 0)).toFixed(2),
    }
}

// ==============================
// BECOMING A SELLER
// ==============================

// POST /seller/apply   body: { store_name, description? }
// A rejected applicant can apply again; the application goes back to PENDING.
export const applyAsSeller = async (req, res) => {
    const userId = Number(req.user.sub)
    const { data, error } = parseSellerApplication(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { is_blocked: true, is_verified: true } })
        if (!user || user.is_blocked) return res.status(403).json({ message: "This account can't apply to sell" })
        const existing = await prisma.seller.findUnique({ where: { user_id: userId } })
        if (existing && existing.status !== "REJECTED") {
            return res.status(409).json({ message: existing.status === "PENDING" ? "Your application is already being reviewed" : "You already have a seller account" })
        }
        const slug = await uniqueSlug(data.store_name, existing?.id ?? null)
        const seller = existing
            ? await prisma.seller.update({ where: { id: existing.id }, data: { ...data, slug, status: "PENDING", admin_note: null } })
            : await prisma.seller.create({ data: { ...data, slug, user_id: userId } })
        return res.status(201).json({ message: "Application sent. We'll review it shortly.", data: { seller } })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "That store name is taken" })
        console.error("applyAsSeller error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /seller/me — the signed-in user's seller account (any status), or null.
export const getMySeller = async (req, res) => {
    try {
        const seller = await prisma.seller.findUnique({ where: { user_id: Number(req.user.sub) } })
        const money = seller?.status === "APPROVED" ? await moneySummary(seller.id) : null
        return res.status(200).json({ message: "Seller account", data: { seller, money } })
    } catch (err) {
        console.error("getMySeller error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /seller/me   body: { store_name?, description? }
export const updateMySeller = async (req, res) => {
    const { data, error } = parseSellerApplication(req.body, { partial: true })
    if (error) return res.status(400).json({ message: error })
    if (Object.keys(data).length === 0) return res.status(400).json({ message: "nothing to update" })
    try {
        if (data.store_name && data.store_name !== req.seller.store_name) data.slug = await uniqueSlug(data.store_name, req.seller.id)
        const seller = await prisma.seller.update({ where: { id: req.seller.id }, data })
        if (data.store_name) notifyCatalogChanged({ seller_id: seller.id })   // "Sold by" is part of the search text
        return res.status(200).json({ message: "Store updated", data: { seller } })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "That store name is taken" })
        console.error("updateMySeller error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// ==============================
// SELLER DASHBOARD
// ==============================

// GET /seller/dashboard
export const getSellerDashboard = async (req, res) => {
    const sellerId = req.seller.id
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    try {
        const settings = await getSettings()
        const [money, productCount, hiddenCount, outOfStock, byStatus, recentSales, recent] = await Promise.all([
            moneySummary(sellerId),
            prisma.product.count({ where: { seller_id: sellerId } }),
            prisma.product.count({ where: { seller_id: sellerId, is_hidden: true } }),
            prisma.product.count({ where: { seller_id: sellerId, stock: { lte: 0 }, variants: { none: { is_active: true, stock: { gt: 0 } } } } }),
            prisma.sellerOrder.groupBy({ by: ["status"], where: { seller_id: sellerId }, _count: true }),
            prisma.sellerOrder.aggregate({
                where: { seller_id: sellerId, status: { not: "cancelled" }, created_at: { gte: since } },
                _sum: { subtotal: true, seller_earnings: true }, _count: true,
            }),
            prisma.sellerOrder.findMany({
                where: { seller_id: sellerId }, orderBy: { created_at: "desc" }, take: 5,
                select: { id: true, order_id: true, status: true, subtotal: true, seller_earnings: true, created_at: true, _count: { select: { items: true } } },
            }),
        ])
        return res.status(200).json({
            message: "Seller dashboard",
            data: {
                seller: req.seller,
                commission_rate: req.seller.commission_rate ?? settings.commission_rate,
                money,
                products: { total: productCount, hidden: hiddenCount, out_of_stock: outOfStock },
                orders: Object.fromEntries(byStatus.map((g) => [g.status, g._count])),
                last_30_days: {
                    orders: recentSales._count,
                    sales: fromCents(toCents(recentSales._sum.subtotal ?? 0)).toFixed(2),
                    earnings: fromCents(toCents(recentSales._sum.seller_earnings ?? 0)).toFixed(2),
                },
                recent_orders: recent,
            },
        })
    } catch (err) {
        console.error("getSellerDashboard error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

const listTransactions = async (res, sellerId, query) => {
    const paging = parsePaging(query)
    if (paging.error) return res.status(400).json({ message: paging.error })
    try {
        const [transactions, totalItems, payouts] = await Promise.all([
            prisma.sellerTransaction.findMany({
                where: { seller_id: sellerId }, orderBy: { created_at: "desc" },
                skip: (paging.page - 1) * paging.limit, take: paging.limit,
                include: { seller_order: { select: { order_id: true } }, payout: { select: { reference: true } } },
            }),
            prisma.sellerTransaction.count({ where: { seller_id: sellerId } }),
            prisma.sellerPayout.findMany({ where: { seller_id: sellerId }, orderBy: { created_at: "desc" }, take: 20 }),
        ])
        return res.status(200).json({
            message: "Seller transactions",
            data: { money: await moneySummary(sellerId), transactions, payouts },
            metaData: pageMeta(paging.page, paging.limit, totalItems),
        })
    } catch (err) {
        console.error("listTransactions error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /seller/transactions?page=1
export const getSellerTransactions = (req, res) => listTransactions(res, req.seller.id, req.query)

// ==============================
// PUBLIC STORE PAGES
// ==============================

const STORE_SELECT = { id: true, store_name: true, slug: true, description: true, is_platform: true, created_at: true }

// GET /stores — approved stores, biggest first.
export const listStores = async (req, res) => {
    try {
        const stores = await prisma.seller.findMany({
            where: { status: "APPROVED" },
            select: { ...STORE_SELECT, _count: { select: { products: { where: { is_hidden: false } } } } },
            orderBy: [{ is_platform: "desc" }, { store_name: "asc" }],
        })
        return res.status(200).json({ message: "Stores", data: { stores } })
    } catch (err) {
        console.error("listStores error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /stores/:slug
export const getStore = async (req, res) => {
    const slug = String(req.params.slug ?? "").toLowerCase()
    if (!/^[a-z0-9-]{1,120}$/.test(slug)) return res.status(404).json({ message: "Store not found" })
    try {
        const store = await prisma.seller.findFirst({
            where: { slug, status: "APPROVED" },
            select: { ...STORE_SELECT, _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } } },
        })
        if (!store) return res.status(404).json({ message: "Store not found" })
        const rating = await prisma.review.aggregate({
            where: { is_hidden: false, product: { seller_id: store.id } }, _avg: { rating: true }, _count: true,
        })
        return res.status(200).json({ message: "Store", data: { store: { ...store, rating: { average: rating._avg.rating, count: rating._count } } } })
    } catch (err) {
        console.error("getStore error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// ==============================
// ADMIN
// ==============================

// GET /admin/sellers?status=PENDING&search=name&page=1
export const listSellers = async (req, res) => {
    const paging = parsePaging(req.query)
    if (paging.error) return res.status(400).json({ message: paging.error })
    const where = {}
    if (req.query.status !== undefined) {
        if (!SELLER_STATUSES.includes(req.query.status)) return res.status(400).json({ message: "invalid status" })
        where.status = req.query.status
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""
    if (search) {
        where.OR = [
            { store_name: { contains: search, mode: "insensitive" } },
            { user: { email: { contains: search, mode: "insensitive" } } },
            { user: { name: { contains: search, mode: "insensitive" } } },
        ]
    }
    try {
        const [sellers, totalItems, pendingCount] = await Promise.all([
            prisma.seller.findMany({
                where, orderBy: [{ status: "asc" }, { created_at: "desc" }],
                skip: (paging.page - 1) * paging.limit, take: paging.limit,
                include: { user: { select: { id: true, name: true, email: true } }, _count: { select: { products: true, seller_orders: true } } },
            }),
            prisma.seller.count({ where }),
            prisma.seller.count({ where: { status: "PENDING" } }),
        ])
        const balances = await Promise.all(sellers.map((s) => sellerBalanceCents(prisma, s.id)))
        return res.status(200).json({
            message: "Sellers",
            data: { sellers: sellers.map((s, i) => ({ ...s, balance: fromCents(balances[i]).toFixed(2) })), pending_count: pendingCount },
            metaData: pageMeta(paging.page, paging.limit, totalItems),
        })
    } catch (err) {
        console.error("listSellers error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /admin/sellers/:sellerId
export const getSellerAdmin = async (req, res) => {
    const id = parseId(req.params.sellerId)
    if (!id) return res.status(400).json({ message: "invalid seller id" })
    try {
        const seller = await prisma.seller.findUnique({
            where: { id },
            include: { user: { select: { id: true, name: true, email: true, role: true } }, _count: { select: { products: true, seller_orders: true } } },
        })
        if (!seller) return res.status(404).json({ message: "Seller not found" })
        const settings = await getSettings()
        return res.status(200).json({
            message: "Seller",
            data: { seller, money: await moneySummary(id), default_commission_rate: settings.commission_rate },
        })
    } catch (err) {
        console.error("getSellerAdmin error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /admin/sellers/:sellerId/status   body: { status, note? }
// Approving makes the user a SELLER; rejecting or suspending takes the role away again.
export const setSellerStatus = async (req, res) => {
    const id = parseId(req.params.sellerId)
    if (!id) return res.status(400).json({ message: "invalid seller id" })
    const { status } = req.body
    if (!SELLER_STATUSES.includes(status)) return res.status(400).json({ message: `status must be one of: ${SELLER_STATUSES.join(", ")}` })
    const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 500) || null : null
    try {
        const seller = await prisma.$transaction(async (tx) => {
            const current = await tx.seller.findUnique({ where: { id }, include: { user: { select: { role: true } } } })
            if (!current) throw new Error("NOT_FOUND")
            if (current.is_platform) throw new Error("PLATFORM")
            if (!SELLER_NEXT[current.status].includes(status)) throw new Error(`BAD_TRANSITION:${current.status}`)
            const updated = await tx.seller.update({
                where: { id },
                data: { status, admin_note: note, ...(status === "APPROVED" && !current.approved_at ? { approved_at: new Date() } : {}) },
            })
            if (current.user_id && current.user?.role !== "ADMIN") {
                await tx.user.update({ where: { id: current.user_id }, data: { role: status === "APPROVED" ? "SELLER" : "CUSTOMER" } })
            }
            return updated
        })
        notifyCatalogChanged({ seller_id: id })   // their products appear in / disappear from search
        const verb = { APPROVED: "approved", REJECTED: "rejected", SUSPENDED: "suspended", PENDING: "updated" }[status]
        return res.status(200).json({ message: `Seller ${verb}`, data: { seller } })
    } catch (err) {
        if (err.message === "NOT_FOUND") return res.status(404).json({ message: "Seller not found" })
        if (err.message === "PLATFORM") return res.status(400).json({ message: "The store's own seller account can't be changed" })
        if (String(err.message).startsWith("BAD_TRANSITION:")) {
            return res.status(400).json({ message: `Cannot move a seller from ${err.message.split(":")[1]} to ${status}` })
        }
        console.error("setSellerStatus error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /admin/sellers/:sellerId   body: { commission_rate }
export const updateSellerAdmin = async (req, res) => {
    const id = parseId(req.params.sellerId)
    if (!id) return res.status(400).json({ message: "invalid seller id" })
    const { data, error } = parseSellerAdminInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        const seller = await prisma.seller.update({ where: { id }, data })
        return res.status(200).json({ message: "Seller updated", data: { seller } })
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Seller not found" })
        console.error("updateSellerAdmin error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /admin/sellers/:sellerId/payouts   body: { amount, reference?, note? }
// Records money already sent to the seller outside the site; it can't exceed their balance.
export const createPayout = async (req, res) => {
    const id = parseId(req.params.sellerId)
    if (!id) return res.status(400).json({ message: "invalid seller id" })
    const { cents, error } = parseAmount(req.body.amount, { max: 1000000 })
    if (error) return res.status(400).json({ message: error })
    const reference = typeof req.body.reference === "string" ? req.body.reference.trim().slice(0, 255) || null : null
    const note = typeof req.body.note === "string" ? req.body.note.trim().slice(0, 500) || null : null
    const adminId = Number(req.user.sub)
    try {
        const payout = await prisma.$transaction(async (tx) => {
            // Lock the seller row so two payouts at once can't both pass the balance check.
            const locked = await tx.$queryRaw`SELECT id, is_platform FROM sellers WHERE id = ${id} FOR UPDATE`
            if (locked.length === 0) throw new Error("NOT_FOUND")
            if (locked[0].is_platform) throw new Error("PLATFORM")
            const balance = await sellerBalanceCents(tx, id)
            if (cents > balance) throw new Error(`OVER_BALANCE:${fromCents(balance).toFixed(2)}`)
            const created = await tx.sellerPayout.create({ data: { seller_id: id, amount: fromCents(cents), reference, note, created_by: adminId } })
            await tx.sellerTransaction.create({
                data: { seller_id: id, payout_id: created.id, type: "payout", amount: fromCents(-cents), note: reference ? `Payout ${reference}` : "Payout", created_by: adminId },
            })
            return created
        })
        return res.status(201).json({ message: "Payout recorded", data: { payout, money: await moneySummary(id) } })
    } catch (err) {
        if (err.message === "NOT_FOUND") return res.status(404).json({ message: "Seller not found" })
        if (err.message === "PLATFORM") return res.status(400).json({ message: "The store's own seller account has no payouts" })
        if (String(err.message).startsWith("OVER_BALANCE:")) return res.status(400).json({ message: `The seller's balance is only $${err.message.split(":")[1]}` })
        console.error("createPayout error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /admin/sellers/:sellerId/transactions?page=1
export const getSellerTransactionsAdmin = (req, res) => {
    const id = parseId(req.params.sellerId)
    if (!id) return res.status(400).json({ message: "invalid seller id" })
    return listTransactions(res, id, req.query)
}
