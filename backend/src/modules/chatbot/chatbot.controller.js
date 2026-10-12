import { callChatbot, buildForm } from "../../services/chatbot/chatbot.service.js"
import { parseChatInput, parseImageMessage, parseSearchQuery } from "./chatbot.validation.js"

/**
 * Sends the chatbot's answer back in our usual { message, data } shape.
 * The Python service answers errors as { detail }; 400/422 mean bad input,
 * 503 means search is down (Pinecone, models or database).
 */
const relay = (res, { status, body }, message) => {
    if (status === 200) return res.status(200).json({ message, data: body })
    if (status === 400 || status === 422) {
        const detail = typeof body.detail === "string" ? body.detail : "Invalid request"
        return res.status(400).json({ message: detail })
    }
    if (status === 401) console.error("chatbot rejected our X-Internal-Key: check CHATBOT_INTERNAL_KEY in both .env files")
    else console.error(`chatbot answered ${status}:`, body.detail ?? body)
    return res.status(503).json({ message: "The assistant is unavailable right now. Please try again in a moment." })
}

const offline = (res, fn, err) => {
    console.error(`${fn} error:`, err.message)
    return res.status(503).json({ message: "The assistant is unavailable right now. Please try again in a moment." })
}

// POST /chat   body: { message, history? }
export const sendChatMessage = async (req, res) => {
    const { data, error } = parseChatInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        return relay(res, await callChatbot("/chat", { method: "POST", json: data }), "Chat reply")
    } catch (err) {
        return offline(res, "sendChatMessage", err)
    }
}

// POST /chat/image   form-data: image (file), message (optional)
export const sendChatImage = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Attach an image" })
    const { data: message, error } = parseImageMessage(req.body.message)
    if (error) return res.status(400).json({ message: error })
    try {
        const form = buildForm(req.file, { message })
        return relay(res, await callChatbot("/chat/image", { method: "POST", form }), "Chat reply")
    } catch (err) {
        return offline(res, "sendChatImage", err)
    }
}

// GET /search/smart?query=...&category_id&brand_id&seller_id&min_price&max_price&in_stock&on_sale&limit
export const smartSearch = async (req, res) => {
    const { data, error } = parseSearchQuery(req.query)
    if (error) return res.status(400).json({ message: error })
    try {
        return relay(res, await callChatbot("/search", { query: data }), "Search results")
    } catch (err) {
        return offline(res, "smartSearch", err)
    }
}

// POST /search/image   form-data: image (file) OR query (text describing the look)
export const imageSearch = async (req, res) => {
    const query = typeof req.body.query === "string" ? req.body.query.trim() : ""
    if (!req.file && !query) return res.status(400).json({ message: "Send an image or a query" })
    if (query.length > 200) return res.status(400).json({ message: "query must be at most 200 characters" })
    try {
        const form = req.file ? buildForm(req.file) : buildForm(null, { query })
        return relay(res, await callChatbot("/search/image", { method: "POST", form }), "Search results")
    } catch (err) {
        return offline(res, "imageSearch", err)
    }
}
