// =============================================================================
// İplik bazlı ORTAK palet — panel `components/weave/shared-palette.ts` aynası (aynı kural, aynı örnekler)
// =============================================================================
// Aynı ekranda birden çok kart (ör. devere kabulünde birkaç siparişin kartı) varken harf + renk her kartın
// kendi satır sırasından değil, bütün kartların ipliklerinin tek sıralı listesinden gelir. Tek kartta satır
// i → yuva i (bugünkü sonuç). Bir kartın satırları hep ayrı yuvada kalır; anahtarsız satır birleşmez. SAF.
// =============================================================================

export type YarnKey = string | null | undefined;

export function sharedYarnSlots(groups: readonly (readonly YarnKey[])[]): number[][] {
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

/** Eşleme yoksa (tek kart, eski çağıran) satır no'nun kendisi. */
export const slotOf = (slots: readonly number[] | null | undefined, row1: number): number => slots?.[row1 - 1] ?? row1;

/** 1-tabanlı yuva → harf (A = 1). */
export const slotLetter = (slot: number): string => String.fromCharCode(64 + Math.max(1, slot));
