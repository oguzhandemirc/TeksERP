// Çuval Deposu / Paketleme hub tipleri — backend /api/shipping (Çuval Depo modeli).
// Mühür/seal + packedQty KALDIRILDI. `shipment === null` → çuval DEPODA (düzenlenebilir);
// doluysa sevkiyatta. Decimal'lar JSON number/string döner → kullanırken Number() sar.

// ── Sevkiyat statüleri / kapsam ──────────────────────────────────────────────
export type ShipmentStatusKey = "PLANNED" | "DISPATCHED";

export const shipmentStatusLabels: Record<ShipmentStatusKey, string> = {
  PLANNED: "Planlı Sevkiyat",
  DISPATCHED: "Sevk Edildi",
};

/** Arama kapsamı — depo / planlı / sevk edilmiş / tümü. */
export type SackSearchScope = "POOL" | "PLANNED" | "DISPATCHED" | "ALL";

export const scopeLabels: Record<SackSearchScope, string> = {
  POOL: "Depoda (sevk edilmemiş)",
  PLANNED: "Planlı Sevkiyat",
  DISPATCHED: "Sevk Edilmiş",
  ALL: "Tümü",
};

/**
 * "Müşterisiz (genel stok)" süzgeç sentineli — `filter[customerId]=none`.
 * Backend aynasıdır (`sack-search.service.ts` CUSTOMERLESS_FILTER_VALUE);
 * Electron backend'i import EDEMEZ (mobil `permissions.ts` ile aynı durum),
 * bu yüzden değer iki yerde yaşar ve bekçi ikisini kıyaslar.
 */
export const CUSTOMERLESS_FILTER_VALUE = "none";

/** Cari kapısı satırı — `customerId: null` = müşterisiz (genel stok) kovası. */
export interface SackCustomerBucket {
  customerId: string | null;
  name: string;
  code: string | null;
  sackCount: number;
}

export type ShipmentDestination = "DOMESTIC" | "EXPORT";

export const destinationLabels: Record<ShipmentDestination, string> = {
  DOMESTIC: "Yurtiçi",
  EXPORT: "Yurtdışı",
};

// ── Ortak referanslar ────────────────────────────────────────────────────────
export interface SackCustomerRef {
  id: string;
  name: string;
}

export interface SackShipmentRef {
  id: string;
  shipmentNo: string;
  status: ShipmentStatusKey;
}

/** Depodaki çuval mı — çoklu seçim/sevkiyat/düzenleme yalnız bunlarda açık. */
export function isWarehouseSack(s: { shipment: SackShipmentRef | null }): boolean {
  return s.shipment === null;
}

/**
 * Çuval durumu — liste kolonu ve detay paneli PAYLAŞIR. ETİKET metni tek kaynak
 * (aksi halde iki yerde ayrışır); RENK ayrı: liste dolu/loud rozet kullanır
 * (`sacksColumns.STATUS_CLASS`), panel tonlu `StatusBadge` (`sackStatusTones`).
 */
export type SackStatusKey = "POOL" | "PLANNED" | "DISPATCHED";

export const sackStatusLabels: Record<SackStatusKey, string> = {
  POOL: "Depoda",
  PLANNED: "Sevkte",
  DISPATCHED: "Sevk Edildi",
};

export const sackStatusTones = {
  POOL: "success",
  PLANNED: "progress",
  DISPATCHED: "muted",
} as const;

export function sackStatusOf(s: { shipment: SackShipmentRef | null }): SackStatusKey {
  if (s.shipment === null) return "POOL";
  return s.shipment.status === "DISPATCHED" ? "DISPATCHED" : "PLANNED";
}

// ── Arama sonuç satırı (GET /sack-search, cursor) ────────────────────────────
export interface SackSearchRow {
  id: string;
  sackNo: string;
  seq: number | null;
  weightKg: number | null;
  createdAt: string;
  customer: SackCustomerRef | null;
  branch: { id: string; code: string | null; name: string } | null;
  /** null = depoda (düzenlenebilir); dolu = bir sevkiyata atanmış. */
  shipment: SackShipmentRef | null;
  rollCount: number;
  totalQty: number;
  swatchCount: number;
  /** Çuval yorumu var mı (💬 göstergesi) — listede tam metin dönmez. */
  hasNote: boolean;
  /** Yorumun ilk 80 karakteri (satır ipucu); tam metin çuval dökümünde. */
  notePreview: string | null;
  /** İçerik filtresi (kumaş/renk/en) yokken null — eşleşme sütunu gizlenir. */
  matchRollCount: number | null;
  matchQty: number | null;
}

