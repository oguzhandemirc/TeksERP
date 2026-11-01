// =============================================================================
// KÂRLILIK — MASRAF BAĞI (DOĞRUDAN MASRAF) AS-OF (D4-G2c; DALGA4 §9.5 K19/K15, §13 D4-G2b "(H3 varsa)")
// =============================================================================
// Bağlar YALNIZ finans köprüsündeki `readExpenseAllocationPieces`ten (o da yalnız `listExpenseAllocationsAsOf`ten)
// gelir; burada "aktif bağ" okuması yoktur (`test_karlilik_masraf_bagi` §0 AST). Ay M parçaları:
//   AS_OF — M masrafının M SONUNDA geçerli bağı; LATE_ADJUSTMENT — önceki ay masraflarına M içinde yapılan bağ
//   olayı (geç bağ düzeltmesi); CANCEL_REVERSAL — M'de iptal edilen masrafın bağı eksiyle. Her parça kendi kategori
//   sınıfının havuzundan (GENEL_GIDER / ISCILIK / HARIC) DÜŞER, hedefe doğrudan masraf olur: toplam korunur.
//   Hedef satırlar ayın FATURALANAN satırlarıdır (makine / iş emri adımı / hizmet kalemi), pay metreyle; hedefin o ay
//   satırı yoksa tutar "dağıtılmamış doğrudan" kalır. Bağ yoksa (ya da `finance.masraf.bagAlani=OFF`) hiçbir alan
//   eklenmez: rapor bayt-aynı.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ProfitCategoryClass, ProfitCategoryClassMap } from "../system-setting.service";
import type { ExpenseAllocationPiece } from "./profitability-finance.helper";
import { classifyCategory, distributePool, type MonthPools } from "./profitability-overhead.helper";

const D0 = () => new Prisma.Decimal(0);

export type DirectExpenseKind = ExpenseAllocationPiece["kind"];

export interface DirectExpenseLine {
  kind: DirectExpenseKind;
  cashTransactionId: string;
  docNo: string | null;
  categoryClass: ProfitCategoryClass;
  machineId: string | null;
  workOrderId: string | null;
  serviceItemId: string | null;
  sharePct: Prisma.Decimal;
  /** İşaretli TL (geç bağ damgası ve iptal ters çevrimi eksi). */
  amountTry: Prisma.Decimal;
  /** Ayın satırlarına yüklenen kısım; hedefin satırı yoksa 0. */
  distributedTry: Prisma.Decimal;
}

/** Ay özetinin doğrudan masraf bölümü — yalnız o ay parçası varsa eklenir. */
export interface MonthDirectExpenses {
  /** AS_OF parçaları toplamı (ayın kendi masraflarının bağlı kısmı). */
  directTry: Prisma.Decimal;
  /** Geç bağ düzeltmesi: önceki ay masraflarının bu ay doğrudan ↔ havuz aktarımı. */
  lateAdjustmentTry: Prisma.Decimal;
  cancelReversalTry: Prisma.Decimal;
  undistributedTry: Prisma.Decimal;
  lines: DirectExpenseLine[];
}

/** Satırın doğrudan masraf için okunan alanları (profitability.helper `ProfitabilityRow` alt kümesi). */
export interface DirectTargetRow {
  month: string;
  kind: string;
  machineId: string | null;
  serviceItemId: string;
  workOrderStepId: string | null;
  meters: Prisma.Decimal;
  directExpenseTry?: Prisma.Decimal;
}

export type FinanceAllocationReader = (start: Date, end: Date, classNames: string[]) => Promise<ExpenseAllocationPiece[]>;

/** Ay başına parçalar; bağ alanı kapalıysa sorgu yok, boş harita. */
export async function readMonthAllocations(
  enabled: boolean, read: FinanceAllocationReader, bounds: Array<{ month: string; start: Date; end: Date }>, classNames: string[],
): Promise<Map<string, ExpenseAllocationPiece[]>> {
  const out = new Map<string, ExpenseAllocationPiece[]>();
  if (!enabled) return out;
  for (const b of bounds) {
    const pieces = await read(b.start, b.end, classNames);
    if (pieces.length > 0) out.set(b.month, pieces);
  }
  return out;
}

/** İş emri hedefi için adım → iş emri; iş emri hedefli parça yoksa sorgu yok. */
export async function workOrderOfSteps(pieces: Map<string, ExpenseAllocationPiece[]>, stepIds: Array<string | null>): Promise<Map<string, string>> {
  const any = [...pieces.values()].some((ps) => ps.some((p) => p.workOrderId !== null));
  const ids = [...new Set(stepIds.filter((s): s is string => s !== null))];
  if (!any || ids.length === 0) return new Map();
  const steps = await prisma.workOrderStep.findMany({ where: { id: { in: ids } }, select: { id: true, workOrderId: true } });
  return new Map(steps.map((s) => [s.id, s.workOrderId]));
}

/** Parçaların kendi sınıf havuzundan düşülmesi (havuz yerinde güncellenir). */
export function deductFromPools(pool: MonthPools, pieces: ExpenseAllocationPiece[], classes: ProfitCategoryClassMap): void {
  for (const p of pieces) {
    const cls = classifyCategory(p.className, classes);
    if (cls === "ISCILIK") pool.laborPoolTry = pool.laborPoolTry.minus(p.amountTry);
    else if (cls === "HARIC") pool.excludedTry = pool.excludedTry.minus(p.amountTry);
    else pool.overheadPoolTry = pool.overheadPoolTry.minus(p.amountTry);
  }
}

/** Parçaları ayın faturalanan hedef satırlarına metre payıyla yükler; `directExpenseTry` yerinde artar. */
export function attachDirectExpenses<R extends DirectTargetRow>(
  monthRows: R[], pieces: ExpenseAllocationPiece[], classes: ProfitCategoryClassMap, workOrderOf: Map<string, string>,
): MonthDirectExpenses {
  const out: MonthDirectExpenses = { directTry: D0(), lateAdjustmentTry: D0(), cancelReversalTry: D0(), undistributedTry: D0(), lines: [] };
  for (const p of pieces) {
    const hits = monthRows.filter((r) => r.kind === "INVOICED" && (p.machineId !== null ? r.machineId === p.machineId
      : p.serviceItemId !== null ? r.serviceItemId === p.serviceItemId
        : r.workOrderStepId !== null && workOrderOf.get(r.workOrderStepId) === p.workOrderId));
    const shares = distributePool(p.amountTry, hits.map((r) => (r.meters.lt(0) ? D0() : r.meters)));
    if (shares) hits.forEach((r, i) => { r.directExpenseTry = (r.directExpenseTry ?? D0()).plus(shares[i]!); });
    else out.undistributedTry = out.undistributedTry.plus(p.amountTry);
    if (p.kind === "AS_OF") out.directTry = out.directTry.plus(p.amountTry);
    else if (p.kind === "LATE_ADJUSTMENT") out.lateAdjustmentTry = out.lateAdjustmentTry.plus(p.amountTry);
    else out.cancelReversalTry = out.cancelReversalTry.plus(p.amountTry);
    out.lines.push({
      kind: p.kind, cashTransactionId: p.cashTransactionId, docNo: p.docNo, categoryClass: classifyCategory(p.className, classes),
      machineId: p.machineId, workOrderId: p.workOrderId, serviceItemId: p.serviceItemId, sharePct: p.sharePct, amountTry: p.amountTry,
      distributedTry: shares ? p.amountTry : D0(),
    });
  }
  return out;
}
