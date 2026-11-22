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
  /** Ek-2 r: yeniden sarılması beklenen reddedilmiş sarımlar. Eski sunucu göndermez → boş say. */
  reworkCandidates?: ReworkCandidate[];
}

export interface ReworkCandidate { beamId: string; beamNo: string; lengthM: string | null; bodyNo: string | null; rejectionDocNo: string }

export interface WarpingTabletContext {
  subcontractors: { id: string; name: string; openOrderCount: number }[];
  orders: WarpingTabletOrder[];
  truncated: boolean;
  /** `rejectPhotoRequired` ek-2 r; eski sunucu göndermez (sunucu yine 400 ile korur).
   *  `beamCardAutoPrint` S5t (`devere.beamCardAutoPrint`); eski sunucu göndermez → OFF (bugünkü davranış). */
  settings: { beamBodyMode: DevereMode3; receiveWeighing: DevereMode3; duplicateDeliveryNote: DuplicateNoteMode; rejectPhotoRequired?: boolean; beamCardAutoPrint?: 'OFF' | 'ASK' | 'ALWAYS' };
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
  /** Ek-2 r: bu levent hangi reddedilen sarımın yeniden sarımı (aynı sipariş). */
  reworkOfBeamId?: string;
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

// ── Ek-2 r: kusurlu levent reddi (panelle AYNI uçlar; liste/iptal/foto ekleme panelde) ──
export interface RejectLookup {
  beam: { id: string; beamNo: string; status: string; physicalBeamNo: string | null; bodyNo: string | null; lengthM: string | null };
  order: { id: string; orderNo: string; subcontractor: { id: string; name: string } };
}
export interface RejectFields {
  warpingOrderId: string;
  beamIds: string[];
  reasonCode: string;
  reasonText: string | null;
  notes: string | null;
  expectRework: boolean;
}
export interface RejectPreview {
  beams: { id: string; beamNo: string; lengthM: string | null; bodyNo: string | null; blocker: string | null }[];
  /** Backend `RejectYarnLine` (beam-rejection-read.ts) alt kümesi — retle deverecinin tutmasına dönecek iplik. */
  returnedYarn: { yarnItemId: string; code: string; name: string; dispatchNo: string; lotNo: string | null; holderOrderNo: string; kg: string }[];
  totals: { beamCount: number; lengthM: string; nominalKg: string; returnedKg: string };
  reason: { code: string; text: string } | null;
  photoRequired: boolean;
  blockers: { code: string; message: string }[];
  warnings: string[];
  rejectable: boolean;
}
export interface RejectResult { id: string; docNo: string; mode: 'REWORK' | 'CANCEL'; items: { beamId: string; beamNo: string }[] }
/** Sunucu sınırı `WARPING_REJECT_PHOTOS_PER_REQUEST` (beam-rejection-photo.ts) ile aynı. */
export const REJECT_MAX_PHOTOS = 3;

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
  /** Ret okutması: levent etiketi / gövde QR / gövde no → sarım + sipariş (`mobile:devere-ret`). */
  rejectLookup: async (code: string): Promise<RejectLookup> =>
    (await apiClient.get<ApiResponse<RejectLookup>>('/warping-beam-rejections/lookup', { params: { code } })).data.data,
  rejectPreview: async (body: RejectFields & { photoCount: number }): Promise<RejectPreview> =>
    (await apiClient.post<ApiResponse<RejectPreview>>('/warping-beam-rejections/preview', body)).data.data,
  reject: async (body: RejectFields & { clientToken: string; photos: { fileName: string; contentBase64: string }[] }): Promise<ApiResponse<RejectResult>> =>
    (await apiClient.post<ApiResponse<RejectResult>>('/warping-beam-rejections', body)).data,
  preview: async (body: ReceiveDocFields): Promise<ReceiveDocPreview> =>
    (await apiClient.post<ApiResponse<ReceiveDocPreview>>('/warping-receive-docs/preview', body)).data.data,
  create: async (body: ReceiveDocFields & { clientToken: string }): Promise<ApiResponse<ReceiveDocResult>> =>
    (await apiClient.post<ApiResponse<ReceiveDocResult>>('/warping-receive-docs', body)).data,
};
