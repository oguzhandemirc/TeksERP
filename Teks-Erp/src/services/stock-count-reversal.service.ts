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
// ⚠️ ÇİFT YAZIM SEDDİ: ters satır zaten varsa (ister bu storno, ister elle geri
// alma yazmış olsun) satır YAZILMAZ — yalnız sapma damgası atılır. Geçici kural
// (rollId + stockCountId + tip ∪ sayım tamamlamasından SONRA yazılmış ters satır);
// `reversesMovementId` alanı gelince tek sorguya iner (6e sözleşmesi).
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
import { resolveRestoreTargetStatus } from "./helpers/roll-cancel-restore.helper";
import { writeWarehouseMovements } from "./helpers/warehouse-ledger.helper";
import { VARIANCE_SOURCES } from "../constants/variance-reasons";
import { ROLL_STATUS_TR } from "../constants/status-labels";
import { stockCountCancelReason, stockCountVoidReason } from "./stock-count.service";

type Db = Prisma.TransactionClient | typeof prisma;

/** Topun stornoda göreceği işlem — önizleme bunu satır satır basar. */
export type ReversalRollAction = "RESTORE" | "LEDGER_ONLY" | "ALREADY_REVERSED";

export interface ReversalRollPlan {
  rollId: string;
  barcode: string | null;
  qty: Prisma.Decimal;
  varianceId: string | null;
  /** `RESTORE`da dönülecek raf; diğer dallarda null (statüye dokunulmaz). */
  targetStatus: RollStatus | null;
  goodsReceiptId: string | null;
  action: ReversalRollAction;
  /** Dalın gerekçesi (LEDGER_ONLY/ALREADY_REVERSED) — önizlemede görünür. */
  note: string | null;
  blocker: string | null;
}

export interface ReversalYarnPlan {
  itemId: string;
  itemName: string;
  /** Sayımın bakiyeye net etkisi (işaretli); storno bunun tersini yazar. */
  countNetKg: Prisma.Decimal;
  reversalKind: YarnMovementKind;
  balanceKg: Prisma.Decimal;
  balanceAfterKg: Prisma.Decimal;
}

export interface ReversalPlan {
  countId: string;
  countNo: string;
  warehouseId: string;
  blockers: string[];
  rolls: ReversalRollPlan[];
  yarn: ReversalYarnPlan[];
}

interface CountHead {
  id: string;
  countNo: string;
  warehouseId: string;
  status: StockCountStatus;
  completedAt: Date | null;
  reversedAt: Date | null;
}

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);

/** Belge düzeyi engeller — statü, önceki storno ve LIFO. Önizleme ve storno aynı listeyi görür. */
async function documentBlockers(db: Db, count: CountHead, opts: { afterClaim: boolean }): Promise<string[]> {
  const out: string[] = [];
  if (count.status !== StockCountStatus.COMPLETED) out.push("Yalnız tamamlanmış sayım stornolanır.");
  if (count.reversedAt && !opts.afterClaim) out.push("Bu sayım zaten stornolanmış.");
  if (count.completedAt) {
    const later = await db.stockCount.findFirst({
      where: {
        warehouseId: count.warehouseId,
        status: StockCountStatus.COMPLETED,
        reversedAt: null,
        completedAt: { gt: count.completedAt },
        id: { not: count.id },
      },
      orderBy: { completedAt: "desc" },
      select: { countNo: true },
    });
    if (later) out.push(`Bu depoda daha sonra tamamlanmış ${later.countNo} var — önce o stornolanmalı.`);
  }
  return out;
}

