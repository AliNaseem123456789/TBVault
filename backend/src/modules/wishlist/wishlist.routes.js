import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { getWishlist, addWishlistItem, removeWishlistItem } from "./wishlist.controller.js";

const router = Router()

router.get("/wishlist", authenticate, getWishlist)
router.post("/wishlist/items", authenticate, addWishlistItem)
router.delete("/wishlist/items/:productId", authenticate, removeWishlistItem)

export default router
