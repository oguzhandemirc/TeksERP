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
import type { WarpBeamMountMethod, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WarpLengthSource, YarnLotQualityStatus } from '../types/models';

export type { WarpBeamMountMethod, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WarpLengthSource };

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
  /** Z1: bağlı dokuma işi (plan/sarım anında set); eski sunucu göndermez → undefined. */
  weavingOrder?: { id: string; weavingOrderNumber: string } | null;
  weavingOrderId?: string | null;
  subcontractor: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  wound: WarpBeamEvent | null;
  remainingM: number;
  createdAt: string;
  /** Faz 3: yalnız MOUNTED'da dolu; eski sunucu göndermez → undefined (ekran "—"). */
  currentPosition?: number | null;
  currentMachine?: { id: string; code: string; name: string } | null;
}

export interface TabletContext {
  warpSpecs: { id: string; code: string; name: string; endsCount: number; denier: number | null }[];
  machines: { id: string; code: string; name: string; stationName: string }[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  subcontractors: { id: string; name: string }[];
  suppliers: { id: string; name: string; type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH'; isCustomerRole: boolean; isSupplierRole: boolean; isSubcontractorRole: boolean }[];
  /** Faz 2 (lot): kart ipliklerinin aktif lotları, türetilen bakiyeyle. Eski sunucu göndermez → form lot sormaz. */
  yarnLots?: { id: string; lotNo: string; itemId: string; balanceKg: number; qualityStatus?: YarnLotQualityStatus }[];
  /** Kalite bekletme etkin mi — rozet/uyarı için; kapı sunucuda. */
  yarnQualityHold?: boolean;
  /** `devere.lotRequired` SUNUCUDAN — istemci tahmin etmez; alan yoksa false (bugünkü davranış). */
  lotRequired?: boolean;
  /** Faz 3 (E3): levent BAĞLANABİLEN makineler (yuva sayısıyla). Eski sunucu göndermez → sekme yok. */
  loomMachines?: { id: string; code: string; name: string; stationName: string; warpBeamSlots: number }[];
  /** `devere.mountTracking` / `devere.mountTrackingRequired` SUNUCUDAN; alan yoksa false. */
  mountTracking?: boolean;
  mountTrackingRequired?: boolean;
  /** Z1 üretim belge zinciri: açık IN_HOUSE dokuma işleri (machine-run bağlamıyla aynı biçim) — Plan "Dokuma işi" seçicisi. Eski sunucu göndermez → alan çizilmez. */
  weavingOrders?: {
    id: string;
    weavingOrderNumber: string;
    status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    plannedM: number | null;
    item: { id: string; code: string; name: string };
    warpSpec: { id: string; code: string; name: string } | null;
  }[];
  /** `devere.beamWeavingLinkRequired` ETKİN değeri SUNUCUDAN — form zorunluluğu buradan okur, tahmin etmez (sunucu da 400 verir). Alan yoksa false. */
  beamWeavingLinkRequired?: boolean;
}

/** Backend `mountSchema` ile birebir (.strict). */
export interface MountWarpBeamRequest {
  machineId: string;
  position: number;
  mountMethod: WarpBeamMountMethod | null;
  setupStartedAt: string | null;
  machineCounter: number | null;
  clientToken: string;
}
/** Backend `dismountSchema` ile birebir. */
export interface DismountWarpBeamRequest {
  remainingM: number | null;
  lengthSource: WarpLengthSource | null;
  machineCounter: number | null;
}
/** Backend `consumeSchema` ile birebir. */
export interface ConsumeWarpBeamRequest {
  lengthM: number;
  lengthSource: WarpLengthSource;
  machineCounter: number | null;
  clientToken: string;
}
/** Backend `exhaustSchema` ile birebir. */
export interface ExhaustWarpBeamRequest {
  residualM: number | null;
  lengthSource: WarpLengthSource | null;
}
export interface MountedBeam {
  id: string;
  beamNo: string;
  position: number | null;
  warpSpecCode: string;
  remainingM: number;
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
  /** Z1: bağlı dokuma işi (opsiyonel); backend `createSchema` `uuidOrNull`. */
  weavingOrderId: string | null;
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
  /** Z1: sarım anında dokuma işi bağı (plandaki iş; backend `windSchema` `uuidOrNull`). */
  weavingOrderId?: string | null;
  clientToken: string;
  /** Raşel takımı (#23): N adet → N−1 kardeş aynı işlemde doğar, iplik ÷ N; 1 ise alanlar GÖNDERİLMEZ (bugünkü istek). */
  count?: number;
  physicalBeamNoPrefix?: string | null;
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
  wind: async (id: string, body: WindWarpBeamRequest): Promise<ApiResponse<WarpBeam & { siblings?: { id: string; beamNo: string }[] }>> =>
    (await apiClient.post<ApiResponse<WarpBeam & { siblings?: { id: string; beamNo: string }[] }>>(`/warp-beams/${id}/wind`, body)).data,
  cancelPreview: async (id: string): Promise<CancelWoundPreview> => {
    const res = await apiClient.get<ApiResponse<CancelWoundPreview>>(`/warp-beams/${id}/cancel-preview`);
    return res.data.data as CancelWoundPreview;
  },
  cancel: async (id: string, reason: string): Promise<ApiResponse<WarpBeam>> =>
    (await apiClient.post<ApiResponse<WarpBeam>>(`/warp-beams/${id}/cancel`, { reason })).data,
  // ── Faz 3 tezgah bağı (E3): Tak devere ekranından, Sök/Tüket/Bitir tezgah ekranından ──
  mountedOnMachine: async (machineId: string): Promise<MountedBeam[]> => {
    const res = await apiClient.get<ApiResponse<MountedBeam[]>>(`/warp-beams/mounted/${machineId}`);
    return res.data.data ?? [];
  },
  mount: async (id: string, body: MountWarpBeamRequest): Promise<ApiResponse<WarpBeam>> => (await apiClient.post<ApiResponse<WarpBeam>>(`/warp-beams/${id}/mount`, body)).data,
  dismount: async (id: string, body: DismountWarpBeamRequest): Promise<ApiResponse<WarpBeam>> => (await apiClient.post<ApiResponse<WarpBeam>>(`/warp-beams/${id}/dismount`, body)).data,
  consume: async (id: string, body: ConsumeWarpBeamRequest): Promise<ApiResponse<WarpBeam>> => (await apiClient.post<ApiResponse<WarpBeam>>(`/warp-beams/${id}/consume`, body)).data,
  exhaust: async (id: string, body: ExhaustWarpBeamRequest): Promise<ApiResponse<WarpBeam>> => (await apiClient.post<ApiResponse<WarpBeam>>(`/warp-beams/${id}/exhaust`, body)).data,
};
