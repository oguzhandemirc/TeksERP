/** Çözgü kartındaki iplik özeti — listede "hangi iplikten" sorusunu kod/ad
 *  olmadan cevaplayamayız; denye de formülün girdisi olduğu için taşınır. */
export interface WarpSpecYarnItem {
  id: string;
  code: string;
  name: string;
  /** Denye (9.000 m'nin gramı). Backend `Decimal` döner → string. */
  linearDensityDen: string | null;
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
  /** Tarak no · dişe tel · tarak eni — bilgi alanları; Decimal → string. */
  reedNo: string | null;
  endsPerDent: number | null;
  reedWidthCm: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
