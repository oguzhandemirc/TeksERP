import * as Print from 'expo-print';
import { apiClient } from './api';
import { travelerCardService } from './travelerCard.service';

// =============================================================================
// Refakat kartı basımı — backend'in TEK KAYNAK HTML'inden. Tüm cihazlar (mobil +
// Electron) bu aynı HTML'i basar → format her yerde aynı. İçerik kartın donmuş
// snapshot'ından üretilir; QR sunucuda gömülür (istemci QR üretmez). Kullanıcı
// yazdırma diyaloğunu iptal ederse expo-print throw edebilir; çağıran yakalar.
// =============================================================================

/** Kart id'sinden doğrudan baskı. */
export async function printTravelerCard(cardId: string): Promise<void> {
  const res = await apiClient.get<string>(`/traveler-cards/${cardId}/html`, {
    responseType: 'text',
    headers: { Accept: 'text/html' },
  });
  const html = typeof res.data === 'string' ? res.data : String(res.data);
  await Print.printAsync({ html });
}

/**
 * İş emrinin AKTİF refakat kartını bulur ve basar. Kart yoksa net hata fırlatır
 * (çağıran Toast'a düşürür). WO'ya birebir filtre — fuzzy batchNumber araması yok.
 */
export async function printTravelerCardForWorkOrder(workOrderId: string): Promise<void> {
  const cardsRes = await travelerCardService.list({
    filters: { workOrderId, status: 'ACTIVE' },
    pageSize: 1,
  });
  const card = (cardsRes.data ?? [])[0];
  if (!card) {
    throw new Error('Aktif refakat kartı bulunamadı');
  }
  await printTravelerCard(card.id);
}
