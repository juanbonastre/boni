// The minute's line about slowness (task 35): what it counts and what it never says.
import { afterEach, describe, expect, it } from "vitest";
import { minuteLine, noteRequest, resetSlowness, SLOW_REQUEST_MS, timed } from "./perf.ts";

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
});
