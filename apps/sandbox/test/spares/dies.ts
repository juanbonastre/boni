// (test) A spare that says it is ready and dies before any call (server.ts, task 138): the door drops it.
import { parentPort } from "node:worker_threads";

parentPort?.postMessage({ spare: "ready" });
process.exit(1);
