// Desktop widgets: where each one goes and how it stays on the desktop.
//
// A widget is a small transparent window. On Linux/X11 it is a "dock" window that the window manager is asked to
// keep below the others and on every workspace (`wmctrl -b add,below,sticky`). Tried on Cinnamon's window manager
// (muffin, 2026-10-17): that puts it in the layer just above the desktop background and below every normal window,
// it survives "show desktop" (Super+D) and clicks on the desktop, stays out of the taskbar and Alt+Tab, and still
// gets the mouse and the keyboard. A "desktop" window falls behind the background after a click on the desktop; a
// normal window kept below hides with Super+D. Without wmctrl a dock window would float above everything, so the
// widget is then a plain frameless window.
const fs = require("node:fs");
const { execFile } = require("node:child_process");

/** Widget sizes by the server's size name (the user can resize a widget afterwards). */
const SIZES = {
  small: { width: 300, height: 200 },
  medium: { width: 380, height: 260 },
  large: { width: 520, height: 340 },
};
const MIN = { width: 220, height: 150 };
const MAX = { width: 1000, height: 800 };

const sizeOf = (name) => SIZES[name] ?? SIZES.medium;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Widgets start stacked at the top right of the work area, wrapping to a new column when the screen is full. */
function defaultPlacement(index, size, area) {
  const { width, height } = sizeOf(size);
  const perColumn = Math.max(1, Math.floor((area.height - 24) / (height + 16)));
  const column = Math.floor(index / perColumn);
  const row = index % perColumn;
  return {
    x: Math.max(area.x, area.x + area.width - (width + 24) * (column + 1)),
    y: area.y + 24 + row * (height + 16),
    width,
    height,
    size,
  };
}

/**
 * Where a widget goes: its saved place, except that a new size chosen in Boni resets the size it was dragged to
 * (keeping its position), and a place that is off every screen comes back to the default.
 */
function placementFor(widget, index, saved, area, onScreen = () => true) {
  const d = defaultPlacement(index, widget.size, area);
  if (!saved) return d;
  const sameSize = saved.size == null || saved.size === widget.size;
  const p = {
    x: saved.x,
    y: saved.y,
    width: sameSize && saved.width ? clamp(saved.width, MIN.width, MAX.width) : d.width,
    height: sameSize && saved.height ? clamp(saved.height, MIN.height, MAX.height) : d.height,
    size: widget.size,
  };
  return onScreen(p) ? p : { ...d, width: p.width, height: p.height };
}

/** The widgets this computer shows now. */
function visibleWidgets(widgets, settings) {
  if (!settings.showWidgets) return [];
  const hidden = new Set(settings.hiddenWidgets);
  return widgets.filter(
    (w) => w && typeof w.id === "string" && typeof w.chart_id === "string" && !hidden.has(w.id),
  );
}

const WMCTRL = ["/usr/bin/wmctrl", "/usr/local/bin/wmctrl"];

/** Whether widgets can be kept below the windows here (Linux with X11 and wmctrl). */
function layerTool(env = process.env, platform = process.platform, exists = fs.existsSync) {
  if (platform !== "linux" || !env.DISPLAY) return null;
  if (env.XDG_SESSION_TYPE === "wayland") return null;
  return WMCTRL.find((p) => exists(p)) ?? null;
}

/** Asks the window manager to keep window `xid` below the others, on every workspace (retries until mapped). */
function keepBelow(tool, xid, log, tries = 6) {
  const id = `0x${xid.toString(16)}`;
  const attempt = (left) =>
    execFile(tool, ["-i", "-r", id, "-b", "add,below,sticky"], { timeout: 3000 }, (err) => {
      if (!err) return;
      if (left > 1) setTimeout(() => attempt(left - 1), 300);
      else log(`wmctrl could not keep ${id} below: ${err.message}`);
    });
  attempt(tries);
}

/** Positions of the first client's Cinnamon desklets, by slot (0-based widget index), read-only. */
function deskletPlaces(enabledDesklets, slotOf) {
  const places = new Map();
  for (const entry of enabledDesklets) {
    const [uuid, instance, x, y] = String(entry).split(":");
    if (uuid !== "boni@juanbonastre") continue;
    const slot = slotOf(instance);
    if (Number.isInteger(slot) && slot >= 1) places.set(slot - 1, { x: Number(x), y: Number(y) });
  }
  return places;
}

module.exports = {
  SIZES,
  MIN,
  MAX,
  sizeOf,
  clamp,
  defaultPlacement,
  placementFor,
  visibleWidgets,
  layerTool,
  keepBelow,
  deskletPlaces,
};
