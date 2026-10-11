import prisma from "../../config/db.js"
import { isCardPaymentEnabled } from "../../config/stripe.js"
import { createTopupSession } from "../../services/payments/stripe.service.js"
import { changeCredits, redeemGiftCard, newGiftCardCode } from "../../services/wallet/wallet.service.js"
import { fromCents } from "../../utils/pricing.helpers.js"
import { parseAmount, parseGiftCardInput, TOPUP_MIN, TOPUP_MAX } from "./wallet.validation.js"

const parsePaging = (query, defaultLimit = 20) => {
    const page = query.page !== undefined ? Number(query.page) : 1
    const limit = query.limit !== undefined ? Number(query.limit) : defaultLimit
    if (!Number.isInteger(page) || page < 1) return { error: "invalid page" }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: "invalid limit" }
    return { page, limit }
}
const pageMeta = (page, limit, totalItems) => {
    const totalPages = Math.ceil(totalItems / limit)
    return { totalPages, currentPage: page, hasNext: totalPages > page, hasPrev: page > 1, itemsPerPage: limit, totalItems }
}
const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

const TRANSACTION_SELECT = { id: true, amount: true, balance_after: true, type: true, order_id: true, note: true, created_at: true }

// Balance + paged history, shared by the customer and admin views.
const walletPage = async (userId, { page, limit }) => {
    const [user, transactions, totalItems] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { credit_balance: true } }),
        prisma.creditTransaction.findMany({ where: { user_id: userId }, orderBy: { created_at: "desc" }, skip: (page - 1) * limit, take: limit, select: TRANSACTION_SELECT }),
        prisma.creditTransaction.count({ where: { user_id: userId } }),
    ])
    return { user, transactions, totalItems }
}

// ==============================
// CUSTOMER
// ==============================

