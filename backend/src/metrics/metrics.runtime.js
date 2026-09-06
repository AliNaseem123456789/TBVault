import os from "node:os";
import {
    PerformanceObserver,
    monitorEventLoopDelay,
    performance
} from "node:perf_hooks";

import {
    updateMetrics,
    getMetrics
} from "./metrics.registry.js";

import {
    addMetricSnapshot
} from "./metrics.buffer.js";

import {
    persistMetric
} from "./metrics.persistence.js";

// ============================================================
// HELPERS
// ============================================================
function convertMB(bytes) {
    return bytes / 1024 / 1024;
}
function nsToMs(ns) {
    return ns / 1e6;
}
// ============================================================
// CPU — NODE PROCESS
// ============================================================
let previousCPU = process.cpuUsage();
let previousTime = process.hrtime.bigint();
function collectCPUUsage() {
    const currentCPU = process.cpuUsage();
    const currentTime = process.hrtime.bigint();
    const userCPU =
        currentCPU.user - previousCPU.user;
    const systemCPU =
        currentCPU.system - previousCPU.system;
    const totalCPU =
        userCPU + systemCPU;
    // hrtime = nanoseconds
    // cpuUsage = microseconds
    const elapsedTime =
        Number(currentTime - previousTime) / 1000;
    const cpuUsage =
        (totalCPU / elapsedTime) * 100;
    updateMetrics("process", {
        cpu: {
            user: userCPU,
            system: systemCPU,
            total: totalCPU,
            utilization: cpuUsage
        }

    });
    previousCPU = currentCPU;
    previousTime = currentTime;
}
// ============================================================
// MEMORY — NODE PROCESS
// ============================================================
function collectMemoryMetrics() {
    const memory =
        process.memoryUsage();
    updateMetrics("process", {
        memory: {
            rss:
                convertMB(memory.rss),
            heapTotal:
                convertMB(memory.heapTotal),
            heapUsed:
                convertMB(memory.heapUsed),
            external:
                convertMB(memory.external),
            arrayBuffers:
                convertMB(memory.arrayBuffers)
        }
    });
}
// ============================================================
// EVENT LOOP DELAY
// ============================================================
const eventLoopHistogram =
    monitorEventLoopDelay({
        resolution: 20
    });
eventLoopHistogram.enable();
function collectEventLoopMetrics() {
    updateMetrics("eventLoop", {
        delay: {
            min:
                nsToMs(
                    eventLoopHistogram.min
                ),

            max:
                nsToMs(
                    eventLoopHistogram.max
                ),
            mean:
                nsToMs(
                    eventLoopHistogram.mean
                ),
            p50:
                nsToMs(
                    eventLoopHistogram.percentile(50)
                ),
            p95:
                nsToMs(
                    eventLoopHistogram.percentile(95)
                ),
            p99:
                nsToMs(
                    eventLoopHistogram.percentile(99)
                )
        }
    });
    // Important:
    // Next interval should start with a fresh histogram.
    eventLoopHistogram.reset();
}
// ============================================================
// EVENT LOOP UTILIZATION
// ============================================================
let previousELU =
    performance.eventLoopUtilization();
function collectEventLoopUtilization() {
    const currentELU =
        performance.eventLoopUtilization(
            previousELU
        );
    updateMetrics("eventLoop", {
        utilization:
            currentELU.utilization * 100,
        active:
            currentELU.active,
        idle:
            currentELU.idle
    });
    previousELU = currentELU;
}
// ============================================================
// GARBAGE COLLECTION
// ============================================================
let gcCount = 0;
let totalGCDuration = 0;
let maxGCDuration = 0;
const gcObserver =
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            gcCount++;
            totalGCDuration +=
                entry.duration;
            maxGCDuration =
                Math.max(
                    maxGCDuration,
                    entry.duration
                );
        }
    });
gcObserver.observe({
    entryTypes: ["gc"]
});
function collectGCMetrics() {
    updateMetrics("gc", {
        count:
            gcCount,
        totalDuration:
            totalGCDuration,
        maxDuration:
            maxGCDuration
    });
    // Reset interval counters
    gcCount = 0;
    totalGCDuration = 0;
    maxGCDuration = 0;
}
// ============================================================
// PROCESS
// ============================================================
function collectProcessMetrics() {
    updateMetrics("process", {
        pid:
            process.pid,
        ppid:
            process.ppid,

        uptime:
            process.uptime()
    });
}


// ============================================================
// HOST MEMORY
// ============================================================

function collectHostMemoryMetrics() {
    const total =
        os.totalmem();
    const free =
        os.freemem();
    const used =
        total - free;
    const utilization =
        (used / total) * 100;
    updateMetrics("host", {
        memory: {
            total:
                convertMB(total),
            free:
                convertMB(free),
            used:
                convertMB(used),
            utilization
        }

    });
}
// ============================================================
// HOST CPU
// ============================================================

function getHostCPUStats() {
    const cpus =
        os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
        idle +=
            cpu.times.idle;
        total +=
            cpu.times.user +
            cpu.times.nice +
            cpu.times.sys +
            cpu.times.idle +
            cpu.times.irq;
    }
    return {
        idle,
        total
    };
}
let previousHostCPU =
    getHostCPUStats();
function collectHostCPU() {
    const currentHostCPU =
        getHostCPUStats();
    const idleDelta =
        currentHostCPU.idle -
        previousHostCPU.idle;
    const totalDelta =
        currentHostCPU.total -
        previousHostCPU.total;
    const utilization =
        ((totalDelta - idleDelta) /
            totalDelta) * 100;
    updateMetrics("host", {
        cpu: {
            cores:
                os.cpus().length,
            utilization
        }
    });
    previousHostCPU =
        currentHostCPU;
}
// ============================================================
// LOAD AVERAGE
// ============================================================
function collectLoadAverage() {
    const [
        oneMinute,
        fiveMinutes,
        fifteenMinutes
    ] = os.loadavg();
    updateMetrics("host", {
        load: {
            oneMinute,
            fiveMinutes,
            fifteenMinutes
        }

    });
}
// ============================================================
// COLLECT EVERYTHING
// ============================================================
async function collectRuntimeMetrics() {
    try {
        // 1. Collect
        collectMemoryMetrics();
        collectCPUUsage();
        collectEventLoopMetrics();
        collectEventLoopUtilization();
        collectGCMetrics();
        collectProcessMetrics();
        collectHostMemoryMetrics();
        collectHostCPU();
        collectLoadAverage();
        // 2. Take ONE complete snapshot
        const snapshot =
            getMetrics();
        // 3. Add to rolling buffer
        addMetricSnapshot(
            snapshot
        );
        // 4. Persist
        await persistMetric(
            snapshot
        );
    } catch (error) {

        // Metrics must NEVER crash
        // the main application.
        console.error(
            "Runtime metrics collection failed:",
            error
        );

    }
}
// START COLLECTOR
const METRICS_INTERVAL =
    10_000;
const metricsInterval =
    setInterval(
        collectRuntimeMetrics,
        METRICS_INTERVAL
    );
// Prevent the metrics interval from
// keeping Node alive during shutdown.
metricsInterval.unref();