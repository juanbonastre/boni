import type { Entity, TypeDef } from "../packages/entities/src/index.ts";
import { blockRows, computeBlock, tableRows } from "../packages/views/src/index.ts";

/**
 * Movements and their categories shaped like Juan's (apps/server/src/seed.test-util.ts, e2e/server-data.ts): ids as
 * the server generates them, a movement's category a record of «Categorías» (a relation), its amount negative for a
 * spending. A year of invented movements, the same every run, counted with the real engine (packages/views) and the
 * page's controls as the server would (D-59), for the fake server of fixtures.ts (`money: true`). Invented data only.
 */

export const MOV = "t_01m6mov4k2v9q";
export const CAT = "t_01m6cat7h3x2p";
export const F = {
  catName: "f_01m6cnombre",
  date: "f_01m6mfecha",
  amount: "f_01m6mimporte",
  category: "f_01m6mcategoria",
  merchant: "f_01m6mcomercio",
  account: "f_01m6mcuenta",
} as const;
/** The accounts, a select's options. */
export const ACCOUNTS = [
  { id: "o_01m6banco", name: "Banco" },
  { id: "o_01m6efectivo", name: "Efectivo" },
] as const;
/** The categories, by their record ids. */
export const CATS = [
  ["e_01m6cafe0001", "bebida/cafe"],
  ["e_01m6super002", "comida/super"],
  ["e_01m6trans003", "transporte/metro"],
] as const;

const field = (id: string, key: string, name: string, type: string, more: object = {}) => ({
  id,
  key,
  name,
  type,
  label: { origin: "user" },
  ...more,
});

const types: Record<string, TypeDef> = {
  [CAT]: {
    id: CAT,
    key: "categoria",
    name: "Categorías",
    titleField: F.catName,
    sensitivity: "personal",
    schemaVersion: 1,
    fields: [field(F.catName, "nombre", "Nombre", "text")],
  } as unknown as TypeDef,
  [MOV]: {
    id: MOV,
    key: "movimiento",
    name: "Movimientos",
    titleField: F.merchant,
    sensitivity: "sensitive",
    schemaVersion: 1,
    roles: { date: F.date, amount: F.amount, category: F.category },
    fields: [
      field(F.merchant, "merchant", "Comercio", "text"),
      field(F.date, "date", "Fecha", "date"),
      field(F.amount, "amount", "Importe", "number"),
      field(F.category, "category", "Categoría", "relation", {
        relation: { target: CAT, many: false },
      }),
      field(F.account, "account", "Cuenta", "select", { options: ACCOUNTS.map((o) => ({ ...o })) }),
    ],
  } as unknown as TypeDef,
};

/** The year of movements up to `today`: a coffee every third day, the market weekly, the metro every other day. */
function records(today: string): Record<string, Entity[]> {
  const end = Date.parse(`${today}T12:00:00Z`);
  const ent = (id: string, type: string, values: Entity["values"]): Entity => ({
    id,
    type,
    values,
    created: end,
    updated: end,
    version: 1,
  });
  const cats = CATS.map(([id, name]) => ent(id, CAT, { [F.catName]: name }));
  const movs: Entity[] = [];
  for (let d = 0; d < 365; d++) {
    const day = new Date(end - d * 86_400_000).toISOString().slice(0, 10);
    const add = (cat: number, amount: number, merchant: string) =>
      movs.push(
        ent(`e_01m6mv${String(movs.length).padStart(6, "0")}`, MOV, {
          [F.date]: day,
          [F.amount]: amount,
          [F.category]: CATS[cat]?.[0] as string,
          [F.merchant]: merchant,
          // The coffee in cash, the rest from the bank.
          [F.account]: (cat === 0 ? ACCOUNTS[1] : ACCOUNTS[0]).id,
        }),
      );
    if (d % 3 === 0) add(0, -1.5, "Cafetería Ejemplo");
    if (d % 7 === 0) add(1, -40, "Mercado Ejemplo");
    if (d % 2 === 0) add(2, -2, "Metro Ejemplo");
  }
  return { [CAT]: cats, [MOV]: movs };
}

/** The two collections as the app lists them (`GET api/data/types`). */
export function moneyTypes() {
  return Object.values(types).map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    icon: "",
    titleField: t.titleField,
    fields: t.fields.map((f) => ({
      id: f.id,
      key: f.key,
      name: f.name,
      type: f.type,
      ...(f.relation ? { relation: f.relation } : {}),
      ...(f.options ? { options: f.options.map((o) => ({ id: o.id, name: o.name })) } : {}),
    })),
    ...((t as { roles?: object }).roles ? { roles: (t as { roles?: object }).roles } : {}),
    count: 0,
    level: "visible",
    rules: [],
    rowUi: { open: false, hidden: [] },
  }));
}

export const isMoney = (x: unknown) => {
  const c = (x as { collection?: unknown } | undefined)?.collection;
  return c === MOV || c === CAT;
};

const rowOf = (e: Entity) => ({ id: e.id, values: e.values, updated: e.updated });

/** `POST api/data/blocks`, `POST api/data/blocks/rows` and a collection's rows, for these two collections. */
export function moneyEngine(
  kind: "blocks" | "rows" | "list",
  body: unknown,
  today: string,
): unknown {
  const all = records(today);
  const rows = (type: string) => all[type] ?? [];
  const titleOf = (id: string) => {
    const v = rows(CAT).find((e) => e.id === id)?.values[F.catName];
    return typeof v === "string" ? v : id;
  };
  if (kind === "list") {
    const list = rows(String(body));
    const titles =
      String(body) === MOV
        ? Object.fromEntries(CATS.map(([id, name]) => [id, name]))
        : ({} as Record<string, string>);
    return { rows: list.map(rowOf), titles, truncated: false, ghosts: [], columns: {} };
  }
  const controls = ((body ?? {}) as { controls?: never[] }).controls ?? [];
  if (kind === "blocks") {
    const blocks = ((body ?? {}) as { blocks?: Record<string, unknown>[] }).blocks ?? [];
    return {
      results: Object.fromEntries(
        blocks.map((b) => {
          const out = computeBlock(b as never, types, rows, { today, titleOf, controls });
          return [
            b.id,
            "data" in out ? { data: { ...out.data, computed_at: `${today}T10:00:00.000Z` } } : out,
          ];
        }),
      ),
    };
  }
  const b = (body ?? {}) as { block?: Record<string, unknown>; drill?: string };
  // A page's table (task 102): its rules with the page's values over every record, as the server's blocks.ts.
  if (b.block?.type === "database") {
    const source = String(b.block.source ?? "");
    const def = types[source];
    if (!def) return { problems: ["bad-block"] };
    const view = (b.block.view ?? {}) as { filter?: never };
    const picked = tableRows(rows(source), def, view.filter, { today, controls });
    const titles =
      source === MOV
        ? Object.fromEntries(CATS.map(([id, name]) => [id, name]))
        : ({} as Record<string, string>);
    return {
      type: source,
      rows: picked.map(rowOf),
      total: picked.length,
      truncated: false,
      titles,
      ghosts: [],
      columns: {},
    };
  }
  const out = blockRows(b.block as never, types, rows, {
    today,
    drill: b.drill ?? null,
    controls,
  });
  if ("problems" in out) return out;
  return {
    type: b.block?.collection,
    rows: out.rows.map(rowOf),
    total: out.rows.length,
    titles: {},
    columns: {},
  };
}
