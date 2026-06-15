import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { PrinterLanguage } from "./featureFlagService";

export type LabelNameSource = "OVERRIDE" | "MASTER" | "DEFAULT";

/** Native gönderim sonucu (printer-transport). */
export interface NativeSendResult {
  delivered: boolean;
  simulated: boolean;
  language: PrinterLanguage;
  bytes: number;
  target: string;
  error?: string;
  note: string;
}

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
}

function customerContextQuery(opts?: LabelCustomerContext): Record<string, string> {
  const params: Record<string, string> = {};
  if (opts?.customerId) params.customerId = opts.customerId;
  if (opts?.orderLineId) params.orderLineId = opts.orderLineId;
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
      })
      .then((r) => r.data),

  /** Saha #7: toplu etiket HTML'i — seçili topların hepsi tek belgede (her top kendi sayfası). */
  getBulkRollLabelsHtml: (rollIds: string[], copies?: number): Promise<string> =>
    apiClient
      .post<string>(
        `/api/labels/rolls/bulk-html`,
        { rollIds, ...(copies ? { copies } : {}) },
        { responseType: "text", transformResponse: [(d) => d] },
      )
      .then((r) => r.data),

  /** Test Et: format profili geometrisinde örnek etiket HTML'i (boyut/pay önizleme). */
  getFormatProfileSampleHtml: (profileId: string): Promise<string> =>
    apiClient
      .get<string>(`/api/labels/format-profiles/${profileId}/sample-html`, {
        responseType: "text",
        transformResponse: [(d) => d],
      })
      .then((r) => r.data),

  /** Test Et: örnek etiketi seçili dilde verilen yazıcıya gönder (nativeSendEnabled açıksa gerçek). */
  testNativeSend: (body: {
    profileId?: string;
    printerIp: string;
    port?: number;
    language?: PrinterLanguage;
  }): Promise<ApiResponse<NativeSendResult>> =>
    apiClient
      .post<ApiResponse<NativeSendResult>>(`/api/labels/test-native`, body)
      .then((r) => r.data),
};
