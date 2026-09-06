import { Router } from "express"
import { test } from "../controller/auth.controller.js"
import { register,login,logout,logoutAll,refresh } from "../controller/auth.controller.js"
import { authenticate,authorize } from "../middleware/auth.middleware.js"
const router = Router()
router.get("/test",authenticate,authorize("CUSTOMER"),test)
router.get("/test1",authenticate,test)
router.post("/register",register)
router.post("/login",login)
router.post("/logout",logout)
router.post("/logout-all",logoutAll)
router.post("/refresh",refresh)
export default router