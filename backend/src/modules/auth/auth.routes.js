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
import { loginRateLimiter } from "../../middleware/rateLimiter.middleware.js"

const router = Router()

router.post("/register", register)
router.post("/login", loginRateLimiter, login)
router.post("/logout", logout)
router.post("/logout-all", logoutAll)
router.post("/refresh", refresh)

router.post("/forgot-password", forgotPassword)
router.post("/reset-password", resetPassword)
router.post("/verify-email", authenticate, verifyEmail)
router.post("/confirm-email", confirmEmail)

router.get("/me", authenticate, me)
router.patch("/me", authenticate, updateMe)
router.post("/change-password", authenticate, changePassword)

router.get("/google", googleAuth)
router.get("/google/callback", googleCallback)

export default router
