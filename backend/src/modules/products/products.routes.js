import { Router } from "express";
import upload, { handleUpload } from "../../middleware/upload.middleware.js";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import {
    createProducts,
    getProductsById,
    updateProductsById,
    deleteProducts,
    getProductsByCategory,
    productUpload,
    getProductsAdmin,
    getProductByIdAdmin,
    deleteProductImage,
    setPrimaryImage,
    getRelatedProducts,
} from "./products.controller.js";

const router = Router()

// Public storefront (hidden products are filtered out)
router.get("/products", getProductsByCategory)
router.get("/products/:id", getProductsById)
router.get("/products/:id/related", getRelatedProducts)

// Admin only
router.get("/admin/products", requireAdmin, getProductsAdmin)
router.get("/admin/products/:id", requireAdmin, getProductByIdAdmin)
router.post("/products", requireAdmin, createProducts)
router.put("/products/:id", requireAdmin, updateProductsById)
router.delete("/products/:id", requireAdmin, deleteProducts)
router.post("/products/:productId/image", requireAdmin, handleUpload(upload.array("image", 6)), productUpload)
router.delete("/products/:productId/images/:imageId", requireAdmin, deleteProductImage)
router.patch("/products/:productId/images/:imageId/primary", requireAdmin, setPrimaryImage)

export default router