// GET /wallet?page=1&limit=20
export const getWallet = async (req, res) => {
    const paging = parsePaging(req.query)
    if (paging.error) return res.status(400).json({ message: paging.error })
    try {
        const { user, transactions, totalItems } = await walletPage(Number(req.user.sub), paging)
        if (!user) return res.status(404).json({ message: "User not found" })
        return res.status(200).json({
            message: "Wallet",
            data: { balance: user.credit_balance, transactions, topup: { enabled: isCardPaymentEnabled(), min: TOPUP_MIN, max: TOPUP_MAX } },
            metaData: pageMeta(paging.page, paging.limit, totalItems),
        })
    } catch (err) {
        console.error("getWallet error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /wallet/topup   body: { amount } — returns a Stripe Checkout URL; credit arrives by webhook.
export const startTopup = async (req, res) => {
    if (!isCardPaymentEnabled()) return res.status(400).json({ message: "Card payments aren't available" })
    const { cents, error } = parseAmount(req.body.amount, { min: TOPUP_MIN, max: TOPUP_MAX })
    if (error) return res.status(400).json({ message: error })
    const userId = Number(req.user.sub)
    try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, is_blocked: true } })
        if (!user || user.is_blocked) return res.status(403).json({ message: "This account can't add credit. Please contact support." })
        const topup = await prisma.creditTopup.create({ data: { user_id: userId, amount: fromCents(cents) } })
        const walletUrl = `${process.env.FRONTEND_URL}/wallet`
        try {
            const session = await createTopupSession(topup, {
                email: user.email,
                successUrl: `${walletUrl}?topup=success`,
                cancelUrl: `${walletUrl}?topup=cancelled`,
            })
            await prisma.creditTopup.update({ where: { id: topup.id }, data: { stripe_checkout_session_id: session.id } })
            return res.status(201).json({ message: "Top-up started", data: { checkout_url: session.url } })
        } catch (err) {
            console.error("createTopupSession error:", err)
            await prisma.creditTopup.update({ where: { id: topup.id }, data: { status: "expired" } }).catch(() => {})
            return res.status(502).json({ message: "Card payment is unavailable right now. Please try again." })
        }
    } catch (err) {
        console.error("startTopup error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /wallet/redeem   body: { code }
export const redeemCode = async (req, res) => {
    if (typeof req.body.code !== "string" || !req.body.code.trim() || req.body.code.length > 40) {
        return res.status(400).json({ message: "Enter a gift card code" })
    }
    try {
        const entry = await redeemGiftCard(Number(req.user.sub), req.body.code)
        return res.status(200).json({ message: `$${Number(entry.amount).toFixed(2)} added to your store credit`, data: { transaction: entry, balance: entry.balance_after } })
    } catch (err) {
        if (String(err.message).startsWith("GIFT_CARD:")) return res.status(400).json({ message: err.message.slice(10) })
        console.error("redeemCode error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// ==============================
// ADMIN
// ==============================

// GET /admin/customers/:userId/credits
export const getCustomerCredits = async (req, res) => {
    const userId = parseId(req.params.userId)
    const paging = parsePaging(req.query)
    if (!userId) return res.status(400).json({ message: "invalid user id" })
    if (paging.error) return res.status(400).json({ message: paging.error })
    try {
        const { user, transactions, totalItems } = await walletPage(userId, paging)
        if (!user) return res.status(404).json({ message: "Customer not found" })
        return res.status(200).json({ message: "Credits", data: { balance: user.credit_balance, transactions }, metaData: pageMeta(paging.page, paging.limit, totalItems) })
    } catch (err) {
        console.error("getCustomerCredits error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /admin/customers/:userId/credits   body: { amount (negative to take away), note }
export const adjustCustomerCredits = async (req, res) => {
    const userId = parseId(req.params.userId)
    if (!userId) return res.status(400).json({ message: "invalid user id" })
    const { cents, error } = parseAmount(req.body.amount, { max: 10000, allowNegative: true })
    if (error) return res.status(400).json({ message: error })
    const note = typeof req.body.note === "string" ? req.body.note.trim() : ""
    if (!note || note.length > 500) return res.status(400).json({ message: "A reason (note) of up to 500 characters is required" })
    try {
        const entry = await prisma.$transaction((tx) =>
            changeCredits(tx, { userId, amountCents: cents, type: cents > 0 ? "admin_grant" : "admin_deduct", note, createdBy: Number(req.user.sub) })
        )
        return res.status(201).json({ message: cents > 0 ? "Credit added" : "Credit removed", data: { transaction: entry, balance: entry.balance_after } })
    } catch (err) {
        if (err.message === "INSUFFICIENT_CREDITS") return res.status(400).json({ message: "The customer doesn't have that much credit" })
        if (err.message === "USER_NOT_FOUND") return res.status(404).json({ message: "Customer not found" })
        console.error("adjustCustomerCredits error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /admin/gift-cards?status=unused|redeemed|inactive&search=code&page=1
export const listGiftCards = async (req, res) => {
    const paging = parsePaging(req.query)
    if (paging.error) return res.status(400).json({ message: paging.error })
    const where = {}
    if (req.query.status === "unused") Object.assign(where, { redeemed_at: null, is_active: true })
    else if (req.query.status === "redeemed") where.redeemed_at = { not: null }
    else if (req.query.status === "inactive") where.is_active = false
    else if (req.query.status !== undefined) return res.status(400).json({ message: "status must be unused, redeemed or inactive" })
    if (typeof req.query.search === "string" && req.query.search.trim()) where.code = { contains: req.query.search.trim().toUpperCase() }
    try {
        const [cards, totalItems] = await Promise.all([
            prisma.giftCard.findMany({
                where, orderBy: { created_at: "desc" }, skip: (paging.page - 1) * paging.limit, take: paging.limit,
                include: { redeemer: { select: { id: true, name: true, email: true } } },
            }),
            prisma.giftCard.count({ where }),
        ])
        return res.status(200).json({ message: "Gift cards", data: { gift_cards: cards }, metaData: pageMeta(paging.page, paging.limit, totalItems) })
    } catch (err) {
        console.error("listGiftCards error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /admin/gift-cards   body: { amount, quantity?, expires_at?, note? }
export const createGiftCards = async (req, res) => {
    const { data, error } = parseGiftCardInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        const cards = []
        for (let i = 0; i < data.quantity; i++) {
            // A code collision is astronomically unlikely; retry once just in case.
            for (let attempt = 0; ; attempt++) {
                try {
                    cards.push(await prisma.giftCard.create({
                        data: { code: newGiftCardCode(), amount: fromCents(data.amountCents), expires_at: data.expiresAt, note: data.note, created_by: Number(req.user.sub) },
                    }))
                    break
                } catch (err) {
                    if (err.code !== "P2002" || attempt > 0) throw err
                }
            }
        }
        return res.status(201).json({ message: `${cards.length} gift card${cards.length === 1 ? "" : "s"} created`, data: { gift_cards: cards } })
    } catch (err) {
        console.error("createGiftCards error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /admin/gift-cards/:giftCardId   body: { is_active }
export const setGiftCardActive = async (req, res) => {
    const id = parseId(req.params.giftCardId)
    if (!id) return res.status(400).json({ message: "invalid gift card id" })
    if (typeof req.body.is_active !== "boolean") return res.status(400).json({ message: "is_active must be true or false" })
    try {
        const card = await prisma.giftCard.update({ where: { id }, data: { is_active: req.body.is_active } })
        return res.status(200).json({ message: card.is_active ? "Gift card enabled" : "Gift card disabled", data: { gift_card: card } })
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Gift card not found" })
        console.error("setGiftCardActive error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
