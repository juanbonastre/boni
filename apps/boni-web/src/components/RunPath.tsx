/**
 * A run drawn in the conversation (task 92; Juan, 2026-11-06: «dibujar el diagrama metiendo esa vista de mapa dentro del
 * chat, de una forma sencilla; ya si quiero tocar opciones haría clic en un botón de ampliar»): its way as the map
 * draws it, in order and in orange (what brought it, the collection it came into, the flow, the Bandeja, where it was
 * accepted or written), each box with what was this run's, and «Ampliar», which opens the map with the run on it. Names
 * are the map's; what came from a mail or a model stays text.
 */
import { Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { MAP_DEVICES, type MapView, type RunDetail } from "../core/agent.ts";
import { mapNodeName, runStatusLine } from "../core/runText.ts";
import { agentApi, showRun, useStore } from "../store.ts";

/** The map's names, asked again after a minute: a run drawn in a chat names its boxes as the map does. */
let mapOnce: { at: number; map: Promise<MapView | null> } | null = null;
const mapNames = () => {
  if (!mapOnce || Date.now() - mapOnce.at > 60_000)
    mapOnce = {
      at: Date.now(),
      map: agentApi.map(7).catch(() => {
        mapOnce = null;
        return null;
      }),
    };
  return mapOnce.map;
};

export function RunPath({ run: id, caption }: { run: string; caption?: React.ReactNode }) {
  const t = useStore((s) => s.t);
  const [d, setD] = useState<RunDetail | null | "loading">("loading");
  // The map's names (null: the server could not say them; undefined: still asked).
  const [map, setMap] = useState<MapView | null | undefined>(undefined);
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
  if (d === "loading" || map === undefined)
    return <div className="run-path muted small">{t("run.path.loading")}</div>;
  if (!d) return null;
  const name = (node: string, fallback: string) => {
    const n = map?.nodes.find((x) => x.id === node);
    return n ? mapNodeName(t, n) : fallback;
  };
  const owner = d.owner ?? (d.flow ? `flow:${d.flow}` : "boni:chat");
  // A line from a mail or a model is marked as from outside, as the reply's words are.
  const boxes: {
    id: string;
    name: string;
    line: string | null;
    outside?: boolean;
    waits?: boolean;
  }[] = [];
  if (d.input) {
    const into = `col:${d.input.type}`;
    // What brought it: the mail's connector, straight in or through Boni's «Traer correo» (D-50).
    const edges = map?.edges ?? [];
    const brings = edges.find((e) => e.kind === "brings" && e.to === into);
    const through = brings
      ? null
      : edges.find(
          (e) =>
            e.kind === "writes" &&
            e.to === into &&
            edges.some((x) => x.kind === "brings" && x.to === e.from),
        );
    const conn = through ? edges.find((x) => x.kind === "brings" && x.to === through.from) : null;
    if (brings) boxes.push({ id: brings.from, name: name(brings.from, ""), line: null });
    if (through && conn) {
      boxes.push({ id: conn.from, name: name(conn.from, ""), line: null });
      boxes.push({ id: through.from, name: name(through.from, ""), line: null });
    }
    boxes.push({
      id: into,
      name: d.input.collection,
      line: `«${d.input.title || "…"}»`,
      outside: true,
    });
  }
  boxes.push({
    id: owner,
    name: name(owner, owner === "boni:chat" ? t("map.node.chat") : t("map.kind.flow")),
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
      outside: d.proposals.length === 1,
    });
  // Where it went: the collection where a proposal was accepted, or where it waits to go, or where it wrote.
  const ends = new Map<string, { line: string | null; waits: boolean }>();
  for (const p of d.proposals)
    if (p.type && (p.status === "accepted" || p.status === "pending"))
      ends.set(`col:${p.type}`, {
        line:
          p.status === "pending"
            ? t("run.out.proposal.pending")
            : `«${p.record?.title ?? p.title ?? "…"}»`,
        waits: p.status === "pending",
      });
  for (const c of d.changes)
    if (c.type && !ends.has(`col:${c.type}`))
      ends.set(`col:${c.type}`, { line: `«${c.title}»`, waits: false });
  for (const [col, end] of ends)
    boxes.push({ id: col, name: name(col, ""), line: end.line, waits: end.waits });
  // What it told went to the devices, as the map draws it («avisa»).
  if (d.steps.some((x) => x.what === "notify" && x.decision === "allow"))
    boxes.push({ id: MAP_DEVICES, name: name(MAP_DEVICES, t("map.node.devices")), line: null });
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
            className={`run-path-box${b.waits ? " waits" : ""}`}
            style={{ "--way-i": i } as React.CSSProperties}
          >
            <strong>{b.name}</strong>
            {b.line && (
              <span
                className={`muted${b.outside ? " run-path-ext" : ""}`}
                title={b.outside ? t("chat.fromOutside") : undefined}
              >
                {b.line}
              </span>
            )}
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
