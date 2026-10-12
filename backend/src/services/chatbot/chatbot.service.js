/**
 * Talks to the Python chatbot service (chatbot/ folder, `uvicorn app.main:app --port 8000`).
 * Browsers never call it directly: they call /api/chat and /api/search/..., and the
 * controllers here pass the request on. That keeps one address for the site and lets
 * us reuse login and rate limiting.
 */
const CHATBOT_URL = process.env.CHATBOT_URL || "http://localhost:8000"
const TIMEOUT_MS = Number(process.env.CHATBOT_TIMEOUT_MS || 45000)

/**
 * callChatbot("/search", { query: { query: "lamp" } })
 * callChatbot("/chat", { method: "POST", json: { message, history, state }, userToken })
 * callChatbot("/chat/image", { method: "POST", form: buildForm(file, { message }) })
 * Resolves to { status, body }. Throws when the service can't be reached or times out.
 */
export const callChatbot = async (path, { method = "GET", query, json, form, userToken } = {}) => {
    const url = new URL(path, CHATBOT_URL)
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
    }
    const headers = {}
    if (process.env.CHATBOT_INTERNAL_KEY) headers["X-Internal-Key"] = process.env.CHATBOT_INTERNAL_KEY
    // The signed-in customer's own access token: the chatbot uses it to call this API *as them*
    // (order tools), so the usual ownership checks apply. Only sent for verified tokens.
    if (userToken) headers["X-User-Token"] = userToken
    let body
    if (json) {
        headers["Content-Type"] = "application/json"
        body = JSON.stringify(json)
    } else if (form) {
        body = form   // fetch sets the multipart Content-Type itself
    }
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, body: data }
}

/** Multipart form data from an optional multer file plus text fields. */
export const buildForm = (file, fields = {}) => {
    const form = new FormData()
    if (file) form.append("image", new Blob([file.buffer], { type: file.mimetype }), file.originalname || "image")
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null && value !== "") form.append(key, String(value))
    }
    return form
}
