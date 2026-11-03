// A column's menu in a collection's table, and its «+» (task 40; Notion's property menu): its name, its kind, a list's options, hide and delete; a new column with its name and kind.
import { Plus, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { DataField, DataType } from "../core/agent.ts";
import { addColumn, changeColumn, removeColumn, useStore } from "../store.ts";
import { MenuRow, MenuSep, PointMenu } from "./Popover.tsx";

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

/**
 * The menu of one column, where the pointer is (a click on its name, or the right button on it): its name in place,
 * its kind, a list's options, «Ocultar» (this view) and «Borrar columna» (its values kept, with Undo). The title
 * column only changes its name; a mother's column, nothing here (it is hers).
 */
export function ColumnMenu({
  type,
  field,
  x,
  y,
  onHide,
  onClose,
}: {
  type: DataType;
  field: DataField;
  x: number;
  y: number;
  onHide: () => void;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const [panel, setPanel] = useState<"main" | "kind" | "options">("main");
  const [name, setName] = useState(field.name);
  const nameRef = useRef<HTMLInputElement>(null);
  useFocusSoon(nameRef);
  const title = field.id === type.titleField;
  const mine = columnsEditable(type) && !field.inherited;
  const rename = async () => {
    const n = name.trim();
    if (mine && n && n !== field.name) await changeColumn(type.id, field.id, { name: n });
  };
  return (
    <PointMenu
      x={x}
      y={y}
      width={250}
      label={t("db.col.menu", { name: field.name })}
      onClose={onClose}
    >
      {(close) =>
        panel === "kind" ? (
          <div className="menu-list scroll" role="menu">
            <div className="menu-head">{t("db.col.kind")}</div>
            {COLUMN_KINDS.map((k) => (
              <MenuRow
                key={k}
                label={t(`db.col.kinds.${k}`)}
                on={field.type === k}
                onClick={() => {
                  if (k !== field.type) void changeColumn(type.id, field.id, { type: k });
                  close();
                }}
              />
            ))}
          </div>
        ) : panel === "options" ? (
          <OptionsPanel type={type} field={field} />
        ) : (
          <div className="menu-list" role="menu">
            {mine ? (
              <input
                ref={nameRef}
                className="menu-input"
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
            {mine && !title && isKind(field.type) && (
              <MenuRow
                label={`${t("db.col.kind")}: ${t(`db.col.kinds.${field.type}`)}`}
                onClick={() => setPanel("kind")}
              />
            )}
            {mine && (field.type === "select" || field.type === "multiselect") && (
              <MenuRow label={t("db.col.options")} onClick={() => setPanel("options")} />
            )}
            {!title && (
              <>
                <MenuSep />
                <MenuRow
                  label={t("db.col.hide")}
                  onClick={() => {
                    onHide();
                    close();
                  }}
                />
              </>
            )}
            {mine && !title && (
              <MenuRow
                label={t("db.col.delete")}
                danger
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
    <div className="menu-list scroll" role="menu">
      <div className="menu-head">{t("db.col.options")}</div>
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
    </div>
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
