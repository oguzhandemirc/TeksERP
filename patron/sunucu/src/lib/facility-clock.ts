// Tesis saati — bildirim gün anahtarı (dedup kimliği) ve sessiz saat TESİSİN o andaki saat diliminden hesaplanır
// (ANLIK `tesis`: fabrikanın saat dilimi DÖNEMLERİ; bir anın dilimi kendi döneminden); çıplak UTC günü ya da
// sunucunun dilimi kullanılmaz. Projeksiyon henüz gelmediyse (eski fabrika sürümü) varsayılan Europe/Istanbul.
import { TesisVerisiSchema } from "../wire/esitleme";

export const DEFAULT_FACILITY_TIMEZONE = "Europe/Istanbul";
/** Saat dilimini taşıyan ANLIK projeksiyon (katalogda `tesis`, izin `bulut:oturum`). */
export const FACILITY_TIMEZONE_SOURCE = "tesis";

const SAFE_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(cache: Map<string, Intl.DateTimeFormat>, timeZone: string, make: (tz: string) => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = cache.get(timeZone);
  if (!f) {
    f = make(timeZone);
    cache.set(timeZone, f);
  }
  return f;
}

/** Projeksiyondaki ham değer → geçerli IANA dilimi; tanınmayan değer varsayılana düşer (sessiz saat hiç kaybolmasın). */
export function facilityTimeZone(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 64 || !SAFE_ZONE.test(raw)) return DEFAULT_FACILITY_TIMEZONE;
  try {
    formatter(dayFormatters, raw, dayFormat);
    return raw;
  } catch {
    return DEFAULT_FACILITY_TIMEZONE;
  }
}

/**
 * ANLIK `tesis` verisinden `ms` anının dilimi: `gecerliBaslangic ≤ ms` olan son dönem, yoksa `tabanDilim`
 * (eski fabrika paketi dönem taşımaz ⇒ `saatDilimi`). Tanınmayan veri varsayılana düşer.
 */
export function facilityTimeZoneAt(data: unknown, ms: number): string {
  const v = TesisVerisiSchema.safeParse(data);
  if (!v.success) {
    const raw = data !== null && typeof data === "object" ? (data as { saatDilimi?: unknown }).saatDilimi : undefined;
    return facilityTimeZone(raw);
  }
  if (!v.data.donemler) return facilityTimeZone(v.data.saatDilimi);
  let zone: unknown = v.data.tabanDilim ?? DEFAULT_FACILITY_TIMEZONE;
  let at = -Infinity;
  for (const d of v.data.donemler) {
    const t = Date.parse(d.gecerliBaslangic);
    if (t <= ms && t >= at) {
      at = t;
      zone = d.saatDilimi;
    }
  }
  return facilityTimeZone(zone);
}

function dayFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
}

function clockFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Tesisin takvim günü `YYYY-AA-GG`. */
export function facilityDay(ms: number, timeZone: string = DEFAULT_FACILITY_TIMEZONE): string {
  return formatter(dayFormatters, timeZone, dayFormat).format(new Date(ms));
}

/** Tesiste günün dakikası (0–1439). */
export function facilityMinute(ms: number, timeZone: string = DEFAULT_FACILITY_TIMEZONE): number {
  const [h, m] = formatter(clockFormatters, timeZone, clockFormat).format(new Date(ms)).split(":").map(Number);
  return ((h ?? 0) % 24) * 60 + (m ?? 0);
}

function clockMinute(text: string): number {
  const [h, m] = text.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Sessiz penceredeyse pencerenin BİTİŞ anı (ms), değilse null. Başlangıç = bitiş → pencere yok. Pencere tesis saatidir. */
export function quietUntil(q: { acik: boolean; baslangic: string; bitis: string }, ms: number, timeZone: string = DEFAULT_FACILITY_TIMEZONE): number | null {
  if (!q.acik) return null;
  const start = clockMinute(q.baslangic);
  const end = clockMinute(q.bitis);
  if (start === end) return null;
  const now = facilityMinute(ms, timeZone);
  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return null;
  const minutesLeft = (end - now + 1440) % 1440;
  return Math.floor(ms / 60_000) * 60_000 + minutesLeft * 60_000;
}
