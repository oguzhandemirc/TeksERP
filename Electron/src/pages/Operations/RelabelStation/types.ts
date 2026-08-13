// Yeniden-Etiketleme istasyonu — backend `RelabelContext` (inventory.service.ts)
// şekliyle birebir. Salt-okunur bağlam: spec seed + konum/guard + son baskı + adaylar.

export interface RelabelCandidateCustomer {
  customerId: string;
  customerCode: string;
  customerName: string;
  orderLineId: string;
  orderNumber: string;
}

/** `Roll.lastLabelSnapshot` — son basılan etiketin künyesi ("A"). Tüm alanlar opsiyonel. */
export interface RelabelLastLabelSnapshot {
  customerId?: string;
  customerName?: string;
  orderNumber?: string;
  orderLineId?: string;
  itemName?: string;
  colorName?: string;
  printedAt?: string;
  operatorName?: string;
  stock?: boolean;
}

export interface RelabelChip {
  id: string;
  code: string;
  name: string;
  color: string | null;
  /** SEÇİM (CHOICE) tipli özelliğin topa damgalı değeri (örn. GRAMAJ → "50 gr").
   *  Dolu gelen satır Düzelt formunda SALT-OKUNUR bilgidir: değer istasyonda
   *  (Kurşun/QC2) seçilir, backend replace'i de bu satırlara dokunmaz (F1).
   *  BAYRAK özelliklerde her zaman null. */
  value?: { code: string; name: string } | null;
}

export interface RelabelContext {
  id: string;
  barcode: string | null;
  status: string;
  entrySource: string;
  itemId: string;
  item: { id: string; code: string; name: string };
  colorId: string | null;
  color: { id: string; code: string; name: string; hex: string | null } | null;
  qualityGrade: string;
  qualityGradeId: string | null;
  qualityGradeRef: { id: string; code: string; name: string; color: string | null } | null;
  width: number | null;
  /** KAT — katalog KODU ("6-KAT"/"TUP"); kat girilmemiş topta null. */
  foldType: string | null;
  currentQty: number;
  weightKg: number | null;
  markedForKartela: boolean;
  /** Etiket bayat mı — veri/metraj düzeltildi ama fiziksel etiket yeniden basılmadı. */
  labelDirty: boolean;
  properties: RelabelChip[];
  propertyIds: string[];
  lastLabelSnapshot: RelabelLastLabelSnapshot | null;
  shipment: { id: string; shipmentNo: string; status: string } | null;
  sack: { id: string; sackNo: string; seq: number } | null;
  specLocked: boolean;
  candidateCustomers: RelabelCandidateCustomer[];
}

/** `PATCH /api/rolls/:id/label` gövdesi — applyManualProperties. propertyIds TAM liste (replace). */
export interface RelabelSpecPayload {
  colorId: string | null;
  propertyIds: string[];
  width: number | null;
  qualityGrade?: string;
  /**
   * KAT düzeltmesi — katalog kodu ("6-KAT"), `null` = kat bilgisini temizle,
   * ALAN YOKSA kata dokunulmaz. Bu üçlü sözleşme backend'in `foldTypeSchema`'sı
   * ile birebir; `null` ile `undefined` farkını koru (biri siler, biri korur).
   */
  foldType?: string | null;
  /** Metraj (mt) düzeltmesi — yalnız değiştiyse gönderilir; bütün topta izinli. */
  currentQty?: number;
  /**
   * İşlem nedeni. Serbest satılabilir stokta (STOCK/WAREHOUSE/A1_STOCK) opsiyonel;
   * top üretimdeyse backend ZORUNLU kılar ve `roll:manual-adjust` yetkisi arar.
   */
  reason?: string;
}

/** Serbest satılabilir stok — backend'deki FREE_STOCK kümesinin aynası. */
export const FREE_STOCK_STATUSES = ["STOCK", "WAREHOUSE", "A1_STOCK"] as const;

/** Bu topu düzeltmek süpervizör kapsamı mı? (sebep zorunlu + roll:manual-adjust) */
export function needsSupervisorEdit(status: string): boolean {
  return !(FREE_STOCK_STATUSES as readonly string[]).includes(status);
}
