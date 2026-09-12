// =============================================================================
// SAYIM STORNOSU — tamamlanmış sayımın fark fişi TEK BELGEDE ters kayıtla geri alınır
// =============================================================================
// SAP MM karşılığı: MI07 fark postalaması bir malzeme belgesidir ve stornosu
// (MBST) aynı belgeye bağlı ters harekettir. Burada da sayım satırları ve ileri
// defter satırları DEĞİŞMEZ: sayıma damga, depo defterine `CANCEL_REVERSAL`,
// sapma satırına `reversedAt`, iplik defterine net ters ADJUST yazılır.
//
// ⚠️ LIFO: yalnız deponun EN SON tamamlanmış (stornolanmamış) sayımı geri alınır.
// Sonraki sayım bu sayımın sonucunu fiziksel olarak doğruladı; eskisini geri almak
// onun iplik bakiyesini ve raf gerçeğini yalanlardı (fason LIFO iptal emsali).
//
// ⚠️ HEP-YA-HİÇ, AMA ÇIKIŞSIZ DEĞİL: sayımın düşürdüğü top arada ELLE geri
// alınmışsa (`inventory.restoreCancelledRoll` — o yol defter yazmaz) storno
// REDDEDİLMEZ; o top `LEDGER_ONLY` dalına düşer: statüsüne DOKUNULMAZ, yalnız
// defter karşılığı (CANCEL_REVERSAL + sapma damgası) yazılır. Reddetmek, LIFO ile
// birleşince o deponun TÜM eski sayımlarının storno yolunu kalıcı kapatıyordu.
// ⚠️ ÇİFT YAZIM SEDDİ TEK ALANDADIR: "bu geri alma deftere yazıldı mı" sorusunun
// cevabı, ileri (CANCEL) satırının terslenmiş olup olmadığıdır — `reversesMovementId`
// zinciri (tasarım D2a/D2b). Satır zaten terslenmişse ters kayıt YAZILMAZ, yalnız
// sapma damgası atılır; aynı satırın iki kez terslenmesini DB unique'i kapatır.
// Tip sayma / belge bağıyla eşleme YAKLAŞIKTI ve kardeş sayımın satırını sedde
// takıyordu (denetim 2026-09-12).
// =============================================================================
import { GoodsReceiptStatus, Prisma, PrintedDocType, RollStatus, StockCountLineKind } from "@prisma/client";
import { StockCountStatus, WarehouseEventType, YarnMovementKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { uyari } from "../lib/logger";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { printedDocumentService } from "./printed-document.service";
import { syncPurchaseOrderSafely } from "./purchase-order.service";
import { readIplikEnabled } from "./system-setting.service";
import { applyYarnMovementTx, yarnMovementSign } from "./yarn.service";
import { postStockMove, reverseStockMove } from "./helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../constants/stock-move-reasons";
import { stockCountCancelReason, stockCountVoidReason } from "./stock-count.service";
import {
  buildPlan,
  COUNT_HEAD_SELECT,
  type ReversalPlan,
  type ReversalRollAction,
  type ReversalRollPlan,
  type ReversalYarnPlan,
} from "./helpers/stock-count-reversal-plan.helper";

export type { ReversalPlan, ReversalRollAction, ReversalRollPlan, ReversalYarnPlan };

type Db = Prisma.TransactionClient | typeof prisma;

export class StockCountReversalService {
  /** Önizleme — stornonun dokunacağı HER top ve iplik kalemi, engelleriyle. */
  async preview(stockCountId: string): Promise<ApiResponse<ReversalPlan>> {
    const count = await prisma.stockCount.findUnique({ where: { id: stockCountId }, select: COUNT_HEAD_SELECT });
    if (!count) throw AppError.notFound("Sayım bulunamadı.");
    return { success: true, data: await buildPlan(prisma, count, { afterClaim: false }) };
  }

  async reverse(
    stockCountId: string,
    reason: string,
    userId?: string,
  ): Promise<
    ApiResponse<{ id: string; countNo: string; restoredRolls: number; ledgerOnlyRolls: number; yarnReversals: number }>
  > {
    const trimmed = reason?.trim() ?? "";
    if (trimmed.length < 3) throw AppError.badRequest("Storno gerekçesi en az 3 karakter olmalı.");

    const outcome = await prisma.$transaction((tx) => reverseTx(tx, stockCountId, trimmed, userId));

    await syncReceipts(outcome.countNo, outcome.receiptIds);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "STOCK_COUNT",
      recordId: stockCountId,
      newData: {
        event: "STOCK_COUNT_REVERSED",
        countNo: outcome.countNo,
        reason: trimmed,
        restoredRolls: outcome.restoredRolls,
        ledgerOnlyRolls: outcome.ledgerOnlyRolls,
        yarnReversals: outcome.yarnReversals,
        barcodes: outcome.barcodes,
      },
    });
    return {
      success: true,
      data: {
        id: stockCountId,
        countNo: outcome.countNo,
        restoredRolls: outcome.restoredRolls,
        ledgerOnlyRolls: outcome.ledgerOnlyRolls,
        yarnReversals: outcome.yarnReversals,
      },
      message:
        `${outcome.countNo} stornolandı — ${outcome.restoredRolls} top rafına döndü, ` +
        `${outcome.yarnReversals} iplik düzeltmesi geri alındı` +
        (outcome.ledgerOnlyRolls > 0
          ? `; ${outcome.ledgerOnlyRolls} top zaten elle geri alınmıştı, yalnız defteri kapatıldı.`
          : "."),
    };
  }
}

