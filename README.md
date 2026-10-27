# Boni

A personal system, self-hosted and shaped around one person's data. Everything is a record of a collection, and the
collections form a tree, like classes. An assistant helps: its model writes plans, and Boni's code decides what each
step may do. Two kinds of app use the same server and the same account:

- **Boni**: pages, databases, charts, a conversation with the assistant, and quick captures (desktop and Android).
- **Boni Calendar**: a fluid day, week, month and N-day calendar over any collection with dates (desktop and Android).

How it is built and why: `docs/nucleo.md` (the core: data, store, agent, security), `docs/clases.md` (collections as
classes), `docs/extensiones.md` (extensions) and `docs/design-guide.md` (the interfaces). The rules that must not
break, each with the test that guards it: `docs/principios.md`. Where each part lives: `make map`.

```bash
make setup    # install the dependencies (pnpm)
make check    # lint, types and unit tests
make map      # every package and app, with what it is for
make server   # the server locally (environment: apps/server/src/main.ts)
make e2e      # end-to-end tests on the system Chrome
```

Everything in this repository is invented: the sample data, the accounts and the vaults in the tests.
