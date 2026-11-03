// The line at the top of the window while the app waits: a request to the server, the connection, the calendar coming (docs/design-guide.md «Waiting», I-15).
import { t } from "../i18n.ts";
import { useApp } from "../store.ts";
import { useWaiting } from "../wait.ts";

export function WaitLine() {
  const requests = useWaiting();
  const loading = useApp((s) => s.remote.status === "connecting" || s.loaded.status === "loading");
  if (!requests && !loading) return null;
  return <div className="wait-line" role="progressbar" aria-label={t("wait.busy")} />;
}
