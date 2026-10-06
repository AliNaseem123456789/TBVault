import { authenticate } from "../../middleware/auth.middleware.js";
import { getCartItems, addCartItems,updateCartItems,deleteCart,deleteCartItems } from "./cart.controller.js";
import { Router } from "express";
const router=Router()

router.post("/cart/items",authenticate,addCartItems)
router.get("/cart",authenticate,getCartItems)
router.patch("/cart/items/:productId",authenticate,updateCartItems)
router.delete("/cart",authenticate,deleteCart)
router.delete("/cart/items/:productId",authenticate,deleteCartItems)
// router.post("/products",createProducts)
// router.get("/products",getProductsByCategory)


export default router

