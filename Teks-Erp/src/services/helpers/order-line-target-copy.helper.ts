// =============================================================================
// SİPARİŞ SATIRI → İŞ EMRİ HEDEF DEĞER KOPYASI (SY-F1, tasarım §7.5 madde 2)
// =============================================================================
// İş emri sipariş satırlarından doğarken satırların `OrderLineTargetValue`ları `WorkOrderTargetValue`a
// kopyalanır — TEK YER burası, çağıran `WorkOrderService.createFresh`in hedef değer adımı. Bir özellikte
// bağlı satırlar AYNI değeri taşımıyorsa (farklı değer ya da bir satırda hiç yok) o özellik KOPYALANMAZ,
// uyarı `TARGET_VALUE_CONFLICT` döner; iş emri yine doğar (kuşak farkı iş emrini bölmez, karar kullanıcıda).
// Gövdede açıkça verilen hedef (ör. panelin kurşun gramajı) o özellik için satırdan üstündür.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TargetValueItem } from "./workorder-target-value.helper";

type Reader = Prisma.TransactionClient | PrismaClient;

/** Uyarı kodu — yanıttaki uyarı metninin başında köşeli parantezle durur (istemci metni ayrıştırmadan tanır). */
export const TARGET_VALUE_CONFLICT = "TARGET_VALUE_CONFLICT";

export interface LineTargetCopy {
  items: TargetValueItem[];
  warnings: string[];
}

/** Uyarı metni — tek kaynak (servis yanıtı + bekçi aynı cümleyi görür). */
export function targetValueConflictWarning(propertyName: string, valueNames: string[]): string {
  return `[${TARGET_VALUE_CONFLICT}] ${propertyName}: bağlı sipariş kalemlerinde farklı değer var (${valueNames.join(", ")}) — iş emrine kopyalanmadı; gerekirse iş emri detayında seçin.`;
}

/**
 * Bağlı satırların hedef değerlerinden iş emrinin hedef kümesini kurar. `explicit` gövdede gelen hedeflerdir;
 * onların özelliği satırdan okunmaz. Satır hedefi yoksa sonuç `explicit`in aynısıdır (bugünkü davranış).
 */
export async function deriveOrderLineTargetValues(
  db: Reader,
  orderLineIds: readonly string[],
  explicit: readonly TargetValueItem[],
): Promise<LineTargetCopy> {
  const lineIds = [...new Set(orderLineIds)];
  const rows = lineIds.length === 0 ? [] : await db.orderLineTargetValue.findMany({
    where: { orderLineId: { in: lineIds } },
    select: {
      orderLineId: true,
      propertyId: true,
      valueId: true,
      property: { select: { name: true, isActive: true } },
      value: { select: { name: true, isActive: true } },
    },
    orderBy: [{ propertyId: "asc" }, { valueId: "asc" }],
  });
  const items: TargetValueItem[] = [...explicit];
  const warnings: string[] = [];
  const explicitProps = new Set(explicit.map((t) => t.propertyId));
  const byProperty = new Map<string, typeof rows>();
  for (const r of rows) {
    if (explicitProps.has(r.propertyId)) continue;
    byProperty.set(r.propertyId, [...(byProperty.get(r.propertyId) ?? []), r]);
  }
  for (const [propertyId, group] of byProperty) {
    const values = [...new Map(group.map((g) => [g.valueId, g.value.name])).entries()];
    const everyLine = new Set(group.map((g) => g.orderLineId)).size === lineIds.length;
    const first = group[0]!;
    if (values.length === 1 && everyLine) {
      // Pasife alınmış katalog değeri iş emrine taşınmaz (doğrulayıcı 400 verirdi); uyarıyla atlanır.
      if (!first.property.isActive || !first.value.isActive) {
        warnings.push(`${first.property.name}: sipariş kalemindeki '${first.value.name}' değeri pasif — iş emrine kopyalanmadı.`);
        continue;
      }
      items.push({ propertyId, valueId: values[0]![0] });
      continue;
    }
    const names = values.map(([, n]) => n);
    if (!everyLine) names.push("boş");
    warnings.push(targetValueConflictWarning(first.property.name, names));
  }
  return { items, warnings };
}
