/**
 * An action's icon (docs/sistema.md §4.1): each action names its own in its definition on the server (`ToolDef.icon`,
 * a lucide-react icon's name), and «Buscar», «Añadir paso» and a turn's steps show it by that name. This file only
 * turns a name into its drawing: which icon an action has is never written here (`actions.test.ts` holds every
 * action's icon to this list).
 */
import {
  ArrowDownToLine,
  ArrowRightLeft,
  Bell,
  BellRing,
  BookCheck,
  BookOpen,
  Brain,
  Calculator,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  Check,
  CheckCheck,
  ClipboardCheck,
  Code,
  Columns3,
  Database,
  Eraser,
  ExternalLink,
  Eye,
  FilePlus,
  FileText,
  FlaskConical,
  FolderInput,
  FolderPlus,
  FolderX,
  FoldVertical,
  Funnel,
  Gauge,
  Highlighter,
  Inbox,
  Lightbulb,
  Link,
  ListChecks,
  ListFilter,
  ListTree,
  type LucideIcon,
  Mail,
  MailCheck,
  MailPlus,
  Palette,
  Paperclip,
  Pencil,
  PencilLine,
  PenLine,
  Play,
  Plus,
  Power,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Scale,
  Search,
  Settings2,
  Sigma,
  SlidersHorizontal,
  Split,
  SquarePlus,
  Table,
  Trash,
  Type,
  UserCheck,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { agentApi } from "../store.ts";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  ArrowDownToLine,
  ArrowRightLeft,
  Bell,
  BellRing,
  BookCheck,
  BookOpen,
  Brain,
  Calculator,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  Check,
  CheckCheck,
  ClipboardCheck,
  Code,
  Columns3,
  Database,
  Eraser,
  ExternalLink,
  Eye,
  FilePlus,
  FileText,
  FlaskConical,
  FoldVertical,
  FolderInput,
  FolderPlus,
  FolderX,
  Funnel,
  Gauge,
  Highlighter,
  Inbox,
  Lightbulb,
  Link,
  ListChecks,
  ListFilter,
  ListTree,
  Mail,
  MailCheck,
  MailPlus,
  Palette,
  Paperclip,
  PenLine,
  Pencil,
  PencilLine,
  Play,
  Plus,
  Power,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Scale,
  Search,
  Settings2,
  Sigma,
  SlidersHorizontal,
  Split,
  SquarePlus,
  Table,
  Trash,
  Type,
  UserCheck,
  Workflow,
  X,
};

/** An action's icon by the name its definition gives; nothing for a name this app does not draw. */
export function ActionIcon({
  name,
  size = 14,
}: {
  name: string | null | undefined;
  size?: number;
}) {
  const Icon = name ? ICONS[name] : undefined;
  return Icon ? <Icon size={size} strokeWidth={1.8} aria-hidden /> : null;
}

let asked: Promise<Record<string, string>> | null = null;
/** Each action's icon by the action's name, asked of the server once (`GET /api/agent/actions`). */
export function useActionIcons(): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    asked ??= agentApi.actionIcons().catch(() => {
      asked = null;
      return {};
    });
    let live = true;
    void asked.then((x) => live && setIcons(x));
    return () => {
      live = false;
    };
  }, []);
  return icons;
}
