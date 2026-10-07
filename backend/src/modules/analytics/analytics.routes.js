import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import { getSalesDashboard, recordVisit } from "./analytics.controller.js";

const router = Router()

router.post("/analytics/visits", rateLimit({ name: "visits", max: 60, windowSec: 60 * 60 }), recordVisit)
router.get("/admin/analytics", requireAdmin, getSalesDashboard)

export default router
