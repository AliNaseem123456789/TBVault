#!/usr/bin/env node
/**
 * AUTH-EMAIL-001 — forgot-password latency harness
 *
 * Measures per-request latency of POST /api/auth/forgot-password, which sends
 * an email inside the request/response cycle. Run it once against the current
 * synchronous implementation, then again after moving the send onto RabbitMQ,
 * and compare.
 *
 * Zero dependencies. Node 18+ (uses built-in fetch).
 *
 *   node loadtest-email.js before
 *   node loadtest-email.js after
 *   node loadtest-email.js after --compare before
 *
 * Options (flag or env var):
 *   --base-url      BASE_URL      default http://localhost:3000/api
 *   --per-account   PER_ACCOUNT   default 10
 *   --concurrency   CONCURRENCY   default 1   (1 = clean serial latency)
 *   --warmup        WARMUP        default 3   (discarded, excludes cold start)
 *   --delay-ms      DELAY_MS      default 0   (pause between requests)
 *   --out-dir       OUT_DIR       default ./monitoring/experiments/AUTH-EMAIL-001
 *   --include-real                also hit non-@example.com addresses (see below)
 *   --compare <label>             diff this run against a previous run
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

// ---------------------------------------------------------------------------
// Target accounts — unverified users from the users table.
//
// Only @example.com is enabled by default. example.com is reserved by RFC 2606
// and cannot receive mail, so a few hundred sends cost nothing and reach no one.
// The Gmail addresses in your table are real, deliverable inboxes: 10 password
// reset emails each is a lot of mail, it burns real SMTP quota, and it's a good
// way to get a sending domain flagged. Pass --include-real only for addresses
// you personally own.
// ---------------------------------------------------------------------------
const SAFE_ACCOUNTS = [
  "ali.test@example.com",
  "ali.test1@example.com",
  "ali.test2@example.com",
  "ali.test3@example.com",
  "ali4.test@example.com",
  "john@example.com",
  ...Array.from({ length: 50 }, (_, i) => `loadtest-user-${i + 1}@example.com`),
];

const REAL_ACCOUNTS = [
  "alinaseem21102002@gmail.com",
  "testing199@gmail.com",
  "testing200@gmail.com",
  "testing201@gmail.com",
  "testing202@gmail.com",
  "ali@gmail.com",
  "ali123@gmail.com",
  "alinaseem011235@gmail.com",
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const LABEL = (argv[0] && !argv[0].startsWith("--") ? argv[0] : "before").trim();
const BASE_URL = flag("base-url", process.env.BASE_URL || "http://localhost:3000/api");
const ENDPOINT = `${BASE_URL.replace(/\/$/, "")}/auth/forgot-password`;
const PER_ACCOUNT = Number(flag("per-account", process.env.PER_ACCOUNT || 10));
const CONCURRENCY = Number(flag("concurrency", process.env.CONCURRENCY || 1));
const WARMUP = Number(flag("warmup", process.env.WARMUP || 3));
const DELAY_MS = Number(flag("delay-ms", process.env.DELAY_MS || 0));
const OUT_DIR = resolve(
  flag("out-dir", process.env.OUT_DIR || "./monitoring/experiments/AUTH-EMAIL-001")
);
const COMPARE = flag("compare", null);

const ACCOUNTS = has("include-real")
  ? [...SAFE_ACCOUNTS, ...REAL_ACCOUNTS]
  : SAFE_ACCOUNTS;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  // nearest-rank
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
};

function summarize(samples, wallMs) {
  const ok = samples.filter((s) => s.ok);
  const durations = ok.map((s) => s.ms).sort((a, b) => a - b);
  const mean = durations.reduce((a, b) => a + b, 0) / (durations.length || 1);
  const variance =
    durations.reduce((a, b) => a + (b - mean) ** 2, 0) / (durations.length || 1);

  const byStatus = {};
  for (const s of samples) {
    const k = s.status ?? s.error ?? "network_error";
    byStatus[k] = (byStatus[k] || 0) + 1;
  }

  return {
    requests: samples.length,
    successful: ok.length,
    failed: samples.length - ok.length,
    error_rate_pct: +(((samples.length - ok.length) / (samples.length || 1)) * 100).toFixed(2),
    status_breakdown: byStatus,
    latency_ms: {
      min: +(durations[0] ?? 0).toFixed(2),
      mean: +mean.toFixed(2),
      stddev: +Math.sqrt(variance).toFixed(2),
      p50: +percentile(durations, 50).toFixed(2),
      p75: +percentile(durations, 75).toFixed(2),
      p90: +percentile(durations, 90).toFixed(2),
      p95: +percentile(durations, 95).toFixed(2),
      p99: +percentile(durations, 99).toFixed(2),
      max: +(durations[durations.length - 1] ?? 0).toFixed(2),
    },
    wall_clock_s: +(wallMs / 1000).toFixed(2),
    throughput_rps: +(samples.length / (wallMs / 1000)).toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------
async function hit(email, seq) {
  const t0 = performance.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    // drain the body so timing includes the full response, not just headers
    await res.text();
    const ms = performance.now() - t0;
    return { seq, email, ms, status: res.status, ok: res.ok, ts: new Date().toISOString() };
  } catch (err) {
    const ms = performance.now() - t0;
    return { seq, email, ms, status: null, ok: false, error: err.code || err.message, ts: new Date().toISOString() };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runPool(jobs, concurrency, onDone) {
  const results = new Array(jobs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const i = cursor++;
      results[i] = await jobs[i]();
      onDone(results[i], i + 1, jobs.length);
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const total = ACCOUNTS.length * PER_ACCOUNT;

  console.log("─".repeat(64));
  console.log(`AUTH-EMAIL-001  ·  run label: ${LABEL}`);
  console.log("─".repeat(64));
  console.log(`endpoint     ${ENDPOINT}`);
  console.log(`accounts     ${ACCOUNTS.length}${has("include-real") ? " (incl. real inboxes)" : " (example.com only)"}`);
  console.log(`per account  ${PER_ACCOUNT}`);
  console.log(`total        ${total} requests  (+${WARMUP} warmup, discarded)`);
  console.log(`concurrency  ${CONCURRENCY}`);
  if (DELAY_MS) console.log(`delay        ${DELAY_MS}ms between requests`);
  console.log("─".repeat(64));

  // reachability check
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ACCOUNTS[0] }),
    });
  } catch (err) {
    console.error(`\nCannot reach ${ENDPOINT}`);
    console.error(`${err.code || err.message} — is the backend running?\n`);
    process.exit(1);
  }

  // warmup: first request pays for SMTP connection setup, JIT, connection pool
  for (let i = 0; i < WARMUP; i++) await hit(ACCOUNTS[0], -1);

  const jobs = [];
  let seq = 0;
  for (let round = 0; round < PER_ACCOUNT; round++) {
    for (const email of ACCOUNTS) {
      const s = seq++;
      jobs.push(() => hit(email, s));
    }
  }

  const t0 = performance.now();
  const samples = await runPool(jobs, CONCURRENCY, (r, done, all) => {
    if (done % 25 === 0 || done === all) {
      process.stdout.write(`\r  ${done}/${all}  last ${r.ms.toFixed(0)}ms  status ${r.status ?? r.error}   `);
    }
  });
  const wallMs = performance.now() - t0;
  process.stdout.write("\n");

  const summary = summarize(samples, wallMs);
  const record = {
    experiment: "AUTH-EMAIL-001",
    label: LABEL,
    started_at: new Date(Date.now() - wallMs).toISOString(),
    finished_at: new Date().toISOString(),
    config: {
      endpoint: ENDPOINT,
      accounts: ACCOUNTS.length,
      per_account: PER_ACCOUNT,
      concurrency: CONCURRENCY,
      warmup: WARMUP,
      delay_ms: DELAY_MS,
      included_real_inboxes: has("include-real"),
    },
    summary,
    samples,
  };

  const dir = join(OUT_DIR, LABEL);
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, "results.json");
  const csvPath = join(dir, "samples.csv");
  writeFileSync(jsonPath, JSON.stringify(record, null, 2));
  writeFileSync(
    csvPath,
    "seq,email,ms,status,ok,ts\n" +
      samples.map((s) => `${s.seq},${s.email},${s.ms.toFixed(2)},${s.status ?? s.error},${s.ok},${s.ts}`).join("\n")
  );

  const L = summary.latency_ms;
  console.log("");
  console.log("─".repeat(64));
  console.log(`RESULTS — ${LABEL}`);
  console.log("─".repeat(64));
  console.log(`requests     ${summary.requests}   ok ${summary.successful}   failed ${summary.failed}  (${summary.error_rate_pct}%)`);
  console.log(`statuses     ${JSON.stringify(summary.status_breakdown)}`);
  console.log("");
  console.log(`  min        ${String(L.min).padStart(9)} ms`);
  console.log(`  mean       ${String(L.mean).padStart(9)} ms   (±${L.stddev})`);
  console.log(`  p50        ${String(L.p50).padStart(9)} ms`);
  console.log(`  p75        ${String(L.p75).padStart(9)} ms`);
  console.log(`  p90        ${String(L.p90).padStart(9)} ms`);
  console.log(`  p95        ${String(L.p95).padStart(9)} ms`);
  console.log(`  p99        ${String(L.p99).padStart(9)} ms`);
  console.log(`  max        ${String(L.max).padStart(9)} ms`);
  console.log("");
  console.log(`wall clock   ${summary.wall_clock_s}s`);
  console.log(`throughput   ${summary.throughput_rps} req/s`);
  console.log("─".repeat(64));
  console.log(`saved  ${jsonPath}`);
  console.log(`saved  ${csvPath}`);

  if (COMPARE) {
    const prevPath = join(OUT_DIR, COMPARE, "results.json");
    if (!existsSync(prevPath)) {
      console.log(`\nNo baseline at ${prevPath} — run \`node loadtest-email.js ${COMPARE}\` first.`);
      return;
    }
    const prev = JSON.parse(readFileSync(prevPath, "utf8"));
    const A = prev.summary.latency_ms;
    const B = L;
    const row = (k) => {
      const before = A[k];
      const after = B[k];
      const delta = before ? (((after - before) / before) * 100).toFixed(1) : "—";
      const faster = before && after ? `${(before / after).toFixed(1)}x` : "—";
      return `  ${k.padEnd(6)} ${String(before).padStart(9)} ms  →  ${String(after).padStart(9)} ms   ${String(delta).padStart(7)}%   ${faster}`;
    };
    console.log("");
    console.log("─".repeat(64));
    console.log(`COMPARISON — ${COMPARE} vs ${LABEL}`);
    console.log("─".repeat(64));
    console.log(`         ${COMPARE.padStart(9)}       ${LABEL.padStart(9)}         delta   speedup`);
    ["min", "mean", "p50", "p90", "p95", "p99", "max"].forEach((k) => console.log(row(k)));
    console.log("");
    console.log(`  tput   ${String(prev.summary.throughput_rps).padStart(9)} r/s →  ${String(summary.throughput_rps).padStart(9)} r/s`);
    console.log("─".repeat(64));

    writeFileSync(
      join(OUT_DIR, `comparison-${COMPARE}-vs-${LABEL}.json`),
      JSON.stringify(
        { experiment: "AUTH-EMAIL-001", baseline: COMPARE, candidate: LABEL, baseline_summary: prev.summary, candidate_summary: summary },
        null,
        2
      )
    );
    console.log(`saved  ${join(OUT_DIR, `comparison-${COMPARE}-vs-${LABEL}.json`)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});