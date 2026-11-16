// (test) A spare that dies when it is given a call, before it says it took it (server.ts, task 138): the call has not
// started in it, so the door starts the call's own worker.
import { parentPort } from "node:worker_threads";

parentPort?.once("message", () => process.exit(1));
parentPort?.postMessage({ spare: "ready" });
