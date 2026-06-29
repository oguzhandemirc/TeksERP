import { apiClient } from './api';

// =============================================================================
// Sevk İrsaliyesi HTML — backend'in TEK KAYNAK çıktısından (renderShipmentDispatchHtml).
// Muhasebe "Sevk Fişi" + Electron + mobil aynı HTML'i basar → format her yerde aynı.
// ?draft=1: sevk öncesi (donmuş belge yoksa) canlı TASLAK önizlemesi; DISPATCHED'da
// resmî donmuş belge döner. Yazdırma (expo-print) çağırana bırakılır (margin + iptal
// yönetimi ekranlarda).
// =============================================================================
export async function getShipmentDispatchHtml(shipmentId: string): Promise<string> {
  const res = await apiClient.get<string>(
    `/printed-documents/SHIPMENT_DISPATCH/${shipmentId}/html`,
    { params: { draft: 1 }, responseType: 'text', headers: { Accept: 'text/html' } },
  );
  return typeof res.data === 'string' ? res.data : String(res.data);
}
