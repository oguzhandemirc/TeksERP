// Fiyat listesi tel tipleri (`/api/price-lists`, MAL-4). Decimal'ler METİN gelir (sayıya çevrilmez); satırdaki maliyet
// alanları (`costPerMTry`, `markupPct`) yalnız `cost:read` taşıyan isteğe gelir — yoksa kolon çizilmez.
import type { Currency } from "@/pages/Finance/service";

export const PRICE_LIST_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type PriceListStatus = (typeof PRICE_LIST_STATUSES)[number];
export const PRICE_LIST_STATUS_LABEL: Record<PriceListStatus, string> = { DRAFT: "Taslak", PUBLISHED: "Yayında", ARCHIVED: "Arşivde" };

type Ref = { id: string; code: string; name: string };
interface PriceListBase {
  id: string;
  listNo: string;
  revisionNo: number;
  name: string;
  customerId: string | null;
  customer: Ref | null;
  currency: Currency;
  status: PriceListStatus;
  validFromDate: string | null;
  validUntilDate: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  revisionOfId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PriceListRow extends PriceListBase { _count: { lines: number } }
export interface PriceListLine {
  id: string;
  lineNo: number;
  itemId: string;
  item: Ref;
  colorId: string | null;
  color: Ref | null;
  unitPrice: string;
  minQty: string | null;
  costPerMTry?: string | null;
  markupPct?: string | null;
}
export interface PriceListDetail extends PriceListBase { lines: PriceListLine[] }

export type PriceListSummary = Partial<Record<PriceListStatus, number>> & { toplam: number };
export interface PriceListPage { data: PriceListRow[]; ozet: PriceListSummary; toplamSuzulen: number; nextCursor: string | null }

/** Kapsam: "" hepsi · "genel" müşterisiz liste · "customer" seçili müşteri. */
export interface PriceListFilter { q: string; status: PriceListStatus | ""; scope: "" | "genel" | "customer"; customerId: string | null; currency: Currency | "" }
export const EMPTY_PRICE_LIST_FILTER: PriceListFilter = { q: "", status: "", scope: "", customerId: null, currency: "" };

export const priceListLabel = (l: { listNo: string; revisionNo: number }) => (l.revisionNo > 1 ? `${l.listNo} R${l.revisionNo}` : l.listNo);
/** Satırlarda maliyet alanı VAR mı (sunucu `cost:read` yoksa alanı hiç koymaz) — kolonun tek kaynağı. */
export const hasListCostColumns = (lines: PriceListLine[]) => lines.some((l) => "costPerMTry" in l);
