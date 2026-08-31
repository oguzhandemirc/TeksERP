// =============================================================================
// ALIŞ SİPARİŞİ API İSTEMCİSİ — "ne ısmarladım, ne geldi"
// =============================================================================
// NEDEN VAR: mal kabul fişi "ne GELDİ" der; "ne ısmarlamıştım, kalan ne"
// sorusunun panelde hiçbir cevabı yoktu ve satın almacı bunu Excel'de tutuyordu.
// Excel'de tutulan taahhüt, tedarikçi eksik gönderdiğinde SESSİZCE kaybolur.
//
// ⚠️ YOLLAR TAM YAZILIR ("/api/purchase-orders…") — `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır; çağıran hatayı yutarsa ekran "kayıt yok"
// gösterir ve satın almacı siparişin sistemde olmadığı sonucuna varır
// (2026-08-12 FilterBar lookup vakasının aynısı).
//
// ⚠️ MİKTARLAR `Decimal`DİR ve JSON'a **STRING** düşer ("500", "12.5"). Bu
// dosyadaki arayüzler onları `DecimalLike` diye tipler ve ekrana giden her sayı
// `toNum()` süzgecinden geçer. Doğrudan `.toLocaleString(...)` çağırmak hata
// VERMEZ, seçenekleri SESSİZCE yok sayar ("1234.5" → "1234.5") — binlik ayraç
// kaybolur ve rakam doğru olduğu için kusur en geç fark edilen türden olur
// (`Finance/service.money()` aynı dersin tutar tarafı).
//
// ⚠️ `status` TÜRETİLİR (OPEN/PARTIAL/CLOSED); kullanıcı elle işaretlemez ve bu
// dosyada durumu DOĞRUDAN yazan hiçbir uç YOKTUR. İki istisna kendi adlarıyla
// ayrı uçlardır: `CANCELLED` (`cancel` — "hiç olmadı") ve SHORT-CLOSE
// (`shortClose` — "kalanı gelmeyecek, olan KALIR"; `shortClosedAt` bayrağı
// doluyken backend senkronu durumu CLOSED bırakır, EZMEZ).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ItemType } from "@/types/enums";
// C4 — tedarikçi iki tablodan gelebilir; XOR ve okuma önceliği TEK saf katmanda.
import type { SupplierRefLike } from "@/components/forms/supplierParty";

/** Backend `Currency` enum'unun aynası (Electron backend'i import edemez). */
export type PoCurrency = "TRY" | "USD" | "EUR" | "GBP" | "RUB";

/** Backend `PurchaseOrderStatus` enum'unun aynası. */
export type PurchaseOrderStatus = "OPEN" | "PARTIAL" | "CLOSED" | "CANCELLED";

/** Decimal kolonun JSON karşılığı — number DA string DE gelebilir (dosya başlığı). */
export type DecimalLike = number | string;

/** Ekrana giden tek dönüşüm noktası. Geçersiz değerde 0 — `NaN` basmaktansa. */
export function toNum(value: DecimalLike | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Miktar biçimlendirici — birim İSTEĞE BAĞLI ama neredeyse her yerde verilir.
 *
 * ⚠️ Kuruş SABİTLENMEZ (`money()`den farkı burada): 500 metre "500,00 m" diye
 * basılırsa depo ekranında tutar sanılır. En fazla 2 hane, gereksiz sıfır yok.
 */
export function fmtQty(value: DecimalLike | null | undefined, unit?: string | null): string {
  const n = toNum(value);
  const text = n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  return unit ? `${text} ${unit.toLocaleLowerCase("tr")}` : text;
}

export interface SupplierRef {
  id: string;
  code: string;
  name: string;
}

/**
 * C4 — İKİ TEDARİKÇİ BACAĞI, tam biri dolu.
 *
 * ⚠️ Panel bu ikisini ASLA elle okumaz; `supplierDisplayName`/`supplierPartyOf`
 * kullanır. Elle okuyan her yüzey kendi önceliğini kurar ve aynı sipariş listede
 * bir, detayda başka bir tedarikçi basar.
 */
export interface SupplierParties {
  supplier: SupplierRefLike | null;
  /** Eski backend alanı hiç göndermez → `undefined` (görünüm bugünküyle aynı). */
  subcontractorSupplier?: SupplierRefLike | null;
}

export interface ItemRef {
  id: string;
  code: string;
  name: string;
  unit: string;
  itemType: ItemType;
}

export interface PurchaseOrderListRow extends SupplierParties {
  id: string;
  orderNo: string;
  status: PurchaseOrderStatus;
  currency: PoCurrency;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  cancelledAt: string | null;
  /** Dolu ise CLOSED "kalanı gelmeyecek" kararıdır, "tüm kalemler geldi" değil. */
  shortClosedAt: string | null;
  createdAt: string;
  _count: { lines: number; goodsReceipts: number };
}


export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  itemId: string;
  qty: DecimalLike;
  /** DENORMALİZE rollup — tek yazarı backend'in senkronudur. */
  receivedQty: DecimalLike;
  unitPrice: DecimalLike | null;
  notes: string | null;
  item: ItemRef;
  /** Backend'in 0'a KIRPILMIŞ kalanı — fazlalık buradan OKUNAMAZ (bkz. fulfillment.ts). */
  remainingQty: DecimalLike;
  /** Sipariş edilenden fazla geldi. Bir HATA değil, bir OLGU. */
  over: boolean;
  /** Kaynaktan o an hesaplanan karşılanma (saklanan değerle karşılaştırılır). */
  liveReceivedQty: DecimalLike;
  /** Saklanan ≠ canlı → rakam bayat; ekran bunu SÖYLER, gizlemez. */
  drift: boolean;
}

