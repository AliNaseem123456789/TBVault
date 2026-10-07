import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { exportOrders, exportProducts } from "./exports.controller.js";

const router = Router()

router.get("/admin/exports/orders.csv", requireAdmin, exportOrders)
router.get("/admin/exports/products.csv", requireAdmin, exportProducts)

export default router
