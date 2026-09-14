// =============================================================================
// LEVENT (WarpBeam) API istemcisi — plan · sar · taslak sil · iptal (devere tablet dilimi)
// =============================================================================
// Backend `/warp-beams` (`requireDevereEnabled`; liste/plan/sar/taslak-sil `mobile:devere`,
// önizleme+iptal `mobile:devere-iptal`). Form bağlamı TEK uç (`/tablet-context`) —
// operatöre çözgü/depo/cari okuma izinleri DAĞITILMAZ (DEVERE-LEVENT-TARAMASI §11 D2).
// Kuyruk YOK: iplik çıkışı deftere yazar, eksi-bakiye kapısı sunucudadır (§11 D).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { WarpBeamOrigin, WarpBeamStatus, WarpKgSource } from '../types/models';

export type { WarpBeamOrigin, WarpBeamStatus, WarpKgSource };

export interface WarpBeamEvent {
  id: string;
  kind: 'WOUND' | 'WOUND_CANCEL';
  lengthM: number;
  machine: { id: string; code: string; name: string } | null;
  theoreticalKg: number | null;
  kgSource: WarpKgSource | null;
  breakCount: number | null;
  createdAt: string;
}

export interface WarpBeam {
  id: string;
  beamNo: string;
  status: WarpBeamStatus;
  plannedLengthM: number;
  physicalBeamNo: string | null;
  notes: string | null;
  originKind: WarpBeamOrigin;
  warpSpec: { id: string; code: string; name: string; endsCount: number; yarnItem: { id: string; code: string; name: string; linearDensityDen: number | null } };
  subcontractor: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  wound: WarpBeamEvent | null;
  remainingM: number;
  createdAt: string;
}

export interface TabletContext {
  warpSpecs: { id: string; code: string; name: string; endsCount: number; denier: number | null }[];
  machines: { id: string; code: string; name: string; stationName: string }[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  subcontractors: { id: string; name: string }[];
  suppliers: { id: string; name: string; type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH' }[];
  /** Faz 2 (lot): kart ipliklerinin aktif lotları, türetilen bakiyeyle. Eski sunucu göndermez → form lot sormaz. */
  yarnLots?: { id: string; lotNo: string; itemId: string; balanceKg: number }[];
  /** `devere.lotRequired` SUNUCUDAN — istemci tahmin etmez; alan yoksa false (bugünkü davranış). */
  lotRequired?: boolean;
}

/** Backend `createSchema` ile birebir (.strict — fazla anahtar 400). */
export interface PlanWarpBeamRequest {
  warpSpecId: string;
  plannedLengthM: number;
  originKind: WarpBeamOrigin;
  subcontractorId: string | null;
  supplierId: string | null;
  physicalBeamNo: string | null;
  notes: string | null;
  clientToken: string;
}

export interface YarnLineRequest {
  warehouseId: string;
  qtyKg: number;
  /** Faz 2: lot etiketi; null = lotsuz (sunucu uyarır, lotRequired açıksa 400). */
  lotId: string | null;
}

/** Backend `windSchema` ile birebir. */
export interface WindWarpBeamRequest {
  lengthM: number;
  kgSource: WarpKgSource;
  machineId: string | null;
  yarnIssues: YarnLineRequest[];
  yarnReturns: (YarnLineRequest & { reasonCode: string })[];
  breakCount: number | null;
  clientToken: string;
}

export interface CancelWoundPreview {
  beamNo: string;
  status: WarpBeamStatus;
  wound: { lengthM: number } | null;
  issueReversals: { warehouse: { id: string; name: string }; qtyKg: number }[];
  returnReversals: { warehouse: { id: string; name: string }; reasonCode: string; qtyKg: number }[];
}

interface CursorPage<T> {
  success: boolean;
  data: T[];
  pagination?: { nextCursor: string | null; hasMore: boolean };
}

export const warpBeamService = {
  /** `status` tek değer ya da liste — sunucu CSV okur (`readFilterList`). */
  list: async (status: WarpBeamStatus | readonly WarpBeamStatus[], limit = 50): Promise<WarpBeam[]> => {
    const res = await apiClient.get<CursorPage<WarpBeam>>('/warp-beams', { params: { status: Array.isArray(status) ? status.join(',') : status, limit } });
    return res.data.data ?? [];
  },
  tabletContext: async (): Promise<TabletContext> => {
    const res = await apiClient.get<ApiResponse<TabletContext>>('/warp-beams/tablet-context');
    return res.data.data as TabletContext;
  },
  plan: async (body: PlanWarpBeamRequest): Promise<ApiResponse<WarpBeam>> => (await apiClient.post<ApiResponse<WarpBeam>>('/warp-beams', body)).data,
  deleteDraft: async (id: string): Promise<ApiResponse<{ id: string }>> => (await apiClient.delete<ApiResponse<{ id: string }>>(`/warp-beams/${id}`)).data,
  wind: async (id: string, body: WindWarpBeamRequest): Promise<ApiResponse<WarpBeam>> =>
    (await apiClient.post<ApiResponse<WarpBeam>>(`/warp-beams/${id}/wind`, body)).data,
  cancelPreview: async (id: string): Promise<CancelWoundPreview> => {
    const res = await apiClient.get<ApiResponse<CancelWoundPreview>>(`/warp-beams/${id}/cancel-preview`);
    return res.data.data as CancelWoundPreview;
  },
  cancel: async (id: string, reason: string): Promise<ApiResponse<WarpBeam>> =>
    (await apiClient.post<ApiResponse<WarpBeam>>(`/warp-beams/${id}/cancel`, { reason })).data,
};
