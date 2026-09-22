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
  /**
   * Bölüm anahtarı. ⚠️ Panel bu kümeyi DARALTMAZ: backend yeni bir grup
   * eklediğinde burada `string` olduğu için satır DÜŞMEZ, bilinmeyen grup kendi
   * başlığıyla çizilir. Daraltılmış bir union, "kaydedilen ama görünmeyen kayıt"
   * sınıfını doğrudan üretirdi.
   */
  panelGroup: string;
  /** Bölüm başlığı — BACKEND'den; panelde etiket kopyası tutulmaz. */
  panelGroupLabel: string;
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
