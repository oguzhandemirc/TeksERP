// Telefon bildirimi tür listesi: arama + grup özeti (panel #725 dili: katlanır grup, başlıkta "x/y açık"). Saf; ekran çizer.
export interface TurHucresi {
  readonly tur: string;
  readonly acik: boolean;
}
export interface TurGrubu {
  readonly grup: string;
  readonly hucreler: readonly TurHucresi[];
}

/** Arama anahtarı: Türkçe küçük harf + boşluk sadeleştirme (İ/ı doğru katlanır). */
export const aramaAnahtari = (s: string): string => s.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();

/**
 * Sorgu boşsa gruplar aynen; doluysa tür adı (yoksa kodu) ya da grup adı eşleşen satırlar kalır. Grup adı eşleşirse
 * grubun tamamı görünür; hiç satırı kalmayan grup düşer.
 */
export function turGruplariniSuz(gruplar: readonly TurGrubu[], ad: ReadonlyMap<string, string>, sorgu: string): TurGrubu[] {
  const q = aramaAnahtari(sorgu);
  if (!q) return [...gruplar];
  return gruplar.flatMap((g) => {
    if (aramaAnahtari(g.grup).includes(q)) return [g];
    const hucreler = g.hucreler.filter((h) => aramaAnahtari(ad.get(h.tur) ?? h.tur).includes(q) || h.tur.includes(q));
    return hucreler.length ? [{ grup: g.grup, hucreler }] : [];
  });
}

/** Grup başlığı özeti: "3/7 açık". */
export function grupOzeti(g: TurGrubu): { acik: number; toplam: number; metin: string } {
  const acik = g.hucreler.filter((h) => h.acik).length;
  return { acik, toplam: g.hucreler.length, metin: `${acik}/${g.hucreler.length} açık` };
}
