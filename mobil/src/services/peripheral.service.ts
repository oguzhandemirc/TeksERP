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
  readMode: 'POLL' | 'STREAM'; // POLL=sor-cevap (komut yolla), STREAM=sürekli yayın (dinle)
  pollCommand: string | null;
  terminator: string | null;
  identifyPattern: string | null; // değer ayıklama / geçerli çerçeve regex'i
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

  /** Oturumun YERİNDEKİ (makine/istasyon) TÜM cihazlar — kind filtresiz (saha eşleme). */
  getForSessionAll: (): Promise<DevicePeripheral[]> =>
    apiClient
      .get<ApiResponse<DevicePeripheral[]>>('/peripherals/for-session')
      .then((r) => r.data?.data ?? []),

  /**
   * SAHA EŞLEME: tabletle taranan HC-06 MAC'ini cihaz kaydına yazar. Backend
   * YALNIZ aktif oturumun makine/istasyonundaki cihaza izin verir (yer eşleşmezse
   * 403) ve gerçek MAC atandığı için simulate'i kapatır.
   */
  assignFieldAddress: (id: string, address: string): Promise<DevicePeripheral> =>
    apiClient
      .patch<ApiResponse<DevicePeripheral>>(`/peripherals/${id}/field-address`, { address })
      .then((r) => r.data.data),
};
