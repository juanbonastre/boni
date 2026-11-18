// What «Modelo» offers and what «Modelos» says of a model, as plain data (docs/automatizaciones.md §5.16, AU-232 to
// AU-242): the step's dropdown, a row «De la cuenta», the chat's chip and the list's words. No React, no fetching.
import type { ModelChoices, ModelMark, ModelUses } from "./agent.ts";

/** A model's name without its provider (`z-ai/glm-5.2` → `glm-5.2`): the server's text, painted as plain text. */
export const modelName = (model: string) => model.replace(/^[a-z0-9._-]+\//i, "");

/** The model of an id (`connection:model[:zdr]`), as `modelName` says it. */
export function nameOfId(id: string): string {
  const i = id.indexOf(":");
  return modelName((i < 0 ? id : id.slice(i + 1)).replace(/:zdr$/, ""));
}

export interface TagOption {
  value: string;
  name: string;
  /** The model that would answer now (AU-238), by name; null: «Sin modelo». */
  answers: string | null;
  /** Why it cannot be chosen: «Sin modelo» or «Caducada» (AU-241). Null: it can. */
  off: "no-model" | "expired" | null;
}
export interface ModelOptions {
  /** «El de la cuenta» and the model that answers it now, by name; null: «Sin modelo». */
  account: string | null;
  tags: TagOption[];
  models: { value: string; name: string }[];
  /** The stored value is no longer offered (a model gone, a tag deleted): it is said in the list itself. */
  gone: string | null;
}

/**
 * The dropdown «Modelo» of a step (AU-238): «El de la cuenta» with what answers, the tags with the model each would
 * take (apagada with its reason), the models of the step's kind. `value` is what the step keeps: "" for nothing.
 * `tags: false` is the chat's (AU-242: in the chat a model is chosen, never a tag).
 */
export function modelOptions(
  c: ModelChoices | undefined,
  value: string,
  o: { tags?: boolean } = {},
): ModelOptions {
  const tags =
    o.tags === false
      ? []
      : (c?.tags ?? []).map((t) => ({
          value: t.id,
          name: t.name,
          answers: t.answers ? nameOfId(t.answers) : null,
          off: t.state === "ok" ? null : t.state,
        }));
  const models = (c?.models ?? []).map((m) => ({ value: m.id, name: modelName(m.model) }));
  const known =
    value === "" || tags.some((t) => t.value === value) || models.some((m) => m.value === value);
  return {
    account: c?.account.answers ? nameOfId(c.account.answers) : null,
    tags,
    models,
    // Without the choices yet (an older server, or still asking), nothing is said gone.
    gone: !c || known ? null : value.startsWith("tag:") ? value : nameOfId(value),
  };
}

/** A model's evaluation as the list says it (AU-234): «22 de 24», with «Caducada» or «Parcial»; null: «Sin evaluar». */
export function markParts(m: ModelMark | null): {
  right: number;
  total: number;
  expired: boolean;
  partial: boolean;
} | null {
  return m && m.total > 0
    ? { right: m.right, total: m.total, expired: m.expired, partial: m.partial }
    : null;
}

/** Whether anything uses it: its rows «De la cuenta», an automation, a conversation. */
export const used = (u: ModelUses) => u.rows.length > 0 || u.automations > 0 || u.conversations > 0;

/** The list after a model moves (AU-232): `from` taken out and put where `to` was; the same models, each once. */
export function moved(ids: readonly string[], from: string, to: string): string[] {
  const i = ids.indexOf(from);
  const j = ids.indexOf(to);
  if (i < 0 || j < 0 || i === j) return [...ids];
  const out = ids.filter((x) => x !== from);
  out.splice(j, 0, from);
  return out;
}
