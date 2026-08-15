import apiClient from "@/services/apiClient";
// ⚠️ TİP-ONLY import: derlemede silinir, yani mal kabul ekranı çalışma anında
// alış siparişi modülüne BAĞLANMAZ (fabrika kurulumunda o dosyalar bundle'a
// girmesin). Şeklin tek kaynağı orada durur; ikinci bir kopya yazmak, backend
// sözleşmesi değiştiğinde ikisinin sessizce ayrışması demekti.
import type { ReceiptPurchaseOrderSync } from "../PurchaseOrders/receiptSync";
// C4 — tedarikçi iki tablodan gelebilir; XOR ve okuma önceliği TEK saf katmanda.
import type { SupplierRefLike } from "@/components/forms/supplierParty";

export interface GoodsReceiptListRow {
  id: string;
  receiptNo: string;
  status: "ACTIVE" | "CANCELLED";
  deliveryNoteNo: string | null;
  createdAt: string;
  cancelledAt: string | null;
  warehouse: { id: string; name: string } | null;
  supplier: SupplierRefLike | null;
  /** C4 — fason tedarikçi bacağı; `supplier` ile AYNI şekil. Liste tek
   *  "Tedarikçi" kolonunda DOLU olanı basar (`supplierDisplayName`). Eski
   *  backend alanı hiç göndermez → `undefined` ve kolon bugünküyle aynı. */
  subcontractorSupplier?: SupplierRefLike | null;
  /** C2 — "ham stok olarak alındı" (toplar `STOCK`, Ham Stok sekmesine düşer). */
  rawStockEntry?: boolean;
  /** `yarnMovements` Sınıf 5 ile geldi (2026-08-14) — eski backend'e karşı
   *  opsiyonel okunur (`?? 0`), yoksa liste kumaş sayacına düşer. */
  _count: { rolls: number; yarnMovements?: number };
}

export interface GoodsReceiptLineInput {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  width?: number | null;
  weightKg?: number | null;
  /** Kat — opsiyonel, katalogdan (backend kanonikleştirir). */
  foldType?: string | null;
  /** Satın alma birim fiyatı — fişin para biriminde (opsiyonel). */
  unitPrice?: number | null;
  propertyIds?: string[];
  clientToken?: string;
}

// ── SINIF 5 (2026-08-14): fişin satırları backend'de TEK assembler'dan gelir
// (`assembleReceiptLines` → `lines` union'ı). Panel iplik yüzeyini `lines`ten
// okur; `rolls` (kumaş tablosu) eski sözleşmesiyle AYNEN durur.

/** Assembler union'ının KUMAŞ satırı (backend `ReceiptFabricLine`). */
export interface ReceiptDetailFabricLine {
  kind: "FABRIC";
  id: string;
  barcode: string | null;
  status: string;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  colorName: string | null;
  qty: string | number;
  initialQty: string | number;
  purchasePrice: string | number | null;
}

/** Assembler union'ının İPLİK satırı (backend `ReceiptYarnLine`).
 *  `movementKind !== "IN"` = fiş iptalinin ters kaydı → soluk satır + "İptal"
 *  rozeti (defter "ne oldu"yu anlatır, satır gizlenmez). */
export interface ReceiptDetailYarnLine {
  kind: "YARN";
  id: string;
  movementKind: "IN" | "OUT" | "ADJUST_IN" | "ADJUST_OUT";
  itemId: string;
  itemName: string;
  itemCode: string | null;
  /** POZİTİF kg — yönü `movementKind` söyler. Decimal JSON'da string gelir. */
  qtyKg: string | number;
  unitPrice: string | number | null;
  reason: string | null;
  createdAt: string;
}

export type ReceiptDetailLine = ReceiptDetailFabricLine | ReceiptDetailYarnLine;

/**
 * Fişin bağlı olduğu ALIŞ SİPARİŞİNİN BAŞLIĞI — `GET /goods-receipts/:id`
 * yanıtında döner (backend `loadDetail` → `purchaseOrder` select'i).
 *
 * ⚠️⚠️ AYNI ANAHTAR, İKİ FARKLI ŞEKİL — karıştırma. Bu tip yalnız DETAY
 * (GET) yanıtındadır. CREATE (`POST /goods-receipts`) yanıtında aynı
 * `purchaseOrder` anahtarı SENKRON SONUCUNU taşır (`ReceiptPurchaseOrderSync`:
 * fazla kabul / siparişte olmayan ürün), çünkü backend `loadDetail`in başlığını
 * o alanda BİLEREK EZER (`goods-receipt.service.ts` create dönüşü). Bu yüzden
 * create yanıtı ayrı tiplenir (`GoodsReceiptCreateData`) — tek tiple modellemek,
 * "sipariş no" beklerken "overReceiptLines" okumak demekti.
 */
export interface ReceiptPurchaseOrderRef {
  id: string;
  orderNo: string;
  status: "OPEN" | "PARTIAL" | "CLOSED" | "CANCELLED";
  /** Siparişin para birimi — fişinkinden FARKLI olabilir (backend engellemez). */
  currency: "TRY" | "USD" | "EUR" | "GBP" | "RUB";
  expectedDate: string | null;
}

