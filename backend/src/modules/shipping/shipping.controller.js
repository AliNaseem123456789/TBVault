import prisma from "../../config/db.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

// Validates a shipping zone body. Regions are stored lower-case so matching is case-insensitive.
const parseZoneInput = (body = {}, { partial = false } = {}) => {
    const data = {}
    const has = (k) => body[k] !== undefined
    if (has("name") || !partial) {
        const name = typeof body.name === "string" ? body.name.trim() : ""
        if (!name || name.length > 100) return { error: "name must be 1-100 characters" }
        data.name = name
    }
    if (has("regions") || !partial) {
        const regions = body.regions ?? []
        if (!Array.isArray(regions) || regions.length > 200 || regions.some((r) => typeof r !== "string" || !r.trim() || r.length > 100)) {
            return { error: "regions must be a list of city, state or country names" }
        }
        data.regions = [...new Set(regions.map((r) => r.trim().toLowerCase()))]
    }
    if (has("rate") || !partial) {
        const rate = Number(body.rate)
        if (!Number.isFinite(rate) || rate < 0) return { error: "rate must be a number of 0 or more" }
        data.rate = rate
    }
    if (has("free_over")) {
        if (body.free_over === null || body.free_over === "") data.free_over = null
        else {
            const freeOver = Number(body.free_over)
            if (!Number.isFinite(freeOver) || freeOver < 0) return { error: "free_over must be a number of 0 or more" }
            data.free_over = freeOver
        }
    }
    if (has("is_default")) {
        if (typeof body.is_default !== "boolean") return { error: "is_default must be true or false" }
        data.is_default = body.is_default
    }
    return { data }
}

// GET /admin/shipping-zones
export const listShippingZones = async (req, res) => {
    try {
        const zones = await prisma.shippingZone.findMany({ orderBy: [{ is_default: "desc" }, { id: "asc" }] })
        return res.status(200).json({ message: "Shipping zones fetched", data: { zones } })
    } catch (err) {
        console.error("listShippingZones error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /admin/shipping-zones   body: { name, regions[], rate, free_over?, is_default? }
export const createShippingZone = async (req, res) => {
    const { data, error } = parseZoneInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        const zone = await prisma.$transaction(async (tx) => {
            // Only one default zone.
            if (data.is_default) await tx.shippingZone.updateMany({ data: { is_default: false } })
            return tx.shippingZone.create({ data })
        })
        return res.status(201).json({ message: "Shipping zone created", data: { zone } })
    } catch (err) {
        console.error("createShippingZone error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PUT /admin/shipping-zones/:zoneId
export const updateShippingZone = async (req, res) => {
    const zoneId = parseId(req.params.zoneId)
    if (!zoneId) return res.status(400).json({ message: "invalid zone id" })
    const { data, error } = parseZoneInput(req.body, { partial: true })
    if (error) return res.status(400).json({ message: error })
    try {
        const zone = await prisma.$transaction(async (tx) => {
            if (data.is_default) await tx.shippingZone.updateMany({ where: { id: { not: zoneId } }, data: { is_default: false } })
            return tx.shippingZone.update({ where: { id: zoneId }, data })
        })
        return res.status(200).json({ message: "Shipping zone updated", data: { zone } })
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Shipping zone not found" })
        console.error("updateShippingZone error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// DELETE /admin/shipping-zones/:zoneId
export const deleteShippingZone = async (req, res) => {
    const zoneId = parseId(req.params.zoneId)
    if (!zoneId) return res.status(400).json({ message: "invalid zone id" })
    try {
        await prisma.shippingZone.delete({ where: { id: zoneId } })
        return res.status(204).send()
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Shipping zone not found" })
        console.error("deleteShippingZone error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
