// Okuma özeti / belge detayının tanıma bloğu (`tanima`) ve gelen kg alanları — backend
// `gelen-belge-tanima-ozeti.service.ts` + `gelen-belge-gelen-kg.service.ts` aynası. Sunucu kurar; tablet yalnız gösterir.

export type TanimaGroup = 'KIMLIK' | 'GELEN' | 'HEDEF' | 'URUN' | 'DIGER';
export type TanimaRuleSource = 'TEMPLATE' | 'FACTORY' | 'MANUAL';

export interface TanimaMappingRow {
  field: string;
  /** Belgedeki alanın adı (tanıtırken verilen etiket). */
  label: string;
  value: string | null;
  woTarget: string;
  /** İE karşılığının ekrandaki adı ("Gelen metre"). */
  woLabel: string;
  group: TanimaGroup;
}

export interface TanimaRule {
  key: 'multiParty' | 'sections' | 'totalsRow' | 'meterSource';
  value: string;
  source: TanimaRuleSource;
  text: string;
  /** "şablon kuralı" · "fabrika ayarı" · "elle". */
  sourceText: string;
}

export interface Tanima {
  /** score 0..1 (okuma anındaki sınıflama puanı); yerleşik/tanınmamışta null. */
  template: { code: string; name: string; version: number; score: number | null } | null;
  durum: 'TANITILDI' | 'SISTEM' | 'TANITILMAMIS';
  mapping: TanimaMappingRow[];
  rules: TanimaRule[];
}

/** Gelen kg kaynağı (`pickIncomingKg`): şablon alanı · belge beyanı · Σ satır kg. */
export type IncomingKgSource = 'FIELD' | 'TOTAL' | 'LINE_SUM';

/** Okuma özetinin yeni alanları (eski sunucu göndermez → şerit ve gelen kg önerisi yok). */
export interface ReadSummaryTanima {
  tanima?: Tanima;
  incomingKg?: number | null;
  incomingKgSource?: IncomingKgSource | null;
}
