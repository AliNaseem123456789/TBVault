import { verifyAccessToken } from "../utils/jwt.helpers.js";

export const authenticate = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    const accessToken = authHeader.split(" ")[1];
    try {
        req.user = verifyAccessToken(accessToken);
        next();
    } catch (err) {
        return res.status(401).json({ message: "Not authenticated" });
    }
};

// Like authenticate, but lets anonymous requests through (req.user stays undefined).
// Used by routes that work for both guests and signed-in customers, e.g. checkout.
export const optionalAuthenticate = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
    try {
        req.user = verifyAccessToken(authHeader.split(" ")[1]);
        next();
    } catch (err) {
        // A stale token should make the client refresh, not silently become a guest.
        return res.status(401).json({ message: "Not authenticated" });
    }
};

export const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ message: "Not authenticated" });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: "Not authorized" });
        }
        next();
    };
};

// Shorthand for admin-only routes.
export const requireAdmin = [authenticate, authorize("ADMIN")];
