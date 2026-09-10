/**
 * Saha #2 — Muhasebe / Sevk Edilenler ekranı tipleri.
 * Liste: GET /api/shipping/shipments (status=DISPATCHED, salt-okunur).
 * Fiş: GET /api/shipping/shipments/:id/dispatch-report (3 bölümlü ornek-fis).
 */

export interface DispatchListItem {
  id: string;
  /** SHIPMENT = çuval sevkiyatı; DIRECT = fasondan doğrudan sevk (DirectShipment).
   *  Birleşik liste iki tabloyu tek akışta döner (listShipments). Fiş/Excel akışları
   *  bu ayrıma göre farklı uca gider. */
  kind: "SHIPMENT" | "DIRECT";
  shipmentNo: string;
  status: string;
  dispatchedAt: string | null;
  createdAt: string;
  customer: { id: string; code?: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
  /** ⚠️ BRÜT — iade düşülmez; fiş/irsaliye ile birebir (bkz. ShipmentListItem). */
  _count: { sacks: number; rolls: number; orders: number; returns: number };
  totalMeters: number;
  totalKg: number;
  /** DIŞ muhasebe programındaki belgenin izi — bu sistemde fatura KESMEZ. */
  invoiceNo: string | null;
  invoicedAt: string | null;
  /** Operatörün beyan ettiği FİZİKSEL çuval adedi (araca yüklenen); null = beyan yok.
   *  `_count.sacks` sistemin saydığı kayıt adedidir — ikisi meşru olarak farklı olabilir. */
  manualSackCount: number | null;
  /** İrsaliye açıklaması — muhasebe satırında da görünür. */
  dispatchNote: string | null;
  /**
   * İÇ faturalar (`Invoice.shipmentId` / `directShipmentId`) — iptal edilmişler
   * HARİÇ (backend `assertSourceFree` ile AYNI süzgeç).
   *
   * ⚠️ `invoiceNo` ile KARIŞTIRMA: o dış izdir ve `invoiceNo` dolu diye iç
   * faturalama yolunu kapatmak, dış numarası işaretlenmiş sevkiyatta iç fatura
   * kesilmesini tamamen engelliyordu (tersi de vardı: iç taslak varken düğme
   * çıkıp kullanıcıyı kesin bir 409'a yürütüyordu).
   *
   * Eski backend'de alan hiç gelmez → `undefined` (iç fatura bilinmiyor sayılır
   * ve düğme bugünkü gibi çıkar).
   */
  invoices?: Array<{ id: string; docNo: string; status: "DRAFT" | "CONFIRMED" | "CANCELLED" }>;
}

/** Dönem bandı — filtreli kümenin TAMAMI (`?withSummary=true`), sayfa toplamı değil. */
export interface DispatchListSummary {
  shipmentCount: number;
  totalMeters: number;
  totalKg: number;
}

/** listCursor yanıtı + muhasebe özeti (ilk sayfada gelir; ReturnsCursorResponse deseni). */
export interface DispatchCursorResponse {
  success: boolean;
  data: DispatchListItem[];
  summary?: DispatchListSummary;
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number };
}

