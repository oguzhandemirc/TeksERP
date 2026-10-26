// Teklif durum/kaynak etiketleri (Türkçe). Rozet tonu durum makinesinden: canlı → nötr/mavi, sonuç → yeşil/kırmızı.
import type { QuotePriceSource, QuoteStatus } from "./quote-types";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Taslak",
  SENT: "Gönderildi",
  ACCEPTED: "Kabul edildi",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal",
  CONVERTED: "Siparişe dönüştü",
  SUPERSEDED: "Yerine yenisi geldi",
};

export const QUOTE_STATUS_TONE: Record<QuoteStatus, string> = {
  DRAFT: "border-muted-foreground/30 text-muted-foreground",
  SENT: "border-info/40 text-info",
  ACCEPTED: "border-success/40 text-success",
  REJECTED: "border-destructive/40 text-destructive",
  CANCELLED: "border-muted-foreground/30 text-muted-foreground line-through",
  CONVERTED: "border-success/40 bg-success/10 text-success",
  SUPERSEDED: "border-muted-foreground/30 text-muted-foreground",
};

export const PRICE_SOURCE_LABEL: Record<QuotePriceSource, string> = {
  COST_PLUS: "Maliyet + kâr",
  PRICE_LIST: "Fiyat listesi",
  ITEM_PRICE: "Ürün fiyatı",
  MANUAL: "Elle",
};

/** "TKF202600042" + R2 → "TKF202600042 / R2" (ilk sürüm R1 yazılmaz). */
export function quoteNumberLabel(q: { quoteNo: string; revisionNo: number }): string {
  return q.revisionNo > 1 ? `${q.quoteNo} / R${q.revisionNo}` : q.quoteNo;
}
