import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { listSales, createSale, updateSale, deleteSale } from "./sales.controller.js";

// Sale prices show up on products automatically (sale_price / sale_percent on GET /products).
const router = Router()

router.get("/admin/sales", requireAdmin, listSales)
router.post("/admin/sales", requireAdmin, createSale)
router.put("/admin/sales/:saleId", requireAdmin, updateSale)
router.delete("/admin/sales/:saleId", requireAdmin, deleteSale)

export default router
