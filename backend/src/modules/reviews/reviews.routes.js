import { Router } from "express";
import { authenticate, requireAdmin } from "../../middleware/auth.middleware.js";
import { rateLimit } from "../../middleware/rateLimiter.middleware.js";
import {
    getProductReviews,
    getReviewEligibility,
    createReview,
    updateReview,
    deleteReview,
    getFeaturedReviews,
    listReviewsAdmin,
    setReviewVisibility,
} from "./reviews.controller.js";

const router = Router()

router.get("/reviews/featured", getFeaturedReviews)
router.get("/products/:productId/reviews", getProductReviews)
router.get("/products/:productId/reviews/eligibility", authenticate, getReviewEligibility)
router.post("/products/:productId/reviews", authenticate, rateLimit({ name: "review", max: 20, windowSec: 60 * 60, keyFn: (req) => req.user?.sub }), createReview)
router.patch("/reviews/:reviewId", authenticate, updateReview)
router.delete("/reviews/:reviewId", authenticate, deleteReview)

router.get("/admin/reviews", requireAdmin, listReviewsAdmin)
router.patch("/admin/reviews/:reviewId/visibility", requireAdmin, setReviewVisibility)

export default router
