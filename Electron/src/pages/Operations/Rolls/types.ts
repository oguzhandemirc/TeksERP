import type { RollStatus, RollOperationType } from "@/types/enums";

export interface RollColor {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}

export interface RollItem {
  id: string;
  code: string;
  name: string;
}

/** Aktif fason sevkinin liste/detay cevabındaki şekli. "İşlem" kategorisi önce
 *  adımdan (step.requiredCategory) gelir; boşsa firmanın kendi kategorisine
 *  düşülür (activeCategoryOf — firma tek kategoriliyse). */
export interface RollActiveDispatch {
  dispatchNo: string;
  dispatchedAt: string;
  subcontractor: {
    id: string;
    name: string;
    code: string | null;
    /** Firmanın hizmet kategorileri (M:N) — step boşken "İşlem" fallback'i. */
    categories: Array<{ category: { id: string; name: string } }>;
  };
  step: { requiredCategory: { id: string; name: string } | null };
}

/** Topun aktif fason sevki (varsa) — kolon hücreleri + detay kartı ortak okur. */
export function activeDispatchOf(roll: Roll): RollActiveDispatch | null {
  return roll.dispatchItems?.[0]?.dispatch ?? null;
}

/** Bir fason sevkinin "İşlem" kategorisi: önce adımın requiredCategory'si; boşsa
 *  firmanın kendi kategorisi (yalnız TEK kategoriliyse — çok kategoride belirsiz).
 *  Backend özet ucu + filtre AYNI COALESCE(step, firma-tek-kategori) tanımını
 *  kullanır → kolon/chip/filtre/detay tutarlı. */
export function categoryOfDispatch(
  d: RollActiveDispatch,
): { id: string; name: string } | null {
  if (d.step.requiredCategory) return d.step.requiredCategory;
  const cats = d.subcontractor.categories ?? [];
  return cats.length === 1 ? cats[0]?.category ?? null : null;
}

/** Topun aktif fason sevkinin "İşlem" kategorisi (varsa) — kolon + chip ortak. */
export function activeCategoryOf(roll: Roll): { id: string; name: string } | null {
  const d = activeDispatchOf(roll);
  return d ? categoryOfDispatch(d) : null;
}

export interface RollPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface Roll {
  id: string;
  /** Açık kumaş Roll'larında null — fiziksel etiket basılmaz. */
  barcode: string | null;
  itemId: string;
  colorId: string | null;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  status: RollStatus;
  /** Kalite yalnız kalite istasyonlarında (KK1 opsiyonel giriş, KK2/Kurşun,
   *  Tambur) belirlenir → kaliteye bakılmamış toplarda null ("—" gösterilir). */
  qualityGrade: string | null;
  /** Topun fiziksel biçimi — TOP (Tambur/ham giriş çocuğu) | ACIK (Tambur-dışı
   *  finalize + fason dönüşü açık kumaş). Otomatik türetilir, operatör seçmez. */
  form: "TOP" | "ACIK";
  /** Tambur'da kartela için işaretlendi mi — depoda kartelaya gidecek topları
   *  ayırt etmek için rozet/filtre. Sevki engellemez. */
  markedForKartela?: boolean;
  /** Etiket bayat mı — veri/metraj düzeltildi ama fiziksel etiket yeniden basılmadı. */
  labelDirty?: boolean;
  entrySource: string;
  parentRollId: string | null;
  /** Açık kumaş Roll'lar için fason kabul referansı. */
  parentReceiptId: string | null;
  packageId: string | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  packagingDate: string | null;
  item?: RollItem;
  color?: RollColor | null;
  /** Roll'a bindirilmiş özellikler (Fason Kabul / Tambur kopyalar). */
  properties?: RollPropertyLink[];
  /** Per-roll operasyon logu. Sadece detay endpoint'inden gelir. */
  operations?: RollOperationLogEntry[];
  /** Topun ÜSTÜNDEKİ son basılan etiketin snapshot'ı (null = stok / müşteri etiketi yok).
   *  BAĞ DEĞİL — yalnız bilgi; baskı/yönlendir anında yazılır. Detay endpoint'inden gelir. */
  lastLabelSnapshot?: RollLabelSnapshot | null;
  /** En güncel iade kaydı(ları) — detay endpoint'inden (RollReturn). Tambur/depo notu burada görünür. */
  returns?: RollReturnEntry[];
  /** AT_KARTELA top için aktif kartela sevki (firma + belge) — detay endpoint'inden. */
  kartelaDispatchItems?: Array<{
    dispatch: {
      dispatchNo: string;
      dispatchedAt: string;
      subcontractor: { id: string; name: string; code: string | null };
    };
  }>;
  /** AT_SUBCONTRACTOR top için açık (dönmemiş) SON fason sevk kalemi — liste
   *  VE detay include'undan gelir (kartelaDispatchItems emsali, en fazla 1 eleman).
   *  Açık-kalem tanımı F85: dönmüş topta backend BOŞ dizi döndürür — yine de UI
   *  hücre/kartlarda status===AT_SUBCONTRACTOR guard'ı savunma amaçlı korunur
   *  (anlık status-geçiş / bayat cache). */
  dispatchItems?: Array<{ dispatch: RollActiveDispatch }>;
  /** Sevkiyat rezervasyonu: dolu ise top "serbest depo" DEĞİL — bir çuvalın
   *  içinde, bir sevkiyata bağlı (planlı sevkiyat). WAREHOUSE statüsüyle
   *  birlikte "Çuvalda" rozeti gösterilir; serbest stok sorgularına girmez. */
  shipmentId?: string | null;
  sackId?: string | null;
  shipment?: { id: string; shipmentNo: string; status: RollShipmentStatus } | null;
  sack?: { id: string; sackNo: string; seq: number } | null;
  createdAt: string;
  updatedAt: string;
}

/** Roll'a bağlı sevkiyatın durumu (rezerve rozetinin alt metni için).
 *  Çuval havuzu modelinde Shipment yalnız PLANNED | DISPATCHED | CANCELLED üretir. */
export type RollShipmentStatus = "PLANNED" | "DISPATCHED" | "CANCELLED";

/** Rezerve topun bağlı olduğu sevkiyat aşamasının kullanıcı etiketi. */
export const shipmentScopeLabels: Record<RollShipmentStatus, string> = {
  PLANNED: "Planlı Sevkiyat",
  DISPATCHED: "Sevk Edildi",
  CANCELLED: "İptal",
};

export interface RollReturnEntry {
  id: string;
  qty: number;
  reasonText: string | null;
  note: string | null;
  createdAt: string;
  reason: { code: string; name: string; color: string | null } | null;
  receivedBy: { fullName: string } | null;
}

export interface RollLabelSnapshot {
  customerId: string | null;
  customerName: string | null;
  orderNumber: string | null;
  itemName: string | null;
  colorName: string | null;
  printedAt: string;
  operatorId: string | null;
  operatorName: string | null;
}

export interface RollOperationLogEntry {
  id: string;
  operationType: RollOperationType;
  createdAt: string;
  operator: { id: string; fullName: string; username: string } | null;
}

export interface RollMovement {
  id: string;
  rollId: string;
  fromStepId: string | null;
  toStepId: string | null;
  movedAt: string;
  notes: string | null;
  fromStep?: { station?: { name: string } };
  toStep?: { station?: { name: string } };
}
