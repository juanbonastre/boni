// A worker thread for one call (server.ts starts it and ends it if it does not finish in time): runs it, answers once.
import { parentPort, workerData } from "node:worker_threads";
import type { RunRequest } from "@boni/sandbox";
import { runCall } from "./run.ts";

const { request, module } = workerData as { request: RunRequest; module?: WebAssembly.Module };
parentPort?.postMessage(await runCall(request, module ? { module } : {}));
