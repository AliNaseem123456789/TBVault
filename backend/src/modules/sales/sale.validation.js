// Validates a sale body. A sale targets exactly one product OR one category.
export const parseSaleInput = (body = {}, { partial = false, existing = null } = {}) => {
    const data = {}
    const has = (k) => body[k] !== undefined

    if (has("name") || !partial) {
        const name = typeof body.name === "string" ? body.name.trim() : ""
        if (!name || name.length > 100) return { error: "name must be 1-100 characters" }
        data.name = name
    }
    if (has("percent_off") || !partial) {
        const percent = Number(body.percent_off)
        if (!Number.isInteger(percent) || percent < 1 || percent > 90) return { error: "percent_off must be a whole number from 1 to 90" }
        data.percent_off = percent
    }
    for (const field of ["product_id", "category_id"]) {
        if (!has(field)) continue
        if (body[field] === null || body[field] === "") { data[field] = null; continue }
        const id = Number(body[field])
        if (!Number.isInteger(id) || id < 1) return { error: `${field} must be a positive integer` }
        data[field] = id
    }
    for (const field of ["starts_at", "ends_at"]) {
        if (!has(field) && partial) continue
        const date = new Date(body[field])
        if (body[field] == null || Number.isNaN(date.getTime())) return { error: `${field} must be a date` }
        data[field] = date
    }
    if (has("is_active")) {
        if (typeof body.is_active !== "boolean") return { error: "is_active must be true or false" }
        data.is_active = body.is_active
    }

    const productId = data.product_id !== undefined ? data.product_id : existing?.product_id ?? null
    const categoryId = data.category_id !== undefined ? data.category_id : existing?.category_id ?? null
    if (Boolean(productId) === Boolean(categoryId)) return { error: "a sale needs either product_id or category_id (not both)" }
    const startsAt = data.starts_at ?? existing?.starts_at
    const endsAt = data.ends_at ?? existing?.ends_at
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) return { error: "ends_at must be after starts_at" }
    return { data }
}
