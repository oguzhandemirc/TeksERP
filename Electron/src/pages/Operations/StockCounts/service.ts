// =============================================================================
// TAM STOK SAYIMI — API İSTEMCİSİ
// =============================================================================
// Backend: `stock-count.service.ts` + `stock-count.routes.ts` (J2 #19).
// Üç adım, üç ayrı uç ve ADIMLARIN AYRI OLMASI ÖZELLİĞİN KENDİSİDİR:
//   • POST   /api/stock-counts                  → FOTOĞRAF (defterin o anki hâli)
//   • PATCH  /api/stock-counts/:id/lines/:lineId→ ÇALIŞMA KÂĞIDI (deftere yazmaz)
//   • POST   /api/stock-counts/:id/complete     → FARK FİŞİ + donmuş belge
//
// ⚠️ YOLLAR TAM YAZILIR ("/api/stock-counts/…") — `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır; çağıran hatayı yutarsa ekran "kayıt yok"
// gösterir (2026-08-12'de FilterBar lookup'larında tam bu yaşandı).
//
// ⚠️ MİKTARLAR Decimal'dir ve JSON'a **STRING** düşer ("140.5"). `number` diye
// tiplemek derlemede yakalanmaz ama çalışma anında `String.prototype
// .toLocaleString` devreye girip seçenekleri sessizce yok sayar. Bu yüzden
// tipler `DecimalLike`; ekrana giden her sayı `stockCountRules.qty()`'den geçer.
//
// ⚠️ İKİ Zod ŞEMASI DA `.strict()` — tanımadığı anahtarı 400 ile reddeder.
// "Ne olur ne olmaz" diye `clientToken` eklemek kaydı sessizce değil, GÜRÜLTÜLÜ
// ama YANLIŞ sebeple düşürür (kullanıcı "depo hatalı" sanır). Mükerrer koruması
// bu uçlarda yok ve gerekmiyor: aynı depoda İKİNCİ AÇIK SAYIM backend'de 409'dur
// (`create` içindeki tek-açık-sayım kilidi), yani çift tık ikinci sayım doğurmaz.
// =============================================================================
import apiClient from "@/services/apiClient";

/** Decimal kolonun JSON karşılığı — number DA string DE gelebilir. */
export type DecimalLike = number | string;

export type StockCountStatus = "DRAFT" | "COMPLETED" | "CANCELLED";
export type StockCountLineKind = "ROLL" | "YARN";

export interface StockCountListRow {
  id: string;
  countNo: string;
  status: StockCountStatus;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Storno damgası — dolu ise fark fişi geri alınmıştır (statü COMPLETED kalır). */
  reversedAt: string | null;
  warehouse: { id: string; code: string; name: string };
  /** Satır sayısı — top + iplik TOPLAMI (kırılım detaydadır). */
  _count: { lines: number };
}

/**
 * Sayım satırı. `kind` ayırıcıdır: ROLL satırında `roll` dolu, YARN satırında
 * `item` dolu gelir (backend `findById` select'i).
 *
 * ⚠️ `found` ÜÇ DURUMLUDUR ve `null` "bulunamadı" DEĞİL "HENÜZ SAYILMADI"
 * demektir. İkisini karıştıran bir ekran, tamamlamada deponun sayılmamış
 * kısmını "eksik" diye gösterir — bu özelliğin yapabileceği en yıkıcı hata.
 */
export interface StockCountLine {
  id: string;
  kind: StockCountLineKind;
  /** Fotoğraf anındaki değer: ROLL'da metre, YARN'da kg. */
  expectedQty: DecimalLike;
  /** YARN'da farkın kaynağı; ROLL'da yalnız BİLGİ NOTU (metraj düzeltmesi ayrı akış). */
  countedQty: DecimalLike | null;
  found: boolean | null;
  notes: string | null;
  /**
   * Tamamlamada bu satırın neden İŞLENMEDİĞİ (backend yazar). DRAFT satırda
   * her zaman `null`'dur — tamamlanmış sayımda dolu olabilir.
   */
  outOfScopeReason: string | null;
  roll: {
    id: string;
    barcode: string | null;
    /** CANLI statü (fotoğrafın değil) — kapsam dışı adaylarını bundan türetiyoruz. */
    status: string;
    width: DecimalLike | null;
    item: { name: string } | null;
    color: { name: string } | null;
  } | null;
  item: { id: string; code: string | null; name: string } | null;
}

