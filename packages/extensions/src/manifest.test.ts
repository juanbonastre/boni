import { describe, expect, it } from "vitest";
import {
  type Catalogue,
  type ExtensionManifest,
  manifestErrors,
  moreNeeds,
  parseManifest,
} from "./manifest.ts";

const cat: Catalogue = {
  connectors: ["imap"],
  modules: { tasks: { kind: "task" }, events: { kind: "event" } },
  plans: ["read-and-propose"],
  roles: ["cheap", "strong"],
};
const mail: ExtensionManifest = {
  id: "correo",
  name: "Correo",
  version: 1,
  types: [{ key: "correo", name: "Correos", fields: ["asunto", "de", "para", "cc", "fecha"] }],
  sources: [{ connector: "imap", into: "correo" }],
  readers: [{ module: "tasks" }, { module: "events" }],
  flows: [{ on: { created: "correo" }, plan: "read-and-propose" }],
  routes: { tasks: { propose: "chosen" }, events: { propose: "chosen" } },
  learning: { every: 20 },
  needs: {
    reads: ["correo"],
    proposes: true,
    roles: { reader: "cheap" },
    budget: { readersPerDay: 150 },
  },
};
const errs = (patch: Record<string, unknown>) => manifestErrors({ ...mail, ...patch }, cat);

describe("an extension's manifest (docs/extensiones.md 3)", () => {
  it("the mail extension is made only of catalogue pieces", () => {
    expect(manifestErrors(mail, cat)).toEqual([]);
    expect(parseManifest(mail, cat).ok).toBe(true);
  });

  it("names nothing the catalogue does not offer", () => {
    expect(errs({ sources: [{ connector: "ssh", into: "correo" }] })).toContain(
      "sources[0].connector: not in the catalogue",
    );
    expect(errs({ readers: [{ module: "spy" }] })).toContain(
      "readers[0].module: not in the catalogue",
    );
    expect(errs({ flows: [{ on: { created: "correo" }, plan: "run-shell" }] })).toContain(
      "flows[0].plan: not in the catalogue",
    );
    expect(errs({ needs: { ...mail.needs, roles: { reader: "gpt-x" } } })).toContain(
      "needs.roles.reader: not in the catalogue",
    );
  });

  it("is closed: unknown keys, code-looking or linking prompts and two modules for one kind are refused", () => {
    expect(errs({ script: "rm -rf /" })).toContain("manifest: unknown keys script");
    expect(
      errs({ readers: [{ module: "plazos", kind: "deadline", prompt: "see https://x.example" }] }),
    ).toContain("readers[0].prompt: 1 to 1200 characters, no links or HTML");
    expect(errs({ readers: [{ module: "a1", kind: "notice", prompt: "x" }] })).toContain(
      'readers[0].kind: ASCII id, not "notice"',
    );
    expect(
      errs({
        readers: [
          { module: "tasks" },
          { module: "otra", kind: "task", prompt: "Tareas otra vez." },
        ],
      }),
    ).toContain("readers: two modules look for the same kind");
    expect(errs({ routes: { tasks: { send: "a@example.com" } } })[0]).toMatch(/^routes\.tasks:/);
  });

  it("a module of its own: its kind and its prompt part, as data", () => {
    expect(
      errs({
        readers: [
          {
            module: "deadlines",
            kind: "deadline",
            prompt: "a date by which the user must hand something in",
          },
        ],
        routes: { deadlines: { propose: { collection: "t_docencia" } } },
      }),
    ).toEqual([]);
  });

  it("says what it reads and that it proposes; a route of a module it lacks is an error", () => {
    expect(errs({ needs: { ...mail.needs, reads: [] } })).toContain("needs.reads: misses correo");
    expect(errs({ needs: { ...mail.needs, proposes: false } })).toContain(
      "needs.proposes: its routes propose",
    );
    expect(errs({ routes: { otra: { none: true } } })).toContain(
      "routes.otra: not one of its modules",
    );
    expect(errs({ needs: { ...mail.needs, budget: { readersPerDay: 100000 } } })).toContain(
      "needs.budget: { readersPerDay: 1 to 2000 }",
    );
  });

  it("a new version shows what more it asks for", () => {
    const next: ExtensionManifest = {
      ...mail,
      version: 2,
      needs: { ...mail.needs, reads: ["correo", "persona"], budget: { readersPerDay: 300 } },
    };
    expect(moreNeeds(mail, next)).toEqual(["reads:persona", "budget"]);
    expect(moreNeeds(mail, mail)).toEqual([]);
  });
});
