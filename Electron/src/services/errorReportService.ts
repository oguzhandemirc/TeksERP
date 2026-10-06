import apiClient from "./apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";
import type { ErrorReportConsent, ErrorReportOverview } from "@/pages/System/Support/error-report-types";

const BASE = "/api/hata-raporlari";
const QUIET = { suppressErrorToast: true } as const;

export const errorReportService = {
  overview: (): Promise<ErrorReportOverview> => apiClient.get<ApiResponse<ErrorReportOverview>>(BASE, QUIET).then((r) => r.data.data),
  /** ⚠️ AYAR ŞİFRESİ KAPISINDAN GEÇER (müşteri onayı; geri alınınca bekleyen raporlar silinir). */
  setConsent: (acik: boolean): Promise<{ data: ErrorReportConsent; message?: string }> =>
    withSettingsPassword((headers) =>
      apiClient
        .put<ApiResponse<ErrorReportConsent>>(`${BASE}/onay`, { acik }, { headers, ...QUIET })
        .then((r) => ({ data: r.data.data, message: r.data.message })),
    ),
};