export interface SackSearchParams {
  itemId?: string;
  colorId?: string;
  width?: number;
  customerId?: string;
  scope?: SackSearchScope;
  shipmentNo?: string;
  sackCode?: string;
  includeDispatched?: boolean;
  cursor?: string | null;
  limit?: number;
}

export interface SackSearchResponse {
  success: boolean;
  data: SackSearchRow[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

/**
 * Çuvalda KAYITLI ama fiziksel olarak binada OLMAYAN top statüleri ("hayalet").
 * Backend tek kaynağın aynası: `Teks-Erp/src/services/helpers/sack-invariants.helper.ts`
 * → `SACK_ABSENT_STATUSES`. `SHIPPED` BİLİNÇLİ olarak YOK (sevk edilen top çuvalında
 * kalır ve irsaliyedeki adetle tutarlı sayılır).
 *
 * Neden istemcide de var: backend sayım/belge yüzeylerinde bunları zaten dışlar, ama
 * çuval dökümü onları BİLEREK gösterir — operatörün görüp çıkarabilmesi için. Rozet
 * o dökümde "bu top burada değil" der. Backend'e yeni statü eklenirse burayı da güncelle.
 */
export const SACK_ABSENT_STATUSES = [
  "CANCELLED",
  "SCRAP",
  "IN_PRODUCTION",
  "AT_SUBCONTRACTOR",
  "SUBCONTRACTOR_CONSUMED",
  "AT_KARTELA",
  "KARTELA_CONSUMED",
  "TAMBUR_CONSUMED",
] as const;

/** Kısa Türkçe rozet metni — operatör "nerede?" sorusunu okuyabilsin. */
export const sackAbsentLabels: Record<string, string> = {
  CANCELLED: "İptal",
  SCRAP: "Fire",
  IN_PRODUCTION: "Üretimde",
  AT_SUBCONTRACTOR: "Fasonda",
  SUBCONTRACTOR_CONSUMED: "Fasonda tüketildi",
  AT_KARTELA: "Kartelada",
  KARTELA_CONSUMED: "Kartelaya dönüştü",
  TAMBUR_CONSUMED: "Tamburda tüketildi",
};

/** Top fiziksel olarak çuvalda mı — `false` ise çıkarılması gerekir. */
export function isSackAbsent(status: string | undefined): boolean {
  return !!status && (SACK_ABSENT_STATUSES as readonly string[]).includes(status);
}

// ── Tek çuval dökümü (GET /sacks/:id/contents) — editör + arama detayı ───────
export interface SackContentRoll {
  id: string;
  barcode: string | null;
  /** Top statüsü — hayalet rozeti için (bkz. `isSackAbsent`). */
  status?: string;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  /** Topun ÜSTÜNDEKİ fiziksel etiket geçersiz mi (müşteri şablonu değişti / relabel). */
  labelDirty?: boolean;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}

export interface SackContentSwatch {
  id: string;
  barcode: string | null;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}

/**
 * Çuval brüt tartısının KAYNAĞI (backend `Sack.weightSource`) — İÇ iz.
 * `null` = bu alan eklenmeden önce tartılmış (legacy, kaynağı gerçekten bilinmiyor).
 * ⚠️ Belgeye/etikete BASILMAZ; yalnız detay yüzeyinde rozet olarak gösterilir.
 */
export type SackWeightSource = "SCALE" | "MANUAL" | "SIMULATED";

/** Rozet metni — `SCALE` için rozet GÖSTERİLMEZ (normal durum, gürültü olurdu). */
export const weightSourceBadge: Record<SackWeightSource, string | null> = {
  SCALE: null,
  MANUAL: "elle girildi",
  SIMULATED: "SİMÜLASYON",
};

export interface SackContents {
  id: string;
  sackNo: string;
  seq: number | null;
  weightKg: number | null;
  /** Tartının kaynağı — rozet için (bkz. `weightSourceBadge`). */
  weightSource?: SackWeightSource | null;
  /** ÇUVALIN KENDİ etiketi bayat mı (müşteri değişti → farklı çuval şablonu).
   *  Toplarınki `rolls[].labelDirty` — ayrı nesneler, ayrı baskı yolları. */
  labelDirty?: boolean;
  /** Çuval yorumu — iç serbest not (tam metin). */
  notes: string | null;
  /** Dolu = sevkiyatta (içerik kilitli); null = depoda. */
  shipment:
    | (SackShipmentRef & {
        customer?: SackCustomerRef | null;
        branch?: { id: string; code: string | null; name: string } | null;
      })
    | null;
  rolls: SackContentRoll[];
  swatches: SackContentSwatch[];
}

// ── İçerik dökümü (POST /sack-search/content-dump) ────────────────────────────
// Çeki listesinin (PickListRow) GRUPLU özetinin aksine TOP BAZLI. Sayısal alanlar
// backend'de Number()'a çevrilmiş gelir → istemcide Number(...) sarmaya gerek yok.
export interface SackContentDumpRoll {
  id: string;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
  qualityGrade: string | null;
}

export interface SackContentDumpSwatch {
  id: string;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
}

export interface SackContentDumpSack {
  id: string;
  sackNo: string;
  seq: number | null;
  weightKg: number | null;
  /** TAM metin — basılması İSTEMCİDE opt-in (varsayılan kapalı). */
  notes: string | null;
  customer: SackCustomerRef | null;
  branch: { id: string; code: string | null; name: string } | null;
  shipment: SackShipmentRef | null;
  rollCount: number;
  totalQty: number;
  rolls: SackContentDumpRoll[];
  swatches: SackContentDumpSwatch[];
}

/** POST /sacks lean dönüşü. Müşteri artık opsiyonel → nullable. Ad/kod çözülmüş döner
 *  (istemci editör hedefini fetch'siz kurar). */
export interface OpenedSack {
  id: string;
  sackNo: string;
  weightKg: number | null;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
}

/** Scan cevabı — okutulan kod top mu kartela mı + hangi çuvala bağlandı. */
export interface ScanResult {
  kind: "ROLL" | "SWATCH";
  rollId?: string;
  swatchId?: string;
  sackId?: string | null;
  currentQty?: number;
}

/** Kartela stoğu: kumaş+renk bazında müsait (çuvala/sevke girmemiş) adet. */
export interface KartelaStockGroup {
  itemId: string;
  itemCode: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  count: number;
}

export interface AddKartelaResult {
  added: number;
  swatchIds: string[];
  sackId: string;
}

// ── Sipariş seçim / rehber (GET /open-orders) — packed KALDIRILDI ────────────
export interface OpenOrderLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  customerItemName: string | null;
  customerColorName: string | null;
  requested: number;
  shipped: number;
  openQty: number;
  warehouseAvailable: number;
  covered: boolean;
}

export interface OpenOrder {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    deadline: string | null;
    customer: { id: string; code?: string; name: string };
    branch: { id: string; code: string | null; name: string } | null;
  };
  lines: OpenOrderLine[];
}

