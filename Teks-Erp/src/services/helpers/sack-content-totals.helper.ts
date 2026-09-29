// =============================================================================
// ÇUVAL İÇERİĞİ (top adedi + metre) — TEK KAYNAK
// =============================================================================
// Çuval listesi (`sack-search.service`), "boş çuval" süzgeci ve patron bulutu
// projeksiyonu (`cloud-sync`) aynı sayıyı basar. HAYALET DIŞLANIR: çuvalda kayıtlı
// ama fiziksel olarak binada olmayan top (kartelaya/tambura/fasona gitmiş) sayılırsa
// liste, çuval etiketi ve irsaliye AYNI çuval için farklı top adedi basardı.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { D0 } from "./allocation.helper";
import { SACK_ABSENT_STATUSES } from "./sack-invariants.helper";

/** Fiziksel olarak çuvalda duran top — liste sayacı ve "Boş" süzgeci AYNI yüklemi kullanır. */
export const PRESENT_ROLL_WHERE = { status: { notIn: SACK_ABSENT_STATUSES } } satisfies Prisma.RollWhereInput;

export interface SackContentTotals {
  readonly rollCount: number;
  readonly totalQty: Prisma.Decimal;
}

/**
 * Çuval başına hayaletsiz top adedi + Σ `currentQty`. `rollFilter` verilirse (içerik
 * süzgeci) yalnız eşleşen toplar sayılır — hayalet dışlaması yine uygulanır ki
 * "eşleşen > toplam" absürtlüğü doğmasın.
 */
export async function loadSackContentTotals(
  sackIds: readonly string[],
  rollFilter: Prisma.RollWhereInput = {},
): Promise<Map<string, SackContentTotals>> {
  const ids = [...new Set(sackIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.roll.groupBy({
    by: ["sackId"],
    where: { sackId: { in: ids }, ...PRESENT_ROLL_WHERE, ...rollFilter },
    _count: { _all: true },
    _sum: { currentQty: true },
  });
  const out = new Map<string, SackContentTotals>();
  for (const g of rows) {
    if (g.sackId) out.set(g.sackId, { rollCount: g._count._all, totalQty: g._sum.currentQty ?? D0() });
  }
  return out;
}
