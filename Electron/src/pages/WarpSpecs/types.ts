/** Çözgü kartındaki iplik özeti — listede "hangi iplikten" sorusunu kod/ad
 *  olmadan cevaplayamayız; denye de formülün girdisi olduğu için taşınır. */
export interface WarpSpecYarnItem {
  id: string;
  code: string;
  name: string;
  /** Denye (9.000 m'nin gramı). Backend Decimal'i JSON'da sayı döndürür. */
  linearDensityDen: string | number | null;
}

export interface WarpSpec {
  id: string;
  code: string;
  name: string;
  yarnItemId: string;
  yarnItem?: WarpSpecYarnItem | null;
  /** Toplam tel (kenar dahil) — devere formülünün ilk çarpanı. */
  endsCount: number;
  selvedgeEnds: number | null;
  /** Tarak no · dişe tel · tarak eni — bilgi alanları; Decimal JSON'da SAYI gelir (installDecimalNumberSerializer). */
  reedNo: string | number | null;
  endsPerDent: number | null;
  reedWidthCm: string | number | null;
  /** Faz 4: take-up (%) — Decimal (JSON'da sayı); null = bilinmiyor. */
  takeUpPct: string | number | null;
  /** SY-C1 kart firesi (%) — Decimal (JSON'da sayı); null = maliyet parametre varsayılanını kullanır. */
  wastePct?: string | number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
