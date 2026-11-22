// İplik bazlı ORTAK palet: aynı ekranda/basımda birden çok kart (zemin + döner çözgü, atkı) varken harf ve
// renk her kartın kendi satır sırasından değil, bütün kartların ipliklerinin tek sıralı listesinden gelir —
// aynı iplik her yerde aynı harf/renk. Tek kartta sonuç bugünküyle aynıdır (satır i → yuva i). SAF.

export type YarnKey = string | null | undefined;

/**
 * Grupların (kartların) satırlarını ortak yuvalara (1-tabanlı) eşler. Kural: satır sırasıyla gezilir; anahtar
 * daha önce görüldüyse ve o yuva bu grupta henüz kullanılmadıysa aynı yuva, değilse yeni yuva. Böylece bir
 * kartın satırları hep ayrı yuvalara düşer (bant ayırt edilir) ve ilk kart her zaman 1..n olur.
 * Anahtarsız (null) satır kimseyle birleşmez.
 */
export function sharedYarnSlots(groups: ReadonlyArray<ReadonlyArray<YarnKey>>): number[][] {
  const slotsByKey = new Map<string, number[]>();
  let next = 1;
  return groups.map((keys) => {
    const used = new Set<number>();
    return keys.map((key) => {
      const known = key ? slotsByKey.get(key) : undefined;
      const reuse = known?.find((s) => !used.has(s));
      const slot = reuse ?? next++;
      if (reuse === undefined && key) slotsByKey.set(key, [...(known ?? []), slot]);
      used.add(slot);
      return slot;
    });
  });
}

/** Yuva → satır eşlemesinde güvenli okuma: eşleme yoksa (tek kart, eski çağıran) satır no'nun kendisi. */
export const slotOf = (slots: readonly number[] | null | undefined, row1: number): number => slots?.[row1 - 1] ?? row1;

interface WarpRowsLike {
  yarnItem?: { id: string } | null;
  yarns?: ReadonlyArray<{ yarnItemId: string; sortOrder: number }> | null;
}

/** Çözgü kartının satır anahtarları — `stripYarnsOf` ile AYNI sıra (sortOrder; satırsız eski yanıtta ana iplik). */
export function warpRowKeys(w: WarpRowsLike): YarnKey[] {
  if (w.yarns && w.yarns.length > 0) return [...w.yarns].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.yarnItemId);
  return [w.yarnItem?.id ?? null];
}

/** Ekrandaki yapının ortak paleti: önce çözgü bantları (sırayla), sonra atkı satırları (yalnız renk ortak). */
export function constructionSlots(warps: ReadonlyArray<WarpRowsLike>, weftKeys: ReadonlyArray<YarnKey> = []): { warp: number[][]; weft: number[] } {
  const all = sharedYarnSlots([...warps.map(warpRowKeys), weftKeys]);
  return { warp: all.slice(0, warps.length), weft: all[warps.length] ?? [] };
}
