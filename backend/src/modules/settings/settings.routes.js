import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { getStoreConfig, getAdminSettings, updateAdminSettings } from "./settings.controller.js";

const router = Router()

router.get("/store/config", getStoreConfig)
router.get("/admin/settings", requireAdmin, getAdminSettings)
router.put("/admin/settings", requireAdmin, updateAdminSettings)

export default router
