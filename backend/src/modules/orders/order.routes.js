import { authenticate } from "../../middleware/auth.middleware.js";
import { createOrder,getOrders, getOrderById,cancelOrder } from "./order.controller.js";
import { Router } from "express";
const router=Router()

router.post("/order",authenticate,createOrder)
router.get("/order",authenticate,getOrders)
router.get("/order-details/:order_id",authenticate,getOrderById)
router.post("/orders/:orderId/cancel", authenticate, cancelOrder)
export default router

