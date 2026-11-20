// Patron bulutu eşitleme işinin dışa görünen durum tipi + aralık sınırları (iş dosyası `cloud-sync.job.ts` yeniden ihraç eder).
import type { CloudBlockReason } from "../cloud-sync/eligibility";
import type { RoundOutcome } from "../cloud-sync/sync-round";

/** B1 kararı: aralık 1–60 dk (kira şeması 1440'a izin verir; fabrika üst sınırı ayrıca uygular). */
export const SYNC_INTERVAL_MIN = 1;
export const SYNC_INTERVAL_MAX = 60;

export function clampInterval(minutes: number): number {
  return Math.min(SYNC_INTERVAL_MAX, Math.max(SYNC_INTERVAL_MIN, Math.round(minutes)));
}

/** Son turu ne tetikledi (panel gösterimi): kira aralığı · kirli bayrak · zil · "şimdi eşitle" isteği. */
export type CloudSyncTrigger = "periyodik" | "olay" | "zil" | "istek";

export interface CloudSyncStatus {
  readonly eligible: boolean;
  readonly blockReason: CloudBlockReason | null;
  readonly lastRoundAt: number | null;
  readonly lastOutcome: Pick<RoundOutcome, "status" | "reason" | "packets" | "horizon" | "contractWarning"> | null;
  readonly lastReconcileYmd: string | null;
  readonly lastTrigger: CloudSyncTrigger | null;
  readonly lastEventRoundAt: number | null;
}

export const INITIAL_STATUS: CloudSyncStatus = { eligible: false, blockReason: null, lastRoundAt: null, lastOutcome: null, lastReconcileYmd: null, lastTrigger: null, lastEventRoundAt: null };