export interface StockCountDetail {
  id: string;
  countNo: string;
  status: StockCountStatus;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
  warehouse: { id: string; code: string; name: string };
  lines: StockCountLine[];
}

/** Storno önizlemesi — backend `stock-count-reversal.service` planının aynası. */
export interface StockCountReversalPlan {
  countId: string;
  countNo: string;
  warehouseId: string;
  blockers: string[];
  rolls: Array<{
    rollId: string;
    barcode: string | null;
    qty: DecimalLike;
    targetStatus: string | null;
    blocker: string | null;
  }>;
  yarn: Array<{
    itemId: string;
    itemName: string;
    countNetKg: DecimalLike;
    reversalKind: "ADJUST_IN" | "ADJUST_OUT";
    balanceKg: DecimalLike;
    balanceAfterKg: DecimalLike;
  }>;
}

export interface StockCountCreated {
  id: string;
  countNo: string;
  rollLines: number;
  yarnLines: number;
}

export interface StockCountCompleted {
  id: string;
  countNo: string;
  cancelledRolls: number;
  cancelledMeters: number;
  yarnAdjustments: number;
  outOfScope: number;
}

export interface StockCountListParams {
  page?: number;
  pageSize?: number;
  warehouseId?: string;
  status?: StockCountStatus;
  /** Mutlak an (ISO) — gün sınırını İSTEMCİ kurar (`stockCountRules`). */
  from?: string;
  to?: string;
  search?: string;
}

export async function listStockCounts(params: StockCountListParams) {
  const res = await apiClient.get("/api/stock-counts", { params });
  return res.data as {
    data: StockCountListRow[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  };
}

export async function getStockCount(id: string): Promise<StockCountDetail> {
  const res = await apiClient.get(`/api/stock-counts/${id}`);
  return res.data.data as StockCountDetail;
}

export async function createStockCount(body: { warehouseId: string; notes?: string | null }) {
  const res = await apiClient.post("/api/stock-counts", body);
  return res.data as { data: StockCountCreated; message?: string };
}

/**
 * Tek satırı işaretler.
 *
 * ⚠️ Alanlar OPSİYONEL ve `undefined` "DOKUNMA" demektir; `null` ise TEMİZLE
 * (found: null → "henüz sayılmadı"e geri döner). Üçlü sözleşmeyi ikiliye
 * indirmek — ör. `found: found ?? false` — yanlışlıkla işaretlenen bir satırın
 * geri alınmasını imkânsız yapar ve topu kayıttan düşürürdü.
 */
export async function markStockCountLine(
  countId: string,
  lineId: string,
  patch: { found?: boolean | null; countedQty?: string | null; notes?: string | null },
) {
  const res = await apiClient.patch(`/api/stock-counts/${countId}/lines/${lineId}`, patch);
  return res.data as { data: { id: string }; message?: string };
}

/** Sayılmamış TÜM top satırlarını "bulundu" yapar (yalnız bu yönde çalışır). */
export async function markAllFound(countId: string) {
  const res = await apiClient.post(`/api/stock-counts/${countId}/mark-all-found`, {});
  return res.data as { data: { updated: number }; message?: string };
}

/** FARK FİŞİ. Geri alma yolu tek belgede stornodur (`reverseStockCount`). */
export async function completeStockCount(countId: string) {
  const res = await apiClient.post(`/api/stock-counts/${countId}/complete`, {});
  return res.data as { data: StockCountCompleted; message?: string };
}

/** Storno önizlemesi — dönecek her top, geri alınacak her iplik farkı, engeller. */
export async function getStockCountReversePreview(countId: string): Promise<StockCountReversalPlan> {
  const res = await apiClient.get(`/api/stock-counts/${countId}/reverse-preview`);
  return res.data.data as StockCountReversalPlan;
}

/** Tamamlanmış sayımın fark fişini ters kayıtla geri alır (gerekçe zorunlu, ≥3). */
export async function reverseStockCount(countId: string, reason: string) {
  const res = await apiClient.post(`/api/stock-counts/${countId}/reverse`, { reason });
  return res.data as {
    data: { id: string; countNo: string; restoredRolls: number; yarnReversals: number };
    message?: string;
  };
}

/** Taslak sayımı iptal eder (satırlar durur, belge doğmamıştır). */
export async function cancelStockCount(countId: string, reason?: string) {
  const res = await apiClient.post(`/api/stock-counts/${countId}/cancel`, { reason });
  return res.data as { data: { id: string; countNo: string }; message?: string };
}
