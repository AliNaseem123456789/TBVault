import { Router } from "express";
import { authenticate, requireAdmin } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import {
    getWallet,
    startTopup,
    redeemCode,
    getCustomerCredits,
    adjustCustomerCredits,
    listGiftCards,
    createGiftCards,
    setGiftCardActive,
} from "./wallet.controller.js";

const router = Router()

// Guessing gift card codes: a handful of tries per user per hour.
const redeemLimiter = rateLimit({ name: "gift-card-redeem", max: 10, windowSec: 60 * 60, keyFn: (req) => `user:${req.user.sub}` })

// Customer
router.get("/wallet", authenticate, getWallet)
router.post("/wallet/topup", authenticate, startTopup)
router.post("/wallet/redeem", authenticate, redeemLimiter, redeemCode)

// Admin
router.get("/admin/customers/:userId/credits", requireAdmin, getCustomerCredits)
router.post("/admin/customers/:userId/credits", requireAdmin, adjustCustomerCredits)
router.get("/admin/gift-cards", requireAdmin, listGiftCards)
router.post("/admin/gift-cards", requireAdmin, createGiftCards)
router.patch("/admin/gift-cards/:giftCardId", requireAdmin, setGiftCardActive)

export default router
