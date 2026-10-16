import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostStorage } from "./host.ts";
import { memoryVault } from "./vault/testing.ts";

/** The store reads the host when it is first imported, so every test starts from fresh modules. */
async function fresh() {
  vi.resetModules();
  return import("./host.ts");
}

function memoryStorage(
  seed: Record<string, string> = {},
): HostStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("host", () => {
  it("gives the store the host's bridge, storage and starting settings", async () => {
    const host = await fresh();
    const storage = memoryStorage();
    const { bridge } = memoryVault({});
    host.setHost({
      vault: bridge,
      storage,
      keys: "root",
      settings: { dataSource: "vault", vaultWrite: true },
    });
    const { vaultBridge } = await import("./vaultBridge.ts");
    const { useApp } = await import("./store.ts");
    expect(vaultBridge()).toBe(bridge);
    const s = useApp.getState();
    expect(s.settings.dataSource).toBe("vault");
    expect(s.settings.vaultWrite).toBe(true);
    expect(s.source).toBe("vault");
    s.setSettings({ h24: false });
    expect(JSON.parse(storage.data.get("boni-calendar:settings") ?? "{}")).toMatchObject({
      h24: false,
      vaultWrite: true,
    });
  });

  it("lets what the user saved win over the host's starting settings", async () => {
    const host = await fresh();
    host.setHost({
      vault: null,
      storage: memoryStorage({ "boni-calendar:settings": JSON.stringify({ vaultWrite: false }) }),
      keys: "window",
      settings: { vaultWrite: true },
    });
    const { useApp } = await import("./store.ts");
    expect(useApp.getState().settings.vaultWrite).toBe(false);
  });

  it("listens for keys on the window, or only inside the app's root when it shares the window", async () => {
    const host = await fresh();
    const root = document.createElement("div");
    const outside = document.createElement("input");
    const inside = document.createElement("button");
    root.append(inside);
    document.body.append(root, outside);
    host.setAppRoot(root);
    const seen: string[] = [];
    const press = (el: HTMLElement, key: string) =>
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    host.setHost({ vault: null, storage: memoryStorage(), keys: "window" });
    let off = host.onKeys((e) => seen.push(e.key));
    press(outside, "a");
    press(inside, "b");
    off();

    host.setHost({ vault: null, storage: memoryStorage(), keys: "root" });
    off = host.onKeys((e) => seen.push(e.key));
    press(outside, "c");
    press(inside, "d");
    off();
    expect(seen).toEqual(["a", "b", "d"]);
  });

  it("finds what an event started on inside a shadow root", async () => {
    const host = await fresh();
    const shell = document.createElement("div");
    document.body.append(shell);
    const shadow = shell.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    shadow.append(button);
    // (A browser reports the shadow host as `target` here; the e2e embed test covers that.)
    let target: HTMLElement | null = null;
    const listen = (e: Event) => {
      target = host.eventTarget(e);
    };
    window.addEventListener("pointerdown", listen);
    button.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    window.removeEventListener("pointerdown", listen);
    expect(target).toBe(button);
  });
});
