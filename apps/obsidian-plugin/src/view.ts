import { t } from "@boni-calendar/web/src/i18n.ts";
import { ItemView, type Modifier, Scope, type WorkspaceLeaf } from "obsidian";
import type BoniCalendarPlugin from "./main.ts";

export const VIEW_TYPE = "boni-calendar";

/** The calendar's stylesheet, scoped under `.boni` at build time (build.mjs). */
declare const __BONI_CSS__: string;

/**
 * Keys the calendar answers to that Obsidian also binds. While the calendar has the focus they are
 * left to it: a key registered in the view's scope with a handler that returns nothing stops
 * Obsidian's own hotkey and lets the key go on to the calendar.
 */
const PASS_THROUGH: [Modifier[] | null, string][] = [
  [["Mod"], "k"],
  [["Mod"], ","],
  [["Mod"], "z"],
  [["Mod", "Shift"], "z"],
  [["Mod"], "y"],
  [["Mod"], "a"],
  [null, "Escape"],
];

/**
 * A tab with the calendar. The app lives in a shadow root, so Obsidian's styles (its theme, and
 * class names like `.menu` or `.modal` that the app also uses) and the app's never meet. Nothing
 * is loaded until the tab is shown and Obsidian has finished starting.
 */
export class CalendarView extends ItemView {
  private mounted: { unmount(): void } | null = null;
  /** Between onOpen and onClose (the mount waits for the layout, the tab may close meanwhile). */
  private shown = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: BoniCalendarPlugin,
  ) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    for (const [mods, key] of PASS_THROUGH) this.scope.register(mods, key, () => undefined);
  }

  override getViewType(): string {
    return VIEW_TYPE;
  }
  override getDisplayText(): string {
    return "Boni Calendar";
  }
  override getIcon(): string {
    return "calendar-days";
  }

  override async onOpen(): Promise<void> {
    this.shown = true;
    const el = this.contentEl;
    el.empty();
    el.style.padding = "0";
    el.style.overflow = "hidden";
    const shell = el.createDiv();
    shell.style.height = "100%";
    const shadow = shell.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = __BONI_CSS__;
    const root = document.createElement("div");
    root.style.height = "100%";
    shadow.append(style, root);
    this.app.workspace.onLayoutReady(() => void this.mount(root));
  }

  private async mount(root: HTMLElement): Promise<void> {
    if (!this.shown) return;
    // The app is one store: one tab at a time. Another one says where the calendar is.
    if (!this.plugin.claim(this)) {
      root.textContent = t("plugin.alreadyOpen", undefined, this.plugin.locale);
      root.style.cssText = "height:100%;display:grid;place-items:center;font:13px system-ui";
      return;
    }
    const { mountApp } = await import("@boni-calendar/web/src/mount.tsx");
    if (!this.shown) return void this.plugin.release(this);
    this.mounted = await mountApp(root, this.plugin.host());
  }

  override async onClose(): Promise<void> {
    this.shown = false;
    this.mounted?.unmount();
    this.mounted = null;
    this.plugin.release(this);
  }
}
