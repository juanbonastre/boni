/**
 * One evaluation of an automation's JavaScript in a QuickJS interpreter of its own (docs/automatizaciones.md AU-160;
 * protocol 2, packages/sandbox/src/evaluate.ts): the box's half. As run.ts does for an extension's function: a new
 * interpreter with a memory of its own, the limits, and nothing of Boni or of the machine reachable from inside. What
 * is new: expressions and «Código» over a batch of rows, what the code may name (world.js, which runs inside), the
 * console collected, a read that stops the evaluation when the request does not bring it, and a world that one row's
 * evaluation cannot change for the next (world.js's `received`, AU-37).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type EvalLimits,
  type EvalRequest,
  type EvalResponse,
  evalLimitsOf,
  MAX_READ_BYTES,
  type RunError,
  shortMessage,
  type WireConsoleLine,
  type WireEvaluated,
  type WireRead,
} from "@boni/sandbox";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSRuntime,
  RELEASE_SYNC,
} from "quickjs-emscripten";
import { compiledQuickJS, memoryFor } from "./run.ts";

/** What runs inside before the code: a function the host calls with the request and its own four functions. */
const WORLD = readFileSync(new URL("./world.js", import.meta.url), "utf8");

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** JSON with its keys in order: the same read, however it was written, has one key. */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
};
/** A read's key: what Boni's server hands back with what it read (at most `MAX_READ_KEY` characters). */
export const readKey = (read: WireRead): string => sha256(canonical(read));

/** A source as world.js makes it a function with `Function`: a «Código» is the body, an expression the value it returns. */
const bodyOf = (kind: EvalRequest["kind"], source: string) =>
  kind === "code" ? `"use strict";\n${source}` : `"use strict";\nreturn (\n${source}\n)`;

/**
 * Whether a body closes the function it is put in. QuickJS's `Function` parses `(function anonymous(\n) {\n` + body +
 * `\n})` as one text, so a body like `}); …; (function () {` would run outside its function, while world.js is still
 * making the world (the case `huida.js`). The body's text is first compiled alone, which runs nothing: one that does
 * not parse is left to the world, which says where. One that parses is then made in a context of its own, with nothing
 * of the call in it, and must give back the one function its whole text is.
 */
function closesItsFunction(runtime: QuickJSRuntime, body: string): boolean {
  const text = `(function anonymous(\n) {\n${body}\n})`;
  const scratch = runtime.newContext();
  try {
    const compiled = scratch.evalCode(text, "check.js", { compileOnly: true });
    if (compiled.error) {
      compiled.error.dispose();
      return false;
    }
    compiled.value.dispose();
    // What it uses is taken before the text runs, so a body that ran outside cannot change the answer.
    const check = `(() => { "use strict"; const apply = Reflect.apply, show = Function.prototype.toString, make = eval;
      let f; try { f = make(${JSON.stringify(text)}); } catch { return false; }
      if (typeof f !== "function") return false;
      try { return apply(show, f, []) === ${JSON.stringify(text.slice(1, -1))}; } catch { return false; } })()`;
    const r = scratch.evalCode(check, "check.js");
    if (r.error) {
      r.error.dispose();
      return true;
    }
    const whole = scratch.dump(r.value) === true;
    r.value.dispose();
    return !whole;
  } finally {
    scratch.dispose();
  }
}

const MEMORY = /out of memory|\bOOM\b|memory access out of bounds|Cannot enlarge memory/i;
const LEVELS = new Set(["log", "info", "warn", "error"]);

const fail = (
  id: string,
  error: RunError,
  message: unknown,
  more: { row?: number; steps?: number; ms?: number } = {},
): EvalResponse => ({ id, ok: false, error, message: shortMessage(message), ...more });

/**
 * One call, start to end. `module` is the interpreter already compiled (the box compiles it once). It never throws
 * and never rejects: whatever the code does is in the answer.
 */
export async function evaluateCall(
  req: EvalRequest,
  opts: { module?: WebAssembly.Module } = {},
): Promise<EvalResponse> {
  try {
    return await evaluate(req, opts);
  } catch (e) {
    return fail(req.id, "exception", e instanceof Error ? e.message : e);
  }
}

