import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { resolveTemplateLinks, templatePage } from "../packages/views/src/templates.ts";
import { boniEngine, boniTypes } from "./boni-records.ts";

/** The server's documented answers (`api/examples`): the fake server below answers with them. */
const DIR = join(import.meta.dirname, "..", "apps", "boni-web", "api", "examples");
export const EXAMPLES: Record<string, string> = Object.fromEntries(
  readdirSync(DIR).map((f) => [f, readFileSync(join(DIR, f), "utf8")]),
);

export interface Shell {
  /** What the page asked the server: "POST api/v1/actions {...}". */
  requests: string[];
  /** Calls to the shell: "moveBy 10 0", "openMain charts"... */
  calls: string[];
}

export interface Options {
  /** Answer of POST actions: "ok", "invalid" or "offline". */
  action?: "ok" | "invalid" | "offline";
  /** Every request fails as if there were no network. */
  offline?: boolean;
  configured?: boolean;
  /** Configured with a device token of the first clients (no user): the page asks to log in. */
  legacy?: boolean;
  language?: "es" | "en";
  /** Files on the device (store), by name. */
  files?: Record<string, string>;
  /** Answers of the agent's API (and the mailbox's, "GET api/mail"), in order, by "METHOD path" ("POST
   * api/agent/turn"); the last one repeats. */
  agent?: Record<string, unknown[]>;
  /** The account's pages (`/api/pages`, kept in memory as the server would); null: a server without
   * them. By default one page as the first Boni's home becomes (`PAGE_FROM_HOME`). */
  pages?: FakePage[] | null;
  /** Pending proposals of Libros drawn as ghost rows (`{ id, proposal, values }`); deciding one takes it out. */
  ghosts?: { id: string; proposal: string; values: Record<string, unknown>; updated: number }[];
  /** How long accepting a proposal takes (ms; default as any request, 20). */
  acceptMs?: number;
  /** One path answered after `ms` (the line at the top while the app waits, I-15). */
  slow?: { path: string; ms: number };
  /** How long a turn takes to answer (ms; default 20): its live steps are asked for meanwhile. */
  turnMs?: number;
  /**
   * A turn's live events as the server keeps them: each look gets those after the `after` it asks from, and takes
   * `ms` to answer (instead of `agent["GET api/agent/live/:id"]`, which answers in order whatever it asks).
   */
  live?: { events: unknown[]; ms: number };
  /** Inicio's «Hoy» (`/api/data/today`): today's items of the calendars; null: a server without it. */
  today?: unknown[] | null;
  /** The mail's collection as the server keeps it (`t_01m6correo`, read only, opened as a mail), with one mail (`m1`). */
  mail?: boolean;
  /** The desktop shell opens a note in its peek window, a window of its own (Boni desktop 0.4.65; task 30). */
  peek?: boolean;
  /**
   * Two agenda collections with their roles (tasks with a box, events with a day and hours), for the correction's
   * kinds (task 47); `"mother"`: both inside a mother «Agenda» (F6).
   */
  agenda?: boolean | "mother";
  /** Who reads and writes each collection (`/api/data/usage`, F6). */
  usage?: unknown;
}

export interface FakePage {
  id: string;
  title: string;
  icon?: string;
  parent?: string | null;
  position?: number;
  template?: "uso-ia" | "actividad" | "registro";
  spec: { version: 1; full?: boolean; blocks: Record<string, unknown>[] };
}

/** A template page as the server seeds it (apps/server/src/pages.ts `seedTemplates`). */
export const TEMPLATE = (name: "uso-ia" | "actividad" | "registro"): FakePage => {
  const t = templatePage(name);
  const spec = resolveTemplateLinks(t.spec, [{ id: "registro", template: "registro" }]);
  return {
    id: name,
    title: t.title,
    icon: t.icon,
    template: name,
    spec: spec as FakePage["spec"],
  };
};

/** What an account that used the first Boni gets once (apps/server/src/pages.ts, seedFromV1). */
export const PAGE_FROM_HOME: FakePage = {
  id: "gastos",
  title: "Gastos",
  spec: {
    version: 1,
    full: true,
    blocks: [
      { id: "b1", type: "action", screen: "capture-expense", label: "Apuntar gasto" },
      { id: "b2", type: "action", screen: "capture-expense", label: "Café", shortcut: "cafe" },
      { id: "b3", type: "chart", chart: "spending-by-category" },
      { id: "b4", type: "chart", chart: "monthly-spending" },
      { id: "b5", type: "chart", chart: "eating-out" },
    ],
  },
};

/**
 * Opens the page with a stand-in for the desktop shell (`window.boniDesktop`, as preload.cjs gives it): its
 * requests are answered from api/examples, its files live in memory, and what the page asks is recorded.
 */
const engined = new WeakSet<Page>();

