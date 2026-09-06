import 'dotenv/config'
import { metricsMiddleware } from './src/middleware/metrics.middleware.js';
import { register } from './src/config/metrics.js';  
import http from "node:http"
import authRoutes from "./src/modules/auth/auth.routes.js";
import { requestLogger } from './src/middleware/logger.middleware.js';
import cookieParser from 'cookie-parser';
import express from "express"
import cors from "cors"
import { connectRabbitMQ } from './src/config/rabbitmq.js';
// import "./src/metrics/metrics.runtime.js"
const app=express()
app.use(cors({origin:[
  "http://localhost:5173"
],credentials:true}))


const server=http.createServer(app);
server.listen(3000,()=>{
    console.log("Server running on local host 3000")
})

app.use(requestLogger)
app.use(metricsMiddleware)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use("/api/auth",authRoutes)
await connectRabbitMQ();
app.get("/metrics", async (req, res) => {
  res.set(
    "Content-Type",
    register.contentType
  );
  res.end(
    await register.metrics()
  );
});
process.on("SIGINT",()=>{
    server.close(()=>{ process.exit(0);})
   
})
process.on("SIGTERM",()=>{
server.close(()=>{ process.exit(0);})})
