# Boni

The Boni monorepo: the Boni core in the making (`docs/nucleo.md`) and its apps. Today it is **Boni Calendar**, a
calendar app for the desktop with the fluid, keyboard-friendly feel of the best modern calendars, made to be
self-hosted and shaped around one person's data. Day, week, month and custom N-day views, a mini month, calendars
grouped by account with show/hide, per-calendar event properties, an event detail popover or side panel, drag to
create/move/resize, a command palette with natural-language quick create, and smooth wheel / Ctrl+wheel / Shift+wheel.

Status: Boni Calendar is in daily use (desktop, Android, Obsidian plugin, server); see `docs/estado.md`. The first Boni
(charts, shortcuts) is kept for reference in `legacy/boni/`.

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # unit tests
pnpm exec playwright test   # end-to-end (uses the system Chrome)
```

The sample data is invented. Nothing leaves the machine.
