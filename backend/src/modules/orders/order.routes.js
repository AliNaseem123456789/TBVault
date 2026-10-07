import { Router } from "express";
import { authenticate, optionalAuthenticate, requireAdmin } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import {
    createOrder,
    createGuestOrder,
    quoteOrder,
    getOrders,
    getOrderById,
    cancelOrder,
    getOrderByToken,
    lookupOrder,
    cancelOrderByToken,
    listAllOrders,
    getOrderAdmin,
    updateOrderStatus,
    updateOrderTracking,
} from "./order.controller.js";

const router = Router()

const guestOrderLimiter = rateLimit({ name: "guest-order", max: 10, windowSec: 60 * 60 })
const trackLookupLimiter = rateLimit({ name: "order-track", max: 20, windowSec: 15 * 60 })

router.post("/order/quote", optionalAuthenticate, quoteOrder)
router.post("/order", authenticate, createOrder)
router.post("/order/guest", guestOrderLimiter, createGuestOrder)
router.get("/order", authenticate, getOrders)
router.get("/order-details/:order_id", authenticate, getOrderById)
router.post("/orders/:orderId/cancel", authenticate, cancelOrder)

// Tracking without an account
router.post("/order/track", trackLookupLimiter, lookupOrder)
router.get("/order/track/:token", getOrderByToken)
router.post("/order/track/:token/cancel", cancelOrderByToken)

// Admin
router.get("/admin/orders", requireAdmin, listAllOrders)
router.get("/admin/orders/:orderId", requireAdmin, getOrderAdmin)
router.patch("/admin/orders/:orderId/status", requireAdmin, updateOrderStatus)
router.patch("/admin/orders/:orderId/tracking", requireAdmin, updateOrderTracking)

export default router
