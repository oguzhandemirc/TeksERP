// Durum → görünen eylemler (TEK tablo; ekran ve test aynı fonksiyonu okur). Sunucu durum makinesinin
// (`QUOTE_TRANSITIONS`) aynası; sunucu yine claim'le reddeder — tablo yalnız yanlış düğmeyi hiç çizmemek içindir.
// Süresi dolmuş SENT teklif kabul edilemez (409 QUOTE_EXPIRED) → "Kabul et" yerine revizyon öne çıkar.
import type { QuoteStatus } from "./quote-types";

export type QuoteAction = "send" | "accept" | "reject" | "unaccept" | "cancel" | "revise" | "convert";

export const QUOTE_ACTION_TABLE: Record<QuoteStatus, QuoteAction[]> = {
  DRAFT: ["send", "cancel"],
  SENT: ["accept", "reject", "revise", "cancel"],
  ACCEPTED: ["convert", "unaccept"],
  REJECTED: ["revise"],
  CANCELLED: [],
  CONVERTED: [],
  SUPERSEDED: [],
};

/** Eylemin rota izni (backend `quote.routes.ts`): kabul/geri al/dönüştür `quote:convert`, diğerleri `quote:write`. */
export const ACTION_PERMISSION: Record<QuoteAction, "quote:write" | "quote:convert"> = {
  send: "quote:write",
  reject: "quote:write",
  cancel: "quote:write",
  revise: "quote:write",
  accept: "quote:convert",
  unaccept: "quote:convert",
  convert: "quote:convert",
};

export const ACTION_LABEL: Record<QuoteAction, string> = {
  send: "Gönder",
  accept: "Kabul et",
  reject: "Reddet",
  unaccept: "Kabulü geri al",
  cancel: "İptal",
  revise: "Revizyon oluştur",
  convert: "Siparişe dönüştür",
};

export function quoteActions(status: QuoteStatus, opts: { expired?: boolean; can: (perm: string) => boolean }): QuoteAction[] {
  const base = QUOTE_ACTION_TABLE[status].filter((a) => !(opts.expired && a === "accept"));
  return base.filter((a) => opts.can(ACTION_PERMISSION[a]));
}
