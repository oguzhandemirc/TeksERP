import { createCrudService } from "@/services/crudService";
import { buildCursorQueryString } from "@/lib/query-builder";
import apiClient from "@/services/apiClient";
import type { ApiResponse, CursorParams } from "@/types/api";
import type {
  AccountingExportData,
  DispatchCursorResponse,
  DispatchListItem,
  DispatchReport,
} from "./types";

// Liste backend listShipments cursor'unu kullanır (status=DISPATCHED forceFilter).
const base = createCrudService<DispatchListItem>("/api/shipping/shipments");

export const accountingDispatchService = {
  ...base,
  /**
   * Muhasebe listesi — jenerik `listCursor` + `withSummary=true`.
   * Dönem bandı (kaç sevk / kaç metre / kaç kg) filtreli KÜMENİN TAMAMI için gelir.
   * Bayrak yalnız BU ekrandan gönderilir: operasyon Sevkiyatlar ekranı ek aggregate
   * maliyeti ödemesin (backend bayrak yoksa özet sorgusunu hiç koşmaz).
   */
  listCursor: (params: CursorParams): Promise<DispatchCursorResponse> =>
    apiClient
      .get<DispatchCursorResponse>(
        `/api/shipping/shipments${buildCursorQueryString(params)}&withSummary=true`,
      )
      .then((r) => r.data),

  /** Fatura işareti — `invoiceNo: null` işareti kaldırır. DIRECT satır kendi ucuna gider. */
  setInvoice: (
    row: Pick<DispatchListItem, "id" | "kind">,
    body: { invoiceNo: string | null; invoicedAt?: string | null },
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(
        row.kind === "DIRECT"
          ? `/api/shipping/direct-shipments/${row.id}/invoice`
          : `/api/shipping/shipments/${row.id}/invoice`,
        body,
      )
      .then((r) => r.data),
  /** Saha #2: 3 bölümlü sevk fişi (kumaş/çuval/çeki) — fiş açılınca lazy. */
  getReport: (id: string): Promise<ApiResponse<DispatchReport>> =>
    apiClient
      .get<ApiResponse<DispatchReport>>(`/api/shipping/shipments/${id}/dispatch-report`)
      .then((r) => r.data),

  /**
   * Fasondan doğrudan sevk (DirectShipment) fişi — çuval sevkiyatı getReport'u ile AYNI
   * DispatchReport şeklini döner (çuval yok → Çuval sayfası boş; Kumaş/Çeki dolu). Muhasebe
   * listesinde `kind === "DIRECT"` satırlar bu uca gider.
   */
  getDirectReport: (id: string): Promise<ApiResponse<DispatchReport>> =>
    apiClient
      .get<ApiResponse<DispatchReport>>(`/api/shipping/direct-shipments/${id}/dispatch-report`)
      .then((r) => r.data),

  /**
   * Muhasebe Excel veri seti — ekran filtresinin querystring'i (tarih + müşteri)
   * birebir backend'e geçer; status=DISPATCHED backend'de zorlanır.
   */
  getAccountingExport: (qs: string): Promise<ApiResponse<AccountingExportData>> =>
    apiClient
      .get<ApiResponse<AccountingExportData>>(
        `/api/shipping/accounting-export${qs ? `?${qs}` : ""}`,
      )
      .then((r) => r.data),
};
