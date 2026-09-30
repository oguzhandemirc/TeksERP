// Fabrika saat dilimi dönem defterinin SÜREÇ İÇİ durumu — DB satırlarından etkin dönemleri çözer, time.ts'e uygular
// ve istemci/bulut yükünü üretir. Saf (servis içe aktarmaz): hem ayar önbelleği hem yazma servisi çağırır.
import {
  DEFAULT_FACTORY_TIMEZONE,
  type FactoryTimezonePeriodRow,
  applyFactoryTimezonePeriods,
  factoryTimezoneAt,
  getFactoryBaseTimezone,
  getFactoryTimezonePeriods,
  isValidFactoryTimezone,
  noteStoredFactoryTimezone,
  resolveFactoryTimezonePeriods,
} from "../../constants/time";

/** Henüz yürürlüğe girmemiş (iptal edilebilir) değişiklik. */
export interface FactoryTimezonePending {
  id: string;
  timeZone: string;
  validFrom: Date;
  /** Değişiklikten önceki dilim — iptal bu dilimle ters kayıt yazar. */
  previousTimeZone: string;
}

/** Eski tek değerli `company.timezone` satırı (TZ-B; hiçbir sürüme çıkmadı): varsa ilk dönemden önceki dilimdir. */
export interface LegacyTimezoneSetting {
  present: boolean;
  value?: unknown;
}

let winnerIds = new Map<number, string>();

/**
 * Satırları çözüp süreç değerine uygular. Geçersiz dilimli dönem varsayılanla yorumlanır; yürürlükteki ya da
 * bekleyen dönem geçersizse `FACTORY_TIMEZONE_INVALID_STORED` uyarısı açılır (geçmiş dönem yalnız yorumlanır).
 */
export function applyFactoryTimezoneRows(
  rows: readonly FactoryTimezonePeriodRow[],
  legacy: LegacyTimezoneSetting,
  now: Date = new Date(),
): { storedInvalid: boolean; legacyInvalid: boolean; periodInvalid: boolean } {
  let base = DEFAULT_FACTORY_TIMEZONE;
  let invalidRaw: unknown = undefined;
  const legacyInvalid = legacy.present && !isValidFactoryTimezone(legacy.value);
  if (legacy.present) {
    if (!legacyInvalid) base = legacy.value as string;
    else invalidRaw = legacy.value ?? null;
  }
  const { periods, invalid } = resolveFactoryTimezonePeriods(rows, base);
  const pastStarts = rows.map((r) => r.validFrom.getTime()).filter((t) => t <= now.getTime());
  const currentStart = pastStarts.length > 0 ? Math.max(...pastStarts) : -Infinity;
  const live = invalid.find((r) => r.validFrom.getTime() >= currentStart);
  if (invalidRaw === undefined && live) invalidRaw = live.timeZone;
  applyFactoryTimezonePeriods(periods, base);
  winnerIds = new Map(periods.map((p) => [p.validFrom.getTime(), p.id] as const));
  noteStoredFactoryTimezone(invalidRaw === undefined, invalidRaw);
  return { storedInvalid: invalidRaw !== undefined, legacyInvalid, periodInvalid: live !== undefined };
}

/** Yürürlüğe girmemiş değişiklik (en çok bir tane — yazma yolu ikincisini reddeder). */
export function pendingFactoryTimezone(now: Date = new Date()): FactoryTimezonePending | null {
  const next = getFactoryTimezonePeriods().find((p) => p.validFrom.getTime() > now.getTime());
  if (!next) return null;
  const id = winnerIds.get(next.validFrom.getTime());
  if (!id) return null;
  return {
    id,
    timeZone: next.timeZone,
    validFrom: next.validFrom,
    previousTimeZone: factoryTimezoneAt(new Date(next.validFrom.getTime() - 1)),
  };
}

/** `GET /api/feature-flags` yükü — önbellekten değil süreç değerinden (bekleyen değişiklik vaktinde yürürlüğe girer). */
export function publicFactoryTimezone(now: Date = new Date()): {
  factoryTimezone: string;
  factoryTimezoneBase: string;
  factoryTimezonePeriods: Array<{ validFrom: string; timeZone: string }>;
  factoryTimezonePending: { id: string; timeZone: string; validFrom: string; previousTimeZone: string } | null;
} {
  const pending = pendingFactoryTimezone(now);
  return {
    factoryTimezone: factoryTimezoneAt(now),
    factoryTimezoneBase: getFactoryBaseTimezone(),
    factoryTimezonePeriods: getFactoryTimezonePeriods().map((p) => ({ validFrom: p.validFrom.toISOString(), timeZone: p.timeZone })),
    factoryTimezonePending: pending
      ? { id: pending.id, timeZone: pending.timeZone, validFrom: pending.validFrom.toISOString(), previousTimeZone: pending.previousTimeZone }
      : null,
  };
}
