// A worker thread for one call (server.ts starts it and ends it if it does not finish in time): runs it, answers once.
// The door checked the request; this only picks the protocol it is of.
import { parentPort, workerData } from "node:worker_threads";
import { type EvalRequest, isEvalRequest, type RunRequest } from "@boni/sandbox";
import { evaluateCall } from "./evaluate.ts";
import { runCall } from "./run.ts";

const { request, module } = workerData as {
  request: RunRequest | EvalRequest;
  module?: WebAssembly.Module;
};
const opts = module ? { module } : {};
parentPort?.postMessage(
  isEvalRequest(request)
    ? await evaluateCall(request as EvalRequest, opts)
    : await runCall(request as RunRequest, opts),
);
