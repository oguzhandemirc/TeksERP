import { apiClient } from './api';

// =============================================================================
// Sevke hazır işler (D4-J4) — `GET /api/shipping/ready-works` (D4-J1). Hazırlık SUNUCUDA türetilir;
// istemci yalnız gösterir. Sevk kapısı board'una (sack-store/board) EKLENMEZ — ayrı tek istek.
// Eski backend (uç yok) 404 → `null`: çip/liste çizilmez, hata gösterilmez.
// =============================================================================

export type ReadyWorkUnit = 'workOrder' | 'deliveryNote' | 'customer';
export type ReadyWorkState = 'READY' | 'PARTIAL' | 'NONE';

export interface ReadyWorkRow {
  unit: ReadyWorkUnit;
  id: string;
  label: string;
  customerId: string | null;
  customerName: string | null;
  state: ReadyWorkState;
  readyCount: number;
  readyMeters: number;
  inProcessCount: number;
  inProcessMeters: number;
  shippedMeters: number;
  targetMeters: number | null;
}

interface ReadyWorkListBody {
  success: boolean;
  data: { items: ReadyWorkRow[]; nextCursor: string | null };
}

/** Sevk kapısı çipinin gösterdiği durumlar — NONE (hiç hazır top yok) çip üretmez. */
const CHIP_STATES = 'READY,PARTIAL';
/** Uç üst sınırı; müşteri birimi başına tek satır olduğundan tek sayfa yeter. */
const CUSTOMER_LIMIT = 200;

function isMissingEndpoint(err: unknown): boolean {
  return (err as { status?: number } | null)?.status === 404;
}

async function fetchReadyWorks(params: Record<string, string>): Promise<ReadyWorkRow[] | null> {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await apiClient.get<ReadyWorkListBody>(`/shipping/ready-works?${qs}`);
    return Array.isArray(res.data?.data?.items) ? res.data.data.items : [];
  } catch (e) {
    // Eski backend: uç yok → özellik yok sayılır (çip yok, tost yok). Diğer hatalar çağırana.
    if (isMissingEndpoint(e)) return null;
    throw e;
  }
}

export const readyWorksService = {
  /** Müşteri başına hazırlık (groupBy=customer) — Sevk kapısı çip şeridi. 404 → null. */
  listCustomers: (): Promise<ReadyWorkRow[] | null> =>
    fetchReadyWorks({ groupBy: 'customer', state: CHIP_STATES, limit: String(CUSTOMER_LIMIT) }),

  /** Çipe dokununca: o müşterinin hazır işleri (iş emri ya da gelen belge ekseninde). */
  listCustomerWorks: (customerId: string, unit: 'workOrder' | 'deliveryNote'): Promise<ReadyWorkRow[] | null> =>
    fetchReadyWorks({ groupBy: unit, state: CHIP_STATES, customerId, limit: String(CUSTOMER_LIMIT) }),
};
