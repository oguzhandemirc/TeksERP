/** `GET /api/number-series` satırı — backend `listSeries()` aynası. */
export type SeriesDateSegment =
  | "NONE"
  | "DDMMYY"
  | "DDMMYYYY"
  | "YYMM"
  | "MMYY"
  | "YYYYMM"
  | "YYYYMMDD"
  | "YY"
  | "YYYY";

/**
 * Serinin BUGÜN neden düzenlenemediği. ÜÇ AYRI SINIF ve üçü FARKLI GÜN kalkar —
 * bu yüzden ekranda da üç FARKLI cümle olmak zorundalar.
 */
export type SeriesLockKind = "YAPISAL" | "SAYAC" | "ISTEMCI";

/**
 * ⚠️ `reset` HER ZAMAN `false` ve bu bir EKSİKLİK DEĞİL, sunucuda ÖLÇÜLMÜŞ bir
 * sonuç: aynı ön ek ve tarih döneminde numaralar tekil olduğu için sayaç 1'e
 * döndürülse bile ilk boş numaraya kadar ilerler. Ekranda GEREKÇESİYLE kapalı
 * durur — "neden yok?" sorusunun ekranda cevabı olmaz, "neden kapalı?" olur.
 */
export interface SeriesCounterCapabilities {
  startValue: boolean;
  step: boolean;
  maxValue: boolean;
  reset: false;
  lockedReason?: string;
  resetReason: string;
}

/**
 * Tükenme durumu — ÜÇ SONUÇ: `percent` sayı ise ölçüldü, `null` ise ÖLÇÜLEMEDİ
 * ve `reason` gerekçeyi taşır. "0 %" demek, ölçülmemiş bir şeye sıfır demektir.
 */
export interface SeriesExhaustion {
  limit: number | null;
  used: number | null;
  percent: number | null;
  warn: boolean;
  source: "maxValue" | "rollCounter" | null;
  reason?: string;
}

export type NumberSourceMode = "FREE" | "SYSTEM" | "MANUAL";

/** Numara kaynağı yeteneği — ayar YALNIZ elle yolu olan seride çizilir. */
export interface SeriesSourceCapability {
  editable: boolean;
  value: NumberSourceMode;
  manualPath?: string;
}

export interface SeriesCounterInput {
  startValue: number | null;
  step: number | null;
  maxValue: number | null;
}

export interface NumberSeriesRow {
  key: string;
  label: string;
  prefix: string;
  dateSegment: SeriesDateSegment;
  digits: number;
  separator: string;
  /** Tarih ile sayaç arasındaki ayraç; `null` = birinci ayraca düşer (D5②). */
  separator2: string | null;
  retiredPrefixes: string[];
  kind?: string;
  editable: boolean;
  lockedReason?: string;
  lockKind?: SeriesLockKind;
  /** Kilit NE ZAMAN kalkar — SUNUCUDAN; panel cümle yazmaz (2026-09-23). */
  lockUnlock?: string;
  /** Eylem kimde; rozet vurgusu buradan. Eski backend'de `undefined`. */
  lockActor?: "kimse" | "biz" | "siz";
  /**
   * Bölüm anahtarı. ⚠️ Panel bu kümeyi DARALTMAZ: backend yeni bir grup
   * eklediğinde burada `string` olduğu için satır DÜŞMEZ, bilinmeyen grup kendi
   * başlığıyla çizilir. Daraltılmış bir union, "kaydedilen ama görünmeyen kayıt"
   * sınıfını doğrudan üretirdi.
   */
  panelGroup: string;
  /** Bölüm başlığı — BACKEND'den; panelde etiket kopyası tutulmaz. */
  panelGroupLabel: string;
  /** Sayaç yetenekleri — panel HESAPLAMAZ, okur (`countBirim` emsali). */
  counter: SeriesCounterCapabilities;
  source: SeriesSourceCapability;
  /** Yürürlükteki sayaç ayarları; `null` = ayarlanmamış (bugünkü davranış). */
  startValue: number | null;
  step: number | null;
  maxValue: number | null;
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
  /**
   * TARİH ile SAYAÇ arasındaki ayraç; `null` = birinci ayraca düş (D5②).
   *
   * ⚠️ ZORUNLU ALAN (opsiyonel değil): panel her kaydetmede açıkça gönderir ki
   * "göndermedim" ile "temizledim" karışmasın — sayaç alanlarındaki kuralın
   * aynısı, aynı gerekçeyle.
   */
  separator2: string | null;
}
