import prisma from "../../config/db.js"
import { getSettings, getPublicSettings, parseSettingsInput, saveSettings } from "../../services/settings/settings.service.js"
import { isCardPaymentEnabled } from "../../config/stripe.js"

// GET /store/config — what the storefront needs: store info, tax rate, whether cards work,
// and the cheapest free-shipping threshold for the "free shipping over $X" banner.
export const getStoreConfig = async (req, res) => {
    try {
        const settings = await getPublicSettings()
        const zones = await prisma.shippingZone.findMany({ orderBy: [{ is_default: "asc" }, { name: "asc" }] })
        const defaultZone = zones.find((z) => z.is_default)
        return res.status(200).json({
            message: "Store config",
            data: {
                ...settings,
                card_payments_enabled: isCardPaymentEnabled(),
                free_shipping_over: defaultZone?.free_over ?? null,
                // For the Shipping & returns page (the same rates checkout charges).
                shipping_zones: zones.map((z) => ({
                    name: z.name,
                    regions: z.regions,
                    rate: Number(z.rate).toFixed(2),
                    free_over: z.free_over === null ? null : Number(z.free_over).toFixed(2),
                    is_default: z.is_default,
                })),
            },
        })
    } catch (err) {
        console.error("getStoreConfig error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /admin/settings
export const getAdminSettings = async (req, res) => {
    try {
        return res.status(200).json({ message: "Settings", data: { settings: await getSettings(), card_payments_enabled: isCardPaymentEnabled() } })
    } catch (err) {
        console.error("getAdminSettings error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PUT /admin/settings   body: any subset of the settings
export const updateAdminSettings = async (req, res) => {
    const { data, error } = parseSettingsInput(req.body)
    if (error) return res.status(400).json({ message: error })
    if (Object.keys(data).length === 0) return res.status(400).json({ message: "nothing to update" })
    try {
        return res.status(200).json({ message: "Settings saved", data: { settings: await saveSettings(data) } })
    } catch (err) {
        console.error("updateAdminSettings error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
