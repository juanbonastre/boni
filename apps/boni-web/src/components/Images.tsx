/**
 * The images of a note's text (task 2h): an image alone or a row of them (`files`), each grown or shrunk by its
 * corner, dragged on its own (beside another it makes a row with it, Juan 2026-10-30), shown large with a click (the
 * viewer passes from one to the next) and cropped without touching its file. What each gesture does to the blocks is
 * core/images.ts; here is the screen. Every gesture is one step of Undo and is saved at once (D-65, task 100).
 */
import { type Crop, type FileShown, ROW_MAX } from "@boni/views";
import { ChevronLeft, ChevronRight, Crop as CropIcon, Paperclip, X } from "lucide-react";
import {
  type CSSProperties,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { Page } from "../core/agent.ts";
import {
  cropped,
  type ImageAt,
  type ImageDrop,
  imagesOf,
  moveImage,
  reshaped,
  shownOf,
  sized,
  splitRow,
  tidyCrop,
  withImage,
} from "../core/images.ts";
import { chipTitle, pointAttrs } from "../core/pointing.ts";
import {
  blockId,
  editingDoc,
  fileInline,
  fileOfRow,
  flushPage,
  flushRowBody,
  openFile,
  setPageBlocks,
  toast,
  useEditing,
  useStore,
} from "../store.ts";
import { MenuRow, MenuSep } from "./Popover.tsx";

type Block = Page["spec"]["blocks"][number];
type FileBlock = Extract<Block, { type: "file" }>;
type RowBlock = Extract<Block, { type: "files" }>;

/** A name that says an image (what the text names it; the record's own title when it has one). */
export const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
/** The narrowest an image is made by its corner (CSS pixels). */
const NARROWEST = 48;

// ——— What a file block's row resolves to, kept for the frames and the viewer alike ———

type Resolved = { sha: string; name: string; url: string | null };
/**
 * The last images resolved, by their row: a frame drawn again, the viewer passing over them, or the same image twice
 * ask once. Few are kept (each is its bytes as a data: address); one that was not found is asked again next time.
 */
const resolved = new Map<string, { p: Promise<Resolved | null>; v?: Resolved }>();
const KEPT = 24;
function resolveFile(row: string, name: string): Promise<Resolved | null> {
  const had = resolved.get(row);
  if (had) {
    resolved.delete(row);
    resolved.set(row, had);
    return had.p;
  }
  const entry: { p: Promise<Resolved | null>; v?: Resolved } = { p: Promise.resolve(null) };
  entry.p = (async () => {
    const f = await fileOfRow(row);
    if (!f) {
      resolved.delete(row);
      return null;
    }
    const shown = f.name || name;
    const url = IMAGE.test(shown) ? await fileInline(f.sha) : null;
    entry.v = { ...f, name: shown, url };
    return entry.v;
  })();
  resolved.set(row, entry);
  while (resolved.size > KEPT) resolved.delete(resolved.keys().next().value as string);
  return entry.p;
}

function useResolved(row: string, name: string): Resolved | "gone" | null {
  const [file, setFile] = useState<Resolved | "gone" | null>(() => resolved.get(row)?.v ?? null);
  useEffect(() => {
    let live = true;
    setFile(resolved.get(row)?.v ?? null);
    void resolveFile(row, name).then((f) => live && setFile(f ?? "gone"));
    return () => {
      live = false;
    };
  }, [row, name]);
  return file;
}

/** The part of an image shown (its file untouched): CSS's view box over it. */
const viewBox = (c: Crop | undefined): CSSProperties | undefined => {
  if (!c) return undefined;
  const n = (v: number) => `${Math.round(v * 10) / 10}%`;
  return {
    objectViewBox: `inset(${n(c.y)} ${n(100 - c.x - c.w)} ${n(100 - c.y - c.h)} ${n(c.x)})`,
  } as CSSProperties;
};

// ——— The viewer and the crop, one dialog over the page ———

type Shown = { at: ImageAt; mode: "view" | "crop"; back: boolean } | null;
let shownNow: Shown = null;
const watchers = new Set<() => void>();
const showImage = (s: Shown) => {
  shownNow = s;
  for (const f of watchers) f();
};
const watch = (f: () => void) => {
  watchers.add(f);
  return () => {
    watchers.delete(f);
  };
};
/** An image of the page being edited shown large (a click on it, Space on it in the text, its menu). */
export const viewImage = (at: ImageAt) => showImage({ at, mode: "view", back: false });
/** An image's crop changed, from its menu or its tools. */
export const cropImage = (at: ImageAt) => showImage({ at, mode: "crop", back: false });

/** Whether a block shows images the viewer can show (Space on it opens it). */
export const hasImage = (b: Block) => shownOf(b).some((f) => IMAGE.test(f.name));

/** The page's next blocks put, one step of Undo, and saved now: a gesture is done when the pointer lets go. */
function put(next: Block[] | null) {
  if (!next) return false;
  setPageBlocks(next);
  void flushPage();
  void flushRowBody();
  return true;
}

/** What a block's menu does with its images: show them, crop one, take its size or crop off, split a row. */
export function ImageMenu({
  block,
  blocks,
  close,
}: {
  block: FileBlock | RowBlock;
  blocks: Block[];
  close: () => void;
}) {
  const t = useStore((s) => s.t);
  if (!hasImage(block)) return null;
  const at = { block: block.id, index: 0 };
  const done = (next: Block[] | null) => {
    close();
    put(next);
  };
  return (
    <>
      <MenuRow
        label={t("image.view")}
        onClick={() => {
          close();
          viewImage(at);
        }}
      />
      {block.type === "file" ? (
        <>
          <MenuRow
            label={t("image.crop")}
            onClick={() => {
              close();
              cropImage(at);
            }}
          />
          {block.crop && (
            <MenuRow
              label={t("image.uncrop")}
              onClick={() => done(withImage(blocks, at, cropped(undefined)))}
            />
          )}
          {block.width && (
            <MenuRow
              label={t("image.natural")}
              onClick={() => done(withImage(blocks, at, sized(undefined)))}
            />
          )}
        </>
      ) : (
        <MenuRow
          label={t("image.split")}
          onClick={() => done(splitRow(blocks, block.id, blockId))}
        />
      )}
      <MenuSep />
    </>
  );
}

// ——— An image in the text ———

/** A file block (an image, or a card for any other file) or a row of images, as the text shows it. */
export const ImageBlock = memo(function ImageBlock({ block }: { block: FileBlock | RowBlock }) {
  if (block.type === "files")
    return (
      <div className="doc-files-row doc-img-live">
        {block.files.map((f, index) => (
          <ImageFrame key={`${index}:${f.file}`} at={{ block: block.id, index }} shown={f} inRow />
        ))}
      </div>
    );
  return <ImageFrame at={{ block: block.id, index: 0 }} shown={block} inRow={false} />;
});

function ImageFrame({ at, shown, inRow }: { at: ImageAt; shown: FileShown; inRow: boolean }) {
  const t = useStore((s) => s.t);
  const file = useResolved(shown.file, shown.name);
  const frame = useRef<HTMLElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const moved = useRef(false);
  if (file === "gone") return <p className="doc-gone">{t("file.missing")}</p>;
  const name = file?.name || shown.name;
  // While it is asked for, what its name says (a row holds images); then what the file is.
  if (!(file ? file.url : inRow || IMAGE.test(shown.name)))
    return (
      <button
        type="button"
        className="doc-file"
        disabled={!file}
        onClick={() => file && void openFile(file.sha, name)}
      >
        <Paperclip size={15} strokeWidth={1.8} aria-hidden="true" />
        <span className="doc-file-name">{name}</span>
        <span className="muted">{t("file.open")}</span>
      </button>
    );
  const style: CSSProperties | undefined = inRow
    ? shown.width
      ? { flex: `0 1 ${shown.width}px` }
      : undefined
    : undefined;
  const pointed = inRow
    ? pointAttrs({ kind: "row", id: shown.file }, chipTitle(t("block.kind.file"), name))
    : {};
  return (
    <figure
      ref={frame}
      className={`doc-file-image doc-img-live${inRow ? " in-row" : ""}`}
      style={style}
      data-img-block={at.block}
      data-img-index={at.index}
      {...pointed}
    >
      {file?.url ? (
        <img
          ref={img}
          src={file.url}
          alt={name}
          draggable={false}
          decoding="async"
          loading="lazy"
          style={{
            ...(!inRow && shown.width ? { width: shown.width } : {}),
            ...viewBox(shown.crop),
          }}
          onPointerDown={(e) => {
            moved.current = false;
            startDrag(e, at, file.url as string, () => {
              moved.current = true;
            });
          }}
          onClick={() => {
            if (!moved.current) viewImage(at);
          }}
          onContextMenu={(e) => {
            if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType === "touch")
              e.preventDefault();
          }}
        />
      ) : (
        <span className="doc-img-wait" />
      )}
      <figcaption>{name}</figcaption>
      {file?.url && (
        <>
          <span className="doc-img-tools">
            <button
              type="button"
              title={t("image.crop")}
              aria-label={`${t("image.crop")}: ${name}`}
              onClick={() => cropImage(at)}
            >
              <CropIcon size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </span>
          <span
            className="doc-img-corner"
            title={t("image.resize")}
            aria-hidden="true"
            onPointerDown={(e) => startResize(e, at, frame.current, img.current, inRow)}
          />
        </>
      )}
    </figure>
  );
}

