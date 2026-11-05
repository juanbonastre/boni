/**
 * «Mis datos»: the page of Boni's collection of the user's pages and collections (docs/flujos.md §4.7, F6b), laid out
 * as any collection's page, with what the collections take below.
 */
import { DATABASE_LAYOUTS, type DatabaseView, SYS } from "@boni/views";
import { useEffect } from "react";
import { loadDataTypes, useStore, useViews } from "../store.ts";
import { CollectionsUsage } from "./Collections.tsx";
import { DatabaseBlock } from "./DatabaseBlock.tsx";

const MY_DATA = SYS.data.id;
/** Before its views were kept in the account (task 69), the device kept one: what its first view starts as. */
const OLD_VIEW_KEY = "boni:myDataView";
const OLD_MODE_KEY = "boni:dataMode";
const DEFAULT_VIEW: DatabaseView = { layout: "table", hide: [SYS.data.origin] };

function firstView(): DatabaseView {
  try {
    const v = JSON.parse(localStorage.getItem(OLD_VIEW_KEY) ?? "null") as DatabaseView | null;
    if (v && (DATABASE_LAYOUTS as readonly string[]).includes(v.layout)) return v;
    if (localStorage.getItem(OLD_MODE_KEY) === "diagram")
      return { ...DEFAULT_VIEW, layout: "diagram" };
  } catch {}
  return DEFAULT_VIEW;
}

/**
 * «Mis datos» (Juan, 2026-11-05: «que la sección se comportase como una página de colección»; docs/flujos.md §4.7,
 * F6b): the page of Boni's collection of the user's pages and collections (apps/server myData.ts), with what any
 * collection's page has: its views as tabs (task 69; the diagram is one of their layouts), the bar of order and
 * filters, the columns and «Nuevo». A row opens what it is; its name, mother, level and eye change in place, as on its
 * own page. Below, what the collections take (`CollectionsUsage`).
 */
export function AllPagesView() {
  const t = useStore((s) => s.t);
  const views = useViews(MY_DATA, firstView());
  useEffect(() => {
    void loadDataTypes();
  }, []);
  return (
    <div className="content page-doc full is-collection my-data">
      <div className="doc">
        <h1 className="cols-title">{t("nav.notes")}</h1>
        <DatabaseBlock
          source={MY_DATA}
          view={views.view}
          named={false}
          onView={views.onView}
          views={views.control}
        />
        <CollectionsUsage />
      </div>
    </div>
  );
}
