/**
 * Each step type's icon, for the canvas's cards, the panel «Añadir un paso» and the step's view: the catalogue has
 * ids and no drawings (`@boni/automations` depends on no app).
 */
import {
  ArrowUpDown,
  Bot,
  Braces,
  CalendarDays,
  Combine,
  CopyMinus,
  Database,
  GitFork,
  Group,
  ListEnd,
  ListFilter,
  type LucideIcon,
  Merge,
  MousePointerClick,
  OctagonX,
  PencilLine,
  Signpost,
  Split,
  Workflow,
} from "lucide-react";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  manual: MousePointerClick,
  collection: Database,
  edit: PencilLine,
  filter: ListFilter,
  sort: ArrowUpDown,
  limit: ListEnd,
  dedupe: CopyMinus,
  group: Group,
  split: Split,
  join: Merge,
  date: CalendarDays,
  combine: Combine,
  if: GitFork,
  switch: Signpost,
  stop: OctagonX,
  code: Braces,
  agent: Bot,
};

export const iconOf = (type: string): LucideIcon => ICONS[type] ?? Workflow;
