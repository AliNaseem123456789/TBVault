import crypto from "node:crypto"
import prisma from "../../config/db.js"
import { toCents, fromCents } from "../../utils/pricing.helpers.js"

export const CREDIT_TYPES = ["topup", "refund", "admin_grant", "admin_deduct", "gift_card", "order_payment", "order_cancel"]

/**
 * Adds (positive) or spends (negative) store credit inside `tx`, and writes the ledger row.
 * Spending is a conditional update, so two checkouts at once can't overspend: if the balance
 * is too low the update matches nothing and Error("INSUFFICIENT_CREDITS") is thrown.
 * Returns the credit_transactions row.
 */
export const changeCredits = async (tx, { userId, amountCents, type, orderId = null, giftCardId = null, topupId = null, note = null, createdBy = null }) => {
    if (!Number.isInteger(amountCents) || amountCents === 0) throw new Error("BAD_AMOUNT:Credit amount must not be zero")
    const amount = fromCents(Math.abs(amountCents))
    const updated = await tx.user.updateMany({
        where: amountCents < 0 ? { id: userId, credit_balance: { gte: amount } } : { id: userId },
        data: { credit_balance: amountCents < 0 ? { decrement: amount } : { increment: amount } },
    })
    if (updated.count === 0) throw new Error(amountCents < 0 ? "INSUFFICIENT_CREDITS" : "USER_NOT_FOUND")
    const { credit_balance } = await tx.user.findUnique({ where: { id: userId }, select: { credit_balance: true } })
    return tx.creditTransaction.create({
        data: {
            user_id: userId,
            amount: fromCents(amountCents),
            balance_after: credit_balance,
            type,
            order_id: orderId,
            gift_card_id: giftCardId,
            topup_id: topupId,
            note: note ? String(note).slice(0, 500) : null,
            created_by: createdBy,
        },
    })
}

export const creditBalanceCents = async (db, userId) => {
    const user = await db.user.findUnique({ where: { id: userId }, select: { credit_balance: true } })
    return user ? toCents(user.credit_balance) : 0
}

// ==============================
// TOP-UPS (Stripe webhook)
// ==============================

/** Credits a paid top-up once (the status check makes a repeated webhook a no-op). */
export const markTopupPaid = async (session) => {
    const topupId = Number(session.metadata?.topup_id)
    if (!Number.isInteger(topupId)) return
    await prisma.$transaction(async (tx) => {
        const claimed = await tx.creditTopup.updateMany({
            where: { id: topupId, status: { not: "paid" } },
            data: { status: "paid", paid_at: new Date(), stripe_checkout_session_id: session.id },
        })
        if (claimed.count === 0) return
        const topup = await tx.creditTopup.findUnique({ where: { id: topupId } })
        await changeCredits(tx, { userId: topup.user_id, amountCents: toCents(topup.amount), type: "topup", topupId: topup.id, note: "Added by card" })
    })
}

export const markTopupExpired = async (session) => {
    const topupId = Number(session.metadata?.topup_id)
    if (!Number.isInteger(topupId)) return
    await prisma.creditTopup.updateMany({ where: { id: topupId, status: "pending" }, data: { status: "expired" } })
}

// ==============================
// GIFT CARDS
// ==============================

// TBV-XXXX-XXXX-XXXX, without look-alike characters.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const newGiftCardCode = () => {
    const bytes = crypto.randomBytes(12)
    const chars = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("")
    return `TBV-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`
}
export const normalizeGiftCardCode = (code) => String(code ?? "").trim().toUpperCase().replace(/\s+/g, "")

/**
 * Redeems a gift card for a customer. The conditional update means a code can only be
 * used once even if two people submit it at the same moment.
 * Throws Error("GIFT_CARD:reason").
 */
export const redeemGiftCard = (userId, rawCode) =>
    prisma.$transaction(async (tx) => {
        const code = normalizeGiftCardCode(rawCode)
        const card = await tx.giftCard.findUnique({ where: { code } })
        if (!card || !card.is_active) throw new Error("GIFT_CARD:That gift card code isn't valid")
        if (card.redeemed_at) throw new Error("GIFT_CARD:That gift card has already been used")
        if (card.expires_at && card.expires_at <= new Date()) throw new Error("GIFT_CARD:That gift card has expired")
        const claimed = await tx.giftCard.updateMany({
            where: { id: card.id, redeemed_at: null, is_active: true },
            data: { redeemed_at: new Date(), redeemed_by: userId },
        })
        if (claimed.count === 0) throw new Error("GIFT_CARD:That gift card has already been used")
        return changeCredits(tx, { userId, amountCents: toCents(card.amount), type: "gift_card", giftCardId: card.id, note: `Gift card ${card.code.slice(-4)}` })
    })
