import { type CivilDay, daysFromCivil, weekday } from "./time.ts";

export interface QuickContext {
  today: CivilDay;
  calendars: { id: string; name: string }[];
  defaultDuration: number;
}

export interface QuickEvent {
  title: string;
  day: CivilDay;
  allDay: boolean;
  /** Minutes since midnight; null when no time was given. */
  start: number | null;
  end: number | null;
  calendarId: string | null;
  /** True when the text contained a date (so it can also be used as "go to date"). */
  hasDate: boolean;
  /** Human tokens that were understood (for the preview chips). */
  matched: string[];
}

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  dom: 0,
  sunday: 0,
  sun: 0,
  lunes: 1,
  lun: 1,
  monday: 1,
  mon: 1,
  martes: 2,
  mar: 2,
  tuesday: 2,
  tue: 2,
  miercoles: 3,
  mie: 3,
  wednesday: 3,
  wed: 3,
  jueves: 4,
  jue: 4,
  thursday: 4,
  thu: 4,
  viernes: 5,
  vie: 5,
  friday: 5,
  fri: 5,
  sabado: 6,
  sab: 6,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  january: 1,
  jan: 1,
  febrero: 2,
  feb: 2,
  february: 2,
  marzo: 3,
  march: 3,
  abril: 4,
  abr: 4,
  april: 4,
  apr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  june: 6,
  julio: 7,
  jul: 7,
  july: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  septiembre: 9,
  sep: 9,
  sept: 9,
  september: 9,
  octubre: 10,
  oct: 10,
  october: 10,
  noviembre: 11,
  nov: 11,
  november: 11,
  diciembre: 12,
  dic: 12,
  december: 12,
  dec: 12,
};

function clock(h: string, m: string | undefined, suffix: string | undefined): number | null {
  let hh = Number(h);
  const mm = Number(m ?? 0);
  if (suffix === "pm" && hh < 12) hh += 12;
  if (suffix === "am" && hh === 12) hh = 0;
  if (hh > 24 || mm > 59 || (hh === 24 && mm > 0)) return null;
  return hh * 60 + mm;
}

/**
 * Parses "clase FUP mañana 10-12 #docencia" (Spanish or English) into an event draft. Only
 * unambiguous time forms are read: ranges (10-12, 10:30-11:45, de 10 a 12), "a las 5", "at 5pm",
 * and anything with a colon, an h suffix or am/pm. A bare number in the title stays in the title.
 */
