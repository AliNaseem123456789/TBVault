import prisma from "../../config/db.js"

/**
 * Store settings, stored as key/value rows in `settings`. A missing row falls back
 * to the default here, so a fresh database works without seeding.
 * `type` controls parsing and validation when an admin saves them.
 */
export const SETTINGS = {
    store_name: { type: "string", default: "TBVault", public: true, max: 100 },
    store_email: { type: "string", default: "", public: true, max: 255 },
    store_address: { type: "string", default: "", public: true, max: 500 },
    currency: { type: "string", default: "usd", public: true, max: 3 },
    tax_rate: { type: "number", default: 0, public: true, min: 0, max: 50 },
    return_window_days: { type: "int", default: 30, public: true, min: 0, max: 365 },
    low_stock_threshold: { type: "int", default: 5, public: false, min: 0, max: 100000 },
    alert_email: { type: "string", default: "", public: false, max: 255 },
    // Marketplace: the store's cut of each seller sale, in percent (a seller can have their own rate).
    commission_rate: { type: "number", default: 10, public: false, min: 0, max: 90 },
}

const parse = (key, raw) => {
    const def = SETTINGS[key]
    if (raw === undefined || raw === null) return def.default
    if (def.type === "number" || def.type === "int") {
        const n = Number(raw)
        return Number.isFinite(n) ? n : def.default
    }
    return String(raw)
}

export const getSettings = async (db = prisma) => {
    const rows = await db.setting.findMany()
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return Object.fromEntries(Object.keys(SETTINGS).map((key) => [key, parse(key, stored[key])]))
}

export const getPublicSettings = async () => {
    const all = await getSettings()
    return Object.fromEntries(Object.entries(all).filter(([key]) => SETTINGS[key].public))
}

/** Validates a partial settings object. Returns { data } or { error }. */
export const parseSettingsInput = (body) => {
    const data = {}
    for (const [key, value] of Object.entries(body ?? {})) {
        const def = SETTINGS[key]
        if (!def) return { error: `unknown setting: ${key}` }
        if (def.type === "string") {
            if (typeof value !== "string") return { error: `${key} must be text` }
            const text = value.trim()
            if (text.length > def.max) return { error: `${key} must be at most ${def.max} characters` }
            if (key === "currency" && !/^[a-z]{3}$/i.test(text)) return { error: "currency must be a 3-letter code like usd" }
            if ((key === "alert_email" || key === "store_email") && text && !/^\S+@\S+\.\S+$/.test(text)) return { error: `${key} must be an email address` }
            data[key] = key === "currency" ? text.toLowerCase() : text
        } else {
            const n = Number(value)
            if (!Number.isFinite(n) || n < def.min || n > def.max || (def.type === "int" && !Number.isInteger(n))) {
                return { error: `${key} must be a ${def.type === "int" ? "whole number" : "number"} from ${def.min} to ${def.max}` }
            }
            data[key] = String(n)
        }
    }
    return { data }
}

export const saveSettings = async (data) => {
    await prisma.$transaction(
        Object.entries(data).map(([key, value]) =>
            prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
        )
    )
    return getSettings()
}
