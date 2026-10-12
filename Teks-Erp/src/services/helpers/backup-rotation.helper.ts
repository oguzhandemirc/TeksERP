// =============================================================================
// Geri dönüş yedeklerinin (premigrate_) rotasyonu — SAF seçim
// =============================================================================
// Yedek DEFTER değildir: dosya silinince raporlanan hiçbir sayı değişmez. Ama
// premigrate_ bir sürümün geri dönüş noktasıdır; en yeni ROLLBACK_KEEP_NEWEST adet
// yaşına bakılmaksızın kalır (saat kayması ya da uzun sürümsüz dönem onu silmesin).
// Yaş, `max(ad damgası, mtime)` ile ölçülür: silmede muhafazakâr taraf GENÇ olandır.
// =============================================================================

import { PREMIGRATE_PREFIX, isBackupFileName, parseBackupStamp } from "./backup-naming.helper";

export const ROLLBACK_KEEP_NEWEST = 3;
export const ROLLBACK_MAX_AGE_DAYS = 90;

export interface RotationCandidate {
  name: string;
  mtimeMs: number;
}

/** Silmede kullanılan yaş anı: ad damgası ile mtime'dan GENÇ olanı. */
export function rollbackReferenceMs(c: RotationCandidate): number {
  const fromName = parseBackupStamp(c.name)?.getTime();
  return fromName === undefined ? c.mtimeMs : Math.max(fromName, c.mtimeMs);
}

/**
 * Silinecek premigrate_ yedeklerinin adları. Kapsam yalnız `premigrate_` ön ekli
 * yedek dosyaları; en yeni `keep` adet her zaman korunur, kalanlardan yalnız
 * `maxAgeDays`ten eski olanlar seçilir.
 */
export function selectExpiredRollbackBackups(
  files: readonly RotationCandidate[],
  nowMs: number,
  keep: number = ROLLBACK_KEEP_NEWEST,
  maxAgeDays: number = ROLLBACK_MAX_AGE_DAYS,
): string[] {
  const safeKeep = Math.max(ROLLBACK_KEEP_NEWEST, Math.floor(keep));
  const cutoffMs = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  return files
    .filter((f) => f.name.startsWith(PREMIGRATE_PREFIX) && isBackupFileName(f.name))
    .map((f) => ({ name: f.name, ref: rollbackReferenceMs(f) }))
    .sort((a, b) => b.ref - a.ref || b.name.localeCompare(a.name))
    .slice(safeKeep)
    .filter((f) => f.ref < cutoffMs)
    .map((f) => f.name);
}
