/** Sevkiyat detay (tam sayfa + sheet) hızlı filtresi için ortak top eşleştirme. */
import { foldSearchText } from "@/lib/search-fold";
import { trCompare } from "@/lib/collate";

type RollLike = {
  barcode: string | null;
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
};

/**
 * Arama normalizasyonu — kullanıcı girişi bir kez katlanıp geçilir.
 * Sunucu tarafıyla AYNI katlama (`tr_fold`): "canakkale" ≡ "ÇANAKKALE".
 */
export function normalizeSearch(s: string): string {
  return foldSearchText(s);
}

/**
 * Top, normalize edilmiş sorguyu barkod / kumaş (ad+kod) / renk (ad+kod) — ve
 * verilirse ek alan (ör. çuval no) — üzerinde içeriyor mu? Boş sorgu → herkes eşleşir.
 */
export function rollMatchesQuery(r: RollLike, q: string, extra?: string): boolean {
  if (!q) return true;
  const hay: string[] = [
    r.barcode ?? "",
    r.item?.name ?? "",
    r.item?.code ?? "",
    r.color?.name ?? "",
    r.color?.code ?? "",
    extra ?? "",
  ];
  return foldSearchText(hay.join(" ")).includes(q);
}

/** "id1,id2" csv → temiz id dizisi (liste→detay matchItem/matchColor bağlamı). */
export function csvIds(v: string | null | undefined): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

type RollContextLike = { item: { id: string } | null; color: { id: string } | null };

/**
 * Top, liste kumaş/renk (içerik) filtresine "eşleşen" mi? Backend TEK TOP semantiğiyle
 * birebir: (kumaş seçili değil VEYA topun kumaşı ∈ seçili) VE (renk seçili değil VEYA
 * topun rengi ∈ seçili). Bağlam yokken (iki dizi de boş) daima true döner — çağıran
 * taraf `hasMatchContext` ile korur (bağlamsızken vurgu YOK).
 */
export function rollMatchesContext(
  r: RollContextLike,
  matchItemIds: string[],
  matchColorIds: string[],
): boolean {
  const itemOk = matchItemIds.length === 0 || (r.item != null && matchItemIds.includes(r.item.id));
  const colorOk = matchColorIds.length === 0 || (r.color != null && matchColorIds.includes(r.color.id));
  return itemOk && colorOk;
}

type RollFacetLike = {
  item: { id: string } | null;
  color: { id: string } | null;
  qualityGrade: string | null;
  width: number | null;
};

/**
 * Top, detay-içi facet süzgeçlerine uyuyor mu? Facet'ler ARASI VE, facet İÇİ VEYA:
 * (kumaş facet'i boş VEYA topun kumaşı ∈ facet) VE (renk facet'i boş VEYA topun rengi
 * ∈ facet) VE (kalite facet'i boş VEYA topun kalitesi ∈ facet) VE (en facet'i boş VEYA
 * topun eni ∈ facet). En değerleri string olarak karşılaştırılır (`String(width)`;
 * seçenekler de aynı biçimde üretilir). Boş dizilerle daima true → süzgeç yokken herkes
 * geçer. `rollMatchesContext`'ten farkı: burada bağımsız facet'ler (kullanıcı serbestçe
 * düzenler); orada liste "tek top" bağlam semantiği.
 */
export function rollMatchesFacets(
  r: RollFacetLike,
  itemIds: string[],
  colorIds: string[],
  qualities: string[],
  widths: string[],
): boolean {
  const itemOk = itemIds.length === 0 || (r.item != null && itemIds.includes(r.item.id));
  const colorOk = colorIds.length === 0 || (r.color != null && colorIds.includes(r.color.id));
  const qualOk = qualities.length === 0 || (r.qualityGrade != null && qualities.includes(r.qualityGrade));
  const widthOk = widths.length === 0 || (r.width != null && widths.includes(String(r.width)));
  return itemOk && colorOk && qualOk && widthOk;
}

/** Çuval-içi top tablosunun sıralanabilir kolonları. */
export type RollSortField = "barcode" | "item" | "color" | "width" | "qualityGrade" | "currentQty";

type RollSortLike = {
  barcode: string | null;
  item: { name: string } | null;
  color: { name: string } | null;
  width: number | null;
  qualityGrade: string | null;
  currentQty: number;
};

/** Top karşılaştırma — sayısal alanlar sayısal, metinler Türkçe-duyarlı; null'lar
 *  yön fark etmeksizin DAİMA sona. Kararlılık çağıran tarafın stable sort'una bağlı. */
export function compareRolls(
  a: RollSortLike,
  b: RollSortLike,
  field: RollSortField,
  dir: "asc" | "desc",
): number {
  const s = dir === "asc" ? 1 : -1;
  const av = field === "item" ? (a.item?.name ?? null) : field === "color" ? (a.color?.name ?? null) : a[field];
  const bv = field === "item" ? (b.item?.name ?? null) : field === "color" ? (b.color?.name ?? null) : b[field];
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // null daima sona
  if (bv == null) return -1;
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * s;
  return trCompare(String(av), String(bv)) * s;
}
