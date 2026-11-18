/** «Publicar» and what goes with it on the screen, in words (publishing.ts, F14d P1): what has no screen of its own. */
import {
  AUTOMATION_LIMITS,
  type Automation,
  diffAutomations,
  FORMAT,
  type Step,
} from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import type { Opened } from "./client.ts";
import {
  abilityLine,
  checkLines,
  diffLines,
  limitField,
  publishWord,
  refusedWords,
  shownLimits,
  stoppedByLimit,
  withLimit,
} from "./publishing.ts";
import { openedEditor, publishAsked } from "./state.ts";

const t = translator("es");
const trigger: Step = {
  id: "s_01jinicio",
  name: "Disparado por el usuario",
  type: "manual",
  params: {},
};
const buscar: Step = {
  id: "s_01jbuscar",
  name: "Buscar pendientes",
  type: "collection",
  params: { collection: "libros", action: "find" },
};
const crear: Step = {
  id: "s_01jcrear",
  name: "Crear tarea",
  type: "collection",
  params: { collection: "tareas", action: "create", permission: "yes" },
};
const draft = (steps: Step[], more: Partial<Automation> = {}): Automation => ({
  format: FORMAT,
  id: "a_01jx8x0t2v4x6z8b0d2f4h6k9p",
  version: 0,
  name: "Revisar pendientes",
  steps,
  arrows: [],
  settings: {},
  ...more,
});
const READING = draft([trigger, buscar]);
const WRITING = draft([trigger, buscar, crear]);
const NAMES: Record<string, string> = { libros: "Libros", tareas: "Tareas" };
const named = (name: string) => Object.entries(NAMES).find(([, n]) => n === name)?.[0];

describe("«Guardado» and the version that runs", () => {
  it("AU-95 · says nothing until the versions arrive, «sin publicar» never published, and whether the draft is the version that runs", () => {
    expect(publishWord(WRITING, null)).toBeNull();
    expect(publishWord(WRITING, { running: null, enabled: false, doc: null })).toBe("never");
    // Published, its document not read yet: nothing rather than a guess.
    expect(publishWord(WRITING, { running: 2, enabled: true, doc: null })).toBeNull();
    expect(publishWord(WRITING, { running: 2, enabled: true, doc: WRITING })).toBe("running");
    expect(publishWord(WRITING, { running: 2, enabled: true, doc: READING })).toBe("changes");
    // Moving a box or saving the steps in another order is no change (AU-05).
    const reordered = { ...WRITING, steps: [...WRITING.steps].reverse() };
    expect(publishWord(reordered, { running: 2, enabled: true, doc: WRITING })).toBe("running");
    expect(t("auto.pub.running", { n: 2 })).toBe("publicada la versión 2");
  });
});