// ── Top yerini bul (GET /locate-roll) ────────────────────────────────────────
export interface LocatedRollShipment extends SackShipmentRef {
  customer: { id: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
}

export interface LocatedRoll {
  id: string;
  barcode: string;
  status: string;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
  sack: { id: string; sackNo: string; seq: number | null; weightKg: number | null } | null;
  shipment: LocatedRollShipment | null;
}

// ── Çeki listesi (POST /sack-search/pick-list) ───────────────────────────────
export interface PickListRow {
  id: string;
  sackNo: string;
  seq: number | null;
  weightKg: number | null;
  /** Çuval notu (TAM metin) — çeki listesi iç çalışma kağıdı; basılması opsiyonel. */
  notes: string | null;
  customer?: SackCustomerRef | null;
  branch?: { id: string; code: string | null; name: string } | null;
  shipment: SackShipmentRef | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  contents: {
    itemName: string;
    colorName: string | null;
    width: number | null;
    qty: number;
    rollCount: number;
  }[];
}

// ── Sevkiyat kurulum önizlemesi + sonuç ──────────────────────────────────────
export interface PreviewSack {
  id: string;
  sackNo: string;
  weightKg: number | null;
  rollCount: number;
  totalMeters: number;
}

export interface PreviewLine {
  lineId: string;
  orderNumber: string;
  item: string;
  color: string | null;
  width: number | null;
  need: number;
  allocated: number;
}

export interface CreateShipmentPreview {
  sacks: PreviewSack[];
  lines: PreviewLine[];
  /** Fazla mal / mükerrer / siparişsiz uyarıları — DİKKAT çekilecek. */
  warnings: string[];
  totals: { totalMeters: number; sackCount: number; surplusMeters: number };
}

export interface CreatedShipment {
  id: string;
  shipmentNo: string;
  status: ShipmentStatusKey;
  /**
   * Sevk onayı KAPALIYKEN (varsayılan) true → çuvallar oluşturulur oluşturulmaz
   * SEVK EDİLDİ (status=DISPATCHED, stok düştü). AÇIKKEN false → yalnız PLANNED
   * kuruldu, çıkış Sevk Kapısı'ndan ayrıca onaylanır.
   */
  dispatched: boolean;
}

// ── Editör hedefi (liste → editör geçişi) ────────────────────────────────────
export interface EditorTarget {
  sackId: string;
  sackNo: string;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  /** true = "Yeni Çuval" ile az önce açıldı (boş başlar). */
  isNew?: boolean;
}
