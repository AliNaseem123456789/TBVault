import express from "express"
import cors from "cors"
import cookieParser from 'cookie-parser';

import { metricsMiddleware } from './middleware/metrics.middleware.js';
import { register } from './config/metrics.js';
import { requestLogger } from './middleware/logger.middleware.js';

import authRoutes from "./modules/auth/auth.routes.js";
import categoriesRoutes from "./modules/categories/categories.routes.js"
import productRoutes from "./modules/products/products.routes.js"
import variantRoutes from "./modules/variants/variants.routes.js"
import cartRoutes from "./modules/cart/cart.routes.js"
import orderRoutes from "./modules/orders/order.routes.js"
import reviewRoutes from "./modules/reviews/reviews.routes.js"
import addressRoutes from "./modules/addresses/addresses.routes.js"
import couponRoutes from "./modules/coupons/coupons.routes.js"
import saleRoutes from "./modules/sales/sales.routes.js"
import shippingRoutes from "./modules/shipping/shipping.routes.js"
import settingsRoutes from "./modules/settings/settings.routes.js"
import paymentRoutes, { stripeWebhookRouter } from "./modules/payments/payments.routes.js"
import returnRoutes from "./modules/returns/returns.routes.js"
import wishlistRoutes from "./modules/wishlist/wishlist.routes.js"
import stockAlertRoutes from "./modules/stock-alerts/stock-alerts.routes.js"
import analyticsRoutes from "./modules/analytics/analytics.routes.js"
import customerRoutes from "./modules/customers/customers.routes.js"
import exportRoutes from "./modules/exports/exports.routes.js"

// The Express app without listening or connecting to RabbitMQ, so tests can import it.
const app = express()

// Behind Nginx (production) set TRUST_PROXY=1 so req.ip is the visitor's address from
// X-Forwarded-For, not 127.0.0.1 — rate limits and session IPs depend on it.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY)
  app.set("trust proxy", Number.isNaN(hops) ? process.env.TRUST_PROXY : hops)
}

app.use(cors({ origin: (process.env.CORS_ORIGINS || "http://localhost:5173").split(","), credentials: true }))
app.use(requestLogger)
app.use(metricsMiddleware)

// Stripe signs the raw request body, so the webhook must be mounted before express.json().
app.use("/api", stripeWebhookRouter)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

app.use("/api/auth", authRoutes)
app.use("/api", categoriesRoutes)
app.use("/api", productRoutes)
app.use("/api", variantRoutes)
app.use("/api", cartRoutes)
app.use("/api", orderRoutes)
app.use("/api", reviewRoutes)
app.use("/api", addressRoutes)
app.use("/api", couponRoutes)
app.use("/api", saleRoutes)
app.use("/api", shippingRoutes)
app.use("/api", settingsRoutes)
app.use("/api", paymentRoutes)
app.use("/api", returnRoutes)
app.use("/api", wishlistRoutes)
app.use("/api", stockAlertRoutes)
app.use("/api", analyticsRoutes)
app.use("/api", customerRoutes)
app.use("/api", exportRoutes)

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Last-resort handler: anything unhandled becomes a JSON 500 (bad JSON bodies become 400).
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON body" })
  console.error("Unhandled error:", err)
  res.status(500).json({ message: "Internal Server Error" })
})

export default app
