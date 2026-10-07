import prisma from "../../config/db.js"
import { parseAddressInput } from "./address.validation.js"

const MAX_ADDRESSES = 20

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

// GET /addresses — default first.
export const getAddresses = async (req, res) => {
    const userId = Number(req.user.sub)
    try {
        const addresses = await prisma.address.findMany({
            where: { user_id: userId },
            orderBy: [{ is_default: "desc" }, { created_at: "asc" }],
        })
        return res.status(200).json({ message: "Addresses fetched", data: { addresses } })
    } catch (err) {
        console.error("getAddresses error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /addresses — the first address becomes the default automatically.
export const createAddress = async (req, res) => {
    const userId = Number(req.user.sub)
    const { data, error } = parseAddressInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        const address = await prisma.$transaction(async (tx) => {
            const count = await tx.address.count({ where: { user_id: userId } })
            if (count >= MAX_ADDRESSES) throw new Error("TOO_MANY")
            const isDefault = count === 0 || data.is_default === true
            if (isDefault) await tx.address.updateMany({ where: { user_id: userId }, data: { is_default: false } })
            return tx.address.create({ data: { ...data, is_default: isDefault, user_id: userId } })
        })
        return res.status(201).json({ message: "Address saved", data: { address } })
    } catch (err) {
        if (err.message === "TOO_MANY") return res.status(400).json({ message: `You can save up to ${MAX_ADDRESSES} addresses` })
        console.error("createAddress error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PUT /addresses/:addressId
export const updateAddress = async (req, res) => {
    const userId = Number(req.user.sub)
    const addressId = parseId(req.params.addressId)
    if (!addressId) return res.status(400).json({ message: "invalid address id" })
    const { data, error } = parseAddressInput(req.body, { partial: true })
    if (error) return res.status(400).json({ message: error })
    try {
        const address = await prisma.$transaction(async (tx) => {
            const existing = await tx.address.findFirst({ where: { id: addressId, user_id: userId } })
            if (!existing) throw new Error("NOT_FOUND")
            // The only default can't be un-defaulted directly; make another one the default instead.
            if (data.is_default === false && existing.is_default) delete data.is_default
            if (data.is_default === true) await tx.address.updateMany({ where: { user_id: userId }, data: { is_default: false } })
            return tx.address.update({ where: { id: addressId }, data })
        })
        return res.status(200).json({ message: "Address updated", data: { address } })
    } catch (err) {
        if (err.message === "NOT_FOUND") return res.status(404).json({ message: "Address not found" })
        console.error("updateAddress error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /addresses/:addressId/default
export const setDefaultAddress = async (req, res) => {
    const userId = Number(req.user.sub)
    const addressId = parseId(req.params.addressId)
    if (!addressId) return res.status(400).json({ message: "invalid address id" })
    try {
        const existing = await prisma.address.findFirst({ where: { id: addressId, user_id: userId } })
        if (!existing) return res.status(404).json({ message: "Address not found" })
        await prisma.$transaction([
            prisma.address.updateMany({ where: { user_id: userId }, data: { is_default: false } }),
            prisma.address.update({ where: { id: addressId }, data: { is_default: true } }),
        ])
        return res.status(200).json({ message: "Default address updated" })
    } catch (err) {
        console.error("setDefaultAddress error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// DELETE /addresses/:addressId — deleting the default promotes the oldest remaining one.
export const deleteAddress = async (req, res) => {
    const userId = Number(req.user.sub)
    const addressId = parseId(req.params.addressId)
    if (!addressId) return res.status(400).json({ message: "invalid address id" })
    try {
        await prisma.$transaction(async (tx) => {
            const existing = await tx.address.findFirst({ where: { id: addressId, user_id: userId } })
            if (!existing) throw new Error("NOT_FOUND")
            await tx.address.delete({ where: { id: addressId } })
            if (existing.is_default) {
                const next = await tx.address.findFirst({ where: { user_id: userId }, orderBy: { created_at: "asc" } })
                if (next) await tx.address.update({ where: { id: next.id }, data: { is_default: true } })
            }
        })
        return res.status(204).send()
    } catch (err) {
        if (err.message === "NOT_FOUND") return res.status(404).json({ message: "Address not found" })
        console.error("deleteAddress error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
