import 'dotenv/config'
import { metricsMiddleware } from './src/middleware/metrics.middleware.js';
import { register } from './src/config/metrics.js';
import http from "node:http";
import authRoutes from "./src/modules/auth/auth.routes.js";
import { requestLogger } from './src/middleware/logger.middleware.js';
import cookieParser from 'cookie-parser';
import express from "express";
import fs from "node:fs";
import path from "node:path";
import "./src/metrics/metrics.runtime.js";

const app = express();

const server = http.createServer(app);

app.use(requestLogger);
app.use(metricsMiddleware);
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoutes);

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

let shuttingDown = false;

const logDir = path.resolve("logs");
const fatalLog = path.join(logDir, "fatal.log");

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function writeFatalLog(type, error) {
  const message = `
[${new Date().toISOString()}] ${type}
Message: ${error?.message || error}
Stack: ${error?.stack || "No stack trace"}
----------------------------------------
`;

  try {
    fs.appendFileSync(fatalLog, message, "utf8");
  } catch (logError) {
    console.error("Failed to write fatal log:", logError);
  }

  console.error(message);
}

function gracefulShutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(`Received ${signal}. Shutting down...`);

  server.close((error) => {
    if (error) {
      console.error("Server shutdown error:", error);
      process.exit(1);
    }

    console.log("Server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  writeFatalLog("UNCAUGHT EXCEPTION", error);
//   process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error
    ? reason
    : new Error(String(reason));

  writeFatalLog("UNHANDLED REJECTION", error);
  process.exit(1);
});

app.use((err, req, res, next) => {
  console.error('Error:', err);

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});
server.listen(3000, () => {
  console.log("Server running on local host 3000");
});

