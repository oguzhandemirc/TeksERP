// Ad eşlemesi satırı VAR MI — üç alias adaptörünün ortak sorusu (id'lerle, ad çözmez).
// Anahtar parçası AD ile çözüldüğünde `findExisting` (yalnız KOD eşler) mevcut satırı
// göremez; bu soru o boşluğu kapatır (`validateAliasRow`).

import prisma from "../../../lib/prisma";

export type AliasPivot = "customerItemAlias" | "customerColorAlias" | "customerItemColorAlias";

export async function aliasPivotExists(
  pivot: AliasPivot,
  ids: { customerId: string; itemId?: string; colorId?: string },
): Promise<boolean> {
  const { customerId, itemId, colorId } = ids;
  if (pivot === "customerItemAlias") return (await prisma.customerItemAlias.count({ where: { customerId, itemId } })) > 0;
  if (pivot === "customerColorAlias") return (await prisma.customerColorAlias.count({ where: { customerId, colorId } })) > 0;
  return (await prisma.customerItemColorAlias.count({ where: { customerId, itemId, colorId } })) > 0;
}
