import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { listCoupons, createCoupon, updateCoupon, setCouponStatus, deleteCoupon, getCouponRedemptions } from "./coupons.controller.js";

// Customers apply coupons through POST /order/quote and POST /order (coupon_code).
const router = Router()

router.get("/admin/coupons", requireAdmin, listCoupons)
router.post("/admin/coupons", requireAdmin, createCoupon)
router.put("/admin/coupons/:couponId", requireAdmin, updateCoupon)
router.patch("/admin/coupons/:couponId/status", requireAdmin, setCouponStatus)
router.delete("/admin/coupons/:couponId", requireAdmin, deleteCoupon)
router.get("/admin/coupons/:couponId/redemptions", requireAdmin, getCouponRedemptions)

export default router
