/**
 * What a decider chooses among and by which rules, in its panel on the map and in the editor (task 83; Juan,
 * 2026-11-06: «en el diagrama veo solo cómo le llega el input y cómo se conecta con esas colecciones; luego dentro de
 * los detalles del modelo veo las reglas que tiene»): the collections its choice sends things to (the `case` over it in
 * the plan, D-48) and the rules of his reading guide that choose for it without a model (its `given`); that it asks
 * when unsure, its line above already says. A sender's address is his data and stays as he wrote it.
 */
import { useEffect, useState } from "react";
import type { FlowPlan, MailGuide } from "../core/agent.ts";
import { decidesAmong, listText } from "../core/flowEdit.ts";
import { loadMailGuide, useStore } from "../store.ts";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function DeciderFacts({
  plan,
  step,
  nameOfKey,
  nameOfId,
}: {
  plan: FlowPlan;
  /** The decider's step id. */
  step: string;
  /** A collection's name by its key (what the plan writes), or null when it is not known. */
  nameOfKey: (key: string) => string | null | undefined;
  /** A collection's name by its id (what a rule of the guide names), or null when it is not known. */
  nameOfId: (id: string) => string | null | undefined;
}) {
  const t = useStore((s) => s.t);
  const dataTypes = useStore((s) => s.dataTypes);
  const s = plan.steps.find((x) => x.id === step);
  const params = s && isObj(s.params) ? s.params : {};
  // A rule of the guide decides before the model when the step takes one (`given`, Boni's «Leer correo»).
  const byGuide = params.given !== undefined && params.given !== null;
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
  const among = decidesAmong(plan, step)
    .map((k) => nameOfKey(k))
    .filter((x): x is string => !!x);
  const collectionName = (id: string | undefined) =>
    (id && (nameOfId(id) ?? dataTypes?.find((d) => d.id === id)?.name)) || null;
  const rules = (guide?.rules ?? []).filter((r) => r.action === "collection");
  // Nothing to say (a decider of another flow, no guide): no block at all.
  if (!among.length && !(byGuide && guide)) return null;
  return (
    <section className="decider-facts" aria-label={t("flows.decider.title")}>
      {among.length > 0 && (
        <p>{t("flows.decider.among", { list: listText(among, t("list.or")) })}</p>
      )}
      {byGuide && guide && (
        <>
          <h4 className="decider-facts-title">{t("flows.decider.rules")}</h4>
          {rules.length ? (
            <ul className="decider-facts-rules">
              {rules.map((r) => (
                <li key={r.id}>
                  <span className="breakable">{r.from}</span>
                  <span className="muted">
                    {t("flows.decider.to", {
                      name: collectionName(r.collection) ?? t("flows.decider.otherCollection"),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t("flows.decider.noRules")}</p>
          )}
        </>
      )}
    </section>
  );
}