describe("pantalla 10", () => {
  it("AU-96 · «Qué cambia»: a step added links to it, a step removed is named from the version, the name and a limit say from and to", () => {
    const was = draft([trigger, buscar, { ...crear, id: "s_01jviejo", name: "Paso viejo" }], {
      name: "Pendientes",
    });
    const now = draft([trigger, buscar, crear], {
      settings: { limits: { rowsWritten: 5_000 } },
    });
    const all = [...was.steps, ...now.steps];
    const nameOf = (id: string) => all.find((s) => s.id === id)?.name ?? id;
    const lines = diffLines(t, diffAutomations(was, now), nameOf, "es-ES");
    expect(lines).toEqual([
      { text: "Nombre: «Pendientes» → «Revisar pendientes»" },
      { text: "Añade «Crear tarea»", step: "s_01jcrear" },
      { text: "Quita «Paso viejo»" },
      { text: "Filas escritas: 1000 → 5000" },
    ]);
  });
  it("AU-96 · «Qué cambia»: a step changed says what changed in it, and the same document says nothing", () => {
    const changed = draft([
      trigger,
      { ...buscar, params: { ...buscar.params, collection: "tareas" } },
    ]);
    const lines = diffLines(t, diffAutomations(READING, changed), (id) => id, "es-ES");
    expect(lines).toEqual([{ text: "Cambia «s_01jbuscar»: parámetros", step: "s_01jbuscar" }]);
    expect(diffLines(t, diffAutomations(READING, READING), (id) => id, "es-ES")).toEqual([]);
  });
  it("AU-96 · «Antes de publicar»: what stops it first, in validation's words with its step, then what is worth a look", () => {
    const lines = checkLines(
      t,
      {
        blocks: [{ code: "param.required", step: "s_01jcrear", detail: { param: "collection" } }],
        looks: [
          { code: "step.untested", step: "s_01jcrear" },
          { code: "limit.changed", detail: { limit: "ms", value: 120_000, default: 60_000 } },
        ],
      },
      "es-ES",
      (key) => NAMES[key],
    );
    expect(lines.map((l) => [l.block, l.step])).toEqual([
      [true, "s_01jcrear"],
      [false, "s_01jcrear"],
      [false, undefined],
    ]);
    expect(lines[0]?.text).not.toBe("");
    expect(lines.slice(1).map((l) => l.text)).toEqual([
      "sin probar",
      "Tiempo: 120 s (por defecto 60 s)",
    ]);
  });
  it("AU-182 · «Lo que podrá hacer»: one line per collection and action, with how it saves and «con datos de fuera», the collection by its name", () => {
    const name = (key: string) => NAMES[key] ?? key;
    expect(abilityLine(t, { collection: "libros", action: "read", steps: [] }, name)).toBe(
      "Lee Libros",
    );
    expect(
      abilityLine(
        t,
        { collection: "tareas", action: "create", how: "saves", outside: true, steps: [] },
        name,
      ),
    ).toBe("Crea filas en Tareas · las guarda · con datos de fuera");
    expect(
      abilityLine(t, { collection: "libros", action: "update", how: "asks", steps: [] }, name),
    ).toBe("Modifica filas en Libros · pregunta");
    expect(
      abilityLine(t, { collection: "c_01jotra", action: "remove", how: "noAsk", steps: [] }, name),
    ).toBe("Elimina filas en c_01jotra · sin preguntar");
  });
  it("AU-200 AU-196 · an «Agente»'s line says «decidido por un modelo» and its «Como mucho», summed over the steps when each has one, before «con datos de fuera»", () => {
    const name = (key: string) => NAMES[key] ?? key;
    const agent = (id: string, limit?: number): Step => ({
      id,
      name: "Analista",
      type: "agent",
      params: { instructions: "Ordena las tareas" },
      connections: [
        {
          collection: "tareas",
          read: {},
          create: false,
          update: false,
          remove: { mode: "yes", ...(limit === undefined ? {} : { limit }) },
        },
      ],
    });
    const two = draft([trigger, agent("s_01jagente", 20), agent("s_01jotro", 5)]);
    const line = (steps: string[], outside = false) =>
      abilityLine(
        t,
        {
          collection: "tareas",
          action: "remove",
          how: "noAsk",
          byAgent: true,
          ...(outside ? { outside } : {}),
          steps,
        },
        name,
        two,
      );
    expect(line(["s_01jagente"], true)).toBe(
      "Elimina filas en Tareas · sin preguntar · decidido por un modelo · como mucho 20 · con datos de fuera",
    );
    expect(line(["s_01jagente", "s_01jotro"])).toBe(
      "Elimina filas en Tareas · sin preguntar · decidido por un modelo · como mucho 25",
    );
    // One with no «Como mucho»: nothing is said of it.
    const open = draft([trigger, agent("s_01jagente", 20), agent("s_01jotro")]);
    expect(
      abilityLine(
        t,
        {
          collection: "tareas",
          action: "remove",
          byAgent: true,
          steps: ["s_01jagente", "s_01jotro"],
        },
        name,
        open,
      ),
    ).toBe("Elimina filas en Tareas · decidido por un modelo");
    expect(
      abilityLine(t, { collection: "tareas", action: "read", byAgent: true, steps: [] }, name, two),
    ).toBe("Lee Tareas · decidido por un modelo");
  });
  it("AU-96 · «Publicar» with something that stops it marks the steps as a test that could not start does", () => {
    const state = openedEditor(opened(WRITING));
    const blocks = [
      { code: "param.required", severity: "error", step: "s_01jcrear", param: "collection" },
    ] as never;
    const asked = publishAsked(state, blocks);
    expect(asked.asked).toBe(true);
    expect(asked.problems).toEqual(blocks);
    expect(state.asked).toBe(false);
  });
});

