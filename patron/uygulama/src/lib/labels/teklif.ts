// Teklif + standart maliyet sözlüğü. Kaynak enum'lar (Teks-Erp/prisma/schema.prisma): SalesQuoteStatus (DRAFT buluta
// gelmez) · StandardCostStatus {ACTIVE, SUPERSEDED}. Etiketler panelin teklif ekranıyla aynı; bilinmeyen değer ham döner.
import type { StatusEntry } from "./ortak";

export const QUOTE_STATUS: Readonly<Record<string, StatusEntry>> = {
  SENT: { label: "Gönderildi", tone: "bilgi" },
  ACCEPTED: { label: "Kabul edildi", tone: "iyi" },
  REJECTED: { label: "Reddedildi", tone: "kritik" },
  CANCELLED: { label: "İptal", tone: "bilgi" },
  CONVERTED: { label: "Siparişe döndü", tone: "iyi" },
  SUPERSEDED: { label: "Revize edildi", tone: "bilgi" },
};

/** "Süresi doldu" rozeti: fabrikanın türettiği `suresiDoldu` (yalnız gönderilmiş teklifte doğru olur); istemci tarih karşılaştırmaz. */
export const QUOTE_EXPIRED: StatusEntry = { label: "Süresi doldu", tone: "uyari" };

export const STANDARD_COST_STATUS: Readonly<Record<string, StatusEntry>> = {
  ACTIVE: { label: "Geçerli", tone: "iyi" },
  SUPERSEDED: { label: "Eski sürüm", tone: "bilgi" },
};

/** Standart maliyet `.finans` grupları (fabrika `cost-component-groups.helper`): sıra ve ad. */
export const COST_GROUPS: readonly { readonly key: string; readonly label: string }[] = [
  { key: "cozguTl", label: "Çözgü" },
  { key: "atkiTl", label: "Atkı" },
  { key: "dokumaTl", label: "Dokuma" },
  { key: "terbiyeTl", label: "Terbiye" },
  { key: "genelGiderTl", label: "Genel gider" },
];
