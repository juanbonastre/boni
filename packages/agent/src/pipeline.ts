/**
 * Boni's flow of models and code, declared as data (task 59b; Juan, 2026-11-04: «ver qué hace exactamente todos los
 * modelos y cómo interaccionan entre sí»): where each thing comes in, which model reads it, what the code decides,
 * what reaches the inbox and the user's data. The «Modelos» canvas draws this and nothing else, with the journal's
 * numbers on each node and arrow (apps/server/src/pipeline.ts). So that it never lies, every reader kind, every
 * model role, every tool and every kind of run the code tells apart has its node here, and the tests of this
 * declaration (A-16) refuse a new one left out. The apps name the nodes and what flows (i18n), by these ids.
 */
import { ROLES, type Role } from "./models.ts";
import { READERS, type ReaderKind } from "./plan.ts";

export type PipelineKind = "source" | "model" | "code" | "inbox" | "user" | "store";
/** The kinds of run the server tells apart (apps/server/src/runInfo.ts `RunWhat`); each but `other` starts at a node. */
export const RUN_KINDS = ["request", "mail", "measure", "review", "accepted", "other"] as const;
export type RunKind = (typeof RUN_KINDS)[number];
/** The areas of Boni's decisions (docs/fiabilidad.md §3.3; apps/server accuracy.ts), each judged at a node. */
export const DECISION_AREAS = ["choice", "fill", "mail.accept", "mail.guide", "time"] as const;

export interface PipelineNode {
  id: string;
  kind: PipelineKind;
  /** A model node: the role whose model does it. */
  role?: Role;
  /** The readers (plan.ts) it is: their calls count here. */
  readers?: readonly ReaderKind[];
  /** The role whose calls that name no reader count here (calls made before the kind was recorded, the decider's). */
  unnamed?: Role;
  /** The tools (tools.ts) it is: their calls count here. */
  tools?: readonly string[];
  /** The kinds of run that start here. */
  runs?: readonly RunKind[];
  /** The decisions judged here: their accuracy shows here. */
  areas?: readonly string[];
}
export interface PipelineEdge {
  from: string;
  to: string;
  /** What flows, by the id of its text. */
  what: string;
}
export interface Pipeline {
  nodes: readonly PipelineNode[];
  edges: readonly PipelineEdge[];
}

export const PIPELINE: Pipeline = {
  nodes: [
    // Where things come in.
    { id: "mail", kind: "source", runs: ["mail"] },
    { id: "conversation", kind: "source", runs: ["request"] },
    { id: "external", kind: "source" },
    { id: "assistants", kind: "source" },
    // Reading mail (docs/nucleo.md 7.4b): one reading per mail, the collection, the fields, then the code.
    {
      id: "read_message",
      kind: "model",
      role: "reader",
      readers: ["read_message", "extract_tasks"],
      unnamed: "reader",
    },
    {
      id: "classify",
      kind: "model",
      role: "decider",
      readers: ["classify"],
      unnamed: "decider",
      areas: ["choice"],
    },
    { id: "fill", kind: "model", role: "reader", readers: ["fill"], areas: ["fill"] },
    // Boni's pieces of «Leer correo» (docs/sistema.md §4.2) count where the code did their work before.
    { id: "calendar", kind: "code", areas: ["time"], tools: ["mail.invitation"] },
    { id: "relations", kind: "code", tools: ["mail.relations", "mail.known"] },
    {
      id: "inbox",
      kind: "inbox",
      runs: ["accepted"],
      areas: ["mail.accept"],
      tools: ["inbox.fold", "inbox.accept_alone"],
    },
    { id: "user", kind: "user" },
    { id: "store", kind: "store" },
    // The conversation (docs/nucleo.md 7): the planner's plans, the readers it asks, the tools under the policy.
    { id: "planner", kind: "model", role: "planner", unnamed: "planner" },
    {
      id: "readers",
      kind: "model",
      role: "reader",
      readers: ["summarize", "rewrite", "answer_about", "summarize_each", "label_each"],
    },
    {
      id: "tools",
      kind: "code",
      tools: [
        "entities.query",
        "entities.get",
        "entities.aggregate",
        "entities.search",
        "schema.describe",
        "entities.create",
        "entities.update",
        "entities.delete",
        "schema.create_type",
        "schema.add_field",
        "memory.save",
        "notify",
        "flows.run",
        "flows.save",
      ],
    },
    { id: "policy", kind: "code" },
    // What learns from the user's decisions: the reviewer of the reading guide, the learners of hours and of «Solo».
    {
      id: "reviewer",
      kind: "model",
      role: "reviewer",
      readers: ["review_reading"],
      unnamed: "reviewer",
      runs: ["review", "measure"],
      areas: ["mail.guide"],
    },
    { id: "guide", kind: "code", tools: ["mail.rule"] },
    { id: "learners", kind: "code" },
  ],
  edges: [
    { from: "mail", to: "read_message", what: "mails" },
    { from: "read_message", to: "classify", what: "items" },
    { from: "classify", to: "fill", what: "collection" },
    { from: "fill", to: "calendar", what: "fields" },
    { from: "external", to: "calendar", what: "events" },
    { from: "calendar", to: "relations", what: "crossed" },
    { from: "relations", to: "inbox", what: "proposals" },
    { from: "inbox", to: "user", what: "cards" },
    { from: "user", to: "store", what: "accepted" },
    { from: "user", to: "reviewer", what: "decisions" },
    { from: "reviewer", to: "guide", what: "suggestions" },
    { from: "guide", to: "read_message", what: "guide" },
    { from: "user", to: "learners", what: "decisions" },
    { from: "learners", to: "inbox", what: "alone" },
    { from: "conversation", to: "planner", what: "requests" },
    { from: "planner", to: "readers", what: "texts" },
    { from: "planner", to: "tools", what: "calls" },
    { from: "tools", to: "policy", what: "calls" },
    { from: "policy", to: "store", what: "changes" },
    { from: "policy", to: "inbox", what: "proposals" },
    { from: "planner", to: "conversation", what: "answers" },
    { from: "assistants", to: "store", what: "reads" },
  ],
};

