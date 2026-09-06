// config/metrics.js

import client from "prom-client";

client.collectDefaultMetrics();

export const register = client.register;
export const httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration",
    labelNames: ["method", "route", "status_code"],
    buckets: [
        0.01,
        0.025,
        0.05,
        0.1,
        0.25,
        0.5,
        1,
        2,
        5
    ]
});

export const httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "route", "status_code"]
});

export const httpInFlight = new client.Gauge({
    name: "http_requests_in_flight",
    help: "Number of HTTP requests currently being processed"
});