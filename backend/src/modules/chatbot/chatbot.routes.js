import { Router } from "express";
import { optionalAuthenticate } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import upload, { handleUpload } from "../../middleware/upload.middleware.js";
import { sendChatMessage, sendChatImage, smartSearch, imageSearch } from "./chatbot.controller.js";

const router = Router()

// Guests can chat too. Signed-in customers are limited per account, guests per IP.
const perVisitor = (req) => (req.user ? `user:${req.user.sub}` : req.ip)
const chatLimit = rateLimit({ name: "chatbot", max: 20, windowSec: 60, keyFn: perVisitor,
    message: "You're sending messages too fast. Please wait a minute." })
const searchLimit = rateLimit({ name: "smart-search", max: 60, windowSec: 60, keyFn: perVisitor })

router.post("/chat", optionalAuthenticate, chatLimit, sendChatMessage)
router.post("/chat/image", optionalAuthenticate, chatLimit, handleUpload(upload.single("image")), sendChatImage)
router.get("/search/smart", optionalAuthenticate, searchLimit, smartSearch)
router.post("/search/image", optionalAuthenticate, searchLimit, handleUpload(upload.single("image")), imageSearch)

export default router
