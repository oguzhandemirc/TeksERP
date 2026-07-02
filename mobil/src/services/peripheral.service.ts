import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Cihaz kaydı (PeripheralDevice) — mobil. Tablet auto-discovery: kendi yerine
// (makine/istasyon) SABİT cihazları (METER/SCALE/LABEL_PRINTER) protokol
// alanlarıyla çözer — Tambur/KK1 HAL ile okur (admin Cihaz Kaydı'nda yapılandırır;
// MAC/komut/regex backend'de, tabletler tek tek ayarlanmaz).
// (register-bt ucu ve registerBtPrinter 2026-07'de kaldırıldı — yazıcılar yalnız
// panel → Tanımlar → Cihaz Kaydı'ndan tanımlanır.)
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
