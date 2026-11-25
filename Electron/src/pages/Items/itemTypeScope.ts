// Ürün penceresi seçiciden ("Yeni" / "Örnek al") açılınca Tip, seçicinin tip kapsamıyla sınırlanır:
// yalnız kumaş listeleyen seçiciden iplik kartı doğup listede görünmeden kaybolmasın.
import { productItemTypeLabels, type ItemType, type ProductItemType } from "@/types/enums";

export interface ItemTypeScope {
  labels: Record<ProductItemType, string>;
  /** Tek tipe kilitli mi (Tip seçici değiştirilemez). */
  locked: boolean;
  /** ⓘ metni — kapsam yoksa undefined. */
  info?: string;
}

/** Seçici kapsamını ürün tiplerine indirger; kapsam yoksa ya da bütün tipleri kapsıyorsa null (serbest). */
export function productScope(allowed?: readonly ItemType[] | null): ProductItemType[] | null {
  const all = Object.keys(productItemTypeLabels) as ProductItemType[];
  const scoped = all.filter((t) => allowed?.includes(t));
  return scoped.length === 0 || scoped.length === all.length ? null : scoped;
}

export function itemTypeScope(allowed?: readonly ItemType[] | null): ItemTypeScope {
  const scoped = productScope(allowed);
  if (!scoped) return { labels: productItemTypeLabels, locked: false };
  const labels = Object.fromEntries(scoped.map((t) => [t, productItemTypeLabels[t]])) as Record<ProductItemType, string>;
  const names = scoped.map((t) => productItemTypeLabels[t]).join(", ");
  return scoped.length === 1
    ? { labels, locked: true, info: `Bu pencere yalnız “${names}” tipi seçilebilen bir listeden açıldı; tip bu yüzden sabit.` }
    : { labels, locked: false, info: `Açıldığı liste yalnız şu tipleri kabul eder: ${names}.` };
}

/** Yeni kaydın ön değeri: tip kapsam dışındaysa kapsamın ilk tipine çekilir (örnekten açılışta kaynak zaten kapsamdadır). */
export function scopeItemType<V extends { itemType: ProductItemType }>(values: V, allowed?: readonly ItemType[] | null): V {
  const scoped = productScope(allowed);
  return scoped && !scoped.includes(values.itemType) ? { ...values, itemType: scoped[0]! } : values;
}
