import type { AtRule, Plugin } from "postcss";

/**
 * Scopes the app's stylesheet under the element the app is mounted in, so it neither styles nor is
 * needed by anything around it: `:root` becomes `:where(.boni)` and every other selector is put
 * under it. `:where` adds no specificity, so the rules keep competing with each other as written.
 * Only files matching `file` are touched (the page around the standalone app has its own CSS).
 */
export function scopeCss(scope = ".boni", file = /[\\/]src[\\/]styles\.css(\?.*)?$/): Plugin {
  const root = `:where(${scope})`;
  return {
    postcssPlugin: "boni-scope-css",
    Rule(rule) {
      if (!file.test(rule.source?.input.file ?? "")) return;
      const parent = rule.parent;
      if (parent?.type === "atrule" && /keyframes$/i.test((parent as AtRule).name)) return;
      if (rule.selectors.every((s) => s.startsWith(root))) return;
      rule.selectors = rule.selectors.map((s) =>
        s.startsWith(":root") ? `${root}${s.slice(5)}` : `${root} ${s}`,
      );
    },
  };
}