async function evaluate(
  req: EvalRequest,
  opts: { module?: WebAssembly.Module },
): Promise<EvalResponse> {
  const limits: EvalLimits = evalLimitsOf(req);
  if (sha256(req.sources.join("\n")) !== req.hash)
    return fail(req.id, "invalid", "el código no es el de su huella");
  const perRow = req.mode === "perRow";
  let started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let steps = 0;
  let stopped: "steps" | "timeout" | null = null;
  let deadline = Number.POSITIVE_INFINITY;
  /** Set by the world inside when an evaluation must stop where it is: the interpreter is then interrupted. */
  const halted: {
    now: { state: "needs"; key: string; read: WireRead } | { state: "reads" } | null;
  } = {
    now: null,
  };
  let outputBytes = 0;
  let tooBig = false;
  const QuickJS = await newQuickJSWASMModuleFromVariant(
    newVariant(RELEASE_SYNC, {
      wasmModule: opts.module ?? (await compiledQuickJS()),
      wasmMemory: memoryFor(limits.memoryBytes),
    }),
  );
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(() => {
    steps++;
    if (steps > limits.steps) stopped = "steps";
    else if (Date.now() > deadline) stopped = "timeout";
    return stopped !== null || halted.now !== null || tooBig;
  });
  const vm = runtime.newContext();

  const evaluations: WireEvaluated[] = [];
  const lines: WireConsoleLine[] = [];
  let dropped = 0;
  /** The evaluation being made (its index in `evaluations`), and the console as it was when it started. */
  let current = 0;
  let mark = { lines: 0, dropped: 0 };
  const placeOf = (i: number) => (perRow ? req.from + i : undefined);

  const log = vm.newFunction("__boni_log", (levelH, textH, lineH) => {
    if (lines.length >= limits.consoleLines) {
      dropped++;
      return;
    }
    const level = vm.getString(levelH);
    const line = vm.getNumber(lineH);
    const row = placeOf(current);
    lines.push({
      level: (LEVELS.has(level) ? level : "log") as WireConsoleLine["level"],
      text: vm.getString(textH).slice(0, limits.consoleLineChars),
      ...(line >= 1 ? { line } : {}),
      ...(row !== undefined ? { row } : {}),
    });
  });
  const read = vm.newFunction("__boni_read", (textH) => {
    const asked = JSON.parse(vm.getString(textH)) as WireRead;
    const key = readKey(asked);
    if (Object.hasOwn(req.reads, key)) return vm.newString(JSON.stringify(req.reads[key]));
    halted.now = { state: "needs", key, read: asked };
    return vm.newString("");
  });
  const stop = vm.newFunction("__boni_halt", () => {
    halted.now = { state: "reads" };
  });
  const put = vm.newFunction("__boni_put", (textH) => {
    const text = vm.getString(textH);
    outputBytes += Buffer.byteLength(text);
    if (outputBytes > limits.outputBytes) {
      tooBig = true;
      return;
    }
    evaluations[current] = JSON.parse(text) as WireEvaluated;
    current++;
    mark = { lines: lines.length, dropped };
  });

  const box = (e: unknown, more: { row?: number } = {}): EvalResponse => {
    const at = { ...more, steps, ms: elapsed() };
    if (stopped === "steps") return fail(req.id, "steps", `ha usado sus ${limits.steps} pasos`, at);
    if (stopped === "timeout") return fail(req.id, "timeout", `ha pasado de ${limits.ms} ms`, at);
    if (tooBig)
      return fail(
        req.id,
        "output",
        `la respuesta pasa de ${limits.outputBytes} bytes (${outputBytes})`,
        at,
      );
    const err = (e ?? {}) as { name?: string; message?: string };
    const text = `${err.name ?? "Error"}: ${err.message ?? String(e)}`;
    if (MEMORY.test(text))
      return fail(req.id, "memory", `ha pedido más memoria de sus ${limits.memoryBytes} bytes`, at);
    return fail(req.id, "exception", text, at);
  };

  try {
    started = performance.now();
    deadline = Date.now() + limits.ms;
    const bodies = req.sources.map((s) => bodyOf(req.kind, s));
    const escaped = bodies.flatMap((b, i) => (closesItsFunction(runtime, b) ? [i] : []));
    if (stopped || tooBig) return box(null);
    const world = vm.evalCode(WORLD, "boni.js");
    if (world.error) {
      const e = vm.dump(world.error);
      world.error.dispose();
      return box(e);
    }
    // Only data goes in: the request as JSON text, without its reads (each is handed over when it is asked for).
    const config = vm.newString(
      JSON.stringify({
        kind: req.kind,
        mode: req.mode,
        sources: req.sources,
        bodies,
        escaped,
        input: req.input,
        from: req.from,
        steps: req.steps,
        now: req.now,
        zone: req.zone,
        names: req.names,
        seed: req.seed,
        run: req.run,
        limits: {
          reads: limits.reads,
          stackBytes: limits.stackBytes,
          consoleLineChars: limits.consoleLineChars,
          readBytes: MAX_READ_BYTES,
        },
      }),
    );
    const made = vm.callFunction(world.value, vm.undefined, config, log, read, stop, put);
    config.dispose();
    world.value.dispose();
    if (made.error) {
      const e = vm.dump(made.error);
      made.error.dispose();
      return box(e);
    }
    const run = made.value;
    try {
      for (;;) {
        const start = vm.newNumber(current);
        const r = vm.callFunction(run, vm.undefined, start);
        start.dispose();
        if (!r.error) {
          r.value.dispose();
          // An answer past its size is refused even when the code ended right after giving it.
          if (tooBig) return box(null, { row: placeOf(current) ?? 0 });
          break;
        }
        const e = vm.dump(r.error);
        r.error.dispose();
        const h = halted.now;
        if (stopped || tooBig || !h) return box(e, { row: placeOf(current) ?? 0 });
        // A read it does not have, or too many: this evaluation ends here, and the batch goes on with the next row.
        halted.now = null;
        if (h.state === "needs") {
          evaluations[current] = h;
          // Its lines will be written again when it is repeated with what it asked for.
          lines.length = mark.lines;
          dropped = mark.dropped;
        } else
          evaluations[current] = {
            state: "failed",
            fault: "reads",
            message: `pide más de ${limits.reads} lecturas distintas: lee la colección una vez con find y busca en ella`,
            source: 0,
          };
        current++;
        mark = { lines: lines.length, dropped };
        if (!perRow) break;
      }
    } finally {
      run.dispose();
    }
    return {
      id: req.id,
      ok: true,
      evaluations,
      console: lines,
      dropped,
      steps,
      ms: elapsed(),
    };
  } catch (e) {
    // The interpreter itself gave up (its memory, most often): this call is over, the box is not.
    return box(e instanceof Error ? { name: e.name, message: e.message } : e, {
      row: placeOf(current) ?? 0,
    });
  } finally {
    try {
      for (const f of [log, read, stop, put]) f.dispose();
      vm.dispose();
      runtime.dispose();
    } catch {
      // A call that broke its interpreter leaves it to the worker's end.
    }
  }
}
