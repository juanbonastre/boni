/**
 * Pointing (docs/sistema.md §4.7, F9; task 85): with `Ctrl+Shift+E` (or the bar's «Señalar») the pointer marks what
 * the next message is about. What can be pointed at lights under it (a block of a page, a row, a card of the
 * Bandeja: whatever carries a `data-boni-ref`); a click takes the one under it, dragging takes the ones the rectangle
 * holds (`inBox`), and they go to the bar as chips, by reference. While it is on nothing on the screen answers the
 * pointer (no click opens, no drag moves): only Boni's own window does, and the wheel still scrolls. `Esc` leaves
 * it, and does nothing else. A gesture the pointer began is its own to the end: neither its release nor a second
 * click right after it (a double click) reaches what is under it.
 */
import { useEffect } from "react";
import { focusAtEnd } from "../core/caret.ts";
import {
  type Box,
  inBox,
  MAX_POINTED,
  OWN,
  type Pointed,
  readRef,
  type Target,
  watchFocus,
} from "../core/pointing.ts";
import { pointAt, setPointing, useStore } from "../store.ts";

const REF = "[data-boni-ref]";
/** A press that moves this far is a drag (the rectangle); less is a click. */
const DRAG_PX = 6;
/** Where a thing is looked for under the rectangle, across the part of it the rectangle crosses. */
const PROBES = [1 / 6, 1 / 2, 5 / 6];

/** What a pointer's press, its release and what follows them send. */
const PRESS = [
  "pointerdown",
  "mousedown",
  "pointerup",
  "mouseup",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
];
/** As long as a double click may take (the systems' own are 400 to 500 ms), and as far as its two clicks may be. */
const REST_MS = 500;
const REST_PX = 10;
const eat = (e: Event) => {
  e.preventDefault();
  e.stopImmediatePropagation();
};
/**
 * The rest of a gesture the pointer took reaches nothing. Taking something ends pointing at once (on the button's
 * release at `x`, `y`), and the click that follows that release would reach what is under it with no pointer left to
 * stop it; so would the second click of a double click, on a card's «Aceptar» or on Boni's own window, just opened
 * under the pointer. For a moment after the release no press is heard there, apart from the pointing's own life; a
 * press anywhere else is a new one, and is heard (the bar's «Señalar», a chip's «×»).
 */
function swallowRest(x: number, y: number) {
  const here = (e: Event) => {
    if (e instanceof MouseEvent && Math.hypot(e.clientX - x, e.clientY - y) <= REST_PX) eat(e);
  };
  const off = () => {
    clearTimeout(timer);
    for (const name of PRESS) window.removeEventListener(name, here, true);
    if (heardAgain === off) heardAgain = null;
  };
  heardAgain?.();
  for (const name of PRESS) window.addEventListener(name, here, true);
  const timer = setTimeout(off, REST_MS);
  heardAgain = off;
}
/** Ends that moment early: pointing again is a new gesture, heard from its first press. */
let heardAgain: (() => void) | null = null;
/**
 * Pointing ended with the button still down (`Esc`, `Ctrl+Shift+E` or Ajustes in the middle of a drag): its release
 * is still the pointer's, and so is what follows it.
 */
function swallowRelease() {
  const done = (e: Event) => {
    off();
    if (!(e instanceof PointerEvent) || e.type !== "pointerup") return;
    eat(e);
    swallowRest(e.clientX, e.clientY);
  };
  const off = () => {
    window.removeEventListener("pointerup", done, true);
    window.removeEventListener("pointercancel", done, true);
    window.removeEventListener("blur", done);
  };
  window.addEventListener("pointerup", done, true);
  window.addEventListener("pointercancel", done, true);
  window.addEventListener("blur", done);
}

const pointedOf = (el: HTMLElement): Pointed | null => {
  const ref = readRef(el.getAttribute("data-boni-ref"));
  return ref ? { ref, title: el.getAttribute("data-boni-title") ?? "" } : null;
};