export interface PurchaseOrderReceiptRef {
  id: string;
  receiptNo: string;
  status: "ACTIVE" | "CANCELLED";
  deliveryNoteNo: string | null;
  createdAt: string;
}

export interface PurchaseOrderDetail extends SupplierParties {
  id: string;
  orderNo: string;
  status: PurchaseOrderStatus;
  currency: PoCurrency;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /**
   * SHORT-CLOSE ("kalanı kapat"): dolu ise kalan miktarlar GELMEYECEK kararıyla
   * kapatılmış demektir. İPTAL DEĞİLDİR — gelen malın kaydı ve karşılanması
   * durur; yalnız beklenti kapanır. Geri alma `reopenShortClosePurchaseOrder`.
   */
  shortClosedAt: string | null;
  shortCloseReason: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string | null; username: string } | null;
  cancelledBy: { id: string; fullName: string | null; username: string } | null;
  shortClosedBy: { id: string; fullName: string | null; username: string } | null;
  lines: PurchaseOrderLine[];
  goodsReceipts: PurchaseOrderReceiptRef[];
  /**
   * Fişlerde gelen ama SİPARİŞTE HİÇ OLMAYAN ürünler (id listesi).
   *
   * ⚠️ En olası sebep: depocu açılır listeden YANLIŞ siparişi seçmiştir. Mal
   * depoya girdi (kayıt doğru), yanlış olan yalnız BAĞ. Bu yüzden ekranda
   * söylenir — sessizce düşürmek karşılanma rakamını sebebi yazılmadan eksik
   * bırakırdı.
   */
  unmatchedItemIds: string[];
  totals: {
    lineCount: number;
    totalQty: DecimalLike;
    totalReceived: DecimalLike;
    openLineCount: number;
    overReceiptLineCount: number;
    driftLineCount: number;
    unmatchedItemCount: number;
  };
}

/** "Ne ısmarladım ne geldi" satırı — KALEM merkezli (sipariş merkezli değil). */
export interface OpenLineRow {
  id: string;
  lineNo: number;
  qty: DecimalLike;
  receivedQty: DecimalLike;
  unitPrice: DecimalLike | null;
  notes: string | null;
  item: ItemRef;
  /** Bu uçta kırpma YOK — süzgeç zaten `receivedQty < qty` (daima > 0). */
  remainingQty: DecimalLike;
  /** Beklenen tarih GEÇMİŞ. Tarihi olmayan kalem gecikmiş SAYILMAZ. */
  overdue: boolean;
  purchaseOrder: {
    id: string;
    orderNo: string;
    status: PurchaseOrderStatus;
    currency: PoCurrency;
    orderDate: string;
    expectedDate: string | null;
  } & SupplierParties;
}

export interface PurchaseOrderLineInput {
  itemId: string;
  qty: number;
  unitPrice?: number | null;
  notes?: string | null;
}

