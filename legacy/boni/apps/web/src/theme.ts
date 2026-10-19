import { useEffect } from "react";
import { useStore } from "./store.ts";

/** Applies the theme (system, dark or light) to the page; dark is Boni's default, as in Boni Calendar. */
export function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  const lang = useStore((s) => s.settings.language);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => {
      const light = theme === "light" || (theme === "system" && Boolean(media?.matches));
      document.documentElement.dataset.theme = light ? "light" : "dark";
    };
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}
