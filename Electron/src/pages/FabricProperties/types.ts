/** BAYRAK = var/yok özelliği · SEÇİM = değerlerden biri (kat gibi). */
export type FabricPropertyValueType = "FLAG" | "CHOICE";

/** SEÇİM tipli özelliğin izin verilen değeri. Kod KİMLİK, ad GÖRÜNTÜ. */
export interface FabricPropertyValue {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface FabricProperty {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  /**
   * BAYRAK mı SEÇİM mi? SEÇİM tipli özellikler HEDEF-ÖZELLİK seçicilerinde
   * GÖRÜNMEZ (iş emri hedef özellikleri, rota adımı chip'leri, ürün izinli
   * özellik listesi) — "KAT" oraya sızarsa planlamacı onu işaretler (hangi kat?)
   * ve backend'in "verebilen adım var mı" guard'ı iş emrini reddeder.
   * Süzgeç: `valueType !== "CHOICE"`.
   */
  valueType: FabricPropertyValueType;
  /** SEÇİM tipliyse izin verilen değerler; BAYRAK'ta boş. */
  values?: FabricPropertyValue[];
  /**
   * Özelliği uygulayabilen istasyonlar (`StationProperty`). Backend `defaultInclude`
   * ile listede de döner — "hiçbir istasyona bağlı değil" rozeti buna dayanır.
   * Boş dizi = özellik hiçbir iş emrinde SEÇİLEMEZ (kısıt, eksik veri değil).
   */
  stationCapabilities?: {
    stationId: string;
    station: { id: string; code: string; name: string; isActive: boolean };
  }[];
  createdAt: string;
  updatedAt: string;
}
