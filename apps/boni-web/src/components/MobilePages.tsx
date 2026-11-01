// The phone's «Páginas» tab (Juan, 2026-10-30): one's data on the phone, as lists for a finger.
import { useStore } from "../store.ts";
import { MobileLibrary, MobileList } from "./MobileLists.tsx";
import { PageView } from "./PageView.tsx";
import { RowView } from "./RowView.tsx";

/**
 * The phone's «Páginas» (Juan, 2026-10-30: «no me aparece ninguna sección para ver mis datos»): the search, his pages
 * and his collections as grouped lists; a collection opens as a list of its records (a table does not fit a phone), a
 * record or a page to read first, its properties as chips. Back goes a step at a time.
 */
export function MobilePages() {
  const view = useStore((s) => s.view);
  if (view.kind === "collection") return <MobileList type={view.type} />;
  if (view.kind === "row")
    return (
      <div className="m-scroll m-row">
        <RowView mobile />
      </div>
    );
  if (view.kind === "page")
    return (
      <div className="m-scroll m-row">
        <PageView />
      </div>
    );
  return <MobileLibrary />;
}
