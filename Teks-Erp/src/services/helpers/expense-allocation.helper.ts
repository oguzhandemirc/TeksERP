// =============================================================================
// MASRAF BAĞI (ExpenseAllocation) — kapılar + as-of okuyucu TEK KAYNAK (D4-H3, DALGA4 §9.5, K19)
// =============================================================================
// Bağ DEFTERDİR: ters = DAMGA (`revokedAt`), değişim = damga + yeni satır (aynı tx). Kârlılık bağı "şu an aktif"
// diye OKUMAZ — tek okuyucu `listExpenseAllocationsAsOf`: dönem sonunda geçerli bağlar + dönem içindeki geç bağ
// olayları. Böylece geçmiş dönemin sonucu sonraki bağ değişiminden etkilenmez, etki değişim dönemine düşer.
// =============================================================================
import { CashTxnKind, ItemType, PaymentStatus, Prisma, WorkOrderStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { assertItemUsable } from "./item-usage.helper";
import type { ExpenseAllocationClosedWorkOrder } from "../system-setting.service";

export const EXPENSE_ALLOCATION_SHARE_MAX = new Prisma.Decimal(100);

/** Hedef — tam olarak biri dolu (DB CHECK `expense_allocations_target_ck` ile aynı yüklem). */
export interface ExpenseAllocationTarget {
  machineId: string | null;
  workOrderId: string | null;
  serviceItemId: string | null;
}

/** Kapanmış sayılan iş emri durumları (`finance.masraf.kapaliIsEmrineBag` = DENY bunlara bağı keser). */
const CLOSED_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED];

export function normalizeAllocationTarget(input: {
  machineId?: string | null;
  workOrderId?: string | null;
  serviceItemId?: string | null;
}): ExpenseAllocationTarget {
  const t = { machineId: input.machineId || null, workOrderId: input.workOrderId || null, serviceItemId: input.serviceItemId || null };
  const filled = [t.machineId, t.workOrderId, t.serviceItemId].filter(Boolean).length;
  if (filled !== 1) {
    throw AppError.badRequest("Masraf tam olarak BİR hedefe bağlanır: makine, terbiye iş emri ya da hizmet kalemi.", { code: "EXPENSE_ALLOCATION_TARGET" });
  }
  return t;
}

/** Replay kimliği ve audit için hedefin tek satırlık anahtarı. */
/** Bağın hedef kimliği (tam olarak biri dolu — DB CHECK); kalem çözücü değil, hedef seçicidir. */
export function allocationTargetId(t: ExpenseAllocationTarget): string {
  if (t.machineId) return t.machineId;
  if (t.workOrderId) return t.workOrderId;
  return t.serviceItemId as string;
}

export function allocationTargetKey(t: ExpenseAllocationTarget): string {
  if (t.machineId) return `machine:${t.machineId}`;
  if (t.workOrderId) return `workOrder:${t.workOrderId}`;
  return `serviceItem:${t.serviceItemId ?? ""}`;
}

export interface LockedExpenseRow {
  id: string;
  docNo: string;
  kind: string;
  status: string;
  cashBoxId: string | null;
  bankAccountId: string | null;
  txnDate: Date;
}

/**
 * Masraf satırını kilitler (iptal ile aynı satır kilidi → iptal ↔ bağ serileşir) ve bağlanabilirliğini ölçer.
 * Sıra: bu çağrı token kilidinden (8036) SONRA, dönem kapısından (8028) ÖNCE — iptal yolu da satır → 8028 sırasıyla gider.
 */
export async function lockExpenseRowTx(tx: Prisma.TransactionClient, cashTransactionId: string): Promise<LockedExpenseRow> {
  const [row] = await tx.$queryRaw<LockedExpenseRow[]>`
    SELECT id, "docNo", kind::text AS kind, status::text AS status, "cashBoxId", "bankAccountId", "txnDate"
    FROM cash_transactions WHERE id = ${cashTransactionId}::uuid FOR UPDATE`;
  if (!row) throw AppError.notFound("Kasa hareketi bulunamadı.", { code: "CASH_TXN_NOT_FOUND" });
  if (row.kind !== CashTxnKind.EXPENSE) {
    throw AppError.badRequest(`${row.docNo} bir masraf değil — yalnız masraf satırı makineye/işe bağlanır.`, { code: "EXPENSE_ALLOCATION_NOT_EXPENSE" });
  }
  if (row.status !== PaymentStatus.ACTIVE) {
    throw AppError.conflict(`${row.docNo} iptal edilmiş — iptal edilmiş masrafın bağı değiştirilemez.`, { code: "CASH_TXN_CANCELLED", docNo: row.docNo });
  }
  return row;
}

