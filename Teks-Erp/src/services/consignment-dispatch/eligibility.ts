// =============================================================================
// EMANET ÇIKIŞ — kalem seçilebilirliği TEK yüklemi (oluştur · önizleme · aday listesi)
// =============================================================================
// "Bu levent/lot bu sahibe çıkabilir mi" sorusunun tek cevabı: satır çözücü (`lines.ts`) ve aday ucu
// (`candidates.ts`) aynı fonksiyonu çağırır — aday listesi "seçilebilir" derken oluştur 409 vermesin.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import { isConsignedTo } from "../helpers/emanet-owner.helper";
import type { ConsignmentDispatchErrorCode } from "./types";

export function beamBlockedReason(
  beam: { ownerCustomerId: string | null; status: WarpBeamStatus; remainingM: Prisma.Decimal },
  ownerCustomerId: string,
): ConsignmentDispatchErrorCode | null {
  if (!isConsignedTo(beam.ownerCustomerId, ownerCustomerId)) return "CONSIGNMENT_OWNER_MISMATCH";
  if (beam.status !== WarpBeamStatus.READY || beam.remainingM.lte(0)) return "CONSIGNMENT_BEAM_NOT_READY";
  return null;
}

/**
 * `qtyKg` verilmezse (aday listesi: miktar henüz seçilmedi) bakiye engeli "en az bir gram var mı"dır —
 * `balanceKg <= 0` iken oluştur hangi miktarda olursa olsun 409 `CONSIGNMENT_YARN_INSUFFICIENT` verir.
 */
export function yarnBlockedReason(
  lot: { ownerCustomerId: string | null; isActive: boolean; balanceKg: Prisma.Decimal },
  ownerCustomerId: string,
  qtyKg?: Prisma.Decimal,
): ConsignmentDispatchErrorCode | null {
  if (!isConsignedTo(lot.ownerCustomerId, ownerCustomerId)) return "CONSIGNMENT_OWNER_MISMATCH";
  // Pasif lot yazarda 400 alırdı; önizleme = işlem olsun diye satır engeli (patron kararı 2026-11-08).
  if (!lot.isActive) return "YARN_LOT_INACTIVE";
  if (qtyKg ? lot.balanceKg.lt(qtyKg) : lot.balanceKg.lte(0)) return "CONSIGNMENT_YARN_INSUFFICIENT";
  return null;
}
