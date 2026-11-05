# Does the change do what its design says? (the review before «hecha»)

Juan, 2026-11-05 (task 64, measure C): phases F1–F6 of `docs/flujos.md` were called done while points of their design
were missing. «Mis datos» was not the collection page that §4.7 said, and the audit (task 63) found nine more. The
reason: the phase was judged against its row in the phase table and the single example in its criterion, not against
each point of the design. The same agent had designed it, built it and judged it.

So before a phase or a task is called finished (its PR, the design's phase table, the CHANGELOG), an agent that did not
build it reviews it. In Claude Code that is a subagent started for this alone, which gets only what is below; another
assistant does the same in a fresh conversation.

## What the reviewer gets

- The design's section the phase builds: the paragraphs and bullets, quoted whole, with the file and the heading. Give
  the whole section, not the row of the phase table; also give the design's decisions (§ «Decisiones») that apply.
- The change: `git diff origin/main...HEAD`, or the PR's diff.
- The criterion of done of the task (its first line in the queue).

Nothing else: no summary of what was built, no conversation. The review is only worth something if it does not start
from the builder's account.

## What the reviewer answers

A table with one row per point of the design. A point is a sentence or a bullet that says something can be seen or
done. Each row has:

| Point (quoted, short) | State | Evidence | What is missing |
|---|---|---|---|
| «Un flujo inválido se guarda como borrador, nunca encendido» | missing | `apps/server/src/flows.ts` `saveUserFlow` refuses an invalid one | saving a draft |

- **State:**
  - **done** when the change does it and a test shows it (name the test);
  - **partly** when something of the point is missing;
  - **missing** when nothing of it is there;
  - **out of the phase** when the design gives it to another phase (quote where).
- **Evidence**: a file and a function or a line, and the test that shows it. «It seems to» is not evidence: read the
  code.
- The reviewer judges only against the design's words. Where the code does something else on purpose, it is «partly»
  or «missing» until the design says so. A good reason in the PR is for Juan to accept, not for the reviewer.

## What the builder does with it

- The table goes in the PR's description.
- Every row that is not «done» either gets done in the same PR, or goes into the queue (the task of the phase or a
  new one), the design's phase table («salvo …») and the release's CHANGELOG entry.
- Merged with CI green, the phase is «en main». It becomes «hecha» only when Juan has tried it with his data and its
  criterion holds (`AGENTS.md`, «How a change is made»).