// ——— Its corner: the size followed live on the screen, written once when the pointer lets go ———

function startResize(
  e: React.PointerEvent,
  at: ImageAt,
  frame: HTMLElement | null,
  img: HTMLImageElement | null,
  inRow: boolean,
) {
  if (e.button !== 0 || !frame || !img) return;
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);
  const x0 = e.clientX;
  const w0 = (inRow ? frame : img).getBoundingClientRect().width;
  const room =
    (inRow ? frame.parentElement : frame.parentElement)?.getBoundingClientRect().width ?? w0;
  const widest = Math.max(NARROWEST, room);
  let w = w0;
  frame.classList.add("resizing");
  const move = (ev: PointerEvent) => {
    w = Math.round(Math.min(widest, Math.max(NARROWEST, w0 + ev.clientX - x0)));
    if (inRow) frame.style.flex = `0 1 ${w}px`;
    else img.style.width = `${w}px`;
  };
  const end = (ev: PointerEvent) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    frame.classList.remove("resizing");
    if (ev.type === "pointercancel" || Math.abs(w - w0) < 2) {
      frame.style.flex = "";
      img.style.width = "";
      return;
    }
    const blocks = editingDoc()?.spec.blocks ?? [];
    // Written, the text's width is drawn over the one followed live; not written, the live one is undone.
    if (!put(withImage(blocks, at, sized(w)))) {
      frame.style.flex = "";
      img.style.width = "";
    }
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// ——— Dragging an image: with the mouse once it moves, with a finger after holding it ———

