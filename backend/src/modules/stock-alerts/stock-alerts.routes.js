import { Router } from "express";
import { optionalAuthenticate } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import { createStockAlert } from "./stock-alerts.controller.js";

const router = Router()

const stockAlertLimiter = rateLimit({ name: "stock-alert", max: 20, windowSec: 60 * 60 })

router.post("/products/:productId/stock-alerts", stockAlertLimiter, optionalAuthenticate, createStockAlert)

export default router
