// middleware/metricsMiddleware.js
import {
    httpRequestDuration,
    httpRequestsTotal,
    httpInFlight
} from "../config/metrics.js";
export const metricsMiddleware = (req, res, next) => {
    const start = process.hrtime.bigint();
    httpInFlight.inc();
    res.on("finish", () => {
        const duration =
            Number(process.hrtime.bigint() - start) / 1e9;
        const route = req.route?.path || req.originalUrl;
        httpRequestDuration.observe(
            {
                method: req.method,
                route,
                status_code: res.statusCode
            },
            duration
        );
        httpRequestsTotal.inc({
            method: req.method,
            route,
            status_code: res.statusCode
        });
        httpInFlight.dec();
    });
    next();
};