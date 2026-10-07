import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { getAddresses, createAddress, updateAddress, setDefaultAddress, deleteAddress } from "./addresses.controller.js";

const router = Router()

router.get("/addresses", authenticate, getAddresses)
router.post("/addresses", authenticate, createAddress)
router.put("/addresses/:addressId", authenticate, updateAddress)
router.patch("/addresses/:addressId/default", authenticate, setDefaultAddress)
router.delete("/addresses/:addressId", authenticate, deleteAddress)

export default router
