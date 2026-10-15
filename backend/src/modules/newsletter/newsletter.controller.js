import prisma from "../../config/db.js"
import { parseEmail } from "./newsletter.validation.js"

// POST /newsletter   body: { email }
// Signing up twice is fine: the answer is the same, so nobody can use this to find out who's subscribed.
export const subscribe = async (req, res) => {
    const email = parseEmail(req.body.email)
    if (!email) return res.status(400).json({ message: "A valid email is required" })
    try {
        await prisma.newsletterSubscriber.upsert({ where: { email }, update: {}, create: { email } })
        return res.status(201).json({ message: "You're subscribed" })
    } catch (err) {
        console.error("newsletter subscribe error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
