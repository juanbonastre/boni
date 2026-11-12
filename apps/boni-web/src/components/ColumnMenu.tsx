// A column's menu in a collection's table, and its «+» (tasks 40 and 76; Notion's property menu): its name, editing it and its kind, what the view does with it (filter, sort, group, calculate, pin, hide, wrap) and what the collection does (insert beside, duplicate, delete); a new column with its name and kind.

import type { Calc, DatabaseView } from "@boni/views";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpDown,
  Copy,
  EyeOff,
  ListFilter,
  Pencil,
  Pin,
  Plus,
  Repeat,
  Rows3,
  Sigma,
  Trash2,
  WrapText,
  X,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { DataField, DataType } from "../core/agent.ts";
import { calcsFor, groupable } from "../core/tableCalc.ts";
import { addColumn, addColumnBeside, changeColumn, removeColumn, useStore } from "../store.ts";
import { BackRow, MenuRow, MenuSep, NextRow, PointMenu } from "./Popover.tsx";

/** The kinds of column made from a table (the server's COLUMN_TYPES), in Notion's order. */
export const COLUMN_KINDS = [
  "text",
  "longtext",
  "number",
  "select",
  "multiselect",
  "date",
  "datetime",
  "checkbox",
  "url",
  "email",
  "phone",
] as const;
const isKind = (k: string): k is (typeof COLUMN_KINDS)[number] =>
  (COLUMN_KINDS as readonly string[]).includes(k);

/**
 * Focus a field once its menu is on screen: a pointer menu is hidden until it knows where it fits, and a hidden
 * field cannot take the focus (the input's own autofocus would not).
 */
function useFocusSoon(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [ref]);
}

/** Whether a collection's columns can be changed from its table (not Boni's own, not one a connector fills). */
export const columnsEditable = (type: DataType) => !type.system && !type.readOnly;

const I = { size: 14, strokeWidth: 1.8 } as const;
type Panel = "main" | "edit" | "kind" | "options" | "sort" | "calc";

/** A name for a column put beside another that no other column has: «Propiedad», «Propiedad 2»… */
const freeName = (type: DataType, base: string) => {
  const has = (n: string) => type.fields.some((f) => f.name.toLowerCase() === n.toLowerCase());
  let name = base;
  for (let n = 2; has(name); n++) name = `${base} ${n}`;
  return name;
};

/**
 * The menu of one column, where the pointer is (a click on its name, or the right button on it), as Notion's (task
 * 76): its name in place; «Editar propiedad» and «Cambiar tipo»; what this view does with it (Filtrar, Ordenar,
 * Agrupar, Calcular, Fijar, Ocultar, Ajustar texto: saved with the view); and what the collection does
 * (Insertar a la izquierda / a la derecha, Duplicar, Borrar: through the store, with Undo). The title column only
 * changes its name and has no group, hide, insert left, duplicate or delete; a mother's column is hers to change.
 */
