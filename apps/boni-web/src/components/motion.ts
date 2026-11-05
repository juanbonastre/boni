// What enters rises into place (docs/design-guide.md 4b «Motion», I-14): a hook that lets the same node start its entry again when what it shows changes.
import { useRef } from "react";

/**
 * Alternates "a" and "b" each time `key` changes: the CSS gives each value the same entry animation under another
 * name, so the node starts it again without being made anew (a page shown in place of another in the main area).
 * `same(from, to)` says when a new key is still what was shown (a new page taking its id from the server): no flip.
 */
export function useEnterFlip(key: string, same?: (from: string, to: string) => boolean): "a" | "b" {
  const ref = useRef<{ key: string; flip: "a" | "b" }>({ key, flip: "a" });
  if (ref.current.key !== key)
    ref.current = {
      key,
      flip: same?.(ref.current.key, key) ? ref.current.flip : ref.current.flip === "a" ? "b" : "a",
    };
  return ref.current.flip;
}
