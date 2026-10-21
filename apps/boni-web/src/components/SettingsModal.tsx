import { ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AI_LEVELS,
  type AiLevel,
  type MailGuide,
  type MailView,
  type Visibility,
} from "../core/agent.ts";
import { host, type Theme } from "../host.ts";
import type { Lang } from "../i18n.ts";
import {
  changeVisibility,
  checkMail,
  configured,
  forgetMail,
  loadMail,
  loadMailGuide,
  loadVisibility,
  login,
  logout,
  openSettings,
  rereadMail,
  saveMail,
  saveMailGuide,
  saveSettings,
  suggestedDevice,
  toast,
  useStore,
} from "../store.ts";

/** Settings (Boni Calendar's modal): account, appearance and, on the desktop, the tray and the widgets. */
export function SettingsModal() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const close = () => openSettings(false);
  const linked = configured(settings);
  type Section = "account" | "ai" | "mail" | "data" | "appearance" | "desktop";
  const sections: Section[] = [
    "account",
    ...(linked ? (["ai", "mail"] as const) : []),
    ...(linked && host.saveExport ? (["data"] as const) : []),
    "appearance",
    ...(host.desktop ? (["desktop"] as const) : []),
  ];
  const [chosen, setSection] = useState<Section>("account");
  const section: Section = sections.includes(chosen) ? chosen : "account";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <div className="modal-head">
          <h2>{t("settings.title")}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={close}
            title={t("settings.close")}
            aria-label={t("settings.close")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <div className="settings-layout">
          <div className="settings-nav" role="tablist" aria-label={t("settings.title")}>
            {sections.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`settings-tab-${id}`}
                aria-selected={section === id}
                aria-controls="settings-pane"
                className={section === id ? "on" : ""}
                onClick={() => setSection(id)}
              >
                {t(`settings.section.${id}`)}
              </button>
            ))}
          </div>
          <div
            className="modal-body settings-pane"
            id="settings-pane"
            role="tabpanel"
            aria-labelledby={`settings-tab-${section}`}
          >
            <h3>{t(`settings.section.${section}`)}</h3>
            {section === "account" && <Account />}
            {section === "ai" && <AiVisibility />}
            {section === "mail" && <MailSettings />}
            {section === "data" && <ExportData />}
            {section === "appearance" && <Appearance />}
            {section === "desktop" && <DesktopSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Apariencia": theme and language. */
function Appearance() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  return (
    <>
      <div className="setting">
        <div className="setting-label">{t("settings.theme")}</div>
        <div className="setting-control">
          <div className="segmented">
            {(["dark", "light", "system"] as Theme[]).map((th) => (
              <button
                key={th}
                type="button"
                className={settings.theme === th ? "on" : ""}
                onClick={() => void saveSettings({ theme: th })}
              >
                {t(`settings.theme.${th}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="setting">
        <div className="setting-label">{t("settings.language")}</div>
        <div className="setting-control">
          <div className="segmented">
            {(
              [
                ["es", "Español"],
                ["en", "English"],
              ] as [Lang, string][]
            ).map(([l, label]) => (
              <button
                key={l}
                type="button"
                className={settings.language === l ? "on" : ""}
                onClick={() => void saveSettings({ language: l })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** "Escritorio" (the desktop shell only): start with the computer, the widgets on the desktop. */
function DesktopSettings() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  return (
    <>
      <div className="setting">
        <div className="setting-label">
          <span>{t("settings.autostart")}</span>
          <span className="muted small">{t("settings.autostartHelp")}</span>
        </div>
        <div className="setting-control">
          <input
            type="checkbox"
            className="switch"
            aria-label={t("settings.autostart")}
            checked={settings.autostart}
            onChange={(e) => void saveSettings({ autostart: e.target.checked })}
          />
        </div>
      </div>
      <div className="setting">
        <div className="setting-label">
          <span>{t("settings.showWidgets")}</span>
          <span className="muted small">
            {settings.layerAvailable ? t("settings.widgetsHelp") : t("settings.layerMissing")}
          </span>
        </div>
        <div className="setting-control">
          <input
            type="checkbox"
            className="switch"
            aria-label={t("settings.showWidgets")}
            checked={settings.showWidgets}
            onChange={(e) => void saveSettings({ showWidgets: e.target.checked })}
          />
        </div>
      </div>
      <div className="setting">
        <div className="setting-label">{t("settings.resetWidgets")}</div>
        <div className="setting-control">
          <button
            type="button"
            className="btn"
            onClick={() => void saveSettings({ showWidgets: true, resetWidgets: true })}
          >
            {t("settings.reset")}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * A group that opens and closes (a disclosure): its title and a one-line summary of what is inside, so
 * the section shows the common things first and the rest one click away.
 */
function Disclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`disclosure${open ? " open" : ""}`}>
      <button
        type="button"
        className="disclosure-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className="disclosure-chevron" size={14} strokeWidth={2} />
        <span className="disclosure-title">{title}</span>
        {summary && <span className="muted small disclosure-summary">{summary}</span>}
      </button>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}

/**
 * The account, as Boni Calendar's "Data → Server": logged in ("Logged in as juan · portatil", live or not, Log out),
 * or the login form (address, user, password, this device's name). An old device token works, but asks to log in.
 */
function Account() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const loggedIn = configured(settings) && Boolean(settings.user) && !settings.sessionEnded;
  const [form, setForm] = useState({
    serverUrl: settings.serverUrl,
    user: settings.user,
    password: "",
    device: settings.device,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loggedIn || form.device) return;
    void suggestedDevice().then((device) => setForm((f) => (f.device ? f : { ...f, device })));
  }, [loggedIn]);

  if (loggedIn) {
    return (
      <div className="setting">
        <div className="setting-label">
          <span>{t("account.as", { user: settings.user, device: settings.device })}</span>
          <span className="muted small">
            {settings.serverUrl}
            {host.desktop ? ` · ${settings.live ? t("account.live") : t("account.notLive")}` : ""}
          </span>
        </div>
        <div className="setting-control">
          <button type="button" className="btn" onClick={() => void logout()}>
            {t("account.logout")}
          </button>
        </div>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await login(form);
    setBusy(false);
    if (r.ok) {
      setForm((f) => ({ ...f, password: "" }));
      toast(t("account.welcome", { user: r.settings.user }));
    } else setError(t(`account.error.${r.code}`));
  };
  return (
    <form
      className="server-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {(settings.legacyToken || settings.sessionEnded) && (
        <p className="notice">
          {settings.sessionEnded ? t("account.endedHelp") : t("account.legacyHelp")}
        </p>
      )}
      <label className="field">
        <span className="field-label">{t("settings.url")}</span>
        <input
          className="input"
          value={form.serverUrl}
          placeholder="https://boni.example.ts.net"
          autoComplete="url"
          onChange={set("serverUrl")}
        />
      </label>
      <div className="field-pair">
        <label className="field">
          <span className="field-label">{t("account.user")}</span>
          <input
            className="input"
            value={form.user}
            autoComplete="username"
            onChange={set("user")}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("account.password")}</span>
          <input
            className="input"
            type="password"
            value={form.password}
            autoComplete="current-password"
            onChange={set("password")}
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">{t("account.device")}</span>
        <input className="input" value={form.device} onChange={set("device")} />
        <span className="field-help">{t("account.deviceHelp")}</span>
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button
          type="submit"
          className="btn primary"
          disabled={
            busy ||
            !form.serverUrl.trim() ||
            !form.user.trim() ||
            !form.password ||
            !form.device.trim()
          }
        >
          {busy ? t("account.loggingIn") : t("account.login")}
        </button>
      </div>
    </form>
  );
}

/** "Tus datos": everything of the account in one zip of open formats, in one click. */
function ExportData() {
  const t = useStore((s) => s.t);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = (await host.saveExport?.()) ?? "error";
      toast(t(`export.${r}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="setting">
        <div className="setting-label">
          <span>{t("export.label")}</span>
          <span className="muted small">{t("export.help")}</span>
        </div>
        <div className="setting-control">
          <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
            {busy ? t("export.busy") : t("export.button")}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * "Lo que ve la IA": per collection, what the models may see (docs/nucleo.md 7.3). Juan's choice only:
 * the agent has no tool for it, and the server takes it from a personal device only.
 */
function AiVisibility() {
  const t = useStore((s) => s.t);
  const [types, setTypes] = useState<Visibility[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadVisibility().then((v) => live && setTypes(v));
    return () => {
      live = false;
    };
  }, []);
  const choose = async (id: string, level: AiLevel) => {
    const before = types;
    setTypes((ts) => ts?.map((x) => (x.id === id ? { ...x, level } : x)) ?? ts);
    if (!(await changeVisibility(id, level))) setTypes(before);
  };
  return (
    <>
      <p className="muted small setting-note">{t("ai.help")}</p>
      {types === undefined ? null : types === null ? (
        <p className="muted small setting-note">{t("ai.off")}</p>
      ) : (
        <>
          <ul className="legend small muted">
            {AI_LEVELS.map((l) => (
              <li key={l}>
                <strong>{t(`ai.level.${l}`)}</strong>: {t(`ai.level.${l}.help`)}
              </li>
            ))}
          </ul>
          {types.map((v) => (
            <div className="setting" key={v.id}>
              <div className="setting-label">
                <span>{v.name}</span>
                <span className="muted small">{t("ai.count", { n: v.count })}</span>
              </div>
              <div className="setting-control">
                <select
                  className="input auto-width"
                  aria-label={v.name}
                  value={v.level}
                  onChange={(e) => void choose(v.id, e.target.value as AiLevel)}
                >
                  {AI_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {t(`ai.level.${l}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/**
 * "Correo": the account's mailbox (docs/nucleo.md, mail as a source). Boni reads it, read-only, every few
 * minutes; each new mail lands in "Correos" as outside text and the tasks it asks become proposals in the
 * inbox, into one of the collections marked here (the AI picks which). The password is sent once and never
 * comes back; the server tries the connection before it keeps anything.
 */
function MailSettings() {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [mail, setMail] = useState<MailView | null | undefined>(undefined);
  const [types, setTypes] = useState<Visibility[] | null>(null);
  const [form, setForm] = useState({
    host: "imap.gmail.com",
    user: "",
    password: "",
    folder: "INBOX",
  });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(7);
  const [rereading, setRereading] = useState(false);
  useEffect(() => {
    let live = true;
    void loadMail().then((m) => live && setMail(m));
    void loadVisibility().then((v) => live && setTypes(v));
    return () => {
      live = false;
    };
  }, []);
  if (mail === undefined) return null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await saveMail({
      host: form.host.trim(),
      user: form.user.trim(),
      folder: form.folder.trim() || "INBOX",
      ...(form.password ? { password: form.password } : {}),
    });
    setBusy(false);
    if ("error" in r) return setError(t(`mail.error.${r.error}`));
    setMail(r);
    setEditing(false);
    setForm((f) => ({ ...f, password: "" }));
    toast(t("mail.connected"));
  };
  const toggle = async (id: string, on: boolean) => {
    if (!mail) return;
    const collections = on ? [...mail.collections, id] : mail.collections.filter((c) => c !== id);
    setMail({ ...mail, collections });
    const r = await saveMail({ collections });
    if ("error" in r) {
      setMail(mail);
      toast(t(`mail.error.${r.error}`));
    } else setMail(r);
  };
  const when = (ms: number) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(ms);
  return (
    <>
      <p className="muted small setting-note">{t("mail.help")}</p>
      {mail && !editing ? (
        <>
          <div className="setting">
            <div className="setting-label">
              <span>{t("mail.connectedAs", { user: mail.user })}</span>
              <span className="muted small">
                {mail.state.lastError
                  ? t(`mail.error.${mail.state.lastError}`)
                  : mail.state.lastCheck
                    ? t("mail.state", { when: when(mail.state.lastCheck), n: mail.state.count })
                    : t("mail.never")}
              </span>
            </div>
            <div className="setting-control">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const m = await checkMail();
                  setBusy(false);
                  if (m) setMail(m);
                }}
              >
                {busy ? t("mail.checking") : t("mail.check")}
              </button>
            </div>
          </div>
          {(() => {
            const offered = (types ?? []).filter(
              (v) => v.level !== "hidden" && v.id !== mail.state.type,
            );
            const marked = offered.filter((v) => mail.collections.includes(v.id));
            return (
              <Disclosure
                title={t("mail.collections.title")}
                summary={
                  marked.length ? marked.map((v) => v.name).join(", ") : t("mail.collections.none")
                }
                defaultOpen={types !== null && !marked.length}
              >
                <p className="muted small setting-note">{t("mail.collections")}</p>
                {offered.map((v) => (
                  <div className="setting" key={v.id}>
                    <div className="setting-label">{v.name}</div>
                    <div className="setting-control">
                      <input
                        type="checkbox"
                        className="switch"
                        aria-label={v.name}
                        checked={mail.collections.includes(v.id)}
                        onChange={(e) => void toggle(v.id, e.target.checked)}
                      />
                    </div>
                  </div>
                ))}
              </Disclosure>
            );
          })()}
          <MailGuideSettings
            collections={(types ?? []).filter((v) => mail.collections.includes(v.id))}
          />
          <Disclosure title={t("mail.more")}>
            <div className="setting">
              <div className="setting-label">
                <span>{t("mail.reread")}</span>
                <span className="muted small">{t("mail.reread.help")}</span>
              </div>
              <div className="setting-control with-gap">
                <select
                  className="input auto-width"
                  aria-label={t("mail.reread.days")}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {[1, 3, 7, 14, 30].map((d) => (
                    <option key={d} value={d}>
                      {t("mail.reread.option", { n: d })}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  disabled={rereading}
                  onClick={async () => {
                    setRereading(true);
                    await rereadMail(days);
                    setRereading(false);
                  }}
                >
                  {t("mail.reread.go")}
                </button>
              </div>
            </div>
            <div className="setting">
              <div className="setting-label">
                <span>{t("mail.box")}</span>
                <span className="muted small">
                  {mail.host} · {mail.folder}
                </span>
              </div>
              <div className="setting-control with-gap">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      host: mail.host,
                      user: mail.user,
                      folder: mail.folder,
                    }));
                    setEditing(true);
                  }}
                >
                  {t("mail.change")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    if (await forgetMail()) setMail(null);
                  }}
                >
                  {t("mail.forget")}
                </button>
              </div>
            </div>
          </Disclosure>
        </>
      ) : (
        <form
          className="server-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="field-pair">
            <label className="field">
              <span className="field-label">{t("mail.server")}</span>
              <input className="input" value={form.host} onChange={set("host")} />
            </label>
            <label className="field">
              <span className="field-label">{t("mail.folder")}</span>
              <input className="input" value={form.folder} onChange={set("folder")} />
            </label>
          </div>
          <div className="field-pair">
            <label className="field">
              <span className="field-label">{t("mail.user")}</span>
              <input
                className="input"
                value={form.user}
                autoComplete="off"
                placeholder="nombre@example.com"
                onChange={set("user")}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("mail.password")}</span>
              <input
                className="input"
                type="password"
                value={form.password}
                autoComplete="new-password"
                onChange={set("password")}
              />
            </label>
          </div>
          <span className="field-help">{t("mail.passwordHelp")}</span>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            {mail && (
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                {t("mail.cancel")}
              </button>
            )}
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !form.host.trim() || !form.user.trim() || (!mail && !form.password)}
            >
              {busy ? t("mail.connecting") : t("mail.connect")}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

/**
 * "Guía de lectura" (docs/nucleo.md 7.4b): Juan's words for the reader, the rules the code applies
 * (never read a sender, or send what it asks to one collection) and the examples kept from his decisions
 * (removable here, never written here).
 */
function MailGuideSettings({ collections }: { collections: Visibility[] }) {
  const t = useStore((s) => s.t);
  const [guide, setGuide] = useState<MailGuide | null>(null);
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [action, setAction] = useState("skip");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadMailGuide().then((g) => {
      if (!live || !g) return;
      setGuide(g);
      setText(g.instructions);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!guide) return null;
  const save = async (input: Parameters<typeof saveMailGuide>[0], done?: string) => {
    setError(null);
    const r = await saveMailGuide(input);
    if ("error" in r) return setError(t(`mail.guide.error.${r.error}`));
    setGuide(r);
    if (done) toast(t(done));
  };
  const nameOf = (id?: string) => collections.find((c) => c.id === id)?.name ?? id ?? "";
  const summary = [
    guide.instructions ? t("mail.guide.hasText") : "",
    guide.rules.length ? t("mail.guide.nRules", { n: guide.rules.length }) : "",
    guide.examples.length ? t("mail.guide.nExamples", { n: guide.examples.length }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Disclosure title={t("mail.guide.title")} summary={summary || t("mail.guide.empty")}>
      <p className="muted small setting-note">{t("mail.guide.help")}</p>
      <div className="setting stacked">
        <label className="setting-label" htmlFor="mail-guide-text">
          <span>{t("mail.guide.instructions")}</span>
        </label>
        <textarea
          id="mail-guide-text"
          className="input area"
          maxLength={2000}
          value={text}
          placeholder={t("mail.guide.placeholder")}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="setting-control">
          <button
            type="button"
            className="btn"
            disabled={text.trim() === guide.instructions}
            onClick={() => void save({ instructions: text }, "mail.guide.saved")}
          >
            {t("mail.guide.save")}
          </button>
        </div>
      </div>
      <p className="muted small setting-note">{t("mail.guide.rules")}</p>
      {guide.rules.map((r) => (
        <div className="setting" key={r.id}>
          <div className="setting-label">
            <span className="breakable">{r.from}</span>
            <span className="muted small">
              {r.action === "skip"
                ? t("mail.guide.skip")
                : t("mail.guide.to", { name: nameOf(r.collection) })}
            </span>
          </div>
          <div className="setting-control">
            <button
              type="button"
              className="btn"
              onClick={() => void save({ rules: guide.rules.filter((x) => x.id !== r.id) })}
            >
              {t("mail.guide.remove")}
            </button>
          </div>
        </div>
      ))}
      <div className="setting">
        <div className="setting-control with-gap grow">
          <input
            className="input"
            aria-label={t("mail.guide.from")}
            placeholder={t("mail.guide.from")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <select
            className="input auto-width"
            aria-label={t("mail.guide.action")}
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="skip">{t("mail.guide.skip")}</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {t("mail.guide.to", { name: c.name })}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={!from.trim()}
            onClick={async () => {
              const rule =
                action === "skip"
                  ? { from: from.trim(), action: "skip" as const }
                  : { from: from.trim(), action: "collection" as const, collection: action };
              await save({ rules: [...guide.rules, rule] });
              setFrom("");
            }}
          >
            {t("mail.guide.add")}
          </button>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {guide.examples.length > 0 && (
        <>
          <p className="muted small setting-note">{t("mail.guide.examples")}</p>
          {guide.examples.map((e) => (
            <div className="setting" key={e.id}>
              <div className="setting-label">
                <span>{e.subject}</span>
                <span className="muted small">
                  {e.want.length ? e.want.map((w) => w.title).join(" · ") : t("mail.guide.nothing")}
                </span>
              </div>
              <div className="setting-control">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void save({
                      keepExamples: guide.examples.filter((x) => x.id !== e.id).map((x) => x.id),
                    })
                  }
                >
                  {t("mail.guide.remove")}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </Disclosure>
  );
}
