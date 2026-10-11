import { Router } from "express";
import upload, { handleUpload } from "../../middleware/upload.middleware.js";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { requireSeller, ownsProduct } from "../../middleware/seller.middleware.js";
import {
    createProducts,
    getProductsById,
    updateProductsById,
    deleteProducts,
    getProductsByCategory,
    productUpload,
    getProductsAdmin,
    getProductsSeller,
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

// Sellers: the same actions, limited to their own products (others answer 404)
router.get("/seller/products", requireSeller, getProductsSeller)
router.post("/seller/products", requireSeller, createProducts)
router.get("/seller/products/:id", requireSeller, ownsProduct("id"), getProductByIdAdmin)
router.put("/seller/products/:id", requireSeller, ownsProduct("id"), updateProductsById)
router.delete("/seller/products/:id", requireSeller, ownsProduct("id"), deleteProducts)
router.post("/seller/products/:productId/image", requireSeller, ownsProduct("productId"), handleUpload(upload.array("image", 6)), productUpload)
router.delete("/seller/products/:productId/images/:imageId", requireSeller, ownsProduct("productId"), deleteProductImage)
router.patch("/seller/products/:productId/images/:imageId/primary", requireSeller, ownsProduct("productId"), setPrimaryImage)

export default router
