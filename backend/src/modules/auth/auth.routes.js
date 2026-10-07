import { Router } from "express"
import {
    register,
    login,
    logout,
    logoutAll,
    refresh,
    forgotPassword,
    resetPassword,
    verifyEmail,
    confirmEmail,
    googleAuth,
    googleCallback,
    me,
    updateMe,
    changePassword,
} from "./auth.controller.js"
import { authenticate } from "../../middleware/auth.middleware.js"
import { loginRateLimiter, rateLimit } from "../../middleware/rateLimiter.middleware.js"

const router = Router()

router.post("/register", register)
router.post("/login", loginRateLimiter, login)
router.post("/logout", logout)
router.post("/logout-all", logoutAll)
router.post("/refresh", refresh)

// Per email (stops someone flooding one inbox) and per IP (stops sweeping many addresses).
const forgotPasswordLimiters = [
    rateLimit({ name: "forgot-password-ip", max: 10, windowSec: 60 * 60 }),
    rateLimit({ name: "forgot-password-email", max: 3, windowSec: 60 * 60, keyFn: (req) => typeof req.body?.email === "string" ? req.body.email.trim() : null }),
]
const verifyEmailLimiter = rateLimit({ name: "verify-email", max: 5, windowSec: 60 * 60, keyFn: (req) => req.user?.sub })

router.post("/forgot-password", forgotPasswordLimiters, forgotPassword)
router.post("/reset-password", resetPassword)
router.post("/verify-email", authenticate, verifyEmailLimiter, verifyEmail)
router.post("/confirm-email", confirmEmail)

router.get("/me", authenticate, me)
router.patch("/me", authenticate, updateMe)
router.post("/change-password", authenticate, changePassword)

router.get("/google", googleAuth)
router.get("/google/callback", googleCallback)

export default router
