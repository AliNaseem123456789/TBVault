import prisma from "../config/db.js";
import { authenticate } from "./auth.middleware.js";

/**
 * Seller routes. Access comes from an APPROVED row in `sellers`, read from the database
 * on every request, so approving or suspending a seller takes effect immediately
 * (the role inside an access token can be up to 15 minutes old).
 * Sets req.seller.
 */
const loadApprovedSeller = async (req, res, next) => {
    try {
        const seller = await prisma.seller.findUnique({ where: { user_id: Number(req.user.sub) } });
        if (!seller) return res.status(403).json({ message: "You don't have a seller account" });
        if (seller.status !== "APPROVED") {
            const reason = { PENDING: "is still being reviewed", REJECTED: "was not approved", SUSPENDED: "is suspended" }[seller.status];
            return res.status(403).json({ message: `Your seller account ${reason}` });
        }
        req.seller = seller;
        next();
    } catch (err) {
        console.error("loadApprovedSeller error:", err);
        return res.status(500).json({ message: "Database Error" });
    }
};

export const requireSeller = [authenticate, loadApprovedSeller];

/**
 * After requireSeller: the product in req.params[param] must belong to req.seller.
 * Answers 404 (not 403) for other sellers' products so ids can't be probed.
 */
export const ownsProduct = (param = "id") => async (req, res, next) => {
    const id = Number(req.params[param]);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "invalid product id" });
    try {
        const product = await prisma.product.findUnique({ where: { id }, select: { seller_id: true } });
        if (!product || product.seller_id !== req.seller.id) return res.status(404).json({ message: "Product not found" });
        next();
    } catch (err) {
        console.error("ownsProduct error:", err);
        return res.status(500).json({ message: "Database Error" });
    }
};

// Same for routes addressed by variant id.
export const ownsVariant = async (req, res, next) => {
    const id = Number(req.params.variantId);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "invalid variant id" });
    try {
        const variant = await prisma.productVariant.findUnique({ where: { id }, select: { product: { select: { seller_id: true } } } });
        if (!variant || variant.product.seller_id !== req.seller.id) return res.status(404).json({ message: "Variant not found" });
        next();
    } catch (err) {
        console.error("ownsVariant error:", err);
        return res.status(500).json({ message: "Database Error" });
    }
};
