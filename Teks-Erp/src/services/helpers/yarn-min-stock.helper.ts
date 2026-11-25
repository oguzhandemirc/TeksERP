// İplik asgari altı kümesi — kalem toplamı (bütün depoların `YarnStock.balanceKg` Σ'sı) üzerinden; yüklem
// `min-stock.helper.isBelowMinStock`. İplik stok listesinin satır işareti ve `belowMin` süzgeci buradan okur.
import { ItemLifecycleStatus, ItemType, Prisma } from "@prisma/client";
import { isBelowMinStock } from "./min-stock.helper";

type Reader = Pick<Prisma.TransactionClient, "item" | "yarnStock">;

/**
 * Asgari stoğu tanımlı, arşivlenmemiş ve kalem toplamı eşiğin altında olan İPLİK kartları.
 * Hiç bakiye satırı olmayan (hiç giriş görmemiş) iplik stok listesinde satırı olmadığı için listeye girmez.
 */
export async function yarnBelowMinItemIds(db: Reader): Promise<Set<string>> {
  const items = await db.item.findMany({
    where: { itemType: ItemType.YARN, minStockQty: { not: null }, lifecycleStatus: { not: ItemLifecycleStatus.ARCHIVED } },
    select: { id: true, minStockQty: true },
  });
  const out = new Set<string>();
  if (items.length === 0) return out;
  const sums = await db.yarnStock.groupBy({ by: ["itemId"], where: { itemId: { in: items.map((i) => i.id) } }, _sum: { balanceKg: true } });
  const onHand = new Map(sums.map((s) => [s.itemId, s._sum.balanceKg ?? new Prisma.Decimal(0)]));
  for (const i of items) {
    const sum = onHand.get(i.id);
    if (sum && isBelowMinStock(sum, i.minStockQty, false)) out.add(i.id);
  }
  return out;
}

/**
 * İplik stok listesinin where üçlüsü. Özet sayısı FACETED: `base` + asgari altı; `belowMin` seçilince liste
 * aynı where'den döner (sıfır bakiye asgari altının en ağır hâlidir, `onlyNonZero` uygulanmaz).
 */
export async function yarnMinStockScope(
  db: Reader,
  base: Prisma.YarnStockWhereInput,
  o: { belowMin?: boolean; onlyNonZero?: boolean },
): Promise<{ belowIds: Set<string>; belowWhere: Prisma.YarnStockWhereInput; listWhere: Prisma.YarnStockWhereInput }> {
  const belowIds = await yarnBelowMinItemIds(db);
  const belowWhere: Prisma.YarnStockWhereInput = { AND: [base, { itemId: { in: [...belowIds] } }] };
  const listWhere = o.belowMin ? belowWhere : o.onlyNonZero ? { AND: [base, { NOT: { balanceKg: 0 } }] } : base;
  return { belowIds, belowWhere, listWhere };
}

/** Satıra `minStockQty` (3 hane) + `belowMinStock` (kalem düzeyi) ekler; `item.minStockQty` satırdan çıkar. */
export function withYarnMinStock<R extends { item: { id: string; minStockQty: Prisma.Decimal | null } }>(
  rows: R[],
  belowIds: Set<string>,
): Array<Omit<R, "item"> & { item: Omit<R["item"], "minStockQty">; minStockQty: string | null; belowMinStock: boolean }> {
  return rows.map(({ item: full, ...r }) => {
    const { minStockQty, ...item }: R["item"] = full;
    return { ...r, item, minStockQty: minStockQty?.toFixed(3) ?? null, belowMinStock: belowIds.has(full.id) };
  });
}
