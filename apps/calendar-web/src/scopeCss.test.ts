import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { scopeCss } from "../scopeCss.ts";

const run = (css: string, from = "/repo/apps/calendar-web/src/styles.css") =>
  postcss([scopeCss()]).process(css, { from }).css;

describe("scopeCss", () => {
  it("turns :root into the app's root and puts every other selector under it", () => {
    expect(run(":root { --bg: #000; }")).toBe(":where(.boni) { --bg: #000; }");
    expect(run(':root[data-theme="light"] .ev { --x: 1; }')).toBe(
      ':where(.boni)[data-theme="light"] .ev { --x: 1; }',
    );
    expect(run(":root.mod-select .popover { opacity: 0.3; }")).toBe(
      ":where(.boni).mod-select .popover { opacity: 0.3; }",
    );
    expect(run("button, .btn:hover { color: red; }")).toBe(
      ":where(.boni) button, :where(.boni) .btn:hover { color: red; }",
    );
    expect(run("::-webkit-scrollbar { width: 10px; }")).toBe(
      ":where(.boni) ::-webkit-scrollbar { width: 10px; }",
    );
  });

  it("scopes rules inside @container and @media, never keyframe steps", () => {
    expect(run("@container (max-height: 42px) { .ev-body { gap: 0; } }")).toBe(
      "@container (max-height: 42px) { :where(.boni) .ev-body { gap: 0; } }",
    );
    expect(run("@keyframes fade { from { opacity: 0; } to { opacity: 1; } }")).toBe(
      "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }",
    );
  });

  it("also scopes the inline import (?inline) and leaves other stylesheets alone", () => {
    expect(run("a { b: c; }", "/repo/apps/calendar-web/src/styles.css?inline")).toBe(
      ":where(.boni) a { b: c; }",
    );
    expect(run("body { margin: 0; }", "/repo/apps/calendar-web/src/page.css")).toBe(
      "body { margin: 0; }",
    );
  });
});
