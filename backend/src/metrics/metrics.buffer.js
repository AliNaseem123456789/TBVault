// metrics.buffer.js

const MAX_BUFFER_SIZE = 60;

const buffer = [];


export function addMetricSnapshot(snapshot) {

    buffer.push(snapshot);

    if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift();
    }
}


export function getBuffer() {

    return [...buffer];
}


export function getLatestMetric() {

    return buffer[buffer.length - 1] ?? null;
}


export function clearBuffer() {

    buffer.length = 0;
}
