import prisma from "../../config/db.js"
import { getSettings } from "../../services/settings/settings.service.js"
import { publishSupportEvent } from "../../events/publishers/support.publisher.js"
import { SUPPORT_EVENTS } from "../../events/eventNames.js"
import { parseContactInput, CONTACT_TOPICS } from "./contact.validation.js"

/** Where contact messages go: the store email, else the alert email, else every admin. */
const supportInbox = async () => {
    const settings = await getSettings()
    if (settings.store_email) return [settings.store_email]
    if (settings.alert_email) return [settings.alert_email]
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", is_blocked: false }, select: { email: true } })
    return admins.map((a) => a.email)
}

// GET /contact/topics
export const getTopics = (req, res) => res.status(200).json({ message: "Contact topics", data: CONTACT_TOPICS })

// POST /contact   body: { name, email, topic, order_ref?, message }
// The message is saved first, so it's never lost; the email to the store is best effort.
export const createContactMessage = async (req, res) => {
    const { data, error } = parseContactInput(req.body)
    if (error) return res.status(400).json({ message: error })
    const userId = req.user ? Number(req.user.sub) : null
    try {
        const saved = await prisma.contactMessage.create({ data: { ...data, user_id: userId } })
        try {
            const recipients = await supportInbox()
            if (recipients.length) {
                await publishSupportEvent(SUPPORT_EVENTS.CONTACT_RECEIVED, {
                    recipients,
                    messageId: saved.id,
                    name: saved.name,
                    email: saved.email,
                    topic: saved.topic,
                    orderRef: saved.order_ref,
                    message: saved.message,
                })
            }
        } catch (err) {
            console.error("[contact] could not forward message", saved.id, err.message)
        }
        return res.status(201).json({ message: "Thanks! We'll reply by email within one business day.", data: { id: saved.id } })
    } catch (err) {
        console.error("createContactMessage error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