/** Hedef var mı, bağlanabilir mi: pasif makine / pasif ya da hizmet olmayan kalem / (ayara göre) kapanmış iş emri → 4xx. */
export async function assertAllocationTargetTx(
  tx: Prisma.TransactionClient,
  t: ExpenseAllocationTarget,
  closedWorkOrder: ExpenseAllocationClosedWorkOrder,
): Promise<void> {
  if (t.machineId) {
    const m = await tx.machine.findUnique({ where: { id: t.machineId }, select: { name: true, isActive: true } });
    if (!m) throw AppError.notFound("Makine bulunamadı.", { code: "MACHINE_NOT_FOUND" });
    if (!m.isActive) throw AppError.conflict(`"${m.name}" makinesi pasif — pasif makineye yeni masraf bağlanmaz.`, { code: "MACHINE_INACTIVE" });
    return;
  }
  if (t.workOrderId) {
    const wo = await tx.workOrder.findUnique({ where: { id: t.workOrderId }, select: { workOrderNumber: true, status: true } });
    if (!wo) throw AppError.notFound("Terbiye iş emri bulunamadı.", { code: "WORK_ORDER_NOT_FOUND" });
    if (closedWorkOrder === "DENY" && CLOSED_WORK_ORDER_STATUSES.includes(wo.status)) {
      throw AppError.conflict(`${wo.workOrderNumber} kapanmış — fabrika ayarı gereği kapanmış terbiye iş emrine masraf bağlanmaz.`, {
        code: "WORK_ORDER_CLOSED",
        workOrderNumber: wo.workOrderNumber,
      });
    }
    return;
  }
  // Kart kullanım kararı TEK kaynaktan (pasif/birleşmiş → 409); bağ yeni kart referansı doğurmaz → kilitsiz kol.
  const item = await assertItemUsable(tx, t.serviceItemId as string, "EXISTING_GOODS");
  if (item.itemType !== ItemType.SERVICE) {
    throw AppError.badRequest(`"${item.name}" bir hizmet kalemi değil.`, { code: "EXPENSE_ALLOCATION_NOT_SERVICE_ITEM" });
  }
}

/** Σ aktif pay + yeni pay ≤ 100. Masraf satırı kilitliyken çağrılır (kilit Σ okumasını serileştirir). */
/** Masrafın aktif bağ payı toplamı — Σ kapısı ve panel "kalan pay" gösterimi TEK kaynaktan okur. */
export async function activeSharePct(db: Prisma.TransactionClient, cashTransactionId: string): Promise<Prisma.Decimal> {
  const agg = await db.expenseAllocation.aggregate({ where: { cashTransactionId, revokedAt: null }, _sum: { sharePct: true } });
  return agg._sum.sharePct ?? new Prisma.Decimal(0);
}

export async function assertShareWithinLimitTx(tx: Prisma.TransactionClient, cashTransactionId: string, sharePct: Prisma.Decimal): Promise<void> {
  const used = await activeSharePct(tx, cashTransactionId);
  if (used.plus(sharePct).gt(EXPENSE_ALLOCATION_SHARE_MAX)) {
    const remaining = EXPENSE_ALLOCATION_SHARE_MAX.minus(used);
    throw AppError.conflict(
      `Bu masrafın %${used.toString()}'i zaten bağlı; en çok %${remaining.toString()} daha bağlanabilir.`,
      { code: "EXPENSE_ALLOCATION_OVER", usedPct: used.toString(), requestedPct: sharePct.toString(), remainingPct: remaining.toString() },
    );
  }
}

// ── AS-OF OKUYUCU ────────────────────────────────────────────────────────────

const AS_OF_SELECT = {
  id: true,
  cashTransactionId: true,
  machineId: true,
  workOrderId: true,
  serviceItemId: true,
  sharePct: true,
  createdAt: true,
  revokedAt: true,
  cashTransaction: { select: { docNo: true, txnDate: true, category: true, amountTry: true, status: true, cancelledAt: true } },
} satisfies Prisma.ExpenseAllocationSelect;

type AsOfSource = Prisma.ExpenseAllocationGetPayload<{ select: typeof AS_OF_SELECT }>;

