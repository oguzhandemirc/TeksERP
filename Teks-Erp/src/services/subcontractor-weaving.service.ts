// =============================================================================
// FASON DOKUMA — dokuma işi adına levent fasona gider, TOP makbuzla döner (G2)
// =============================================================================
// Dokuma işi bir `WorkOrder` DEĞİLDİR (rotası/adımı/partisi yok); fason sevk ve
// makbuz başlığı bu yüzden POLİMORFİK (`weavingOrderId` XOR iş emri kolonları,
// `dispatch-header.helper`). Bu dosya YALNIZ dokuma işine bağlı belgeleri yazar;
// iş emri yolu (`subcontractor.service`) bayt bayt aynı kalır ve dokuma belgesini
// 409 `DISPATCH_NOT_WORK_ORDER_BOUND` ile reddeder.
//
// Kalemler: levent (F1 defteri `SHIP_OUT ↔ RETURNED_IN`, tek yazıcı
// `subcontractor-beam.service`); iplik G1'de. Fasoncu kendi ipliğini kullanıyorsa
// sevk belgesi hiç açılmaz — iş yine SUBCONTRACTED (aksiyon anı seçimi, bayrak değil).
// Top doğumu: makbuz KALEMİ yok, `createInitialEntry(forcedEntrySource: WEAVING,
// parentReceiptId)` — ikinci giriş motoru yazılmaz; parti yok (Batch iş emrine
// bağlı; in-house WEAVING topu da partisizdir). Top↔dokuma işi bağı
// `weaving-order-of-roll.helper`.
// Ters yollar: sevk → `cancelledAt` üçlüsü + `SHIP_OUT_CANCEL` (dönmüş levent
// varsa 409, LIFO); makbuz → `cancelledAt` üçlüsü, yalnız doğan topların HEPSİ
// `CANCELLED` ise (topun ters yolu `ROLL_CANCEL` kendi kapısından, önizlemeli).
// =============================================================================
import { Prisma, RollEntrySource, RollStatus, WeavingExecutionKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { buildSeriesCode } from "./number-series.service";
import { AuditService } from "./audit.service";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { InventoryService } from "./inventory.service";
import { nextPrefixedSequenceTx } from "./subcontractor.service";
import { cancelWarpBeamItemsTx, countReturnedBeamItems, dispatchWarpBeamItemsTx } from "./subcontractor-beam.service";
import { cancelYarnItemsTx, countReturnedYarnItems, dispatchYarnItemsTx, type YarnDispatchLineInput } from "./subcontractor-yarn.service";
import { WEAVING_ORDER_OPEN_STATUSES } from "./weaving-order.service";
import { markWeavingOrderInProgressTx } from "./helpers/weaving-order.helper";
import { assertWeavingBound } from "./helpers/dispatch-header.helper";
import { resolveOwnerFromBeamsTx } from "./helpers/emanet-owner.helper";

const inventory = new InventoryService();
type Tx = Prisma.TransactionClient;

export interface WeavingDispatchInput {
  weavingOrderId: string;
  warpBeamIds: string[];
  /** G1: fasoncuya giden İPLİK satırları (kalem `kind=YARN`); levent-yalnız ya da iplik-yalnız sevk meşru. */
  yarnLines?: YarnDispatchLineInput[];
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
}

export interface WeavingReceiptRollInput {
  initialQty: number;
  weightKg?: number | null;
  width?: number | null;
  qualityGrade?: string | null;
  colorId?: string | null;
  propertyIds?: string[];
  clientToken?: string;
}

export interface WeavingReceiptInput {
  weavingOrderId: string;
  manifestNo?: string | null;
  notes?: string | null;
  clientToken?: string | null;
  rolls: WeavingReceiptRollInput[];
}

const WO_SELECT = {
  id: true,
  weavingOrderNumber: true,
  executionKind: true,
  subcontractorId: true,
  itemId: true,
  colorId: true,
  status: true,
} satisfies Prisma.WeavingOrderSelect;

/**
 * Dokuma işi KAPISI + CLAIM (tx'in İLK ifadesi): SUBCONTRACTED ∧ açık işin satırı
 * `updateMany` ile KİLİTLENİR (touch, durum yazmaz); count 0 → taze okumayla tanı
 * (iş yok / in-house / kapalı). `PLANNED → IN_PROGRESS` geçişi durumun TEK YAZARI
 * `markWeavingOrderInProgressTx` ile aynı tx'te (fasonda "devam ediyor" = mal fasoncuda).
 */
async function claimSubcontractedWeavingOrderTx(tx: Tx, weavingOrderId: string, userId?: string) {
  const claim = await tx.weavingOrder.updateMany({
    where: {
      id: weavingOrderId,
      executionKind: WeavingExecutionKind.SUBCONTRACTED,
      status: { in: [...WEAVING_ORDER_OPEN_STATUSES] },
    },
    data: { updatedById: userId ?? null },
  });
  const fresh = await tx.weavingOrder.findUnique({ where: { id: weavingOrderId }, select: WO_SELECT });
  if (!fresh) throw AppError.notFound("Dokuma işi bulunamadı");
  if (claim.count === 0) {
    if (fresh.executionKind !== WeavingExecutionKind.SUBCONTRACTED) {
      throw AppError.conflict(`${fresh.weavingOrderNumber} kendi tezgahında dokunuyor — fason belgesi açılamaz`, {
        code: "WEAVING_ORDER_NOT_SUBCONTRACTED",
      });
    }
    throw AppError.conflict(`${fresh.weavingOrderNumber} açık değil (${fresh.status}) — fason belgesi açılamaz`, {
      code: "WEAVING_ORDER_NOT_OPEN",
      status: fresh.status,
    });
  }
  if (!fresh.subcontractorId) {
    // CHECK `weaving_orders_party_ck` ikinci hat; buraya düşmek sed ihlalidir.
    throw AppError.conflict("Fason dokuma işinin fasoncusu yok", { code: "WEAVING_ORDER_NO_SUBCONTRACTOR" });
  }
  await markWeavingOrderInProgressTx(tx, weavingOrderId, userId);
  return fresh as typeof fresh & { subcontractorId: string };
}

// ── Sevk ────────────────────────────────────────────────────────────────────

export async function dispatchForWeaving(input: WeavingDispatchInput, userId?: string): Promise<ApiResponse<unknown>> {
  const warpBeamIds = [...new Set(input.warpBeamIds)];
  const yarnLines = input.yarnLines ?? [];
  if (warpBeamIds.length === 0 && yarnLines.length === 0) {
    throw AppError.badRequest("Fason dokuma sevkinde en az bir levent ya da iplik satırı seçilmeli", { code: "WEAVING_DISPATCH_EMPTY" });
  }
  const created = await prisma.$transaction(async (tx) => {
    const wo = await claimSubcontractedWeavingOrderTx(tx, input.weavingOrderId, userId);
    const now = new Date();
    const seq = await nextPrefixedSequenceTx(tx, "subcontractorDispatch", now);
    const dispatch = await tx.subcontractorDispatch.create({
      data: {
        dispatchNo: buildSeriesCode("subcontractorDispatch", seq, now),
        weavingOrderId: wo.id,
        subcontractorId: wo.subcontractorId,
        plateNumber: input.plateNumber ?? null,
        driverName: input.driverName ?? null,
        notes: input.notes ?? null,
        dispatchedById: userId ?? null,
        totalQty: 0,
      },
      select: { id: true, dispatchNo: true, weavingOrderId: true, subcontractorId: true, dispatchedAt: true },
    });
    const beams = warpBeamIds.length > 0
      ? await dispatchWarpBeamItemsTx(tx, { dispatchId: dispatch.id, warpBeamIds, userId })
      : { lines: [], totalM: new Prisma.Decimal(0) };
    // totalQty = Σ kalem (`test_consistency §19`); levent kalemi metre taşır (F1 ile aynı); iplik kg GİRMEZ (H1).
    if (beams.lines.length > 0) await tx.subcontractorDispatch.update({ where: { id: dispatch.id }, data: { totalQty: beams.totalM } });
    const yarn = yarnLines.length > 0 ? await dispatchYarnItemsTx(tx, { dispatchId: dispatch.id, lines: yarnLines, userId }) : null;
    return { dispatch, beams, yarn, weavingOrderNumber: wo.weavingOrderNumber };
  });
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: "SUBCONTRACTOR_DISPATCH",
    recordId: created.dispatch.id,
    newData: { ...created.dispatch, kind: "WEAVING", warpBeamIds, totalM: created.beams.totalM.toString(), ...(created.yarn ? { yarnItemCount: created.yarn.lines.length, yarnTotalKg: created.yarn.totalKg.toString() } : {}) },
  });
  return {
    success: true,
    data: { ...created.dispatch, beams: created.beams.lines, totalM: created.beams.totalM.toString(), ...(created.yarn ? { yarnItems: created.yarn.lines, yarnTotalKg: created.yarn.totalKg.toString() } : {}) },
    message: `Fason dokuma sevki ${created.dispatch.dispatchNo} açıldı (${created.weavingOrderNumber}, ${warpBeamIds.length} levent${created.yarn ? `, ${created.yarn.totalKg} kg iplik` : ""})`,
  };
}

