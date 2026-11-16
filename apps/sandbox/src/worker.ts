// A worker thread for one call (server.ts starts it and ends it if it does not finish in time): runs it, answers once.
// The door checked the request; this only picks the protocol it is of. Started with its request, it runs it at once;
// started as a spare (task 138), with nothing of any request, it says it is ready and takes one call, and only one.
import { parentPort, workerData } from "node:worker_threads";
import { type EvalRequest, isEvalRequest, type RunRequest } from "@boni/sandbox";
import { evaluateCall } from "./evaluate.ts";
import { runCall } from "./run.ts";

type BoxRequest = RunRequest | EvalRequest;
const { request, module } = workerData as { request?: BoxRequest; module?: WebAssembly.Module };
const opts = module ? { module } : {};
const answer = (req: BoxRequest) =>
  isEvalRequest(req) ? evaluateCall(req as EvalRequest, opts) : runCall(req as RunRequest, opts);

if (request) parentPort?.postMessage(await answer(request));
else {
  parentPort?.once("message", async (req: BoxRequest) => {
    parentPort?.postMessage({ spare: "taken" });
    parentPort?.postMessage(await answer(req));
  });
  parentPort?.postMessage({ spare: "ready" });
}
