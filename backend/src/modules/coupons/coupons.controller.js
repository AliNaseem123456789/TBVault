import prisma from "../../config/db.js"
import { parseCouponInput } from "./coupon.validation.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}

// Live = active, started and not expired, and not used up.
const couponState = (coupon, now = new Date()) => {
    if (!coupon.is_active) return "paused"
    if (coupon.starts_at && coupon.starts_at > now) return "scheduled"
    if (coupon.expires_at && coupon.expires_at <= now) return "expired"
    if (coupon.usage_limit != null && coupon.times_used >= coupon.usage_limit) return "used_up"
    return "live"
}

// GET /admin/coupons?search=SUMMER
export const listCoupons = async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""
    try {
        const coupons = await prisma.coupon.findMany({
            where: search ? { code: { contains: search, mode: "insensitive" } } : {},
            orderBy: { created_at: "desc" },
            include: { _count: { select: { redemptions: true } } },
        })
        const revenue = await prisma.couponRedemption.groupBy({ by: ["coupon_id"], _sum: { discount_amount: true } })
        const discountByCoupon = Object.fromEntries(revenue.map((r) => [r.coupon_id, r._sum.discount_amount]))
        return res.status(200).json({
            message: "Coupons fetched",
            data: {
                coupons: coupons.map((c) => ({ ...c, state: couponState(c), total_discount: discountByCoupon[c.id] ?? "0" })),
            },
        })
    } catch (err) {
        console.error("listCoupons error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// POST /admin/coupons
export const createCoupon = async (req, res) => {
    const { data, error } = parseCouponInput(req.body)
    if (error) return res.status(400).json({ message: error })
    try {
        const coupon = await prisma.coupon.create({ data })
        return res.status(201).json({ message: "Coupon created", data: { coupon } })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "A coupon with that code already exists" })
        console.error("createCoupon error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PUT /admin/coupons/:couponId
export const updateCoupon = async (req, res) => {
    const couponId = parseId(req.params.couponId)
    if (!couponId) return res.status(400).json({ message: "invalid coupon id" })
    try {
        const existing = await prisma.coupon.findUnique({ where: { id: couponId } })
        if (!existing) return res.status(404).json({ message: "Coupon not found" })
        const { data, error } = parseCouponInput(req.body, { partial: true, existing })
        if (error) return res.status(400).json({ message: error })
        // Changing what a used code means would rewrite history; make a new code instead.
        if (existing.times_used > 0 && (data.code !== undefined && data.code !== existing.code || data.type !== undefined && data.type !== existing.type)) {
            return res.status(409).json({ message: "This coupon has been used, so its code and type can't change. Create a new coupon instead." })
        }
        const coupon = await prisma.coupon.update({ where: { id: couponId }, data })
        return res.status(200).json({ message: "Coupon updated", data: { coupon } })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "A coupon with that code already exists" })
        console.error("updateCoupon error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /admin/coupons/:couponId/status   body: { is_active }  — pause / resume
export const setCouponStatus = async (req, res) => {
    const couponId = parseId(req.params.couponId)
    if (!couponId) return res.status(400).json({ message: "invalid coupon id" })
    if (typeof req.body.is_active !== "boolean") return res.status(400).json({ message: "is_active must be true or false" })
    try {
        const coupon = await prisma.coupon.update({ where: { id: couponId }, data: { is_active: req.body.is_active } })
        return res.status(200).json({ message: req.body.is_active ? "Coupon resumed" : "Coupon paused", data: { coupon } })
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Coupon not found" })
        console.error("setCouponStatus error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// DELETE /admin/coupons/:couponId — only unused coupons; used ones are paused to keep order history.
export const deleteCoupon = async (req, res) => {
    const couponId = parseId(req.params.couponId)
    if (!couponId) return res.status(400).json({ message: "invalid coupon id" })
    try {
        const used = await prisma.couponRedemption.count({ where: { coupon_id: couponId } })
        if (used > 0) return res.status(409).json({ message: "This coupon has been used. Pause it instead of deleting it." })
        await prisma.coupon.delete({ where: { id: couponId } })
        return res.status(204).send()
    } catch (err) {
        if (err.code === "P2025") return res.status(404).json({ message: "Coupon not found" })
        console.error("deleteCoupon error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /admin/coupons/:couponId/redemptions — who used it, on which order, for how much.
export const getCouponRedemptions = async (req, res) => {
    const couponId = parseId(req.params.couponId)
    if (!couponId) return res.status(400).json({ message: "invalid coupon id" })
    try {
        const coupon = await prisma.coupon.findUnique({ where: { id: couponId } })
        if (!coupon) return res.status(404).json({ message: "Coupon not found" })
        const redemptions = await prisma.couponRedemption.findMany({
            where: { coupon_id: couponId },
            orderBy: { created_at: "desc" },
            take: 200,
            include: { order: { select: { id: true, status: true, total_amount: true, created_at: true } } },
        })
        return res.status(200).json({ message: "Redemptions fetched", data: { coupon: { ...coupon, state: couponState(coupon) }, redemptions } })
    } catch (err) {
        console.error("getCouponRedemptions error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
