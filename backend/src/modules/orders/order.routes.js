import { Router } from "express";
import { authenticate, requireAdmin } from "../../middleware/auth.middleware.js";
import { createOrder, getOrders, getOrderById, cancelOrder, listAllOrders, updateOrderStatus } from "./order.controller.js";

const router = Router()

router.post("/order", authenticate, createOrder)
router.get("/order", authenticate, getOrders)
router.get("/order-details/:order_id", authenticate, getOrderById)
router.post("/orders/:orderId/cancel", authenticate, cancelOrder)

router.get("/admin/orders", requireAdmin, listAllOrders)
router.patch("/admin/orders/:orderId/status", requireAdmin, updateOrderStatus)

export default router