export function ColumnMenu({
  type,
  field,
  view,
  onView,
  onFilter,
  onInserted,
  start = "main",
  x,
  y,
  onClose,
}: {
  type: DataType;
  field: DataField;
  view: DatabaseView;
  onView: (v: DatabaseView) => void;
  /** «Filtrar»: a rule on this column, its editor open in the view's bar. */
  onFilter: (field: DataField) => void;
  /** A column put beside this one: its menu opens, to name it (Notion's). */
  onInserted: (field: string) => void;
  /** The panel it opens on: its calculations, from the table's foot. */
  start?: Panel;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const [panel, setPanel] = useState<Panel>(start);
  const [name, setName] = useState(field.name);
  const nameRef = useRef<HTMLInputElement>(null);
  useFocusSoon(nameRef);
  const title = field.id === type.titleField;
  const editable = columnsEditable(type);
  const mine = editable && !field.inherited;
  const isList = field.type === "select" || field.type === "multiselect";
  const rename = async () => {
    const n = name.trim();
    if (mine && n && n !== field.name) await changeColumn(type.id, field.id, { name: n });
  };
  const sortedBy = view.sort?.field === field.id ? view.sort : undefined;
  const grouped = view.group === field.id;
  const pinned = view.pin === field.id;
  const wraps = view.wrap?.includes(field.id) ?? false;
  const calc = view.calc?.[field.id];
  const setCalc = (c: Calc | null) => {
    const { [field.id]: _was, ...rest } = view.calc ?? {};
    const next = c ? { ...rest, [field.id]: c } : rest;
    onView({ ...view, calc: Object.keys(next).length ? next : undefined });
  };
  const insert = (side: "left" | "right") =>
    void addColumnBeside(type.id, {
      name: freeName(type, t("db.col.newName")),
      kind: "text",
      beside: { field: field.id, side },
    }).then((id) => id && onInserted(id));
  const back = (label: string) => (
    <BackRow label={label} back={t("db.opt.back")} onClick={() => setPanel("main")} />
  );
  return (
    <PointMenu
      x={x}
      y={y}
      width={260}
      label={t("db.col.menu", { name: field.name })}
      onClose={onClose}
    >
      {(close) =>
        panel === "kind" ? (
          <div className="menu-list scroll" role="menu">
            {back(t("db.col.changeKind"))}
            {COLUMN_KINDS.map((k) => (
              <MenuRow
                key={k}
                label={t(`db.col.kinds.${k}`)}
                on={field.type === k}
                boniAction="schema.update_field"
                onClick={() => {
                  if (k !== field.type) void changeColumn(type.id, field.id, { type: k });
                  close();
                }}
              />
            ))}
          </div>
        ) : panel === "options" ? (
          <div className="menu-list scroll" role="menu">
            {back(t("db.col.options"))}
            <OptionsPanel type={type} field={field} />
          </div>
        ) : panel === "edit" ? (
          <div className="menu-list scroll" role="menu">
            {back(t("db.col.edit"))}
            <input
              ref={nameRef}
              className="menu-input"
              data-boni-action="schema.update_field"
              aria-label={t("db.col.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void rename();
              }}
            />
            {!title && isKind(field.type) && (
              <NextRow
                label={t("db.col.kind")}
                value={t(`db.col.kinds.${field.type}`)}
                onClick={() => setPanel("kind")}
              />
            )}
            {isList && (
              <NextRow
                label={t("db.col.options")}
                value={String(field.options?.length ?? 0)}
                onClick={() => setPanel("options")}
              />
            )}
          </div>
        ) : panel === "sort" ? (
          <div className="menu-list" role="menu">
            {back(t("db.col.sort"))}
            <MenuRow
              label={t("db.sortAsc")}
              on={!!sortedBy && !sortedBy.desc}
              boniAction="schema.set_view"
              onClick={() => {
                onView({ ...view, sort: { field: field.id } });
                close();
              }}
            />
            <MenuRow
              label={t("db.sortDesc")}
              on={!!sortedBy?.desc}
              boniAction="schema.set_view"
              onClick={() => {
                onView({ ...view, sort: { field: field.id, desc: true } });
                close();
              }}
            />
            {sortedBy && (
              <>
                <MenuSep />
                <MenuRow
                  label={t("db.sortRemove")}
                  onClick={() => {
                    onView({ ...view, sort: undefined });
                    close();
                  }}
                />
              </>
            )}
          </div>
        ) : panel === "calc" ? (
          <div className="menu-list scroll" role="menu">
            {back(t("db.col.calc"))}
            <MenuRow
              label={t("db.calc.none")}
              on={!calc}
              onClick={() => {
                setCalc(null);
                close();
              }}
            />
            {calcsFor(field).map((c) => (
              <MenuRow
                key={c}
                label={t(`db.calc.${c}`)}
                on={calc === c}
                boniAction="schema.set_view"
                onClick={() => {
                  setCalc(c);
                  close();
                }}
              />
            ))}
          </div>
        ) : (
          <div className="menu-list" role="menu">
            {mine ? (
              <input
                ref={nameRef}
                className="menu-input"
                data-boni-action="schema.update_field"
                aria-label={t("db.col.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void rename()}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  void rename().then(close);
                }}
              />
            ) : (
              <div className="menu-head">{field.name}</div>
            )}
            {mine && !title && (
              <MenuRow
                icon={<Pencil {...I} />}
                label={t("db.col.edit")}
                onClick={() => setPanel("edit")}
              />
            )}
            {mine && !title && isKind(field.type) && (
              <MenuRow
                icon={<Repeat {...I} />}
                label={t("db.col.changeKind")}
                onClick={() => setPanel("kind")}
              />
            )}
            {mine && !title && <MenuSep />}
            <MenuRow
              icon={<ListFilter {...I} />}
              label={t("db.col.filter")}
              boniAction="schema.set_view"
              onClick={() => {
                onFilter(field);
                close();
              }}
            />
            <MenuRow
              icon={<ArrowUpDown {...I} />}
              label={t("db.col.sort")}
              on={!!sortedBy}
              onClick={() => setPanel("sort")}
            />
            {!title && groupable(field) && (
              <MenuRow
                icon={<Rows3 {...I} />}
                label={t("db.col.group")}
                on={grouped}
                boniAction="schema.set_view"
                onClick={() => {
                  onView({ ...view, group: grouped ? undefined : field.id });
                  close();
                }}
              />
            )}
            <MenuRow
              icon={<Sigma {...I} />}
              label={t("db.col.calc")}
              on={!!calc}
              onClick={() => setPanel("calc")}
            />
            <MenuRow
              icon={<Pin {...I} />}
              label={t("db.col.pin")}
              on={pinned}
              boniAction="schema.set_view"
              onClick={() => {
                onView({ ...view, pin: pinned ? undefined : field.id });
                close();
              }}
            />
            {!title && (
              <MenuRow
                icon={<EyeOff {...I} />}
                label={t("db.col.hide")}
                boniAction="schema.set_view"
                onClick={() => {
                  onView({ ...view, hide: [...(view.hide ?? []), field.id] });
                  close();
                }}
              />
            )}
            {field.type !== "checkbox" && (
              <MenuRow
                icon={<WrapText {...I} />}
                label={t("db.col.wrap")}
                on={wraps}
                boniAction="schema.set_view"
                onClick={() => {
                  const rest = (view.wrap ?? []).filter((w) => w !== field.id);
                  const next = wraps ? rest : [...rest, field.id];
                  onView({ ...view, wrap: next.length ? next : undefined });
                  close();
                }}
              />
            )}
            {editable && <MenuSep />}
            {editable && !title && (
              <MenuRow
                icon={<ArrowLeftToLine {...I} />}
                label={t("db.col.insertLeft")}
                boniAction="schema.add_field"
                onClick={() => {
                  insert("left");
                  close();
                }}
              />
            )}
            {editable && (
              <MenuRow
                icon={<ArrowRightToLine {...I} />}
                label={t("db.col.insertRight")}
                boniAction="schema.add_field"
                onClick={() => {
                  insert("right");
                  close();
                }}
              />
            )}
            {editable && !title && (isKind(field.type) || !!field.relation) && (
              <MenuRow
                icon={<Copy {...I} />}
                label={t("db.col.duplicate")}
                boniAction="schema.add_field"
                onClick={() => {
                  void addColumnBeside(type.id, {
                    name: t("db.col.copyOf", { name: field.name }),
                    copy: field.id,
                  });
                  close();
                }}
              />
            )}
            {mine && !title && (
              <MenuRow
                icon={<Trash2 {...I} />}
                label={t("db.col.delete")}
                danger
                boniAction="schema.remove_field"
                onClick={() => {
                  void removeColumn(type.id, field.id, field.name);
                  close();
                }}
              />
            )}
          </div>
        )
      }
    </PointMenu>
  );
}

/** A list's options: each renamed in place or taken out, a new one by its name (saved at once, as Notion's). */
function OptionsPanel({ type, field }: { type: DataType; field: DataField }) {
  const t = useStore((s) => s.t);
  // The options as the server has them now (each save reloads the collections).
  const options = useStore(
    (s) =>
      s.dataTypes?.find((x) => x.id === type.id)?.fields.find((f) => f.id === field.id)?.options ??
      field.options ??
      [],
  );
  const [fresh, setFresh] = useState("");
  const save = (next: { id?: string; name: string; color?: string }[]) =>
    changeColumn(type.id, field.id, { options: next });
  const kept = () =>
    options.map((o) => ({ id: o.id, name: o.name, ...(o.color ? { color: o.color } : {}) }));
  return (
    <>
      {options.map((o) => (
        <div key={o.id} className="menu-option">
          <input
            className="menu-input"
            aria-label={t("db.col.optionName", { name: o.name })}
            defaultValue={o.name}
            onBlur={(e) => {
              const n = e.target.value.trim();
              if (n && n !== o.name)
                void save(kept().map((x) => (x.id === o.id ? { ...x, name: n } : x)));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <button
            type="button"
            className="icon-btn tiny"
            aria-label={t("db.col.removeOption", { name: o.name })}
            title={t("db.col.removeOption", { name: o.name })}
            onClick={() => void save(kept().filter((x) => x.id !== o.id))}
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
      <input
        className="menu-input"
        aria-label={t("db.col.addOption")}
        placeholder={t("db.col.addOption")}
        value={fresh}
        onChange={(e) => setFresh(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !fresh.trim()) return;
          e.preventDefault();
          void save([...kept(), { name: fresh.trim() }]).then((ok) => ok && setFresh(""));
        }}
      />
    </>
  );
}

/** The «+» at the end of a table's head: a new column, named and of a kind (the kind's name when left empty). */
export function AddColumn({ type }: { type: DataType }) {
  const t = useStore((s) => s.t);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="icon-btn tiny add-col"
        aria-label={t("db.col.add")}
        title={t("db.col.add")}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <Plus size={14} strokeWidth={2} />
      </button>
      {at && (
        <PointMenu
          x={at.x}
          y={at.y}
          width={240}
          label={t("db.col.add")}
          onClose={() => {
            setAt(null);
            setName("");
          }}
        >
          {(close) => (
            <div className="menu-list scroll" role="menu">
              <FocusSoon target={nameRef} />
              <input
                ref={nameRef}
                className="menu-input"
                aria-label={t("db.col.name")}
                placeholder={t("db.col.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="menu-head">{t("db.col.kind")}</div>
              {COLUMN_KINDS.map((k) => (
                <MenuRow
                  key={k}
                  label={t(`db.col.kinds.${k}`)}
                  boniAction="schema.add_field"
                  onClick={() =>
                    void addColumn(type.id, name.trim() || t(`db.col.kinds.${k}`), k).then(
                      (ok) => ok && close(),
                    )
                  }
                />
              ))}
            </div>
          )}
        </PointMenu>
      )}
    </>
  );
}

/** Focuses `target` when it mounts (inside a menu that renders its content through a function). */
function FocusSoon({ target }: { target: RefObject<HTMLInputElement | null> }) {
  useFocusSoon(target);
  return null;
}
