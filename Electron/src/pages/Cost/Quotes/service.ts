// Teklif uçları (`/api/quotes`, MAL-4). Süzme + cursor + özet SUNUCUDA (tek where); gövdeler açık alan listesiyle
// kurulur (istemci gövde katmanı allowlist). Toplam/öneri/marj yanıttan okunur — burada hesap YOK.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";
import { decToInput, toDecimalText } from "../shared/format";
import type { QuoteDetail, QuoteFilter, QuotePage } from "./quote-types";

export function quoteListParams(f: QuoteFilter, cursor: string | null, limit: number): Record<string, string> {
  return {
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.status ? { "filter[durum]": f.status } : {}),
    ...(f.customerId ? { "filter[customerId]": f.customerId } : {}),
    ...(f.expired ? { "filter[suresiDoldu]": "1" } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(cursor ? { cursor } : {}),
    limit: String(limit),
  };
}

export interface QuoteHeaderForm {
  customerId: string | null;
  branchId: string | null;
  currency: Currency;
  fxRate: string;
  validUntilDate: string;
  paymentTermDays: string;
  commissionPct: string;
  financeChargePct: string;
  freightPerM: string;
  customerReference: string;
  notes: string;
  internalNote: string;
}

const textOrNull = (v: string) => (v.trim() ? v.trim() : null);

export const EMPTY_HEADER: QuoteHeaderForm = {
  customerId: null, branchId: null, currency: "TRY", fxRate: "", validUntilDate: "", paymentTermDays: "", commissionPct: "",
  financeChargePct: "", freightPerM: "", customerReference: "", notes: "", internalNote: "",
};

/** Kayıtlı teklif → form (sunucu Decimal metni TR yazımına; sayıya çevrilmez). */
export function headerFromQuote(q: QuoteDetail): QuoteHeaderForm {
  return {
    customerId: q.customerId, branchId: q.branchId, currency: q.currency, fxRate: decToInput(q.fxRate),
    validUntilDate: q.validUntilDate.slice(0, 10), paymentTermDays: q.paymentTermDays === null ? "" : String(q.paymentTermDays),
    commissionPct: decToInput(q.commissionPct), financeChargePct: decToInput(q.financeChargePct), freightPerM: decToInput(q.freightPerM),
    customerReference: q.customerReference ?? "", notes: q.notes ?? "", internalNote: q.internalNote ?? "",
  };
}

/**
 * Başlık gövdesi: boş sayı alanı null (sunucu varsayılanı), TL'de kur gönderilmez (sunucu 1 yazar). Düzenlemede kur
 * yalnız DEĞİŞTİYSE gider — sunucu gelen kuru "elle" damgalar, değişmeyen öneri kuru elle sayılmasın.
 */
export function buildHeaderBody(h: QuoteHeaderForm, mode: "create" | "update", saved?: QuoteHeaderForm): Record<string, unknown> {
  const fx = h.currency !== "TRY" && (mode === "create" || h.fxRate !== saved?.fxRate) ? toDecimalText(h.fxRate) : null;
  return {
    ...(mode === "create" ? { customerId: h.customerId, currency: h.currency } : {}),
    branchId: h.branchId,
    ...(fx ? { fxRate: fx } : {}),
    ...(h.validUntilDate ? { validUntilDate: h.validUntilDate } : {}),
    paymentTermDays: toDecimalText(h.paymentTermDays),
    commissionPct: toDecimalText(h.commissionPct),
    financeChargePct: toDecimalText(h.financeChargePct),
    freightPerM: toDecimalText(h.freightPerM),
    customerReference: textOrNull(h.customerReference),
    notes: textOrNull(h.notes),
    internalNote: textOrNull(h.internalNote),
  };
}

export interface LineBody {
  itemId?: string;
  adHoc?: Record<string, unknown>;
  description?: string | null;
  colorId?: string | null;
  recipeId?: string | null;
  width?: string | null;
  quantity?: string | null;
  unitPrice?: string | null;
  markupPct?: string | null;
  unit?: "MT";
}

type QuoteRes = ApiResponse<QuoteDetail> & { warnings?: string[] };
export type QuoteDetailRes = { data: QuoteDetail; aktorler: Record<string, string> };
export type Transition = "send" | "accept" | "unaccept" | "reject" | "cancel";

const base = "/api/quotes";
// Yazma isteklerinin hatası ekranda KOD'a göre Türkçe cümleyle söylenir (`quote-errors.ts`); genel toast basmasın.
const OWN = { suppressErrorToast: true } as const;
export const quoteService = {
  list: async (f: QuoteFilter, cursor: string | null, limit = 50) =>
    (await apiClient.get<QuotePage>(base, { params: quoteListParams(f, cursor, limit) })).data,
  get: async (id: string) => (await apiClient.get<QuoteDetailRes>(`${base}/${id}`)).data,
  create: async (h: QuoteHeaderForm, clientToken: string) =>
    (await apiClient.post<QuoteRes>(base, { ...buildHeaderBody(h, "create"), clientToken }, OWN)).data,
  update: async (id: string, h: QuoteHeaderForm, saved: QuoteHeaderForm) =>
    (await apiClient.patch<QuoteRes>(`${base}/${id}`, buildHeaderBody(h, "update", saved), OWN)).data,
  addLine: async (id: string, b: LineBody) => (await apiClient.post<QuoteRes>(`${base}/${id}/lines`, { ...b, unit: "MT" }, OWN)).data,
  updateLine: async (id: string, lineId: string, b: LineBody) => (await apiClient.patch<QuoteRes>(`${base}/${id}/lines/${lineId}`, b, OWN)).data,
  deleteLine: async (id: string, lineId: string) => (await apiClient.delete<QuoteRes>(`${base}/${id}/lines/${lineId}`, OWN)).data,
  refreshCosts: async (id: string) => (await apiClient.post<QuoteRes>(`${base}/${id}/refresh-costs`, {}, OWN)).data,
  transition: async (id: string, t: Transition, body: Record<string, unknown> = {}) =>
    (await apiClient.post<QuoteRes>(`${base}/${id}/${t}`, body, OWN)).data,
  revise: async (id: string, clientToken: string) => (await apiClient.post<QuoteRes>(`${base}/${id}/revise`, { clientToken }, OWN)).data,
  convert: async (id: string, clientToken: string, lineItems: Array<{ lineNo: number; itemId: string }>) =>
    (
      await apiClient.post<QuoteRes & { orderId: string; orderNumber: string | null }>(`${base}/${id}/convert`, {
        clientToken,
        ...(lineItems.length ? { lineItems } : {}),
      }, OWN)
    ).data,
};