const HOLD_MS = 400;
const SLOP = 6;

function startDrag(e: React.PointerEvent, from: ImageAt, url: string, onMoved: () => void) {
  if (e.button !== 0) return;
  const touch = e.pointerType === "touch";
  const page = (e.currentTarget as HTMLElement).closest<HTMLElement>(".doc-blocks");
  if (!page) return;
  if (!touch) e.preventDefault();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let on = false;
  let ghost: HTMLElement | null = null;
  let mark: HTMLElement | null = null;
  let drop: ImageDrop | null = null;
  let at = { x: x0, y: y0 };
  let hold: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;
  const scroller = scrollParent(page);

  const begin = () => {
    on = true;
    onMoved();
    ghost = document.createElement("div");
    ghost.className = "doc-img-ghost";
    const g = document.createElement("img");
    g.src = url;
    g.alt = "";
    ghost.append(g);
    mark = document.createElement("div");
    mark.className = "doc-img-drop";
    document.body.append(ghost, mark);
    document.body.classList.add("dragging-image");
    navigator.vibrate?.(10);
    place();
    frame = requestAnimationFrame(edges);
  };
  const place = () => {
    if (!ghost || !mark) return;
    ghost.style.transform = `translate(${at.x + 8}px, ${at.y + 8}px)`;
    drop = dropAt(page, at.x, at.y);
    const r = drop && rectOf(page, drop);
    if (!drop || !r) {
      mark.style.display = "none";
      return;
    }
    mark.style.display = "block";
    const beside = drop.side === "left" || drop.side === "right";
    const x = drop.side === "right" ? r.right : r.left;
    const y = drop.side === "below" ? r.bottom : r.top;
    Object.assign(mark.style, {
      left: `${beside ? x - 2 : r.left}px`,
      top: `${beside ? r.top : y - 2}px`,
      width: beside ? "4px" : `${r.width}px`,
      height: beside ? `${r.height}px` : "4px",
    });
  };
  // Near the top or the bottom of the page, the page scrolls under the image being dragged.
  const edges = () => {
    if (!on) return;
    const box = scroller.getBoundingClientRect();
    const top = Math.max(box.top, 0);
    const bottom = Math.min(box.bottom, window.innerHeight);
    const by = at.y < top + 48 ? -12 : at.y > bottom - 48 ? 12 : 0;
    if (by) {
      scroller.scrollBy(0, by);
      place();
    }
    frame = requestAnimationFrame(edges);
  };
  const follow = (x: number, y: number) => {
    at = { x, y };
    if (on) place();
    else if (Math.hypot(x - x0, y - y0) > SLOP) {
      if (touch) stop(false);
      else begin();
    }
  };
  const onPointer = (ev: PointerEvent) => follow(ev.clientX, ev.clientY);
  const onTouch = (ev: TouchEvent) => {
    const p = ev.touches[0];
    if (!p) return;
    if (on) ev.preventDefault();
    follow(p.clientX, p.clientY);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    stop(false);
  };
  const onUp = () => stop(on);
  const stop = (dropIt: boolean) => {
    if (hold) clearTimeout(hold);
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onPointer, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("touchmove", onTouch, true);
    window.removeEventListener("touchend", onUp, true);
    window.removeEventListener("touchcancel", cancel, true);
    window.removeEventListener("keydown", onKey, true);
    ghost?.remove();
    mark?.remove();
    document.body.classList.remove("dragging-image");
    const was = on;
    on = false;
    if (!dropIt || !was || !drop) return;
    const blocks = editingDoc()?.spec.blocks ?? [];
    if (put(moveImage(blocks, from, drop, blockId))) return;
    const host = blocks.find((b) => b.id === drop?.block);
    if ("index" in drop && host?.type === "files" && host.files.length >= ROW_MAX)
      toast(useStore.getState().t("image.rowFull", { n: ROW_MAX }));
  };
  const cancel = () => stop(false);
  if (touch) {
    // A finger moving at once scrolls the page; held still, it picks the image up.
    hold = setTimeout(begin, HOLD_MS);
    window.addEventListener("touchmove", onTouch, { capture: true, passive: false });
    window.addEventListener("touchend", onUp, true);
    window.addEventListener("touchcancel", cancel, true);
  } else {
    window.addEventListener("pointermove", onPointer, true);
    window.addEventListener("pointerup", onUp, true);
  }
  if (!touch) window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("keydown", onKey, true);
}