export async function cancelWeavingDispatch(dispatchId: string, reason: string, userId?: string): Promise<ApiResponse<unknown>> {
  if (!reason || reason.trim().length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
  const result = await prisma.$transaction(async (tx) => {
    const d = await tx.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      select: { id: true, dispatchNo: true, weavingOrderId: true, cancelledAt: true },
    });
    if (!d) throw AppError.notFound("Sevk belgesi bulunamadı");
    assertWeavingBound(d, "Sevk belgesi");
    if ((await countReturnedBeamItems(tx, d.id)) > 0) {
      throw AppError.conflict("Dönmüş leventi olan sevk iptal edilemez — önce dönüşü geri alın (LIFO)", {
        code: "WARP_BEAM_RETURNED",
      });
    }
    if ((await countReturnedYarnItems(tx, d.id)) > 0) {
      throw AppError.conflict("Dönmüş ipliği olan sevk iptal edilemez — önce dönüşü geri alın (LIFO)", { code: "YARN_ITEM_RETURNED" });
    }
    const claim = await tx.subcontractorDispatch.updateMany({
      where: { id: d.id, cancelledAt: null },
      data: { cancelledAt: new Date(), cancelledById: userId ?? null, cancelReason: reason.trim() },
    });
    if (claim.count === 0) throw AppError.conflict(`Sevk ${d.dispatchNo} zaten iptal edilmiş`, { code: "DISPATCH_CANCELLED" });
    const beams = await cancelWarpBeamItemsTx(tx, { dispatchId: d.id, reason: reason.trim(), userId });
    const yarnItems = await cancelYarnItemsTx(tx, { dispatchId: d.id, reason: reason.trim(), userId });
    return { ...d, beams, yarnItems };
  });
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "SUBCONTRACTOR_DISPATCH",
    recordId: result.id,
    newData: { cancelled: true, kind: "WEAVING", reason, beamsReverted: result.beams, yarnItemsReverted: result.yarnItems },
  });
  return { success: true, data: result, message: `Sevk ${result.dispatchNo} iptal edildi (${result.beams} levent geri READY)` };
}

