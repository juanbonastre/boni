// A collection's roles on its page (docs/clases.md §6): what it can do as tags (Calendario, Tareas, Dinero), each one
// a control that gives it or takes it away, asking in place which field plays which part.
import { useState } from "react";
import type { DataField, DataType } from "../core/agent.ts";
import { setRoles, useStore } from "../store.ts";
import { BackRow, MenuRow, MenuSep, NextRow, PopButton } from "./Popover.tsx";

/** The field types each role takes (packages/entities/src/roles.ts, ROLE_TYPES: the server checks it again). */
const ROLE_TYPES: Record<string, readonly string[]> = {
  date: ["date"],
  start: ["datetime"],
  time: ["time"],
  endTime: ["time"],
  endDate: ["date"],
  end: ["datetime"],
  done: ["checkbox"],
  amount: ["number", "money"],
  category: ["select", "relation"],
};
/** A day or an instant: one control, «Día», whichever of the two its field is. */
const DAY = ["date", "start"] as const;
const WITH_DATE = ["time", "endTime", "endDate"] as const;

type Iface = "calendar" | "tasks" | "money";
const IFACES: Iface[] = ["calendar", "tasks", "money"];
/** A control of a tag: a role, or «day» (date or start). */
type Part = "day" | "time" | "endTime" | "endDate" | "end" | "done" | "amount" | "category";
/** Each tag's roles, all taken away by its «Quitar». */
const OWN: Record<Iface, readonly string[]> = {
  calendar: [...DAY, ...WITH_DATE, "end"],
  tasks: ["done"],
  money: ["amount", "category"],
};
const OPTIONAL: readonly Part[] = ["time", "endTime", "endDate", "end", "category"];

const fitting = (type: DataType, part: Part) => {
  const kinds = part === "day" ? ["date", "datetime"] : ROLE_TYPES[part];
  return type.fields.filter((f) => kinds?.includes(f.type));
};
const dated = (r: Record<string, string>) => !!(r.date || r.start);
const active = (iface: Iface, r: Record<string, string>) =>
  iface === "calendar" ? dated(r) : iface === "tasks" ? !!r.done : !!r.amount && dated(r);

/** The roles {role: field | null} that a field chosen for a part gives (a day or an instant: the other goes). */
function choose(part: Part, field: DataField | null): Record<string, string | null> {
  if (part !== "day") return { [part]: field?.id ?? null };
  if (!field)
    return { date: null, start: null, time: null, endTime: null, endDate: null, end: null };
  return field.type === "date"
    ? { date: field.id, start: null, end: null }
    : { start: field.id, date: null, time: null, endTime: null, endDate: null };
}

/** The tags of what a collection can do, with the fields it has for them: one control each. */
export function RolesTags({ type, mother }: { type: DataType; mother?: DataType }) {
  const roles = type.roles ?? {};
  const shown = IFACES.filter(
    (i) =>
      active(i, roles) ||
      (!type.readOnly &&
        (i === "calendar"
          ? fitting(type, "day").length > 0
          : i === "tasks"
            ? fitting(type, "done").length > 0
            : fitting(type, "amount").length > 0 && fitting(type, "day").length > 0)),
  );
  if (!shown.length) return null;
  return (
    <div className="col-roles">
      {shown.map((i) => (
        <RoleTag key={i} iface={i} type={type} mother={mother} />
      ))}
    </div>
  );
}

function RoleTag({ iface, type, mother }: { iface: Iface; type: DataType; mother?: DataType }) {
  const t = useStore((s) => s.t);
  const [panel, setPanel] = useState<Part | null>(null);
  const roles = type.roles ?? {};
  const given = new Set(type.givenRoles ?? []);
  const on = active(iface, roles);
  const name = t(`roles.${iface}`);
  const fieldName = (id?: string) => type.fields.find((f) => f.id === id)?.name;
  const roleOf = (part: Part) =>
    part === "day" ? (roles.date ? "date" : roles.start ? "start" : "date") : part;
  const parts: Part[] =
    iface === "calendar"
      ? [
          "day",
          ...(roles.date ? (WITH_DATE as readonly Part[]) : roles.start ? ["end" as const] : []),
        ]
      : iface === "tasks"
        ? ["done"]
        : [...(dated(roles) ? [] : ["day" as const]), "amount", "category"];
  const mine = OWN[iface].filter((r) => roles[r] && !given.has(r));
  // What taking it away hides, said before it is done (docs/design-guide.md: a setting's effect in one line).
  const effect =
    type.calendar && iface !== "money"
      ? t(iface === "calendar" ? "roles.effect.calendar" : "roles.effect.tasks")
      : "";
  return (
    <PopButton
      className={`role-pill${on ? " on" : ""}`}
      title={t("roles.title", { name })}
      align="start"
      width={280}
      onOpenChange={(open) => !open && setPanel(null)}
      label={<span>{name}</span>}
    >
      {(close) =>
        panel ? (
          <div className="menu-list scroll" role="menu">
            <BackRow label={t(`roles.part.${panel}`)} back={name} onClick={() => setPanel(null)} />
            {OPTIONAL.includes(panel) && (
              <MenuRow
                label={t("roles.none")}
                on={!roles[panel]}
                boniAction="schema.set_roles"
                onClick={() => {
                  close();
                  if (roles[panel]) void setRoles(type, choose(panel, null));
                }}
              />
            )}
            {fitting(type, panel)
              // Each field plays one role: those playing another are not offered.
              .filter(
                (f) => !Object.entries(roles).some(([r, id]) => id === f.id && r !== roleOf(panel)),
              )
              .map((f) => (
                <MenuRow
                  key={f.id}
                  label={f.name}
                  on={roles[roleOf(panel)] === f.id}
                  boniAction="schema.set_roles"
                  onClick={() => {
                    close();
                    if (roles[roleOf(panel)] !== f.id) void setRoles(type, choose(panel, f));
                  }}
                />
              ))}
            {/* Another field here moves its records in Boni Calendar: said before the click. */}
            {type.calendar && iface !== "money" && (
              <p className="protect-help role-effect">{t("roles.effect.change")}</p>
            )}
          </div>
        ) : (
          <div className="menu-list" role="menu">
            {parts.map((p) => {
              const r = roleOf(p);
              const value = fieldName(roles[r]) ?? t("roles.none");
              // A role its mother gives is hers: shown, changed at her page.
              return given.has(r) ? (
                <div key={p} className="menu-item static role-given">
                  <span className="menu-text">{t(`roles.part.${p}`)}</span>
                  <span className="menu-value">
                    {t("roles.from", { field: value, mother: mother?.name ?? "" })}
                  </span>
                </div>
              ) : (
                <NextRow
                  key={p}
                  label={t(`roles.part.${p}`)}
                  value={value}
                  onClick={() => setPanel(p)}
                />
              );
            })}
            {on && mine.length > 0 && (
              <>
                <MenuSep />
                <MenuRow
                  label={t("roles.remove")}
                  danger
                  boniAction="schema.set_roles"
                  onClick={() => {
                    close();
                    void setRoles(type, Object.fromEntries(mine.map((r) => [r, null])));
                  }}
                />
                {effect && <p className="protect-help role-effect">{effect}</p>}
              </>
            )}
          </div>
        )
      }
    </PopButton>
  );
}
