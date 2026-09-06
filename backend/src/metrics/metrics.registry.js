// metrics.registry.js
const metrics = {
    timestamp: null,

    process: {
        cpu: {
            user: 0,
            system: 0,
            total: 0,
            utilization: 0
        },

        memory: {
            rss: 0,
            heapTotal: 0,
            heapUsed: 0,
            external: 0,
            arrayBuffers: 0
        },

        pid: process.pid,
        ppid: process.ppid,
        uptime: 0
    },

    eventLoop: {
        delay: {
            min: 0,
            max: 0,
            mean: 0,
            p50: 0,
            p95: 0,
            p99: 0
        },

        utilization: 0,
        active: 0,
        idle: 0
    },

    gc: {
        count: 0,
        totalDuration: 0,
        maxDuration: 0
    },

    host: {
        cpu: {
            cores: 0,
            utilization: 0
        },

        memory: {
            total: 0,
            free: 0,
            used: 0,
            utilization: 0
        },

        load: {
            oneMinute: 0,
            fiveMinutes: 0,
            fifteenMinutes: 0
        }
    }
};

export function updateMetrics(updates) {
    Object.assign(metrics, updates);
    metrics.timestamp = new Date().toISOString();
}
export function getMetrics() {
    // Return a copy so outside code cannot accidentally
    // mutate the registry.
    return structuredClone(metrics);
}
