// =============================================================================
// Anlatı üreticisi — "Ne görüyoruz?" kutusunun TEK kaynağı (ekran · PDF · Excel · patron)
// =============================================================================
// Girdi raporun hesaplanmış sayılarıdır; motor sorgu koşmaz. Çıktı önem sırasıyla kesilmiş
// `AnlatiCumlesi[]`; ekran ilk 3'ü, PDF ilk 5'i basar (çağıran keser). Sıra belirlenimlidir:
// önem azalan → kural kataloğu sırası → metin.

import type { DateRange } from "../_shared";
import type { SuzgecEcho } from "../_filters";
import { donemSozleri } from "../sunum/sunum-kur";
import type { AnaSayi, AnlatiCumlesi, Birim } from "../sunum/sunum.types";
import { paraBirimiMi } from "./sayi-bicim";
import type { SuffixInput } from "./ek";
import {
  KURAL_ADLARI,
  anaSayiKiyas,
  aykiri,
  degisimKaynagi,
  egilim,
  enBuyukPay,
  esikAsimi,
  scopeNote,
  olculemedi,
  correlationObservation,
  sampleWarningObservation,
  sessizlesen,
  emptyResultState,
  yogunlasma,
  type AnalysisInput,
  type AnaSayiIfadesi,
  type ThresholdInput,
  type Gozlem,
  type ScopeNoteInput,
  type Kirilim,
  type KuralAdi,
  type MusteriRitmi,
  type Seri,
} from "./gozlem";
import { cumleKur } from "./kurallar";

export interface NarrativeInput {
  donem?: DateRange;
  kiyasDonemi?: DateRange | null;
  /** Dönem adlarını çağıran verirse türetilmez (ör. "Bu hafta" / "geçen hafta"). */
  donemSozu?: { donem: SuffixInput | null; kiyas: SuffixInput | null };
  anaSayi?: AnaSayi;
  anaSayiIfadesi?: AnaSayiIfadesi;
  /** Boş sonuç ayrımı: `satirSayisi` süzgeçli sonuç, `suzgec` zarfın `suzgec` beyanı (+`dusenSatir`). */
  veri?: { satirSayisi: number; suzgec?: SuzgecEcho };
  kirilim?: Kirilim;
  seri?: Seri;
  esikler?: ThresholdInput[];
  musteriRitmi?: { musteriler: MusteriRitmi[]; bugun: Date };
  kapsam?: ScopeNoteInput[];
  /** R3 analiz bloğu: kanıt ya da örneklem uyarısı (ikisi birlikte asla). */
  analiz?: AnalysisInput;
}

export const NARRATIVE_DEFAULT_LIMIT = 5;

/** Girdiden çıkan bütün gözlemler (sırasız, süzgeçsiz). */
/** Gözlem + kaynak ölçüsü para birimli mi (bulut fiyat izni süzgeci bu işareti okur; bulut hesap yapmaz). */
export type EtiketliGozlem = Gozlem & { paraIcerir?: true };

export function gozlemleriTopla(g: NarrativeInput): EtiketliGozlem[] {
  const out: EtiketliGozlem[] = [];
  // Para işareti gözlemin KAYNAK birimidir, kanıt alanı değil: `degisimKaynagi` kanıtı birimsiz para farkı taşır.
  const ekle = (birim: Birim | undefined, ...gs: (Gozlem | null)[]) => {
    const para = birim !== undefined && paraBirimiMi(birim);
    for (const x of gs) if (x) out.push(para ? { ...x, paraIcerir: true } : x);
  };
  if (g.veri) ekle(undefined, emptyResultState(g.veri));
  if (g.anaSayi) {
    ekle(g.anaSayi.birim, olculemedi(g.anaSayi));
    if (g.anaSayiIfadesi) {
      const sozler = g.donemSozu ?? (g.donem ? donemSozleri(g.donem, g.kiyasDonemi) : { donem: null, kiyas: null });
      ekle(g.anaSayi.birim, anaSayiKiyas(g.anaSayi, g.anaSayiIfadesi, sozler));
    }
  }
  if (g.kirilim) ekle(g.kirilim.birim, enBuyukPay(g.kirilim), yogunlasma(g.kirilim), degisimKaynagi(g.kirilim));
  if (g.seri) ekle(g.seri.birim, egilim(g.seri), aykiri(g.seri));
  for (const e of g.esikler ?? []) ekle(e.birim, esikAsimi(e));
  if (g.musteriRitmi) ekle(undefined, sessizlesen(g.musteriRitmi.musteriler, g.musteriRitmi.bugun));
  for (const k of g.kapsam ?? []) ekle(undefined, scopeNote(k));
  // Analiz cümlesi ölçü adı + kanıt gücü taşır, tutar taşımaz.
  if (g.analiz) ekle(undefined, correlationObservation(g.analiz), sampleWarningObservation(g.analiz));
  return out;
}

const kuralSirasi = (k: KuralAdi): number => KURAL_ADLARI.indexOf(k);

/** Sıralı anlatı. `kurallar` verilirse yalnız onlar; metin üretmeyen kural düşer. */
export function anlatiUret(
  girdi: NarrativeInput,
  secenek: { kurallar?: readonly KuralAdi[]; enFazla?: number } = {},
): AnlatiCumlesi[] {
  const izinli = secenek.kurallar ? new Set<KuralAdi>(secenek.kurallar) : null;
  const cumleler: (AnlatiCumlesi & { sira: number })[] = [];
  for (const g of gozlemleriTopla(girdi)) {
    if (izinli && !izinli.has(g.kural)) continue;
    const metin = cumleKur(g);
    if (!metin) continue;
    cumleler.push({ kural: g.kural, onem: g.onem, metin, kanit: g.kanit, ...(g.paraIcerir ? { paraIcerir: true as const } : {}), sira: kuralSirasi(g.kural) });
  }
  cumleler.sort((a, b) => b.onem - a.onem || a.sira - b.sira || (a.metin < b.metin ? -1 : a.metin > b.metin ? 1 : 0));
  return cumleler.slice(0, secenek.enFazla ?? NARRATIVE_DEFAULT_LIMIT).map(({ sira: _s, ...c }) => c);
}