// ── Makbuz (TOP doğar) ──────────────────────────────────────────────────────

/** Makbuz replay'i (dört durum): token yoksa null; iptal edilmiş 409; farklı gövde 409; aynı gövde → önceki sonuç. */
async function findReceiptReplay(input: WeavingReceiptInput): Promise<ApiResponse<unknown> | null> {
  if (!input.clientToken) return null;
  const hit = await prisma.subcontractorReceipt.findUnique({
    where: { clientToken: input.clientToken },
    select: { id: true, receiptNo: true, cancelledAt: true, weavingOrderId: true, manifestNo: true },
  });
  if (hit) {
    if (hit.cancelledAt) {
      throw AppError.conflict("Bu kabul denemesi daha önce kaydedilmiş ve İPTAL edilmiş — yeniden deneme yerine yeni kabul açın", {
        code: "RECEIPT_CANCELLED",
      });
    }
    // Gövde kapısı: aynı token BAŞKA bir işe/irsaliyeye gelirse 409 (dört durumlu replay).
    assertReplayPayloadMatches(
      [
        { ad: "weavingOrderId", mevcut: hit.weavingOrderId, gelen: input.weavingOrderId },
        { ad: "manifestNo", mevcut: hit.manifestNo ?? "", gelen: input.manifestNo ?? "" },
      ],
      "Bu istemci anahtarı BAŞKA bir kabulle kullanılmış — formu yenileyip yeniden deneyin.",
    );
    const rolls = await prisma.roll.findMany({ where: { parentReceiptId: hit.id }, select: { id: true, barcode: true } });
    return { success: true, data: { receipt: hit, rolls, failed: [] }, message: `Kabul zaten yapılmış (idempotent). Makbuz: ${hit.receiptNo}` };
  }
  return null;
}

