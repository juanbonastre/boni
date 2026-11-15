// The words of «Automatizaciones» (docs/automatizaciones.md AU-25, AU-60, AU-85, AU-86). Pending but the first: the
// builder's PRs bring the words into i18n.ts and turn each into a real test, the rule's id kept in its name.
import { describe, expect, it } from "vitest";
import { DO } from "./words.ts";

describe("the words of «Automatizaciones»", () => {
  it("AU-85 · each thing the editor does has a key of its own", () => {
    const keys = Object.values(DO);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^auto\.do\.[a-zA-Z]+$/);
  });
  it.todo(
    "AU-85 · the word of each thing the editor does is said by one key of i18n.ts: no other key of auto. says the same in either language, and no component names an auto.do. key but through DO",
  );
  it.todo(
    "AU-86 · every step type, action, parameter, choice, output, setting, measure, problem and failure the catalogue has is worded in i18n.ts in both languages: a name, a card and a panel never show a key",
  );
  it.todo(
    "AU-60 · the section's words say «Automatizaciones» and «automatización» in the sidebar, the collection's page, «Buscar» and the map; «flujo» is left only in «Formato anterior»",
  );
  it.todo(
    "AU-86 · a new step is named by its action's phrase and its collection («Buscar filas en Gastos»; with no collection, «Buscar filas»), and a name another step has takes the first free number («Filtrar 2»)",
  );
  it.todo(
    "AU-21 · a result is named by its measure and its field's name («Suma de Importe», «Número de filas»), never by its key, wherever a field's name is read: a chip, «Esquema», a table's header, a summary",
  );
});
