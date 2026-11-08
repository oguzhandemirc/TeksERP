import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Emanet çıkış belgesi (genel fason F5 + T1) — `/consignment-dispatches` istemcisi.
// Tel tipleri backend `services/consignment-dispatch/types.ts` + `candidate-types.ts` aynası
// (yalnız tabletin okuduğu alanlar). Sayılar telde string. Çevrimiçi-only: numarayı sunucu doğurur.
// =============================================================================

export type ConsignmentBlockedCode =
  | 'CONSIGNMENT_OWNER_MISMATCH'
  | 'CONSIGNMENT_BEAM_NOT_READY'
  | 'CONSIGNMENT_YARN_INSUFFICIENT'
  | 'YARN_LOT_INACTIVE';

export interface BeamCandidate {
  warpBeamId: string;
  beamNo: string;
  warpSpecName: string | null;
  remainingM: string;
  blockedReason: string | null;
}

export interface YarnCandidate {
  lotId: string;
  lotNo: string;
  yarnItemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  balanceKg: string;
  blockedReason: string | null;
}

/** Sahip seçici — yalnız emaneti olan müşteriler, yalnız kimlik alanları (müşteri kartı okunmaz). */
export interface ConsignmentOwner {
  id: string;
  code: string;
  name: string;
}

export interface ConsignmentCandidates {
  ownerCustomer: { id: string; name: string };
  modules: { devere: boolean; iplik: boolean };
  beams: BeamCandidate[];
  yarns: YarnCandidate[];
  truncated: { beams: boolean; yarns: boolean };
}

export type ConsignmentItemInput =
  | { kind: 'WARP_BEAM'; warpBeamId: string }
  | { kind: 'YARN'; yarnItemId: string; warehouseId: string; lotId: string; qtyKg: string };

export interface ConsignmentBody {
  ownerCustomerId: string;
  items: ConsignmentItemInput[];
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
}

export interface ConsignmentPreviewLine {
  kind: 'WARP_BEAM' | 'YARN';
  refId: string;
  label: string;
  qty: string;
  unit: 'METER' | 'KG';
  blockedReason: string | null;
}

export interface ConsignmentPreview {
  lines: ConsignmentPreviewLine[];
  totals: { beamCount: number; beamLengthM: string; yarnKg: string };
  canCreate: boolean;
  warnings: string[];
}

export interface CreatedConsignmentDispatch {
  id: string;
  dispatchNo: string;
  ownerCustomer: { id: string; name: string };
  totals: { beamCount: number; beamLengthM: string; yarnKg: string };
}

export const consignmentService = {
  owners: (search: string): Promise<{ owners: ConsignmentOwner[]; truncated: boolean }> =>
    apiClient
      .get<ApiResponse<{ owners: ConsignmentOwner[]; truncated: boolean }>>('/consignment-dispatches/owners', {
        params: search.trim() ? { search: search.trim() } : {},
      })
      .then((r) => r.data.data),

  candidates: (ownerCustomerId: string, search: string): Promise<ConsignmentCandidates> =>
    apiClient
      .get<ApiResponse<ConsignmentCandidates>>('/consignment-dispatches/candidates', {
        params: search.trim() ? { ownerCustomerId, search: search.trim() } : { ownerCustomerId },
      })
      .then((r) => r.data.data),

  /** Yazmaz; engelli kalem `blockedReason` taşır (oluştur aynı yüklemle 409 verir). */
  preview: (body: ConsignmentBody): Promise<ConsignmentPreview> =>
    apiClient.post<ApiResponse<ConsignmentPreview>>('/consignment-dispatches/preview', body).then((r) => r.data.data),

  /** 201 yeni · 200 replay (aynı token aynı belge). Token mantıksal deneme başına. */
  create: (body: ConsignmentBody & { clientToken: string }): Promise<CreatedConsignmentDispatch> =>
    apiClient.post<ApiResponse<CreatedConsignmentDispatch>>('/consignment-dispatches', body).then((r) => r.data.data),
};
