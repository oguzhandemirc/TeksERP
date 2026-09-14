// =============================================================================
// DOKUMA İŞİ (WeavingOrder) — tablet yalnız OKUR: koşum açarken iş emri seçici
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
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export const weavingOrderService = {
  /** Açık (PLANNED · IN_PROGRESS) işler — en yeni önce, ilk 100. Fasona verilmiş iş koşum ALAMAZ; süzme istemcide. */
  listOpen: (): Promise<WeavingOrderSummary[]> =>
    apiClient
      .get<CursorPage<WeavingOrderSummary>>('/weaving-orders', { params: { status: 'PLANNED,IN_PROGRESS', limit: 100 } })
      .then((r) => r.data.data.filter((o) => o.executionKind === 'IN_HOUSE')),
};