export async function receiveForWeaving(input: WeavingReceiptInput, userId?: string): Promise<ApiResponse<unknown>> {
  if (input.rolls.length === 0) throw AppError.badRequest("Makbuzda en az bir top olmalı", { code: "WEAVING_RECEIPT_EMPTY" });
  const replay = await findReceiptReplay(input);
  if (replay) return replay;
  const header = await prisma.$transaction(async (tx) => {
    const wo = await claimSubcontractedWeavingOrderTx(tx, input.weavingOrderId, userId);
    const now = new Date();
    const seq = await nextPrefixedSequenceTx(tx, "subcontractorReceipt", now);
    const receipt = await tx.subcontractorReceipt.create({
      data: {
        receiptNo: buildSeriesCode("subcontractorReceipt", seq, now),
        clientToken: input.clientToken ?? null,
        manifestNo: input.manifestNo ?? null,
        weavingOrderId: wo.id,
        subcontractorId: wo.subcontractorId,
        receivedById: userId ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true, receiptNo: true, weavingOrderId: true, subcontractorId: true, receivedAt: true },
    });
    return { receipt, wo };
  });
  // Toplar birer birer, her biri kendi tx'inde (mal kabul emsali): satır hatası
  // makbuzu düşürmez, `failed[]`e düşer — operatör satırı düzeltip yeniden gönderir.
  const rolls: { id: string; barcode: string | null; initialQty: number }[] = [];
  const failed: { index: number; message: string }[] = [];
  // G3 emanet kalıtımı: sevkteki leventlerin sahibi tek ise doğan top onu alır (karışık → 409, makbuz açılmaz).
  const ownerCustomerId = await resolveOwnerFromBeamsTx(prisma, input.weavingOrderId);
  for (const [index, line] of input.rolls.entries()) {
    try {
      const res = await inventory.createInitialEntry(
        {
          itemId: header.wo.itemId,
          colorId: line.colorId ?? header.wo.colorId ?? null,
          initialQty: line.initialQty,
          weightKg: line.weightKg ?? undefined,
          width: line.width ?? undefined,
          qualityGrade: line.qualityGrade ?? undefined,
          propertyIds: line.propertyIds,
          clientToken: line.clientToken,
        },
        userId,
        null,
        false,
        {
          forcedEntrySource: RollEntrySource.WEAVING,
          parentReceiptId: header.receipt.id,
          entryStationId: null,
          skipKk1WeightPolicy: true,
          ownerCustomerId,
        },
      );
      rolls.push({ id: res.data.id, barcode: res.data.barcode, initialQty: Number(res.data.initialQty) });
    } catch (e) {
      failed.push({ index, message: e instanceof Error ? e.message : String(e) });
    }
  }
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: "SUBCONTRACTOR_RECEIPT",
    recordId: header.receipt.id,
    newData: { ...header.receipt, kind: "WEAVING", rollCount: rolls.length, failedCount: failed.length },
  });
  return {
    success: true,
    data: { receipt: header.receipt, rolls, failed },
    message: `Fason dokuma kabulü ${header.receipt.receiptNo}: ${rolls.length} top doğdu${failed.length ? `, ${failed.length} satır düşmedi` : ""}`,
  };
}
