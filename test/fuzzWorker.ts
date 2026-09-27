// Worker-thread entry for test/fuzz.ts: plays the seeds it is handed and posts progress and results.
import { parentPort, workerData } from "node:worker_threads";
import { runSeed } from "./fuzzCore";

const { seeds, cycles } = workerData as { seeds: number[]; cycles: number };
for (const seed of seeds) {
  const result = runSeed(seed, cycles, cycle => { if (cycle % 50 === 0) parentPort!.postMessage({ type: "progress", seed, cycle }); });
  parentPort!.postMessage({ type: "result", result });
}
