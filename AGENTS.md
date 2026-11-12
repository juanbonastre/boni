# AGENTS.md — Boni

Boni is a personal system: one server, one account per person, the person's data as collections, an assistant whose
model plans while code decides what is allowed, and the apps over it (Boni and Boni Calendar, on the desktop and on
Android). This monorepo holds all of it. **The repo is public:** everything in it is invented.

Before a big step read `docs/principios.md`: the rules that must not break, each with the test that guards it.
Design, in Spanish (Juan's docs): `docs/nucleo.md` (the core: data, store, agent, security), `docs/clases.md`
(collections as classes), `docs/contexto.md` (what is written and what is computed for agents), `docs/extensiones.md`
(extensions), `docs/conversacion.md` (the conversation: chats, cards, surfaces, assistants, voice), `docs/correo.md`
(mail: how it is read, tested and improved), `docs/preferencias.md` (what Boni knows and learns of the user, and where
each thing lives), `docs/fiabilidad.md` (decisions by confidence and cost: do, ask or nothing), `docs/flujos.md` (flows
as data, F1–F6), `docs/sistema.md` (Boni as a system of flows: what Boni does on its own as flows, the map, one list of
actions for the app, the AI and the MCP, extensions as packages, pages with values, Boni over the screen; F7–F13),
`docs/design-guide.md` (every UI). Code, comments, commits and AI-facing text are in English.

## Where things are

- `make map` lists every package and app with its description; `make map P=<path>` lists its files, each with the first
  sentence of the comment it starts with. Nothing here lists folders by hand (T-02): a new package gets a
  `description` in its `package.json`, a new source file starts with a comment saying what it is for.
- Working on Boni Calendar's UI or its engine (`apps/calendar-web`, `packages/calendar`): read
  `docs/agents/calendar.md` first.
- Juan's data, his instructions for assistants, the project's state and its queue live in **Boni**, through Boni's MCP
  (`guide` first). So does everything about his machines (NAS, deploy, ssh, agent-sudo): never in this repo.

## Commands (Makefile)

- `make setup` installs · `make check` lints, type-checks and runs the unit tests (it must pass before every commit;
  with `ANTHROPIC_BASE_URL` set in your shell, run it as `env -u ANTHROPIC_BASE_URL make check`) · `make map`
- `make e2e` (Playwright on the system Chrome) · `make e2e-boni` (Boni's only) · `make e2e-boni-desktop` and
  `make e2e-calendar-desktop` (the real desktop apps, on a virtual screen; `E2E_SCREEN=real` on this one). The e2e
  targets and `make check`'s tests wait in one queue shared by every worktree, saying who holds it (T-08): run them
  through `make`, never `playwright` by hand
- `make package-boni` (Boni's desktop `.deb`) · `make package` (Boni Calendar's `.deb` and AppImage) · `make server`
- `make bench-chrome` / `make bench-electron`: the calendar grid's smoothness (`docs/rendimiento.md`)

## How a change is made

One cycle per task, one release per batch (Juan, 2026-11-03: a day of ten PRs, five desktop versions and six deploys,
with the same click fixed twice, was «todo un poco liado»):

1. **A task first.** Every piece of work is a task of the queue (in Boni, the project's tasks: its first line says the
   state and the criterion of done, what Juan will see). At most one task «Ahora». What Juan asks while trying things
   goes into the queue and is prioritised, never answered with one PR per sentence.
2. A branch from `main`; nothing is pushed to `main` directly. One PR per task, with its tests, docs and principle.
3. `make check && git commit && git push` (a failure stops the chain), then a PR. The moment it is opened, turn on
   auto-merge (`gh pr merge --auto --squash`) and the app's Auto-fix, without asking (Juan, 2026-11-11: he does not
   want to wait on this): it merges when CI is green (with Android changes, also the APK build), and a failing CI
   wakes the session to fix it on its branch; never poll CI. While CI runs, go on with the next thing. Before saying a
   check passed, read the exit code of the command that ran it (a line in the background ends with its last
   command's: on 2026-11-05 a failed `make check` was reported as passing).
4. **«En main» is not «hecha»** (Juan, 2026-11-05, task 64, measures C and D, after phases F1–F6 were called done
   with points of their design missing):
   - Before a phase or task is called finished (its PR, the design's phase table, the CHANGELOG), an agent that did
     not build it compares the design's section with the change, point by point: done, partly, missing. Its table
     goes in the PR; what is missing goes in the CHANGELOG and into the queue. How: `docs/agents/conformance.md`.
   - Merged with CI green, a phase or task is «en main». There is no list of things for Juan to try (Juan,
     2026-11-11: he tries the whole app when it is ready): a task whose only thing left is his trial leaves the
     queue as hecha, its state saying «en main; Juan la prueba con la app entera». Only something important (it
     changes his data, or its shape is in doubt) is named for him to try, in its task and in the CHANGELOG.
5. Every change to `apps/boni-web` ships in a new desktop version: `apps/boni-desktop/package.json` must be newer
   than the last release's version in `CHANGELOG.md` (CI refuses the change otherwise, I-05); the same for
   `apps/calendar-web` and `apps/calendar-desktop/package.json`. **Bump once per batch**: the first PR of the batch
   that touches a web app bumps it, the rest leave it. `make package-boni` / `make package` and
   `make e2e-boni-desktop` at the release.
6. **A release per batch**: versions, packages and the deploy go out together, at the end of a day or when Juan asks;
   `CHANGELOG.md` gets one entry per release saying what he can try and what each app needs (server, desktop, APK).
7. A visual or behavioural change updates `docs/design-guide.md` in the same PR. Build it directly and let Juan try it
   in his app; a mockup with the real app only when the shape of a screen or a flow is in doubt (I-13). The main
   screens have reference captures, made by the «screens» workflow (I-07).
8. A decision of Juan's that code can check enters `docs/principios.md` with its test, in the same PR.
9. Before designing something new, find what already does something like it (`docs/preferencias.md`, `docs/contexto.md`,
   `make map`, a search) and extend it: a proposal starts with what exists and says what it extends (T-05).
10. Test it the way Juan uses it before asking him: the real desktop app (`make e2e-boni-desktop`), the server locally with
   the built web app, phone-sized viewports, typing at a person's pace where timing matters, and **data shaped like
   his** (generated ids, his collections' keys and names: `e2e/server-data.ts`, `seed.test-util.ts`), never only the
   stubs, **and his volume** (thousands of records, a year of runs): anything the apps ask every second or on every
   request is timed with it before it ships (A-15; 2026-11-03, «Separar por» was tested with three records and read
   all 2,805 of his every second). On his screen, capture only the app window and delete the captures afterwards. Say what you verified and
   what you could not. Nothing that does not run in CI counts as tested: a test outside CI rots (the calendar
   desktop's peek test did, 2026-10-23 to 2026-11-03); an unstable test is quarantined with its task, never rerun
   and forgotten. **Before a PR that touches `apps/boni-web`, run the whole `make e2e-boni` and
   `make e2e-boni-desktop` here, not only the specs you touched**: on 2026-11-04 four CI rounds were lost to tests not updated after a rename and a
   move, and the desktop suite runs in series, so one failure drags the twelve after it.

## Sessions and models

Juan, 2026-11-11: one session building one task, on the largest model, spent 40 % of the week's quota in a day (533
calls for five messages, context near a million; the cost was re-reading, not test output).

- **One session per task**: a new session in its own worktree, never a big one resumed after more than an hour's pause.
  A session that coordinates others never reads code: it briefs them and checks their results.
- **Model and effort per role**: Opus high to build, medium for routine changes; Haiku low to explore (the `explorer`
  agent); Sonnet high to review (the `conformance-reviewer` agent, one round); Fable only to design a phase or for a
  hard bug. Every subagent call names its model; every file in `.claude/agents/` declares `model` and `effort` (T-06).
- Context compacts at 250k tokens (`autoCompactWindow`, a user setting). Don't rerun a suite whose output you have.

## Hard rules

- No personal data, ever: invented samples (`ejemplo.*@example.*`), no hostnames, tokens or paths of Juan's machines,
  no secrets.
- Nothing of the user's domain in code or prompts (names of collections, areas, categories): the data explains itself
  (D-14). Boni's money code still names its collections; that is the transition, not a pattern to copy.
- UI strings only through each app's `i18n.ts`, Spanish first and English second, with real accents (I-02).
- Time: instants (epoch ms) plus an IANA timezone; all-day items are civil days; wall-clock math only through
  `packages/calendar/src/time.ts`; no `Date` local getters in UI code.
- The model is untrusted: it writes plans that code interprets, and every call goes through the policy engine (A-01).
  Text from a model or from outside is painted as plain text, never as HTML, Markdown or links.
- The core (`packages/entities`, `store`, `agent`, `views`) depends on no app (A-02).
- Server: every route is listed in `apps/server/src/routes.ts` and is tailnet-only unless made public on purpose
  (A-03). Node only strips types there, so no parameter properties or enums in the files it loads (`write.test.ts`).
  Files and copies are streamed, never read whole into memory (the container has 384 MB). Every download made on
  someone's behalf goes through `@boni/net`.
- The user's data lives in the user's store, with the operation log and Undo; `system.db` keeps only accounts,
  devices, sessions and keys (D-02).
- Names that devices depend on stay as they are: the desktop package `boni-calendar-desktop` (its userData folder and
  the `.deb`), the Android `applicationId`, the workflow `android.yml` (its run number is the versionCode), the
  IndexedDB stores `boni-calendar-server*`, the server's start log line and the Docker image tag.
- Boni Android's `Net.kt` (`Paths.apiRequest`) and Boni desktop's `paths.cjs` allow the same paths: a new API the app
  uses goes into both.
- Evaluations with real models (`packages/agent/eval`) are run by hand with a budget, never in CI.
- Biome lints and formats; React's hook-dependency lint is off on purpose (the calendar grid is an imperative engine).