/** Sayımın düşürdüğü toplar ve her birinin geri dönüş planı. */
async function planRolls(db: Db, count: CountHead): Promise<ReversalRollPlan[]> {
  const lines = await db.stockCountLine.findMany({
    where: { stockCountId: count.id, kind: StockCountLineKind.ROLL, found: false, outOfScopeReason: null, rollId: { not: null } },
    select: { rollId: true },
    orderBy: { createdAt: "asc" },
  });
  const rollIds = lines.map((l) => l.rollId as string);
  if (rollIds.length === 0) return [];

  const rolls = await db.roll.findMany({
    where: { id: { in: rollIds } },
    select: { id: true, barcode: true, status: true, cancelReason: true, preCancelStatus: true, warehouseId: true, goodsReceiptId: true },
  });
  const variances = await db.rollVariance.findMany({
    where: {
      rollId: { in: rollIds },
      source: VARIANCE_SOURCES.STOCK_COUNT,
      reversedAt: null,
      OR: [{ sourceRefId: count.id }, { sourceRefId: null, reasonText: stockCountCancelReason(count.countNo) }],
    },
    select: { id: true, rollId: true, qty: true },
  });
  // Ters satırı ZATEN yazılmış toplar: bu sayıma bağlı olanlar + sayım
  // tamamlandıktan SONRA yazılmış olanlar (elle geri alma bağ yazmıyor).
  const alreadyReversed = new Set(
    (
      await db.warehouseMovement.findMany({
        where: {
          rollId: { in: rollIds },
          eventType: WarehouseEventType.CANCEL_REVERSAL,
          OR: [
            { stockCountId: count.id },
            ...(count.completedAt ? [{ createdAt: { gte: count.completedAt } }] : []),
          ],
        },
        select: { rollId: true },
      })
    ).map((w) => w.rollId),
  );
  const byRoll = new Map(rolls.map((r) => [r.id, r]));
  const expectedReason = stockCountCancelReason(count.countNo);

  return rollIds.map((rollId) => {
    const roll = byRoll.get(rollId);
    const own = variances.filter((v) => v.rollId === rollId);
    let blocker: string | null = null;
    if (!roll) blocker = "Top kaydı bulunamadı";
    else if (own.length !== 1) blocker = own.length === 0 ? "Sayımın sapma kaydı bulunamadı" : "Birden çok sapma kaydı var";

    const cancelledByThisCount =
      roll?.status === RollStatus.CANCELLED && roll.cancelReason === expectedReason;
    if (!blocker && cancelledByThisCount && roll && roll.warehouseId !== count.warehouseId) {
      blocker = "Deposu değişmiş";
    }
    let action: ReversalRollAction = cancelledByThisCount ? "RESTORE" : "LEDGER_ONLY";
    let note: string | null = cancelledByThisCount
      ? null
      : `Sayımdan sonra elle geri alınmış ya da başka işlem görmüş (şu an: ${roll ? ROLL_STATUS_TR[roll.status] : "—"}) — yalnız defter karşılığı yazılır`;
    if (alreadyReversed.has(rollId)) {
      action = "ALREADY_REVERSED";
      note = "Defter karşılığı zaten yazılmış — yalnız sapma damgası atılır";
    }
    return {
      rollId,
      barcode: roll?.barcode ?? null,
      qty: own[0] ? D(own[0].qty) : D(0),
      varianceId: own[0]?.id ?? null,
      targetStatus: action === "RESTORE" && roll && !blocker ? resolveRestoreTargetStatus(roll.preCancelStatus) : null,
      goodsReceiptId: roll?.goodsReceiptId ?? null,
      action,
      note,
      blocker,
    };
  });
}

/** Sayımın iplik defterine net etkisi — goods-receipt stornosunun net deseni. */
async function planYarn(db: Db, count: CountHead): Promise<ReversalYarnPlan[]> {
  const rows = await db.yarnMovement.findMany({
    where: { stockCountId: count.id },
    select: { itemId: true, kind: true, qtyKg: true, item: { select: { name: true } } },
  });
  const nets = new Map<string, { itemName: string; net: Prisma.Decimal }>();
  for (const r of rows) {
    const cur = nets.get(r.itemId) ?? { itemName: r.item.name, net: D(0) };
    cur.net = cur.net.plus(D(r.qtyKg).mul(yarnMovementSign(r.kind)));
    nets.set(r.itemId, cur);
  }
  const out: ReversalYarnPlan[] = [];
  for (const [itemId, n] of nets) {
    if (n.net.isZero()) continue;
    const stock = await db.yarnStock.findUnique({
      where: { itemId_warehouseId: { itemId, warehouseId: count.warehouseId } },
      select: { balanceKg: true },
    });
    const balance = D(stock?.balanceKg ?? 0);
    out.push({
      itemId,
      itemName: n.itemName,
      countNetKg: n.net,
      reversalKind: n.net.gt(0) ? YarnMovementKind.ADJUST_OUT : YarnMovementKind.ADJUST_IN,
      balanceKg: balance,
      balanceAfterKg: balance.minus(n.net),
    });
  }
  return out;
}

async function buildPlan(db: Db, count: CountHead, opts: { afterClaim: boolean }): Promise<ReversalPlan> {
  const blockers = await documentBlockers(db, count, opts);
  const rolls = await planRolls(db, count);
  const yarn = await planYarn(db, count);
  if (yarn.length > 0 && !(await readIplikEnabled(db))) {
    blockers.push("İplik modülü kapalı — sayımın iplik düzeltmesi geri alınamaz.");
  }
  return { countId: count.id, countNo: count.countNo, warehouseId: count.warehouseId, blockers, rolls, yarn };
}

const COUNT_HEAD_SELECT = {
  id: true,
  countNo: true,
  warehouseId: true,
  status: true,
  completedAt: true,
  reversedAt: true,
} satisfies Prisma.StockCountSelect;

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
  const needLedger = plan.rolls.filter((r) => r.action !== "ALREADY_REVERSED");
  if (needLedger.length > 0) {
    // ⚠️ Dönen sayı DENETLENİR: helper qty<0 ya da depo boşsa satırı SESSİZCE atlar
    // (`warehouse-ledger.helper`). Atlanan satır = yazılmamış ters kayıt.
    const written = await writeWarehouseMovements(
      tx,
      needLedger.map((r) => ({
        rollId: r.rollId,
        eventType: WarehouseEventType.CANCEL_REVERSAL,
        qty: r.qty,
        toWarehouseId: plan.warehouseId,
        stockCountId: plan.countId,
        userId: userId ?? null,
        notes: note,
      })),
    );
    if (written !== needLedger.length) {
      throw AppError.internal(`Depo defterine ${written}/${needLedger.length} storno satırı yazıldı — geri sarıldı.`);
    }
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
