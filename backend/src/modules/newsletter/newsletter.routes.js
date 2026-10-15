import { Router } from "express";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import { subscribe } from "./newsletter.controller.js";

const router = Router()

const newsletterLimiter = rateLimit({ name: "newsletter", max: 10, windowSec: 60 * 60 })

router.post("/newsletter", newsletterLimiter, subscribe)

export default router
