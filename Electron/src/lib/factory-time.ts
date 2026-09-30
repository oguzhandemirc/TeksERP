// Fabrika saat dilimi — istemcilerin TEK tarih/saat biçimleyicisi. Gösterim ve basım istemcinin bilgisayar
// diliminden DEĞİL, sunucunun bildirdiği fabrika dilimi DÖNEMLERİNDEN yapılır (`GET /api/feature-flags` →
// factoryTimezoneBase + factoryTimezonePeriods): her an kendi anındaki dilimle basılır, geçmiş kayıtlar kaymaz.
// Bu dosya Electron · mobil · patron/uygulama `src/lib/factory-time.ts` olarak BAYT-EŞİT durur; değişiklik
// Electron'da yapılır, sonra `cp -p` (bekçi: Teks-Erp/scripts/test_istemci_saat_dilimi.ts).

import {
  type DateInput,
  type Segment,
  cachedFormatter,
  currentSegments,
  zoneAtMs,
} from "./factory-time-zone";

export {
  DEFAULT_FACTORY_TIMEZONE,
  applyServerFactoryTimezone,
  factoryTimezoneAt,
  getFactoryBaseTimezone,
  getFactoryTimezone,
  getFactoryTimezonePeriods,
  isValidTimeZone,
  onFactoryTimezoneChange,
  setFactoryTimezone,
  setFactoryTimezonePeriods,
  type DateInput,
} from "./factory-time-zone";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const WEEKDAYS_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cts"];
// İstanbul 2016'dan beri sabit UTC+3: Intl'in dilim desteği olmayan motorda varsayılan dilim yine doğru basılır.
const DEFAULT_OFFSET_MS = 3 * 3_600_000;

/** Yerleşik `Date` yapıcısıyla aynı yorum (drop-in'ler eski çıktıyı birebir korusun). */
function looseDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input as string | number);
}

function toValidDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = looseDate(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fixedParts(d: Date, offsetMs: number): ZonedParts {
  const x = new Date(d.getTime() + offsetMs);
  return {
    year: x.getUTCFullYear(),
    month: x.getUTCMonth() + 1,
    day: x.getUTCDate(),
    hour: x.getUTCHours(),
    minute: x.getUTCMinutes(),
    second: x.getUTCSeconds(),
    weekday: x.getUTCDay(),
  };
}

function zonedParts(d: Date, timeZone: string): ZonedParts {
  try {
    const fmt = cachedFormatter("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(d)) {
      if (part.type !== "literal") p[part.type] = Number(part.value);
    }
    const year = p.year ?? NaN;
    const month = p.month ?? NaN;
    const day = p.day ?? NaN;
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) throw new Error("parts");
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return { year, month, day, hour: (p.hour ?? 0) % 24, minute: p.minute ?? 0, second: p.second ?? 0, weekday };
  } catch {
    return fixedParts(d, DEFAULT_OFFSET_MS);
  }
}

/** Fabrika duvar saati − UTC (ms). */
export function factoryOffsetMs(input: DateInput, timeZone?: string): number {
  const d = toValidDate(input) ?? new Date();
  const p = zonedParts(d, timeZone ?? zoneAtMs(d.getTime()));
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(d.getTime() / 1000) * 1000;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const TOKEN = /yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|mm|ss|'[^']*'/g;

function renderPattern(p: ZonedParts, pattern: string): string {
  return pattern.replace(TOKEN, (t) => {
    switch (t) {
      case "yyyy": return String(p.year);
      case "yy": return pad2(p.year % 100);
      case "MMMM": return MONTHS[p.month - 1] ?? "";
      case "MMM": return MONTHS_SHORT[p.month - 1] ?? "";
      case "MM": return pad2(p.month);
      case "M": return String(p.month);
      case "dd": return pad2(p.day);
      case "d": return String(p.day);
      case "EEEE": return WEEKDAYS[p.weekday] ?? "";
      case "EEE": return WEEKDAYS_SHORT[p.weekday] ?? "";
      case "HH": return pad2(p.hour);
      case "H": return String(p.hour);
      case "mm": return pad2(p.minute);
      case "ss": return pad2(p.second);
      default: return t.slice(1, -1);
    }
  });
}

/**
 * Kalıpla biçim (date-fns belirteçleri: yyyy yy MMMM MMM MM M dd d EEEE EEE HH H mm ss, 'metin') — anın KENDİ
 * dönemindeki dilimle (verilirse `timeZone` ile). Boş/geçersiz girdi → `fallback`.
 */
