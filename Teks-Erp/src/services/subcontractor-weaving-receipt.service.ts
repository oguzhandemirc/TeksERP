// =============================================================================
// FASON DOKUMA — makbuz iptali (önizlemeli) ve dokuma işi fason ÖZETİ (G2)
// =============================================================================
// `subcontractor-weaving.service.ts`in okuma/ters-yol yarısı (300 satır tavanı).
// Makbuz iptali yalnız doğan topların HEPSİ `CANCELLED` ise: topun ters yolu
// `ROLL_CANCEL` kendi önizlemeli kapısından geçer, burada ikinci stok sebebi
// açılmaz; başlık geçişi tek claim (`cancelledAt` üçlüsü).
// =============================================================================
import { Prisma, RollStatus, SubcontractorDispatchItemKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { listYarnItems } from "./subcontractor-yarn.service";
import { assertWeavingBound } from "./helpers/dispatch-header.helper";

const WO_SELECT = {
  id: true,
  weavingOrderNumber: true,
  executionKind: true,
  subcontractorId: true,
  itemId: true,
  colorId: true,
  status: true,
} satisfies Prisma.WeavingOrderSelect;

/** İptal önizlemesi — doğan her topun durumu; hepsi CANCELLED değilse iptal kapalı. */
export async function previewCancelWeavingReceipt(receiptId: string): Promise<ApiResponse<unknown>> {
  const r = await prisma.subcontractorReceipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true, receiptNo: true, weavingOrderId: true, cancelledAt: true,
      bornRolls: { select: { id: true, barcode: true, status: true, initialQty: true } },
    },
  });
  if (!r) throw AppError.notFound("Kabul belgesi bulunamadı");
  assertWeavingBound(r, "Kabul belgesi");
  const alive = r.bornRolls.filter((x) => x.status !== RollStatus.CANCELLED);
  return {
    success: true,
    data: {
      receiptNo: r.receiptNo,
      cancelledAt: r.cancelledAt,
      bornRolls: r.bornRolls.map((x) => ({ ...x, initialQty: Number(x.initialQty), blocks: x.status !== RollStatus.CANCELLED })),
      canCancel: !r.cancelledAt && alive.length === 0,
      /** Makbuz iptalinde sebep HER ZAMAN zorunlu (`reasonSchema` min 3) — bayraktan bağımsız. */
      reasonRequired: true,
      aliveCount: alive.length,
    },
  };
}

export async function cancelWeavingReceipt(receiptId: string, reason: string, userId?: string): Promise<ApiResponse<unknown>> {
  if (!reason || reason.trim().length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.subcontractorReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, receiptNo: true, weavingOrderId: true, bornRolls: { select: { barcode: true, status: true } } },
    });
    if (!r) throw AppError.notFound("Kabul belgesi bulunamadı");
    assertWeavingBound(r, "Kabul belgesi");
    const alive = r.bornRolls.filter((x) => x.status !== RollStatus.CANCELLED).map((x) => x.barcode);
    if (alive.length > 0) {
      throw AppError.conflict(`Makbuzdan doğan ${alive.length} top hâlâ kayıtta — önce topları iptal edin`, {
        code: "BORN_ROLLS_ALIVE",
        barcodes: alive,
      });
    }
    // Doğan toplar CANCELLED ⇒ kilitleri kendi iptalinde alındı; başlık geçişi tek claim.
    const claim = await tx.subcontractorReceipt.updateMany({
      where: { id: r.id, cancelledAt: null },
      data: { cancelledAt: new Date(), cancelledById: userId ?? null, cancelReason: reason.trim() },
    });
    if (claim.count === 0) throw AppError.conflict(`Makbuz ${r.receiptNo} zaten iptal edilmiş`, { code: "RECEIPT_CANCELLED" });
    return { id: r.id, receiptNo: r.receiptNo };
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_RECEIPT", recordId: result.id, newData: { cancelled: true, kind: "WEAVING", reason } });
  return { success: true, data: result, message: `Makbuz ${result.receiptNo} iptal edildi` };
}

