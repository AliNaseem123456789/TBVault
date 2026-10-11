// Validates and normalises a product body. `partial` is for updates, where every field is optional.
export const parseProductInput = (body, { partial = false } = {}) => {
    const data = {}
    const has = (k) => body[k] !== undefined

    if (has("name") || !partial) {
        const name = typeof body.name === "string" ? body.name.trim() : ""
        if (!name || name.length > 100) return { error: "name must be 1-100 characters" }
        data.name = name
    }
    if (has("description")) {
        if (body.description !== null && typeof body.description !== "string") return { error: "description must be text" }
        data.description = body.description
    }
    if (has("price") || !partial) {
        const price = Number(body.price)
        if (!Number.isFinite(price) || price < 0) return { error: "price must be a number of 0 or more" }
        data.price = price
    }
    if (has("stock")) {
        const stock = Number(body.stock)
        if (!Number.isInteger(stock) || stock < 0) return { error: "stock must be a whole number of 0 or more" }
        data.stock = stock
    }
    if (has("is_hidden")) {
        if (typeof body.is_hidden !== "boolean") return { error: "is_hidden must be true or false" }
        data.is_hidden = body.is_hidden
    }
    if (has("category_id") || !partial) {
        const category_id = Number(body.category_id)
        if (!Number.isInteger(category_id) || category_id < 1) return { error: "category_id must be a positive integer" }
        data.category_id = category_id
    }
    if (has("brand_id")) {
        if (body.brand_id === null || body.brand_id === "") data.brand_id = null
        else {
            const brand_id = Number(body.brand_id)
            if (!Number.isInteger(brand_id) || brand_id < 1) return { error: "brand_id must be a positive integer or null" }
            data.brand_id = brand_id
        }
    }
    return { data }
}
