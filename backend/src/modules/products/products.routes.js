import upload from "../../middleware/upload.middleware.js";
import { createProducts,getProductsById,updateProductsById,deleteProducts,getProductsByCategory,productUpload } from "./products.controller.js";
import { Router } from "express";
const router=Router()

router.post("/products",createProducts)
// router.post("/products/:productId/image",upload.single("image"),productUpload)
router.post("/products/:productId/image",upload.array("image",6),productUpload)
router.post("/products",createProducts)
router.get("/products",getProductsByCategory)
router.get("/products/:id",getProductsById)
router.put("/products/:id",updateProductsById)
router.delete("/products/:id",deleteProducts)

export default router

