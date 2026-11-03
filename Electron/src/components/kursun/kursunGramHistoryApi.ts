// K14: kurşun gram fiyatı geçmişi okuması (salt okunur; istasyon `station:read`, cari `finance:read`).
import apiClient from "@/services/apiClient";
import { formatFactory } from "@/lib/factory-time";

export type KursunGramHistoryOwner = { kind: "station"; id: string } | { kind: "cari"; id: string };

export interface KursunGramHistoryItem {
  id: string;
  validFrom: string;
  /** null = fiyat kaldırıldı. */
  price: string | null;
  currency: string | null;
  createdById: string | null;
  createdByName: string | null;
}

export interface KursunGramHistoryPage {
  items: KursunGramHistoryItem[];
  nextCursor: string | null;
}

export const kursunGramHistoryKey = (o: KursunGramHistoryOwner) => ["kursun-gram-history", o.kind, o.id] as const;

export function kursunGramHistoryUrl(o: KursunGramHistoryOwner): string {
  return o.kind === "station"
    ? `/api/station-capabilities/${o.id}/kursun/price-history`
    : `/api/finance/cari/${o.id}/kursun-gram-history`;
}

export async function fetchKursunGramHistory(o: KursunGramHistoryOwner, cursor?: string): Promise<KursunGramHistoryPage> {
  const r = await apiClient.get<{ data: KursunGramHistoryPage }>(kursunGramHistoryUrl(o), { params: { limit: 20, ...(cursor ? { cursor } : {}) } });
  return r.data.data;
}

/** Satır metni — saat FABRİKA diliminden (factory-time); kaldırma sürümü "kaldırıldı". */
export function historyRowText(i: KursunGramHistoryItem): { when: string; price: string; who: string } {
  return {
    when: formatFactory(i.validFrom, "dd.MM.yyyy HH:mm"),
    price: i.price === null ? "Kaldırıldı" : `${i.price.replace(".", ",")} ${i.currency ?? ""}`.trim(),
    who: i.createdByName ?? (i.createdById ? "—" : "Sistem (ilk kayıt)"),
  };
}

/** K14-b: alt not AYARA göre; ayar yeri panelde Sistem → Özellik Anahtarları → Muhasebe (Genel Ayarlar değil). */
export const GRAM_PRICE_BASIS_PLACE = "Sistem → Özellik Anahtarları → Muhasebe → Gram fiyatı";
export function gramPriceBasisNote(basis: "SERVICE_DATE" | "INVOICE_DATE" | undefined): string {
  const rule = basis === "INVOICE_DATE"
    ? "Fatura, faturanın kesildiği gündeki gram fiyatını kullanır"
    : "Fatura, işin yapıldığı gündeki gram fiyatını kullanır";
  return `${rule} (ayar: ${GRAM_PRICE_BASIS_PLACE}).`;
}
