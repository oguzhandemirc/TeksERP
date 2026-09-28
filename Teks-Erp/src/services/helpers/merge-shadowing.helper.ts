// =============================================================================
// BİRLEŞTİRME ÖNİZLEMESİ — kumaşa özel renk adı GÖLGELEMESİ
// =============================================================================
// Çakışmadan TAŞINAN kumaşa özel satır (`CustomerItemColorAlias`, politika SKIP)
// survivor'ın o kumaştaki renk adını değiştirir: A2'nin (X, Ekru)='P'si A'ya
// taşınınca A'nın X etiketi "ABC"den "P"ye döner — birleştirme bunu sessizce
// yapardı. Önizleme bu satırları KAYIT BAŞINA listeler (MUSTERI-KUMAS-RENK-ADI §4).
// "Önceki ad" tek çözücüden okunur: etikette bugün basılan ana veri adı budur.
// =============================================================================

import prisma from "../../lib/prisma";
import type { MergeEntity } from "../../constants/merge-map";
import { loadCustomerColorIndex } from "./customer-name.helper";

export interface MergeShadowRow {
  customer: string;
  item: string;
  color: string;
  /** Birleştirmeden sonra bu kumaşta basılacak ad (taşınan satır). */
  alias: string;
  /** Bugün survivor'da o kumaşta basılan ana veri adı; null = bizim adımız. */
  before: string | null;
}

const COLUMN: Partial<Record<MergeEntity, "customerId" | "itemId" | "colorId">> = {
  customer: "customerId",
  item: "itemId",
  color: "colorId",
};

/** Taşınacak ve survivor'ın çıktısını DEĞİŞTİRECEK kumaşa özel satırlar. */
export async function describeItemColorShadowing(
  entity: MergeEntity,
  survivorId: string,
  sourceIds: string[],
): Promise<MergeShadowRow[]> {
  const col = COLUMN[entity];
  if (!col || sourceIds.length === 0) return [];
  const rows = await prisma.customerItemColorAlias.findMany({
    where: { [col]: { in: sourceIds } },
    select: { customerId: true, itemId: true, colorId: true, alias: true },
    orderBy: [{ customerId: "asc" }, { itemId: "asc" }, { colorId: "asc" }],
  });
  if (rows.length === 0) return [];
  const moved = rows.map((r) => ({ ...r, [col]: survivorId }));
  const idx = await loadCustomerColorIndex(prisma, {
    customerIds: moved.map((r) => r.customerId),
    itemIds: moved.map((r) => r.itemId),
    colorIds: moved.map((r) => r.colorId),
  });
  const changed = moved
    .map((r) => ({ ...r, now: idx.master(r.customerId, r.itemId, r.colorId) }))
    // Survivor'da aynı anahtar ZATEN kumaşa özelse satır çakışır ve SKIP ile atılır.
    .filter((r) => r.now?.scope !== "ITEM" && r.now?.alias !== r.alias);
  if (changed.length === 0) return [];
  const names = await keyNames(changed);
  return changed.map((r) => ({
    customer: names.customer.get(r.customerId) ?? "",
    item: names.item.get(r.itemId) ?? "",
    color: names.color.get(r.colorId) ?? "",
    alias: r.alias,
    before: r.now?.alias ?? null,
  }));
}

/** Birleşme SONRASI anahtarın adları (müşteri birleşmesinde müşteri = survivor). */
async function keyNames(rows: Array<{ customerId: string; itemId: string; colorId: string }>) {
  const ids = (k: "customerId" | "itemId" | "colorId") => ({ id: { in: [...new Set(rows.map((r) => r[k]))] } });
  const byId = (xs: Array<{ id: string; name: string }>) => new Map(xs.map((x) => [x.id, x.name]));
  return {
    customer: byId(await prisma.customer.findMany({ where: ids("customerId"), select: { id: true, name: true } })),
    item: byId(await prisma.item.findMany({ where: ids("itemId"), select: { id: true, name: true } })),
    color: byId(await prisma.color.findMany({ where: ids("colorId"), select: { id: true, name: true } })),
  };
}
