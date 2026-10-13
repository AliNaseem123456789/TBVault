import 'dotenv/config'
import http from "node:http"

import app from "./src/app.js"
import { startRabbitMQ, closeRabbitMQ } from './src/config/rabbitmq.js';
// import "./src/metrics/metrics.runtime.js"

const PORT = Number(process.env.PORT) || 3000

// RabbitMQ (local or hosted, e.g. CloudAMQP) connects in the background and reconnects on its own,
// so a broker outage never keeps the site from starting. See src/config/rabbitmq.js.
startRabbitMQ();

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
