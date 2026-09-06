import { Router } from "express"
import { test} from "./auth.controller.js"
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
    googleCallback
} from "./auth.controller.js"
import { authenticate,authorize } from "../../middleware/auth.middleware.js"
import { loginRateLimiter } from "../../middleware/rateLimiter.middleware.js"
const router = Router()
router.get("/test",authenticate,authorize("CUSTOMER"),test)
// router.get("/login/test",test)
router.get("/test1",authenticate,test)
router.post("/register",register)
router.post("/login",loginRateLimiter,login)
router.post("/logout",logout)
router.post("/logout-all",logoutAll)
router.post("/forgot-password",forgotPassword)
router.post("/reset-password",resetPassword)
router.post("/verify-email",authenticate,verifyEmail)
router.post("/confirm-email",confirmEmail)
router.post("/refresh",refresh)
router.get("/google", googleAuth)
router.get("/google/callback", googleCallback)
export default router