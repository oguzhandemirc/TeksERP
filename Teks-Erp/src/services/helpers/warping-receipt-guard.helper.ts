// =============================================================================
// FASON DEVERE D5a — dönüş kabulünün tx-içi YAZICISI + devere doğumlu leventin dönüş stornosu KAPISI
// =============================================================================
// ① Sipariş satırı claim'i (`IN_PROGRESS`): kapanmış (COMPLETED) siparişte 409 "önce yeniden açın"; aynı satırı claim
//    eden kabul/kapanış/iade ile sıraya girer. ② LIFO: yalnız siparişin EN YENİ canlı dönüşü geri alınır — dağıtım
//    sevk sırasıyla yazıldığından ortadan bir dönüşün geri alınması sonraki dağıtımların sırasını bozardı.
// =============================================================================
import { InvoiceStatus, Prisma, WarpingOrderStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;

export interface WoundYarnLineWrite {
  yarnItemId: string; endsCount: number; denier: Prisma.Decimal; kg: Prisma.Decimal;
  allocations: Array<{ dispatchItemId: string; holderWarpingOrderId: string; kg: Prisma.Decimal }>;
}

/** Kabulde WOUND kırılımı + iplik dağıtımı (WOUND ile aynı tx); audit'i çağıran kabul eylemi basar. */
export async function writeWarpingWoundYarnsTx(tx: Tx, input: { eventId: string; warpingOrderId: string; lines: WoundYarnLineWrite[] }): Promise<void> {
  for (const y of input.lines) {
    const ey = await tx.warpBeamEventYarn.create({ data: { eventId: input.eventId, yarnItemId: y.yarnItemId, endsCount: y.endsCount, denier: y.denier, theoreticalKg: y.kg }, select: { id: true } });
    if (y.allocations.length === 0) continue;
    await tx.warpBeamYarnAllocation.createMany({
      data: y.allocations.map((a) => ({ eventYarnId: ey.id, dispatchItemId: a.dispatchItemId, warpingOrderId: input.warpingOrderId, holderWarpingOrderId: a.holderWarpingOrderId, kg: a.kg })),
    });
  }
}

/** Siparişin en yeni canlı WOUND'u (eşitlikte levent no — aynı kabulde sıralı doğar). */
export async function newestLiveWarpingWoundTx(tx: Pick<Tx, "warpBeamEvent">, warpingOrderId: string) {
  return tx.warpBeamEvent.findFirst({
    where: { kind: "WOUND", reversal: null, beam: { warpingOrderId } },
    orderBy: [{ createdAt: "desc" }, { beam: { beamNo: "desc" } }, { id: "desc" }],
    select: { beamId: true, beam: { select: { beamNo: true, warpingReceiptKey: true } } },
  });
}

/** Sipariş claim'i (tx'in ilk yazımı) — COMPLETED/başka durum 409. */
export async function claimWarpingOrderForWoundCancelTx(tx: Tx, warpingOrderId: string, userId: string | null): Promise<void> {
  const claim = await tx.warpingOrder.updateMany({ where: { id: warpingOrderId, status: WarpingOrderStatus.IN_PROGRESS }, data: { updatedById: userId } });
  if (claim.count === 1) return;
  const o = await tx.warpingOrder.findUnique({ where: { id: warpingOrderId }, select: { orderNo: true, status: true } });
  const hint = o?.status === WarpingOrderStatus.COMPLETED ? " — kapanmış siparişin leventi geri alınamaz, önce siparişi yeniden açın." : ".";
  throw AppError.conflict(`${o?.orderNo ?? "Sipariş"} durumu ${o?.status ?? "?"} — levent dönüşü geri alınamaz${hint}`, { code: "WARPING_ORDER_COMPLETED", status: o?.status });
}

/** Kabulün iptal edilmemiş faturası (devere A1) — yoksa null. */
export async function activeWarpingReceiptInvoiceTx(tx: Pick<Tx, "invoiceToWarpingReceipt">, receiptKey: string): Promise<{ docNo: string } | null> {
  const l = await tx.invoiceToWarpingReceipt.findFirst({ where: { warpingReceiptKey: receiptKey, invoice: { status: { not: InvoiceStatus.CANCELLED } } }, select: { invoice: { select: { docNo: true } } } });
  return l?.invoice ?? null;
}

/** K4: faturalı kabul geri alınmaz — sipariş claim'inden SONRA okunur (fatura bağlama aynı satırı FOR UPDATE kilitler). */
export async function assertWarpingReceiptNotInvoicedTx(tx: Tx, receiptKey: string | null): Promise<void> {
  if (!receiptKey) return;
  const inv = await activeWarpingReceiptInvoiceTx(tx, receiptKey);
  if (inv) throw AppError.conflict(`Bu levent kabulü faturalı (${inv.docNo}) — geri alınamaz; önce faturayı iptal edin ya da bağını kaldırın.`, { code: "WARPING_RECEIPT_INVOICED", docNo: inv.docNo });
}

/** Tekil levent stornosu kapısı: devere doğumlu değilse no-op; değilse claim + faturalı mı + LIFO. */
export async function assertWarpingWoundCancellableTx(tx: Tx, beam: { id: string; beamNo: string; warpingOrderId: string | null; warpingReceiptKey?: string | null }, userId: string | null): Promise<void> {
  if (!beam.warpingOrderId) return;
  await claimWarpingOrderForWoundCancelTx(tx, beam.warpingOrderId, userId);
  const key = beam.warpingReceiptKey !== undefined ? beam.warpingReceiptKey : (await tx.warpBeam.findUnique({ where: { id: beam.id }, select: { warpingReceiptKey: true } }))?.warpingReceiptKey ?? null;
  await assertWarpingReceiptNotInvoicedTx(tx, key);
  const newest = await newestLiveWarpingWoundTx(tx, beam.warpingOrderId);
  if (newest && newest.beamId !== beam.id) {
    throw AppError.conflict(`${beam.beamNo} dönüşü geri alınamaz — siparişin daha yeni bir dönüşü var (${newest.beam.beamNo}); dönüşler sondan başa (LIFO) geri alınır.`, {
      code: "WARPING_RECEIPT_LIFO", newestBeamNo: newest.beam.beamNo,
    });
  }
}
