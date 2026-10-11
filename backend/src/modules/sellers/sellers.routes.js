import { Router } from "express";
import { authenticate, requireAdmin } from "../../middleware/auth.middleware.js";
import { requireSeller } from "../../middleware/seller.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import {
    applyAsSeller,
    getMySeller,
    updateMySeller,
    getSellerDashboard,
    getSellerTransactions,
    listStores,
    getStore,
    listSellers,
    getSellerAdmin,
    setSellerStatus,
    updateSellerAdmin,
    createPayout,
    getSellerTransactionsAdmin,
} from "./sellers.controller.js";

const router = Router()

const applyLimiter = rateLimit({ name: "seller-apply", max: 5, windowSec: 60 * 60, keyFn: (req) => `user:${req.user.sub}` })

// Public store pages
router.get("/stores", listStores)
router.get("/stores/:slug", getStore)

// Any signed-in customer
router.post("/seller/apply", authenticate, applyLimiter, applyAsSeller)
router.get("/seller/me", authenticate, getMySeller)

// Approved sellers
router.patch("/seller/me", requireSeller, updateMySeller)
router.get("/seller/dashboard", requireSeller, getSellerDashboard)
router.get("/seller/transactions", requireSeller, getSellerTransactions)

// Admin
router.get("/admin/sellers", requireAdmin, listSellers)
router.get("/admin/sellers/:sellerId", requireAdmin, getSellerAdmin)
router.patch("/admin/sellers/:sellerId", requireAdmin, updateSellerAdmin)
router.patch("/admin/sellers/:sellerId/status", requireAdmin, setSellerStatus)
router.post("/admin/sellers/:sellerId/payouts", requireAdmin, createPayout)
router.get("/admin/sellers/:sellerId/transactions", requireAdmin, getSellerTransactionsAdmin)

export default router
