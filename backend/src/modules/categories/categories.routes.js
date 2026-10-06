import { createCategories,
    getCategories,
    getCategoriesById,
    updateCategoryName,
    deleteCategory,
    getProductsByCategory

} from "./categories.controller.js";
import { Router } from "express";
const router=Router()

router.post("/categories",createCategories)
router.get("/categories",getCategories)
router.get("/categories/:id",getCategoriesById)
router.put("/categories/:id",updateCategoryName)
router.delete("/categories/:id",deleteCategory)
router.get("/categories/:id/products",getProductsByCategory)

export default router

