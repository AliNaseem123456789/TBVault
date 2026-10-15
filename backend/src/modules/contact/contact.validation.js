import { parseEmail } from "../newsletter/newsletter.validation.js"

export const CONTACT_TOPICS = ["Order help", "Returns & refunds", "Payments", "Selling on TBVault", "Something else"]

const text = (value, max) => {
    const s = typeof value === "string" ? value.trim() : ""
    return s && s.length <= max ? s : null
}

// body: { name, email, topic, order_ref?, message } -> { data } or { error }
export const parseContactInput = (body) => {
    const name = text(body.name, 100)
    if (!name) return { error: "name must be 1-100 characters" }
    const email = parseEmail(body.email)
    if (!email) return { error: "A valid email is required" }
    if (!CONTACT_TOPICS.includes(body.topic)) return { error: `topic must be one of: ${CONTACT_TOPICS.join(", ")}` }
    let orderRef = null
    if (body.order_ref !== undefined && body.order_ref !== null && body.order_ref !== "") {
        orderRef = text(String(body.order_ref), 40)
        if (!orderRef) return { error: "order_ref must be up to 40 characters" }
    }
    const message = typeof body.message === "string" ? body.message.trim() : ""
    if (message.length < 10 || message.length > 3000) return { error: "message must be 10-3000 characters" }
    return { data: { name, email, topic: body.topic, order_ref: orderRef, message } }
}
