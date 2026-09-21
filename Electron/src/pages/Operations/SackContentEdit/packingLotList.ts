import { trCompare } from "@/lib/collate";
import { foldedIncludes } from "@/lib/search-fold";
import type { PackingGroup } from "./types";

/**
 * Parti listesi — süzme ve sıralama (saf; test ikizi `packingLotList.test.ts`).
 * Liste cari başınadır ve sunucu TAMAMINI döner (cursor yok) → istemcide süzmek
 * "kesilmiş diziyi süzme" tuzağına düşmez.
 */

export type LotStatusFilter = "OPEN" | "CLOSED" | "ALL";
export type LotSortKey = "name" | "sackCount" | "totalQty" | "weightKg" | "createdAt";
export interface LotSort {
  key: LotSortKey;
  dir: "asc" | "desc";
}

/** Varsayılan: en yeni parti üstte. */
export const DEFAULT_LOT_SORT: LotSort = { key: "createdAt", dir: "desc" };

/** Ad ya da notta geçen metin (tek kaynak katlama `foldedIncludes`) + durum. */
export function filterLots(rows: PackingGroup[], q: { query: string; status: LotStatusFilter }): PackingGroup[] {
  const needle = q.query.trim();
  return rows.filter((r) => {
    if (q.status !== "ALL" && r.status !== q.status) return false;
    if (!needle) return true;
    return foldedIncludes(r.name, needle) || foldedIncludes(r.note, needle);
  });
}

/**
 * Ad sıralaması SAYI-DUYARLI: "SP-2" < "SP-10" (düz metin sıralaması SP-10'u
 * SP-2'nin önüne koyardı). Elle adlandırılmış partiler (`seq` null) doğal sıralamayla
 * karışır. `weightKg` null (tartısız) sona düşer, yön ne olursa olsun.
 */
export function sortLots(rows: PackingGroup[], sort: LotSort): PackingGroup[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const cmp = (a: PackingGroup, b: PackingGroup): number => {
    switch (sort.key) {
      case "name":
        return trCompare(a.name, b.name) * dir; // sayı-duyarlı tek kaynak (`TR_COLLATOR`)
      case "sackCount":
        return (a.sackCount - b.sackCount) * dir;
      case "totalQty":
        return (a.totalQty - b.totalQty) * dir;
      case "weightKg": {
        if (a.weightKg == null && b.weightKg == null) return 0;
        if (a.weightKg == null) return 1;
        if (b.weightKg == null) return -1;
        return (a.weightKg - b.weightKg) * dir;
      }
      case "createdAt":
        return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir;
    }
  };
  return [...rows].sort(cmp);
}

/** Başlığa tıklama: aynı anahtar yön çevirir, yeni anahtar sayısal/tarihte DESC, adda ASC ile başlar. */
export function nextLotSort(current: LotSort, key: LotSortKey): LotSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}
