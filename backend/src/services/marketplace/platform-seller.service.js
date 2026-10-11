import prisma from "../../config/db.js"
import { getSettings } from "../settings/settings.service.js"

/**
 * The store's own seller account, which owns everything the store sells itself.
 * The migration creates it; this recreates it on a database that lacks one (tests, fresh installs).
 */
export const ensurePlatformSeller = async (db = prisma) => {
    const existing = await db.seller.findFirst({ where: { is_platform: true } })
    if (existing) return existing
    const { store_name } = await getSettings(db)
    return db.seller.create({
        data: {
            store_name: store_name || "TBVault",
            slug: "official-store",
            description: "Products sold and shipped by the store itself.",
            status: "APPROVED",
            is_platform: true,
            commission_rate: 0,
            approved_at: new Date(),
        },
    })
}
