// Fason kokpiti (F10) — backend `services/subcontractor/types.ts` `SubcontractorCockpit*` aynası. Sayılar string.
export const COCKPIT_STATES = ["ALL", "OVERDUE", "DUE_SOON", "NO_DUE_DATE"] as const;
export type CockpitState = (typeof COCKPIT_STATES)[number];

export interface CockpitFilter {
  state: CockpitState;
  subcontractorId: string | null;
  categoryId: string | null;
}

export interface SubcontractorCockpitRow {
  dispatchId: string;
  dispatchNo: string;
  subcontractor: { id: string; name: string };
  category: { id: string; name: string } | null;
  workOrder: { id: string; orderNo: string } | null;
  weavingOrder: { id: string; orderNo: string } | null;
  dispatchedAt: string;
  expectedReturnAt: string | null;
  /** Fabrika günü farkı; termin yoksa null, gecikmede pozitif. */
  overdueDays: number | null;
  dispatchedQty: string;
  outstandingQty: string;
  outstandingRollCount: number;
  yarnOutstandingKg: string;
  beamOutstandingCount: number;
}

export interface SubcontractorCockpitFirmSummary {
  subcontractor: { id: string; name: string };
  openDispatchCount: number;
  overdueCount: number;
  outstandingQty: string;
  yarnOutstandingKg: string;
  beamOutstandingCount: number;
}

export interface SubcontractorCockpitResult {
  data: SubcontractorCockpitRow[];
  nextCursor: string | null;
  summary: {
    openDispatchCount: number;
    overdueCount: number;
    dueSoonCount: number;
    outstandingQty: string;
    firms: SubcontractorCockpitFirmSummary[];
  };
}
