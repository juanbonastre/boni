import type { HostStorage } from "@boni-calendar/web/src/host.ts";
import type { App } from "obsidian";

/**
 * Settings and UI state of the calendar, per vault and per device (Obsidian keeps them in its own
 * storage, outside the vault, so they do not travel with Syncthing).
 */
export function obsidianStorage(app: App): HostStorage {
  return {
    get: (key) => {
      const v = app.loadLocalStorage(key) as unknown;
      return typeof v === "string" ? v : null;
    },
    set: (key, value) => app.saveLocalStorage(key, value),
  };
}
