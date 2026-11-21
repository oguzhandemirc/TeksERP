// =============================================================================
// FASON DEVERE SİPARİŞİ — levent KABUL STORNOSU (D5a): bir kabulün bütün canlı leventleri tek tx'te WOUND_CANCEL
// =============================================================================
// LIFO: yalnız siparişin EN YENİ kabulü geri alınır (`warping-receipt-guard.helper`); kabul içinde leventler sondan
// başa. Tipli ters (`reversesEventId`, tek ters); dağıtım satırları SİLİNMEZ — `event.reversal: null` süzgeciyle
// sayılmaz, tutma kendiliğinden geri gelir. Takılmış/sevk edilmiş/tüketilmiş levent READY değildir → claim 409.
// Kapanmış siparişte 409 "önce yeniden açın". Tekil levent stornosu mevcut `cancelWound` (aynı kapı).
// =============================================================================
import { Prisma, WarpBeamStatus, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "../helpers/warp-beam-event.helper";
import { activeWarpingReceiptInvoiceTx, assertWarpingReceiptNotInvoicedTx, claimWarpingOrderForWoundCancelTx, newestLiveWarpingWoundTx } from "../helpers/warping-receipt-guard.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { assertNoRejectedBeamTx, isRejectedBeam } from "../helpers/warping-beam-rejection.helper";
import { WARPING_ORDER_TABLE } from "./create";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

async function receiptBeams(db: Tx | typeof prisma, warpingOrderId: string, receiptKey: string) {
  return sequentialTx(db).warpBeam.findMany({
    where: { warpingOrderId, warpingReceiptKey: receiptKey },
    select: {
      id: true, beamNo: true, status: true,
      events: {
        where: { kind: "WOUND" },
        select: {
          id: true, lengthM: true, reversal: { select: { id: true } },
          yarns: { select: { yarnItemId: true, allocations: { select: { kg: true, dispatchItemId: true, holderWarpingOrderId: true, dispatchItem: { select: { dispatch: { select: { dispatchNo: true } } } } } } } },
        },
      },
    },
    orderBy: { beamNo: "desc" },
  });
}

export interface WarpingReceiptCancelPreview {
  receiptKey: string;
  orderStatus: WarpingOrderStatus;
  /** Henüz geri alınmamış levent sayısı (0 = kabul zaten tümüyle geri alınmış; belge stornosu bu parçayı atlar). */
  liveBeamCount: number;
  /** Etkilenen her levent (sondan başa) + geri alınabilir mi. */
  /** `live`: henüz geri alınmamış (stornoda etkilenecek) levent. */
  beams: Array<{ id: string; beamNo: string; status: WarpBeamStatus; lengthM: string | null; live: boolean; cancellable: boolean; blocker: string | null }>;
  /** Geri gelecek tutma: kalem × tutan sipariş. */
  released: Array<{ dispatchItemId: string; dispatchNo: string; yarnItemId: string; holderWarpingOrderId: string; kg: string }>;
  blockers: string[];
  reasonRequired: true;
}

export async function previewCancelWarpingReceipt(id: string, receiptKey: string): Promise<WarpingReceiptCancelPreview> {
  const order = await prisma.warpingOrder.findUnique({ where: { id }, select: { status: true } });
  if (!order) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const beams = await receiptBeams(prisma, id, receiptKey);
  if (beams.length === 0) throw AppError.notFound("Bu siparişte böyle bir levent kabulü yok.", { code: "WARPING_RECEIPT_NOT_FOUND" });
  const blockers: string[] = [];
  if (order.status !== WarpingOrderStatus.IN_PROGRESS) blockers.push(`Sipariş durumu ${order.status} — ${order.status === WarpingOrderStatus.COMPLETED ? "önce siparişi yeniden açın" : "geri alınamaz"}.`);
  const newest = await newestLiveWarpingWoundTx(prisma, id);
  if (newest && newest.beam.warpingReceiptKey !== receiptKey) blockers.push(`Daha yeni bir kabul var (${newest.beam.beamNo}) — kabuller sondan başa (LIFO) geri alınır.`);
  const live = beams.filter((b) => b.events[0] && !b.events[0].reversal);
  if (live.length === 0) blockers.push("Bu kabulün bütün leventleri zaten geri alınmış.");
  const invoiced = await activeWarpingReceiptInvoiceTx(prisma, receiptKey);
  if (invoiced) blockers.push(`Kabul faturalı (${invoiced.docNo}) — önce faturayı iptal edin ya da bağını kaldırın.`);
  const rejected = beams.filter(isRejectedBeam);
  if (rejected.length > 0) blockers.push(`${rejected.map((b) => b.beamNo).join(", ")} devereciye geri gönderilmiş (ret) — önce ret belgesini iptal edin.`);
  const released = new Map<string, { dispatchItemId: string; dispatchNo: string; yarnItemId: string; holderWarpingOrderId: string; kg: Prisma.Decimal }>();
  for (const b of live) {
    for (const y of b.events[0]!.yarns) {
      for (const a of y.allocations) {
        const k = `${a.dispatchItemId}|${a.holderWarpingOrderId}`;
        const cur = released.get(k) ?? { dispatchItemId: a.dispatchItemId, dispatchNo: a.dispatchItem.dispatch.dispatchNo, yarnItemId: y.yarnItemId, holderWarpingOrderId: a.holderWarpingOrderId, kg: D(0) };
        cur.kg = cur.kg.plus(a.kg);
        released.set(k, cur);
      }
    }
  }
  const beamRows = beams.map((b) => {
    const ev = b.events[0];
    const blocker = !ev || ev.reversal ? "zaten geri alınmış" : b.status !== WarpBeamStatus.READY ? `durumu ${b.status} — yalnız HAZIR levent geri alınır` : null;
    if (blocker && ev && !ev.reversal) blockers.push(`${b.beamNo}: ${blocker}.`);
    return { id: b.id, beamNo: b.beamNo, status: b.status, lengthM: ev?.lengthM ? D(ev.lengthM).toFixed(3) : null, live: !!ev && !ev.reversal, cancellable: blocker === null, blocker };
  });
  return { receiptKey, orderStatus: order.status, liveBeamCount: live.length, beams: beamRows, released: [...released.values()].map((r) => ({ ...r, kg: r.kg.toFixed(3) })), blockers, reasonRequired: true };
}

export type CancelledReceiptBeam = { id: string; beamNo: string; eventId: string; woundId: string };

/** Kabul parçasının canlı leventleri var mı (claim'siz okuma; WOUND_CANCEL terminal olduğundan "yok" sonucu kalıcıdır). */
export async function receiptHasLiveBeams(db: Tx | typeof prisma, warpingOrderId: string, receiptKey: string): Promise<boolean> {
  return (await receiptBeams(db, warpingOrderId, receiptKey)).some((b) => b.events[0] && !b.events[0].reversal);
}

/**
 * Sipariş claim'inden SONRA bir kabulün canlı leventlerini WOUND_CANCEL ile geri alır (tek kabul ve belge stornosu ortak
 * gövdesi). Faturalı / reddedilmiş / LIFO bozan / HAZIR olmayan levent → 409; canlı levent yoksa boş döner.
 */
export async function cancelReceiptPartTx(tx: Tx, p: { warpingOrderId: string; receiptKey: string; reason: string; userId: string; label?: string }): Promise<CancelledReceiptBeam[]> {
  const { warpingOrderId: id, receiptKey } = p;
  await assertWarpingReceiptNotInvoicedTx(tx, receiptKey);
  await assertNoRejectedBeamTx(tx, { warpingOrderId: id, receiptKey });
  const newest = await newestLiveWarpingWoundTx(tx, id);
  const beams = (await receiptBeams(tx, id, receiptKey)).filter((b) => b.events[0] && !b.events[0].reversal);
  if (beams.length === 0) return [];
  if (newest && newest.beam.warpingReceiptKey !== receiptKey) {
    throw AppError.conflict(`${p.label ? `${p.label}: ` : ""}Bu kabul geri alınamaz — daha yeni bir kabul var (${newest.beam.beamNo}); kabuller sondan başa (LIFO) geri alınır.`, { code: "WARPING_RECEIPT_LIFO", newestBeamNo: newest.beam.beamNo });
  }
  const done: CancelledReceiptBeam[] = [];
  for (const b of beams) {
    const w = b.events[0]!;
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: b.id, kind: "WOUND_CANCEL", from: WarpBeamStatus.READY, to: WarpBeamStatus.CANCELLED,
      data: { reversesEventId: w.id, lengthM: w.lengthM, reason: p.reason, createdById: p.userId },
    });
    done.push({ id: b.id, beamNo: b.beamNo, eventId: ev.id, woundId: w.id });
  }
  return done;
}

export async function cancelWarpingReceipt(id: string, receiptKey: string, reason: string, userId: string): Promise<{ receiptKey: string; cancelledBeams: Array<{ id: string; beamNo: string }> }> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
  const out = await prisma.$transaction(async (tx) => {
    await claimWarpingOrderForWoundCancelTx(tx, id, userId);
    const done = await cancelReceiptPartTx(tx, { warpingOrderId: id, receiptKey, reason: why, userId });
    if (done.length === 0) throw AppError.conflict("Bu kabulde geri alınacak canlı levent yok.", { code: "WARPING_RECEIPT_NOT_OPEN" });
    return done;
  });
  for (const d of out) await logWarpBeamEventAudit({ userId, eventId: d.eventId, kind: "WOUND_CANCEL", data: { beamId: d.id, reversesEventId: d.woundId, warpingOrderId: id, receiptKey, reason: why } });
  await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id, newData: { receiptCancelled: receiptKey, beams: out.map((d) => d.beamNo), reason: why } });
  return { receiptKey, cancelledBeams: out.map((d) => ({ id: d.id, beamNo: d.beamNo })) };
}
