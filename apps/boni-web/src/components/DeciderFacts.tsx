/**
 * What a decider chooses among and by which rules, in its panel on the map and in the editor (task 83; Juan,
 * 2026-11-06: «en el diagrama veo solo cómo le llega el input y cómo se conecta con esas colecciones; luego dentro de
 * los detalles del modelo veo las reglas que tiene»): the collections its choice sends things to (the `case` over it in
 * the plan, D-48) and the rules of his reading guide that choose for it without a model: only in a flow whose decider
 * takes «Regla del remitente»'s answer (`given`), only those that send a sender to one of its collections and that no
 * earlier rule takes first (the first that matches wins, as the server's `ruleFor`). That it asks when unsure, its line
 * above already says. A sender's address is his data and stays as he wrote it.
 */
import { useEffect, useState } from "react";
import type { FlowPlan, MailGuide } from "../core/agent.ts";
import { decidesAmong, guideRulesFor, listText } from "../core/flowEdit.ts";
import { loadMailGuide, useStore } from "../store.ts";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function DeciderFacts({
  plan,
  step,
  nameOfKey,
  keyOfId,
}: {
  plan: FlowPlan;
  /** The decider's step id. */
  step: string;
  /** A collection's name by its key (what the plan writes), or null when it is not known. */
  nameOfKey: (key: string) => string | null | undefined;
  /** A collection's key by its id (what a rule of the guide names), or null when it is not known. */
  keyOfId: (id: string) => string | null | undefined;
}) {
  const t = useStore((s) => s.t);
  const dataTypes = useStore((s) => s.dataTypes);
  const s = plan.steps.find((x) => x.id === step);
  const params = s && isObj(s.params) ? s.params : {};
  // The guide decides before the model only when the decider takes «Regla del remitente»'s answer (Boni's «Leer
  // correo»; a plan saved before the pieces had it bound as `$only`).
  const given = (params.given as { ref?: unknown } | undefined)?.ref;
  const head =
    typeof given === "string" ? (/^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(given)?.[1] ?? "") : "";
  const source = plan.steps.find((x) => x.id === head);
  const byGuide = source ? source.op === "call" && source.tool === "mail.rule" : given === "$only";
  const [guide, setGuide] = useState<MailGuide | null | undefined>(undefined);
  useEffect(() => {
    if (!byGuide) return;
    let on = true;
    void loadMailGuide().then((g) => {
      if (on) setGuide(g);
    });
    return () => {
      on = false;
    };
  }, [byGuide]);
  if (!s || s.op !== "read" || s.reader !== "classify") return null;
  const keys = decidesAmong(plan, step).filter((k) => !!nameOfKey(k));
  const among = keys.map((k) => nameOfKey(k) as string);
  const keyOf = (id: string) => keyOfId(id) ?? dataTypes?.find((d) => d.id === id)?.key ?? null;
  const rules = byGuide && guide ? guideRulesFor(guide, keys, keyOf) : [];
  // Nothing to say (a decider of another flow, a guide with no rule for its collections): no block at all.
  if (!among.length && !rules.length) return null;
  return (
    <section className="decider-facts" aria-label={t("flows.decider.title")}>
      {among.length > 0 && (
        <p>{t("flows.decider.among", { list: listText(among, t("list.and")) })}</p>
      )}
      {rules.length > 0 && (
        <>
          <h4 className="decider-facts-title">{t("flows.decider.rules")}</h4>
          <ul className="decider-facts-rules">
            {rules.map((r) => (
              <li key={r.id}>
                <span className="breakable">{r.from}</span>
                <span className="muted">
                  {t("flows.decider.to", {
                    name: nameOfKey(keyOf(r.collection ?? "") ?? "") ?? "",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
