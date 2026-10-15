import { Router } from "express";
import { optionalAuthenticate } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import { createContactMessage, getTopics } from "./contact.controller.js";

const router = Router()

const contactLimiter = rateLimit({ name: "contact", max: 5, windowSec: 60 * 60 })

router.get("/contact/topics", getTopics)
router.post("/contact", contactLimiter, optionalAuthenticate, createContactMessage)

export default router
