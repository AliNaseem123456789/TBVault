import { Router } from "express";
import { authenticate, requireAdmin } from "../../middleware/auth.middleware.js";
import { payOrder, payOrderByToken, stripeWebhook, refundOrder, rawJson } from "./payments.controller.js";

// Mounted before express.json() in app.js: Stripe's signature covers the raw body.
export const stripeWebhookRouter = Router()
stripeWebhookRouter.post("/payments/webhook", rawJson, stripeWebhook)

const router = Router()

router.post("/orders/:orderId/pay", authenticate, payOrder)
router.post("/order/track/:token/pay", payOrderByToken)
router.post("/admin/orders/:orderId/refunds", requireAdmin, refundOrder)

export default router
