/**
 * A run drawn in the conversation (task 92; Juan, 2026-11-06: «dibujar el diagrama metiendo esa vista de mapa dentro del
 * chat, de una forma sencilla; ya si quiero tocar opciones haría clic en un botón de ampliar»): its way as the map
 * draws it, in order and in orange (what brought it, the collection it came into, the flow, the Bandeja, where it was
 * accepted or written), each box with what was this run's, and «Ampliar», which opens the map with the run on it. Names
 * are the map's; what came from a mail or a model stays text.
 */
import { Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { MapView, RunDetail } from "../core/agent.ts";
import { mapNodeName, runStatusLine } from "../core/runText.ts";
import { agentApi, showRun, useStore } from "../store.ts";

/** The map's names, asked once while the app is open: a run drawn in a chat names its boxes as the map does. */
let mapOnce: Promise<MapView | null> | null = null;
const mapNames = () => {
  mapOnce ??= agentApi.map(7).catch(() => {
    mapOnce = null;
    return null;
  });
  return mapOnce;
};

export function RunPath({ run: id, caption }: { run: string; caption?: React.ReactNode }) {
  const t = useStore((s) => s.t);
  const [d, setD] = useState<RunDetail | null | "loading">("loading");
  const [map, setMap] = useState<MapView | null>(null);
  useEffect(() => {
    let on = true;
    agentApi.runDetail(id).then(
      (x) => on && setD(x),
      () => on && setD(null),
    );
    void mapNames().then((m) => on && setMap(m));
    return () => {
      on = false;
    };
  }, [id]);
  if (d === "loading") return <div className="run-path muted small">{t("run.path.loading")}</div>;
  if (!d) return null;
  const name = (node: string, fallback: string) => {
    const n = map?.nodes.find((x) => x.id === node);
    return n ? mapNodeName(t, n) : fallback;
  };
  const owner = d.owner ?? (d.flow ? `flow:${d.flow}` : "boni:chat");
  const boxes: { id: string; name: string; line: string | null }[] = [];
  if (d.input) {
    const into = `col:${d.input.type}`;
    // What brought it: the mail's connector.
    const brings = map?.edges.find((e) => e.kind === "brings" && e.to === into);
    if (brings) boxes.push({ id: brings.from, name: name(brings.from, ""), line: null });
    boxes.push({ id: into, name: d.input.collection, line: `«${d.input.title || "…"}»` });
  }
  boxes.push({
    id: owner,
    name: name(owner, d.flow ?? t("map.node.chat")),
    line: runStatusLine(t, d.status),
  });
  if (d.proposals.length)
    boxes.push({
      id: "boni:inbox",
      name: name("boni:inbox", t("map.node.inbox")),
      line:
        d.proposals.length === 1
          ? `«${d.proposals[0]?.title || "…"}» · ${t(`log.proposal.${d.proposals[0]?.status}`)}`
          : t("run.path.proposals", { n: d.proposals.length }),
    });
  const ends = new Map<string, string | null>();
  for (const p of d.proposals)
    if (p.status === "accepted" && p.type)
      ends.set(`col:${p.type}`, p.record?.title ?? p.title ?? null);
  for (const c of d.changes)
    if (c.type && !ends.has(`col:${c.type}`)) ends.set(`col:${c.type}`, c.title);
  for (const [col, line] of ends)
    boxes.push({ id: col, name: name(col, ""), line: line ? `«${line}»` : null });
  const shown = boxes.filter((b) => b.name);
  return (
    <div
      className="run-path"
      role="group"
      aria-label={t("run.path.title")}
      style={{ "--way-n": Math.max(0, shown.length - 1) } as React.CSSProperties}
    >
      {caption}
      <ol className="run-path-way">
        {shown.map((b, i) => (
          <li
            key={`${b.id}:${i}`}
            className="run-path-box"
            style={{ "--way-i": i } as React.CSSProperties}
          >
            <strong>{b.name}</strong>
            {b.line && <span className="muted">{b.line}</span>}
          </li>
        ))}
      </ol>
      <button type="button" className="link-btn small run-path-open" onClick={() => showRun(id)}>
        <Maximize2 size={13} strokeWidth={1.8} aria-hidden />
        {t("run.path.open")}
      </button>
    </div>
  );
}