export function parseQuickEvent(input: string, ctx: QuickContext): QuickEvent {
  let text = ` ${input.trim()} `;
  const matched: string[] = [];
  const take = (re: RegExp, label?: (m: RegExpMatchArray) => string): RegExpMatchArray | null => {
    const m = text.match(re);
    if (!m || m.index === undefined) return null;
    text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
    if (label) matched.push(label(m));
    return m;
  };

  // Calendar: #name (accent and case insensitive prefix match).
  let calendarId: string | null = null;
  const tag = take(/\s#([^\s#]+)/, (m) => `#${m[1]}`);
  if (tag?.[1]) {
    const q = norm(tag[1]);
    const hit =
      ctx.calendars.find((c) => norm(c.name) === q) ??
      ctx.calendars.find((c) => norm(c.name).startsWith(q));
    calendarId = hit?.id ?? null;
  }

  const allDay =
    take(/\s(todo el dia|todo el día|all day|all-day)(?=\s)/i, () => "todo el dia") !== null;

  // Date.
  let day = ctx.today;
  let hasDate = false;
  const lower = () => norm(text);
  const find = (words: string): RegExpMatchArray | null => {
    const m = lower().match(new RegExp(`\\s(${words})(?=\\s)`));
    return m;
  };
  const cut = (m: RegExpMatchArray, label: string) => {
    if (m.index === undefined) return;
    text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
    matched.push(label);
  };

  const after = find("pasado manana|day after tomorrow");
  if (after) {
    day = ctx.today + 2;
    hasDate = true;
    cut(after, "pasado manana");
  } else {
    const tom = find("manana|tomorrow");
    const tod = find("hoy|today");
    if (tom) {
      day = ctx.today + 1;
      hasDate = true;
      cut(tom, "manana");
    } else if (tod) {
      day = ctx.today;
      hasDate = true;
      cut(tod, "hoy");
    }
  }
  if (!hasDate) {
    const iso = text.match(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/);
    const dm = text.match(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/);
    const named = lower().match(
      new RegExp(`\\s(\\d{1,2})\\s+(?:de\\s+)?(${Object.keys(MONTHS).join("|")})(?=\\s)`),
    );
    if (iso?.index !== undefined) {
      day = daysFromCivil(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      hasDate = true;
      cut(iso, iso[0].trim());
    } else if (dm?.index !== undefined) {
      const ty = civilYear(ctx.today);
      const yy = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : ty;
      day = daysFromCivil(yy, Number(dm[2]), Number(dm[1]));
      if (!dm[3] && day < ctx.today) day = daysFromCivil(yy + 1, Number(dm[2]), Number(dm[1]));
      hasDate = true;
      cut(dm, dm[0].trim());
    } else if (named?.[2] && MONTHS[named[2]]) {
      const ty = civilYear(ctx.today);
      day = daysFromCivil(ty, MONTHS[named[2]] ?? 1, Number(named[1]));
      if (day < ctx.today) day = daysFromCivil(ty + 1, MONTHS[named[2]] ?? 1, Number(named[1]));
      hasDate = true;
      cut(named, `${named[1]} ${named[2]}`);
    } else {
      const wd = lower().match(
        new RegExp(
          `\\s(?:el\\s+|on\\s+|next\\s+|proximo\\s+)?(${Object.keys(WEEKDAYS).join("|")})(?=\\s)`,
        ),
      );
      if (wd?.[1] && WEEKDAYS[wd[1]] !== undefined) {
        const target = WEEKDAYS[wd[1]] ?? 0;
        const diff = ((target - weekday(ctx.today) + 6) % 7) + 1; // strictly after today
        day = ctx.today + diff;
        hasDate = true;
        cut(wd, wd[1]);
      }
    }
  }

  // Time.
  let start: number | null = null;
  let end: number | null = null;
  const T = "(\\d{1,2})(?:[:.h](\\d{2}))?\\s*(am|pm)?h?";
  const range = take(
    new RegExp(`\\s(?:de\\s+|from\\s+)?${T}\\s*(?:-|–|a|to|hasta)\\s*${T}(?=\\s)`, "i"),
    (m) => m[0].trim(),
  );
  if (range) {
    const [, h1, m1, s1, h2, m2, s2] = range;
    const rawEnd = h2 ?? "";
    const suffixShared = s2 ?? s1;
    start = clock(
      h1 ?? "",
      m1,
      s1 ?? (s2 && Number(h1) < 12 && Number(h1) < Number(rawEnd) ? s2 : undefined),
    );
    end = clock(rawEnd, m2, suffixShared);
    if (start === null || end === null) {
      start = end = null;
    } else if (end <= start) {
      end = Math.min(1440, end + 12 * 60 > 1440 ? end : end + 12 * 60);
      if (end <= start) end = start + ctx.defaultDuration;
    }
  } else {
    const single =
      take(/\s(?:a las|a la|at|@)\s*(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?h?(?=\s)/i, (m) =>
        m[0].trim(),
      ) ??
      take(/\s(\d{1,2})[:.](\d{2})\s*(am|pm)?(?=\s)/i, (m) => m[0].trim()) ??
      take(/\s(\d{1,2})\s*(am|pm)(?=\s)/i, (m) => m[0].trim());
    if (single) {
      const withMin = single[2] !== undefined && /^\d{2}$/.test(single[2]);
      const suffix = (withMin ? single[3] : (single[2] ?? single[3]))?.toLowerCase();
      start = clock(
        single[1] ?? "",
        withMin ? single[2] : undefined,
        suffix === "am" || suffix === "pm" ? suffix : undefined,
      );
      if (start !== null) end = Math.min(1440, start + ctx.defaultDuration);
    }
  }

  const title = text.replace(/\s+/g, " ").trim();
  return { title, day, allDay, start, end, calendarId, hasDate, matched };
}

function civilYear(day: CivilDay): number {
  return new Date(day * 86_400_000).getUTCFullYear();
}
