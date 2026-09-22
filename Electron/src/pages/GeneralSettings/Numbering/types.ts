/** `GET /api/number-series` satırı — backend `listSeries()` aynası. */
export type SeriesDateSegment = "NONE" | "DDMMYY" | "YYMM" | "YYYYMM" | "YY" | "YYYY";

/**
 * Serinin BUGÜN neden düzenlenemediği. ÜÇ AYRI SINIF ve üçü FARKLI GÜN kalkar —
 * bu yüzden ekranda da üç FARKLI cümle olmak zorundalar.
 */
export type SeriesLockKind = "YAPISAL" | "SAYAC" | "ISTEMCI";

export interface NumberSeriesRow {
  key: string;
  label: string;
  prefix: string;
  dateSegment: SeriesDateSegment;
  digits: number;
  separator: string;
  retiredPrefixes: string[];
  kind?: string;
  editable: boolean;
  lockedReason?: string;
  lockKind?: SeriesLockKind;
  panelGroup?: "sevkiyat";
  /**
   * Etki cümlesinin birimi — BACKEND'DEN gelir, panelde KOPYALANMAZ.
   * (Satır ile belge aynı şey değil: iade numarası üye satırlara kopyalanır.)
   */
  countBirim?: "kayıt" | "belge";
  preview: string;
}

export interface SeriesFormatInput {
  prefix: string;
  dateSegment: SeriesDateSegment;
  digits: number;
  separator: string;
}
