import { type ReactNode, useState } from "react";
import { t } from "../i18n.ts";
import { RemoteError } from "../remote.ts";
import { useApp } from "../store.ts";

function Row({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting">
      <div className="setting-label">
        <span>{label}</span>
        {hint && <small className="muted">{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** Settings → Data with a server: log this device in, see the connection, log out. */
export function ServerSettings() {
  const cfg = useApp((s) => s.settings.server);
  const remote = useApp((s) => s.remote);
  const notes = useApp((s) => s.vault.notes);
  const [url, setUrl] = useState(cfg?.url ?? "https://");
  const [user, setUser] = useState(cfg?.user ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await useApp.getState().connectServer(url, user.trim(), password);
      setPassword("");
    } catch (e) {
      setError(
        e instanceof RemoteError && e.kind === "unauthorized"
          ? t("server.badLogin")
          : t("server.unreachable", { message: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setBusy(false);
    }
  };

  const status =
    remote.status === "live"
      ? t("server.status.live", { n: notes })
      : remote.status === "offline"
        ? t("server.status.offline")
        : remote.status === "login"
          ? t("server.status.login")
          : t("server.status.connecting");

  if (cfg && remote.status !== "login") {
    return (
      <Row label={t("server.connected", { user: cfg.user })} hint={`${cfg.url} · ${status}`}>
        <button
          type="button"
          className="btn"
          onClick={() => void useApp.getState().disconnectServer()}
        >
          {t("server.disconnect")}
        </button>
      </Row>
    );
  }
  const ready = /^https?:\/\/\S+$/i.test(url.trim()) && user.trim() !== "" && password !== "";
  return (
    <div className="server-form">
      {remote.status === "login" && <p className="muted small">{t("server.status.login")}</p>}
      <Row label={t("server.url")}>
        <input
          className="field-input"
          value={url}
          spellCheck={false}
          autoComplete="url"
          onChange={(e) => setUrl(e.target.value)}
        />
      </Row>
      <Row label={t("server.user")}>
        <input
          className="field-input"
          value={user}
          autoComplete="username"
          onChange={(e) => setUser(e.target.value)}
        />
      </Row>
      <Row label={t("server.password")}>
        <input
          className="field-input"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ready && void connect()}
        />
      </Row>
      {error && <p className="small server-error">{error}</p>}
      <div className="ext-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!ready || busy}
          onClick={() => void connect()}
        >
          {busy ? t("server.status.connecting") : t("server.connect")}
        </button>
      </div>
    </div>
  );
}