/** Where an image let go here goes: beside the image under it, or above or below the block under it. */
function dropAt(page: HTMLElement, x: number, y: number): ImageDrop | null {
  const el = document.elementFromPoint(x, y);
  if (!el || !page.contains(el)) return null;
  const img = el.closest<HTMLElement>("[data-img-block]");
  if (img?.dataset.imgBlock) {
    const r = img.getBoundingClientRect();
    return {
      block: img.dataset.imgBlock,
      index: Number(img.dataset.imgIndex ?? 0),
      side: x < r.left + r.width / 2 ? "left" : "right",
    };
  }
  const blk = el.closest<HTMLElement>(".blk[data-block]");
  if (!blk?.dataset.block) return null;
  const r = blk.getBoundingClientRect();
  return { block: blk.dataset.block, side: y < r.top + r.height / 2 ? "above" : "below" };
}

function rectOf(page: HTMLElement, d: ImageDrop): DOMRect | null {
  const sel =
    "index" in d
      ? `[data-img-block="${CSS.escape(d.block)}"][data-img-index="${d.index}"]`
      : `.blk[data-block="${CSS.escape(d.block)}"]`;
  return page.querySelector(sel)?.getBoundingClientRect() ?? null;
}

function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

// ——— Shown large ———

/** The viewer or the crop, over the page; mounted once with the page's blocks. */
export function ImageDialogs() {
  const s = useSyncExternalStore(watch, () => shownNow);
  const doc = useEditing();
  const blocks = doc?.spec.blocks ?? [];
  if (!s) return null;
  const all = imagesOf(blocks);
  const here = all.find((i) => i.at.block === s.at.block && i.at.index === s.at.index);
  if (!here) return <Closer />;
  if (s.mode === "crop")
    return (
      <CropEditor
        key={`${s.at.block}:${s.at.index}`}
        at={s.at}
        shown={here.shown}
        done={() => showImage(s.back ? { ...s, mode: "view" } : null)}
      />
    );
  const list = all.filter((i) => i === here || IMAGE.test(i.shown.name));
  return <Viewer list={list} at={list.indexOf(here)} />;
}

