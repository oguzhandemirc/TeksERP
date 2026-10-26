// =============================================================================
// Anlatı gözlem tipleri — kural kataloğu, kanıt ve girdi biçimleri (`gozlem.ts`in sözleşmesi)
// =============================================================================
// Kanıtlar `type` takma adıdır (interface değil): `AnlatiCumlesi.kanit` (Record) ile uyumlu kalsın.

import type { SuffixInput } from "./ek";
import type { AnaSayiKiyas, Birim } from "../sunum/sunum.types";

export const KURAL_ADLARI = [
  "veriYok",
  "suzgecKesti",
  "olculemedi",
  "anaSayiKiyas",
  "enBuyukPay",
  "yogunlasma",
  "degisimKaynagi",
  "egilim",
  "aykiri",
  "esikAsimi",
  "sessizlesen",
  "kapsamNotu",
  "korelasyon",
  "orneklemUyarisi",
] as const;
export type KuralAdi = (typeof KURAL_ADLARI)[number];

// --- Kanıtlar -----------------------------------------------------------------
export type VeriYokKanit = { satirSayisi: number };
export type SuzgecKestiKanit = { satirSayisi: number; dusenSatir: number; suzgecsiz: number };
export type OlculemediKanit = { ad: string; neden: string };
export type AnaSayiKiyasKanit = {
  ad: string;
  deger: number;
  birim: Birim;
  /** null: ölçünün yüklemi yok (özel rapor) — cümle ölçü adıyla kurulur ("Sevk edilen: ekim'de …"). */
  yuklem: string | null;
  ozne: string | null;
  donem: SuffixInput | null;
  kiyasDonem: SuffixInput | null;
  kiyas: AnaSayiKiyas;
};
export type EnBuyukPayKanit = { ad: string; adTuru: AdTuru; boyut: string; deger: number; birim: Birim; pay: number; toplam: number };
export type YogunlasmaKanit = { pay: number; ilkUc: string[]; boyut: string; ozneIlgi: string; kalemSayisi: number };
export type DegisimKaynagiKanit = {
  ad: string;
  adTuru: AdTuru;
  boyut: string;
  katki: number;
  yon: "artis" | "dusus";
  toplamFark: number;
  kalemFark: number;
};
export type EgilimKanit = {
  olcuAdi: string;
  yon: "artiyor" | "dusuyor";
  nokta: number;
  egim: number;
  r2: number;
  ardisik: number;
  zamanBirimi: ZamanBirimi;
};
export type AykiriKanit = {
  etiket: string;
  olcuAdi: string;
  deger: number;
  normal: number;
  birim: Birim;
  yon: "yuksek" | "dusuk";
  yontem: "iqr" | "z";
};
export type EsikAsimiKanit = {
  yer: string;
  esik: number;
  esikBirimi: string;
  sifat: string;
  deger: number;
  birim: Birim;
  nesne: string;
};
export type SessizlesenKanit = { ad: string; sessizGun: number; ortalamaAralik: number; siparisGunu: number; digerSessiz: number };
export type ScopeNoteEvidence = { sayi: number; nesne: string; neden: string; sonuc: string };
/**
 * Analiz cümlesinin kanıtı (R3-ISTAT). `p` kartta sayı olarak durur; cümle onu "güçlü kanıt /
 * kanıt var / belirgin bir ilişki görünmüyor" diye söyler. `yer` = "Gece vardiyasında" (ekli hazır).
 */
export type KorelasyonKanit =
  | { yontem: "kiKare"; tur: "oran"; n: number; p: number; nesne: string; olcuAdi: string; yer: string; birimSozu: string; oran: number; digerOran: number; kat: number | null }
  | { yontem: "kiKare"; tur: "tablo"; n: number; p: number; nesne: string; yer: string; ikinciAd: string; pay: number; genelPay: number }
  | { yontem: "pearson" | "spearman"; n: number; p: number; r: number; nesne: string; xAdi: string; yAdi: string };
/** Örneklem uyarısı: n < 30 ya da beklenen hücre < 5 → kanıt cümlesi YERİNE söylenir. */
export type SampleWarningEvidence = { n: number; enKucukBeklenen: number | null; nesne: string; gereken: number };

export interface KanitHaritasi {
  veriYok: VeriYokKanit;
  suzgecKesti: SuzgecKestiKanit;
  olculemedi: OlculemediKanit;
  anaSayiKiyas: AnaSayiKiyasKanit;
  enBuyukPay: EnBuyukPayKanit;
  yogunlasma: YogunlasmaKanit;
  degisimKaynagi: DegisimKaynagiKanit;
  egilim: EgilimKanit;
  aykiri: AykiriKanit;
  esikAsimi: EsikAsimiKanit;
  sessizlesen: SessizlesenKanit;
  kapsamNotu: ScopeNoteEvidence;
  korelasyon: KorelasyonKanit;
  orneklemUyarisi: SampleWarningEvidence;
}

export type Gozlem = { [K in KuralAdi]: { kural: K; onem: number; kanit: KanitHaritasi[K] } }[KuralAdi];

// --- Girdiler -----------------------------------------------------------------
/** "ozel": kesmeyle ek alan özel ad (müşteri, fasoncu) · "cins": boyut adıyla bitişik ("lacivert renk"). */
export type AdTuru = "ozel" | "cins";
export type ZamanBirimi = "gün" | "hafta" | "ay";

export type BreakdownRow = { ad: string; deger: number | null; onceki?: number | null };
export type Kirilim = {
  /** Boyutun tekil cins adı, cümle içi yazımla: "müşteri", "renk", "kumaş". */
  boyut: string;
  birim: Birim;
  satirlar: BreakdownRow[];
  adTuru?: AdTuru;
  /** Yoğunlaşma cümlesinin öznesi (ilgi ekli): varsayılan "İşin". */
  ozneIlgi?: string;
};
export type SeriNoktasi = { etiket: string; deger: number | null };
export type Seri = {
  /** Cümledeki ölçü adı; `egilim` cümle başına (büyük harfle), `aykiri` cümle içine koyar. */
  olcuAdi: string;
  olcuAdiCumleIci?: string;
  birim: Birim;
  zamanBirimi: ZamanBirimi;
  noktalar: SeriNoktasi[];
};
export type ThresholdInput = EsikAsimiKanit & { toplam?: number };
export type MusteriRitmi = { ad: string; siparisTarihleri: Date[] };
export type ScopeNoteInput = ScopeNoteEvidence & { toplam?: number };
/** Analiz girdisi: uyarı varsa korelasyon gözlemi DÜŞER (küçük örneklemde kanıt cümlesi yok). */
export type AnalysisInput = { korelasyon: KorelasyonKanit | null; orneklem: SampleWarningEvidence | null };
export type AnaSayiIfadesi = { yuklem?: string; ozne?: string };
