// =============================================================================
// TeksERP - Müşteriye Özel Renk Guard'ı
// =============================================================================
// Bir veya birden fazla müşteriye ATANMIŞ (CustomerColorAlias.assigned=true)
// renk, yalnızca atandığı müşteri(ler)de kullanılabilir. Renk seçici UI bunu
// zaten gizliyor; bu guard backend tarafında ENFORCE eder (doğrudan API
// çağrısı, ya da renk önce kullanılıp SONRA atanması gibi durumlar için).
//
// Public renk (hiçbir müşteriye assigned satırı olmayan) her zaman serbest.
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

/**
 * Verilen renklerin `customerId`'li bağlamda kullanılabilir olduğunu doğrular.
 * Renklerden biri başka müşteriye özel ise (veya müşterisiz bağlamda herhangi
 * bir müşteriye özel ise) Türkçe `400` fırlatır. Public renkler için no-op.
 *
 * @param colorIds   Kontrol edilecek renk id'leri (null/tekrar elenir).
 * @param customerId Bağlamın müşterisi (sipariş müşterisi); null = müşterisiz.
 */
export async function assertColorsAssignableToCustomer(
  colorIds: Array<string | null | undefined>,
  customerId: string | null | undefined,
): Promise<void> {
  const uniq = [...new Set(colorIds.filter((c): c is string => !!c))];
  if (uniq.length === 0) return;

  // Bu renklerden hangileri herhangi bir müşteriye ATANMIŞ (exclusive)?
  const assignedRows = await prisma.customerColorAlias.findMany({
    // F202: pasif müşteriye atanmış renk exclusive SAYILMAZ — yoksa müşteri pasife
    // alınınca renk hem başka müşterilerde bloklanır hem pasif müşteri sipariş açamaz
    // → renk fiilen donar. isActive join geri-döndürülebilir (reactivate'te geri gelir).
    where: { colorId: { in: uniq }, assigned: true, customer: { isActive: true } },
    select: { colorId: true, customerId: true },
  });
  if (assignedRows.length === 0) return; // hepsi public → serbest

  const assignedCustomersByColor = new Map<string, Set<string>>();
  for (const r of assignedRows) {
    const set = assignedCustomersByColor.get(r.colorId) ?? new Set<string>();
    set.add(r.customerId);
    assignedCustomersByColor.set(r.colorId, set);
  }

  // İhlal: renk exclusive AMA bağlamın müşterisi atananlar arasında değil
  // (ya da müşterisiz bağlam).
  const violating = [...assignedCustomersByColor.entries()]
    .filter(([, custs]) => !customerId || !custs.has(customerId))
    .map(([colorId]) => colorId);

  if (violating.length === 0) return;

  const colors = await prisma.color.findMany({
    where: { id: { in: violating } },
    select: { name: true },
  });
  const names = colors.map((c) => c.name).join(", ") || "Seçilen renk";

  throw AppError.badRequest(
    customerId
      ? `Şu renk(ler) bu müşteriye atanmamış (başka müşteriye özel): ${names}`
      : `Şu renk(ler) bir müşteriye özel; müşterisiz siparişte kullanılamaz: ${names}`,
  );
}
