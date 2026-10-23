import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { importVault } from "@boni/vault-import";
import { afterEach, describe, expect, it } from "vitest";
import { saveCalendarDefs } from "./calendarStore.ts";
import { ghostRows, listRows } from "./data.ts";
import { inboxCard } from "./inboxCard.ts";

/** An invented calendar (never real notes) and mail, as the inbox meets them. */
const RAW = {
  id: "docencia",
  name: "Docencia",
  folder: "agenda/docencia",
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Hora de inicio", type: "time" },
  ],
  mapping: { title: "title", when: { kind: "split", date: "date", startTime: "startTime" } },
};
const DEF = `---\ntype: wiki\ncollection:\n  id: docencia\n  name: Docencia\n  folder: agenda/docencia\n  account: Agenda\n  color: "#60a5fa"\n  columns:\n    - { id: title, name: Título, type: text }\n    - { id: date, name: Fecha, type: date }\n    - { id: startTime, name: Hora de inicio, type: time }\n  mapping:\n    title: title\n    when: { kind: split, date: date, startTime: startTime }\n---\n`;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function env(): UserStore {
  const root = mkdtempSync(join(tmpdir(), "boni-inbox-"));
  const files: Record<string, string> = {
    "_system/colecciones/agenda-docencia.md": DEF,
    "agenda/docencia/2026-10-28 Clase.md":
      '---\ntitle: "Clase de ejemplo"\ndate: "2026-10-28"\nstartTime: "10:00"\n---\n',
    "agenda/docencia/2026-10-29 Tutoría.md":
      '---\ntitle: "Tutoría"\ndate: "2026-10-29"\nstartTime: "09:00"\n---\n',
  };
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  const store = openUserStore(":memory:");
  importVault(root, store, { apply: true });
  saveCalendarDefs(store, [{ type: "t_docencia", raw: RAW }]);
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return store;
}

/** A mail and the proposal its background run made, as mail.ts leaves them. */
function proposalFromMail(
  store: UserStore,
  id: string,
  run: string,
  sender: string,
  why = "antes del jueves revisad las actas de FUP 1",
) {
  const l = label("user", "personal", []);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_correo",
        key: "correo",
        name: "Correos",
        fields: [
          { id: "f_asunto", key: "asunto", name: "Asunto", type: "text", label: l },
          { id: "f_de", key: "de", name: "De", type: "text", label: l },
          { id: "f_de_nombre", key: "de-nombre", name: "De (nombre)", type: "text", label: l },
        ],
        titleField: "f_asunto",
        sensitivity: "personal",
        schemaVersion: 1,
        label: l,
      },
    },
    { actor: "agent" },
  );
  const mail = store.create(
    "t_correo",
    {
      f_asunto: { value: "Actas de FUP 1", label: l },
      f_de: { value: sender, label: l },
      f_de_nombre: { value: "Coordinación de ejemplo", label: l },
      $body: {
        value: "Hola,\n\nantes del jueves revisad las actas de FUP 1.\n\nGracias.",
        label: l,
      },
    },
    { actor: "agent" },
  );
  store.journal.startRun({ id: run, turn: null, origin: "background", device: null, started: 1 });
  store.journal.setPlan(run, {
    steps: [{ tool: "entities.get", args: { id: { lit: mail.entity.id } } }],
  });
  store.journal.addProposal({
    id,
    run,
    tool: "entities.create",
    args: { values: {}, origins: [], why: { t: "v", value: why, label: l, derived: false } },
    view: {
      tool: "entities.create",
      title: "Crear",
      rows: [
        { arg: "type", role: "type", value: "docencia", detail: "Docencia" },
        { arg: "values.title", value: "Revisar actas de FUP 1" },
        { arg: "values.date", value: "2026-10-29" },
      ],
    },
    sources: [`mail:${sender}`],
    created: 2,
  });
}

describe("the inbox's card for a proposal", () => {
  it("says what it does, where it came from, and what the days around it hold", () => {
    const store = env();
    proposalFromMail(store, "p1", "r1", "coordinacion@example.edu");
    const card = inboxCard(
      store,
      store.journal.proposal("p1") as NonNullable<ReturnType<typeof store.journal.proposal>>,
      {
        mailAccount: "ejemplo@example.edu",
      },
    );
    expect(card).toMatchObject({
      action: "create",
      collection: "Docencia",
      kind: "task",
      title: "Revisar actas de FUP 1",
      day: "2026-10-29",
      source: {
        kind: "mail",
        account: "ejemplo@example.edu",
        from: "Coordinación de ejemplo",
        subject: "Actas de FUP 1",
        excerpt: "Hola, antes del jueves revisad las actas de FUP 1. Gracias.",
        open: { type: "t_correo" },
      },
      // The reader's quote, found as such in the mail by the code.
      why: { text: "antes del jueves revisad las actas de FUP 1", verbatim: true },
      familiar: 0,
      complete: true,
      mode: "detailed",
    });
    expect(card.context.map((d) => [d.day, d.items.map((i) => i.title)])).toEqual([
      ["2026-10-28", ["Clase de ejemplo"]],
      ["2026-10-29", ["Tutoría"]],
      ["2026-10-30", []],
    ]);
  });

  it("a reason the mail does not say in those words is shown, but not as a quote", () => {
    const store = env();
    proposalFromMail(store, "p1", "r1", "coordinacion@example.edu", "Piden revisar actas");
    const card = inboxCard(
      store,
      store.journal.proposal("p1") as NonNullable<ReturnType<typeof store.journal.proposal>>,
    );
    expect(card.why).toEqual({ text: "Piden revisar actas", verbatim: false });
  });

  it("is compact once Juan accepted two like it from the same source", () => {
    const store = env();
    proposalFromMail(store, "p0", "r0", "coordinacion@example.edu");
    for (const id of ["a1", "a2"]) {
      const p = store.journal.proposal("p0") as NonNullable<
        ReturnType<typeof store.journal.proposal>
      >;
      store.journal.addProposal({ ...p, id, created: 1 });
      store.journal.setProposal(id, "accepted", 3);
    }
    expect(
      inboxCard(
        store,
        store.journal.proposal("p0") as NonNullable<ReturnType<typeof store.journal.proposal>>,
      ),
    ).toMatchObject({
      familiar: 2,
      mode: "compact",
    });
  });

  it("a pending proposal is a ghost row of its collection, never an entity; decided, it is gone", () => {
    const store = env();
    proposalFromMail(store, "p1", "r1", "coordinacion@example.edu");
    expect(ghostRows(store, "t_docencia")).toEqual([
      {
        id: "ghost:p1",
        proposal: "p1",
        values: { f_title: "Revisar actas de FUP 1", f_date: "2026-10-29" },
        updated: 2,
      },
    ]);
    const listed = listRows(store, "t_docencia");
    expect(listed.ghosts).toHaveLength(1);
    expect(listed.rows.some((r) => r.id.startsWith("ghost:"))).toBe(false);
    expect(store.list("t_docencia")).toHaveLength(2); // the two classes, not the proposal
    store.journal.setProposal("p1", "rejected", 5);
    expect(ghostRows(store, "t_docencia")).toEqual([]);
  });
});
