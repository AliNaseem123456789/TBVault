// Validates rating (1-5 whole number) and an optional comment up to 2000 chars.
export const parseReviewInput = (body, { partial = false } = {}) => {
    const data = {}
    if (body.rating !== undefined || !partial) {
        const rating = Number(body.rating)
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "rating must be a whole number from 1 to 5" }
        data.rating = rating
    }
    if (body.comment !== undefined) {
        if (body.comment !== null && typeof body.comment !== "string") return { error: "comment must be text" }
        const comment = body.comment?.trim() || null
        if (comment && comment.length > 2000) return { error: "comment must be at most 2000 characters" }
        data.comment = comment
    }
    return { data }
}
