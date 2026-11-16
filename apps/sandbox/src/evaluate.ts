/**
 * One evaluation of an automation's JavaScript in a QuickJS interpreter of its own (docs/automatizaciones.md AU-160;
 * protocol 2, packages/sandbox/src/evaluate.ts): the box's half. As run.ts does for an extension's function: a new
 * interpreter with a memory of its own, the limits, and nothing of Boni or of the machine reachable from inside. What
 * is new: expressions and «Código» over a batch of rows, what the code may name (`$json`, `$input`, `$`, `$col`,
 * `$now`…), the console collected, a read that stops the evaluation when the request does not bring it, and a world
 * that one row's evaluation cannot change for the next. Contract of F14c: not built yet.
 */
import type { EvalRequest, EvalResponse } from "@boni/sandbox";

/**
 * One call, start to end. `module` is the interpreter already compiled (the box compiles it once). It never throws
 * and never rejects: whatever the code does is in the answer.
 */
export function evaluateCall(
  req: EvalRequest,
  opts: { module?: WebAssembly.Module } = {},
): Promise<EvalResponse> {
  throw new Error(
    `boni-sandbox: evaluateCall(${req.kind}, ${typeof opts.module}) is not built yet (F14c)`,
  );
}