export interface DispatchReport {
  header: {
    shipmentNo: string;
    customerName: string;
    customerCode: string;
    branchName: string | null;
    /** Müşteri şube kodu (ihracat) — belgede toggle'lı. */
    branchCode: string | null;
    procedureCode: string | null;
    destination: "DOMESTIC" | "EXPORT";
    status: string;
    date: string;
  };
  products: Array<{
    name: string;
    /** Müşterideki ad — donmuş belgede zaten var; yoksa/boşsa bizimki basılır. */
    customerName?: string | null;
    rollCount: number;
    totalMeters: number;
  }>;
  sacks: Array<{ code: string; seq: number; totalMeters: number; totalKg: number; packageCount: number }>;
  cekiRows: Array<{
    rollId: string;
    sackCode: string;
    barcode: string | null;
    desen: string;
    varyant: string;
    /** Müşterideki desen/varyant — ürün satırıyla AYNI zincir, aynı fail-open. */
    customerDesen?: string | null;
    customerVaryant?: string | null;
    meters: number;
    kg: number;
  }>;
  /**
   * HANGİ ADIN basılacağı — sunucudan gelir, burada YENİDEN HESAPLANMAZ.
   *
   * ⚠️ 2026-09-10 saha bulgusu: aynı sevkiyatın PDF'i müşterinin adını, Excel'i
   * bizim adımızı basıyordu. İkisi de aynı donmuş belgeden besleniyordu; ayrışan
   * şey KARARdı — rejimi yalnız irsaliyeyi çizen taraf biliyordu. Kararı burada
   * yeniden kurmak aynı ayrışmayı yeniden üretirdi.
   *
   * Opsiyonel: eski sunucu göndermez → Excel bugünkü gibi bizim adımızı basar.
   */
  adRejimi?: {
    urunBizdeki: boolean;
    urunMusterideki: boolean;
    cekiBizdeki: boolean;
    cekiMusterideki: boolean;
    renkAyriSutun: boolean;
  };
  totals: { totalRolls: number; totalMeters: number; totalKg: number; sackCount: number };
  /** İçerik DONMUŞ belgeden mi geldi (sevk anı, irsaliyeyle birebir)? false =
   *  sevkiyat henüz sevk edilmemiş → TASLAK fiş (canlı çuval içeriği). */
  frozen: boolean;
  /** Donmuş belgenin durumu/versiyonu (frozen=false ise null). VOIDED = sevkiyat iptal. */
  docStatus: string | null;
  docVersion: number | null;
  /** Bu sevkiyattan SONRA alınan (iptal edilmemiş) iadeler. Fişteki rakamlardan
   *  DÜŞÜLMEZ — yalnız dipnot basmak için; iade ayrı belgeyle izlenir. */
  returns: { count: number; meters: number };
}

/**
 * Muhasebe Excel dökümü veri seti — GET /api/shipping/accounting-export.
 * Miktar-odaklı (fiyat YOK). Tarihler ISO string; sayılar düz number.
 */
export interface AccountingExportData {
  range: {
    from: string | null;
    to: string | null;
    field: string | null;
    /** "period" (tarih aralığı) | "selection" (işaretli sevkler). */
    mode?: "period" | "selection";
    selectedCount?: number;
  };
  shipments: Array<{
    shipmentNo: string;
    dispatchedAt: string;
    customerCode: string;
    customerName: string;
    taxNumber: string;
    branchName: string;
    branchCode: string;
    destination: "DOMESTIC" | "EXPORT";
    procedureCode: string;
    plateNumber: string;
    driverName: string;
    carrier: string;
    /** Sistemin saydığı çuval KAYDI adedi. */
    sackCount: number;
    /** Operatörün beyan ettiği FİZİKSEL çuval adedi; 0 = beyan yok. */
    manualSackCount: number;
    /** İrsaliye açıklaması — muhasebe satırında da görünür. */
    dispatchNote: string;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
    /** Fatura izi — işaretlenmemişse boş string / null. */
    invoiceNo: string;
    invoicedAt: string | null;
  }>;
  detail: Array<{
    shipmentNo: string;
    dispatchedAt: string;
    customerName: string;
    orderNos: string;
    itemName: string;
    colorName: string;
    width: number | null;
    rollCount: number;
    meters: number;
  }>;
  byCustomer: Array<{
    customerCode: string;
    customerName: string;
    taxNumber: string;
    shipmentCount: number;
    sackCount: number;
    /** Beyan edilenlerin toplamı — beyansız sevkiyatlar 0 ekler. */
    manualSackCount: number;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
  }>;
  byProduct: Array<{
    itemName: string;
    colorName: string;
    width: number | null;
    rollCount: number;
    totalMeters: number;
  }>;
  returns: Array<{
    returnedAt: string;
    customerName: string;
    fromShipmentNo: string;
    barcode: string;
    itemName: string;
    colorName: string;
    width: number | null;
    meters: number;
    reason: string;
  }>;
  totals: {
    shipmentCount: number;
    sackCount: number;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
    returnMeters: number;
  };
}
