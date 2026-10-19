import { frontmatterData, patchDefinitionReminders } from "@boni/calendar";
import type { VaultBridge } from "../vaultBridge.ts";
import { DEFINITIONS_DIR } from "./loadVault.ts";
import { VaultWriteError } from "./provider.ts";
import { withLock } from "./sync.ts";

/** The column added to a definition the first time an event gets reminders of its own. */
export const EVENT_REMINDERS_COLUMN = { id: "avisos", name: "Avisos" };

/**
 * Changes the reminders of a collection in its definition note (`_system/colecciones/`), only those
 * lines: the calendar's defaults (`null`: none) and, if asked, the column for an event's own reminders.
 * Never over a definition that changed meanwhile (`VaultWriteError` conflict).
 */
export function patchCollectionReminders(
  bridge: VaultBridge,
  collectionId: string,
  edit: { reminders?: { timed: string; allDay: string } | null; eventColumn?: boolean },
): Promise<void> {
  return withLock(async () => {
    const found = await bridge.scan(DEFINITIONS_DIR);
    if (!found.ok) throw new VaultWriteError("failed", found.message);
    for (const n of found.value) {
      const r = await bridge.read(n.path);
      if (!r.ok) continue;
      const fm = frontmatterData(r.value.text);
      if ("error" in fm) continue;
      const coll = fm.data.collection as { id?: unknown } | undefined;
      if (coll?.id !== collectionId) continue;
      const next = patchDefinitionReminders(r.value.text, {
        ...(edit.reminders !== undefined ? { reminders: edit.reminders } : {}),
        ...(edit.eventColumn ? { eventColumn: EVENT_REMINDERS_COLUMN } : {}),
      });
      if (next === r.value.text) return;
      const w = await bridge.write(n.path, next, r.value.mtimeMs);
      if (!w.ok) throw new VaultWriteError("failed", w.message);
      if (w.value.conflict) throw new VaultWriteError("conflict", n.path);
      return;
    }
    throw new VaultWriteError("failed", `no definition for "${collectionId}"`);
  });
}
