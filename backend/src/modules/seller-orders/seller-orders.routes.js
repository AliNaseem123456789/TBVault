import { Router } from "express";
import { requireSeller } from "../../middleware/seller.middleware.js";
import { listSellerOrders, getSellerOrder, updateSellerOrderStatus } from "./seller-orders.controller.js";

// A seller's share of customer orders (their items only).
const router = Router()

router.get("/seller/orders", requireSeller, listSellerOrders)
router.get("/seller/orders/:shipmentId", requireSeller, getSellerOrder)
router.patch("/seller/orders/:shipmentId/status", requireSeller, updateSellerOrderStatus)

export default router
