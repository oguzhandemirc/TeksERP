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

export type SealState = "OPEN" | "SEALED";
export type LossClass = "UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED" | "MINOR";

export interface LoomKpis {
  availabilityPct: number | null;
  performancePct: number | null;
  effectivenessPct: number | null;
  formulaVersion: number;
  olculemedi: { A?: string; P?: string; E?: string };
  warnings: string[];
}
export interface SourceBreakdown { satir: number; potSec: number }
export type SourceBreakdownTable = Record<DataSource, SourceBreakdown>;
export interface LoomReportMeta {
  ufuk: string; ufukOncesiSatir: number; total: number; truncated: boolean; live: number; sealed: number;
  /** R5b-b2 levent seçicisinin kaynağı; ESKİ sunucu göndermez ⇒ alan opsiyonel, seçici o zaman pasif çizilir. */
  leventler?: BeamOption[];
}

export interface BeamOption { id: string; leventNo: string }

export interface EfficiencyRow {
  machineId: string; machine: { code: string; name: string };
  shiftInstanceId: string; factoryDayKey: string; shift: { code: string; name: string };
  live: boolean; sealState: SealState; source: DataSource; emptyLoom: boolean;
  potSec: number; aptSec: number; unitsActual: number; producedM: number | null;
  targetUnitsPerMin: number | null;
  availabilityPct: number | null; performancePct: number | null; effectivenessPct: number | null;
  olculemedi: { A?: string; P?: string; E?: string };
  warnings: string[];
}
export interface EfficiencyReport {
  satirlar: EfficiencyRow[];
  toplam: { availabilityPct: number | null; performancePct: number | null; effectivenessPct: number | null; olculemedi: { A: number; P: number; E: number }; rowCount: number };
  kaynakKirilimi: SourceBreakdownTable;
  meta: LoomReportMeta;
}

export interface ParetoReasonRow { reasonCode: string; reasonLabel: string | null; lossClass: LossClass | null; stopCount: number; stopSec: number }
export interface ParetoBucket { stopCount: number; stopSec: number }
export interface ParetoReport {
  sebepler: ParetoReasonRow[];
  mikroDuruslar: ParetoBucket;
  siniflandirilmamis: ParetoBucket;
  atanmamis: ParetoBucket;
  toplam: ParetoBucket;
  kaynakKirilimi: SourceBreakdownTable;
  meta: LoomReportMeta;
}

export interface ShiftMachineRow {
  machineId: string; machine: { code: string; name: string }; source: DataSource; live: boolean; sealState: SealState;
  unitsActual: number; producedM: number | null; durusSec: number; emptyLoom: boolean;
  availabilityPct: number | null; performancePct: number | null; effectivenessPct: number | null; olculemedi: { A?: string; P?: string; E?: string };
}
export interface ShiftRow {
  shiftInstanceId: string;
  /** R5b-b: vardiya SEÇİCİSİ bununla süzgeç üretir (`shiftDefinitionId` sorgu anahtarı). */
  shiftDefinitionId: string;
  shift: { code: string; name: string }; startsAt: string; endsAt: string; isCancelled: boolean;
  uretim: { unitsActual: number; producedM: number | null };
  durusSec: number;
  kaynakKirilimi: SourceBreakdownTable;
  ozet: { olculen: number; elle: number; simule: number; cikarim: number; olculemedi: number; toplamSatir: number };
  makineler: ShiftMachineRow[];
}
export interface ShiftScorecardReport { vardiyalar: ShiftRow[]; meta: LoomReportMeta }

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
export interface ShiftStatListMeta { total: number; truncated: boolean; live: number; sealed: number }

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
  for (const [k, v] of Object.entries(p) as Array<[string, string | undefined]>) if (v) s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : "";
}

export const dokumaReportsApi = {
  efficiency: async (p: RangeParams) =>
    (await apiClient.get<ApiResponse<EfficiencyReport> & WithSuzgec>(`/api/reports/dokuma/randiman${qs(p)}`)).data,
  pareto: async (p: RangeParams) =>
    (await apiClient.get<ApiResponse<ParetoReport> & WithSuzgec>(`/api/reports/dokuma/durus-pareto${qs(p)}`)).data,
  shiftScorecard: async (p: { factoryDay: string; shiftDefinitionId?: string; warpBeamId?: string; lotNo?: string }) =>
    (await apiClient.get<ApiResponse<ShiftScorecardReport> & WithSuzgec>(`/api/reports/dokuma/vardiya-karnesi${qs(p)}`)).data,
  shiftStats: async (p: RangeParams & { sealState?: SealState }) =>
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
