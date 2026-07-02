import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Cihaz kaydı (PeripheralDevice) — mobil. Tablete-bağlı Bluetooth yazıcıyı
// backend merkezî kaydına ekler; deviceId backend'de x-device-id'den çözülür.
// LAN-only; başarısızlık sessiz (yerel seçim zaten çalışır).
//
// Ayrıca tablet auto-discovery: kendi makinesine SABİT giriş cihazlarını (METER/
// SCALE) protokol alanlarıyla çözer — Tambur/KK1 HAL ile okur (admin Cihaz Kaydı'nda
// yapılandırır; MAC/komut/regex backend'de, tabletler tek tek ayarlanmaz).
// =============================================================================

/** for-device çözümünden dönen cihaz satırı (HAL okuması için protokol dahil). */
export interface DevicePeripheral {
  id: string;
  code: string;
  name: string;
  kind: string;
  connectionType: string;
  address: string | null;
  port: number | null;
  pollCommand: string | null;
  terminator: string | null;
  decimals: number | null;
  scale: number | null; // backend Decimal'i number'a serialize eder
  unit: string | null;
  timeoutMs: number | null;
  role: string | null;
  simulate: boolean;
}

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

  /** Tablet auto-discovery: kendi makinesinin türe göre aktif cihazları.
   *  @deprecated for-session'a geçildi (Faz 3) — Faz 6'da backend ucuyla birlikte kalkar. */
  getForDevice: (
    kind: 'METER' | 'SCALE' | 'LABEL_PRINTER' | 'SIGNAL_SOURCE',
  ): Promise<DevicePeripheral[]> =>
    apiClient
      .get<ApiResponse<DevicePeripheral[]>>(
        `/peripherals/for-device?kind=${encodeURIComponent(kind)}`,
      )
      .then((r) => r.data?.data ?? []),

  /** OTURUM-KAPSAMLI çözüm: aktif çalışma oturumunun YERİNE (makine/istasyon) sabit
   *  cihazlar. Oturum yoksa backend BOŞ liste döner (fail-closed — sim/manuel'e
   *  düşülmez, SessionGate zaten yer onayı ister). */
  getForSession: (
    kind: 'METER' | 'SCALE' | 'LABEL_PRINTER' | 'SIGNAL_SOURCE',
  ): Promise<DevicePeripheral[]> =>
    apiClient
      .get<ApiResponse<DevicePeripheral[]>>(
        `/peripherals/for-session?kind=${encodeURIComponent(kind)}`,
      )
      .then((r) => r.data?.data ?? []),
};
