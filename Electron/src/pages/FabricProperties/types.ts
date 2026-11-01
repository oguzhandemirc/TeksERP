/** BAYRAK = var/yok özelliği · SEÇİM = değerlerden biri (kat gibi). */
export type FabricPropertyValueType = "FLAG" | "CHOICE";

/** SEÇİM tipli özelliğin izin verilen değeri. Kod KİMLİK, ad GÖRÜNTÜ. */
export interface FabricPropertyValue {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** Bu değer (gramaj çeşidi) hangi hizmet kalemiyle faturalanır (H6); null = özelliğe düşer. */
  serviceItemId?: string | null;
  /** Brode deseni: bir adetteki vuruş sayısı (VURUŞ fiyat birimi); null = girilmedi. */
  stitchCount?: number | null;
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
  /**
   * Bu SEÇİM özelliği hangi BAYRAĞIN çeşidi? (KQ-D4 — "Kurşun gramajı" →
   * "Kurşunlu"). Değer basılınca ana bayrak da topa yazılır. Bayrakta hep null.
   */
  variantOfPropertyId?: string | null;
  /** İşlem → hizmet kalemi eşlemesi (H6): değerde eşleme yoksa bu, o da yoksa ana bayrağınki. */
  serviceItemId?: string | null;
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
