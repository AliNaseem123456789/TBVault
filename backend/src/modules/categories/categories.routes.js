import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import {
    createCategories,
    getCategories,
    getCategoriesById,
    updateCategoryName,
    deleteCategory,
    getProductsByCategory,
} from "./categories.controller.js";

const router = Router()

router.get("/categories", getCategories)
router.get("/categories/:id", getCategoriesById)
router.get("/categories/:id/products", getProductsByCategory)

router.post("/categories", requireAdmin, createCategories)
router.put("/categories/:id", requireAdmin, updateCategoryName)
router.delete("/categories/:id", requireAdmin, deleteCategory)

export default router