export function formatFactory(input: DateInput, pattern: string, fallback = "—", timeZone?: string): string {
  const d = toValidDate(input);
  return d ? renderPattern(zonedParts(d, timeZone ?? zoneAtMs(d.getTime())), pattern) : fallback;
}

export const fmtFactoryDate = (input: DateInput, fallback = "—"): string => formatFactory(input, "dd.MM.yyyy", fallback);
export const fmtFactoryTime = (input: DateInput, fallback = "—"): string => formatFactory(input, "HH:mm", fallback);
export const fmtFactoryDateTime = (input: DateInput, fallback = "—"): string => formatFactory(input, "dd.MM.yyyy HH:mm", fallback);
/** Basım damgası: yerleşik `toLocaleString("tr-TR")` ile aynı görünüm (saniyeli). */
export const fmtFactoryStamp = (input: DateInput = new Date(), fallback = "—"): string =>
  formatFactory(input, "dd.MM.yyyy HH:mm:ss", fallback);

/**
 * TAKVİM GÜNÜ alanının (vade · termin · planlanan tarih · kur günü) dilimi. Tam UTC gece yarısı `@db.Date` ve
 * "YYYY-MM-DD" girdisinin saklama biçimidir → UTC parçaları (dilim değişse de gün kaymaz); başka bir an
 * (ör. düzenleme tarihinden türetilmiş vade) fabrika gününe düşer. Backend `fmt-date.ts` aynı kuralı taşır.
 */
export function calendarDayZone(input: DateInput): string {
  const d = toValidDate(input);
  return d && d.getTime() % 86_400_000 === 0 ? "UTC" : zoneAtMs(d ? d.getTime() : Date.now());
}

/** Takvim günü alanını kalıpla basar (`calendarDayZone`); boş/geçersiz → `fallback`. */
export function formatCalendarDay(input: DateInput, pattern = "dd.MM.yyyy", fallback = "—"): string {
  const d = toValidDate(input);
  if (!d) return fallback;
  const zone = calendarDayZone(d);
  return renderPattern(zone === "UTC" ? fixedParts(d, 0) : zonedParts(d, zone), pattern);
}

export const fmtCalendarDay = (input: DateInput, fallback = "—"): string => formatCalendarDay(input, "dd.MM.yyyy", fallback);

/** Takvim günü alanına kalan gün: alanın günü (`calendarDayZone`) − fabrikanın bugünü; geçersiz girdi → NaN. */
export function calendarDaysFromToday(input: DateInput, today: DateInput = new Date()): number {
  const a = formatCalendarDay(input, "yyyy-MM-dd", "");
  const b = factoryDayKey(today);
  if (!a || !b) return NaN;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** `toLocaleDateString(locale, opts)` yerine — takvim günü alanı için (`calendarDayZone`). */
export function calendarLocaleDateString(input: DateInput, locale?: string | string[], opts?: Intl.DateTimeFormatOptions): string {
  const d = looseDate(input);
  if (Number.isNaN(d.getTime())) return "Invalid Date";
  try {
    return cachedFormatter(locale, zonedOptions(opts, "date", calendarDayZone(d))).format(d);
  } catch {
    return formatCalendarDay(d);
  }
}

type DayParts = { y: number; m: number; d: number };
const ymdNum = (p: DayParts): number => p.y * 10_000 + p.m * 100 + p.d;

function parseDayKey(dayKey: string): DayParts | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  return dm ? { y: Number(dm[1]), m: Number(dm[2]), d: Number(dm[3]) } : null;
}

type Wall = DayParts & { h: number; mi: number; s: number };
const segEnd = (segs: readonly Segment[], i: number): number => (i + 1 < segs.length ? (segs[i + 1] as Segment).from : Infinity);

/** Duvar saati → an, TEK dilimde (iki turlu ofset çözümü; DST'de de doğru). */
function wallInZone(w: Wall, timeZone: string): number {
  const wall = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  let t = wall - factoryOffsetMs(wall, timeZone);
  const second = wall - factoryOffsetMs(t, timeZone);
  if (second !== t) t = second;
  return t;
}

/**
 * Fabrika gününün İLK anı. Dönem sınırı gün içine düşerse gün iki dilimde sürer (uzar/kısalır, bölünmez) ve ilk
 * parçanın başı döner. Tek dilimde doğrudan yerel gece yarısı (backend `time.ts` ile aynı kural).
 */
