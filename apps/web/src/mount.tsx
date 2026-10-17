import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { type Host, setAppRoot, setHost } from "./host.ts";

/**
 * Mounts the calendar in `container` for a host. The container becomes the app's root: it carries
 * the `boni` class (the CSS is scoped under it), the theme and the language. The clock must be set
 * before this runs, since the store reads it (and the host) when it is first imported.
 */
export async function mountApp(container: HTMLElement, host: Host): Promise<{ unmount(): void }> {
  setHost(host);
  setAppRoot(container);
  container.classList.add("boni");
  // Sharing the window: the root takes the focus when clicked, so the shortcuts know it is ours.
  if (host.keys === "root") container.tabIndex = -1;
  const [{ App }, { ViewportProvider }, { useApp }, { stopWatchingVault }] = await Promise.all([
    import("./App.tsx"),
    import("./ViewportContext.tsx"),
    import("./store.ts"),
    import("./vault/sync.ts"),
  ]);
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ViewportProvider>
        <App />
      </ViewportProvider>
    </StrictMode>,
  );
  const app = useApp.getState();
  if (app.source === "server") void app.loadServer();
  else if (app.source === "vault") void app.loadVault();
  return {
    unmount() {
      stopWatchingVault(host.vault);
      root.unmount();
      container.classList.remove("boni");
      setAppRoot(null);
    },
  };
}
