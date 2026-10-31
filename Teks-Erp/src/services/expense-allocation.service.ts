// =============================================================================
// MASRAF BAĞI — yarat / değiştir / kaldır / listele (D4-H3, ister 5.3/4.3; DALGA4 §9.5)
// =============================================================================
// Tx sırası (yarat + değiştir): 8036 token kilidi (K kipi, İLK ifade) → masraf satırı FOR UPDATE (iptal → 409
// CASH_TXN_CANCELLED) → kasa dönem kapısı (8028, kapalı → 409) → hedef kapısı → Σ pay ≤ 100 (aşan 409
// EXPENSE_ALLOCATION_OVER) → insert. Değişim = atomik damga + yeni satır aynı tx; kaldırma = damga. Masraf iptali
// bağları damgalamaz. Audit tx DIŞINDA, tutar taşımaz.
// =============================================================================
import { Prisma, type ExpenseAllocation } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { assertCashPeriodOpenTx } from "./helpers/cash-period-guard.helper";
import {
  allocationTargetKey,
  assertAllocationTargetTx,
  assertShareWithinLimitTx,
  EXPENSE_ALLOCATION_SHARE_MAX,
  lockExpenseRowTx,
  normalizeAllocationTarget,
  type ExpenseAllocationTarget,
} from "./helpers/expense-allocation.helper";
import { readFinanceExpenseAllocationClosedWorkOrder, readFinanceExpenseAllocationField } from "./system-setting.service";

const TABLE = "EXPENSE_ALLOCATION";

export interface ExpenseAllocationInput {
  machineId?: string | null;
  workOrderId?: string | null;
  serviceItemId?: string | null;
  sharePct: string | number;
  clientToken: string;
}

export interface ExpenseAllocationRow {
  id: string;
  cashTransactionId: string;
  targetType: "MACHINE" | "WORK_ORDER" | "SERVICE_ITEM";
  machineId: string | null;
  workOrderId: string | null;
  serviceItemId: string | null;
  targetLabel: string;
  sharePct: string;
  createdAt: Date;
  createdByName: string | null;
  revokedAt: Date | null;
  revokedByName: string | null;
  revokeReason: string | null;
}

/** Pay: 0 < x ≤ 100, en çok 2 ondalık (DB `Decimal(5,2)` + CHECK ile aynı sınır; anlaşılır 400 burada). */
export function parseSharePct(v: string | number): Prisma.Decimal {
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(typeof v === "number" ? String(v) : v.trim().replace(",", "."));
  } catch {
    throw AppError.badRequest("Pay (%) sayı olmalı.", { code: "EXPENSE_ALLOCATION_SHARE" });
  }
  if (!d.isFinite() || d.lte(0) || d.gt(EXPENSE_ALLOCATION_SHARE_MAX) || d.decimalPlaces() > 2) {
    throw AppError.badRequest("Pay (%) 0'dan büyük, en çok 100 ve en çok 2 ondalık olmalı.", { code: "EXPENSE_ALLOCATION_SHARE" });
  }
  return d;
}

export async function assertExpenseAllocationEnabled(): Promise<void> {
  if ((await readFinanceExpenseAllocationField()) === "OFF") {
    throw AppError.conflict("Masraf bağı fabrika ayarında kapalı (Genel Ayarlar › Finans › Masraf bağı).", { code: "EXPENSE_ALLOCATION_DISABLED" });
  }
}

const allocationReplay = (cashTransactionId: string, target: ExpenseAllocationTarget, share: Prisma.Decimal) =>
  tokenReplay<ExpenseAllocation, ExpenseAllocation>({
    find: (db, clientToken) => db.expenseAllocation.findUnique({ where: { clientToken } }),
    alive: (prior) => {
      if (!prior.revokedAt) return;
      throw AppError.conflict("Bu bağ kaydedilmiş ama sonra KALDIRILMIŞ — yeniden bağlamak için formu kapatıp yeniden açın.", {
        code: "EXPENSE_ALLOCATION_REVOKED",
        allocationId: prior.id,
      });
    },
    identity: (prior) => [
      { ad: "cashTransactionId", mevcut: prior.cashTransactionId, gelen: cashTransactionId },
      { ad: "hedef", mevcut: allocationTargetKey(prior), gelen: allocationTargetKey(target) },
      { ad: "sharePct", mevcut: prior.sharePct, gelen: share },
    ],
    collision: "Bu istemci anahtarı FARKLI bir masraf bağı için kullanılmış. Formu kapatıp yeniden açın.",
    collisionEk: (prior) => ({ allocationId: prior.id }),
    respond: (prior) => prior,
  });

