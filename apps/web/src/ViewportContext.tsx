import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { Viewport } from "./engine/viewport.ts";

const Ctx = createContext<Viewport | null>(null);

export function ViewportProvider({ children }: { children: ReactNode }) {
  const vp = useMemo(() => new Viewport(), []);
  useEffect(() => () => vp.dispose(), [vp]);
  return <Ctx.Provider value={vp}>{children}</Ctx.Provider>;
}

export function useViewport(): Viewport {
  const vp = useContext(Ctx);
  if (!vp) throw new Error("ViewportProvider missing");
  return vp;
}
