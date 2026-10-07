import { Router } from "express";
import { authenticate, requireAdmin } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import {
    createReturn,
    createReturnByToken,
    getOrderReturns,
    listReturns,
    updateReturnStatus,
    refundReturn,
} from "./returns.controller.js";

const router = Router()

const returnLimiter = rateLimit({ name: "returns", max: 10, windowSec: 60 * 60 })

router.get("/orders/:orderId/returns", authenticate, getOrderReturns)
router.post("/orders/:orderId/returns", authenticate, returnLimiter, createReturn)
router.post("/order/track/:token/returns", returnLimiter, createReturnByToken)

router.get("/admin/returns", requireAdmin, listReturns)
router.patch("/admin/returns/:returnId", requireAdmin, updateReturnStatus)
router.post("/admin/returns/:returnId/refund", requireAdmin, refundReturn)

export default router
