// =============================================================================
// DOKUMA İŞİ GENEL BAKIŞ — panel tipleri (backend `WeavingOrderOverviewDto` aynası)
// =============================================================================
// Uç: `GET /api/weaving-orders/:id/overview` (salt okuma). Her alan OPSİYONEL okunur:
// eski backend alanı göndermezse bölüm çizilmez, panel çökmez. İki metre AYRIDIR
// (top `rollMeters` ↔ koşum `runMeters`); null "ölçülemedi" demektir, 0 değil.
// =============================================================================
import type { WarpBeamStatus } from "@/pages/Operations/WarpBeams/types";
import type { WeavingExecutionKind, WeavingOrder } from "../types";

export interface CappedList<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export interface MachineRef {
  id: string;
  code: string;
  name: string;
}

export interface OverviewProgress {
  plannedM: number | null;
  rollCount: number;
  rollMeters: number | null;
  runMeters: number | null;
  closedRunCount: number;
  unmeasuredRunCount: number;
  doffCount: number;
  fasonReceivedM: number | null;
}

export interface OverviewMountedBeam {
  id: string;
  beamNo: string;
  position: number | null;
  warpSpecCode: string;
  remainingM: number;
  plannedLengthM: number;
}

export interface OverviewLiveRun {
  id: string;
  machine: MachineRef;
  productionLineNo: number;
  startedAt: string;
  targetUnitsPerMin: number | null;
  doffCount: number;
  openStop: { id: string; reasonCode: string | null; reasonLabel: string | null; lossClass: string | null; startedAt: string } | null;
  operator: { name: string; since: string } | null;
  /** null = levent bağı ölçülmüyor (bölüm çizilmez). */
  beams: OverviewMountedBeam[] | null;
}

export interface OverviewRecentRun {
  id: string;
  machine: MachineRef;
  productionLineNo: number;
  startedAt: string;
  endedAt: string | null;
  producedM: number | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface OverviewDoff {
  id: string;
  code: string;
  machine: MachineRef;
  productionLineNo: number;
  doffedAt: string;
  pieceCount: number;
  rolls: Array<{ id: string; barcode: string | null; initialQty: number; status: string }>;
}

export interface OverviewBeam {
  id: string;
  beamNo: string;
  status: WarpBeamStatus;
  plannedLengthM: number;
  remainingM: number;
  warpSpecCode: string;
  currentMachine: { id: string; code: string } | null;
}

export interface WeavingOrderOverview {
  asOf?: string;
  order?: WeavingOrder;
  executionKind?: WeavingExecutionKind;
  progress?: OverviewProgress;
  liveRuns?: CappedList<OverviewLiveRun>;
  recentRuns?: CappedList<OverviewRecentRun>;
  recentDoffs?: CappedList<OverviewDoff>;
  /** null = devere kapalı (bölüm çizilmez). */
  beams?: CappedList<OverviewBeam> | null;
  beamTracking?: boolean;
}
