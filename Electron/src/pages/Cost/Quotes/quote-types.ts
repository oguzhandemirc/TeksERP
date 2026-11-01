// Teklif yanıt tipleri (`/api/quotes`, MAL-4). Para/maliyet alanları sunucunun Decimal METNİDİR; panel yalnız biçimler.
// Maliyet alanları (`costPerMTry`, `markupPct`, `suggestedUnitPrice`, `totalCostTry`, `marj`) `cost:read` yoksa
// YANITTA YOKTUR — tip bunu opsiyonel taşır, ekran "alan var mı" diye bakar (izni ikinci kez yorumlamaz).
import type { Currency } from "@/pages/Finance/service";

export type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "CANCELLED" | "CONVERTED" | "SUPERSEDED";
export const QUOTE_STATUSES: QuoteStatus[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CANCELLED", "CONVERTED", "SUPERSEDED"];
export type QuotePriceSource = "COST_PLUS" | "PRICE_LIST" | "ITEM_PRICE" | "MANUAL";

type Dec = string;
interface Ref { id: string; code: string | null; name: string }
interface RevRef { id: string; revisionNo: number; status: QuoteStatus }

export interface QuoteLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  colorId: string | null;
  item: Ref | null;
  color: Ref | null;
  /** Varyant (ürün şablonu) — eski sunucuda yok. */
  recipeId?: string | null;
  recipe?: { id: string; code: string; name: string; variantCode?: string | null } | null;
  description: string;
  width: Dec | null;
  quantity: Dec;
  unit: string;
  unitPrice: Dec;
  priceSource: QuotePriceSource;
  lineTotal: Dec;
  notes: string | null;
  costPerMTry?: Dec;
  markupPct?: Dec;
  suggestedUnitPrice?: Dec;
}

export interface QuoteBase {
  id: string;
  quoteNo: string;
  revisionNo: number;
  status: QuoteStatus;
  customerId: string;
  customer: Ref;
  quoteDate: string;
  validUntilDate: string;
  currency: Currency;
  fxRate: Dec;
  fxRateSource: "MANUAL" | "TCMB" | null;
  totalAmount: Dec;
  totalCostTry?: Dec | null;
  suresiDoldu?: boolean;
  convertedOrder: { id: string; orderNumber: string | null; status: string } | null;
}

export interface QuoteRow extends QuoteBase { _count: { lines: number } }

export interface QuoteDetail extends QuoteBase {
  branchId: string | null;
  branch: { id: string; name: string } | null;
  paymentTermDays: number | null;
  financeChargePct: Dec | null;
  commissionPct: Dec | null;
  freightPerM: Dec | null;
  customerReference: string | null;
  notes: string | null;
  internalNote?: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string | null;
  sentAt: string | null;
  sentById: string | null;
  acceptedAt: string | null;
  acceptedById: string | null;
  rejectedAt: string | null;
  rejectedById: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancelReason: string | null;
  convertedAt: string | null;
  convertedById: string | null;
  supersededAt: string | null;
  revisionOf: RevRef | null;
  revisedTo: RevRef | null;
  lines: QuoteLine[];
  marj?: { brutMarjTry: Dec; marjPct: Dec | null } | null;
}

export type QuoteSummary = Partial<Record<QuoteStatus, number>> & { toplam: number; suresiDoldu: number };
export interface QuotePage { data: QuoteRow[]; ozet: QuoteSummary; toplamSuzulen: number; nextCursor: string | null }

export interface QuoteFilter {
  q: string;
  status: QuoteStatus | "";
  customerId: string | null;
  from: string;
  to: string;
  expired: boolean;
}
export const EMPTY_QUOTE_FILTER: QuoteFilter = { q: "", status: "", customerId: null, from: "", to: "", expired: false };
