// Kuşak değeri → sarf kalemi bağının (`FabricPropertyValue.consumableItemId`) tür doğrulaması
// (`fabric-property.service`ten ayrıldı; gövde okuyucusu `fabric-property-input.helper`de).
import { ItemType, Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/** Değerlere eşlenen sarf kalemleri var ve Sarf türünde olmalı (fail-closed 400). */
export async function assertConsumableItemsTx(tx: Prisma.TransactionClient, values: ReadonlyArray<{ consumableItemId?: string | null }>): Promise<void> {
  const ids = [...new Set(values.map((v) => v.consumableItemId).filter((x): x is string => typeof x === "string"))];
  if (ids.length === 0) return;
  const rows = await tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, itemType: true, name: true } });
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    if (!r || r.itemType !== ItemType.CONSUMABLE) {
      throw AppError.badRequest(`${r ? `"${r.name}"` : "Seçilen kalem"} bir sarf malzemesi değil — kuşak eşlemesi yalnız Sarf türü kaleme yapılır.`, { code: "CONSUMABLE_ITEM_INVALID", itemId: id });
    }
  }
}
