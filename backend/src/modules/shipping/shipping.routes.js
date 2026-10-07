import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { listShippingZones, createShippingZone, updateShippingZone, deleteShippingZone } from "./shipping.controller.js";

// Customers see shipping cost through POST /order/quote.
const router = Router()

router.get("/admin/shipping-zones", requireAdmin, listShippingZones)
router.post("/admin/shipping-zones", requireAdmin, createShippingZone)
router.put("/admin/shipping-zones/:zoneId", requireAdmin, updateShippingZone)
router.delete("/admin/shipping-zones/:zoneId", requireAdmin, deleteShippingZone)

export default router
