// K4P-PANEL — 4 puan muayene uçları (`/api/quality-inspections`, MOTOR). Süzme, sayfalama ve özet şeridi
// SUNUCUDA tek where'den doğar; panel yalnız parametre taşır. Puan/derece formülü istemcide YOK (önizleme ucu).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export type InspectionPhase = "RAW" | "FINAL";
export type DefectSizeClass = "UP_TO_3IN" | "IN_3_TO_6" | "IN_6_TO_9" | "OVER_9IN";
export type WidthSource = "MANUAL" | "ITEM_CARD" | "ROLL_MEASURED" | "UNKNOWN";
type Dec = string | number | null;
type UserRef = { id: string; fullName: string } | null;

export interface InspectionListRow {
  id: string; phase: InspectionPhase; revision: number; totalPoints: number; defectCount: number; unplacedDefectCount: number;
  pointsPer100M2: Dec; gradeScore: Dec; suggestedGradeCode: string | null; gradeMismatch: boolean; widthCm: Dec;
  widthSource: WidthSource; inspectedLengthM: Dec; inspectedAt: string; supersededAt: string | null; voidedAt: string | null; createdAt: string;
  roll: { id: string; barcode: string | null; qualityGrade: string | null; item: { id: string; code: string; name: string } | null };
  station: { id: string; name: string } | null;
  inspectedBy: UserRef;
}
export interface InspectionSummary {
  total: number; avgPointsPer100M2: Dec; mismatch: number;
  /** Eski sunucuda yok (K4P-PANEL ekledi) → "—". */
  widthUnknown?: number;
  grades: Array<{ code: string | null; count: number }>;
}
export interface InspectionPage { items: InspectionListRow[]; nextCursor: string | null; summary: InspectionSummary }

export interface InspectionDefect {
  id: string; startMeter: Dec; sizeClass: DefectSizeClass | null; points: number | null; errorType: string | null;
  defectTypeId: string | null; detectedAt: string | null; detectedBy: UserRef;
}
export interface InspectionHistoryRow {
  id: string; revision: number; supersedesId: string | null; supersededAt: string | null; voidedAt: string | null;
  reviseReason: string | null; voidReason: string | null; totalPoints: number; pointsPer100M2: Dec; createdAt: string;
}
export interface RuleSnapshot {
  ruleSetId: string | null; scope?: string; unit: string; runningCap: string;
  bands: Array<{ sortOrder: number; maxScore: string | null; label: string; accepted: boolean; qualityGradeId: string | null }>;
}
export interface InspectionDetail extends InspectionListRow {
  rollId: string; stationId: string | null; deviceId: string | null; ruleSetId: string | null; ruleSnapshot: RuleSnapshot | null;
  note: string | null; reviseReason: string | null; supersedesId: string | null; voidReason: string | null;
  suggestedQualityGradeId: string | null; supersededBy: { id: string } | null; supersededByUser: UserRef; voidedBy: UserRef;
  ruleSet: { id: string; name: string; unit: string } | null;
  rollErrors: InspectionDefect[];
  breakdown: { rawPoints: number; cappedPoints: number; areaM2: Dec; formula: string };
  history: InspectionHistoryRow[];
}

export interface DefectInput { defectTypeId: string; sizeClass: DefectSizeClass | null; startMeter: string | null }
export interface MeasureInput { defects: DefectInput[]; inspectedLengthM: string | null; manualWidthCm: string | null }
export interface InspectionPreview {
  totalPoints: number; cappedPoints: number; unplaced: number; widthCm: Dec; widthSource: WidthSource; pointsPer100M2: Dec;
  ruleSet: { id: string; name: string; unit: string } | null; gradeScore: Dec;
  suggested: { qualityGradeId: string | null; code: string | null; label: string; accepted: boolean } | null;
}
export interface VoidPreview {
  inspection: { id: string; phase: InspectionPhase; revision: number; totalPoints: number; defectCount: number; pointsPer100M2: Dec; suggestedGradeCode: string | null; inspectedAt: string; roll: { id: string; barcode: string | null } };
  defectCount: number; printedDocuments: string[]; active: boolean;
}
export interface InspectionWriteResult { id: string; rollId: string; revision: number }

export type InspectionListParams = Record<string, string | number | undefined | null>;

/** Boş parametreyi göndermez — sunucu boş metni "süzgeç yok" saymak zorunda kalmasın. */
export function compactParams(p: InspectionListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

const BASE = "/api/quality-inspections";
// Hata kutusu kendi cümlesini çizer; çift bildirim olmasın.
const QUIET = { suppressErrorToast: true } as const;

export const inspectionService = {
  list: (p: InspectionListParams) => apiClient.get<ApiResponse<InspectionPage>>(BASE, { params: compactParams(p) }).then((r) => r.data.data),
  get: (id: string) => apiClient.get<ApiResponse<InspectionDetail>>(`${BASE}/${id}`).then((r) => r.data.data),
  preview: (body: MeasureInput & { rollId: string }) =>
    apiClient.post<ApiResponse<InspectionPreview>>(`${BASE}/preview`, body, QUIET).then((r) => r.data.data),
  create: (body: MeasureInput & { rollId: string; phase: InspectionPhase | null; note: string | null; clientToken: string }) =>
    apiClient.post<ApiResponse<InspectionWriteResult>>(BASE, body, QUIET).then((r) => r.data.data),
  revise: (id: string, body: MeasureInput & { note: string | null; reviseReason: string; clientToken: string }) =>
    apiClient.post<ApiResponse<InspectionWriteResult>>(`${BASE}/${id}/revise`, body, QUIET).then((r) => r.data.data),
  voidPreview: (id: string) => apiClient.get<ApiResponse<VoidPreview>>(`${BASE}/${id}/void-preview`).then((r) => r.data.data),
  void: (id: string, reason: string) =>
    apiClient.post<ApiResponse<{ id: string; voidedAt: string }>>(`${BASE}/${id}/void`, { reason }, QUIET).then((r) => r.data.data),
};
