// Validates a product variant body. `partial` is for updates. Returns { data } or { error }.
export const parseVariantInput = (body = {}, { partial = false } = {}) => {
    const data = {}
    const has = (k) => body[k] !== undefined

    if (has("name") || !partial) {
        const name = typeof body.name === "string" ? body.name.trim() : ""
        if (!name || name.length > 100) return { error: "name must be 1-100 characters" }
        data.name = name
    }
    if (has("sku")) {
        if (body.sku !== null && typeof body.sku !== "string") return { error: "sku must be text" }
        const sku = body.sku?.trim() || null
        if (sku && sku.length > 64) return { error: "sku must be at most 64 characters" }
        data.sku = sku
    }
    if (has("options")) {
        const options = body.options
        if (options !== null && (typeof options !== "object" || Array.isArray(options))) return { error: 'options must be an object like { "Size": "M" }' }
        if (options && Object.entries(options).some(([k, v]) => typeof v !== "string" || k.length > 40 || v.length > 60)) {
            return { error: "each option must be a short text value" }
        }
        data.options = options
    }
    if (has("price")) {
        if (body.price === null || body.price === "") data.price = null
        else {
            const price = Number(body.price)
            if (!Number.isFinite(price) || price < 0) return { error: "price must be a number of 0 or more" }
            data.price = price
        }
    }
    if (has("stock") || !partial) {
        const stock = Number(body.stock ?? 0)
        if (!Number.isInteger(stock) || stock < 0) return { error: "stock must be a whole number of 0 or more" }
        data.stock = stock
    }
    for (const field of ["is_active"]) {
        if (has(field)) {
            if (typeof body[field] !== "boolean") return { error: `${field} must be true or false` }
            data[field] = body[field]
        }
    }
    if (has("sort_order")) {
        const order = Number(body.sort_order)
        if (!Number.isInteger(order)) return { error: "sort_order must be a whole number" }
        data.sort_order = order
    }
    return { data }
}