/** Kilit + claim + plan; engel varsa tx geri sarılır ve damga da gider. */
async function claimAndPlanTx(tx: Prisma.TransactionClient, stockCountId: string, reason: string, userId?: string) {
  // İlk ifade: sayımın ve deponun AÇIK taslak sayımının satır kilidi (id sırasıyla).
  // Taslak tamamlaması aynı satırı claim eder → storno ile arası sıralanır.
  await tx.$queryRaw`
    SELECT id FROM stock_counts
    WHERE "warehouseId" = (SELECT "warehouseId" FROM stock_counts WHERE id = ${stockCountId}::uuid)
      AND (id = ${stockCountId}::uuid OR status = 'DRAFT'::"StockCountStatus")
    ORDER BY id FOR UPDATE
  `;
  const claim = await tx.stockCount.updateMany({
    where: { id: stockCountId, status: StockCountStatus.COMPLETED, reversedAt: null },
    data: { reversedAt: new Date(), reversedById: userId ?? null, reverseReason: reason.slice(0, 300) },
  });
  const count = await tx.stockCount.findUnique({ where: { id: stockCountId }, select: COUNT_HEAD_SELECT });
  if (!count) throw AppError.notFound("Sayım bulunamadı.");
  if (claim.count === 0) {
    throw AppError.conflict(
      count.reversedAt ? `${count.countNo} zaten stornolanmış.` : `${count.countNo} tamamlanmış değil — stornolanamaz.`,
      { code: "STOCK_COUNT_NOT_REVERSIBLE" },
    );
  }
  const plan = await buildPlan(tx, count, { afterClaim: true });
  const blockedRolls = plan.rolls.filter((r) => r.blocker);
  if (plan.blockers.length > 0 || blockedRolls.length > 0) {
    throw AppError.conflict(`${count.countNo} stornolanamaz — ${[...plan.blockers, ...blockedRolls.map((r) => `${r.barcode ?? r.rollId}: ${r.blocker}`)].join(" · ")}`.slice(0, 900), {
      code: "STOCK_COUNT_REVERSAL_BLOCKED",
      blockers: plan.blockers,
      blockedRolls: blockedRolls.map((r) => ({ rollId: r.rollId, barcode: r.barcode, reason: r.blocker })),
    });
  }
  return plan;
}

