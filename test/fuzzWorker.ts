// Worker-thread entry for test/fuzz.ts: plays the seeds it is handed and posts progress and results.
import { parentPort, workerData } from "node:worker_threads";
import { runSeed, runWorld } from "./fuzzCore";

const { seeds, cycles } = workerData as { seeds: number[]; cycles: number };
for (const seed of seeds) {
  // Every seventh seed (3, 10, 17, …) plays a three-sea World over its lanes instead of one sea.
  const result = seed % 7 === 3 ? runWorld(seed, Math.min(cycles, 400)) : runSeed(seed, cycles, cycle => { if (cycle % 50 === 0) parentPort!.postMessage({ type: "progress", seed, cycle }); });
  parentPort!.postMessage({ type: "result", result });
}
