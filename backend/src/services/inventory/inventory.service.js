import prisma from "../../config/db.js"
import { getSettings } from "../settings/settings.service.js"
import { publishInventoryEvent } from "../../events/publishers/inventory.publisher.js"
import { INVENTORY_EVENTS } from "../../events/eventNames.js"

/**
 * Takes `quantity` units of a product (or one of its variants) out of stock.
 * The `stock: { gte }` condition makes it atomic: two customers can't both buy
 * the last unit. Returns { before, after } so callers can spot low stock.
 */
export const takeStock = async (tx, { productId, variantId, quantity, name }) => {
    try {
        const row = variantId
            ? await tx.productVariant.update({
                where: { id: variantId, stock: { gte: quantity } },
                data: { stock: { decrement: quantity } },
                select: { stock: true },
            })
            : await tx.product.update({
                where: { id: productId, stock: { gte: quantity } },
                data: { stock: { decrement: quantity } },
                select: { stock: true },
            })
        return { before: row.stock + quantity, after: row.stock }
    } catch (err) {
        if (err.code === "P2025") throw new Error(`INSUFFICIENT_STOCK:${name}`)
        throw err
    }
}

/** Puts stock back (cancelled order, received return). Returns the rows that went from 0 to > 0. */
export const returnStock = async (tx, lines) => {
    const restocked = []
    for (const { productId, variantId, quantity } of lines) {
        if (quantity <= 0) continue
        if (variantId) {
            const variant = await tx.productVariant.findUnique({ where: { id: variantId }, select: { id: true } })
            if (!variant) continue   // variant deleted since; nothing to restock
            const row = await tx.productVariant.update({ where: { id: variantId }, data: { stock: { increment: quantity } }, select: { stock: true } })
            if (row.stock - quantity <= 0 && row.stock > 0) restocked.push({ productId, variantId })
        } else {
            const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true } })
            if (!product) continue
            const row = await tx.product.update({ where: { id: productId }, data: { stock: { increment: quantity } }, select: { stock: true } })
            if (row.stock - quantity <= 0 && row.stock > 0) restocked.push({ productId, variantId: null })
        }
    }
    return restocked
}

/** Who gets low-stock emails: the alert_email setting, or every admin when it's empty. */
const alertRecipients = async (settings) => {
    if (settings.alert_email) return [settings.alert_email]
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", is_blocked: false }, select: { email: true } })
    return admins.map((a) => a.email)
}

/**
 * After stock went down: email admins about anything that just crossed the
 * low-stock threshold. `changes` = [{ productId, variantId, name, before, after }].
 * Never throws; a failed alert must not fail the order that triggered it.
 */
export const alertLowStock = async (changes) => {
    try {
        const settings = await getSettings()
        const threshold = settings.low_stock_threshold
        const crossed = changes.filter((c) => c.before > threshold && c.after <= threshold)
        if (!crossed.length) return
        const recipients = await alertRecipients(settings)
        if (!recipients.length) return
        await publishInventoryEvent(INVENTORY_EVENTS.LOW_STOCK, {
            recipients,
            threshold,
            items: crossed.map((c) => ({ productId: c.productId, variantId: c.variantId ?? null, name: c.name, stock: c.after })),
            adminUrl: `${process.env.FRONTEND_URL}/admin`,
        })
    } catch (err) {
        console.error("[inventory] low-stock alert failed:", err.message)
    }
}

/**
 * After stock went from 0 to > 0: email everyone waiting on it, then mark them
 * notified so they get one email. Never throws.
 */
export const notifyBackInStock = async ({ productId, variantId = null }) => {
    try {
        const waiting = await prisma.stockNotification.findMany({
            where: { product_id: productId, variant_id: variantId, notified_at: null },
            include: { product: { select: { name: true, is_hidden: true } }, variant: { select: { name: true } } },
        })
        if (!waiting.length || waiting[0].product.is_hidden) return
        const name = waiting[0].variant ? `${waiting[0].product.name} (${waiting[0].variant.name})` : waiting[0].product.name
        // One message per customer: each email retries on its own if sending fails.
        for (const email of new Set(waiting.map((w) => w.email))) {
            await publishInventoryEvent(INVENTORY_EVENTS.BACK_IN_STOCK, {
                email,
                productName: name,
                productUrl: `${process.env.FRONTEND_URL}/products/${productId}`,
            })
        }
        await prisma.stockNotification.updateMany({
            where: { id: { in: waiting.map((w) => w.id) } },
            data: { notified_at: new Date() },
        })
    } catch (err) {
        console.error("[inventory] back-in-stock notification failed:", err.message)
    }
}
