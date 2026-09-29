import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { LicenseStatusResponse } from '../lib/license';

// =============================================================================
// Lisans uçları (`/api/license/*`) — tablet yalnız ikisini kullanır:
//   · GET  /durum            herkes; kimlikliye uygulanan kademe + bant + filigran
//   · POST /cevrimdisi-yanit `license:manage`; QR'dan okunan satıcı yanıtını iletir
// İmza ve bağ denetimi backend'de; tablet yanıtı AYNEN gönderir (`LISANS-PROTOKOLU.md` §14).
// =============================================================================

export const licenseService = {
  getStatus: (): Promise<LicenseStatusResponse> =>
    apiClient
      .get<ApiResponse<LicenseStatusResponse>>('/license/durum')
      .then((r) => r.data.data),

  /** Yanıt kabul edilirse backend güncel ayrıntıyı döner; tablet yalnız başarıyı okur. */
  submitOfflineResponse: (yanit: string): Promise<void> =>
    apiClient
      .post<ApiResponse<unknown>>('/license/cevrimdisi-yanit', { yanit }, { timeout: 30000 })
      .then(() => undefined),
};
