import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { PrinterLanguage } from "./featureFlagService";

export type LabelNameSource = "OVERRIDE" | "MASTER" | "DEFAULT";

export interface RollLabelPayload {
  rollId: string;
  barcode: string | null;
  status: string;
  qualityGrade: string;
  widthCm: number | null;
  lengthMeters: number;
  weightKg: number | null;
  packagingDate: string | null;
  /** Tambur'da kartela için işaretlendi mi — etikette mor "Kartelalık" damgası. */
  markedForKartela?: boolean;

  itemCode: string;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: LabelNameSource;

  colorCode: string | null;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: LabelNameSource | null;

  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;

  batchNumber: string | null;
  printedAt: string | null;
}

export interface OrderLineOverridePayload {
  customerItemName?: string | null;
  customerColorName?: string | null;
}

/**
 * Etiketi belirli bir müşteri/sipariş bağlamında render/bas — Yeniden-Etiketleme
 * istasyonu "B müşterisi için yeniden bas" akışı. Boş bırakılırsa (varsayılan)
 * backend `lastLabelSnapshot`'a düşer = mevcut davranış (geriye uyumlu).
 */
export interface LabelCustomerContext {
  customerId?: string | null;
  orderLineId?: string | null;
  /** Müşterisiz (stok) baskı — backend müşteriyi ZORLA null bırakır (snapshot/WO
   *  bağlamı ATLANIR, müşterisiz spec-only etiket çıkar). */
  stock?: boolean;
}

function customerContextQuery(opts?: LabelCustomerContext): Record<string, string> {
  const params: Record<string, string> = {};
  if (opts?.customerId) params.customerId = opts.customerId;
  if (opts?.orderLineId) params.orderLineId = opts.orderLineId;
  if (opts?.stock) params.stock = "1";
  return params;
}

export const labelService = {
  getRollLabel: (rollId: string): Promise<ApiResponse<RollLabelPayload>> =>
    apiClient
      .get<ApiResponse<RollLabelPayload>>(`/api/labels/rolls/${rollId}`)
      .then((r) => r.data),

  /**
   * Etiketin tam HTML'i — backend `LabelTemplate` config'ine göre render edilir,
   * mobil basım ve LabelTemplates önizlemesi ile birebir aynı çıktı. `opts` ile
   * belirli müşteri/sipariş bağlamı geçilebilir (relabel "B için bas" önizlemesi).
   */
  getRollLabelHtml: (rollId: string, opts?: LabelCustomerContext): Promise<string> =>
    apiClient
      .get<string>(`/api/labels/rolls/${rollId}/html`, {
        params: customerContextQuery(opts),
        responseType: "text",
        transformResponse: [(d) => d],
      })
      .then((r) => r.data),

  /**
   * WYSIWYG önizleme — gerçek topu AKTİF DİLDE. Native dil → svg (baskıyla birebir);
   * HTML dili → html; çizilemeyen native → text (ham komut). Baskı diyalogları iframe'ler.
   */
  getRollPreview: (
    rollId: string,
    opts?: LabelCustomerContext,
    peripheralId?: string,
  ): Promise<{ mode: "svg" | "html" | "text"; language: string; content: string; kind: string }> =>
    apiClient
      .get<ApiResponse<{ mode: "svg" | "html" | "text"; language: string; content: string; kind: string }>>(
        `/api/labels/rolls/${rollId}/preview`,
        // peripheralId: Cihaz Kaydı yönlendirmesi — dil bu cihazın languageOverride'ından
        // çözülür (getRollNative ile aynı) → önizleme baskıyla birebir. Yoksa RASTER_HTML.
        { params: { ...customerContextQuery(opts), ...(peripheralId ? { peripheralId } : {}) } },
      )
      .then((r) => r.data.data),

  updateOrderLineOverride: (
    orderLineId: string,
    body: OrderLineOverridePayload,
  ): Promise<ApiResponse<{ orderLineId: string }>> =>
    apiClient
      .patch<ApiResponse<{ orderLineId: string }>>(
        `/api/labels/order-lines/${orderLineId}`,
        body,
      )
      .then((r) => r.data),

  printRollLabel: (
    rollId: string,
    opts?: LabelCustomerContext,
  ): Promise<ApiResponse<{ rollId: string }>> =>
    apiClient
      .post<ApiResponse<{ rollId: string }>>(`/api/labels/rolls/${rollId}/print`, {
        ...(opts?.customerId ? { customerId: opts.customerId } : {}),
        ...(opts?.orderLineId ? { orderLineId: opts.orderLineId } : {}),
        ...(opts?.stock ? { stock: true } : {}),
      })
      .then((r) => r.data),

  /**
   * Rolün SEÇİLİ yazıcı dilinde native komutu (PPLA/PPLB/ZPL) — diyalogsuz seri/COM
   * baskı için. text/plain gövde + dil `X-Label-Language` header'ında. RASTER_HTML
   * dönerse yazıcı native değildir (ham gönderilemez). `opts` ile müşteri bağlamı.
   */
  getRollNative: (
    rollId: string,
    opts?: LabelCustomerContext,
    peripheralId?: string,
  ): Promise<{ content: string; language: PrinterLanguage }> =>
    apiClient
      .get<string>(`/api/labels/rolls/${rollId}/native`, {
        // peripheralId: Cihaz Kaydı yönlendirmesi — dil/şablon global yerine bu cihazdan.
        params: { ...customerContextQuery(opts), ...(peripheralId ? { peripheralId } : {}) },
        responseType: "text",
        transformResponse: [(d) => d],
      })
      .then((r) => ({
        content: String(r.data ?? ""),
        language: String(r.headers["x-label-language"] ?? "") as PrinterLanguage,
      })),

  /** Toplu native (PPLA) tek-job — N farklı top tek seri/COM gönderiminde (diyalogsuz). */
  getBulkRollLabelsNative: (
    rollIds: string[],
    copies?: number,
    peripheralId?: string,
  ): Promise<{ content: string; language: PrinterLanguage }> =>
    apiClient
      .post<string>(
        `/api/labels/rolls/bulk-native`,
        { rollIds, ...(copies ? { copies } : {}), ...(peripheralId ? { peripheralId } : {}) },
        { responseType: "text", transformResponse: [(d) => d] },
      )
      .then((r) => ({
        content: String(r.data ?? ""),
        language: String(r.headers["x-label-language"] ?? "") as PrinterLanguage,
      })),

  /** Saha #7: toplu etiket HTML'i — seçili topların hepsi tek belgede (her top kendi sayfası). */
  getBulkRollLabelsHtml: (rollIds: string[], copies?: number): Promise<string> =>
    apiClient
      .post<string>(
        `/api/labels/rolls/bulk-html`,
        { rollIds, ...(copies ? { copies } : {}) },
        { responseType: "text", transformResponse: [(d) => d] },
      )
      .then((r) => r.data),
};
