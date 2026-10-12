const MAX_MESSAGE = 1000
const MAX_HISTORY = 12

const positiveInt = (value) => {
    const n = Number(value)
    return Number.isInteger(n) && n > 0 ? n : null
}

const money = (value) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
}

/** POST /chat body: { message, history?: [{ role: "user"|"assistant", content }] } */
export const parseChatInput = (body = {}) => {
    const message = typeof body.message === "string" ? body.message.trim() : ""
    if (!message) return { error: "message is required" }
    if (message.length > MAX_MESSAGE) return { error: `message must be at most ${MAX_MESSAGE} characters` }
    const history = []
    if (body.history !== undefined) {
        if (!Array.isArray(body.history)) return { error: "history must be a list" }
        for (const turn of body.history.slice(-MAX_HISTORY)) {
            if (!turn || !["user", "assistant"].includes(turn.role) || typeof turn.content !== "string") {
                return { error: "each history item needs role (user or assistant) and content" }
            }
            history.push({ role: turn.role, content: turn.content.slice(0, 2000) })
        }
    }
    return { data: { message, history } }
}

/** Optional text sent along with an image. */
export const parseImageMessage = (value) => {
    if (value === undefined || value === null) return { data: "" }
    const message = String(value).trim()
    if (message.length > MAX_MESSAGE) return { error: `message must be at most ${MAX_MESSAGE} characters` }
    return { data: message }
}

/** GET /search/smart query string. */
export const parseSearchQuery = (q = {}) => {
    const query = typeof q.query === "string" ? q.query.trim() : ""
    if (!query) return { error: "query is required" }
    if (query.length > 200) return { error: "query must be at most 200 characters" }
    const data = { query }
    for (const key of ["category_id", "brand_id", "seller_id"]) {
        if (q[key] === undefined || q[key] === "") continue
        data[key] = positiveInt(q[key])
        if (!data[key]) return { error: `${key} must be a positive integer` }
    }
    for (const key of ["min_price", "max_price"]) {
        if (q[key] === undefined || q[key] === "") continue
        data[key] = money(q[key])
        if (data[key] === null) return { error: `${key} must be a number of 0 or more` }
    }
    if (data.min_price !== undefined && data.max_price !== undefined && data.min_price > data.max_price) {
        return { error: "min_price can't be more than max_price" }
    }
    for (const key of ["in_stock", "on_sale"]) {
        if (q[key] !== undefined) data[key] = q[key] === "true" || q[key] === "1"
    }
    if (q.limit !== undefined) {
        data.limit = positiveInt(q.limit)
        if (!data.limit || data.limit > 20) return { error: "limit must be between 1 and 20" }
    }
    return { data }
}
