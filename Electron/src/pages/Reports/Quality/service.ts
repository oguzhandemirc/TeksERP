import { reportsClient } from "../_services/reportsClient";
import type { BreakdownRow } from "../_components/BreakdownTable";
import type { ReportCompareParams } from "../_services/types";

// ---------- Kalite Karnesi (backend quality-scorecard.report.service ile birebir)

export interface GradeShare {
  gradeId: string | null;
  code: string;
  name: string;
  sortOrder: number;
  rollCount: number;
  qty: number;
  pct: number;
  prevQty?: number;
  prevPct?: number;
}

export interface ScorecardBreakdownRow {
  key: string;
  label: string;
  rollCount: number;
  totalQty: number;
  topGradeQty: number;
  topGradePct: number;
  qtyByGrade: Record<string, number>;
  prevTotalQty?: number;
  prevTopGradePct?: number;
}

export interface QualityScorecard {
  summary: {
    rollCount: number;
    totalQty: number;
    gradedQty: number;
    ungradedQty: number;
    topGrade: { code: string; name: string; qty: number; pct: number } | null;
    prevRollCount?: number;
    prevTotalQty?: number;
    prevTopGradePct?: number;
  };
  grades: GradeShare[];
  byItem: ScorecardBreakdownRow[];
  byColor: ScorecardBreakdownRow[];
  bySubcontractor: ScorecardBreakdownRow[];
  daily: Array<{ day: string; totalQty: number; topGradeQty: number; topGradePct: number }>;
  topGradeCode: string | null;
  gradeOrder: Array<{ code: string; name: string }>;
  unanchoredRollCount: number;
}

// ---------- Fire Karnesi (backend scrap-scorecard.report.service ile birebir)

export interface DefectDetectionRow {
  key: string;
  label: string;
  count: number;
  cutCount: number;
  noCutCount: number;
  openCount: number;
  prevCount?: number;
}

export interface ScrapScorecard {
  summary: {
    scrapQty: number;
    scrapRollCount: number;
    /** Dönemde üretimi biten TOPLAM metraj — Kalite Karnesi ile birebir aynı. */
    producedQty: number;
    scrapPct: number;
    /** Çıpası AYRI (detectedAt) — hurda metrajıyla toplanamaz, o yüzden ADET. */
    defectsDetected: number;
    defectsOpen: number;
    prevScrapQty?: number;
    prevScrapPct?: number;
    prevDefectsDetected?: number;
  };
  scrapByDefect: BreakdownRow[];
  byItem: BreakdownRow[];
  byColor: BreakdownRow[];
  bySource: BreakdownRow[];
  detectionByStation: DefectDetectionRow[];
  detectionByDefect: DefectDetectionRow[];
  daily: Array<{ day: string; scrapQty: number; scrapCount: number }>;
}

// ---------- Plan-Sapma Karnesi (backend plan-deviation-scorecard ile birebir)

export interface PlanDeviationBreakdownRow {
  key: string;
  label: string;
  /** İmza (onay) sayısı — DISTINCT confirmationId. */
  confirmations: number;
  qtyM: number;
}

export interface PlanDeviationDetailRow {
  id: string;
  createdAt: string;
  rollBarcode: string | null;
  childBarcode: string | null;
  workOrderNumber: string;
  field: string;
  rollValue: string | null;
  planValue: string | null;
  qtyM: number;
  source: string;
  confirmedBy: string | null;
}

export interface PlanDeviationScorecard {
  summary: {
    /** "Kaç kez plan dışına çıkıldı" — imza sayısı. */
    confirmations: number;
    /** Plan dışı depoya inen metraj (imza başına TEK sayılır). */
    deviatedQtyM: number;
    /** Alan bazlı OLAY sayısı — aynı imzada renk+en saparsa ikisi de sayılır. */
    byField: { color: { events: number; qtyM: number }; width: { events: number; qtyM: number } };
    affectedRolls: number;
  };
  previous: { confirmations: number; deviatedQtyM: number } | null;
  byOperator: PlanDeviationBreakdownRow[];
  byItemColor: PlanDeviationBreakdownRow[];
  daily: Array<{ day: string; confirmations: number; qtyM: number }>;
  detail: PlanDeviationDetailRow[];
}

export const qualityReportsApi = {
  scorecard: (p: ReportCompareParams) => reportsClient.get<QualityScorecard>("quality/scorecard", p),
  scrapScorecard: (p: ReportCompareParams) =>
    reportsClient.get<ScrapScorecard>("quality/scrap-scorecard", p),
  planDeviationScorecard: (p: ReportCompareParams) =>
    reportsClient.get<PlanDeviationScorecard>("quality/plan-deviation-scorecard", p),
};