import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { getBrands, createBrand, updateBrand, deleteBrand } from "./brands.controller.js";

const router = Router()

router.get("/brands", getBrands)
router.post("/admin/brands", requireAdmin, createBrand)
router.put("/admin/brands/:brandId", requireAdmin, updateBrand)
router.delete("/admin/brands/:brandId", requireAdmin, deleteBrand)

export default router
