import apiClient from "@/services/apiClient";
import { buildCursorQueryString } from "@/lib/query-builder";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";

// İade anında topa uygulanan raf (kalite override'ına göre).
export type ReturnAppliedStatus = "WAREHOUSE" | "A1_STOCK" | "SCRAP";

// Backend return.service.listReturns ile uyumlu satır şekli.
export interface ReturnRow {
  id: string;
  qty: number;
  width: number | null;
  reasonText: string | null;
  note: string | null;
  createdAt: string;
  roll: { id: string; barcode: string | null } | null;
  item: { id: string; code: string; name: string } | null;
  color: { id: string; code: string; name: string } | null;
  customer: { id: string; code: string; name: string } | null;
  order: { id: string; orderNumber: string; status: string } | null;
  reason: { id: string; code: string; name: string; color: string | null } | null;
  qualityGrade: { id: string; code: string; name: string; color: string | null } | null;
  appliedStatus: ReturnAppliedStatus | null;
  fromShipment: { id: string; shipmentNo: string } | null;
  receivedBy: { id: string; fullName: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: { id: string; fullName: string } | null;
  /** Çok kalemli iadenin grup anahtarı (lider id) — tekil iadede null. */
  returnGroupId: string | null;
  /**
   * İRSALİYENİN kaynağı (`returnGroupId ?? id`) — backend türetir. Belgeyi AÇARKEN
   * satırın kendi id'si DEĞİL bu kullanılır: çok kalemli iadede belge yalnız grup
   * liderine bağlıdır, üye id'siyle sorulunca "belge yok" görünürdü.
   *
   * ⚠️ İÇ FATURANIN kaynak bağı da BUDUR (`Invoice.returnGroupId`) — satırın kendi
   * id'si değil. Backend "bir iade grubu → tek aktif fatura" seddini bu değer
   * üzerinden kurar (`invoice.service.assertSourceFree`).
   */
  documentSourceId: string;
  /**
   * Bu iade GRUBUNDAN doğmuş, iptal edilmemiş iç faturanın belge numarası.
   *
   * ⚠️ BUGÜN HİÇBİR UÇ DOLDURMUYOR (dikiş bekliyor — sonuç JSON'una yazıldı):
   * `/api/returns` listesi `Invoice` tarafına bakmıyor ve fatura listesi
   * `returnGroupId` ile sorgulanamıyor (`LIST_SELECT` kolonu taşımıyor, filtre
   * de yok). Alan `undefined` kaldığı sürece "zaten faturalanmış" kolu
   * (`canDraftReturnInvoice`) uykudadır ve mükerrer faturayı backend'in 409'u
   * durdurur. Optional bırakıldı ki dikiş uygulanınca tek satır değişsin.
   */
  invoiceDocNo?: string | null;
}

// --- İade girişi (lookup → create) — backend return.service ile uyumlu ---
export interface ReturnLookupRoll {
  id: string;
  barcode: string | null;
  item: { id: string; code: string; name: string } | null;
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  currentQty: number;
  qualityGrade: string;
  qualityGradeRef: { id: string; code: string; name: string; color: string | null } | null;
}

export interface ReturnCandidateOrder {
  id: string;
  orderNumber: string;
  status: string;
  deadline: string | null;
}

export interface ReturnLookupResult {
  roll: ReturnLookupRoll;
  shipment: { id: string; shipmentNo: string; dispatchedAt: string | null } | null;
  customer: { id: string; code: string; name: string } | null;
  branch: { id: string; name: string } | null;
  candidateOrders: ReturnCandidateOrder[];
  returnGradingEnabled: boolean;
}

/** Çuval kodu okutunca dönen toplu iade bağlamı (backend lookupSackForReturn). */
export interface SackReturnLookupResult {
  sack: { id: string; sackNo: string };
  shipment: { id: string; shipmentNo: string; dispatchedAt: string | null };
  customer: { id: string; code: string; name: string } | null;
  branch: { id: string; name: string } | null;
  /** Çuvalda HÂLÂ sevk edilmiş (iade alınmamış) toplar. */
  rolls: ReturnLookupRoll[];
  /** Çuvaldaki TÜM toplara uyan siparişler (seçim tüm toplara uygulanır). */
  candidateOrders: ReturnCandidateOrder[];
  returnGradingEnabled: boolean;
}

/** Sevkiyat / sevk partisi kapsamı — sunucu `return-scope.helper` (sevkiyat başına grup). */
export interface ReturnScopeOrder {
  id: string;
  orderNumber: string;
  status: string;
  deadline: string | null;
  /** Bu siparişin satırına uyan top id'leri — aday küme istemcide seçime göre süzülür. */
  rollIds: string[];
}
export interface ReturnScopeSack {
  id: string;
  sackNo: string;
  packageNo: number | null;
  packingGroupName: string | null;
  rolls: ReturnLookupRoll[];
}
export interface ReturnScopeGroup {
  shipment: { id: string; shipmentNo: string; dispatchedAt: string | null };
  customer: { id: string; code: string; name: string } | null;
  branch: { id: string; name: string } | null;
  sacks: ReturnScopeSack[];
  orders: ReturnScopeOrder[];
}
export type ShipmentReturnLookupResult = ReturnScopeGroup & { returnGradingEnabled: boolean };
export interface LotReturnLookupResult {
  lot: { id: string; name: string };
  customer: { id: string; code: string; name: string } | null;
  groups: ReturnScopeGroup[];
  returnGradingEnabled: boolean;
}
export interface CreateReturnBatchPayload {
  groups: { rollIds: string[]; orderId?: string | null }[];
  reasonId?: string | null;
  reasonText?: string | null;
  note?: string | null;
  qualityGradeId?: string | null;
}
export interface CreateReturnBatchResult {
  done: { returnGroupId: string; rollCount: number; appliedStatus: string }[];
  failed: { index: number; message: string } | null;
  skipped: number;
  rollCount: number;
}

export interface CreateReturnPayload {
  /** Tekil iade. Çoklu iadede `rollIds` gönderilir — en az biri zorunlu. */
  rollId?: string;
  rollIds?: string[];
  orderId?: string | null;
  reasonId?: string | null;
  reasonText?: string | null;
  note?: string | null;
  qualityGradeId?: string | null;
}

export interface EditReturnPayload {
  reasonId?: string | null;
  reasonText?: string | null;
  note?: string | null;
}

export interface ReturnsSummary {
  count: number;
  totalQty: number;
}

// İlk sayfada (withTotal) backend `summary` döndürür (adet + toplam metraj).
export type ReturnsCursorResponse = CursorPaginatedResponse<ReturnRow> & {
  summary?: ReturnsSummary;
};

/** Liste ucu — servis nesnesinin DIŞINDA, çünkü `listGroupMembers` de onu çağırır
 *  ve nesnenin kendi ilkleyicisinden kendine referans vermek TS'te `any`'ye düşer. */
const fetchReturnsCursor = (params: CursorParams): Promise<ReturnsCursorResponse> =>
  apiClient
    .get<ReturnsCursorResponse>(`/api/returns${buildCursorQueryString(params)}`)
    .then((r) => r.data);

export const returnsService = {
  listCursor: fetchReturnsCursor,

  /** QR/barkod okut → top + sevkiyat + aday siparişler + returnGradingEnabled. */
  lookup: (barcode: string): Promise<ApiResponse<ReturnLookupResult>> =>
    apiClient
      .get<ApiResponse<ReturnLookupResult>>(`/api/returns/lookup?barcode=${encodeURIComponent(barcode)}`)
      .then((r) => r.data),

  /** Sevkiyatın tamamı — numara (SVK…) ya da id. */
  lookupShipment: (q: { shipmentNo?: string; shipmentId?: string }): Promise<ApiResponse<ShipmentReturnLookupResult>> => {
    const p = new URLSearchParams();
    if (q.shipmentNo) p.set("shipmentNo", q.shipmentNo);
    if (q.shipmentId) p.set("shipmentId", q.shipmentId);
    return apiClient.get<ApiResponse<ShipmentReturnLookupResult>>(`/api/returns/lookup-shipment?${p.toString()}`).then((r) => r.data);
  },
  /** Sevk partisinin sevk edilmiş çuvalları — sevkiyat başına gruplu. */
  lookupLot: (packingGroupId: string): Promise<ApiResponse<LotReturnLookupResult>> =>
    apiClient
      .get<ApiResponse<LotReturnLookupResult>>(`/api/returns/lookup-lot?packingGroupId=${encodeURIComponent(packingGroupId)}`)
      .then((r) => r.data),
  /** Toplu iade — grup = tek sevkiyat; sevkiyat başına bir belge. */
  createBatch: (body: CreateReturnBatchPayload): Promise<ApiResponse<CreateReturnBatchResult>> =>
    apiClient.post<ApiResponse<CreateReturnBatchResult>>(`/api/returns/batch`, body).then((r) => r.data),

  /** Çuval kodu okut → çuvalın sevk edilmiş topları (toplu iade girişi). */
  lookupSack: (sackCode: string): Promise<ApiResponse<SackReturnLookupResult>> =>
    apiClient
      .get<ApiResponse<SackReturnLookupResult>>(
        `/api/returns/lookup-sack?sackCode=${encodeURIComponent(sackCode)}`,
      )
      .then((r) => r.data),

  /** İade al → top iade rafına (WAREHOUSE/A1_STOCK/SCRAP), defter kaydı.
   *  Çoklu iadede tek belge doğar; `rollCount` yalnız o durumda döner. */
  create: (
    payload: CreateReturnPayload,
  ): Promise<
    ApiResponse<{
      id: string;
      rollId: string;
      appliedStatus: ReturnAppliedStatus;
      rollCount?: number;
    }>
  > =>
    apiClient
      .post<
        ApiResponse<{
          id: string;
          rollId: string;
          appliedStatus: ReturnAppliedStatus;
          rollCount?: number;
        }>
      >(`/api/returns`, payload)
      .then((r) => r.data),

  /** İade kaydını düzelt (neden + not) — top statüsü/sevkiyatı değişmez. */
  edit: (id: string, payload: EditReturnPayload): Promise<ApiResponse<{ id: string; rollId: string }>> =>
    apiClient
      .patch<ApiResponse<{ id: string; rollId: string }>>(`/api/returns/${id}`, payload)
      .then((r) => r.data),

  /** İadeyi iptal et (geri al) — sebep zorunlu (min 3); top sevkiyatına geri döner. */
  cancel: (id: string, reason: string): Promise<ApiResponse<{ id: string; rollId: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; rollId: string }>>(`/api/returns/${id}/cancel`, { reason })
      .then((r) => r.data),

  /**
   * Bir iade GRUBUNUN aktif kalemleri — satış-iade faturasının satır kaynağı.
   *
   * ⚠️ Yeni uç YOK ve gerekmiyor: `filter[returnGroupId]` diye bir süzgeç
   * olmadığı için grup, `fromShipmentId` üzerinden çekilip `documentSourceId`
   * ile daraltılır. Bu güvenli, çünkü backend **TEK SEVKİYAT KURALI**'nı
   * uyguluyor (`return.service.createReturn`: bir iade belgesi tek sevkiyata
   * aittir) — yani grubun TÜM kalemleri bu sorgunun kapsamındadır.
   *
   * ⚠️ Varsayılan kapsam AKTİF (backend `cancelledAt: null`) → iptal edilmiş
   * kalem faturaya girmez; iade irsaliyesinin kalem kümesiyle birebir.
   *
   * ⚠️ SAYFA SONU YUTULMAZ: `hasMore` bittiği yere kadar okunur; tavana
   * çarpılırsa HATA fırlatılır. Sessizce kısa kesmek, eksik satırlı bir fatura
   * taslağı doğururdu (kullanıcı farkı göremez — en kötü sonuç).
   */
  listGroupMembers: async (row: ReturnRow): Promise<ReturnRow[]> => {
    // Sevkiyat bağı yoksa grup kurulamaz (çoklu iade zaten sevkiyat gerektirir)
    // → satırın kendisi tek kalemdir.
    if (!row.fromShipment?.id) return [row];

    const PAGE = 200;
    const MAX_PAGES = 10;
    const all: ReturnRow[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const res: ReturnsCursorResponse = await fetchReturnsCursor({
        limit: PAGE,
        cursor,
        filters: { fromShipmentId: row.fromShipment.id },
      });
      all.push(...res.data);
      cursor = res.pagination.nextCursor;
      if (!res.pagination.hasMore || !cursor) {
        return all.filter((r) => r.documentSourceId === row.documentSourceId);
      }
    }
    throw new Error(
      "Bu sevkiyatın iade kayıtları tek seferde okunamadı — fatura taslağı eksik satırla açılmasın diye durduruldu.",
    );
  },

  /** Bir siparişe gelen (aktif) iade özeti — adet + metraj. Sipariş detayı satırı için. */
  summaryForOrder: (orderId: string): Promise<ReturnsSummary> =>
    apiClient
      .get<ReturnsCursorResponse>(`/api/returns?mode=cursor&withTotal=true&limit=1&orderId=${orderId}`)
      .then((r) => r.data.summary ?? { count: 0, totalQty: 0 }),
};