/** Bağ satırının TEK yazarı — kasa masraf formu (aynı tx, `cash-transaction.service`) ve bu servis buradan yazar. */
export async function insertExpenseAllocationTx(
  tx: Prisma.TransactionClient,
  data: { cashTransactionId: string; target: ExpenseAllocationTarget; sharePct: Prisma.Decimal; clientToken: string; userId: string | null },
): Promise<ExpenseAllocation> {
  return tx.expenseAllocation.create({
    data: {
      cashTransactionId: data.cashTransactionId,
      machineId: data.target.machineId,
      workOrderId: data.target.workOrderId,
      serviceItemId: data.target.serviceItemId,
      sharePct: data.sharePct,
      clientToken: data.clientToken,
      createdById: data.userId,
    },
  });
}

/** Kasa masraf formu: yeni masraf satırı aynı tx'te bağlanır (yeni satırın Σ'ı boştur; dönem kapısı satırı yazanda). */
export async function linkNewExpenseTx(
  tx: Prisma.TransactionClient,
  link: { cashTransactionId: string; input: Omit<ExpenseAllocationInput, "clientToken">; clientToken: string; userId: string | null },
): Promise<ExpenseAllocation> {
  const { cashTransactionId, input, clientToken, userId } = link;
  const target = normalizeAllocationTarget(input);
  const share = parseSharePct(input.sharePct);
  await assertAllocationTargetTx(tx, target, await readFinanceExpenseAllocationClosedWorkOrder(tx));
  return insertExpenseAllocationTx(tx, { cashTransactionId, target, sharePct: share, clientToken, userId });
}

async function auditAllocation(userId: string, action: "CREATE" | "UPDATE", row: ExpenseAllocation, extra: Record<string, unknown> = {}): Promise<void> {
  await AuditService.log({
    userId,
    action,
    tableName: TABLE,
    recordId: row.id,
    newData: { cashTransactionId: row.cashTransactionId, hedef: allocationTargetKey(row), sharePct: row.sharePct.toString(), ...extra },
  }).catch(() => undefined);
}

async function lockedGatesTx(tx: Prisma.TransactionClient, cashTransactionId: string): Promise<void> {
  const row = await lockExpenseRowTx(tx, cashTransactionId);
  await assertCashPeriodOpenTx(tx, { cashBoxId: row.cashBoxId, bankAccountId: row.bankAccountId, txnDate: row.txnDate });
}

/** POST /api/finance/cash-transactions/:id/allocations */
export async function createExpenseAllocation(cashTransactionId: string, input: ExpenseAllocationInput, userId: string): Promise<ApiResponse<ExpenseAllocationRow>> {
  const target = normalizeAllocationTarget(input);
  const share = parseSharePct(input.sharePct);
  await assertExpenseAllocationEnabled();
  const closedWorkOrder = await readFinanceExpenseAllocationClosedWorkOrder();
  const replay = allocationReplay(cashTransactionId, target, share);
  const out = await prisma.$transaction(async (tx) => {
    const prior = await replay.inTx(tx, input.clientToken);
    if (prior) return { row: prior, written: false };
    await lockedGatesTx(tx, cashTransactionId);
    await assertAllocationTargetTx(tx, target, closedWorkOrder);
    await assertShareWithinLimitTx(tx, cashTransactionId, share);
    return { row: await insertExpenseAllocationTx(tx, { cashTransactionId, target, sharePct: share, clientToken: input.clientToken, userId }), written: true };
  });
  if (out.written) await auditAllocation(userId, "CREATE", out.row);
  return { success: true, data: (await toRows([out.row]))[0], message: out.written ? "Masraf bağlandı." : "Bağ zaten kaydedilmiş." };
}

function notActive(allocationId: string): AppError {
  return AppError.conflict("Bu bağ az önce değiştirildi ya da kaldırıldı — listeyi yenileyip tekrar deneyin.", {
    code: "EXPENSE_ALLOCATION_NOT_ACTIVE",
    allocationId,
  });
}

async function findAllocation(allocationId: string): Promise<{ cashTransactionId: string }> {
  const a = await prisma.expenseAllocation.findUnique({ where: { id: allocationId }, select: { cashTransactionId: true } });
  if (!a) throw AppError.notFound("Masraf bağı bulunamadı.", { code: "EXPENSE_ALLOCATION_NOT_FOUND" });
  return a;
}

