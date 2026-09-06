// metrics.persistence.js

import fs from "node:fs/promises";
import path from "node:path";

const metricsDirectory = path.resolve("src/metrics/metrics-data");

const metricsFile =
    path.join(metricsDirectory, "metrics.jsonl");


export async function initializePersistence() {

    await fs.mkdir(metricsDirectory, {
        recursive: true
    });
}


export async function persistMetric(snapshot) {

    const line =
        JSON.stringify(snapshot) + "\n";

    await fs.appendFile(
        metricsFile,
        line,
        "utf8"
    );
}


export async function persistBuffer(buffer) {

    if (!buffer.length) {
        return;
    }

    const lines =
        buffer
            .map(snapshot => JSON.stringify(snapshot))
            .join("\n") + "\n";

    await fs.appendFile(
        metricsFile,
        lines,
        "utf8"
    );
}