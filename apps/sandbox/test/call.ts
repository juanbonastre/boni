// The tests' way to make a request, as Boni's server makes them (the code's hash computed from it).
import { createHash } from "node:crypto";
import type { RunRequest } from "@boni/sandbox";

/** A request for `fn` in `code`, as Boni's server makes them. */
export const call = (code: string, fn: string, input: unknown, more: Partial<RunRequest> = {}) =>
  ({
    id: "prueba",
    code,
    hash: createHash("sha256").update(code).digest("hex"),
    fn,
    input,
    day: "2026-10-30",
    seed: 42,
    ...more,
  }) as RunRequest;
