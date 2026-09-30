// Fabrika saat dilimi DÖNEMLERİ — istemcinin dilim durumu (sunucunun bildirdiği taban + dönemler), bir anın dilimi
// ve değişim dinleyicileri. Biçimleyici `factory-time.ts` bunu kullanır ve genel API'yi yeniden dışa verir.
// Bu dosya Electron · mobil · patron/uygulama `src/lib/factory-time-zone.ts` olarak BAYT-EŞİT durur; değişiklik
// Electron'da yapılır, sonra `cp -p` (bekçi: Teks-Erp/scripts/test_istemci_saat_dilimi.ts).

export const DEFAULT_FACTORY_TIMEZONE = "Europe/Istanbul";

export type DateInput = Date | string | number | null | undefined;

const SAFE_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

// Dönem: `from` anından (ms; ilk dönem -∞) sonraki dönem başlayana dek `zone`. Bir anın saati/günü KENDİ ANINDAKİ
// dilimle basılır — sonradan yapılan dilim değişikliği geçmiş kayıtları kaydırmaz (kullanıcı kararı 2026-09-30).
export type Segment = { from: number; zone: string };
let segments: Segment[] = [{ from: -Infinity, zone: DEFAULT_FACTORY_TIMEZONE }];
let signature = "";
const listeners = new Set<(timeZone: string) => void>();
let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function cachedFormatter(locale: string | string[] | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${JSON.stringify(locale ?? null)}|${JSON.stringify(opts)}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    if (formatterCache.size > 256) formatterCache.clear();
    fmt = new Intl.DateTimeFormat(locale, opts);
    formatterCache.set(key, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.length > 64 || !SAFE_ZONE.test(timeZone)) return false;
  try {
    cachedFormatter("en-US", { timeZone });
    return true;
  } catch {
    return timeZone === DEFAULT_FACTORY_TIMEZONE;
  }
}

function segmentIndexAt(ms: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((segments[mid] as Segment).from <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const zoneAtMs = (ms: number): string => (segments[segmentIndexAt(ms)] as Segment).zone;

/** Güncel dönem dizisi (salt-okunur; biçimleyicinin gün/duvar saati hesabı için). */
export function currentSegments(): readonly Segment[] {
  return segments;
}

/** Bir anın fabrika dilimi (o anda yürürlükteki dönem); girdi yoksa/bozuksa şimdi. */
export function factoryTimezoneAt(input: DateInput = new Date()): string {
  const t = input === null || input === undefined || input === "" ? NaN : (input instanceof Date ? input : new Date(input)).getTime();
  return zoneAtMs(Number.isNaN(t) ? Date.now() : t);
}

/** Fabrikanın ŞU ANKİ dilimi ("bugün" bu dilimde bugündür). */
export function getFactoryTimezone(): string {
  return zoneAtMs(Date.now());
}

/** İlk dönemden önceki dilim (dönemsiz kurulumda varsayılan). */
export function getFactoryBaseTimezone(): string {
  return (segments[0] as Segment).zone;
}

/** Etkin dönemler (`validFrom` ISO, artan); dönemsiz kurulumda boş. */
export function getFactoryTimezonePeriods(): { validFrom: string; timeZone: string }[] {
  return segments.slice(1).map((s) => ({ validFrom: new Date(s.from).toISOString(), timeZone: s.zone }));
}

function notify(): void {
  const zone = getFactoryTimezone();
  for (const l of listeners) l(zone);
}

// Bekleyen değişiklik yürürlüğe girdiği an dinleyiciler uyanır ("bugün" ve kabuk yeni dilimle kurulur).
function scheduleBoundary(): void {
  if (boundaryTimer !== null) clearTimeout(boundaryTimer);
  boundaryTimer = null;
  const now = Date.now();
  const next = segments.find((s) => s.from > now);
  if (!next || listeners.size === 0) return;
  boundaryTimer = setTimeout(() => {
    boundaryTimer = null;
    notify();
    scheduleBoundary();
  }, Math.min(next.from - now + 50, 2_000_000_000));
  (boundaryTimer as unknown as { unref?: () => void }).unref?.();
}

function applySegments(next: Segment[]): void {
  const sig = JSON.stringify(next);
  if (sig === signature) return;
  const before = getFactoryTimezone();
  segments = next;
  signature = sig;
  scheduleBoundary();
  if (getFactoryTimezone() !== before || listeners.size > 0) notify();
}

/** Tek dilim, bütün zaman (dönem bilgisi taşımayan eski sunucu); geçersiz değer yok sayılır. */
export function setFactoryTimezone(timeZone: unknown): boolean {
  if (!isValidTimeZone(timeZone)) return false;
  applySegments([{ from: -Infinity, zone: timeZone }]);
  return true;
}

/**
 * Sunucunun bildirdiği dönemleri uygular (`[{ validFrom, timeZone }]`, `base` ilk dönemden önceki dilim).
 * Tek bir bozuk öğe bütün listeyi reddeder — son geçerli durum kalır (yarım liste yanlış güne basardı).
 */
export function setFactoryTimezonePeriods(periods: unknown, base: unknown = DEFAULT_FACTORY_TIMEZONE): boolean {
  if (!Array.isArray(periods) || !isValidTimeZone(base)) return false;
  const items: Segment[] = [];
  for (const p of periods as unknown[]) {
    const o = (p ?? {}) as { validFrom?: unknown; timeZone?: unknown };
    const v = o.validFrom;
    const t = typeof v === "string" || typeof v === "number" || v instanceof Date ? new Date(v).getTime() : NaN;
    if (!Number.isFinite(t) || !isValidTimeZone(o.timeZone)) return false;
    items.push({ from: t, zone: o.timeZone });
  }
  const next: Segment[] = [{ from: -Infinity, zone: base }];
  for (const it of items.sort((a, b) => a.from - b.from)) {
    const last = next[next.length - 1] as Segment;
    if (last.zone === it.zone) continue;
    if (last.from === it.from) last.zone = it.zone;
    else next.push(it);
  }
  applySegments(next);
  return true;
}

/** `GET /api/feature-flags` yanıtı: dönem listesi varsa onu, yoksa (eski sunucu) tek dilimi uygular. */
export function applyServerFactoryTimezone(
  data: { factoryTimezone?: unknown; factoryTimezoneBase?: unknown; factoryTimezonePeriods?: unknown } | null | undefined,
): boolean {
  if (!data) return false;
  if (Array.isArray(data.factoryTimezonePeriods)) {
    return setFactoryTimezonePeriods(data.factoryTimezonePeriods, data.factoryTimezoneBase ?? DEFAULT_FACTORY_TIMEZONE);
  }
  return setFactoryTimezone(data.factoryTimezone);
}

export function onFactoryTimezoneChange(listener: (timeZone: string) => void): () => void {
  listeners.add(listener);
  scheduleBoundary();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) scheduleBoundary();
  };
}
