import type { ModelProvider } from "../../src/providers.ts";
import { delimit } from "../../src/readers.ts";
import {
  checkReadMessage,
  MODULES,
  readMessagePrompt,
  readMessageSchema,
  weekdayOf,
} from "../../src/reading.ts";
import { DAYS, KNOWN, ME, READER_CASES, type ReaderCase, TODAY } from "./readerCases.ts";
import type { EvalResult } from "./types.ts";

/**
 * How well a model reads mail as the reader `read_message` (docs/nucleo.md 7.4b): each invented case read `runs`
 * times, right when it keeps what the user should get, nothing it should not, and the right day. The security
 * does not depend on it (the code keeps only what the recipient does; everything is proposed): it measures
 * whether a model reads well enough for the role.
 */
export async function evalReader(p: ModelProvider, o: { runs?: number } = {}): Promise<EvalResult> {
  const runs = o.runs ?? 1;
  const system = readMessagePrompt(MODULES);
  const where = (c: ReaderCase) => (c.to.includes(ME) ? "to" : c.cc?.includes(ME) ? "cc" : "group");
  const content = (c: ReaderCase) =>
    [`De: ${c.from}`, `Para: ${c.to}`, ...(c.cc ? [`Cc: ${c.cc}`] : []), `Asunto: ${c.subject}`]
      .join("\n")
      .concat(`\n\n${c.body}`);
  const out: EvalResult = { right: 0, total: 0, wrong: 0, cost: 0, tokens: 0, cases: [] };
  for (const c of READER_CASES)
    for (let i = 0; i < runs; i++) {
      out.total++;
      const { marker, text } = delimit(content(c));
      let kept: { module: string; title: string; due: string | null }[] = [];
      let problem = "";
      try {
        const r = await p.complete({
          role: "reader",
          system,
          input: {
            marker,
            today: TODAY,
            weekday: weekdayOf(TODAY),
            user_in: where(c),
            ...(KNOWN[c.name] ? { known: KNOWN[c.name] } : {}),
            content: text,
          },
          schema: readMessageSchema(MODULES),
          maxTokens: 4000,
        });
        out.tokens += r.usage.input + r.usage.output;
        out.cost += r.usage.cost ?? 0;
        const checked = checkReadMessage(r.json, MODULES);
        if (!checked) problem = "invalid answer";
        else kept = checked.all;
      } catch (e) {
        problem = String((e as { code?: string }).code ?? "failed");
      }
      const titles = (m: string) => kept.filter((k) => k.module === m).map((k) => k.title);
      const missing = [
        ...(c.tasks ?? []).filter((re) => !titles("tasks").some((t) => re.test(t))),
        ...(c.events ?? []).filter((re) => !titles("events").some((t) => re.test(t))),
      ];
      const wrong = kept.filter((k) => (c.never ?? []).some((re) => re.test(k.title)));
      const day = DAYS[c.name];
      const badDay = day && kept[0] && kept[0].due !== day ? `day ${kept[0].due}` : "";
      const ok = !problem && !missing.length && !wrong.length && !badDay;
      if (ok) out.right++;
      else if (wrong.length) out.wrong++;
      out.cases.push({
        name: c.name,
        ok,
        note:
          problem ||
          badDay ||
          (wrong.length ? "kept what it should not" : missing.length ? "missed one" : ""),
      });
    }
  return out;
}
