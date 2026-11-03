// İstasyonda belgeden iş emri bulma (K17) — sunucu sonucunun ekranda ne yapacağı (saf; jest sınar).
import type { StationLookupResult, StationLookupWorkOrder } from '../../services/stationDocLookup.service';

export type LookupDecision =
  | { kind: 'open'; workOrder: StationLookupWorkOrder }
  | { kind: 'choose'; workOrders: StationLookupWorkOrder[]; message: string }
  | { kind: 'empty'; message: string };

/** Tek İE → doğrudan aç; çok → seçtir; yok → sunucunun cümlesi + elle arama. */
export function decideLookup(r: StationLookupResult): LookupDecision {
  if (r.workOrders.length === 1) return { kind: 'open', workOrder: r.workOrders[0]! };
  if (r.workOrders.length > 1) return { kind: 'choose', workOrders: r.workOrders, message: r.message };
  return { kind: 'empty', message: r.message };
}

/** Liste satırının alt metni: parti no'ları · belge no'ları (fiş no öncelikli). */
export function workOrderSubtitle(w: StationLookupWorkOrder): string {
  const docs = w.documents.map((d) => d.senderDocNo ?? d.noteNo);
  return [w.batchNumbers.join(', '), docs.length ? `Belge ${docs.join(', ')}` : ''].filter(Boolean).join(' · ');
}

/** Elle arama sunucuya en az 2 karakterle gider (sunucu kapısıyla aynı). */
export const MIN_SEARCH_LENGTH = 2;
export function searchable(q: string): boolean {
  return q.trim().length >= MIN_SEARCH_LENGTH;
}
