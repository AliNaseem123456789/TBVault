export const SELLER_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]

// Which status an admin may move a seller to.
export const SELLER_NEXT = {
    PENDING: ["APPROVED", "REJECTED"],
    APPROVED: ["SUSPENDED"],
    REJECTED: ["APPROVED"],
    SUSPENDED: ["APPROVED"],
}

export const slugify = (text) =>
    String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "store"

// body: { store_name, description? }
export const parseSellerApplication = (body, { partial = false } = {}) => {
    const data = {}
    if (body.store_name !== undefined || !partial) {
        const name = typeof body.store_name === "string" ? body.store_name.trim() : ""
        if (name.length < 2 || name.length > 100) return { error: "store_name must be 2-100 characters" }
        data.store_name = name
    }
    if (body.description !== undefined) {
        if (body.description !== null && typeof body.description !== "string") return { error: "description must be text" }
        const text = body.description?.trim() || null
        if (text && text.length > 2000) return { error: "description must be at most 2000 characters" }
        data.description = text
    }
    return { data }
}

// body: { commission_rate: number | null }   null = use the store-wide rate
export const parseSellerAdminInput = (body) => {
    const data = {}
    if (body.commission_rate !== undefined) {
        if (body.commission_rate === null || body.commission_rate === "") data.commission_rate = null
        else {
            const rate = Number(body.commission_rate)
            if (!Number.isFinite(rate) || rate < 0 || rate > 90) return { error: "commission_rate must be from 0 to 90, or null for the store default" }
            data.commission_rate = rate
        }
    }
    if (Object.keys(data).length === 0) return { error: "nothing to update" }
    return { data }
}
