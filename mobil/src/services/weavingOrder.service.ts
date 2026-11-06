// =============================================================================
// DOKUMA İŞİ (WeavingOrder) — tablet yalnız OKUR: koşum açarken iş emri seçici · İş Emirleri › Dokuma listesi + genel bakış
// =============================================================================
import { apiClient } from './api';

export interface WeavingOrderRef {
  id: string;
  code: string;
  name: string;
}

export interface WeavingOrderSummary {
  id: string;
  weavingOrderNumber: string;
  itemId: string;
  colorId: string | null;
  plannedM: number | null;
  executionKind: 'IN_HOUSE' | 'SUBCONTRACTED';
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  item: WeavingOrderRef;
  color: WeavingOrderRef | null;
  subcontractor: WeavingOrderRef | null;
}

interface CursorPage<T> {
  success: boolean;
  data: T[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number };
}

/** İş Emirleri › Dokuma listesinin okuduğu satır. `openRunMachines`/`producedM` 2026-11-06 sunucusundan; eskisinde YOK. */
export interface WeavingOrderListRow extends WeavingOrderSummary {
  createdAt: string;
  openRunCount?: number;
  weaveDesign?: WeavingOrderRef | null;
  openRunMachines?: WeavingOrderRef[];
  producedM?: number | null;
}

type MachineRef = WeavingOrderRef;
export interface CappedList<T> { items: T[]; total: number; truncated: boolean }

/** `GET /weaving-orders/:id/overview` — tabletin okuduğu alt küme (backend `WeavingOrderOverviewDto`). */
export interface WeavingOrderOverview {
  asOf: string;
  order: WeavingOrderListRow & { notes?: string | null; plannedStartDate?: string | null; plannedEndDate?: string | null; warpSpec?: WeavingOrderRef | null };
  executionKind: 'IN_HOUSE' | 'SUBCONTRACTED';
  progress: { plannedM: number | null; rollCount: number; rollMeters: number | null; runMeters: number | null; closedRunCount: number; unmeasuredRunCount: number; doffCount: number; fasonReceivedM: number | null };
  liveRuns: CappedList<{
    id: string;
    machine: MachineRef;
    productionLineNo: number;
    startedAt: string;
    doffCount: number;
    openStop: { reasonLabel: string | null; reasonCode: string | null; startedAt: string } | null;
    operator: { name: string; since: string } | null;
    beams: { id: string; beamNo: string; remainingM: number; plannedLengthM: number }[] | null;
  }>;
  recentRuns: CappedList<{ id: string; machine: MachineRef; productionLineNo: number; startedAt: string; endedAt: string | null; producedM: number | null; revokedAt: string | null }>;
  recentDoffs: CappedList<{ id: string; code: string; machine: MachineRef; productionLineNo: number; doffedAt: string; pieceCount: number; rolls: { id: string; barcode: string | null; initialQty: number }[] }>;
  beams: CappedList<{ id: string; beamNo: string; status: string; plannedLengthM: number; remainingM: number; currentMachine: { id: string; code: string } | null }> | null;
  beamTracking: boolean;
}

export interface WeavingListParams {
  status?: string;
  search?: string;
  cursor?: string | null;
  limit: number;
  withTotal?: boolean;
}

export const weavingOrderService = {
  /** Açık (PLANNED · IN_PROGRESS) işler — en yeni önce, ilk 100. Fasona verilmiş iş koşum ALAMAZ; süzme istemcide. */
  listOpen: (): Promise<WeavingOrderSummary[]> =>
    apiClient
      .get<CursorPage<WeavingOrderSummary>>('/weaving-orders', { params: { status: 'PLANNED,IN_PROGRESS', limit: 100 } })
      .then((r) => r.data.data.filter((o) => o.executionKind === 'IN_HOUSE')),

  /** İş Emirleri › Dokuma listesi — süzme sunucuda (status CSV + search), cursor'lu, en yeni önce. */
  listPage: (p: WeavingListParams, opts?: { signal?: AbortSignal }): Promise<CursorPage<WeavingOrderListRow>> =>
    apiClient
      .get<CursorPage<WeavingOrderListRow>>('/weaving-orders', {
        params: { status: p.status, search: p.search, cursor: p.cursor ?? undefined, limit: p.limit, withTotal: p.withTotal ? 'true' : undefined },
        signal: opts?.signal,
      })
      .then((r) => r.data),

  /** Satır detayı: koşum · levent · indirme özeti (salt okuma). */
  overview: (id: string): Promise<WeavingOrderOverview> =>
    apiClient.get<{ success: boolean; data: WeavingOrderOverview }>(`/weaving-orders/${id}/overview`).then((r) => r.data.data),
};
