import { toCents } from "../../utils/pricing.helpers.js"

export const TOPUP_MIN = 5
export const TOPUP_MAX = 1000
export const GIFT_CARD_MAX = 1000

// A money amount in cents, or { error }.
export const parseAmount = (value, { min = 0.01, max = 100000, allowNegative = false, field = "amount" } = {}) => {
    const n = Number(value)
    if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return { error: `${field} must be a number` }
    if (Math.round(n * 100) !== Math.round(n * 1000) / 10) return { error: `${field} can have at most 2 decimals` }
    const abs = Math.abs(n)
    if ((!allowNegative && n < 0) || abs < min || abs > max) {
        return { error: allowNegative ? `${field} must be between -${max} and ${max}, and not 0` : `${field} must be from ${min} to ${max}` }
    }
    return { cents: toCents(n) }
}

// body: { amount, quantity?, expires_at?, note? }
export const parseGiftCardInput = (body) => {
    const amount = parseAmount(body.amount, { min: 1, max: GIFT_CARD_MAX })
    if (amount.error) return { error: amount.error }
    const quantity = body.quantity === undefined ? 1 : Number(body.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return { error: "quantity must be a whole number from 1 to 50" }
    let expiresAt = null
    if (body.expires_at) {
        expiresAt = new Date(body.expires_at)
        if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) return { error: "expires_at must be a future date" }
    }
    if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 255)) return { error: "note must be text up to 255 characters" }
    return { data: { amountCents: amount.cents, quantity, expiresAt, note: body.note?.trim() || null } }
}