export function ScreenPointer() {
  const active = useStore((s) => s.pointing);
  // `Esc` leaves pointing and does nothing else: this listener is the app's first (App mounts the pointer before
  // anything), so it hears the key before a table's, a page's or the window's own.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !useStore.getState().pointing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPointing(false);
    };
    window.addEventListener("keydown", esc, true);
    // What he was on before writing is the screen's focus (§4.7): followed from here on.
    const unwatch = watchFocus();
    return () => {
      window.removeEventListener("keydown", esc, true);
      unwatch();
      // The pointer goes away with the desktop's layout (a window made narrow): pointing does not wait for it.
      setPointing(false);
    };
  }, []);
  // Pointing is over a screen: it ends when something else takes it (Ajustes, the search, the trash, the
  // conversation's own screen), where there is nothing to point at and a click must be a click.
  const covered = useStore(
    (s) => s.settingsOpen || s.findOpen || s.trash != null || s.view.kind === "chat",
  );
  useEffect(() => {
    if (active && covered) setPointing(false);
  }, [active, covered]);
  useEffect(() => {
    if (!active) return;
    heardAgain?.();
    const root = document.documentElement;
    root.setAttribute("data-boni-pointing", "");
    let marked: HTMLElement[] = [];
    const mark = (els: HTMLElement[]) => {
      for (const el of marked) if (!els.includes(el)) el.removeAttribute("data-boni-pointed");
      for (const el of els) el.setAttribute("data-boni-pointed", "");
      marked = els;
    };
    const own = (t: EventTarget | null) => t instanceof Element && !!t.closest(OWN);
    const under = (t: EventTarget | null) =>
      t instanceof Element && !t.closest(OWN) ? t.closest<HTMLElement>(REF) : null;

    let from: { x: number; y: number } | null = null;
    let band: HTMLDivElement | null = null;
    let targets: { el: HTMLElement; target: Target }[] = [];
    /** Where everything that can be pointed at is now, each with the pointable it is inside. */
    const measure = () => {
      const els = [...document.querySelectorAll<HTMLElement>(REF)].filter((el) => !el.closest(OWN));
      const index = new Map(els.map((el, i) => [el, i]));
      targets = els.map((el) => {
        const r = el.getBoundingClientRect();
        const up = el.parentElement?.closest<HTMLElement>(REF) ?? null;
        return {
          el,
          target: {
            box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
            parent: up ? (index.get(up) ?? null) : null,
          },
        };
      });
    };
    const boxTo = (x: number, y: number) => {
      const a = from ?? { x, y };
      return {
        left: Math.min(a.x, x),
        top: Math.min(a.y, y),
        right: Math.max(a.x, x),
        bottom: Math.max(a.y, y),
      };
    };
    /**
     * Whether any of a thing is to be seen where the rectangle crosses it: what a window covers or a scrolled box
     * cuts away is not taken by a rectangle drawn over it.
     */
    const seen = (el: HTMLElement, at: Box, band: Box) => {
      const left = Math.max(at.left, band.left);
      const top = Math.max(at.top, band.top);
      const w = Math.min(at.right, band.right) - left;
      const h = Math.min(at.bottom, band.bottom) - top;
      for (const fx of PROBES)
        for (const fy of PROBES) {
          const hit = document.elementFromPoint(left + w * fx, top + h * fy);
          if (hit && !hit.closest(OWN) && (el.contains(hit) || hit.contains(el))) return true;
        }
      return false;
    };
    /** What the rectangle takes: what `inBox` says of what is there to be seen, as many as a message carries. */
    const taken = (x: number, y: number) => {
      const band = boxTo(x, y);
      return inBox(
        targets.map((t) => t.target),
        band,
      )
        .flatMap((i) => targets[i] ?? [])
        .filter((t) => seen(t.el, t.target.box, band))
        .slice(0, MAX_POINTED)
        .map((t) => t.el);
    };
    const endDrag = () => {
      band?.remove();
      band = null;
      from = null;
      targets = [];
    };
    const take = (els: HTMLElement[]) => {
      const pointed = els.flatMap((el) => pointedOf(el) ?? []);
      if (!pointed.length) return;
      pointAt(pointed);
      // What Juan types next is the message about it.
      requestAnimationFrame(() =>
        focusAtEnd(
          document.querySelector<HTMLTextAreaElement>(
            ".boni-window textarea, .boni-docked textarea",
          ),
        ),
      );
    };
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const down = (e: PointerEvent) => {
      if (own(e.target)) return;
      swallow(e);
      if (e.button === 0) from = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      // What is under the pointer does not hear it move either (a chart's own marks, a tooltip).
      if (!own(e.target)) e.stopImmediatePropagation();
      if (!from) {
        const el = under(e.target);
        mark(el ? [el] : []);
        return;
      }
      if (!band) {
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_PX) return;
        band = document.createElement("div");
        band.className = "boni-point-band";
        document.body.append(band);
        measure();
      }
      const b = boxTo(e.clientX, e.clientY);
      band.style.left = `${b.left}px`;
      band.style.top = `${b.top}px`;
      band.style.width = `${b.right - b.left}px`;
      band.style.height = `${b.bottom - b.top}px`;
      mark(taken(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (!from) return;
      swallow(e);
      const dragged = !!band;
      const els = dragged
        ? taken(e.clientX, e.clientY)
        : [under(document.elementFromPoint(e.clientX, e.clientY))].flatMap((el) => el ?? []);
      endDrag();
      // A click on nothing leaves the pointer on, for the next try. Something taken ends pointing here, with the
      // button just let go: what follows that release is not for what is under it.
      if (els.length) {
        swallowRest(e.clientX, e.clientY);
        take(els);
      } else mark([]);
    };
    /** Nothing under the pointer answers it while it points: no click opens, no drag moves, no menu comes. */
    const inert = (e: Event) => {
      if (!own(e.target)) swallow(e);
    };
    // The page moved under a drag: where things are is read again.
    const scrolled = () => {
      if (band) measure();
    };
    const INERT = [
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "auxclick",
      "contextmenu",
      "dragstart",
    ];
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", endDrag, true);
    for (const name of INERT) document.addEventListener(name, inert, true);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("blur", endDrag);
    return () => {
      root.removeAttribute("data-boni-pointing");
      mark([]);
      // Ended with the button down: what is under the pointer does not get the release, nor its click.
      if (from) swallowRelease();
      endDrag();
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", endDrag, true);
      for (const name of INERT) document.removeEventListener(name, inert, true);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("blur", endDrag);
    };
  }, [active]);
  return null;
}
