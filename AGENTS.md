# AGENTS.md — Boni

Boni is a personal system: one server, one account per person, the person's data as collections, an assistant whose
model plans while code decides what is allowed, and the apps over it (Boni and Boni Calendar, on the desktop and on
Android). This monorepo holds all of it. **The repo is public:** everything in it is invented.

Before a big step read `docs/principios.md`: the rules that must not break, each with the test that guards it.
Design, in Spanish (Juan's docs): `docs/nucleo.md` (the core: data, store, agent, security), `docs/clases.md`
(collections as classes), `docs/contexto.md` (what is written and what is computed for agents), `docs/extensiones.md`
(extensions), `docs/conversacion.md` (the conversation: chats, cards, surfaces, assistants, voice), `docs/correo.md`
(mail: how it is read, tested and improved), `docs/design-guide.md` (every UI). Code, comments, commits and AI-facing
text are in English.

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
- `make e2e` (Playwright on the system Chrome) · `make e2e-boni` (Boni's only) · `make e2e-boni-desktop` (Boni's real
  desktop app; opens a window)
- `make package-boni` (Boni's desktop `.deb`) · `make package` (Boni Calendar's `.deb` and AppImage) · `make server`
- `make bench-chrome` / `make bench-electron`: the calendar grid's smoothness (`docs/rendimiento.md`)

## How a change is made

1. A branch from `main`; nothing is pushed to `main` directly.
2. `make check && git commit && git push` (a failure stops the chain), then a PR. Merge it yourself when CI is green
   (with Android changes, also wait for the APK build). While CI runs, go on with the next thing.
3. Every change to `apps/boni-web` ships in a new desktop version: bump `apps/boni-desktop/package.json`, then
   `make package-boni` and `make e2e-boni-desktop` (CI refuses the change otherwise, I-05).
4. A visual or behavioural change updates `docs/design-guide.md` in the same PR. A new screen starts as a mockup with the
   real app (I-09). The main screens have reference captures, made by the «screens» workflow (I-07).
5. A decision of Juan's that code can check enters `docs/principios.md` with its test, in the same PR.
6. Test it the way Juan uses it before asking him: the real desktop app (`make e2e-boni-desktop`), the server locally with
   the built web app, phone-sized viewports, typing at a person's pace where timing matters. On his screen, capture only
   the app window and delete the captures afterwards. Say what you verified and what you could not.

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