type Paged<T> = {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

/** Yazma uçlarının ortak yanıtı — `message` BACKEND'İN cümlesidir, ezme. */
type MutationResult = { data?: PurchaseOrderDetail; message?: string };

// -----------------------------------------------------------------------------
// OKUMA
// -----------------------------------------------------------------------------

/**
 * Sipariş listesi.
 *
 * ⚠️ SÜZME SUNUCUDA: liste sayfalıdır, istemcide süzmek yalnız O ANKİ SAYFAYI
 * süzer ve satın almacı "sipariş yok" sanar — oysa kayıt sonraki sayfadadır.
 *
 * ⚠️ Filtre anahtarları `filter[...]` biçimindedir (backend `parseQueryParams`);
 * düz `supplierId` göndermek sessizce YOK SAYILIR ve liste süzülmemiş döner —
 * boş liste değil, YANLIŞ liste.
 */
export async function listPurchaseOrders(params: {
  page: number;
  pageSize: number;
  search?: string;
  supplierId?: string;
  /** C4 — fason tedarikçi bacağı. `supplierId` ile BİRLİKTE gönderilmez;
   *  çağıran `supplierPartyQuery` ile tek anahtar üretir. */
  subcontractorId?: string;
  /** Tek durum ya da CSV ("OPEN,PARTIAL") — backend virgülle böler. */
  status?: string;
  /** Sipariş tarihi aralığı (mutlak an; gün sınırı İSTEMCİNİNDİR). */
  dateFrom?: string;
  dateTo?: string;
}): Promise<Paged<PurchaseOrderListRow>> {
  const res = await apiClient.get("/api/purchase-orders", {
    params: {
      page: params.page,
      pageSize: params.pageSize,
      ...(params.search ? { search: params.search } : {}),
      ...(params.supplierId ? { "filter[supplierId]": params.supplierId } : {}),
      ...(params.subcontractorId ? { "filter[subcontractorId]": params.subcontractorId } : {}),
      ...(params.status ? { "filter[status]": params.status } : {}),
      ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
      ...(params.dateTo ? { dateTo: params.dateTo } : {}),
    },
  });
  return res.data as Paged<PurchaseOrderListRow>;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  const res = await apiClient.get(`/api/purchase-orders/${id}`);
  return (res.data as { data: PurchaseOrderDetail }).data;
}

/**
 * ⭐ "Ne ısmarladım, ne geldi" — karşılanmamış kalemler.
 *
 * Yalnız `OPEN`/`PARTIAL` siparişler; sıralama beklenen tarihe göre (tarihsiz
 * kalemler sona). `meta.total` sunucudaki TOPLAM sayıdır — kırpma varsa ekran
 * bunu yazar.
 */
export async function listOpenLines(params: {
  supplierId?: string;
  /** C4 — fason tedarikçi bacağı (uç DÜZ query param bekler, `filter[...]` DEĞİL). */
  subcontractorId?: string;
  itemId?: string;
  overdueOnly?: boolean;
  limit?: number;
}): Promise<{ rows: OpenLineRow[]; total: number }> {
  const res = await apiClient.get("/api/purchase-orders/open-lines", {
    params: {
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.subcontractorId ? { subcontractorId: params.subcontractorId } : {}),
      ...(params.itemId ? { itemId: params.itemId } : {}),
      // Backend `"true"`/`"false"` literal'i bekliyor; `false` göndermek gereksiz
      // ama zararsız — yine de yalnız açıkken gönderiyoruz ki istek sade kalsın.
      ...(params.overdueOnly ? { overdueOnly: "true" } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  });
  const body = res.data as { data: OpenLineRow[]; meta: { total: number } };
  return { rows: body.data, total: body.meta?.total ?? body.data.length };
}

// -----------------------------------------------------------------------------
// YAZMA
// -----------------------------------------------------------------------------

/**
 * Sipariş açar.
 *
 * ⚠️ `clientToken` FORM OTURUMU BAŞINA BİR KEZ üretilir, `mutate()` başına
 * DEĞİL. Zaman aşımı "yazılmadı" DEMEK DEĞİLDİR: sunucu commit etmiş, yanıt
 * kaybolmuş olabilir. Her basışta yeni token üretmek İKİNCİ bir sipariş açar,
 * ikinci bir belge numarası harcar ve satın almacı aynı malı iki kez ısmarladığını
 * sanır. Aynı token ise backend'in `@unique` tuzağına takılır ve İLK siparişi
 * geri döner (`ChequeFormDialog` emsali).
 */
export async function createPurchaseOrder(body: {
  /** C4 — İKİSİNDEN TAM BİRİ dolu (backend: "Tedarikçi zorunlu — müşteri-tipli
   *  cari ya da fason firma seçin."). XOR'u `supplierPartyPayload` kurar. */
  supplierId: string | null;
  subcontractorId: string | null;
  currency?: PoCurrency;
  orderDate?: string;
  expectedDate?: string | null;
  notes?: string | null;
  clientToken?: string;
  lines: PurchaseOrderLineInput[];
}): Promise<MutationResult> {
  const res = await apiClient.post("/api/purchase-orders", body);
  return res.data as MutationResult;
}

/**
 * Siparişi düzenler — backend YALNIZ `OPEN` siparişte kabul eder.
 *
 * ⚠️ `lines` VERİLİRSE kalemler TAMAMEN değiştirilir; VERİLMEZSE kalemlere
 * DOKUNULMAZ. `undefined` ile `[]` arasındaki fark burada tüm kalemleri silmek
 * ile hiçbir şey yapmamak arasındaki farktır — `[]` göndermek backend Zod'unda
 * `min(1)`e takılır (400), yani kaza eseri "hepsini sil" mümkün değil.
 */
export async function updatePurchaseOrder(
  id: string,
  body: {
    /** ⚠️ TARAF BÜTÜNDÜR (C4): anahtarlardan biri gönderilirse İKİ kolon
     *  birlikte yazılır (diğeri NULL'lanır). Yalnız değişen kolonu göndermek
     *  "iki tedarikçili sipariş" üretir ve servis kapısını sessizce deler —
     *  bu yüzden `supplierPartyPayload` ikisini birden döndürür. */
    supplierId?: string | null;
    subcontractorId?: string | null;
    currency?: PoCurrency;
    orderDate?: string;
    expectedDate?: string | null;
    notes?: string | null;
    lines?: PurchaseOrderLineInput[];
  },
): Promise<MutationResult> {
  const res = await apiClient.patch(`/api/purchase-orders/${id}`, body);
  return res.data as MutationResult;
}

/**
 * Siparişi iptal eder.
 *
 * ⚠️ Backend, siparişe bağlı AKTİF mal kabul fişi varsa 409 verir ve hangi
 * fişler olduğunu SÖYLER. O mesaj yol göstericidir ("önce fişleri iptal edin") —
 * interceptor onu olduğu gibi basar, biz üstüne yazmayız.
 */
export async function cancelPurchaseOrder(id: string, reason?: string): Promise<MutationResult> {
  const res = await apiClient.post(`/api/purchase-orders/${id}/cancel`, { reason });
  return res.data as MutationResult;
}

/**
 * SHORT-CLOSE — "kalanı gelmeyecek, olan KALIR". İptalden farkı: iptal kabul
 * görmüş siparişte REDDEDİLİR ve taahhüdü yok sayar; short-close gelen malın
 * kaydını korur, yalnız kalan beklentiyi kapatır. Sebep ZORUNLU (min 3) —
 * "kalan neden gelmeyecek" tedarikçi değerlendirmesinin verisidir.
 * Zaten kapatılmışsa backend idempotent başarı döner (409 fırtınası yok).
 */
export async function shortClosePurchaseOrder(id: string, reason: string): Promise<MutationResult> {
  const res = await apiClient.post(`/api/purchase-orders/${id}/short-close`, { reason });
  return res.data as MutationResult;
}

/** Kapatmayı geri alır — bayrak temizlenir, durum backend'de kaynaktan yeniden türetilir. */
export async function reopenShortClosePurchaseOrder(id: string): Promise<MutationResult> {
  const res = await apiClient.post(`/api/purchase-orders/${id}/reopen-short-close`);
  return res.data as MutationResult;
}

/**
 * Karşılanmayı kaynaktan yeniden hesaplatır (drift bandındaki "Tazele").
 * POST çünkü YAZAR (rollup + durum); idempotent — mesaj değişip değişmediğini
 * söyler ve BACKEND'İN cümlesidir, ezme.
 */
export async function resyncPurchaseOrder(id: string): Promise<MutationResult> {
  const res = await apiClient.post(`/api/purchase-orders/${id}/resync`);
  return res.data as MutationResult;
}
