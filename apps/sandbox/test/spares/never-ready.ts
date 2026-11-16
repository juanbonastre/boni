// (test) A spare that never says it is ready (server.ts, task 138): the door never gives it a call.
import { parentPort } from "node:worker_threads";

parentPort?.once("message", () => {});
