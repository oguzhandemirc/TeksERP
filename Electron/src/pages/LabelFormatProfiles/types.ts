/**
 * Etiket fiziksel format profili — medya (widthMm×heightMm) + GÜVENLİK PAYI
 * (marginMm, her kenardan içerik insetı). Decimal alanlar API'de string döner.
 */
export interface LabelFormatProfile {
  id: string;
  code: string;
  name: string;
  widthMm: string | number;
  heightMm: string | number;
  /** Eski tek pay (per-side boşsa buna düşülür). */
  marginMm: string | number;
  /** Kenar-başına pay (mm); null → marginMm'e düşer. */
  marginTopMm?: string | number | null;
  marginRightMm?: string | number | null;
  marginBottomMm?: string | number | null;
  marginLeftMm?: string | number | null;
  gapMm: string | number;
  dpi: number;
  orientation: "PORTRAIT" | "LANDSCAPE";
  isActive: boolean;
  /** TOP (rulo) etiketlerinin sistem-varsayılan boyutu. Kartela bundan etkilenmez. */
  isRollDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
