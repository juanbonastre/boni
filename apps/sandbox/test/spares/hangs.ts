// (test) A spare that says it is ready, takes its call and never answers (server.ts, task 146): only the door's own
// timer ends the call, so the test sees when that timer counts from.
import { parentPort } from "node:worker_threads";

parentPort?.once("message", () => {
  parentPort?.postMessage({ spare: "taken" });
  // Busy here would starve the door's thread no more than a real call does; waiting is enough to never answer.
  setInterval(() => {}, 60_000);
});
parentPort?.postMessage({ spare: "ready" });
