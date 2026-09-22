// =============================================================================
// OFFSITE DURUM — saf yüklemler (DB'siz): "son başarılı kopya ne kadar eski?"
// =============================================================================
// Bayatlık kararı TEK burada yaşar; `offsite-backup.helper` sağlık ucuna bunu
// koyar, panel yalnız gösterir. Prisma import'u YOK ki DB'siz bekçi ölçebilsin.
// =============================================================================

/** `JobState.job` anahtarı — `reportJobFailure`daki adla aynı. */
export const OFFSITE_JOB = "offsite-sweep";

/**
 * Bayatlık eşiği: gece yedeği 02:00–03:00, süpürme saatlik ⇒ 6 saat "birkaç tur
 * üst üste düştü" demektir; tek bir ağ hıçkırığı kırmızı yapmaz.
 */
export const OFFSITE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface JobStateSnapshot {
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface JobStaleness {
  /** Son başarıdan bu yana geçen süre; hiç başarı yoksa `null`. */
  ageMs: number | null;
  /** Eşiği aştı ya da hiç başarı yok ⇒ bayat. */
  stale: boolean;
}

/**
 * Saf yüklem, `now` enjekte edilir. Hiç başarı yoksa bayattır: "bilinmiyor"
 * yeşil sayılmaz (fail-closed).
 */
export function jobStaleness(lastOkAt: Date | null, staleAfterMs: number, now = new Date()): JobStaleness {
  if (!lastOkAt) return { ageMs: null, stale: true };
  const ageMs = Math.max(0, now.getTime() - lastOkAt.getTime());
  return { ageMs, stale: ageMs > staleAfterMs };
}

export interface OffsiteStateFields {
  lastOkAt: string | null;
  lastRunAt: string | null;
  stale: boolean;
  staleAfterHours: number;
  consecutiveFailures: number;
  lastError: string | null;
}

/**
 * Sağlık ucuna giden kalıcı-durum alanları. `configured:false`ta bayatlık
 * anlamsız (hedef yok — o ayrı bir kırmızı) ⇒ `stale:false`.
 */
export function offsiteStateFields(
  state: JobStateSnapshot | null,
  configured: boolean,
  now = new Date(),
): OffsiteStateFields {
  const st = jobStaleness(state?.lastOkAt ?? null, OFFSITE_STALE_AFTER_MS, now);
  return {
    lastOkAt: state?.lastOkAt?.toISOString() ?? null,
    lastRunAt: state?.lastRunAt?.toISOString() ?? null,
    stale: configured && st.stale,
    staleAfterHours: OFFSITE_STALE_AFTER_MS / 3_600_000,
    consecutiveFailures: state?.consecutiveFailures ?? 0,
    lastError: state?.lastError ?? null,
  };
}