describe("«Ajustes»: the limits", () => {
  it("AU-17 · «Tiempo» always, «Filas escritas» only when a step writes", () => {
    expect(shownLimits(READING, named)).toEqual(["ms"]);
    expect(shownLimits(WRITING, named)).toEqual(["ms", "rowsWritten"]);
  });
  it("AU-206 · «Llamadas a modelos» when a step calls a model, an «Agente» or a reader, with its default and its ceiling; never for one that does not", () => {
    const analista: Step = {
      id: "s_01janalista",
      name: "Analista",
      type: "agent",
      params: { instructions: "Ordena las tareas" },
      connections: [
        {
          collection: "tareas",
          read: {},
          create: { mode: "ask", limit: 20 },
          update: false,
          remove: false,
        },
      ],
    };
    const reading: Step = {
      ...analista,
      connections: [{ ...analista.connections![0]!, create: false }],
    };
    expect(shownLimits(draft([trigger, analista]), named)).toEqual([
      "ms",
      "rowsWritten",
      "modelCalls",
    ]);
    expect(shownLimits(draft([trigger, reading]), named)).toEqual(["ms", "modelCalls"]);
    const classify: Step = {
      id: "s_01jclasificar",
      name: "Clasificar",
      type: "classify",
      params: { text: "{{ $json.titulo }}" },
    };
    expect(shownLimits(draft([trigger, buscar, classify]), named)).toEqual(["ms", "modelCalls"]);
    expect(limitField(draft([trigger, analista]), "modelCalls")).toBe(
      AUTOMATION_LIMITS.modelCalls.default,
    );
    expect(withLimit(draft([trigger, analista]), "modelCalls", "41")).toBe("over");
    expect(t("auto.limitName.modelCalls")).toBe("Llamadas a modelos");
  });
  it("AU-17 · a field shows the default in its unit, and a value typed is kept in the draft until its ceiling", () => {
    expect(limitField(WRITING, "ms")).toBe(60);
    expect(limitField(WRITING, "rowsWritten")).toBe(1_000);
    const longer = withLimit(WRITING, "ms", "120");
    expect(longer).toMatchObject({ settings: { limits: { ms: 120_000 } } });
    expect(limitField(longer as Automation, "ms")).toBe(120);
    const ceiling = AUTOMATION_LIMITS.rowsWritten.ceiling;
    expect(withLimit(WRITING, "rowsWritten", String(ceiling))).toMatchObject({
      settings: { limits: { rowsWritten: ceiling } },
    });
    expect(withLimit(WRITING, "rowsWritten", String(ceiling + 1))).toBe("over");
    expect(withLimit(WRITING, "ms", "601")).toBe("over");
    for (const typed of ["", " ", "0", "-5", "1,5", "abc"])
      expect(withLimit(WRITING, "ms", typed), typed).toBe("bad");
  });
  it("AU-17 · a limit put back to its default leaves the settings as they were before it changed", () => {
    const changed = withLimit(WRITING, "ms", "120") as Automation;
    const back = withLimit(changed, "ms", "60") as Automation;
    expect(back.settings).toEqual({});
    const both = withLimit(changed, "rowsWritten", "50") as Automation;
    expect((withLimit(both, "ms", "60") as Automation).settings).toEqual({
      limits: { rowsWritten: 50 },
    });
  });
  it("AU-17 · a test that stopped at a limit says which, so «Registro» offers to change it; any other failure does not", () => {
    const failed = (failure: Record<string, unknown>) =>
      openedEditor({
        ...opened(WRITING),
        tests: {
          s_01jcrear: {
            state: "failed",
            at: 1,
            ms: 3,
            in: { main: 1001 },
            out: {},
            retries: 0,
            failed: 0,
            wouldWrite: 0,
            error: { message: "", failure },
          },
        } as never,
      });
    expect(
      stoppedByLimit(
        failed({ code: "run.limit", detail: { limit: "rowsWritten", max: 1000, got: 1001 } }),
      ),
    ).toBe("rowsWritten");
    expect(stoppedByLimit(failed({ code: "run.limit", detail: { limit: "ms" } }))).toBe("ms");
    expect(stoppedByLimit(failed({ code: "run.limit", detail: { limit: "nada" } }))).toBeNull();
    expect(stoppedByLimit(failed({ code: "other" }))).toBeNull();
    expect(stoppedByLimit(openedEditor(opened(WRITING)))).toBeNull();
  });
});

describe("the words of a refusal", () => {
  it("AU-188 · a shared device, a draft changed elsewhere, nothing to publish, off and already running each say theirs", () => {
    expect(refusedWords(t, "not-personal")).toBe(t("mail.error.personal-device-only"));
    expect(refusedWords(t, "stale")).toBe("El borrador cambió en otro dispositivo");
    expect(refusedWords(t, "unchanged")).toBe("Sin cambios");
    expect(refusedWords(t, "off")).toBe("Apagada");
    expect(refusedWords(t, "running")).toBe("En ejecución");
    expect(refusedWords(t, "otra-cosa")).toBe(t("error.generic"));
  });
});

function opened(automation: Automation): Opened {
  return {
    id: automation.id,
    rev: 3,
    automation,
    places: automation.steps.map((s, i) => ({ step: s.id, x: i * 300, y: 0 })),
    tests: {},
    tested: {},
    pins: {},
    device: "d_portatil",
    updated: 1,
  };
}
