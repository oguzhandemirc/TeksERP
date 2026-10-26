// Fiyat listesi uçları (`/api/price-lists`). Süzme + cursor + özet SUNUCUDA; gövdeler açık alan listesiyle kurulur.
// Yazma isteklerinin hatası koda göre Türkçe (`pl-errors.ts`) — genel toast basmasın.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";
import { toDecimalText } from "../shared/format";
import type { PriceListDetail, PriceListFilter, PriceListPage } from "./pl-types";

export function priceListParams(f: PriceListFilter, cursor: string | null, limit: number): Record<string, string> {
  return {
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.status ? { "filter[durum]": f.status } : {}),
    ...(f.scope === "genel" ? { "filter[genel]": "1" } : {}),
    ...(f.scope === "customer" && f.customerId ? { "filter[customerId]": f.customerId } : {}),
    ...(f.currency ? { "filter[currency]": f.currency } : {}),
    ...(cursor ? { cursor } : {}),
    limit: String(limit),
  };
}

export interface PriceListCreateForm { name: string; customerId: string | null; currency: Currency; validFromDate: string; validUntilDate: string; notes: string }
export const EMPTY_CREATE: PriceListCreateForm = { name: "", customerId: null, currency: "TRY", validFromDate: "", validUntilDate: "", notes: "" };

export function buildCreateBody(f: PriceListCreateForm, clientToken: string): Record<string, unknown> {
  return {
    clientToken,
    name: f.name.trim(),
    currency: f.currency,
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.validFromDate ? { validFromDate: f.validFromDate } : {}),
    ...(f.validUntilDate ? { validUntilDate: f.validUntilDate } : {}),
    ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
  };
}

/** Editör satırı → `PUT /lines` satırı; fiyatı boş/geçersiz satır varsa null (Kaydet kapalı). */
export interface EditorLine { key: string; item: { id: string; code: string; name: string }; colorId: string | null; unitPrice: string; minQty: string }
export function buildLinesBody(lines: EditorLine[]): Array<Record<string, unknown>> | null {
  const out: Array<Record<string, unknown>> = [];
  for (const l of lines) {
    const unitPrice = toDecimalText(l.unitPrice);
    if (!unitPrice) return null;
    const minQty = toDecimalText(l.minQty);
    out.push({ itemId: l.item.id, colorId: l.colorId, unitPrice, ...(minQty ? { minQty } : {}) });
  }
  return out;
}

export interface FillForm { markupPct: string; fxRate: string }
export function buildFillBody(f: FillForm, currency: Currency): Record<string, unknown> {
  const markupPct = toDecimalText(f.markupPct);
  const fxRate = currency !== "TRY" ? toDecimalText(f.fxRate) : null;
  return { ...(markupPct ? { markupPct } : {}), ...(fxRate ? { fxRate } : {}) };
}

type Res = ApiResponse<PriceListDetail> & { message?: string };
const base = "/api/price-lists";
const OWN = { suppressErrorToast: true } as const;
export const priceListService = {
  list: async (f: PriceListFilter, cursor: string | null, limit = 50) =>
    (await apiClient.get<PriceListPage>(base, { params: priceListParams(f, cursor, limit) })).data,
  get: async (id: string) => (await apiClient.get<Res>(`${base}/${id}`)).data,
  create: async (f: PriceListCreateForm, clientToken: string) => (await apiClient.post<Res>(base, buildCreateBody(f, clientToken), OWN)).data,
  replaceLines: async (id: string, lines: Array<Record<string, unknown>>) => (await apiClient.put<Res>(`${base}/${id}/lines`, { lines }, OWN)).data,
  fill: async (id: string, body: Record<string, unknown>) => (await apiClient.post<Res>(`${base}/${id}/fill-from-standard-cost`, body, OWN)).data,
  publish: async (id: string) => (await apiClient.post<Res>(`${base}/${id}/publish`, {}, OWN)).data,
  archive: async (id: string) => (await apiClient.post<Res>(`${base}/${id}/archive`, {}, OWN)).data,
  revise: async (id: string, clientToken: string) => (await apiClient.post<Res>(`${base}/${id}/revise`, { clientToken }, OWN)).data,
};
