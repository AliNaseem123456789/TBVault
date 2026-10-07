import 'dotenv/config'
import http from "node:http"

import app from "./src/app.js"
import { connectRabbitMQ, closeRabbitMQ } from './src/config/rabbitmq.js';
// import "./src/metrics/metrics.runtime.js"

const PORT = Number(process.env.PORT) || 3000

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
