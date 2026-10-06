import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import {
    getProductReviews,
    getReviewEligibility,
    createReview,
    updateReview,
    deleteReview,
    getFeaturedReviews,
} from "./reviews.controller.js";

const router = Router()

router.get("/reviews/featured", getFeaturedReviews)
router.get("/products/:productId/reviews", getProductReviews)
router.get("/products/:productId/reviews/eligibility", authenticate, getReviewEligibility)
router.post("/products/:productId/reviews", authenticate, createReview)
router.patch("/reviews/:reviewId", authenticate, updateReview)
router.delete("/reviews/:reviewId", authenticate, deleteReview)

export default router
