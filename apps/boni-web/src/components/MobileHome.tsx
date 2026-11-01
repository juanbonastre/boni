// Inicio on the phone (docs/design-guide.md, «El móvil»): what waits, what Juan was in, today, and his charts.
import { ChevronRight, Database, FileText, Inbox, LogIn, Plus } from "lucide-react";
import { useEffect } from "react";
import * as B from "../core/chartBuilder.ts";
import * as M from "../core/chartMath.ts";
import type { ChartSpec } from "../core/contract.ts";
import {
  configured,
  dismissRejected,
  loadInbox,
  loadToday,
  openCollection,
  openEditor,
  openPage,
  openRow,
  openRowById,
  openSettings,
  showChart,
  showTab,
  tickToday,
  useStore,
  useVisibleCharts,
} from "../store.ts";
import { useChartData } from "./ChartCard.tsx";
import { LargeTitle, Tick } from "./MobileParts.tsx";

const initials = (user: string) =>
  user
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * Inicio (Juan, 2026-10-31: «Inicio es lo de hoy»): what waits in the Bandeja, what he was in a moment ago («Seguir
 * con»), what his calendars hold today (a task with its box) and the charts he keeps on Inicio. The account's
 * initial opens the settings; captures the server could not take wait at the top until he dismisses them.
 */
export function MobileHome() {
  const t = useStore((s) => s.t);
  const settings = useStore((s) => s.settings);
  const waiting = useStore((s) => s.inbox.length + s.requests.length);
  const recent = useStore((s) => s.recent);
  const rejected = useStore((s) => s.rejected);
  const today = useStore((s) => s.today);
  const charts = useVisibleCharts().filter((c) => c.home);
  useEffect(() => {
    void loadInbox();
    void loadToday();
    // Back on the app after a while: today may be another day, and the calendars may have changed.
    const again = () => document.visibilityState === "visible" && void loadToday();
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [settings.serverUrl, settings.user]);
  if (!configured(settings))
    return (
      <main className="m-scroll center">
        <div className="empty-state">
          <img src="./favicon.png" alt="" width={56} height={56} />
          <p>{t("home.setup")}</p>
          <button type="button" className="btn primary" onClick={() => openSettings()}>
            {t("home.setupButton")}
          </button>
        </div>
      </main>
    );
  return (
    <main className="m-scroll m-screen">
      <LargeTitle
        title={t("tab.home")}
        sub={new Intl.DateTimeFormat(settings.language === "en" ? "en-GB" : "es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(new Date())}
        right={
          <button
            type="button"
            className="m-avatar"
            onClick={() => openSettings()}
            title={t("top.settings")}
            aria-label={t("top.settings")}
          >
            {initials(settings.user ?? "")}
          </button>
        }
      />
      {/* The server no longer takes this device's session: what shows is the device's copy until it signs in again. */}
      {(settings.sessionEnded || settings.legacyToken) && (
        <button type="button" className="m-banner warn" onClick={() => openSettings()}>
          <LogIn size={20} strokeWidth={1.8} />
          <span>{settings.sessionEnded ? t("account.ended") : t("account.legacy")}</span>
          <ChevronRight size={18} strokeWidth={1.8} />
        </button>
      )}
      {rejected.length > 0 && (
        <div className="m-card rejected">
          <h3>{t("queue.rejected")}</h3>
          {rejected.map((item) => (
            <div key={item.request.client_id} className="m-row-line">
              <span className="m-row-text">
                {String(item.request.values.concept ?? "")}{" "}
                {String(item.request.values.amount ?? "")}: {item.error}
              </span>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void dismissRejected(item.request.client_id)}
              >
                {t("queue.dismiss")}
              </button>
            </div>
          ))}
        </div>
      )}
      {waiting > 0 && (
        <button type="button" className="m-banner" onClick={() => showTab("inbox")}>
          <Inbox size={20} strokeWidth={1.8} />
          <span>{t("home.waiting", { n: waiting })}</span>
          <ChevronRight size={18} strokeWidth={1.8} />
        </button>
      )}
      {recent.length > 0 && (
        <section>
          <h2 className="m-label">{t("home.continue")}</h2>
          <div className="m-carousel">
            {recent.slice(0, 8).map((r) => (
              <button
                key={`${r.kind}:${r.id}`}
                type="button"
                className="m-tile"
                onClick={() => {
                  showTab("pages");
                  if (r.kind === "page") void openPage(r.id);
                  else if (r.kind === "collection") openCollection(r.id);
                  else void openRow(r.type, r.id);
                }}
              >
                {r.kind === "collection" ? (
                  <Database size={18} strokeWidth={1.8} />
                ) : (
                  <FileText size={18} strokeWidth={1.8} />
                )}
                <span>{r.title || t("page.untitled")}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {today !== null && (
        <section>
          <h2 className="m-label">{t("home.today")}</h2>
          {today.length ? (
            <ul className="m-group">
              {today.map((x) => (
                <li key={x.id} className="m-item">
                  {x.doneField && (
                    <Tick
                      on={x.done}
                      label={x.done ? t("list.undone") : t("list.done")}
                      toggle={() => void tickToday(x)}
                    />
                  )}
                  <button
                    type="button"
                    className="m-item-main"
                    onClick={() => void openRowById(x.id, x.type)}
                  >
                    <span className={`m-item-title${x.done ? " done" : ""}`}>
                      {x.title || t("page.untitled")}
                    </span>
                    <span className="m-item-sub">
                      {[x.start ?? t("home.allDay"), x.collection].join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-hint">{t("home.todayNone")}</p>
          )}
        </section>
      )}
      <section>
        <h2 className="m-label">{t("tab.charts")}</h2>
        {charts.length > 0 ? (
          <div className="m-list">
            {charts.map((spec) => (
              <ChartRow key={spec.id} spec={spec} />
            ))}
          </div>
        ) : (
          <p className="m-hint">{t("home.noCharts")}</p>
        )}
        <button
          type="button"
          className="m-add"
          onClick={() => openEditor(B.newSpec(t("charts.newTitle")), true)}
        >
          <Plus size={20} strokeWidth={1.8} />
          {t("charts.new")}
        </button>
      </section>
    </main>
  );
}

/** A chart on Inicio: its colour, name, period and total; a tap opens it on the whole screen. */
function ChartRow({ spec }: { spec: ChartSpec }) {
  const t = useStore((s) => s.t);
  const { data } = useChartData(spec.id);
  const value = data?.total != null ? M.formatAuto(data.total, data.unit ?? "EUR") : "";
  return (
    <button type="button" className="m-chart-row" onClick={() => showChart(spec.id)}>
      <span className="card-dot" style={{ background: spec.color ?? "var(--accent)" }} />
      <span className="m-chart-row-text">
        <span className="m-chart-row-name">{spec.title}</span>
        <span className="m-chart-row-sub">{B.periodLabel(t, spec.period)}</span>
      </span>
      {value && <span className="m-chart-row-value">{value}</span>}
      <ChevronRight size={20} strokeWidth={1.8} className="m-chevron" />
    </button>
  );
}
