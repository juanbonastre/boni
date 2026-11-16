// (test) A spare that first tells the test what it was handed (server.ts, task 138), then is the box's own worker.
import { parentPort, workerData } from "node:worker_threads";

const data = workerData as Record<string, unknown>;
parentPort?.postMessage({
  told: Object.keys(data).sort(),
  module: data.module instanceof WebAssembly.Module,
});
await import("../../src/worker.ts");
