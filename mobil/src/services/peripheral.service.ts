import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Cihaz kaydı (PeripheralDevice) — mobil. Tablete-bağlı Bluetooth yazıcıyı
// backend merkezî kaydına ekler; deviceId backend'de x-device-id'den çözülür.
// LAN-only; başarısızlık sessiz (yerel seçim zaten çalışır).
// =============================================================================

export const peripheralService = {
  /** Tablete-bağlı BT yazıcıyı kayda al (idempotent: deviceId+address). */
  registerBtPrinter: (input: {
    address: string;
    name?: string;
    languageOverride?: string | null;
  }): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/peripherals/register-bt', input)
      .then((r) => r.data),
};
