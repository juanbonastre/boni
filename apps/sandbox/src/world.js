// The world an automation's JavaScript runs in, inside the box's QuickJS (docs/automatizaciones.md §5.3, §5.4; loaded
// by evaluate.ts into each new interpreter): what the code may name (`$json`, `$input`, `$`, `$col`, `$now`, `$today`,
// `$run`, `$page`, `$date`, `console`), the request's clock and chance, the dates' help, a world frozen whole before
// the first row and the data copied for each evaluation, so one row's evaluation cannot leave anything to the next
// (AU-37). This script's value is the
// function evaluate.ts calls with the request and the four functions of the host; nothing of it stays on `globalThis`.
// It is plain JavaScript because it runs inside the interpreter, never in Node.
(function setup(text, hostLog, hostRead, hostHalt, hostPut) {
  const req = JSON.parse(text);
  const { kind, mode, sources, bodies, escaped, from, now, zone, names, seed, limits } = req;
  const isCode = kind === "code";

  // What the code may change, and so what one evaluation may leave to another, is decided here, by two functions side
  // by side (AU-37). The rows that reach the step are the code's: `listOf` gives each evaluation its own copy of them,
  // which it may change (Juan, 2026-11-16). Everything else is looked at and never changed: `received` freezes what
  // the interpreter brings, what the world makes for the code (`$input`, `$('…')`, `$col('…')`, `$run`, the dates,
  // `console`, the global object), the rows of the steps it cites and what it reads, with their prototypes,
  // accessors and what they hold; a write to them fails with `frozen`, and `COPY` is what its message adds. It skips
  // what is already frozen: only `received` freezes here, and it freezes all it reaches. The rows that reach the step
  // are frozen too, so the copies are made from what arrived, but the code never sees them but through `listOf`.
  const freeze = Object.freeze;
  const isFrozen = Object.isFrozen;
  const received = (...roots) => {
    const todo = roots.slice();
    while (todo.length) {
      const o = todo.pop();
      if (o === null || (typeof o !== "object" && typeof o !== "function") || isFrozen(o)) continue;
      freeze(o);
      todo.push(Object.getPrototypeOf(o));
      const all = Object.getOwnPropertyDescriptors(o);
      for (const k of Reflect.ownKeys(all)) {
        const d = all[k];
        if ("value" in d) todo.push(d.value);
        else todo.push(d.get, d.set);
      }
    }
    return roots[0];
  };
  /** How a write to what `received` froze is told: the interpreter's words, and these. */
  const FROZEN =
    /is read-only|not extensible|could not delete|cannot define property|non-configurable|not configurable/;
  const COPY =
    "solo se cambian las filas que llegan al paso; lo demás (otros pasos, lo leído, lo de JavaScript) se mira: haz una copia, como { ...fila }, y cambia esa";
  /**
   * A frozen prototype makes `row.toString = …` fail on an object of the code's own (the "override mistake"): its
   * writable properties become a getter and a setter that gives the object a property of its own, as before.
   */
  const ownOnAssign = (proto, keys) => {
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(proto, key);
      if (!d || !("value" in d) || !d.writable || !d.configurable) continue;
      const value = d.value;
      Object.defineProperty(proto, key, {
        get() {
          return value;
        },
        set(v) {
          if (this === proto) throw new TypeError(`'${String(key)}' is read-only`);
          Object.defineProperty(this, key, {
            value: v,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        },
        enumerable: d.enumerable,
        configurable: false,
      });
    }
  };

  // Before anything is frozen: the interpreter's writable properties that code's own objects assign.
  ownOnAssign(Object.prototype, Reflect.ownKeys(Object.prototype));
  for (const E of [
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    EvalError,
    URIError,
    globalThis.InternalError,
    globalThis.AggregateError,
  ])
    if (E) ownOnAssign(E.prototype, ["name", "message", "toString", "constructor"]);
  ownOnAssign(Function.prototype, ["toString", "constructor"]);
  ownOnAssign(Array.prototype, ["constructor", "toString"]);

  // Frozen with the rest, before the first row (below): nothing reads them until then, and the input only through
  // `listOf`.
  const input = req.input;
  const steps = req.steps;
  /**
   * The evaluation's own copy of the rows that reach the step: made place by place, the first time the evaluation
   * touches a row, the same object every time after, and never seen by another evaluation. `$json` is `$input.item`
   * and `$input.all()[i]`. The rows are JSON: a row is copied by the interpreter's own spread (a key `__proto__` stays a
   * key), and what it holds that is an object by `mine`. A list that is never looked at whole is never copied whole:
   * `$input.all().length` copies nothing.
   */
  /** The evaluation's copies, made when it first copies something: an evaluation that copies nothing pays nothing. */
  let copies = null;
  let lists = null;
  /** The current row's copy, once `$json` or `$input.item` has asked for it (`$json` in a loop asks for it often). */
  let current = null;
  const currentRow = () => {
    if (current === null) current = { row: listOf(input).copyOf(row) };
    return current.row;
  };
  /** Per datum, once per call (the data is frozen, so it holds): the keys of what it holds that are objects. */
  const inner = new Map();
  const NONE = freeze([]);
  const innerOf = (o) => {
    let ks = inner.get(o);
    if (ks === undefined) {
      ks = NONE;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (v === null || typeof v !== "object") continue;
        if (ks === NONE) ks = [];
        ks.push(k);
      }
      inner.set(o, ks);
    }
    return ks;
  };
  const mine = (o) => {
    if (o === null || typeof o !== "object") return o;
    if (Array.isArray(o)) return listOf(o).list;
    if (copies === null) copies = new Map();
    const known = copies.get(o);
    if (known !== undefined) return known;
    const out = { ...o };
    copies.set(o, out);
    for (const k of innerOf(o)) out[k] = mine(o[k]);
    return out;
  };
  /**
   * A list of the evaluation's own whose places are copied from `orig` when first touched: an ordinary array behind
   * a proxy that fills a place before anything looks at it, writes it or lists it. A place written, deleted or cut
   * off by `length` is the code's from then on, and is never filled again. `copyOf(i)` is the copy of the i-th row
   * that arrived, wherever the code has moved it: what `$json` and `$input.item` give.
   */
  const listOf = (orig) => {
    if (lists === null) lists = new Map();
    const known = lists.get(orig);
    if (known !== undefined) return known;
    const n = orig.length;
    const target = new Array(n);
    const done = new Uint8Array(n);
    const made = new Array(n);
    const copyOf = (i) => {
      let c = made[i];
      if (c === undefined && i < n) {
        const o = orig[i];
        c =
          o !== null && typeof o === "object" && !Array.isArray(o) && innerOf(o) === NONE
            ? { ...o }
            : mine(o);
        made[i] = c;
      }
      return c;
    };
    const fillAt = (i) => {
      if (!(i < n)) return;
      done[i] = 1;
      if (i < target.length) target[i] = copyOf(i);
    };
    const list = new Proxy(target, {
      get(t, k, r) {
        if (done[k] === 0) fillAt(+k);
        return Reflect.get(t, k, r);
      },
      has(t, k) {
        if (done[k] === 0) fillAt(+k);
        return Reflect.has(t, k);
      },
      getOwnPropertyDescriptor(t, k) {
        if (done[k] === 0) fillAt(+k);
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
      defineProperty(t, k, d) {
        if (done[k] === 0) fillAt(+k);
        const ok = Reflect.defineProperty(t, k, d);
        if (k === "length") for (let i = t.length; i < n; i++) done[i] = 1;
        return ok;
      },
      deleteProperty(t, k) {
        if (done[k] === 0) fillAt(+k);
        return Reflect.deleteProperty(t, k);
      },
      ownKeys(t) {
        for (let i = 0; i < n; i++) if (done[i] === 0) fillAt(i);
        return Reflect.ownKeys(t);
      },
      preventExtensions(t) {
        for (let i = 0; i < n; i++) if (done[i] === 0) fillAt(i);
        return Reflect.preventExtensions(t);
      },
    });
    const out = { list, copyOf };
    lists.set(orig, out);
    return out;
  };
  /** The input's row being evaluated, or -1 (a «Código» with all the rows, or between rows). */
  let row = -1;
  /** Per evaluation: whether it read the clock or chance, the reads it asked for, and its own sequence of chance. */
  let readClock = false;
  let readRandom = false;
  const asked = new Set();
  /** Per evaluation: what it asked to save, each as JSON text, in the order of the calls (AU-172, AU-173). */
  let requests = [];
  let state = 0;

  // ------------------------------------------------------------------ the clock and chance (AU-34)
  const mix = (x) => {
    let h = x | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  /** A row's chance comes from the seed and the row's place only: alone or in a batch, it is the same. */
  const seedFor = (place) => mix((seed >>> 0) ^ mix(place + 0x9e3779b9));
  Math.random = function random() {
    readRandom = true;
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const RealDate = Date;
  const clock = () => {
    readClock = true;
    return now;
  };
  /** `Date` with the run's instant for "now": `Date.now()`, `new Date()` and `Date()`. */
  // Named `Date` so that `Date.name` and an error's text say what the code wrote.
  // biome-ignore lint/suspicious/noShadowRestrictedNames: it is the box's `Date`, put in the global's place on purpose
  const BoxDate = function Date(...args) {
    if (new.target === undefined) return new RealDate(clock()).toString();
    return Reflect.construct(RealDate, args.length ? args : [clock()], new.target);
  };
  Object.defineProperty(BoxDate, "length", { value: 7 });
  BoxDate.prototype = RealDate.prototype;
  Object.defineProperty(RealDate.prototype, "constructor", {
    value: BoxDate,
    writable: true,
    configurable: true,
  });
  BoxDate.now = function now() {
    return clock();
  };
  BoxDate.parse = RealDate.parse;
  BoxDate.UTC = RealDate.UTC;
  globalThis.Date = BoxDate;
  // What would let one evaluation see the machine's clock or memory, or wait: not here.
  for (const k of ["WeakRef", "FinalizationRegistry", "SharedArrayBuffer", "Atomics"])
    delete globalThis[k];

  // ------------------------------------------------------------------ dates (AU-28): time.ts's math, the zone's table
  const MS_MIN = 60000;
  const MS_HOUR = 3600000;
  const MS_DAY = 86400000;
  const daysFromCivil = (y, m, d) => {
    const yy = m <= 2 ? y - 1 : y;
    const era = Math.floor(yy / 400);
    const yoe = yy - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  };
  const civilFromDays = (day) => {
    const z = day + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor(
      (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
    );
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp < 10 ? mp + 3 : mp - 9;
    return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
  };
  const daysInMonth = (y, m) =>
    m === 2
      ? y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(m)
        ? 30
        : 31;
  const addMonths = (day, delta) => {
    const { y, m, d } = civilFromDays(day);
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (((total % 12) + 12) % 12) + 1;
    return daysFromCivil(ny, nm, Math.min(d, daysInMonth(ny, nm)));
  };
  /** 1 = Monday … 7 = Sunday. */
  const isoWeekday = (day) => ((((day + 3) % 7) + 7) % 7) + 1;
  const offsets = zone.offsets;
  /** The zone's offset at an instant, in ms: from its table; outside its years, the nearest end's. */
  const offsetAt = (ms) => {
    let lo = 0;
    let hi = offsets.length - 1;
    if (ms < offsets[0][0]) return offsets[0][1] * MS_MIN;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid][0] <= ms) lo = mid;
      else hi = mid - 1;
    }
    return offsets[lo][1] * MS_MIN;
  };
  const toLocal = (ms) => {
    const local = ms + offsetAt(ms);
    const day = Math.floor(local / MS_DAY);
    return { day, minute: (local - day * MS_DAY) / MS_MIN };
  };
  const fromLocal = (day, minute) => {
    const guess = day * MS_DAY + minute * MS_MIN;
    const first = guess - offsetAt(guess);
    return guess - offsetAt(first);
  };
  const pad = (n, w) => String(n).padStart(w, "0");
  const dayText = (day) => {
    const { y, m, d } = civilFromDays(day);
    return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
  };
  const UNITS = {
    minute: "minutes",
    minutes: "minutes",
    hour: "hours",
    hours: "hours",
    day: "days",
    days: "days",
    week: "weeks",
    weeks: "weeks",
    month: "months",
    months: "months",
    year: "years",
    years: "years",
  };
  const ORDER = ["years", "months", "weeks", "days", "hours", "minutes"];
  const unitOf = (u, what) => {
    const unit = typeof u === "string" ? UNITS[u] : undefined;
    if (!unit)
      throw new Error(
        `${what}: «${String(u)}» no es una unidad (days, weeks, months, years, hours, minutes)`,
      );
    return unit;
  };
  const PERIODS = {
    day: "day",
    days: "day",
    week: "week",
    weeks: "week",
    month: "month",
    months: "month",
    year: "year",
    years: "year",
  };
  const periodOf = (u, what) => {
    const p = typeof u === "string" ? PERIODS[u] : undefined;
    if (!p) throw new Error(`${what}: «${String(u)}» no es day, week, month ni year`);
    return p;
  };
  const TOKENS = [
    "yyyy",
    "yy",
    "MMMM",
    "MMM",
    "MM",
    "M",
    "dd",
    "d",
    "EEEE",
    "EEE",
    "HH",
    "H",
    "mm",
  ];

  /** A date of the help: a civil day, which stays a civil day, or an instant (epoch ms), seen in the run's zone. */
  class BoniDate {
    #day;
    #ms;
    constructor(day, ms) {
      this.#day = day;
      this.#ms = ms;
      received(this);
    }
    #local() {
      return this.#day !== null ? { day: this.#day, minute: 0 } : toLocal(this.#ms);
    }
    #with(day, ms) {
      return this.#day !== null ? new BoniDate(day, null) : new BoniDate(null, ms);
    }
    #add(amount, unit) {
      if (unit === "minutes" || unit === "hours") {
        const fixed = unit === "minutes" ? MS_MIN : MS_HOUR;
        if (this.#day === null) return new BoniDate(null, this.#ms + amount * fixed);
        return new BoniDate(toLocal(fromLocal(this.#day, 0) + amount * fixed).day, null);
      }
      const { day, minute } = this.#local();
      const moved =
        unit === "days"
          ? day + amount
          : unit === "weeks"
            ? day + amount * 7
            : addMonths(day, unit === "months" ? amount : amount * 12);
      return this.#with(moved, this.#day === null ? fromLocal(moved, minute) : null);
    }
    #move(by, sign, what) {
      if (by === null || typeof by !== "object")
        throw new Error(`${what}: espera un objeto, como { days: 7 }`);
      const amounts = {};
      for (const k of Object.keys(by)) {
        const unit = unitOf(k, what);
        const n = by[k];
        if (!Number.isInteger(n)) throw new Error(`${what}: ${k} no es un número entero`);
        amounts[unit] = (amounts[unit] ?? 0) + n * sign;
      }
      let out = this;
      for (const unit of ORDER) if (amounts[unit]) out = out.#add(amounts[unit], unit);
      return out;
    }
    plus(by) {
      return this.#move(by, 1, "plus");
    }
    minus(by) {
      return this.#move(by, -1, "minus");
    }
    #start(period) {
      const { day } = this.#local();
      const { y, m } = civilFromDays(day);
      return period === "day"
        ? day
        : period === "week"
          ? day - (isoWeekday(day) - 1)
          : period === "month"
            ? daysFromCivil(y, m, 1)
            : daysFromCivil(y, 1, 1);
    }
    startOf(unit) {
      const start = this.#start(periodOf(unit, "startOf"));
      return this.#with(start, this.#day === null ? fromLocal(start, 0) : null);
    }
    endOf(unit) {
      const period = periodOf(unit, "endOf");
      const start = this.#start(period);
      const next =
        period === "day"
          ? start + 1
          : period === "week"
            ? start + 7
            : addMonths(start, period === "month" ? 1 : 12);
      return this.#with(next - 1, this.#day === null ? fromLocal(next, 0) - 1 : null);
    }
    /** This minus `other`, in whole units, as «Fecha» counts them (serverDates.diff). */
    diff(other, unit) {
      if (!(other instanceof BoniDate)) other = $date(other);
      const u = unitOf(unit, "diff");
      if (u === "minutes" || u === "hours")
        return Math.trunc(
          (this.toMillis() - other.toMillis()) / (u === "minutes" ? MS_MIN : MS_HOUR),
        );
      const la = other.#local();
      const lb = this.#local();
      if (u === "days" || u === "weeks") {
        let days = lb.day - la.day;
        if (days > 0 && lb.minute < la.minute) days -= 1;
        if (days < 0 && lb.minute > la.minute) days += 1;
        return Math.trunc(u === "days" ? days : days / 7);
      }
      const ya = civilFromDays(la.day);
      const yb = civilFromDays(lb.day);
      let months = (yb.y - ya.y) * 12 + (yb.m - ya.m);
      const cmp = yb.d - ya.d || lb.minute - la.minute;
      if (months > 0 && cmp < 0) months -= 1;
      if (months < 0 && cmp > 0) months += 1;
      return Math.trunc(u === "months" ? months : months / 12);
    }
    get year() {
      return civilFromDays(this.#local().day).y;
    }
    get month() {
      return civilFromDays(this.#local().day).m;
    }
    get day() {
      return civilFromDays(this.#local().day).d;
    }
    get weekday() {
      return isoWeekday(this.#local().day);
    }
    get hour() {
      return Math.floor(this.#local().minute / 60);
    }
    get minute() {
      return Math.floor(this.#local().minute % 60);
    }
    /** The tokens of `DATE_HELP` and text: a run of one letter is a token, text between quotes is written as is. */
    format(pattern) {
      if (typeof pattern !== "string")
        throw new Error("format: espera un texto, como 'd MMMM yyyy'");
      const { day, minute } = this.#local();
      const { y, m, d } = civilFromDays(day);
      const wd = isoWeekday(day) - 1;
      const h = Math.floor(minute / 60);
      const values = {
        yyyy: pad(y, 4),
        yy: pad(((y % 100) + 100) % 100, 2),
        MMMM: names.months[m - 1],
        MMM: names.monthsShort[m - 1],
        MM: pad(m, 2),
        M: String(m),
        dd: pad(d, 2),
        d: String(d),
        EEEE: names.days[wd],
        EEE: names.daysShort[wd],
        HH: pad(h, 2),
        H: String(h),
        mm: pad(Math.floor(minute % 60), 2),
      };
      let out = "";
      for (let i = 0; i < pattern.length; ) {
        const c = pattern[i];
        if (c === "'") {
          const end = pattern.indexOf("'", i + 1);
          const stop = end < 0 ? pattern.length : end;
          out += stop === i + 1 ? "'" : pattern.slice(i + 1, stop);
          i = stop + 1;
        } else if (/[A-Za-z]/.test(c)) {
          let j = i;
          while (pattern[j] === c) j++;
          const token = pattern.slice(i, j);
          if (!TOKENS.includes(token))
            throw new Error(`format: «${token}» no es un patrón (${TOKENS.join(", ")})`);
          out += values[token];
          i = j;
        } else {
          out += c;
          i++;
        }
      }
      return out;
    }
    toISO() {
      return this.#day !== null ? dayText(this.#day) : new RealDate(this.#ms).toISOString();
    }
    toDay() {
      return dayText(this.#local().day);
    }
    toMillis() {
      return this.#day !== null ? fromLocal(this.#day, 0) : this.#ms;
    }
    /** As a row's value: its day, or its instant. */
    toJSON() {
      return this.#day !== null ? dayText(this.#day) : this.#ms;
    }
    valueOf() {
      return this.toMillis();
    }
    toString() {
      return this.toISO();
    }
  }
  const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;
  /** A date from a field's value: "YYYY-MM-DD", an instant in ms, or the ISO text of a date with its hour. */
  const $date = function $date(value) {
    if (value instanceof BoniDate) return value;
    if (typeof value === "number" && Number.isFinite(value)) return new BoniDate(null, value);
    if (typeof value === "string") {
      const c = CIVIL.exec(value);
      if (c) {
        const day = daysFromCivil(Number(c[1]), Number(c[2]), Number(c[3]));
        if (dayText(day) === value) return new BoniDate(day, null);
      } else if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
        const t = RealDate.parse(value);
        if (Number.isFinite(t)) return new BoniDate(null, t);
      }
    }
    throw new Error(
      `$date: «${String(value).slice(0, 40)}» no es una fecha ("YYYY-MM-DD" o un instante)`,
    );
  };

  // ------------------------------------------------------------------ what the code may name (AU-24)
  const LIST_ONLY = "no hay fila actual en «Una vez con todas las filas»: usa $input.all()";
  /** A cited step's handles: its rows, frozen, and `item(row)` the one paired with the current row. */
  const rows = (list, item) =>
    received({
      all: () => list,
      first: () => list[0],
      last: () => list[list.length - 1],
      get item() {
        if (row < 0) throw new Error(`.item: ${LIST_ONLY}`);
        return item(row);
      },
    });
  const $input = received({
    all: () => listOf(input).list,
    first: () => listOf(input).list[0],
    last: () => {
      const own = listOf(input).list;
      return own[own.length - 1];
    },
    get item() {
      if (row < 0) throw new Error(`.item: ${LIST_ONLY}`);
      return currentRow();
    },
  });
  /** Every step it cites, made before the first row and frozen with the rest: unknown names throw by their name. */
  const cited = new Map();
  for (const name of Object.keys(steps)) {
    const s = steps[name];
    cited.set(
      name,
      rows(s.rows, (i) => {
        const at = s.item ? s.item[i] : null;
        return at === null || at === undefined ? null : s.rows[at];
      }),
    );
  }
  const $ = function $(name) {
    const found = typeof name === "string" ? cited.get(name) : undefined;
    if (!found)
      throw new Error(
        `$('${String(name)}'): no hay ningún paso con ese nombre en lo que recibe este código`,
      );
    return found;
  };

  // Reads: what the request brings is given back, frozen; what it does not, stops the evaluation where it is, in a
  // way the code cannot catch (the host stops the interpreter), and the answer says which read it was (§6, risk 4).
  const answers = new Map();
  const ask = (read) => {
    const text = JSON.stringify(read);
    if (text.length > limits.readBytes)
      throw new Error(`la lectura pasa de ${limits.readBytes} bytes`);
    if (!asked.has(text)) {
      if (asked.size >= limits.reads) {
        hostHalt("reads");
        for (;;) {}
      }
      asked.add(text);
    }
    const known = answers.get(text);
    if (known) return known.value;
    const got = hostRead(text);
    if (got === "") for (;;) {}
    const value = received(JSON.parse(got));
    answers.set(text, { value });
    return value;
  };
  // Saving (AU-172, AU-183): `$col('Nombre')` has only the methods the request grants that name, and a call is a
  // request: its arguments are copied as JSON there and then (what the code changes later is not asked for), nothing
  // is saved and it gives back `undefined`. A read never sees a request: it reads what is saved. The requests of a
  // pass stopped at a read are dropped with it, since `evaluate` starts each pass with none.
  const grants = req.writes || {};
  const request = (name, action, id, fields) => {
    if (requests.length >= limits.writes) {
      hostHalt("writes");
      for (;;) {}
    }
    const parts = [`"collection":${JSON.stringify(name)}`, `"action":"${action}"`];
    try {
      if (id !== undefined) parts.push(`"id":${walk(id, []) ?? "null"}`);
      if (fields !== undefined) parts.push(`"fields":${walk(fields, []) ?? "null"}`);
    } catch (e) {
      if (e === NOT_JSON)
        throw new Error(
          `$col('${name}').${action}: lo que pide guardar no es JSON (una función, un ciclo o un número que no es finito)`,
        );
      throw e;
    }
    const at = placeIn(new Error().stack);
    if (at) parts.push(`"line":${at.line}`);
    requests.push(`{${parts.join(",")}}`);
    return undefined;
  };
  const writers = (name) => {
    const own = Object.hasOwn(grants, name) ? grants[name] : [];
    const out = {};
    if (own.includes("create")) out.create = (fields) => request(name, "create", undefined, fields);
    if (own.includes("update")) out.update = (id, fields) => request(name, "update", id, fields);
    if (own.includes("remove")) out.remove = (id) => request(name, "remove", id, undefined);
    return out;
  };
  const collections = new Map();
  const $col = function $col(name) {
    if (typeof name !== "string") throw new Error("$col: el nombre de la colección es un texto");
    let c = collections.get(name);
    if (!c) {
      const query = (q, what) => {
        if (q === undefined) return {};
        if (q === null || typeof q !== "object")
          throw new Error(`${what}: espera un objeto, como { where, sort, limit }`);
        return q;
      };
      c = received({
        find: (q) => {
          const { where, sort, limit } = query(q, "find");
          return ask({ collection: name, op: "find", where, sort, limit });
        },
        get: (id) => ask({ collection: name, op: "get", id }),
        count: (q) => ask({ collection: name, op: "count", where: query(q, "count").where }),
        sum: (field, q) =>
          ask({ collection: name, op: "sum", field, where: query(q, "sum").where }),
        ...writers(name),
      });
      collections.set(name, c);
    }
    return c;
  };

  // The console (AU-33): text, with the line of the source that wrote it; the host counts and keeps the lines.
  // The lines `Function` and `bodyOf` add before the source.
  const LINES = isCode ? 3 : 4;
  const placeIn = (stack) => {
    const m = /<input>:(\d+):(\d+)/.exec(String(stack));
    return m ? { line: Number(m[1]) - LINES, column: Number(m[2]) } : undefined;
  };
  const show = (v) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (v instanceof BoniDate) return v.toISO();
    if (v !== null && typeof v === "object") {
      const seen = new WeakSet();
      try {
        return JSON.stringify(v, (_, x) => {
          if (typeof x === "bigint") return String(x);
          if (x !== null && typeof x === "object") {
            if (seen.has(x)) return "[…]";
            seen.add(x);
          }
          return x;
        });
      } catch {
        return String(v);
      }
    }
    return String(v);
  };
  const writer =
    (level) =>
    (...args) => {
      const at = placeIn(new Error().stack);
      hostLog(level, args.map(show).join(" ").slice(0, limits.consoleLineChars), at ? at.line : -1);
    };
  const console = {
    log: writer("log"),
    info: writer("info"),
    warn: writer("warn"),
    error: writer("error"),
  };

  const globals = {
    $input,
    $,
    $run: received({ test: req.run.test, startedBy: req.run.startedBy }),
    $page: null,
    $date,
    console,
  };
  for (const k of Object.keys(globals))
    Object.defineProperty(globalThis, k, {
      value: globals[k],
      enumerable: false,
      writable: false,
      configurable: false,
    });
  if (isCode)
    Object.defineProperty(globalThis, "$col", {
      value: $col,
      writable: false,
      configurable: false,
    });
  const getters = {
    $json() {
      if (row < 0) throw new Error(`$json: ${LIST_ONLY}`);
      return currentRow();
    },

    $now() {
      return new BoniDate(null, clock());
    },
    $today() {
      return new BoniDate(toLocal(clock()).day, null);
    },
  };
  for (const k of Object.keys(getters))
    Object.defineProperty(globalThis, k, { get: getters[k], configurable: false });

  // The code, made into functions before anything is frozen and run after: the bodies come from evaluate.ts's
  // `bodyOf` (a «Código» is a function's body, an expression the value it returns), which also found those that close
  // the function they are put in. A source that does not parse fails every evaluation, saying where.
  const made = sources.map((_, i) => {
    if (escaped.includes(i))
      return {
        error: new SyntaxError(
          "cierra la función en la que va: el código se ejecuta dentro de ella y nunca fuera",
        ),
      };
    try {
      return { fn: Function(bodies[i]) };
    } catch (e) {
      return { error: e };
    }
  });

  // Freeze it all: everything reachable from the global object, the intrinsics reachable only from values, the help.
  const proto = Object.getPrototypeOf;
  received(
    globalThis,
    input,
    ...Object.values(steps),
    proto(function* () {}),
    proto(async () => {}),
    proto(async function* () {}),
    proto([][Symbol.iterator]()),
    proto(new Map()[Symbol.iterator]()),
    proto(new Set()[Symbol.iterator]()),
    proto(""[Symbol.iterator]()),
    proto(/a/[Symbol.matchAll]("")),
    proto(Object.getPrototypeOf(Int8Array)),
    BoniDate.prototype,
    ...made.map((m) => m.fn),
    ...cited.values(),
  );

  const failed = (e, source) => {
    let fault = "threw";
    let message;
    let at;
    try {
      if (e instanceof Error) {
        message = String(e.message);
        if (e.name === "InternalError" && /out of memory/.test(message)) throw e;
        if (e instanceof TypeError && FROZEN.test(message)) {
          fault = "frozen";
          message = `${message}: ${COPY}`;
        } else if (e.name === "InternalError" && /stack overflow/.test(message))
          message = `se ha pasado de su pila (stack overflow, ${limits.stackBytes} bytes): una función que se llama a sí misma sin fin`;
        at = placeIn(e.stack);
        // A source that ends too soon is said at its end, not at the line its wrapping adds.
        const lines = sources[source].split("\n");
        if (at && at.line > lines.length)
          at = { line: lines.length, column: lines[lines.length - 1].length + 1 };
      } else message = show(e);
    } catch (err) {
      if (err === e) throw e;
      message = "error";
    }
    return JSON.stringify({
      state: "failed",
      fault,
      message: message.slice(0, 2000),
      source,
      ...at,
    });
  };

  // A row's value as JSON text, or why it is not one: what JSON cannot say is `notJson`, never dropped quietly.
  const NOT_JSON = {};
  const walk = (x, seen) => {
    switch (typeof x) {
      case "string":
        return JSON.stringify(x);
      case "boolean":
        return x ? "true" : "false";
      case "number":
        if (!Number.isFinite(x)) throw NOT_JSON;
        return JSON.stringify(x);
      case "undefined":
        return undefined;
      case "object": {
        if (x === null) return "null";
        if (x instanceof BoniDate) return JSON.stringify(x.toJSON());
        if (x instanceof RealDate) {
          const t = RealDate.prototype.getTime.call(x);
          if (!Number.isFinite(t)) throw NOT_JSON;
          return String(t);
        }
        if (seen.includes(x)) throw NOT_JSON;
        seen.push(x);
        let out;
        if (Array.isArray(x)) {
          const parts = [];
          for (let i = 0; i < x.length; i++) parts.push(walk(x[i], seen) ?? "null");
          out = `[${parts.join(",")}]`;
        } else {
          const parts = [];
          for (const k of Object.keys(x)) {
            const v = walk(x[k], seen);
            if (v !== undefined) parts.push(`${JSON.stringify(k)}:${v}`);
          }
          out = `{${parts.join(",")}}`;
        }
        seen.pop();
        return out;
      }
      default:
        throw NOT_JSON;
    }
  };
  const result = (v, source) => {
    if (v === undefined) return isCode ? { why: "nothing" } : { text: "null" };
    if (
      v !== null &&
      (typeof v === "object" || typeof v === "function") &&
      typeof v.then === "function"
    )
      return { why: "promise" };
    try {
      return { text: walk(v, []) };
    } catch (e) {
      if (e === NOT_JSON) return { why: "notJson" };
      return { error: failed(e, source) };
    }
  };

  /** One evaluation: every source for the row at `place` of the step's input, in order, or the first that fails. */
  const evaluate = (place) => {
    readClock = false;
    readRandom = false;
    asked.clear();
    requests = [];
    copies = null;
    lists = null;
    current = null;
    state = seedFor(place);
    const values = [];
    for (let n = 0; n < made.length; n++) {
      if (made[n].error) return failed(made[n].error, n);
      let v;
      try {
        v = made[n].fn();
      } catch (e) {
        return failed(e, n);
      }
      const r = result(v, n);
      if (r.error) return r.error;
      if (r.why)
        return JSON.stringify({ state: "failed", fault: "result", message: r.why, source: n });
      values.push(r.text);
    }
    const writes = requests.length ? `,"writes":[${requests.join(",")}]` : "";
    return `{"state":"done","values":[${values.join(",")}],"clock":${readClock},"random":${readRandom}${writes}}`;
  };

  /** The driver: each row from `start` on, each answer handed to the host as it is made. */
  return function run(start) {
    if (mode === "all") {
      row = -1;
      hostPut(evaluate(from));
      return;
    }
    for (let i = start; i < input.length; i++) {
      row = i;
      hostPut(evaluate(from + i));
    }
    row = -1;
  };
});
