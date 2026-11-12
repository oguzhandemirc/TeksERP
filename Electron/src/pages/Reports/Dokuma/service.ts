// =============================================================================
// DOKUMA RAPORLARI — HTTP istemcisi (backend `reports/dokuma.report.routes` +
// `machine-shift-stat.routes` ile BİREBİR; `test_dokuma_regime_gate §7` allowlist'inde)
// =============================================================================
// Tarih parametreleri FABRİKA GÜNÜ `YYYY-MM-DD` (backend `.strict()` — tanımadığı
// anahtar 400). Rapor sözleşmesi: oranlar `null` = ÖLÇÜLEMEDİ (0 değil); kaynak
// kırılımı her cevapta; `meta.ufuk` her cevapta.
// =============================================================================
import type { BeamSuzgec } from "../_hooks/reportAxisFilters";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { DataSource } from "./dokuma-regime";
import type { FinishForecastReport } from "./leventReportTypes";

export type SealState = "OPEN" | "SEALED";

export interface LoomKpis {
  availabilityPct: number | null;
  performancePct: number | null;
  effectivenessPct: number | null;
  formulaVersion: number;
  olculemedi: { A?: string; P?: string; E?: string };
  warnings: string[];
}
export interface ShiftStatRow {
  /** `null` = karne satırı henüz yazılmadı (kapanış işi vardiya bitiminden 60 dk sonra yazar) — mühür eylemleri kapalı. */
  statId: string | null;
  machineId: string; machine: { code: string; name: string };
  shiftInstanceId: string;
  shiftInstance: { factoryDayKey: string; startsAt: string; endsAt: string; isCancelled: boolean; shiftDefinition: { code: string; name: string } };
  live: boolean; sealState: SealState; sealGeneration: number; sealedAt: string | null;
  terms: {
    calendarSec: number; potSec: number; aptSec: number; setupSec: number; plannedDownSec: number; unplannedDownSec: number;
    minorStopSec: number; nonScheduledSec: number; plannedBreakSec: number; unclassifiedSec: number; unitsActual: number;
    producedM: number | null; targetUnitsPerMin: number | null; source: DataSource; stopThresholdSec: number;
  };
  kpis: LoomKpis;
  emptyLoom: boolean;
  warnings: string[];
}
export interface ShiftStatListMeta { total: number; truncated: boolean; live: number; sealed: number; nextCursor?: string | null }

/** Sayfa boyu = sunucu tavanı: 200 tezgah × 7 gün (4.200 çift) tek istekte gelir; fazlası "Daha fazla" ile. */
export const DOKUMA_PAGE_LIMIT = 5000;
export interface PageParams { cursor?: string; limit?: number }

type ShiftStatsPage = ApiResponse<ShiftStatRow[]> & { meta: ShiftStatListMeta };

/** Sayfaları birleştirir: satırlar uç uca, sayfa durumu SON sayfadan. */
export function mergeShiftStatPages(pages: ShiftStatsPage[] | undefined): ShiftStatsPage | undefined {
  if (!pages?.length) return undefined;
  const last = pages[pages.length - 1]!;
  return { ...pages[0]!, data: pages.flatMap((p) => p.data ?? []), meta: { ...pages[0]!.meta, truncated: last.meta.truncated, nextCursor: last.meta.nextCursor } };
}

/** Backend `PUT /:id/terms` gövdesiyle BİREBİR (Zod `.strict()` — fazla anahtar 400). */
export interface ShiftTermsCorrection {
  nonScheduledSec?: number; plannedBreakSec?: number; setupSec?: number; plannedDownSec?: number;
  unplannedDownSec?: number; minorStopSec?: number; unclassifiedSec?: number; unitsActual?: number;
  producedM?: number | null; targetUnitsPerMin?: number | null;
}

export interface SealLedgerRow {
  id: string; action: "SEAL" | "UNSEAL" | "RESEAL"; sealGeneration: number; reason: string | null;
  actedById: string | null; createdAt: string; potSec: number; aptSec: number; unitsActual: number; effectivenessPct: string | number | null;
}

/** Süzgeç beyanı cevabın KÖKÜNDE (tek adres — 1e hükmü); süzgeç yoksa alan YOK. */
export type WithSuzgec = { suzgec?: BeamSuzgec };

export interface RangeParams { from: string; to: string; machineId?: string; warpBeamId?: string; lotNo?: string }

function qs(p: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p) as Array<[string, string | number | undefined]>) if (v) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export const dokumaReportsApi = {
  // Levent bitiş tahmini (levent ucu ayrıca `requireDevereEnabled`).
  leventBitisTahmini: async (p: { machineId?: string }) =>
    (await apiClient.get<ApiResponse<FinishForecastReport> & WithSuzgec>(`/api/reports/dokuma/levent-bitis-tahmini${qs(p)}`)).data,
  shiftStats: async (p: RangeParams & PageParams & { sealState?: SealState }) =>
    (await apiClient.get<ApiResponse<ShiftStatRow[]> & { meta: ShiftStatListMeta }>(`/api/machine-shift-stats${qs(p)}`)).data,
  seals: async (statId: string) =>
    (await apiClient.get<ApiResponse<SealLedgerRow[]>>(`/api/machine-shift-stats/${statId}/seals`)).data,
  correctTerms: async (statId: string, body: ShiftTermsCorrection) =>
    (await apiClient.put<ApiResponse<{ id: string }>>(`/api/machine-shift-stats/${statId}/terms`, body)).data,
  seal: async (statId: string) =>
    (await apiClient.post<ApiResponse<{ id: string; sealGeneration: number; action: string }>>(`/api/machine-shift-stats/${statId}/seal`, {})).data,
  unseal: async (statId: string, reason: string) =>
    (await apiClient.post<ApiResponse<{ id: string; sealGeneration: number }>>(`/api/machine-shift-stats/${statId}/unseal`, { reason })).data,
};

/** Tek kaynak `_lib/report-date` — dokuma çağıranları için yeniden dışa açılır. */
export { toFactoryYmd } from "../_lib/report-date";

/** Karne listesindeki mühür eylemleri — backend uçlarının GERÇEK izinleriyle birebir (1e şartı ①). */
export const SHIFT_STAT_ACTION_PERMISSIONS = {
  correctTerms: "loom:manual-entry",
  seal: "loom:manual-entry",
  unseal: "loom:shift-unseal",
} as const;
