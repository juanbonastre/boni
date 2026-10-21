import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { Viewport } from "./engine/viewport.ts";

const Ctx = createContext<Viewport | null>(null);

export function ViewportProvider({ children }: { children: ReactNode }) {
  // "Reduce motion" (the system's setting): jumps and zooms land at once instead of gliding.
  const vp = useMemo(
    () =>
      new Viewport(
        typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
          ? { tauScroll: 1, tauZoom: 1, tauX: 1 }
          : {},
      ),
    [],
  );
  useEffect(() => () => vp.dispose(), [vp]);
  return <Ctx.Provider value={vp}>{children}</Ctx.Provider>;
}

export function useViewport(): Viewport {
  const vp = useContext(Ctx);
  if (!vp) throw new Error("ViewportProvider missing");
  return vp;
}