// ── Özet / mutabakat ────────────────────────────────────────────────────────

/** Dokuma işinin fason özeti: giden levent metresi ↔ dönen levent kalanı ↔ doğan top metresi (çözgü metresi bazında). */
export async function getWeavingSubcontractSummary(weavingOrderId: string): Promise<ApiResponse<unknown>> {
  const wo = await prisma.weavingOrder.findUnique({ where: { id: weavingOrderId }, select: WO_SELECT });
  if (!wo) throw AppError.notFound("Dokuma işi bulunamadı");
  const [dispatches, receipts] = await Promise.all([
    prisma.subcontractorDispatch.findMany({
      where: { weavingOrderId },
      orderBy: { dispatchedAt: "asc" },
      select: {
        id: true, dispatchNo: true, dispatchedAt: true, cancelledAt: true, plateNumber: true, driverName: true,
        items: {
          // G1: iplik kalemi (kind=YARN) levent listesine GİRMEZ — `warpBeam: null` ile "?" çizilirdi; `yarnItems` ayrı alan.
          where: { kind: { not: SubcontractorDispatchItemKind.YARN } },
          select: {
            warpBeam: { select: { id: true, beamNo: true, status: true } },
            warpBeamEvents: { where: { reversal: { is: null } }, select: { kind: true, lengthM: true } },
          },
        },
      },
    }),
    prisma.subcontractorReceipt.findMany({
      where: { weavingOrderId },
      orderBy: { receivedAt: "asc" },
      select: {
        id: true, receiptNo: true, receivedAt: true, cancelledAt: true, manifestNo: true,
        bornRolls: { select: { id: true, barcode: true, status: true, initialQty: true } },
      },
    }),
  ]);
  let sentM = 0;
  let returnedM = 0;
  for (const d of dispatches) {
    if (d.cancelledAt) continue;
    for (const it of d.items) for (const ev of it.warpBeamEvents) {
      if (ev.kind === "SHIP_OUT") sentM += Number(ev.lengthM ?? 0);
      if (ev.kind === "RETURNED_IN") returnedM += Number(ev.lengthM ?? 0);
    }
  }
  const bornM = receipts
    .filter((r) => !r.cancelledAt)
    .flatMap((r) => r.bornRolls)
    .filter((x) => x.status !== RollStatus.CANCELLED)
    .reduce((s, x) => s + Number(x.initialQty), 0);
  // G1/G1c: iplik kalemleri sevk başına (birim KG açık, `sarilan[]` beyanlı); toplamlar iptal edilmemiş sevklerden.
  const yarnByDispatch = new Map<string, Awaited<ReturnType<typeof listYarnItems>>["items"]>();
  const yarn = { sentKg: 0, returnedKg: 0, woundKg: 0, remainingKg: 0 };
  for (const d of dispatches) {
    const { items } = await listYarnItems(prisma, d.id);
    yarnByDispatch.set(d.id, items);
    if (d.cancelledAt) continue;
    for (const it of items) { yarn.sentKg += it.dispatchedKg; yarn.returnedKg += it.returnedKg; yarn.woundKg += it.sarilanKg; yarn.remainingKg += it.remainingKg; }
  }
  return {
    success: true,
    data: {
      weavingOrder: wo,
      dispatches: dispatches.map((d) => ({ ...d, items: d.items.map((it) => ({ warpBeam: it.warpBeam, events: it.warpBeamEvents.map((e) => ({ kind: e.kind, lengthM: e.lengthM == null ? null : Number(e.lengthM) })) })), yarnItems: yarnByDispatch.get(d.id) ?? [] })),
      receipts: receipts.map((r) => ({ ...r, bornRolls: r.bornRolls.map((x) => ({ ...x, initialQty: Number(x.initialQty) })) })),
      totals: { sentM, returnedM, bornM, differenceM: sentM - returnedM - bornM, yarn },
    },
    warnings: ["Mutabakat ÇÖZGÜ metresi bazındadır: çekme/take-up kumaş metresini düşürür, fark tek başına fire değildir."],
  };
}