async function reverseTx(tx: Prisma.TransactionClient, stockCountId: string, reason: string, userId?: string) {
  const plan = await claimAndPlanTx(tx, stockCountId, reason, userId);
  const note = `${plan.countNo} sayım stornosu`;

  // Yalnız RESTORE dalı statüye dokunur; hedef statü topa göre değiştiği için gruplu claim.
  const restoring = plan.rolls.filter((r) => r.action === "RESTORE");
  const groups = new Map<RollStatus, string[]>();
  for (const r of restoring) groups.set(r.targetStatus as RollStatus, [...(groups.get(r.targetStatus as RollStatus) ?? []), r.rollId]);
  for (const [target, ids] of groups) {
    const res = await tx.roll.updateMany({
      where: { id: { in: ids }, status: RollStatus.CANCELLED, cancelReason: stockCountCancelReason(plan.countNo), warehouseId: plan.warehouseId },
      data: { status: target, cancelledAt: null, cancelledById: null, cancelReason: null, cancelReasonCode: null, preCancelStatus: null },
    });
    if (res.count !== ids.length) throw AppError.conflict("Toplardan biri bu sırada değişti — tekrar deneyin.");
  }

  // Ters satır yazılacak toplar: ALREADY_REVERSED dışındakiler (çift yazım seddi).
  // TOPLU YAZIM YOK ve olamaz: her ters satır KENDİ ileri satırının id'sine bağlanır,
  // `createMany` ise id döndürmez. Kapı satır başına FIRLATIR, yani "sessizce atlanan
  // satır" sınıfı kapandı; eski sayı denetimi gereksiz kaldı.
  const needLedger = plan.rolls.filter((r) => r.action !== "ALREADY_REVERSED");
  for (const r of needLedger) {
    if (r.cancelMovementId && r.cancelHasStatus) {
      await reverseStockMove(tx, r.cancelMovementId, {
        reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
        // Enum BETİMLEYİCİDİR (tespit bağdan yapılır): panel/rapor/audit aynası korunsun
        // diye ters satır `CANCEL_REVERSAL` yazılır, ileri satırın tipi kopyalanmaz.
        eventType: WarehouseEventType.CANCEL_REVERSAL,
        userId: userId ?? null,
        notes: note,
      });
      continue;
    }
    // ESKİ KAYIT DALI (grandfathering, tasarım D2b): ileri satır yok ya da `fromStatus`
    // taşımıyor — yön aynalanamaz, uç elle kurulur ve satır BAĞSIZ kalır. Σ etkilenmez
    // (katkı yönden gelir, bağdan değil); yeni yazan yol bağı doldurmak zorundadır.
    if (!r.ledgerToStatus) {
      throw AppError.internal(
        `${r.barcode ?? r.rollId}: ters kaydın giriş ucu kurulamadı (statü bilinmiyor).`,
      );
    }
    await postStockMove(tx, {
      rollId: r.rollId,
      eventType: WarehouseEventType.CANCEL_REVERSAL,
      qty: r.qty,
      to: { warehouseId: plan.warehouseId, status: r.ledgerToStatus },
      reasonCode: STOCK_MOVE_REASON.STOCK_COUNT,
      stockCountId: plan.countId,
      userId: userId ?? null,
      notes: note,
    });
  }
  if (plan.rolls.length > 0) {
    // Sapma damgası HER dalda atılır (defter satırını başkası yazmış olsa bile
    // "bu metraj yoktu" iddiası geri alınmıştır) — 6e ile iş bölümü.
    const varianceIds = plan.rolls.map((r) => r.varianceId as string);
    const rev = await tx.rollVariance.updateMany({
      where: { id: { in: varianceIds }, reversedAt: null },
      data: { reversedAt: new Date(), reversedById: userId ?? null },
    });
    if (rev.count !== varianceIds.length) throw AppError.conflict("Sapma kayıtlarından biri bu sırada değişti — tekrar deneyin.");
  }

  for (const y of plan.yarn) {
    await applyYarnMovementTx(tx, {
      itemId: y.itemId,
      warehouseId: plan.warehouseId,
      kind: y.reversalKind,
      qtyKg: y.countNetKg.abs(),
      stockCountId: plan.countId,
      reason: note,
      userId: userId ?? null,
    });
  }

  await printedDocumentService.voidForSource(tx, PrintedDocType.STOCK_COUNT, plan.countId, stockCountVoidReason(reason));

  return {
    countNo: plan.countNo,
    restoredRolls: restoring.length,
    ledgerOnlyRolls: plan.rolls.filter((r) => r.action === "LEDGER_ONLY").length,
    yarnReversals: plan.yarn.length,
    barcodes: plan.rolls.map((r) => r.barcode),
    receiptIds: [...new Set(plan.rolls.map((r) => r.goodsReceiptId).filter(Boolean))] as string[],
  };
}

/** Rafına dönen top bir mal kabulünden doğduysa sipariş karşılaması değişti (tx dışı, yutulur). */
async function syncReceipts(countNo: string, receiptIds: string[]): Promise<void> {
  if (receiptIds.length === 0) return;
  try {
    const receipts = await prisma.goodsReceipt.findMany({
      where: { id: { in: receiptIds }, status: GoodsReceiptStatus.ACTIVE },
      select: { purchaseOrderId: true },
    });
    const poIds = [...new Set(receipts.map((r) => r.purchaseOrderId).filter(Boolean))] as string[];
    for (const poId of poIds) await syncPurchaseOrderSafely(poId);
  } catch (e) {
    uyari("stock-count", `${countNo} storno sonrası PO senkronu başarısız:`, (e as Error).message);
  }
}

export const stockCountReversalService = new StockCountReversalService();