function dayStartMs(p: DayParts): number {
  const segs = currentSegments();
  const mid = { ...p, h: 0, mi: 0, s: 0 };
  if (segs.length === 1) return wallInZone(mid, (segs[0] as Segment).zone);
  const key = ymdNum(p);
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] as Segment;
    const midnight = wallInZone(mid, seg.zone);
    const start = Math.max(midnight, seg.from);
    if (start >= segEnd(segs, i)) continue;
    const z = zonedParts(new Date(start), seg.zone);
    if (start === midnight || ymdNum({ y: z.year, m: z.month, d: z.day }) === key) return start;
  }
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i] as Segment;
    const z = zonedParts(new Date(seg.from), seg.zone);
    if (ymdNum({ y: z.year, m: z.month, d: z.day }) > key) return seg.from;
  }
  return wallInZone(mid, (segs[segs.length - 1] as Segment).zone);
}

/** Fabrika gününde duvar saati → an: o saati TAŞIYAN dönemin dilimiyle (iki dönemde varsa erkeni). */
function wallMs(w: Wall): number {
  const segs = currentSegments();
  if (segs.length === 1) return wallInZone(w, (segs[0] as Segment).zone);
  for (let i = 0; i < segs.length; i++) {
    const t = wallInZone(w, (segs[i] as Segment).zone);
    if (t >= (segs[i] as Segment).from && t < segEnd(segs, i)) return t;
  }
  return wallInZone(w, zoneAtMs(dayStartMs(w)));
}

/** Fabrika takvim günü `yyyy-MM-dd` (girdi yoksa bugün) — anın KENDİ dilimiyle; `timeZone` verilirse o dilimle. */
export function factoryDayKey(input: DateInput = new Date(), timeZone?: string): string {
  return formatFactory(input, "yyyy-MM-dd", "", timeZone);
}

/**
 * Fabrika duvar saati → an. `dayKey` `yyyy-MM-dd`, `time` `HH:mm[:ss]`; biçim bozuksa null. `timeZone` verilmezse
 * o günün (dönem sınırında o saatin) dilimi kullanılır.
 */
export function factoryWallTimeToDate(dayKey: string, time = "00:00", timeZone?: string): Date | null {
  const p = parseDayKey(dayKey);
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!p || !tm) return null;
  const w: Wall = { ...p, h: Number(tm[1]), mi: Number(tm[2]), s: Number(tm[3] ?? 0) };
  if (Number.isNaN(Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s))) return null;
  return new Date(timeZone ? wallInZone(w, timeZone) : wallMs(w));
}

/** Girdinin düştüğü fabrika gününün başlangıç anı (dönem sınırındaki uzamış günde ilk parçanın başı). */
export function factoryDayStart(input: DateInput = new Date(), timeZone?: string): Date {
  const key = factoryDayKey(input, timeZone) || factoryDayKey(new Date(), timeZone);
  if (timeZone) return factoryWallTimeToDate(key, "00:00", timeZone) ?? new Date(NaN);
  const p = parseDayKey(key);
  return p ? new Date(dayStartMs(p)) : new Date(NaN);
}