export interface ExpenseAllocationAsOfRow {
  allocationId: string;
  cashTransactionId: string;
  docNo: string;
  txnDate: Date;
  category: string | null;
  /** Masrafın durumu — iptalin ters çevrimi tüketicinindir (bağ iptalle damgalanmaz). */
  status: PaymentStatus;
  cancelledAt: Date | null;
  machineId: string | null;
  workOrderId: string | null;
  serviceItemId: string | null;
  sharePct: Prisma.Decimal;
  /** amountTry × pay / 100, 2 hane; geç bağ olayında işaretli (+ bağ, − damga). */
  allocatedTry: Prisma.Decimal;
}

export interface ExpenseAllocationLateEvent extends ExpenseAllocationAsOfRow {
  event: "LINKED" | "REVOKED";
  eventAt: Date;
}

export interface ExpenseAllocationsAsOf {
  /** (1) Dönem içi masrafların dönem SONUNDA geçerli bağları: createdAt < end ∧ (revokedAt yok ∨ revokedAt ≥ end). */
  atPeriodEnd: ExpenseAllocationAsOfRow[];
  /** (2) Dönemden ÖNCEKİ masraflara dönem İÇİNDE yapılan bağ olayları (geç bağ düzeltmesi; toplam korunur). */
  lateEvents: ExpenseAllocationLateEvent[];
}

function toAsOfRow(a: AsOfSource, sign: 1 | -1): ExpenseAllocationAsOfRow {
  const share = a.sharePct;
  return {
    allocationId: a.id,
    cashTransactionId: a.cashTransactionId,
    docNo: a.cashTransaction.docNo,
    txnDate: a.cashTransaction.txnDate,
    category: a.cashTransaction.category,
    status: a.cashTransaction.status,
    cancelledAt: a.cashTransaction.cancelledAt,
    machineId: a.machineId,
    workOrderId: a.workOrderId,
    serviceItemId: a.serviceItemId,
    sharePct: share,
    allocatedTry: a.cashTransaction.amountTry.times(share).dividedBy(100).toDecimalPlaces(2).times(sign),
  };
}

type AsOfReader = Pick<Prisma.TransactionClient, "expenseAllocation">;
const ORDER: Prisma.ExpenseAllocationOrderByWithRelationInput[] = [{ cashTransaction: { txnDate: "asc" } }, { createdAt: "asc" }, { id: "asc" }];

/**
 * TEK OKUYUCU (K19/K15) — `[start, end)` dönemi için masraf bağları. Dönem sınırlarını çağıran fabrika saatinden
 * (`constants/time.ts`) verir. Yalnız EXPENSE masrafları; iptal edilmiş masraf satırı durumuyla döner.
 */
export async function listExpenseAllocationsAsOf(db: AsOfReader, range: { start: Date; end: Date }): Promise<ExpenseAllocationsAsOf> {
  const { start, end } = range;
  if (!(start < end)) throw AppError.badRequest("Dönem başlangıcı bitişinden önce olmalı.");
  const current = await db.expenseAllocation.findMany({
    where: {
      createdAt: { lt: end },
      OR: [{ revokedAt: null }, { revokedAt: { gte: end } }],
      cashTransaction: { kind: CashTxnKind.EXPENSE, txnDate: { gte: start, lt: end } },
    },
    select: AS_OF_SELECT,
    orderBy: ORDER,
  });
  const late = await db.expenseAllocation.findMany({
    where: {
      cashTransaction: { kind: CashTxnKind.EXPENSE, txnDate: { lt: start } },
      OR: [{ createdAt: { gte: start, lt: end } }, { revokedAt: { gte: start, lt: end } }],
    },
    select: AS_OF_SELECT,
    orderBy: ORDER,
  });
  const lateEvents: ExpenseAllocationLateEvent[] = [];
  for (const a of late) {
    if (a.createdAt >= start && a.createdAt < end) lateEvents.push({ ...toAsOfRow(a, 1), event: "LINKED", eventAt: a.createdAt });
    if (a.revokedAt && a.revokedAt >= start && a.revokedAt < end) lateEvents.push({ ...toAsOfRow(a, -1), event: "REVOKED", eventAt: a.revokedAt });
  }
  lateEvents.sort((x, y) => x.eventAt.getTime() - y.eventAt.getTime() || (x.allocationId < y.allocationId ? -1 : x.allocationId > y.allocationId ? 1 : 0));
  return { atPeriodEnd: current.map((a) => toAsOfRow(a, 1)), lateEvents };
}