/** The node a reader's calls count at, a role's unnamed calls, a run kind, a tool, an area: null when none says. */
export const nodeOfReader = (kind: string): string | null =>
  PIPELINE.nodes.find((n) => n.readers?.includes(kind as ReaderKind))?.id ?? null;
export const nodeOfRole = (role: string): string | null =>
  PIPELINE.nodes.find((n) => n.unnamed === role)?.id ?? null;
export const nodeOfRun = (kind: string): string | null =>
  PIPELINE.nodes.find((n) => n.runs?.includes(kind as RunKind))?.id ?? null;
export const nodeOfTool = (tool: string): string | null =>
  PIPELINE.nodes.find((n) => n.tools?.includes(tool))?.id ?? null;
export const nodeOfArea = (area: string): string | null =>
  PIPELINE.nodes.find((n) => n.areas?.includes(area))?.id ?? null;

/**
 * What the declaration leaves out of what the code knows (A-16): a reader, a role, a run kind, an area or a tool
 * without a node, an arrow to nowhere, a node nothing reaches or leaves. Empty when the canvas can be trusted.
 */
export function pipelineGaps(tools: readonly string[]): string[] {
  const out: string[] = [];
  const ids = new Set(PIPELINE.nodes.map((n) => n.id));
  for (const r of READERS) if (!nodeOfReader(r)) out.push(`reader ${r} has no node`);
  for (const r of ROLES) {
    if (!PIPELINE.nodes.some((n) => n.role === r)) out.push(`role ${r} has no node`);
    if (!nodeOfRole(r)) out.push(`role ${r} has no node for its unnamed calls`);
  }
  for (const k of RUN_KINDS)
    if (k !== "other" && !nodeOfRun(k)) out.push(`run kind ${k} has no node`);
  for (const a of DECISION_AREAS) if (!nodeOfArea(a)) out.push(`area ${a} has no node`);
  for (const t of tools) if (!nodeOfTool(t)) out.push(`tool ${t} has no node`);
  const seen = new Set<string>();
  for (const n of PIPELINE.nodes) {
    if (seen.has(n.id)) out.push(`node ${n.id} twice`);
    seen.add(n.id);
  }
  for (const e of PIPELINE.edges) {
    if (!ids.has(e.from)) out.push(`arrow from ${e.from}, which is no node`);
    if (!ids.has(e.to)) out.push(`arrow to ${e.to}, which is no node`);
  }
  for (const n of PIPELINE.nodes)
    if (!PIPELINE.edges.some((e) => e.from === n.id || e.to === n.id))
      out.push(`node ${n.id} is joined to nothing`);
  return out;
}
