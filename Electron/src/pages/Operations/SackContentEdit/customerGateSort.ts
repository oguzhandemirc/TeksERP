/**
 * Cari kapısı tablosunun sıralama DURUMU — sıralamanın kendisi SUNUCUDA
 * (`GET /sack-search/customers?sortBy&sortOrder`, kapsamın tamamı; istemci sayfa
 * içinde sıralamaz). Burada yalnız başlığa tıklama döngüsü: `null` = sunucu
 * varsayılanı (çuvalı olanlar üstte, sonra ad).
 */
export type GateSortKey = "name" | "openLotCount" | "sackCount" | "rollCount";
export type GateSort = { key: GateSortKey; dir: "asc" | "desc" } | null;

/** Yeni anahtar → sayılar büyükten (desc), ad A→Z; aynı anahtar yön çevirir; üçüncü tık varsayılana döner. */
export function nextGateSort(current: GateSort, key: GateSortKey): GateSort {
  if (!current || current.key !== key) return { key, dir: key === "name" ? "asc" : "desc" };
  const ilk = key === "name" ? "asc" : "desc";
  return current.dir === ilk ? { key, dir: ilk === "asc" ? "desc" : "asc" } : null;
}
