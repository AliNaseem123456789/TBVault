import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { getVariantsAdmin, createVariant, updateVariant, deleteVariant } from "./variants.controller.js";

// Customers see active variants on GET /products/:id; these routes are for managing them.
const router = Router()

router.get("/admin/products/:productId/variants", requireAdmin, getVariantsAdmin)
router.post("/products/:productId/variants", requireAdmin, createVariant)
router.put("/variants/:variantId", requireAdmin, updateVariant)
router.delete("/variants/:variantId", requireAdmin, deleteVariant)

export default router