/** An image that is no more (an undo while it was shown) closes what showed it. */
function Closer() {
  useEffect(() => showImage(null), []);
  return null;
}

/** The focus given back where it was when a dialog closes. */
function useFocusBack() {
  useLayoutEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    return () => {
      if (was?.isConnected) was.focus({ preventScroll: true });
    };
  }, []);
}

/**
 * Keys a dialog takes for itself while the focus is in it (and nothing else: Boni's own shortcuts go on working, and
 * a box of Boni's opened over it, its search, keeps its own Esc).
 */
function useKeys(
  dialog: { current: HTMLElement | null },
  keys: Record<string, (e: KeyboardEvent) => void>,
) {
  const now = useRef(keys);
  now.current = keys;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const f = now.current[e.key];
      if (!f || e.ctrlKey || e.metaKey || e.altKey) return;
      const at = document.activeElement;
      if (at && at !== document.body && !dialog.current?.contains(at)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      f(e);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);
}

function Viewer({ list, at }: { list: { at: ImageAt; shown: FileShown }[]; at: number }) {
  const t = useStore((s) => s.t);
  const item = list[at] as { at: ImageAt; shown: FileShown };
  const file = useResolved(item.shown.file, item.shown.name);
  const close = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const self = useRef<HTMLDivElement>(null);
  useFocusBack();
  useEffect(() => close.current?.focus({ preventScroll: true }), []);
  const go = (by: number) => {
    const next = list[(at + by + list.length) % list.length];
    if (next && list.length > 1) viewImage(next.at);
  };
  useKeys(self, {
    Escape: () => showImage(null),
    ArrowLeft: () => go(-1),
    ArrowRight: () => go(1),
  });
  const name = (file && file !== "gone" && file.name) || item.shown.name;
  return createPortal(
    <div
      ref={self}
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={t("image.viewer")}
      onClick={(e) => {
        if (e.target === e.currentTarget) showImage(null);
      }}
      onTouchStart={(e) => {
        const p = e.touches[0];
        swipe.current = p ? { x: p.clientX, y: p.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const p = e.changedTouches[0];
        const s = swipe.current;
        swipe.current = null;
        if (!p || !s) return;
        const dx = p.clientX - s.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(p.clientY - s.y)) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="image-viewer-bar">
        <span className="image-viewer-name">{name}</span>
        {list.length > 1 && (
          <span className="muted">{t("image.count", { n: at + 1, total: list.length })}</span>
        )}
        <span className="image-viewer-gap" />
        {file && file !== "gone" && file.url && (
          <button
            type="button"
            className="btn small"
            onClick={() => showImage({ at: item.at, mode: "crop", back: true })}
          >
            <CropIcon size={14} strokeWidth={1.8} aria-hidden="true" />
            {t("image.crop")}
          </button>
        )}
        <button
          ref={close}
          type="button"
          className="icon-btn"
          title={t("image.close")}
          aria-label={t("image.close")}
          onClick={() => showImage(null)}
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {list.length > 1 && (
        <button
          type="button"
          className="image-viewer-go prev"
          title={t("image.prev")}
          aria-label={t("image.prev")}
          onClick={() => go(-1)}
        >
          <ChevronLeft size={28} strokeWidth={1.6} aria-hidden="true" />
        </button>
      )}
      {file === "gone" ? (
        <p className="doc-gone">{t("file.missing")}</p>
      ) : file?.url ? (
        <img
          className="image-viewer-img"
          src={file.url}
          alt={name}
          draggable={false}
          style={viewBox(item.shown.crop)}
        />
      ) : (
        <span className="doc-img-wait" />
      )}
      {list.length > 1 && (
        <button
          type="button"
          className="image-viewer-go next"
          title={t("image.next")}
          aria-label={t("image.next")}
          onClick={() => go(1)}
        >
          <ChevronRight size={28} strokeWidth={1.6} aria-hidden="true" />
        </button>
      )}
    </div>,
    document.body,
  );
}

// ——— Cropped: a box over the whole image; the file stays as it is ———

const WHOLE: Crop = { x: 0, y: 0, w: 100, h: 100 };

function CropEditor({ at, shown, done }: { at: ImageAt; shown: FileShown; done: () => void }) {
  const t = useStore((s) => s.t);
  const file = useResolved(shown.file, shown.name);
  const [box, setBox] = useState<Crop>(shown.crop ?? WHOLE);
  const stage = useRef<HTMLDivElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const self = useRef<HTMLDivElement>(null);
  useFocusBack();
  useEffect(() => ok.current?.focus({ preventScroll: true }), []);
  const save = () => {
    const blocks = editingDoc()?.spec.blocks ?? [];
    put(withImage(blocks, at, cropped(tidyCrop(box) ?? undefined)));
    done();
  };
  const nudge = (dx: number, dy: number) => (e: KeyboardEvent) => {
    const by = e.shiftKey ? 10 : 1;
    setBox((b) => ({
      ...b,
      x: Math.min(100 - b.w, Math.max(0, b.x + dx * by)),
      y: Math.min(100 - b.h, Math.max(0, b.y + dy * by)),
    }));
  };
  useKeys(self, {
    Escape: done,
    Enter: save,
    ArrowLeft: nudge(-1, 0),
    ArrowRight: nudge(1, 0),
    ArrowUp: nudge(0, -1),
    ArrowDown: nudge(0, 1),
  });
  const grab = (e: React.PointerEvent, part: "move" | "nw" | "ne" | "sw" | "se") => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const from = box;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - x0) / r.width) * 100;
      const dy = ((ev.clientY - y0) / r.height) * 100;
      setBox(reshaped(from, part, dx, dy));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const name = (file && file !== "gone" && file.name) || shown.name;
  return createPortal(
    <div
      ref={self}
      className="image-viewer image-crop"
      role="dialog"
      aria-modal="true"
      aria-label={t("image.cropTitle", { name })}
    >
      <div className="image-viewer-bar">
        <span className="image-viewer-name">{t("image.cropTitle", { name })}</span>
        <span className="image-viewer-gap" />
        <button type="button" className="btn small" onClick={() => setBox(WHOLE)}>
          {t("image.cropReset")}
        </button>
        <button type="button" className="btn small" onClick={done}>
          {t("image.cropCancel")}
        </button>
        <button ref={ok} type="button" className="btn small primary" onClick={save}>
          {t("image.cropDone")}
        </button>
      </div>
      {file && file !== "gone" && file.url ? (
        <div ref={stage} className="image-crop-stage">
          <img src={file.url} alt={name} draggable={false} />
          <div
            className="image-crop-box"
            role="group"
            aria-label={t("image.cropHelp")}
            style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
            onPointerDown={(e) => grab(e, "move")}
          >
            {(["nw", "ne", "sw", "se"] as const).map((c) => (
              <span
                key={c}
                className={`image-crop-corner ${c}`}
                onPointerDown={(e) => grab(e, c)}
              />
            ))}
          </div>
        </div>
      ) : (
        <span className="doc-img-wait" />
      )}
      <p className="image-crop-help muted">{t("image.cropHelp")}</p>
    </div>,
    document.body,
  );
}
