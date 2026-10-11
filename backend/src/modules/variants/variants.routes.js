import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { requireSeller, ownsProduct, ownsVariant } from "../../middleware/seller.middleware.js";
import { getVariantsAdmin, createVariant, updateVariant, deleteVariant } from "./variants.controller.js";

// Customers see active variants on GET /products/:id; these routes are for managing them.
const router = Router()

router.get("/admin/products/:productId/variants", requireAdmin, getVariantsAdmin)
router.post("/products/:productId/variants", requireAdmin, createVariant)
router.put("/variants/:variantId", requireAdmin, updateVariant)
router.delete("/variants/:variantId", requireAdmin, deleteVariant)

// Sellers: only on their own products
router.get("/seller/products/:productId/variants", requireSeller, ownsProduct("productId"), getVariantsAdmin)
router.post("/seller/products/:productId/variants", requireSeller, ownsProduct("productId"), createVariant)
router.put("/seller/variants/:variantId", requireSeller, ownsVariant, updateVariant)
router.delete("/seller/variants/:variantId", requireSeller, ownsVariant, deleteVariant)

export default router
