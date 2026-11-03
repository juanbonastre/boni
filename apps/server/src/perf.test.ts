// The minute's line about slowness (task 35): what it counts and what it never says.
import { afterEach, describe, expect, it } from "vitest";
import {
  type CpuProfile,
  holdWatcher,
  longestHold,
  minuteLine,
  noteRequest,
  resetSlowness,
  SLOW_REQUEST_MS,
  timed,
} from "./perf.ts";

describe("the minute's line about slowness", () => {
  afterEach(() => resetSlowness());
  it("counts slow requests by route and slow named work, the worst first; then starts again", () => {
    noteRequest("GET /api/changes", SLOW_REQUEST_MS + 200);
    noteRequest("GET /api/changes", SLOW_REQUEST_MS + 900);
    noteRequest("GET /api/snapshot", SLOW_REQUEST_MS - 1); // fast enough: not counted
    noteRequest("GET /api/stream", 60_000); // a live stream is not slow
    const busy = () => {
      const end = performance.now() + 30;
      while (performance.now() < end);
      return 1;
    };
    expect(timed("calendar poll", 10, busy)).toBe(1);
    const line = minuteLine(1200, 300);
    expect(line).toMatch(
      /^slow in the last minute: GET \/api\/changes 2× \(max 1900 ms\); calendar poll 1× \(max \d+ ms\); event loop held up to 1200 ms \(p99 300 ms\)$/,
    );
    expect(minuteLine(10, 5)).toBeNull();
    expect(minuteLine(800, 40)).toBe(
      "slow in the last minute: nothing named; event loop held up to 800 ms (p99 40 ms)",
    );
  });

  it("says what held the loop longest, from a CPU profile: Boni's three innermost functions, or V8's own (task 43)", () => {
    const frame = (id: number, functionName: string, url = "", children?: number[]) => ({
      id,
      callFrame: { functionName, url, lineNumber: 0 },
      children,
    });
    const ms10 = (n: number) => Array.from({ length: n }, () => 10_000);
    const nodes = [
      frame(1, "(root)", "", [2, 3, 6]),
      frame(2, "(idle)"),
      frame(3, "handle", "file:///app/apps/server/src/http.ts", [4]),
      frame(4, "listTypes", "file:///app/apps/server/src/data.ts", [5]),
      frame(5, "entities", "file:///app/packages/store/src/store.ts", [7]),
      frame(6, "(garbage collector)"),
      frame(7, "all"), // SQLite's, not Boni's: left out of the chain
    ];
    const profile: CpuProfile = {
      nodes,
      samples: [2, 2, 7, 7, 7, 4, 2, 6, 6, 2],
      timeDeltas: ms10(10),
    };
    expect(longestHold(profile)).toEqual({
      ms: 40,
      what: "store.ts entities ← data.ts listTypes ← http.ts handle",
      share: 0.75,
    });
    expect(longestHold({ nodes, samples: [2, 6, 6, 6, 2], timeDeltas: ms10(5) })).toEqual({
      ms: 30,
      what: "(garbage collector)",
      share: 1,
    });
    expect(longestHold({ nodes, samples: [2, 2], timeDeltas: ms10(2) })).toBeNull();
    // None of Boni's: a package by its name, or a script by its file's.
    const others = [
      frame(1, "(root)", "", [2, 8, 10]),
      frame(2, "(idle)"),
      frame(
        8,
        "fetch",
        "file:///app/node_modules/.pnpm/imapflow@1.0.0/node_modules/imapflow/lib/imap-flow.js",
        [9],
      ),
      frame(9, "now"),
      frame(10, "busy", "file:///tmp/ejemplo/busy.mjs"),
    ];
    expect(longestHold({ nodes: others, samples: [2, 9, 9, 2], timeDeltas: ms10(4) })?.what).toBe(
      "imapflow fetch",
    );
    expect(longestHold({ nodes: others, samples: [2, 10, 2], timeDeltas: ms10(3) })?.what).toBe(
      "busy.mjs busy",
    );
    expect(
      minuteLine(980, 22, { ms: 900, what: "data.ts listTypes ← http.ts handle", share: 0.8 }),
    ).toBe(
      "slow in the last minute: nothing named; event loop held up to 980 ms (p99 22 ms); held longest by data.ts listTypes ← http.ts handle (900 ms, 80 % of it)",
    );
    // A short hold is no news: the line stays as it was.
    expect(minuteLine(100, 5, { ms: 90, what: "x", share: 1 })).toBeNull();
  });

  it("profiles the thread only while it is held, and names the function that held it", async () => {
    const failures: string[] = [];
    const watcher = holdWatcher((why) => failures.push(why));
    expect(watcher).not.toBeNull();
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    function holdTheLoop() {
      const end = performance.now() + 600;
      while (performance.now() < end);
    }
    // A busy machine (the CI's) starts the thread slowly: what is waited for is waited for, not a fixed time.
    const ready = await Promise.race([
      watcher?.ready.then(() => "watching"),
      wait(15_000).then(() => "not started"),
    ]);
    expect({ ready, failures }).toEqual({ ready: "watching", failures: [] });
    await wait(50);
    expect(watcher?.take()).toBeNull();
    holdTheLoop();
    // The watchdog sees the loop beat again, stops the profile and sends it.
    let hold = null;
    for (let i = 0; i < 300 && !hold; i++) {
      await wait(50);
      hold = watcher?.take() ?? null;
    }
    await watcher?.stop();
    expect(failures).toEqual([]);
    expect(hold?.ms).toBeGreaterThan(200);
    expect(hold?.what).toMatch(/holdTheLoop/);
  }, 40_000);
});
