import 'dotenv/config'
import http from "node:http"
import express from "express"
import cors from "cors"
import cookieParser from 'cookie-parser';

import { metricsMiddleware } from './src/middleware/metrics.middleware.js';
import { register } from './src/config/metrics.js';
import { requestLogger } from './src/middleware/logger.middleware.js';
import { connectRabbitMQ, closeRabbitMQ } from './src/config/rabbitmq.js';

import authRoutes from "./src/modules/auth/auth.routes.js";
import categoriesRoutes from "./src/modules/categories/categories.routes.js"
import productRoutes from "./src/modules/products/products.routes.js"
import cartRoutes from "./src/modules/cart/cart.routes.js"
import orderRoutes from "./src/modules/orders/order.routes.js"
import reviewRoutes from "./src/modules/reviews/reviews.routes.js"
// import "./src/metrics/metrics.runtime.js"

const PORT = Number(process.env.PORT) || 3000
const app = express()

app.use(cors({ origin: (process.env.CORS_ORIGINS || "http://localhost:5173").split(","), credentials: true }))
app.use(requestLogger)
app.use(metricsMiddleware)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

app.use("/api/auth", authRoutes)
app.use("/api", categoriesRoutes)
app.use("/api", productRoutes)
app.use("/api", cartRoutes)
app.use("/api", orderRoutes)
app.use("/api", reviewRoutes)

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

// Connect to RabbitMQ before accepting requests, so no request sees a missing channel.
await connectRabbitMQ();

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Server running on localhost:${PORT}`)
})

const shutdown = () => {
  server.close(async () => {
    await closeRabbitMQ()
    process.exit(0)
  })
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
