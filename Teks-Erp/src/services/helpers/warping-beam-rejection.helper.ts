// =============================================================================
// DEVERE EK C1 — "reddedilmiş sarım" TEK YÜKLEMİ + ret/yeniden sarım kapıları
// =============================================================================
// Reddedilmiş = devereciye geri gönderilmiş ve ret iptal edilmemiş sarım. Durum olayla AYNI claim'de yazıldığından
// (`applyWarpBeamEventTx`: REJECT_OUT READY→REJECTED, ters REJECTED→READY) "aktif ret var" ⇔ `status = REJECTED`.
// Prisma parçası `NOT_REJECTED_BEAM_WHERE` ↔ bellek-içi `isRejectedBeam` BOĞAZ-İKİZ; K3 (kabul edilen sarım),
// `LIVE_ALLOCATION` (tutma), mutabakat bu dosyadan okur — kopya koşul yazılmaz (`test_fason_devere_ret` §0 ölçer).
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;

/** Prisma parçası: sarım reddedilmiş DEĞİL (aktif REJECT_OUT yok). */
export const NOT_REJECTED_BEAM_WHERE = { status: { not: WarpBeamStatus.REJECTED } } satisfies Prisma.WarpBeamWhereInput;

/** Bellek-içi ikiz — `NOT_REJECTED_BEAM_WHERE`in tersini cevaplar. */
export function isRejectedBeam(b: { status: WarpBeamStatus }): boolean {
  return b.status === WarpBeamStatus.REJECTED;
}

/** Canlı yeniden sarım = reddedilene bağlı, iptal edilmemiş sarım (partial unique `warp_beams_rework_of_live_uq` ile aynı küme). */
export const LIVE_REWORK_WHERE = { status: { not: WarpBeamStatus.CANCELLED } } satisfies Prisma.WarpBeamWhereInput;

/** Kabul stornosu / tekil sarım stornosu kapısı: reddedilmiş sarımı olan kabul geri alınamaz (önce ret iptal edilir). */
export async function assertNoRejectedBeamTx(tx: Pick<Tx, "warpBeam">, where: { beamIds: string[] } | { warpingOrderId: string; receiptKey: string }): Promise<void> {
  const hit = await tx.warpBeam.findFirst({
    where: { status: WarpBeamStatus.REJECTED, ...("beamIds" in where ? { id: { in: where.beamIds } } : { warpingOrderId: where.warpingOrderId, warpingReceiptKey: where.receiptKey }) },
    select: { beamNo: true },
    orderBy: { beamNo: "asc" },
  });
  if (hit) {
    throw AppError.conflict(`${hit.beamNo} devereciye geri gönderilmiş (ret) — kabul geri alınamaz; önce ret belgesini iptal edin.`, { code: "WARPING_RECEIPT_HAS_REJECTION", beamNo: hit.beamNo });
  }
}
