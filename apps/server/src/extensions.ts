import { MODULES } from "@boni/agent";
import { label } from "@boni/entities";
import {
  type Catalogue,
  type ExtensionManifest,
  manifestErrors,
  parseManifest,
} from "@boni/extensions";
import type { UserStore } from "@boni/store";

/**
 * Extensions in the server (docs/extensiones.md 3): what this build offers to compose them (the catalogue,
 * layer 1), the presets it ships, and each account's installed extensions, kept in its store as entities of
 * the system type `extension` (versioned, undoable, exported like everything else). Only code writes them
 * here; the agent's entity tools never touch a system type.
 */

/** The pieces a manifest may name in this build. */
export const CATALOGUE: Catalogue = {
  connectors: ["imap"],
  modules: Object.fromEntries(MODULES.map((m) => [m.id, { kind: m.kind }])),
  plans: ["read-and-propose"],
  roles: ["cheap", "strong"],
};

/** Mail as the first extension: what mail.ts did by hand, now as data (behaviour unchanged). */
export const MAIL_EXTENSION: ExtensionManifest = {
  id: "correo",
  name: "Correo",
  version: 1,
  description:
    "Trae el correo de tu buzón (solo lectura) y propone las tareas y citas que te pide, en la colección que elige la IA entre las que marcas.",
  types: [
    {
      key: "correo",
      name: "Correos",
      fields: ["asunto", "de", "de_nombre", "para", "cc", "fecha", "adjuntos", "id_mensaje"],
    },
  ],
  sources: [{ connector: "imap", into: "correo" }],
  readers: [{ module: "tasks" }, { module: "events" }],
  flows: [{ on: { created: "correo" }, plan: "read-and-propose" }],
  routes: { tasks: { propose: "chosen" }, events: { propose: "chosen" } },
  learning: { every: 20 },
  needs: {
    reads: ["correo"],
    proposes: true,
    roles: { reader: "cheap", reviewer: "cheap" },
    budget: { readersPerDay: 150 },
  },
};

export const PRESETS: readonly ExtensionManifest[] = [MAIL_EXTENSION];

export interface Installed {
  entity: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  /** The preset version it still is, or null once it was changed. */
  preset: number | null;
}

const CODE = label("own", "personal", [{ kind: "code", id: "extensions" }]);
const v = (value: string) => ({ value, label: CODE });

/** The account's installed extensions (a manifest that no longer validates is left out, and logged). */
export function installed(store: UserStore): Installed[] {
  if (!store.schema().types.extension) return [];
  const out: Installed[] = [];
  for (const e of store.list("extension")) {
    const x = e.entity.values;
    // Only proposed so far (E3): not installed until Juan activates it.
    if (!x.f_manifest) continue;
    let raw: unknown = null;
    try {
      raw = JSON.parse(String(x.f_manifest ?? "null"));
    } catch {
      raw = null;
    }
    const p = parseManifest(raw, CATALOGUE);
    if (!p.ok) {
      console.warn(`extension ${String(x.f_key)}: invalid manifest (${p.errors.join("; ")})`);
      continue;
    }
    const preset = Number(x.f_preset);
    out.push({
      entity: e.entity.id,
      manifest: p.manifest,
      enabled: x.f_state !== "off",
      preset: Number.isInteger(preset) && preset > 0 ? preset : null,
    });
  }
  return out;
}

export const extension = (store: UserStore, id: string): Installed | null =>
  installed(store).find((i) => i.manifest.id === id) ?? null;

/**
 * Installs the presets an account lacks, and brings one up to the preset's new version when it is still
 * the preset (never over a manifest that was changed). Idempotent; runs when the store opens.
 */
export function ensurePresets(store: UserStore): void {
  if (!store.schema().types.extension) return;
  const have = installed(store);
  for (const p of PRESETS) {
    const errors = manifestErrors(p, CATALOGUE);
    if (errors.length) throw new Error(`preset ${p.id}: ${errors.join("; ")}`);
    const i = have.find((h) => h.manifest.id === p.id);
    const values = {
      f_key: v(p.id),
      f_name: v(p.name),
      f_manifest: v(JSON.stringify(p)),
      f_preset: v(String(p.version)),
    };
    if (!i) store.create("extension", { ...values, f_state: v("on") }, { actor: "system" });
    else if (i.preset !== null && i.preset < p.version)
      store.update(i.entity, values, { actor: "system" });
  }
}

/** Turns an extension on or off (Juan, from a personal device: the code writes it, as only code writes a
 * system type; the device goes to the log). */
export function setEnabled(
  store: UserStore,
  id: string,
  on: boolean,
  device?: string,
): Installed | null {
  const i = extension(store, id);
  if (!i) return null;
  store.update(
    i.entity,
    { f_state: v(on ? "on" : "off") },
    { actor: "system", ...(device ? { device } : {}) },
  );
  return extension(store, id);
}
