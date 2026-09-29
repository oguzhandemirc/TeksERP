import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  LicenseDataExportManifest,
  LicenseDetail,
  LicenseOfflineRequest,
  LicenseProxySettings,
  LicenseStatusResponse,
  LicenseTransferResult,
  OfflinePurpose,
  PollOutcome,
} from "@/types/license";

const BASE = "/api/license";

// Lisans uçlarının hataları (502 satıcıya ulaşılamadı dahil) backend'in kendi
// cümlesiyle gösterilir: interceptor 5xx'i genel cümleye çevirdiği için toast
// çağıranda (`apiErrorText`) basılır — tek toast.
const QUIET = { suppressErrorToast: true } as const;

const data = <T,>(p: Promise<{ data: ApiResponse<T> }>): Promise<T> => p.then((r) => r.data.data);

export const licenseService = {
  /** Herkes — başlık varsa tam doğrulama; kimliksize `{ ayrinti: false }`. */
  status: () => data(apiClient.get<ApiResponse<LicenseStatusResponse>>(`${BASE}/durum`, QUIET)),
  detail: () => data(apiClient.get<ApiResponse<LicenseDetail>>(`${BASE}/detay`, QUIET)),
  activate: (kod: string) =>
    data(apiClient.post<ApiResponse<LicenseDetail>>(`${BASE}/etkinlestir`, { kod }, QUIET)),
  pollNow: () =>
    data(apiClient.post<ApiResponse<{ outcome: PollOutcome; code?: string }>>(`${BASE}/yokla`, {}, QUIET)),
  offlineRequest: (amac: OfflinePurpose, kod?: string) =>
    data(
      apiClient.get<ApiResponse<LicenseOfflineRequest>>(`${BASE}/cevrimdisi-istek`, {
        ...QUIET,
        params: kod ? { amac, kod } : { amac },
      }),
    ),
  offlineResponse: (yanit: string) =>
    data(apiClient.post<ApiResponse<LicenseDetail>>(`${BASE}/cevrimdisi-yanit`, { yanit }, QUIET)),
  relayRequest: (amac: OfflinePurpose, kod?: string, quiet = true) =>
    data(
      apiClient.get<ApiResponse<LicenseOfflineRequest>>(`${BASE}/aktarma-istegi`, {
        suppressErrorToast: quiet,
        params: kod ? { amac, kod } : { amac },
      }),
    ),
  relayResponse: (yanit: unknown) =>
    data(apiClient.post<ApiResponse<LicenseDetail>>(`${BASE}/aktarma-yaniti`, { yanit }, QUIET)),
  requestTransfer: (gerekce: string | null) =>
    data(apiClient.post<ApiResponse<LicenseTransferResult>>(`${BASE}/tasima-talebi`, { gerekce }, QUIET)),
  drTakeover: (anaKurulumId: string, gerekce: string) =>
    data(apiClient.post<ApiResponse<LicenseDetail>>(`${BASE}/dr-devral`, { anaKurulumId, gerekce }, QUIET)),
  setProxy: (adres: string | null, atla: string | null) =>
    data(apiClient.put<ApiResponse<LicenseProxySettings>>(`${BASE}/proxy`, { adres, atla }, QUIET)),
  dataExport: () =>
    data(apiClient.get<ApiResponse<LicenseDataExportManifest>>(`${BASE}/veri-disari`, QUIET)),
};