/** POST /api/finance/expense-allocations/:id/change — damga + yeni satır (tek tx). */
export async function changeExpenseAllocation(
  allocationId: string,
  input: ExpenseAllocationInput & { reason?: string | null },
  userId: string,
): Promise<ApiResponse<ExpenseAllocationRow>> {
  const target = normalizeAllocationTarget(input);
  const share = parseSharePct(input.sharePct);
  await assertExpenseAllocationEnabled();
  const { cashTransactionId } = await findAllocation(allocationId);
  const closedWorkOrder = await readFinanceExpenseAllocationClosedWorkOrder();
  const replay = allocationReplay(cashTransactionId, target, share);
  const reason = input.reason?.trim() || "Bağ değiştirildi";
  const out = await prisma.$transaction(async (tx) => {
    const prior = await replay.inTx(tx, input.clientToken);
    if (prior) return { row: prior, written: false };
    await lockedGatesTx(tx, cashTransactionId);
    await assertAllocationTargetTx(tx, target, closedWorkOrder);
    const claimed = await tx.expenseAllocation.updateMany({
      where: { id: allocationId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: userId, revokeReason: reason.slice(0, 300) },
    });
    if (claimed.count === 0) throw notActive(allocationId);
    await assertShareWithinLimitTx(tx, cashTransactionId, share);
    return { row: await insertExpenseAllocationTx(tx, { cashTransactionId, target, sharePct: share, clientToken: input.clientToken, userId }), written: true };
  });
  if (out.written) await auditAllocation(userId, "UPDATE", out.row, { degistirilenBag: allocationId, reason });
  return { success: true, data: (await toRows([out.row]))[0], message: out.written ? "Masraf bağı değiştirildi." : "Bağ zaten kaydedilmiş." };
}

/** POST /api/finance/expense-allocations/:id/revoke — damga (ayar kapalıyken de açık: çıkış yolu). */
export async function revokeExpenseAllocation(allocationId: string, reason: string, userId: string): Promise<ApiResponse<ExpenseAllocationRow>> {
  const { cashTransactionId } = await findAllocation(allocationId);
  const row = await prisma.$transaction(async (tx) => {
    await lockedGatesTx(tx, cashTransactionId);
    const claimed = await tx.expenseAllocation.updateMany({
      where: { id: allocationId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: userId, revokeReason: reason.trim().slice(0, 300) },
    });
    if (claimed.count === 0) throw notActive(allocationId);
    return tx.expenseAllocation.findUniqueOrThrow({ where: { id: allocationId } });
  });
  await auditAllocation(userId, "UPDATE", row, { kaldirildi: true, reason: row.revokeReason });
  return { success: true, data: (await toRows([row]))[0], message: "Masraf bağı kaldırıldı." };
}

/** GET /api/finance/cash-transactions/:id/allocations — aktif bağlar + tarihçe + kalan pay. */
export async function listExpenseAllocationsForTxn(
  cashTransactionId: string,
): Promise<ApiResponse<{ rows: ExpenseAllocationRow[]; activePct: string; remainingPct: string }>> {
  const exists = await prisma.cashTransaction.findUnique({ where: { id: cashTransactionId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Kasa hareketi bulunamadı.", { code: "CASH_TXN_NOT_FOUND" });
  const rows = await prisma.expenseAllocation.findMany({ where: { cashTransactionId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 });
  const active = rows.filter((r) => !r.revokedAt).reduce((s, r) => s.plus(r.sharePct), new Prisma.Decimal(0));
  return {
    success: true,
    data: { rows: await toRows(rows), activePct: active.toString(), remainingPct: EXPENSE_ALLOCATION_SHARE_MAX.minus(active).toString() },
  };
}

async function toRows(rows: ExpenseAllocation[]): Promise<ExpenseAllocationRow[]> {
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];
  const machineIds = uniq(rows.map((r) => r.machineId));
  const woIds = uniq(rows.map((r) => r.workOrderId));
  const itemIds = uniq(rows.map((r) => r.serviceItemId));
  const userIds = uniq(rows.flatMap((r) => [r.createdById, r.revokedById]));
  const machines = machineIds.length ? await prisma.machine.findMany({ where: { id: { in: machineIds } }, select: { id: true, code: true, name: true } }) : [];
  const wos = woIds.length ? await prisma.workOrder.findMany({ where: { id: { in: woIds } }, select: { id: true, workOrderNumber: true } }) : [];
  const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, code: true, name: true } }) : [];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } }) : [];
  const label = new Map<string, string>([
    ...machines.map((m) => [m.id, `Makine: ${m.code} — ${m.name}`] as const),
    ...wos.map((w) => [w.id, `İş emri: ${w.workOrderNumber}`] as const),
    ...items.map((i) => [i.id, `Hizmet: ${i.code} — ${i.name}`] as const),
  ]);
  const names = new Map(users.map((u) => [u.id, u.fullName || u.username]));
  return rows.map((r) => {
    const targetId = (r.machineId ?? r.workOrderId ?? r.serviceItemId) as string;
    return {
      id: r.id,
      cashTransactionId: r.cashTransactionId,
      targetType: r.machineId ? "MACHINE" : r.workOrderId ? "WORK_ORDER" : "SERVICE_ITEM",
      machineId: r.machineId,
      workOrderId: r.workOrderId,
      serviceItemId: r.serviceItemId,
      targetLabel: label.get(targetId) ?? targetId,
      sharePct: r.sharePct.toString(),
      createdAt: r.createdAt,
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      revokedAt: r.revokedAt,
      revokedByName: r.revokedById ? (names.get(r.revokedById) ?? null) : null,
      revokeReason: r.revokeReason,
    };
  });
}
