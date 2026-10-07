const TYPES = ["PERCENT", "FIXED", "FREE_SHIPPING"]

const parseDate = (value, field) => {
    if (value === null || value === "") return { value: null }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return { error: `${field} must be a date` }
    return { value: date }
}
const parseMoney = (value, field) => {
    if (value === null || value === "") return { value: null }
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return { error: `${field} must be a number of 0 or more` }
    return { value: n }
}
const parseLimit = (value, field) => {
    if (value === null || value === "") return { value: null }
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1) return { error: `${field} must be a whole number of 1 or more` }
    return { value: n }
}

/**
 * Validates a coupon body. `partial` is for updates (the current coupon is passed
 * as `existing` so cross-field rules still hold). Returns { data } or { error }.
 */
export const parseCouponInput = (body = {}, { partial = false, existing = null } = {}) => {
    const data = {}
    const has = (k) => body[k] !== undefined

    if (has("code") || !partial) {
        const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : ""
        if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return { error: "code must be 3-40 letters, numbers, - or _" }
        data.code = code
    }
    if (has("description")) {
        if (body.description !== null && typeof body.description !== "string") return { error: "description must be text" }
        const description = body.description?.trim() || null
        if (description && description.length > 255) return { error: "description must be at most 255 characters" }
        data.description = description
    }
    if (has("type") || !partial) {
        if (!TYPES.includes(body.type)) return { error: `type must be one of: ${TYPES.join(", ")}` }
        data.type = body.type
    }
    const type = data.type ?? existing?.type
    if (has("value") || (!partial && type !== "FREE_SHIPPING")) {
        const value = Number(body.value ?? 0)
        if (!Number.isFinite(value) || value < 0) return { error: "value must be a number of 0 or more" }
        if (type === "PERCENT" && (value <= 0 || value > 100)) return { error: "a percent coupon's value must be between 1 and 100" }
        if (type === "FIXED" && value <= 0) return { error: "a fixed coupon's value must be more than 0" }
        data.value = type === "FREE_SHIPPING" ? 0 : value
    } else if (type === "FREE_SHIPPING" && has("type")) {
        data.value = 0
    }
    for (const [field, parser] of [["max_discount", parseMoney], ["min_order_amount", parseMoney], ["starts_at", parseDate], ["expires_at", parseDate], ["usage_limit", parseLimit], ["per_user_limit", parseLimit]]) {
        if (!has(field)) continue
        const { value, error } = parser(body[field], field)
        if (error) return { error }
        data[field] = value
    }
    if (has("is_active")) {
        if (typeof body.is_active !== "boolean") return { error: "is_active must be true or false" }
        data.is_active = body.is_active
    }
    const startsAt = data.starts_at !== undefined ? data.starts_at : existing?.starts_at
    const expiresAt = data.expires_at !== undefined ? data.expires_at : existing?.expires_at
    if (startsAt && expiresAt && new Date(expiresAt) <= new Date(startsAt)) return { error: "expires_at must be after starts_at" }
    return { data }
}
