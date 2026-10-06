import prisma from "../../config/db.js"
import { parseReviewInput } from "./review.validation.js"

const parseId = (value) => {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? id : null
}


const REVIEW_SELECT = {
    id: true,
    rating: true,
    comment: true,
    created_at: true,
    updated_at: true,
    user_id: true,
    user: { select: { name: true } },
}

// GET /products/:productId/reviews?page=1&limit=10
export const getProductReviews = async (req, res) => {
    const productId = parseId(req.params.productId)
    if (!productId) return res.status(400).json({ message: "invalid product id" })
    const page = req.query.page !== undefined ? Number(req.query.page) : 1
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 10
    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: "invalid page" })
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return res.status(400).json({ message: "invalid limit" })

    try {
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { is_hidden: true } })
        if (!product || product.is_hidden) return res.status(404).json({ message: "Product not found" })

        const [reviews, stats, breakdown] = await Promise.all([
            prisma.review.findMany({
                where: { product_id: productId },
                orderBy: { created_at: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                select: REVIEW_SELECT,
            }),
            prisma.review.aggregate({ where: { product_id: productId }, _avg: { rating: true }, _count: true }),
            prisma.review.groupBy({ by: ["rating"], where: { product_id: productId }, _count: true }),
        ])

        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
        for (const row of breakdown) distribution[row.rating] = row._count

        const totalItems = stats._count
        const totalPages = Math.ceil(totalItems / limit)
        return res.status(200).json({
            message: "Reviews fetched",
            data: {
                reviews,
                summary: {
                    average: stats._avg.rating ? Number(stats._avg.rating.toFixed(1)) : null,
                    count: totalItems,
                    distribution,
                },
            },
            metaData: { totalPages, currentPage: page, hasNext: totalPages > page, hasPrev: page > 1, itemsPerPage: limit, totalItems },
        })
    } catch (err) {
        console.error("getProductReviews error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /products/:productId/reviews/eligibility  (logged in)
// Tells the product page whether to show the review form, and the user's existing review if any.
export const getReviewEligibility = async (req, res) => {
    const productId = parseId(req.params.productId)
    const userId = Number(req.user.sub)
    if (!productId) return res.status(400).json({ message: "invalid product id" })
    try {
        const [purchased, existing] = await Promise.all([
            hasPurchased(userId, productId),
            prisma.review.findUnique({
                where: { product_id_user_id: { product_id: productId, user_id: userId } },
                select: REVIEW_SELECT,
            }),
        ])
        return res.status(200).json({ data: { canReview: purchased && !existing, purchased, review: existing } })
    } catch (err) {
        console.error("getReviewEligibility error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// A user may review a product once they have a non-cancelled order containing it.
const hasPurchased = async (userId, productId) => {
    const item = await prisma.orderItem.findFirst({
        where: { product_id: productId, order: { user_id: userId, status: { not: "cancelled" } } },
        select: { id: true },
    })
    return Boolean(item)
}

// POST /products/:productId/reviews   body: { rating, comment? }
export const createReview = async (req, res) => {
    const productId = parseId(req.params.productId)
    const userId = Number(req.user.sub)
    if (!productId) return res.status(400).json({ message: "invalid product id" })

    const { data, error } = parseReviewInput(req.body)
    if (error) return res.status(400).json({ message: error })

    try {
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { is_hidden: true } })
        if (!product || product.is_hidden) return res.status(404).json({ message: "Product not found" })

        if (!(await hasPurchased(userId, productId))) {
            return res.status(403).json({ message: "You can review products you've ordered" })
        }

        const review = await prisma.review.create({
            data: { ...data, product_id: productId, user_id: userId },
            select: REVIEW_SELECT,
        })
        return res.status(201).json({ message: "Review posted", data: { review } })
    } catch (err) {
        if (err.code === "P2002") return res.status(409).json({ message: "You've already reviewed this product. Edit your review instead." })
        console.error("createReview error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// PATCH /reviews/:reviewId   body: { rating?, comment? }  (author only)
export const updateReview = async (req, res) => {
    const reviewId = parseId(req.params.reviewId)
    const userId = Number(req.user.sub)
    if (!reviewId) return res.status(400).json({ message: "invalid review id" })

    const { data, error } = parseReviewInput(req.body, { partial: true })
    if (error) return res.status(400).json({ message: error })
    if (Object.keys(data).length === 0) return res.status(400).json({ message: "nothing to update" })

    try {
        const existing = await prisma.review.findUnique({ where: { id: reviewId }, select: { user_id: true } })
        if (!existing) return res.status(404).json({ message: "Review not found" })
        if (existing.user_id !== userId) return res.status(403).json({ message: "You can only edit your own review" })

        const review = await prisma.review.update({ where: { id: reviewId }, data, select: REVIEW_SELECT })
        return res.status(200).json({ message: "Review updated", data: { review } })
    } catch (err) {
        console.error("updateReview error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// DELETE /reviews/:reviewId  (author or admin)
export const deleteReview = async (req, res) => {
    const reviewId = parseId(req.params.reviewId)
    const userId = Number(req.user.sub)
    if (!reviewId) return res.status(400).json({ message: "invalid review id" })

    try {
        const existing = await prisma.review.findUnique({ where: { id: reviewId }, select: { user_id: true } })
        if (!existing) return res.status(404).json({ message: "Review not found" })
        if (existing.user_id !== userId && req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "You can only delete your own review" })
        }
        await prisma.review.delete({ where: { id: reviewId } })
        return res.status(204).send()
    } catch (err) {
        console.error("deleteReview error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}

// GET /reviews/featured?limit=6 — recent 4-5 star reviews with a comment, for the landing page.
export const getFeaturedReviews = async (req, res) => {
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 6
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) return res.status(400).json({ message: "invalid limit" })
    try {
        const reviews = await prisma.review.findMany({
            where: { rating: { gte: 4 }, comment: { not: null }, product: { is_hidden: false } },
            orderBy: { created_at: "desc" },
            take: limit,
            select: { ...REVIEW_SELECT, product: { select: { id: true, name: true } } },
        })
        return res.status(200).json({ message: "Reviews fetched", data: { reviews } })
    } catch (err) {
        console.error("getFeaturedReviews error:", err)
        return res.status(500).json({ message: "Database Error" })
    }
}
