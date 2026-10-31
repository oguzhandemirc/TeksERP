// =============================================================================
// FASON KABULÜNDE HEDEF ÇEŞİT DEĞERİ — doğan topa desen (Gülkesim dalga 4 · D4-D3, DALGA4 §5.5/6, K8)
// =============================================================================
// Dış brodeden dönen top bugün yalnız BAYRAĞI taşır; desen iş emrinin hedefidir (`WorkOrderTargetValue`).
// Ayar `fason.receiptApplyTargetVariant` AÇIKKEN kabulde uygulanan bayrağın çeşidine ait aktif hedef
// değer doğan topun `RollProperty.valueId`sine yazılır (yazımı kabul tx'i yapar; ters yol makbuz iptalinde
// `revokeRollProperties` damgası). Kapalıyken boş döner — kabul bayt-aynı.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { readFasonReceiptApplyTargetVariant } from "../system-setting.service";
import { ACTIVE_TARGET_VALUE } from "./workorder-target-value.helper";

/** Doğan topa yazılacak (çeşit özelliği, değer) çiftleri; ayar kapalı ya da hedef yoksa boş. */
export async function readReceiptTargetVariantsTx(
  tx: Prisma.TransactionClient,
  args: { workOrderId: string; appliedFlagIds: string[] },
): Promise<Array<{ propertyId: string; valueId: string }>> {
  if (args.appliedFlagIds.length === 0) return [];
  if (!(await readFasonReceiptApplyTargetVariant(tx))) return [];
  return tx.workOrderTargetValue.findMany({
    where: { workOrderId: args.workOrderId, ...ACTIVE_TARGET_VALUE, property: { variantOfPropertyId: { in: args.appliedFlagIds } } },
    select: { propertyId: true, valueId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Dönüş işlemine (`RollOperation.propertyValueId`, SUBCONTRACTOR_RETURNED) yazılacak fiilî desen (D4-MIG6, §5.4).
 * Kolon tek değer taşır: hedef TEK çeşit değeriyse o, yoksa ya da birden çoksa null (çoklu desen RollProperty'de kalır).
 */
export function receiptOperationValueId(variants: ReadonlyArray<{ valueId: string }>): string | null {
  const ids = new Set(variants.map((v) => v.valueId));
  return ids.size === 1 ? [...ids][0]! : null;
}