export interface GoodsReceiptDetail {
  id: string;
  receiptNo: string;
  status: "ACTIVE" | "CANCELLED";
  deliveryNoteNo: string | null;
  currency: "TRY" | "USD" | "EUR" | "GBP" | "RUB";
  notes: string | null;
  createdAt: string;
  warehouse: { id: string; code: string; name: string };
  supplier: SupplierRefLike | null;
  /** C4 — fason tedarikçi bacağı (liste ile AYNI şekil). */
  subcontractorSupplier?: SupplierRefLike | null;
  /** C2 — ham stok fişi: toplar `STOCK` doğar (satılabilir depo yerine). */
  rawStockEntry?: boolean;
  createdBy: { fullName: string | null; username: string } | null;
  rolls: Array<{
    id: string;
    barcode: string | null;
    status: string;
    currentQty: string | number;
    purchasePrice?: string | number | null;
    width: string | number | null;
    item: { id: string; name: string };
    color: { id: string; name: string } | null;
  }>;
  /** Union satırlar (önce kumaş, sonra iplik) — iplik yüzeyinin TEK kaynağı.
   *  Eski backend'de alan yoktur → `?? []` ile okunur. */
  lines?: ReceiptDetailLine[];
  /** İplik alanları Sınıf 5 ile geldi — eski backend'e karşı opsiyonel. */
  totals: { rollCount: number; totalQty: number; yarnLineCount?: number; totalYarnKg?: number };
  /** Atlanan satırlar — SEBEBİYLE döner (sessiz yutma yok). */
  failed?: Array<{ index: number; itemId: string; reason: string }>;
  /** Bağlı alış siparişinin başlığı — siparişsiz fişte `null`/yok (D3). */
  purchaseOrder?: ReceiptPurchaseOrderRef | null;
}

/**
 * CREATE yanıtının gövdesi — detayın AYNISI, tek farkı `purchaseOrder`.
 *
 * ⚠️ Orada o alan siparişin BAŞLIĞI değil, satırlar yazıldıktan SONRA koşan
 * karşılanma senkronunun SONUCUDUR ve yalnız bu yanıtta vardır: hiçbir yere
 * kaydedilmez, `GET` ile geri alınamaz. Yutulursa "fazla mal geldi" ve "bu ürün
 * siparişte yok" bilgileri KALICI OLARAK kaybolur (bkz. `receiptSync.ts`).
 */
export type GoodsReceiptCreateData = Omit<GoodsReceiptDetail, "purchaseOrder"> & {
  purchaseOrder?: ReceiptPurchaseOrderSync | null;
};

export async function listGoodsReceipts(params: { page: number; pageSize: number; search?: string }) {
  const res = await apiClient.get("/api/goods-receipts", {
    params: { page: params.page, pageSize: params.pageSize, ...(params.search ? { search: params.search } : {}) },
  });
  return res.data as { data: GoodsReceiptListRow[]; pagination: { total: number; totalPages: number } };
}

export async function getGoodsReceipt(id: string): Promise<GoodsReceiptDetail> {
  const res = await apiClient.get(`/api/goods-receipts/${id}`);
  return res.data.data as GoodsReceiptDetail;
}

export async function createGoodsReceipt(body: {
  warehouseId: string;
  supplierId?: string | null;
  /** C4 — fason firma tedarikçisi. `supplierId` ile BİRLİKTE gönderilemez
   *  (backend 400); XOR'u `supplierPartyPayload` kurar, çağıran elle yazmaz. */
  subcontractorId?: string | null;
  deliveryNoteNo?: string | null;
  currency?: "TRY" | "USD" | "EUR" | "GBP" | "RUB";
  notes?: string | null;
  clientToken?: string;
  /** Bu fişin karşıladığı ALIŞ SİPARİŞİ — yalnız ticaret rejiminde (D3). */
  purchaseOrderId?: string | null;
  /** C2 — "işlenecek mal": toplar `WAREHOUSE` yerine `STOCK` doğar. */
  rawStockEntry?: boolean;
  lines?: GoodsReceiptLineInput[];
}): Promise<{ data: GoodsReceiptCreateData; message?: string }> {
  // ⚠️ DEĞERİ OLMAYAN ALAN HİÇ GÖNDERİLMEZ — `purchaseOrderId: null` yazmak
  // teknik olarak da geçerli (Zod `.nullable()`) ama gövdeyi fabrikadaki
  // bugünkü isteğinden AYIRIR: "sıfır görünür fark" kuralı istek gövdesini de
  // kapsar. Ayıklama servis KATINDA yapılır, çağıranın hatırlamasına bırakılmaz
  // — ikinci bir çağıran (mobil/toplu içe aktarma) doğduğunda kural onunla
  // birlikte gelir. Bekçi: `service.test.ts`.
  //
  // ⚠️ `subcontractorId` ve `rawStockEntry` C4/C2 ile geldi ve AYNI kurala
  // uyar: fason bacağı boşken anahtar hiç yazılmaz, `rawStockEntry` yalnız
  // TRUE iken gider (varsayılan davranış = bugünkü davranış).
  const { purchaseOrderId, subcontractorId, rawStockEntry, ...rest } = body;
  const payload = {
    ...rest,
    ...(purchaseOrderId ? { purchaseOrderId } : {}),
    ...(subcontractorId ? { subcontractorId } : {}),
    ...(rawStockEntry ? { rawStockEntry: true } : {}),
  };
  const res = await apiClient.post("/api/goods-receipts", payload);
  return res.data;
}

export async function cancelGoodsReceipt(id: string, reason?: string) {
  const res = await apiClient.post(`/api/goods-receipts/${id}/cancel`, { reason });
  return res.data;
}

/**
 * Fişten alış faturası taslağı üretir (backend gruplar: ürün+renk+FİYAT).
 * ⚠️ Yol TAM — apiClient.baseURL "/api" içermez.
 */
export async function createInvoiceFromReceipt(receiptId: string) {
  const res = await apiClient.post(`/api/finance/invoices/from-goods-receipt/${receiptId}`);
  return res.data as { data: { id: string; docNo: string }; message?: string };
}
