// =============================================================================
// 4 puan çözücüleri — en kaynağı (plan §2.4) ve kural seti (plan §2.5), TEK yer.
// =============================================================================
import { Prisma, type InspectionWidthSource, type RollStatus } from "@prisma/client";
import { round2 } from "./four-point.helper";

type Tx = Prisma.TransactionClient;

export interface ResolvedWidth {
  widthCm: Prisma.Decimal | null;
  widthSource: InspectionWidthSource;
}

/**
 * Sıra: elle girilen (panel düzeltmesi) → ürün kartı `Item.widthCm` → KK1'de ölçülen
 * `Roll.width` → bilinmiyor. Ürün kartı ölçümden önce gelir (patron ilkesi; veto V3).
 */
export async function resolveInspectionWidth(
  tx: Tx,
  input: { itemId: string; rollWidth: Prisma.Decimal | null; manualWidthCm?: Prisma.Decimal.Value | null },
): Promise<ResolvedWidth> {
  if (input.manualWidthCm != null) return { widthCm: round2(new Prisma.Decimal(input.manualWidthCm)), widthSource: "MANUAL" };
  const item = await tx.item.findUnique({ where: { id: input.itemId }, select: { widthCm: true } });
  if (item?.widthCm && item.widthCm.gt(0)) return { widthCm: round2(item.widthCm), widthSource: "ITEM_CARD" };
  if (input.rollWidth && input.rollWidth.gt(0)) return { widthCm: round2(input.rollWidth), widthSource: "ROLL_MEASURED" };
  return { widthCm: null, widthSource: "UNKNOWN" };
}

export const RULE_SET_SELECT = {
  id: true, name: true, scope: true, customerId: true, itemId: true, unit: true, runningCap: true,
  bands: {
    orderBy: { sortOrder: "asc" },
    select: { sortOrder: true, maxScore: true, label: true, accepted: true, qualityGradeId: true },
  },
} satisfies Prisma.FourPointRuleSetSelect;
export type ResolvedRuleSet = Prisma.FourPointRuleSetGetPayload<{ select: typeof RULE_SET_SELECT }>;

/** Müşteri+ürün → müşteri geneli → fabrika → null; yalnız aktif setler. */
export async function resolveFourPointRule(
  tx: Tx,
  input: { customerId?: string | null; itemId?: string | null },
): Promise<ResolvedRuleSet | null> {
  if (input.customerId) {
    if (input.itemId) {
      const exact = await tx.fourPointRuleSet.findFirst({
        where: { isActive: true, scope: "CUSTOMER", customerId: input.customerId, itemId: input.itemId },
        select: RULE_SET_SELECT,
      });
      if (exact) return exact;
    }
    const generic = await tx.fourPointRuleSet.findFirst({
      where: { isActive: true, scope: "CUSTOMER", customerId: input.customerId, itemId: null },
      select: RULE_SET_SELECT,
    });
    if (generic) return generic;
  }
  return tx.fourPointRuleSet.findFirst({ where: { isActive: true, scope: "FACTORY" }, select: RULE_SET_SELECT });
}

/** Muayene aşaması istasyondan DEĞİL topun durumundan türer: finalize top FINAL, değilse RAW. */
export function resolveInspectionPhase(roll: { finalizedAt: Date | null; status?: RollStatus }): "RAW" | "FINAL" {
  return roll.finalizedAt ? "FINAL" : "RAW";
}