/** İki anın fabrika takvim günleri arasındaki fark (`later` − `earlier`, gün); geçersiz girdi → NaN. */
export function factoryDayDiff(later: DateInput, earlier: DateInput = new Date()): number {
  const a = factoryDayKey(later);
  const b = factoryDayKey(earlier);
  if (!a || !b) return NaN;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Takvim günü `yyyy-MM-dd` → `dd.MM.yyyy` (bir AN değil, dilim uygulanmaz); bozuk girdi → `fallback`. */
export function fmtDayKey(dayKey: string | null | undefined, fallback = "—"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dayKey ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : fallback;
}

/** `yyyy-MM-dd` gününe `days` ekler (takvim aritmetiği, dilimden bağımsız). */
export function addDaysToKey(dayKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const x = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
}

const EPOCH_DAY = "1970-01-01";

/** Fabrika gününün ilk anı (ISO); bozuk gün anahtarı 1970-01-01 sayılır. */
export function factoryDayStartIso(dayKey: string): string {
  const p = parseDayKey(dayKey) ?? parseDayKey(EPOCH_DAY);
  return new Date(p ? dayStartMs(p) : 0).toISOString();
}

/** Fabrika gününün son anı (ISO) = ertesi günün ilk anı − 1 ms. */
export function factoryDayEndIso(dayKey: string): string {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : EPOCH_DAY;
  return new Date(Date.parse(factoryDayStartIso(addDaysToKey(key, 1))) - 1).toISOString();
}

/** "Son N gün": N gün önceki fabrika gününün başı → bugünün sonu (ISO). */
export function factoryBackWindowIso(days: number, today: DateInput = new Date()): { dateFrom: string; dateTo: string } {
  const key = factoryDayKey(today) || factoryDayKey(new Date());
  return { dateFrom: factoryDayStartIso(addDaysToKey(key, -days)), dateTo: factoryDayEndIso(key) };
}

/** `<input type="datetime-local">` değeri (fabrika duvar saati `yyyy-MM-ddTHH:mm`). */
export function toFactoryDateTimeInput(input: DateInput): string {
  return formatFactory(input, "yyyy-MM-dd'T'HH:mm", "");
}

/** `yyyy-MM-ddTHH:mm[:ss]` fabrika duvar saati → an; biçim bozuksa null. */
export function fromFactoryDateTimeInput(value: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/.exec(value);
  return m ? factoryWallTimeToDate(m[1] ?? "", m[2] ?? "") : null;
}

type Required = "date" | "time" | "any";
const DATE_KEYS = ["weekday", "year", "month", "day"] as const;
const TIME_KEYS = ["dayPeriod", "hour", "minute", "second", "fractionalSecondDigits"] as const;

// ECMA-402 ToDateTimeOptions: yerleşik toLocale*String'in varsayılan alan kuralı, fabrika dilimi eklenmiş.
function zonedOptions(opts: Intl.DateTimeFormatOptions | undefined, required: Required, timeZone: string): Intl.DateTimeFormatOptions {
  const o: Record<string, unknown> = { ...(opts ?? {}) };
  let needDefaults = o.dateStyle === undefined && o.timeStyle === undefined;
  if (required !== "time" && DATE_KEYS.some((k) => o[k] !== undefined)) needDefaults = false;
  if (required !== "date" && TIME_KEYS.some((k) => o[k] !== undefined)) needDefaults = false;
  if (needDefaults && required !== "time") Object.assign(o, { year: "numeric", month: "numeric", day: "numeric" });
  if (needDefaults && required !== "date") Object.assign(o, { hour: "numeric", minute: "numeric", second: "numeric" });
  o.timeZone = timeZone;
  return o as Intl.DateTimeFormatOptions;
}

function localeFormat(input: DateInput, locale: string | string[] | undefined, opts: Intl.DateTimeFormatOptions | undefined, required: Required): string {
  const d = looseDate(input);
  if (Number.isNaN(d.getTime())) return "Invalid Date";
  try {
    return cachedFormatter(locale, zonedOptions(opts, required, zoneAtMs(d.getTime()))).format(d);
  } catch {
    return formatFactory(d, required === "date" ? "dd.MM.yyyy" : required === "time" ? "HH:mm:ss" : "dd.MM.yyyy HH:mm:ss");
  }
}

/** `date.toLocaleString(locale, opts)` yerine — fabrika diliminde. */
export function factoryLocaleString(input: DateInput, locale?: string | string[], opts?: Intl.DateTimeFormatOptions): string {
  return localeFormat(input, locale, opts, "any");
}

/** `date.toLocaleDateString(locale, opts)` yerine — fabrika diliminde. */
export function factoryLocaleDateString(input: DateInput, locale?: string | string[], opts?: Intl.DateTimeFormatOptions): string {
  return localeFormat(input, locale, opts, "date");
}

/** `date.toLocaleTimeString(locale, opts)` yerine — fabrika diliminde. */
export function factoryLocaleTimeString(input: DateInput, locale?: string | string[], opts?: Intl.DateTimeFormatOptions): string {
  return localeFormat(input, locale, opts, "time");
}

/** `factoryDateTimeFormat` dönüşü: her `format` çağrısı anın KENDİ dönemindeki dilimle biçimler. */
export interface FactoryDateTimeFormat {
  format(input?: DateInput): string;
  formatToParts(input?: DateInput): Intl.DateTimeFormatPart[];
}

/** `new Intl.DateTimeFormat(locale, opts)` yerine — dilim her anın fabrika dilimi. */
export function factoryDateTimeFormat(locale?: string | string[], opts?: Intl.DateTimeFormatOptions): FactoryDateTimeFormat {
  const at = (input?: DateInput): { d: Date; fmt: Intl.DateTimeFormat } => {
    const d = input === undefined ? new Date() : looseDate(input);
    return { d, fmt: cachedFormatter(locale, { ...(opts ?? {}), timeZone: zoneAtMs(Number.isNaN(d.getTime()) ? Date.now() : d.getTime()) }) };
  };
  return {
    format: (input) => {
      const { d, fmt } = at(input);
      return fmt.format(d);
    },
    formatToParts: (input) => {
      const { d, fmt } = at(input);
      return fmt.formatToParts(d);
    },
  };
}
