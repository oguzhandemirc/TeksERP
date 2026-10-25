// Hata tipi sıralaması (K4P tablet muayene düğme sırası) — saf yardımcılar.
import type { DefectType } from "./types";

/** Ekrandaki sıra: `sortOrder` küçük önce, eşitlikte ada göre (sunucu varsayılanı 0 olabilir). */
export function orderDefectTypes(rows: DefectType[]): DefectType[] {
  return [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "tr"));
}

/** Yeni dizilişte yalnız sırası DEĞİŞEN satırlar yazılır (index × 10: araya elle ekleme payı). */
export function sortOrderChanges(rows: DefectType[]): Array<{ id: string; sortOrder: number }> {
  return rows.map((r, i) => ({ id: r.id, sortOrder: i * 10, prev: r.sortOrder ?? 0 }))
    .filter((r) => r.sortOrder !== r.prev)
    .map(({ id, sortOrder }) => ({ id, sortOrder }));
}
