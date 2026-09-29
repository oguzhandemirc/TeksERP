import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import { DISCOVERY_IDENTITY_PATH, type ServerIdentity } from "@shared/discovery";
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

const isRouteMissing = (err: unknown): boolean =>
  (err as { response?: { status?: number } } | null)?.response?.status === 404;

/**
 * İmzalı istek zarfı (çevrimdışı QR · panel aktarması). Etkinleştirme KODU taşıyabildiği için
 * GÖVDEYLE gider (D12): kod URL'ye, dolayısıyla erişim günlüğüne ve vekil kayıtlarına girmez.
 * POST ucu olmayan eski backend 404 döner → bir kez eski GET yoluna düşülür (geçiş; backend önce iner).
 */
async function envelope(path: "cevrimdisi-istek" | "aktarma-istegi", amac: OfflinePurpose, kod?: string): Promise<LicenseOfflineRequest> {
  const body = kod ? { amac, kod } : { amac };
  try {
    return await data(apiClient.post<ApiResponse<LicenseOfflineRequest>>(`${BASE}/${path}`, body, QUIET));
  } catch (err) {
    if (!isRouteMissing(err)) throw err;
    return data(apiClient.get<ApiResponse<LicenseOfflineRequest>>(`${BASE}/${path}`, { ...QUIET, params: body }));
  }
}

export const licenseService = {
  /** Herkes — başlık varsa tam doğrulama; kimliksize `{ ayrinti: false }`. */
  status: () => data(apiClient.get<ApiResponse<LicenseStatusResponse>>(`${BASE}/durum`, QUIET)),
  detail: () => data(apiClient.get<ApiResponse<LicenseDetail>>(`${BASE}/detay`, QUIET)),
  activate: (kod: string) =>
    data(apiClient.post<ApiResponse<LicenseDetail>>(`${BASE}/etkinlestir`, { kod }, QUIET)),
  pollNow: () =>
    data(apiClient.post<ApiResponse<{ outcome: PollOutcome; code?: string }>>(`${BASE}/yokla`, {}, QUIET)),
  offlineRequest: (amac: OfflinePurpose, kod?: string) => envelope("cevrimdisi-istek", amac, kod),
  offlineResponse: (yanit: string) =>
    data(apiClient.post<ApiResponse<LicenseDetail>>(`${BASE}/cevrimdisi-yanit`, { yanit }, QUIET)),
  relayRequest: (amac: OfflinePurpose, kod?: string) => envelope("aktarma-istegi", amac, kod),
  relayResponse: (yanit: unknown) =>
    data(apiClient.post<ApiResponse<LicenseDetail>>(`${BASE}/aktarma-yaniti`, { yanit }, QUIET)),
  requestTransfer: (gerekce: string | null) =>
    data(apiClient.post<ApiResponse<LicenseTransferResult>>(`${BASE}/tasima-talebi`, { gerekce }, QUIET)),
  drTakeover: (anaKurulumId: string, gerekce: string) =>
    data(apiClient.post<ApiResponse<LicenseDetail>>(`${BASE}/dr-devral`, { anaKurulumId, gerekce }, QUIET)),
  setProxy: (adres: string | null, atla: string | null) =>
    data(apiClient.put<ApiResponse<LicenseProxySettings>>(`${BASE}/proxy`, { adres, atla }, QUIET)),
  /** Veritabanının kurulum kimliği (`system.installationId`) — YALNIZ bilgi; lisans kimliği değil (D14). */
  databaseInstallationId: () =>
    apiClient
      .get<Partial<ServerIdentity>>(DISCOVERY_IDENTITY_PATH, QUIET)
      .then((r) => (typeof r.data?.installationId === "string" ? r.data.installationId : null)),
  dataExport: () =>
    data(apiClient.get<ApiResponse<LicenseDataExportManifest>>(`${BASE}/veri-disari`, QUIET)),
};
