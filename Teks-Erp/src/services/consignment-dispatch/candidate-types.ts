// EMANET ÇIKIŞ ADAY LİSTESİ — tel tipi (panel `ConsignmentDispatches/types.ts` ve tablet `consignment` aynası).
// Sayılar telde string (Decimal → `toFixed(3)`); `blockedReason` dolu satır seçilemez, neden oluştur 409'uyla aynı.
import type { ConsignmentDispatchErrorCode } from "./types";

export interface ConsignmentBeamCandidate {
  warpBeamId: string;
  beamNo: string;
  warpSpecName: string | null;
  remainingM: string;
  blockedReason: ConsignmentDispatchErrorCode | null;
}

export interface ConsignmentYarnCandidate {
  lotId: string;
  lotNo: string;
  yarnItemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  balanceKg: string;
  blockedReason: ConsignmentDispatchErrorCode | null;
}

/** `GET /api/consignment-dispatches/candidates?ownerCustomerId&search&limit` yanıtının `data`sı. */
export interface ConsignmentCandidates {
  ownerCustomer: { id: string; name: string };
  /** Kapalı modülün listesi boştur (403 değil). */
  modules: { devere: boolean; iplik: boolean };
  beams: ConsignmentBeamCandidate[];
  yarns: ConsignmentYarnCandidate[];
  /** Tavan aşıldı — arama daraltılmalı. */
  truncated: { beams: boolean; yarns: boolean };
}
