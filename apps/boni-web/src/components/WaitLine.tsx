// The line at the top of the window while the app waits for the server or a model (docs/design-guide.md «Waiting», I-15).
import { useWaiting } from "../core/wait.ts";
import { useStore } from "../store.ts";

export function WaitLine() {
  const t = useStore((s) => s.t);
  const waiting = useWaiting();
  if (!waiting) return null;
  return <div className="wait-line" role="progressbar" aria-label={t("wait.busy")} />;
}
