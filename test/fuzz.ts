// The sim fuzzer, run with `npm run fuzz [-- --seeds 50 --cycles 2000 --workers 8 --start 1 --only 1,7 --json out.json]`.
// Bundles test/fuzzWorker.ts (and the sim under it) with esbuild, then plays the seeds across worker threads;
// each seed is 2000 cycles of random valid actions with the ledger's invariants checked every cycle
// (test/fuzzCore.ts). Exit code 1 when any seed fails; the failure prints its invariant and the last actions.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { writeFileSync } from "node:fs";
import type { FuzzResult } from "./fuzzCore";

const args = process.argv.slice(2);
const opt = (name: string, dflt: number): number => { const k = args.indexOf(`--${name}`); return k >= 0 ? Number(args[k + 1]) : dflt; };
const seedsWanted = opt("seeds", 50);
const cycles = opt("cycles", 2000);
const start = opt("start", 1);
const workers = Math.max(1, Math.min(opt("workers", Math.min(cpus().length, 16)), seedsWanted));
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../node_modules/.cache/tidewater");
mkdirSync(outDir, { recursive: true });
const bundle = resolve(outDir, "fuzzWorker.mjs");
await build({ entryPoints: [resolve(here, "fuzzWorker.ts")], bundle: true, platform: "node", format: "esm", target: "node22", outfile: bundle, logLevel: "error" });

const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",").map(Number) : null; // --only 1,7,10
const seeds = only ?? Array.from({ length: seedsWanted }, (_, k) => start + k);
const lanes: number[][] = Array.from({ length: workers }, () => []);
seeds.forEach((s, k) => lanes[k % workers].push(s));
const t0 = performance.now();
const results: FuzzResult[] = [];
const progress = new Map<number, number>();
let lastLine = 0;

const report = (): void => {
  const now = performance.now();
  if (now - lastLine < 5000) return;
  lastLine = now;
  const done = results.length;
  const running = [...progress.entries()].filter(([s]) => !results.some(r => r.seed === s)).map(([s, c]) => `${s}:${c}`).join(" ");
  console.log(`[fuzz] ${done}/${seeds.length} seeds done · ${((now - t0) / 1000).toFixed(0)} s · running ${running}`);
};

await Promise.all(lanes.filter(l => l.length).map(lane => new Promise<void>((resolveLane, reject) => {
  const w = new Worker(bundle, { workerData: { seeds: lane, cycles } });
  w.on("message", (m: { type: "progress"; seed: number; cycle: number } | { type: "result"; result: FuzzResult }) => {
    if (m.type === "progress") { progress.set(m.seed, m.cycle); report(); return; }
    results.push(m.result);
    progress.set(m.result.seed, m.result.cycles);
    const r = m.result;
    const status = r.failures.length ? "FAIL" : "ok";
    console.log(`[fuzz] seed ${r.seed}: ${status} · ${r.cycles} cycles · ${Object.values(r.actions).reduce((n, v) => n + v, 0)} actions · ${Object.values(r.placed).reduce((n, v) => n + (v ?? 0), 0)} placed · hash ${r.hash} · ${(r.ms / 1000).toFixed(0)} s${r.negativeMoneyCycles ? ` · purse below zero ${r.negativeMoneyCycles} cycles` : ""}`);
    for (const f of r.failures) {
      console.log(`  ✗ cycle ${f.cycle}: ${f.invariant}`);
      if (f.detail !== f.invariant) console.log(`    ${f.detail.split("\n").slice(0, 8).join("\n    ")}`);
      console.log(`    last actions:\n      ${f.recent.slice(-12).join("\n      ")}`);
    }
  });
  w.on("error", reject);
  w.on("exit", code => (code === 0 ? resolveLane() : reject(new Error(`worker exited with ${code}`))));
})));

results.sort((a, b) => a.seed - b.seed);
const failed = results.filter(r => r.failures.length);
const placedAll: Record<string, number> = {};
for (const r of results) for (const [k, v] of Object.entries(r.placed)) placedAll[k] = (placedAll[k] ?? 0) + (v ?? 0);
console.log(`[fuzz] ${results.length - failed.length}/${results.length} seeds clean in ${((performance.now() - t0) / 1000).toFixed(0)} s · placements by kind: ${Object.entries(placedAll).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results.map(r => ({ seed: r.seed, cycles: r.cycles, hash: r.hash, failures: r.failures.length, negativeMoneyCycles: r.negativeMoneyCycles })), null, 2));
if (failed.length) { console.log(`[fuzz] FAILED seeds: ${failed.map(r => r.seed).join(", ")}`); process.exit(1); }
