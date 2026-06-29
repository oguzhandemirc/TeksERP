import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { AccountingExportData, DispatchListItem, DispatchReport } from "./types";

// Liste backend listShipments cursor'unu kullanır (status=DISPATCHED forceFilter).
const base = createCrudService<DispatchListItem>("/api/shipping/shipments");

export const accountingDispatchService = {
  ...base,
  /** Saha #2: 3 bölümlü sevk fişi (ürün/çuval/çeki) — fiş açılınca lazy. */
  getReport: (id: string): Promise<ApiResponse<DispatchReport>> =>
    apiClient
      .get<ApiResponse<DispatchReport>>(`/api/shipping/shipments/${id}/dispatch-report`)
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
