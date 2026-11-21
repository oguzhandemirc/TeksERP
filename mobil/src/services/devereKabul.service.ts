// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — MOBİL SERVİS (devere ek M1, 2026-11-21)
// =============================================================================
// Bağlam `GET /warping-orders/tablet-context` (OPT-IN allowlist, ücret/iplik inmez); gövde QR
// `GET /beam-bodies/resolve`; kabul panelle AYNI belge ucu (`/warping-receive-docs` önizleme + kabul).
// Ekran izni `mobile:devere-kabul` bu uçların hepsinde kabul edilir. Kuyruk YOK (online-only).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

export type DevereMode3 = 'OFF' | 'OPTIONAL' | 'REQUIRED';
export type DuplicateNoteMode = 'ALLOW' | 'WARN' | 'BLOCK';

export interface WarpingTabletOrder {
  id: string;
  orderNo: string;
  status: string;
  subcontractor: { id: string; name: string };
  warpSpec: { name: string; code: string };
  beamLines: { beamCount: number; beamLengthM: string }[];
  plannedBeamCount: number | null;
  targetLengthM: string;
  receivedBeamCount: number;
  receivedM: string;
  remainingBeamCount: number | null;
  remainingM: string;
  expectedReturnAt: string | null;
}

export interface WarpingTabletContext {
  subcontractors: { id: string; name: string; openOrderCount: number }[];
  orders: WarpingTabletOrder[];
  truncated: boolean;
  settings: { beamBodyMode: DevereMode3; receiveWeighing: DevereMode3; duplicateDeliveryNote: DuplicateNoteMode };
  limits: { maxOrders: number; maxBeamsPerOrder: number };
}

/** `/beam-bodies/resolve` DTO'sunun tabletin okuduğu alt kümesi. */
export interface ResolvedBeamBody {
  id: string;
  bodyNo: string;
  status: string;
  statusLabel: string;
  isActive: boolean;
  owner: { kind: string; label: string };
  currentWarpBeam: { id: string; beamNo: string; status: string } | null;
}

export interface ReceiveBeamLine {
  lengthM: number;
  physicalBeamNo?: string | null;
  grossKg?: number | null;
  tareKg?: number | null;
  beamBodyId?: string;
  newBody?: { bodyNo: string | null; owner: { kind: 'OURS' } | { kind: 'WARPER'; subcontractorId: string | null } };
}

export interface ReceiveDocFields {
  subcontractorId: string | null;
  deliveryNoteNo: string | null;
  orders: { warpingOrderId: string; beams: ReceiveBeamLine[] }[];
}

export interface ReceiveDocPreview {
  subcontractorId: string;
  deliveryNoteNo: string | null;
  deliveryNoteUses: { orderNo: string; docNo: string | null; receivedAt: string }[];
  orders: {
    warpingOrderId: string;
    preview: {
      order: { id: string; orderNo: string };
      beams: { index: number; lengthM: string; nominalKg: string; weighedNetKg: string | null; body: { bodyNo: string | null; isNew: boolean } | null }[];
      incoming: { beamCount: number; lengthM: string };
      warnings: string[];
    };
  }[];
  totals: { orderCount: number; beamCount: number; lengthM: string };
  warnings: string[];
}

export interface ReceiveDocResult {
  id: string;
  docNo: string;
  deliveryNoteNo: string | null;
  orders: { warpingOrderId: string; orderNo: string; receipt: { beams: { id: string; beamNo: string; physicalBeamNo: string | null; lengthM: string | null }[] } }[];
  totals: { orderCount: number; beamCount: number; lengthM: string };
}

export const devereKabulService = {
  context: async (subcontractorId: string | null): Promise<WarpingTabletContext> => {
    const res = await apiClient.get<ApiResponse<WarpingTabletContext>>('/warping-orders/tablet-context', { params: subcontractorId ? { subcontractorId } : {} });
    return res.data.data;
  },
  /** Gövde QR/no → gövde; tanımsızsa `null` (404 BEAM_BODY_NOT_FOUND). Diğer hatalar fırlar. */
  resolveBody: async (code: string): Promise<ResolvedBeamBody | null> => {
    try {
      const res = await apiClient.get<ApiResponse<ResolvedBeamBody>>('/beam-bodies/resolve', { params: { code } });
      return res.data.data;
    } catch (e) {
      const err = e as { status?: number; details?: { code?: string } } | null;
      if (err?.status === 404 && err.details?.code === 'BEAM_BODY_NOT_FOUND') return null;
      throw e;
    }
  },
  preview: async (body: ReceiveDocFields): Promise<ReceiveDocPreview> =>
    (await apiClient.post<ApiResponse<ReceiveDocPreview>>('/warping-receive-docs/preview', body)).data.data,
  create: async (body: ReceiveDocFields & { clientToken: string }): Promise<ApiResponse<ReceiveDocResult>> =>
    (await apiClient.post<ApiResponse<ReceiveDocResult>>('/warping-receive-docs', body)).data,
};