export async function openApp(page: Page, url = "/", opts: Options = {}): Promise<void> {
  const pages = opts.pages === undefined ? [PAGE_FROM_HOME] : opts.pages;
  await page.addInitScript(
    ({ examples, opts, pages, boni }) => {
      const w = window as unknown as Record<string, unknown>;
      const record = (key: string, v: string) => {
        const list = (w[key] as string[] | undefined) ?? [];
        list.push(v);
        w[key] = list;
      };
      const files = new Map<string, string>(Object.entries(opts.files ?? {}));
      const listeners = new Set<(e: unknown) => void>();
      let settings = {
        serverUrl: opts.configured === false ? "" : "https://boni.example.ts.net",
        hasToken: opts.configured !== false,
        user: opts.configured === false || opts.legacy ? "" : "ejemplo",
        device: opts.configured === false ? "" : "portatil",
        legacyToken: Boolean(opts.legacy),
        sessionEnded: false,
        live: true,
        theme: "dark",
        language: opts.language ?? "es",
        showWidgets: true,
        hiddenWidgets: [] as string[],
        autostart: true,
        layerAvailable: true,
      };
      const agentCalls: Record<string, number> = {};
      let ghosts = opts.ghosts ?? [];
      // The inbox as the server keeps it: accepting or rejecting a proposal takes it out.
      let inbox = (
        opts.agent?.["GET api/agent/proposals"]?.[0] as { proposals: { id: string }[] } | undefined
      )?.proposals;
      // The questions as the server keeps them: answering or putting one away takes it out.
      let asked = (
        opts.agent?.["GET api/agent/requests"]?.[0] as { requests: { id: string }[] } | undefined
      )?.requests;
      // The pages as the server keeps them (apps/server/src/pages.ts), with its trash for Undo.
      const pageList = (pages ?? []).map((x, i) => ({
        icon: "",
        parent: null,
        position: i + 1,
        ...x,
      })) as Record<string, unknown>[];
      const trash: Record<string, unknown>[] = [];
      let made = 0;
      const pageAnswer = (method: string, p: string, body?: unknown): [number, string] => {
        if (pages === null) return [503, '{"error":"agent-off"}'];
        const info = ({ spec: _s, ...rest }: Record<string, unknown>) => rest;
        const m = /^api\/pages\/([^/]+)(\/restore)?$/.exec(p);
        const b = (body ?? {}) as Record<string, unknown>;
        if (!m) {
          if (method === "GET") return [200, JSON.stringify({ pages: pageList.map(info) })];
          const page = {
            id: `p${++made}`,
            title: b.title,
            icon: "",
            parent: b.parent ?? null,
            position: pageList.length + 1,
            spec: b.spec ?? { version: 1, blocks: [] },
          };
          pageList.push(page);
          return [200, JSON.stringify({ page })];
        }
        const id = m[1]!;
        if (m[2]) {
          const i = trash.findIndex((x) => x.id === id);
          if (i < 0) return [404, '{"error":"not-found"}'];
          const [back] = trash.splice(i, 1);
          pageList.push(back!);
          return [200, JSON.stringify({ page: back })];
        }
        const i = pageList.findIndex((x) => x.id === id);
        if (i < 0) return [404, '{"error":"not-found"}'];
        if (method === "GET") return [200, JSON.stringify({ page: pageList[i] })];
        if (method === "DELETE") {
          const [gone] = pageList.splice(i, 1);
          trash.push(gone!);
          for (const x of pageList) if (x.parent === id) x.parent = gone!.parent ?? null;
          return [200, "{}"];
        }
        pageList[i] = { ...pageList[i], ...b };
        return [200, JSON.stringify({ page: pageList[i] })];
      };
      // The user's collections as databases (apps/server/src/data.ts), kept in memory.
      const libros = {
        id: "t_libro",
        name: "Libros",
        icon: "📚",
        titleField: "f_titulo",
        count: 3,
        level: "visible",
        fields: [
          { id: "f_titulo", key: "titulo", name: "Título", type: "text" },
          {
            id: "f_estado",
            key: "estado",
            name: "Estado",
            type: "select",
            options: [
              { id: "o_pendiente", name: "Pendiente" },
              { id: "o_leyendo", name: "Leyendo" },
              { id: "o_leido", name: "Leído" },
            ],
          },
          { id: "f_paginas", key: "paginas", name: "Páginas", type: "number" },
          { id: "f_fin", key: "fin", name: "Terminado", type: "date" },
          { id: "f_fav", key: "fav", name: "Favorito", type: "checkbox" },
          // A relation to the same collection (books that go together), edited with the picker.
          {
            id: "f_relacionado",
            key: "relacionado",
            name: "Relacionado",
            type: "relation",
            relation: { target: "t_libro", many: true },
          },
        ],
        rowUi: { open: true, hidden: [] as string[] },
      };
      // A collection from the vault's private/ (Colecciones lists it, locked).
      const documentos = {
        id: "t_private_documentos",
        name: "Documentos",
        icon: "",
        titleField: "f_title",
        count: 2,
        level: "private",
        zone: "private",
        fields: [{ id: "f_title", key: "title", name: "Título", type: "text" }],
        rowUi: { open: false, hidden: [] as string[] },
      };
      // Two agenda collections with their roles (task 47): tasks keep a box, events a day and hours; their keys
      // differ, so a correction between them has to move the day and the hours by their roles.
      const tareas = {
        id: "t_tareas",
        key: "tareas",
        name: "Tareas",
        icon: "",
        titleField: "f_tt",
        count: 0,
        level: "visible",
        fields: [
          { id: "f_tt", key: "titulo", name: "Título", type: "text" },
          { id: "f_tdia", key: "dia", name: "Día", type: "date" },
          { id: "f_tini", key: "inicio", name: "Inicio", type: "time" },
          { id: "f_tfin", key: "fin", name: "Fin", type: "time" },
          { id: "f_thecha", key: "hecha", name: "Hecha", type: "checkbox" },
        ],
        roles: { date: "f_tdia", time: "f_tini", endTime: "f_tfin", done: "f_thecha" },
        rowUi: { open: false, hidden: [] as string[] },
      };
      const eventos = {
        id: "t_eventos",
        key: "eventos",
        name: "Eventos",
        icon: "",
        titleField: "f_et",
        count: 0,
        level: "visible",
        fields: [
          { id: "f_et", key: "titulo", name: "Título", type: "text" },
          { id: "f_efecha", key: "fecha", name: "Fecha", type: "date" },
          { id: "f_ehora", key: "hora", name: "Hora de inicio", type: "time" },
          { id: "f_ehfin", key: "hora_fin", name: "Hora de fin", type: "time" },
        ],
        roles: { date: "f_efecha", time: "f_ehora", endTime: "f_ehfin" },
        rowUi: { open: false, hidden: [] as string[] },
      };
      // In a mother «Agenda» (F6): her daughters carry her id as their parent.
      const mother = {
        id: "t_agenda",
        key: "agenda",
        name: "Agenda",
        icon: "",
        titleField: "f_at",
        count: 0,
        level: "visible",
        fields: [{ id: "f_at", key: "titulo", name: "Título", type: "text" }],
        rowUi: { open: false, hidden: [] as string[] },
      };
      const agenda =
        opts.agenda === "mother"
          ? [mother, { ...tareas, parent: "t_agenda" }, { ...eventos, parent: "t_agenda" }]
          : opts.agenda
            ? [tareas, eventos]
            : [];
      // The mail's collection (apps/server/src/mail.ts), read only and opened as a mail (D-22), with one mail.
      const correos = {
        // As the server makes it: a generated id, and the key the planner names it by.
        id: "t_01m6correo",
        key: "correo",
        name: "Correos",
        icon: "",
        titleField: "f_asunto",
        count: 1,
        level: "visible",
        fields: [
          { id: "f_asunto", key: "asunto", name: "Asunto", type: "text" },
          { id: "f_de", key: "de", name: "De", type: "email" },
          { id: "f_de_nombre", key: "de_nombre", name: "Nombre", type: "text" },
          { id: "f_para", key: "para", name: "Para", type: "text" },
          { id: "f_cc", key: "cc", name: "Cc", type: "text" },
          { id: "f_fecha", key: "fecha", name: "Fecha", type: "datetime" },
          { id: "f_adjuntos", key: "adjuntos", name: "Adjuntos", type: "text" },
          { id: "f_id_mensaje", key: "id_mensaje", name: "Id del mensaje", type: "text" },
          {
            id: "f_archivos",
            key: "archivos",
            name: "Archivos",
            type: "relation",
            relation: { target: "t_archivo", many: true },
          },
        ],
        rowUi: { open: true, hidden: [] as string[] },
        readOnly: true,
        view: "mail",
      };
      // The account's files, where a mail's attachments are kept (apps/server/src/mail.ts).
      const archivos = {
        id: "t_archivo",
        name: "Archivos",
        icon: "",
        titleField: "f_title",
        count: 2,
        level: "visible",
        fields: [
          { id: "f_title", key: "title", name: "Título", type: "text" },
          { id: "f_boni_file", key: "boni_file", name: "Archivo", type: "file" },
          { id: "f_folder", key: "folder", name: "Carpeta", type: "text" },
        ],
        rowUi: { open: true, hidden: [] as string[] },
      };
      const fileRows = [
        {
          id: "a1",
          values: { f_title: "actas.pdf", f_boni_file: "sha-actas", f_folder: "correo/2026-10" },
          updated: 7,
        },
        {
          id: "a2",
          values: {
            f_title: "orden-del-dia.docx",
            f_boni_file: "sha-orden",
            f_folder: "correo/2026-10",
          },
          updated: 7,
        },
        // An image the mail showed in place (task 48): kept as a file, painted after the text.
        {
          id: "a3",
          values: { f_title: "foto.png", f_boni_file: "sha-foto", f_folder: "correo/2026-10" },
          updated: 7,
        },
      ];
      const mailRow = {
        id: "m1",
        values: {
          f_asunto: "Actas pendientes",
          f_de: "coordinacion@example.edu",
          f_de_nombre: "Coordinación de ejemplo",
          f_para: "ejemplo@example.edu",
          f_fecha: "2026-10-27T09:15:00Z",
          f_adjuntos: "actas.pdf, orden-del-dia.docx, foto.png",
          f_id_mensaje: "m1@example.com",
          f_archivos: ["a1", "a2", "a3"],
        },
        updated: 7,
        // As Gmail's text part writes it: a placeholder where the image was, and the earlier message quoted.
        body: "Hola, antes del jueves revisad las actas, por favor.\n\n[image: foto.png]\n\nGracias.\n\n<b>no es html</b>\n\nEl lun, 26 oct 2026, 18:02, Lucía Ejemplo <lucia.ejemplo@example.com> escribió:\n> Os paso las actas del tribunal.\n> Un saludo",
      };
      const today = new Date().toISOString().slice(0, 10);
      let rows: { id: string; values: Record<string, unknown>; updated: number; body?: string }[] =
        [
          {
            id: "r1",
            values: {
              f_titulo: "Rayuela",
              f_estado: "o_leyendo",
              f_paginas: 600,
              f_relacionado: ["r2"],
            },
            updated: 3,
            // The lines its History (ROW_HISTORY) says who wrote.
            body: "Boni es el núcleo: un servidor, una cuenta.\n\nPropuesta del correo: revisar el presupuesto.\n\n- 24 oct: «Modelos» desplegado.\n",
          },
          {
            id: "r2",
            values: { f_titulo: "Ficciones", f_estado: "o_leido", f_fin: today },
            updated: 2,
          },
          { id: "r3", values: { f_titulo: "Pedro Páramo", f_estado: "o_pendiente" }, updated: 1 },
        ];
      const gone: typeof rows = [];
      /** The books' titles by id, for what points to them. */
      const titlesOf = () =>
        Object.fromEntries(rows.map((r) => [r.id, String(r.values.f_titulo ?? "")]));
      let rowSeq = 0;
      // The tree (apps/server/src/data.ts `treeOf`): each collection's mother and whether its notes show in the
      // sidebar (a folder of notes by default), and the records with a note. Collections made here are empty.
      const madeCols: {
        id: string;
        name: string;
        icon: string;
        titleField: string;
        count: number;
        level: string;
        fields: { id: string; name: string; type: string }[];
        rowUi: { open: boolean; hidden: string[] };
      }[] = [];
      const parents: Record<string, string> = {};
      const eye: Record<string, boolean> = { t_libro: false, t_private_documentos: true };
      const treeNotes = [
        {
          id: "r1",
          type: "t_libro",
          title: "Rayuela",
          ai: ["mcp:claude-ejemplo", "model:planner:anthropic/claude-opus-5-5"],
          aiAt: Date.UTC(2026, 9, 24, 10),
        },
        {
          id: "d1",
          type: "t_private_documentos",
          title: "Contrato de ejemplo",
          ai: [],
          aiAt: null,
        },
        { id: "d2", type: "t_private_documentos", title: "Póliza de ejemplo", ai: [], aiAt: null },
      ];
      const madeRows: {
        id: string;
        type: string;
        values: Record<string, unknown>;
        body: string;
      }[] = [];
      const userCols = () => [libros, documentos, ...agenda, ...madeCols];
      const own = (id: string) =>
        (id === "t_libro" ? rows.length : id === documentos.id ? 2 : 0) +
        madeRows.filter((r) => r.type === id).length;
      const deep = (id: string): number =>
        own(id) +
        userCols()
          .filter((c) => parents[c.id] === id)
          .reduce((n, c) => n + deep(c.id), 0);
      const treeAnswer = (type: string | null): [number, string] => {
        const notes = treeNotes.concat(
          madeRows
            .filter((r) => r.body)
            .map((r) => ({
              id: r.id,
              type: r.type,
              title: String(r.values.f_titulo ?? ""),
              ai: [],
              aiAt: null,
            })),
        );
        if (type) return [200, JSON.stringify({ notes: notes.filter((n) => n.type === type) })];
        return [
          200,
          JSON.stringify({
            collections: userCols().map((c) => ({
              id: c.id,
              ...(parents[c.id] ? { parent: parents[c.id] } : {}),
              name: c.name,
              icon: c.icon,
              count: deep(c.id),
              level: c.level,
              notes: eye[c.id] ?? true,
            })),
            notes: notes.filter((n) => eye[n.type] ?? true),
          }),
        ];
      };
      const goneCols: { id: string; name: string; type: string }[] = [];
      // «Mis datos» (apps/server/src/myData.ts): a row per page and collection kept here, then Boni's; a change to a
      // row is done to what it is, with the server's rules (a name used once, a private one not lowered from here,
      // only an empty collection deleted).
      const MY = "t_sys_datos";
      const R = "sys_data_";
      const LEVELS = ["visible", "opaque", "restricted", "private"];
      const LEVEL_NAMES = ["Visible", "Opaca", "Restringida", "Privada"];
      const levelId = (l: string) => `o_nivel_${l}`;
      // Boni's own rows change nowhere here.
      const BONI_FIXED = ["f_titulo", "f_madre", "f_nivel", "f_barra"];
      const whoId = (id: string) => `o_w_${id.replace(/[^a-z0-9]/gi, "_")}`;
      const usageOf = () =>
        ((opts.usage as { types?: object } | undefined)?.types ?? {}) as Record<
          string,
          { reads: { id: string; name: string }[]; writes: { id: string; name: string }[] }
        >;
      const goneMine: (typeof madeCols)[number][] = [];
      const parentOf = (c: { id: string; parent?: string }) => parents[c.id] ?? c.parent;
      const myRows = () => {
        const out: {
          id: string;
          values: Record<string, unknown>;
          updated: number;
          fixed?: string[];
        }[] = [];
        const own = pageList.filter((x) => !x.template);
        const walkPages = (parent: unknown, depth: number) => {
          for (const x of own.filter((y) =>
            parent === null
              ? !y.parent || !own.some((z) => z.id === y.parent)
              : y.parent === parent,
          )) {
            out.push({
              id: `${R}${x.id}`,
              values: {
                f_titulo: x.title,
                f_tipo: "o_tipo_pagina",
                ...(x.parent && own.some((z) => z.id === x.parent)
                  ? { f_madre: `${R}${x.parent}` }
                  : {}),
              },
              updated: 0,
              // A page has no level and no eye (as the server's `dataRowFixed` says).
              fixed: ["f_nivel", "f_barra"],
            });
            if (depth < 6) walkPages(x.id, depth + 1);
          }
        };
        walkPages(null, 0);
        const cols = userCols() as { id: string; name: string; level: string; parent?: string }[];
        const isRoot = (c: (typeof cols)[number]) => {
          const m = parentOf(c);
          return !m || !cols.some((y) => y.id === m);
        };
        const walk = (parent: string | null) => {
          for (const c of cols
            .filter((x) => (parent === null ? isRoot(x) : parentOf(x) === parent))
            .sort((a, z) => a.name.localeCompare(z.name, "es"))) {
            const u = usageOf()[c.id];
            out.push({
              id: `${R}${c.id}`,
              values: {
                f_titulo: c.name,
                f_tipo: "o_tipo_coleccion",
                ...(isRoot(c) ? {} : { f_madre: `${R}${parentOf(c)}` }),
                f_nivel: levelId(c.level),
                f_notas: deep(c.id),
                f_barra: eye[c.id] ?? true,
                ...(u?.reads.length ? { f_lee: u.reads.map((w) => whoId(w.id)) } : {}),
                ...(u?.writes.length ? { f_escribe: u.writes.map((w) => whoId(w.id)) } : {}),
              },
              updated: 0,
            });
            walk(c.id);
          }
        };
        walk(null);
        for (const x of pageList.filter((y) => y.template))
          out.push({
            id: `${R}${x.id}`,
            values: { f_titulo: x.title, f_tipo: "o_tipo_boni" },
            updated: 0,
            fixed: BONI_FIXED,
          });
        for (const x of boni as { id: string; name: string; count?: number }[])
          out.push({
            id: `${R}${x.id}`,
            values: {
              f_titulo: x.name,
              f_tipo: "o_tipo_boni",
              f_nivel: levelId("private"),
              f_notas: x.count ?? 0,
            },
            updated: 0,
            fixed: BONI_FIXED,
          });
        return out;
      };
      // Its views and what this device's head keeps (task 69), kept as the server keeps any collection's.
      let myUi: { open: boolean; hidden: string[]; views?: unknown[] } = {
        open: false,
        hidden: [],
      };
      const myType = () => {
        const who = new Map<string, string>();
        for (const u of Object.values(usageOf()))
          for (const w of [...u.reads, ...u.writes]) who.set(whoId(w.id), w.name);
        const whoOptions = [...who].map(([id, name]) => ({ id, name }));
        return {
          id: MY,
          key: "datos",
          name: "Mis datos",
          icon: "🗂️",
          titleField: "f_titulo",
          count: myRows().length,
          level: "private",
          rules: [],
          rowUi: myUi,
          system: true,
          editable: ["f_titulo", "f_madre", "f_nivel", "f_barra"],
          fields: [
            { id: "f_titulo", key: "titulo", name: "Nombre", type: "text" },
            {
              id: "f_tipo",
              key: "tipo",
              name: "Tipo",
              type: "select",
              options: [
                { id: "o_tipo_pagina", name: "Página" },
                { id: "o_tipo_coleccion", name: "Colección" },
                { id: "o_tipo_boni", name: "De Boni" },
              ],
            },
            {
              id: "f_madre",
              key: "madre",
              name: "Padre",
              type: "relation",
              relation: { target: MY, many: false },
            },
            {
              id: "f_nivel",
              key: "nivel",
              name: "Nivel",
              type: "select",
              options: LEVELS.map((l, i) => ({ id: levelId(l), name: LEVEL_NAMES[i] })),
            },
            { id: "f_notas", key: "notas", name: "Elementos", type: "number" },
            { id: "f_barra", key: "barra", name: "En la barra", type: "checkbox" },
            {
              id: "f_lee",
              key: "lee",
              name: "Leída por",
              type: "multiselect",
              options: whoOptions,
            },
            {
              id: "f_escribe",
              key: "escribe",
              name: "Escrita por",
              type: "multiselect",
              options: whoOptions,
            },
            { id: "f_origen", key: "origen", name: "Origen", type: "select", options: [] },
          ],
        };
      };
      const myAnswer = (method: string, p: string, body?: unknown): [number, string] | null => {
        const values = ((body ?? {}) as { values?: Record<string, unknown> }).values ?? {};
        const rowOf = (id: string) =>
          JSON.stringify({ row: myRows().find((r) => r.id === id) ?? null });
        if (p === `api/data/types/${MY}/rows` && method === "GET") {
          const list = myRows();
          return [
            200,
            JSON.stringify({
              rows: list,
              titles: Object.fromEntries(list.map((r) => [r.id, String(r.values.f_titulo)])),
              truncated: false,
              ghosts: [],
              columns: {},
            }),
          ];
        }
        if (p === `api/data/types/${MY}/rows` && method === "POST") {
          const taken = (n: string) =>
            userCols().some((c) => c.name.toLowerCase() === n.toLowerCase());
          let name = "Nueva colección";
          for (let n = 2; taken(name); n++) name = `Nueva colección ${n}`;
          const id = `t_hecha_${madeCols.length + goneMine.length + 1}`;
          madeCols.push({
            id,
            name,
            icon: "",
            titleField: "f_titulo",
            count: 0,
            level: "visible",
            fields: [{ id: "f_titulo", name: "Título", type: "text" }],
            rowUi: { open: false, hidden: [] },
          });
          return [200, rowOf(`${R}${id}`)];
        }
        const m = /^api\/data\/rows\/(sys_data_[^/]+?)(\/restore)?$/.exec(p);
        if (!m) return null;
        const id = m[1]!;
        const target = id.slice(R.length);
        const col = userCols().find((c) => c.id === target) as
          | { id: string; name: string; level: string }
          | undefined;
        const page = pageList.find((x) => x.id === target);
        if (m[2] && method === "POST") {
          const i = goneMine.findIndex((c) => c.id === target);
          if (i >= 0) madeCols.push(...goneMine.splice(i, 1));
          const j = trash.findIndex((x) => x.id === target);
          if (j >= 0) pageList.push(...trash.splice(j, 1));
          return [200, "{}"];
        }
        if (!col && !page) return [400, '{"error":"read-only"}'];
        if (method === "DELETE") {
          if (page) {
            pageList.splice(pageList.indexOf(page), 1);
            trash.push(page);
            return [200, "{}"];
          }
          const i = madeCols.findIndex((c) => c.id === target);
          if (i < 0 || deep(target) > 0 || treeNotes.some((n) => n.type === target))
            return [409, '{"error":"not-empty"}'];
          goneMine.push(...madeCols.splice(i, 1));
          return [200, "{}"];
        }
        for (const [f, v] of Object.entries(values)) {
          if (f === "f_titulo") {
            const name = String(v ?? "").trim();
            if (!name) return [400, '{"error":"bad-body"}'];
            if (page) page.title = name;
            else if (col) {
              if (
                userCols().some(
                  (c) => c.id !== col.id && c.name.toLowerCase() === name.toLowerCase(),
                )
              )
                return [409, '{"error":"taken"}'];
              col.name = name;
            }
          } else if (f === "f_madre") {
            const to = typeof v === "string" ? v.slice(R.length) : null;
            if (page) page.parent = to;
            else if (col) {
              if (to && !userCols().some((c) => c.id === to)) return [400, '{"error":"bad-body"}'];
              if (to) parents[col.id] = to;
              else delete parents[col.id];
            }
          } else if (f === "f_nivel" && col) {
            const level = String(v).replace("o_nivel_", "");
            if (col.level === "private" && level !== "private") return [409, '{"error":"locked"}'];
            col.level = level;
          } else if (f === "f_barra" && col) eye[col.id] = Boolean(v);
          else return [400, '{"error":"read-only"}'];
        }
        return [200, rowOf(id)];
      };
      // «Flujos» (apps/server/src/flowsCollection.ts): a row per flow the agent's list has (its `GET api/agent/flows`),
      // a change to a row done to its flow with the server's rules (Boni's keep their name and are never deleted).
      const FL = "t_sys_flujos";
      const FR = "sys_flow_";
      type FlowHere = {
        id: string;
        name: string;
        version: number;
        trigger: Record<string, unknown>;
        by: string;
        enabled: boolean;
        steps: number;
        runs: number;
        last: number | null;
      };
      let flowsHere: FlowHere[] | null = null;
      const flowsGone: FlowHere[] = [];
      const flowsNow = (): FlowHere[] => {
        flowsHere ??= JSON.parse(
          JSON.stringify(
            ((opts.agent?.["GET api/agent/flows"]?.[0] as { flows?: unknown[] } | undefined)
              ?.flows ?? []) as FlowHere[],
          ),
        ) as FlowHere[];
        return flowsHere;
      };
      let flowsUi: { open: boolean; hidden: string[]; views?: unknown[] } = {
        open: false,
        hidden: [],
      };
      const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      const flowWords = (on: Record<string, unknown>) => {
        if (typeof on.created === "string") {
          const named = [correos, libros, ...madeCols].find(
            (c) => (c as { key?: string }).key === on.created,
          );
          return `Llega a ${named?.name ?? on.created}`;
        }
        const sch = on.schedule as { every?: string; at?: string; day?: number } | undefined;
        if (sch) {
          const at = sch.at ?? "08:00";
          if (sch.every === "hour")
            return at.slice(3) === "00" ? "Cada hora" : `Cada hora a y ${at.slice(3)}`;
          if (sch.every === "week") return `Cada ${DAYS[sch.day ?? 1]} a las ${at}`;
          return `Cada día a las ${at}`;
        }
        return "Disparado por el usuario";
      };
      const wordId = (w: string) => `o_disp_${w.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      const flowRows = () =>
        flowsNow()
          .slice()
          .sort(
            (a, z) => Number(z.enabled) - Number(a.enabled) || a.name.localeCompare(z.name, "es"),
          )
          .map((f) => ({
            id: `${FR}${f.id}`,
            values: {
              f_titulo: f.name,
              f_disparador: wordId(flowWords(f.trigger)),
              f_estado: f.enabled ? "o_estado_encendido" : "o_estado_apagado",
              f_de: f.by === "preset" ? "o_de_boni" : "o_de_tu",
              f_pasos: f.steps,
              f_ejecuciones: f.runs,
              ...(f.last !== null ? { f_ultima: new Date(f.last).toISOString() } : {}),
              f_version: f.version,
            },
            updated: f.last ?? 0,
            ...(f.by === "preset" ? { fixed: ["f_titulo"] } : {}),
          }));
      const flowsType = () => ({
        id: FL,
        key: "flujos",
        name: "Flujos",
        icon: "⚡",
        titleField: "f_titulo",
        count: flowsNow().length,
        level: "private",
        rules: [],
        rowUi: flowsUi,
        system: true,
        editable: ["f_titulo", "f_estado"],
        fields: [
          { id: "f_titulo", key: "titulo", name: "Nombre", type: "text" },
          {
            id: "f_disparador",
            key: "disparador",
            name: "Disparador",
            type: "select",
            options: [...new Set(flowsNow().map((f) => flowWords(f.trigger)))].map((w) => ({
              id: wordId(w),
              name: w,
            })),
          },
          {
            id: "f_estado",
            key: "estado",
            name: "Estado",
            type: "select",
            options: [
              { id: "o_estado_encendido", name: "Encendido" },
              { id: "o_estado_apagado", name: "Apagado" },
            ],
          },
          {
            id: "f_de",
            key: "de",
            name: "Versión de",
            type: "select",
            options: [
              { id: "o_de_boni", name: "Boni" },
              { id: "o_de_tu", name: "Ti" },
            ],
          },
          { id: "f_pasos", key: "pasos", name: "Pasos", type: "number" },
          { id: "f_ejecuciones", key: "ejecuciones", name: "Ejecuciones", type: "number" },
          { id: "f_ultima", key: "ultima", name: "Última", type: "datetime" },
          { id: "f_version", key: "version", name: "Versión", type: "number" },
        ],
      });
      const flowsAnswer = (method: string, p: string, body?: unknown): [number, string] | null => {
        const values = ((body ?? {}) as { values?: Record<string, unknown> }).values ?? {};
        const rowOf = (id: string) =>
          JSON.stringify({ row: flowRows().find((r) => r.id === id) ?? null });
        if (p === `api/data/types/${FL}/rows` && method === "GET")
          return [
            200,
            JSON.stringify({
              rows: flowRows(),
              titles: {},
              truncated: false,
              ghosts: [],
              columns: {},
            }),
          ];
        if (p === `api/data/types/${FL}/rows` && method === "POST") {
          const n = flowsNow().length + flowsGone.length + 1;
          const name =
            typeof values.f_titulo === "string" && values.f_titulo
              ? values.f_titulo
              : "Nuevo flujo";
          const id = `nuevo-flujo-${n}`;
          flowsNow().push({
            id,
            name,
            version: 1,
            trigger: { manual: true },
            by: "user",
            enabled: false,
            steps: 0,
            runs: 0,
            last: null,
          });
          return [200, rowOf(`${FR}${id}`)];
        }
        if (p === `api/data/types/${FL}/row-ui`) {
          flowsUi = { ...flowsUi, ...((body ?? {}) as Partial<typeof flowsUi>) };
          return [200, JSON.stringify(flowsUi)];
        }
        const m = /^api\/data\/rows\/(sys_flow_[^/]+?)(\/restore)?$/.exec(p);
        if (!m) return null;
        const id = m[1] as string;
        const fid = id.slice(FR.length);
        if (m[2] && method === "POST") {
          const i = flowsGone.findIndex((f) => f.id === fid);
          if (i >= 0) flowsNow().push(...flowsGone.splice(i, 1));
          return [200, "{}"];
        }
        const f = flowsNow().find((x) => x.id === fid);
        if (!f) return [404, '{"error":"not-found"}'];
        if (method === "DELETE") {
          if (f.by === "preset") return [400, '{"error":"flow-boni-delete"}'];
          flowsGone.push(...flowsNow().splice(flowsNow().indexOf(f), 1));
          return [200, "{}"];
        }
        for (const [k, v] of Object.entries(values)) {
          if (k === "f_titulo") {
            if (f.by === "preset") return [400, '{"error":"flow-boni-name"}'];
            f.name = String(v ?? "").trim() || f.name;
            f.version++;
          } else if (k === "f_estado") f.enabled = v === "o_estado_encendido";
          else return [400, '{"error":"read-only"}'];
        }
        return [200, rowOf(id)];
      };
      const dataAnswer = (method: string, p: string, body?: unknown): [number, string] => {
        const mine = myAnswer(method, p, body);
        if (mine) return mine;
        const ours = flowsAnswer(method, p, body);
        if (ours) return ours;
        const b = (body ?? {}) as { values?: Record<string, unknown> };
        if (p === "api/data/types" && method === "POST") {
          const want = (body ?? {}) as { name?: string; parent?: string };
          const name = String(want.name ?? "").trim();
          if (!name) return [400, '{"error":"bad-body"}'];
          if (userCols().some((c) => c.name.toLowerCase() === name.toLowerCase()))
            return [409, '{"error":"taken"}'];
          const id = `t_hecha_${madeCols.length + 1}`;
          madeCols.push({
            id,
            name,
            icon: "",
            titleField: "f_titulo",
            count: 0,
            level: "visible",
            fields: [{ id: "f_titulo", name: "Título", type: "text" }],
            rowUi: { open: false, hidden: [] },
          });
          if (want.parent) parents[id] = want.parent;
          return [200, JSON.stringify({ id })];
        }
        if (p === "api/data/usage")
          return [200, JSON.stringify(opts.usage ?? { days: 30, types: {} })];
        // A new column (task 40), or a relation drawn in a diagram (F6): on the collection, its id back.
        const fieldsOf = /^api\/data\/types\/([^/]+)\/fields$/.exec(p);
        if (fieldsOf && method === "POST") {
          const col = userCols().find((c) => c.id === fieldsOf[1]) as
            | { fields: Record<string, unknown>[] }
            | undefined;
          if (!col) return [404, '{"error":"not-found"}'];
          const want = (body ?? {}) as { name?: string; type?: string; target?: string };
          const id = `f_hecho_${col.fields.length + 1}`;
          col.fields.push({
            id,
            name: want.name,
            type: want.type,
            ...(want.type === "relation" ? { relation: { target: want.target, many: false } } : {}),
          });
          return [200, JSON.stringify({ id })];
        }
        if (p === "api/data/today")
          return opts.today === null
            ? [404, '{"error":"not-found"}']
            : [200, JSON.stringify({ day: today, items: opts.today ?? [] })];
        if (p === "api/data/types")
          return [
            200,
            JSON.stringify({
              types: [
                libros,
                documentos,
                ...agenda,
                ...(opts.mail ? [correos, archivos] : []),
                ...madeCols.map((c) => ({ ...c, count: own(c.id), parent: parents[c.id] })),
                ...boni,
                myType(),
                flowsType(),
              ],
            }),
          ];
        // The books' columns (task 40), as the server's data.ts changes them: added, renamed, of another kind,
        // a list's values, out and back.
        const colOp = /^api\/data\/types\/t_libro\/fields(?:\/([^/]+))?(\/restore)?$/.exec(p);
        if (colOp) {
          type Col = {
            id: string;
            key?: string;
            name: string;
            type: string;
            options?: { id: string; name: string }[];
          };
          const cols = libros.fields as Col[];
          const want = (body ?? {}) as {
            name?: string;
            type?: string;
            options?: { id?: string; name: string }[];
          };
          const taken = (name: string, but?: string) =>
            cols.some((c) => c.id !== but && c.name.toLowerCase() === name.toLowerCase());
          if (!colOp[1] && method === "POST") {
            const name = String(want.name ?? "").trim();
            if (!name || !want.type) return [400, '{"error":"bad-body"}'];
            if (taken(name)) return [409, '{"error":"taken"}'];
            const id = `f_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
            cols.push({
              id,
              name,
              type: want.type,
              ...(want.type.endsWith("select") ? { options: [] } : {}),
            });
            return [200, JSON.stringify({ id })];
          }
          const i = cols.findIndex((c) => c.id === colOp[1]);
          if (colOp[2]) {
            const back = goneCols.find((c) => c.id === colOp[1]);
            if (!back) return [404, '{"error":"not-found"}'];
            cols.push(back);
            return [200, "{}"];
          }
          if (i < 0) return [404, '{"error":"not-found"}'];
          const col = cols[i] as Col;
          if (method === "DELETE") {
            goneCols.push(col);
            cols.splice(i, 1);
            return [200, "{}"];
          }
          if (want.name !== undefined) {
            if (taken(want.name, col.id)) return [409, '{"error":"taken"}'];
            col.name = want.name;
          }
          if (want.type !== undefined) {
            if (rows.some((r) => r.values[col.id] !== undefined && r.values[col.id] !== null))
              return [409, '{"error":"in-use"}'];
            col.type = want.type;
          }
          if (want.options)
            col.options = want.options.map((o) => ({
              id: o.id ?? `o_${o.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
              name: o.name,
            }));
          return [200, "{}"];
        }
        const typeOp = /^api\/data\/types\/([^/]+)(?:\/(tree|parent|name))?$/.exec(p);
        if (typeOp && (method === "PUT" || method === "DELETE")) {
          const id = typeOp[1]!;
          if (!userCols().some((c) => c.id === id)) return [404, '{"error":"not-found"}'];
          // Renamed from the sidebar (task 42): a name is used once.
          if (typeOp[2] === "name") {
            const name = String((body as { name?: string }).name ?? "").trim();
            if (!name) return [400, '{"error":"bad-body"}'];
            if (userCols().some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase()))
              return [409, '{"error":"taken"}'];
            const col = userCols().find((c) => c.id === id);
            if (col) col.name = name;
            return [200, "{}"];
          }
          if (typeOp[2] === "tree") {
            eye[id] = Boolean((body as { notes?: boolean }).notes);
            return [200, "{}"];
          }
          if (typeOp[2] === "parent") {
            const to = (body as { parent?: string | null }).parent;
            if (to) parents[id] = to;
            else delete parents[id];
            return [200, "{}"];
          }
          if (method === "DELETE" && !typeOp[2]) {
            if (deep(id) > 0 || treeNotes.some((n) => n.type === id))
              return [409, '{"error":"not-empty"}'];
            madeCols.splice(
              madeCols.findIndex((c) => c.id === id),
              1,
            );
            return [200, "{}"];
          }
        }
        const moved = /^api\/data\/rows\/([^/]+)\/type$/.exec(p);
        if (moved && method === "PUT") {
          const to = String((body as { type?: string }).type ?? "");
          const n = treeNotes.find((x) => x.id === moved[1]);
          if (!n || !userCols().some((c) => c.id === to)) return [404, '{"error":"not-found"}'];
          n.type = to;
          return [200, "{}"];
        }
        const madeList =
          /^api\/data\/types\/(t_hecha_\d+|t_private_documentos|t_agenda)\/rows$/.exec(p);
        if (madeList && method === "GET" && madeList[1] !== documentos.id)
          return [
            200,
            JSON.stringify({
              rows: madeRows.filter((r) => r.type === madeList[1]),
              titles: {},
              truncated: false,
              ghosts: [],
              columns: {},
            }),
          ];
        if (madeList && method === "POST") {
          const row = {
            id: `m${madeRows.length + 1}`,
            type: madeList[1]!,
            values: { ...(b.values ?? {}) },
            body: "",
          };
          madeRows.push(row);
          return [200, JSON.stringify({ row })];
        }
        // A note of the tree renamed from the sidebar (task 42): its title.
        const noteRow = /^api\/data\/rows\/(d\d+)$/.exec(p);
        const tn = noteRow && method === "PUT" && treeNotes.find((n) => n.id === noteRow[1]);
        if (tn) {
          const title = (b.values ?? {})[documentos.titleField];
          if (typeof title === "string") tn.title = title;
          return [
            200,
            JSON.stringify({
              row: { id: tn.id, type: tn.type, values: { f_title: tn.title }, updated: 1 },
            }),
          ];
        }
        const madeRow = /^api\/data\/rows\/(m\d+)$/.exec(p);
        const mr = madeRow && madeRows.find((r) => r.id === madeRow[1]);
        if (mr) {
          if (method === "PUT") {
            Object.assign(mr.values, b.values ?? {});
            const text = (body as { body?: string }).body;
            if (text !== undefined) mr.body = text;
          }
          return [200, JSON.stringify({ row: { ...mr, updated: 1 } })];
        }
        // A page's numbers and charts (apps/server/src/blocks.ts), counted over the books here.
        if (p === "api/data/blocks") {
          const list = ((body ?? {}) as { blocks?: Record<string, unknown>[] }).blocks ?? [];
          const results = Object.fromEntries(
            list.map((x) => {
              if (x.collection !== "t_libro")
                return [
                  x.id,
                  {
                    problems: [
                      { block: x.id, key: "collection", code: "not-in-data", value: x.collection },
                    ],
                  },
                ];
              const field = libros.fields.find((f) => f.id === x.groupBy) as
                | { options?: { id: string; name: string }[] }
                | undefined;
              const by = new Map<string, number>();
              for (const r of rows) {
                const k = String(r.values[String(x.groupBy)] ?? "");
                by.set(k, (by.get(k) ?? 0) + 1);
              }
              const points =
                x.type === "number"
                  ? []
                  : [...by].map(([k, v]) => ({
                      key: k || "_",
                      label: field?.options?.find((o) => o.id === k)?.name ?? (k || "(vacío)"),
                      value: v,
                      partial: false,
                      no_data: false,
                    }));
              const kind = x.type === "graph" ? x.shape : x.type === "bars" ? "hbar" : "number";
              const data = {
                chart_id: "",
                title: x.title,
                subtitle: "octubre 2026 · hasta hoy",
                kind,
                measure: "count",
                unit: "",
                series: [{ key: "main", name: "", points, role: "main" }],
                total: rows.length,
                computed_at: new Date().toISOString(),
              };
              return [x.id, { data }];
            }),
          );
          return [200, JSON.stringify({ results })];
        }
        const rowUi = /^api\/data\/types\/([^/]+)\/row-ui$/.exec(p);
        if (rowUi) {
          if (rowUi[1] === MY) {
            myUi = { ...myUi, ...((body ?? {}) as Partial<typeof myUi>) };
            return [200, JSON.stringify(myUi)];
          }
          const t = userCols().find((x) => x.id === rowUi[1]);
          if (!t) return [404, '{"error":"not-found"}'];
          t.rowUi = { ...t.rowUi, ...((body ?? {}) as Partial<typeof t.rowUi>) };
          return [200, JSON.stringify(t.rowUi)];
        }
        const protect = /^api\/data\/types\/([^/]+)\/protection$/.exec(p);
        if (protect) {
          const t = userCols().find((x) => x.id === protect[1]);
          const want = (body ?? {}) as { level?: string; unlock?: boolean };
          if (!t) return [404, '{"error":"not-found"}'];
          if (t.level === "private" && want.level !== "private" && !want.unlock)
            return [409, '{"error":"locked"}'];
          t.level = String(want.level);
          return [200, JSON.stringify({ id: t.id, level: t.level })];
        }
        if (opts.mail && p === "api/data/types/t_01m6correo/rows" && method === "GET")
          return [
            200,
            JSON.stringify({
              rows: [mailRow],
              titles: {},
              truncated: false,
              ghosts: [],
              columns: {},
            }),
          ];
        if (opts.mail && p === "api/data/rows/m1" && method === "GET")
          return [200, JSON.stringify({ row: { ...mailRow, type: "t_01m6correo" } })];
        // An earlier mail of its thread (task 68: a card's «+1 correo»).
        if (opts.mail && p === "api/data/rows/m0" && method === "GET")
          return [
            200,
            JSON.stringify({
              row: {
                id: "m0",
                type: "t_01m6correo",
                values: {
                  f_asunto: "Actas: primera convocatoria",
                  f_de: "coordinacion@example.edu",
                  f_de_nombre: "Coordinación de ejemplo",
                  f_para: "ejemplo@example.edu",
                  f_fecha: "2026-10-15T08:00:00Z",
                  f_id_mensaje: "m0@example.com",
                },
                updated: 5,
                body: "Os convocamos para revisar las actas.",
              },
            }),
          ];
        // An image of the mail, as the server gives it to paint in place (a data: address).
        if (opts.mail && /^api\/data\/files\/[^/]+\/inline$/.test(p) && method === "GET")
          return [200, JSON.stringify({ mime: "image/png", data: "iVBORw0KGgo=" })];
        const fileRow = opts.mail && /^api\/data\/rows\/(a\d)$/.exec(p);
        if (fileRow && method === "GET") {
          const row = fileRows.find((r) => r.id === fileRow[1]);
          return row ? [200, JSON.stringify({ row: { ...row, type: "t_archivo" } })] : [404, "{}"];
        }
        // What a row points to, and its titles (apps/server/src/related.ts): here only the titles.
        if (/^api\/data\/rows\/[^/]+\/related$/.test(p) && method === "GET")
          return [
            200,
            JSON.stringify({
              groups: [],
              titles: {
                ...titlesOf(),
                ...(opts.mail
                  ? Object.fromEntries(fileRows.map((r) => [r.id, r.values.f_title]))
                  : {}),
              },
            }),
          ];
        if (p === "api/data/types/t_libro/rows" && method === "GET")
          return [
            200,
            JSON.stringify({
              rows,
              titles: titlesOf(),
              truncated: false,
              ghosts,
              // Each row's system columns (apps/server/src/audit.ts `systemColumns`).
              columns: Object.fromEntries(
                rows.map((r, i) => [
                  r.id,
                  {
                    created: Date.UTC(2026, 9, 1 + i, 9),
                    updated: r.updated > 1000 ? r.updated : Date.UTC(2026, 9, 20, 9),
                    version: 2,
                    createdBy: i === 0 ? "import" : "user:portatil",
                    updatedBy: i === 1 ? "mcp:claude-ejemplo" : "user:portatil",
                    editors: ["user:portatil"],
                    viewers: i === 1 ? ["mcp:claude-ejemplo"] : [],
                    seenAt: i === 1 ? Date.UTC(2026, 9, 24, 10) : null,
                    origin: i === 1 ? "model" : "user",
                    size: 420 + i,
                  },
                ]),
              ),
            }),
          ];
        if (p === "api/data/types/t_libro/rows") {
          const row = { id: `n${++rowSeq}`, values: { ...(b.values ?? {}) }, updated: Date.now() };
          rows = [row, ...rows];
          return [200, JSON.stringify({ row })];
        }
        const m = /^api\/data\/rows\/([^/]+)(\/restore)?$/.exec(p);
        if (!m) return [404, '{"error":"not-found"}'];
        if (m[2]) {
          const back = gone.find((x) => x.id === m[1]);
          if (back) rows = [back, ...rows];
          return [200, "{}"];
        }
        const i = rows.findIndex((x) => x.id === m[1]);
        if (i < 0) return [404, '{"error":"not-found"}'];
        if (method === "GET")
          return [200, JSON.stringify({ row: { body: "", ...rows[i], type: "t_libro" } })];
        if (method === "DELETE") {
          gone.push(rows[i]!);
          rows = rows.filter((x) => x.id !== m[1]);
          return [200, "{}"];
        }
        const values = { ...rows[i]!.values, ...(b.values ?? {}) };
        for (const [k, v] of Object.entries(values)) if (v === null) delete values[k];
        const bb = (body ?? {}) as { body?: string };
        rows[i] = {
          ...rows[i]!,
          values,
          updated: Date.now(),
          ...(bb.body !== undefined ? { body: bb.body } : {}),
        } as (typeof rows)[number];
        return [200, JSON.stringify({ row: rows[i] })];
      };
      const answer = (method: string, path: string, body?: unknown): [number, string] | null => {
        const p = path.split("?")[0]!;
        // What a request carried, for tests that check it (`window.__bodies`: "METHOD path {json}").
        if (body !== undefined) record("__bodies", `${method} ${p} ${JSON.stringify(body)}`);
        const tree = /^api\/data\/tree(?:\?type=([^&]+))?$/.exec(path);
        if (tree && method === "GET")
          return treeAnswer(tree[1] ? decodeURIComponent(tree[1]) : null);
        const audited = p.startsWith("api/data/audit/");
        if (p.startsWith("api/data/") && !audited) return dataAnswer(method, p, body);
        if (p === "api/pages-trash")
          return [
            200,
            JSON.stringify({ pages: trash.map((x) => ({ ...x, spec: undefined, deleted: 1 })) }),
          ];
        if (p === "api/pages" || p.startsWith("api/pages/")) return pageAnswer(method, p, body);
        if (p === "api/agent/proposals" && inbox)
          return [200, JSON.stringify({ proposals: inbox })];
        if (p === "api/agent/requests" && asked) return [200, JSON.stringify({ requests: asked })];
        if (opts.live && p.startsWith("api/agent/live/") && method === "GET") {
          const from = Number(new URLSearchParams(path.split("?")[1] ?? "").get("after")) || 0;
          return [200, JSON.stringify({ events: opts.live.events.slice(from), done: false })];
        }
        const answered = /^api\/agent\/requests\/([^/]+)\//.exec(p);
        if (answered && asked) asked = asked.filter((x) => x.id !== answered[1]);
        const decided = /^api\/agent\/proposals\/([^/]+)\/(accept|reject)$/.exec(p);
        if (decided && inbox) inbox = inbox.filter((x) => x.id !== decided[1]);
        // A decision taken back («Deshacer»): the proposal waits again, where it was.
        const restored = /^api\/agent\/proposals\/([^/]+)\/restore$/.exec(p);
        if (restored && inbox) {
          const all = (
            opts.agent?.["GET api/agent/proposals"]?.[0] as
              | { proposals: { id: string }[] }
              | undefined
          )?.proposals;
          const back = all?.find((x) => x.id === restored[1]);
          if (back && !inbox.some((x) => x.id === back.id))
            inbox = (all ?? []).filter(
              (x) => x.id === back.id || inbox?.some((y) => y.id === x.id),
            );
        }
        if (decided) ghosts = ghosts.filter((g) => g.proposal !== decided[1]);
        if (
          audited ||
          p.startsWith("api/agent/") ||
          p === "api/mail" ||
          p.startsWith("api/mail/")
        ) {
          const key = `${method} ${p
            .replace(/\/proposals\/[^/]+\//, "/proposals/:id/")
            .replace(/\/requests\/[^/]+\//, "/requests/:id/")
            .replace(/\/runs\/[^/]+\//, "/runs/:id/")
            .replace(/\/runs\/[^/]+$/, "/runs/:id")
            .replace(/\/visibility\/[^/]+$/, "/visibility/:type")
            .replace(/\/decisions\/[^/]+$/, "/decisions/:area")
            .replace(/\/extensions\/[^/]+\/(activate|reject|revert)$/, "/extensions/:id/$1")
            .replace(/\/extensions\/(?!proposals$)[^/]+$/, "/extensions/:id")
            .replace(/\/models\/roles\/[^/]+$/, "/models/roles/:role")
            .replace(/\/audit\/actions\/[^/]+$/, "/audit/actions/:seq")
            .replace(/\/audit\/rows\/[^/]+$/, "/audit/rows/:id")
            .replace(/\/models\/keys\/[^/]+$/, "/models/keys/:connection")
            .replace(/\/live\/[^/]+$/, "/live/:id")
            .replace(/\/flows\/(?!catalog$|check$)[^/]+$/, "/flows/:id")
            .replace(/\/flows\/[^/]+\/(enabled|revert|run|test)$/, "/flows/:id/$1")
            .replace(/\/mail\/webmail\/[^/]+$/, "/mail/webmail/:id")}`;
          const list = opts.agent?.[key];
          if (!list?.length) return [503, '{"error":"agent-off"}'];
          const n = agentCalls[key] ?? 0;
          agentCalls[key] = n + 1;
          // An answer with `__status` is an error the server would send (`{ __status: 400, error: "auth" }`).
          const item = list[Math.min(n, list.length - 1)] as Record<string, unknown> | undefined;
          if (item && typeof item === "object" && typeof item.__status === "number") {
            const { __status, ...rest } = item;
            return [__status as number, JSON.stringify(rest)];
          }
          return [200, JSON.stringify(item)];
        }
        const ok = (name: string): [number, string] => [200, examples[name]!];
        if (method === "DELETE") return [204, ""];
        if (p.endsWith("/home")) return ok("home.json");
        if (p.endsWith("/screens/capture-expense")) return ok("screen-capture-expense.json");
        if (p.includes("/options/")) return ok("options-people.json");
        if (p.endsWith("/charts/catalog")) return ok("chart-catalog.json");
        if (p.endsWith("/charts/preview")) return ok("chart-preview-split.json");
        if (p.endsWith("/charts") && method === "GET") return ok("charts.json");
        if (p.endsWith("/charts/order")) return ok("charts.json");
        if (p.includes("/data")) {
          if (p.includes("spending-by-category")) {
            return ok(
              path.includes("drill=")
                ? "chart-spending-by-category-drill.json"
                : "chart-spending-by-category.json",
            );
          }
          if (p.includes("monthly-spending")) return ok("chart-monthly-spending.json");
          return ok("chart-eating-out.json");
        }
        if (p.endsWith("/shortcuts") && method === "GET") return ok("shortcuts.json");
        if (p.endsWith("/shortcuts/order")) return ok("shortcuts.json");
        // a saved shortcut comes back as it was sent (a new one gets an id)
        if (p.includes("/shortcuts") && body !== undefined)
          return [
            200,
            JSON.stringify({ ...(body as object), id: (body as { id?: string }).id || "nuevo" }),
          ];
        if (p.endsWith("/widgets") && method === "GET") return ok("widgets.json");
        if (p.includes("/widgets"))
          return [200, '{"id":"w-new","chart_id":"eating-out","size":"medium"}'];
        // Undo of a capture just saved (apps/server/src/v1/service.ts undoAction).
        if (/\/actions\/[^/]+$/.test(p) && method === "DELETE")
          return [
            200,
            JSON.stringify({ status: "ok", message: "Deshecho", field_errors: {}, navigate: null }),
          ];
        if (p.endsWith("/actions")) {
          if (opts.action === "offline") return null;
          return ok(
            opts.action === "invalid" ? "action-result-invalid.json" : "action-result-ok.json",
          );
        }
        // a saved chart comes back as it was sent (a new one gets an id)
        if (p.includes("/charts") && body !== undefined)
          return [
            200,
            JSON.stringify({ ...(body as object), id: (body as { id?: string }).id || "nueva" }),
          ];
        return [404, examples["error.json"]!];
      };
      // Boni's own collections (boni-records.ts): counted in Node with the real engine, as the server would; a block
      // of Libros' rows, picked here by its filter and the bar clicked.
      const day = () => new Date().toISOString().slice(0, 10);
      const call = (kind: string, b: unknown) =>
        (w.__boniEngine as (k: string, b: unknown, t: string) => Promise<unknown>)(kind, b, day());
      const isSys = (x: unknown) =>
        String((x as { collection?: unknown })?.collection ?? "").startsWith("t_sys_");
      const engine = async (
        method: string,
        path: string,
        body?: unknown,
      ): Promise<[number, string] | null> => {
        const p = path.split("?")[0]!;
        const own = /^api\/data\/types\/(t_sys_[a-z]+)\/rows$/.exec(p);
        // «Mis datos» and «Flujos» are made apart (myRows, flowRows), as on the server.
        if (own && method === "GET" && own[1] !== "t_sys_datos" && own[1] !== "t_sys_flujos")
          return [200, JSON.stringify(await call("list", own[1]))];
        if (p === "api/data/blocks/rows") {
          const b = (body ?? {}) as { block?: Record<string, unknown>; drill?: string };
          if (isSys(b.block)) return [200, JSON.stringify(await call("rows", b))];
          const x = b.block ?? {};
          const picked = rows.filter(
            (r) =>
              (!x.filterField || r.values[String(x.filterField)] === x.filterValue) &&
              (!b.drill || String(r.values[String(x.groupBy)] ?? "") === b.drill),
          );
          return [
            200,
            JSON.stringify({
              type: "t_libro",
              rows: picked,
              total: picked.length,
              titles: {},
              columns: {},
            }),
          ];
        }
        if (p === "api/data/blocks") {
          const list = ((body ?? {}) as { blocks?: unknown[] }).blocks ?? [];
          if (!list.some(isSys)) return null;
          const mine = (await call("blocks", { blocks: list.filter(isSys) })) as {
            results: object;
          };
          const rest = list.filter((x) => !isSys(x));
          const theirs = rest.length
            ? (JSON.parse(answer(method, path, { blocks: rest })?.[1] ?? "{}") as {
                results?: object;
              })
            : {};
          return [200, JSON.stringify({ results: { ...theirs.results, ...mine.results } })];
        }
        return null;
      };
      w.boniDesktop = {
        async request(method: string, path: string, body?: unknown) {
          record(
            "__requests",
            `${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`,
          );
          if (!settings.serverUrl || !settings.hasToken)
            return { ok: false, offline: false, notConfigured: true };
          const a = opts.offline
            ? null
            : ((await engine(method, path, body)) ?? answer(method, path, body));
          await new Promise((r) =>
            setTimeout(
              r,
              opts.acceptMs && /^api\/agent\/proposals\/[^/]+\/accept/.test(path)
                ? opts.acceptMs
                : opts.turnMs && path === "api/agent/turn"
                  ? opts.turnMs
                  : opts.live && path.startsWith("api/agent/live/")
                    ? opts.live.ms
                    : opts.slow && path === opts.slow.path
                      ? opts.slow.ms
                      : 20,
            ),
          );
          if (!a) return { ok: false, offline: true, message: "refused" };
          return { ok: true, status: a[0], body: a[1] };
        },
        storeRead: async (name: string) => files.get(name) ?? null,
        storeWrite: async (name: string, text: string) => void files.set(name, text),
        storeRemove: async (name: string) => void files.delete(name),
        getSettings: async () => settings,
        async setSettings(patch: Record<string, unknown>) {
          const {
            resetWidgets: _r,
            widgetHidden,
            ...rest
          } = patch as {
            resetWidgets?: boolean;
            widgetHidden?: { id: string; hidden: boolean };
          };
          record("__calls", `setSettings ${JSON.stringify(patch)}`);
          let hidden = settings.hiddenWidgets.filter((id) => id !== widgetHidden?.id);
          if (widgetHidden?.hidden) hidden = [...hidden, widgetHidden.id];
          settings = { ...settings, ...rest, hiddenWidgets: hidden };
          for (const l of listeners) l({ type: "settings", settings });
          return settings;
        },
        async login(form: { serverUrl: string; user: string; password: string; device: string }) {
          record("__calls", `login ${form.serverUrl} ${form.user} ${form.device}`);
          await new Promise((r) => setTimeout(r, 50));
          if (form.password !== "una-contrasena-larga") return { ok: false, code: "bad-login" };
          settings = {
            ...settings,
            serverUrl: form.serverUrl,
            hasToken: true,
            user: form.user,
            device: form.device,
            legacyToken: false,
            sessionEnded: false,
          };
          for (const l of listeners) l({ type: "settings", settings });
          return { ok: true, settings };
        },
        async logout() {
          record("__calls", "logout");
          settings = { ...settings, hasToken: false, user: "" };
          return settings;
        },
        suggestedDevice: async () => "portatil",
        onEvent(cb: (e: unknown) => void) {
          listeners.add(cb);
          (w as Record<string, unknown>).__emit = (e: unknown) => {
            for (const l of listeners) l(e);
          };
          // A proposal arrives in the server's inbox (the next look at it finds it).
          (w as Record<string, unknown>).__pushProposal = (p: { id: string }) => {
            inbox = [...(inbox ?? []), p];
          };
          return () => listeners.delete(cb);
        },
        setWidgets: (list: unknown[]) => record("__calls", `setWidgets ${list.length}`),
        broadcastRefresh: () => record("__calls", "broadcastRefresh"),
        openMain: (screen?: string) => record("__calls", `openMain ${screen ?? ""}`.trim()),
        setLabels: () => undefined,
        widgetDragStart: (kind: string) => record("__calls", `dragStart ${kind}`),
        widgetDragMove: () => record("__calls", "dragMove"),
        widgetDragEnd: () => record("__calls", "dragEnd"),
        widgetHide: () => record("__calls", "hide"),
        ...(opts.peek
          ? { openPeek: (screen: string) => record("__calls", `openPeek ${screen}`) }
          : {}),
      };
    },
    { examples: EXAMPLES, opts, pages, boni: boniTypes(new Date().toISOString().slice(0, 10)) },
  );
  if (!engined.has(page)) {
    engined.add(page);
    await page.exposeFunction("__boniEngine", boniEngine);
  }
  await page.goto(url);
}

/**
 * Something of the sidebar's «Páginas» opened by its name: one of Boni's template pages or own collections unfolds
 * the «Boni» branch first (it starts folded).
 */
export async function openInTree(page: Page, name: string): Promise<void> {
  const list = page.locator(".sidebar").getByRole("list", { name: /^(Páginas|Pages)$/ });
  const item = list.getByRole("button", { name, exact: true });
  const unfold = list.getByRole("button", { name: /^(Mostrar subpáginas|Show subpages): Boni$/ });
  // Boni's branch unfolds by itself when one of its pages is the one open; else it is unfolded here.
  await item.or(unfold).first().waitFor();
  if (!(await item.isVisible())) await unfold.click();
  await item.click();
}

/**
 * Waits for an element's own animations to end: a menu grows in (scaled from 95 %), so where it opened is measured
 * once it has grown.
 */
export async function grown(l: Locator) {
  await l.evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))).then(() => true),
  );
}

/**
 * A mail card's source line keeps its icons whole however long its sender (task 68, I-21): the sender ends before
 * them, cut with «…»; each icon `size` px (28; 44 on the phone, for the finger), inside the line.
 */
export async function iconsWhole(card: Locator, size = 28) {
  const see = card.getByRole("button", { name: "Ver correo" });
  const gmail = card.getByRole("button", { name: "Abrir en Gmail" });
  await expect(see).toBeVisible();
  await expect(gmail).toBeVisible();
  const text = await card.locator(".inbox-source-text").boundingBox();
  const tools = await card.locator(".inbox-source-tools").boundingBox();
  const line = await card.locator(".inbox-source").boundingBox();
  if (!text || !tools || !line) throw new Error("the card's source line is not on screen");
  expect(text.x + text.width).toBeLessThanOrEqual(tools.x + 0.5);
  expect(tools.x + tools.width).toBeLessThanOrEqual(line.x + line.width + 0.5);
  expect(Math.round((await see.boundingBox())?.width ?? 0)).toBe(size);
  expect(Math.round((await gmail.boundingBox())?.width ?? 0)).toBe(size);
  expect(
    await card
      .locator(".inbox-source-text")
      .evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow),
  ).toBe("ellipsis");
}

/**
 * Changes the open view's layout (task 69), as a person does: a page's block by its one tab, a collection's view
 * by its settings' «Diseño». `db` is the block (`.db`).
 */
export async function setLayout(page: Page, db: Locator, name: string): Promise<void> {
  const head = db.locator(".db-head").first();
  const tab = head.getByRole("button", { name: "Diseño", exact: true });
  if (await tab.count()) {
    await tab.click();
    await page.getByRole("dialog", { name: "Diseño" }).getByRole("radio", { name }).click();
    return;
  }
  await head.getByRole("button", { name: "Ajustes de la vista" }).click();
  const box = page.getByRole("dialog", { name: "Ajustes de la vista" });
  await box.getByRole("menuitem", { name: /^Diseño/ }).click();
  await box.getByRole("radio", { name }).click();
  await page.keyboard.press("Escape");
}

/** Filters the open view by a property's value from the bar (task 69): the head's «Filtro», the property, its value. */
export async function addFilter(page: Page, db: Locator, field: string, value: string) {
  await db.locator(".db-head").first().getByRole("button", { name: "Filtro", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Añadir filtro" })
    .getByRole("menuitemradio", { name: field, exact: true })
    .click();
  await page.getByRole("combobox", { name: "Valor" }).selectOption({ label: value });
  await page.keyboard.press("Escape");
}

/** Takes a filter away by its chip in the bar (task 69). */
export async function removeFilter(page: Page, db: Locator, text: string) {
  await db.locator(".db-bar").getByRole("button", { name: text }).click();
  await page.getByRole("button", { name: "Quitar filtro" }).click();
}

export async function recorded(page: Page): Promise<Shell> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, string[] | undefined>;
    return { requests: w.__requests ?? [], calls: w.__calls ?? [] };
  });
}

/** Sends a shell event (tick, refresh, navigate) to the page. */
export async function emit(page: Page, event: unknown) {
  await page.evaluate(
    (e) => (window as unknown as { __emit: (e: unknown) => void }).__emit(e),
    event,
  );
}

/** Boni's log of runs («Registro»): from the conversation's tools (it is no longer in the sidebar). */
export async function openLog(page: Page, names = { chat: "Conversación", log: "Registro" }) {
  await page.locator(".sidebar").getByRole("button", { name: names.chat }).click();
  await page.locator(".chat-tools").getByRole("button", { name: names.log }).click();
}
