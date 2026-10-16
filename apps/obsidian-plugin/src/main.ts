import type { Host } from "@boni-calendar/web/src/host.ts";
import { t } from "@boni-calendar/web/src/i18n.ts";
import { getLanguage, Plugin } from "obsidian";
import { type ObsidianBridge, obsidianBridge } from "./bridge.ts";
import { indexedDbCache } from "./cache.ts";
import { obsidianStorage } from "./storage.ts";
import { CalendarView, VIEW_TYPE } from "./view.ts";

/**
 * Boni Calendar inside Obsidian: the same app as the desktop one, in a tab, reading and writing the
 * vault through Obsidian. Loading the plugin only registers the tab, a ribbon icon and a command;
 * the vault is read when the tab opens.
 */
export default class BoniCalendarPlugin extends Plugin {
  locale: "es" | "en" = "es";
  private bridge: ObsidianBridge | null = null;
  private owner: CalendarView | null = null;

  override async onload(): Promise<void> {
    this.locale = getLanguage().startsWith("es") ? "es" : "en";
    const label = t("plugin.open", undefined, this.locale);
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));
    this.addRibbonIcon("calendar-days", label, () => void this.openCalendar());
    this.addCommand({ id: "open", name: label, callback: () => void this.openCalendar() });
  }

  override onunload(): void {
    this.bridge?.dispose();
    this.bridge = null;
  }

  /** Shows the calendar's tab, opening one if there is none. */
  async openCalendar(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** What the app needs from Obsidian. The bridge is made the first time the calendar opens. */
  host(): Host {
    const id = (this.app as unknown as { appId?: string }).appId ?? this.app.vault.getName();
    this.bridge ??= obsidianBridge(this.app, { cache: indexedDbCache(id) });
    return {
      vault: this.bridge,
      storage: obsidianStorage(this.app),
      keys: "root",
      // Decided by Juan (2026-10-16): in Obsidian the calendar writes to the vault from the start.
      settings: { dataSource: "vault", vaultWrite: true },
      vaultOnly: true,
    };
  }

  /**
   * The in-app smoothness benchmark on the open calendar (used by `make bench-obsidian`); loaded only
   * when called.
   */
  async bench(only = ""): Promise<unknown> {
    const { runBench } = await import("@boni-calendar/web/src/bench.ts");
    return runBench(only);
  }

  /** The app is mounted in one view at a time; false when another view already has it. */
  claim(view: CalendarView): boolean {
    if (this.owner && this.owner !== view) return false;
    this.owner = view;
    return true;
  }

  release(view: CalendarView): void {
    if (this.owner === view) this.owner = null;
  }
}
