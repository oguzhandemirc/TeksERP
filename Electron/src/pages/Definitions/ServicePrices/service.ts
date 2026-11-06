// Hizmet Fiyat Tablosu — API (`/api/service-prices`; kapı: ticaret + ön muhasebe + hizmet faturası).
// Yollar TAM yazılır (`apiClient.baseURL` `/api` değil). Yazım idempotent: `clientToken` mantıksal deneme başına.
import apiClient from "@/services/apiClient";
import type { Currency, PriceUnit } from "../ItemPrices/service";
import type { ItemLifecycleStatus } from "@/lib/item-lifecycle";

export type { Currency, PriceUnit };

/** Etkin fiyatın kaynağı — backend `ServicePriceSource` ile birebir. */
export type ServicePriceSource = "CUSTOMER_TIER" | "CUSTOMER_GRAM" | "TIER" | "STATION_GRAM" | "ITEM";

export interface PriceCell {
  id: string;
  price: string;
  priceUnit: PriceUnit | null;
  since: string;
  /** Doluysa fiyat bu anda (ileri tarihli fiyatla) değişecek. */
  until: string | null;
}
export interface PendingCell {
  id: string;
  price: string;
  priceUnit: PriceUnit | null;
  validFrom: string;
}
export interface PriceSlot {
  current: PriceCell | null;
  pending: PendingCell | null;
}

export interface ServicePriceTierRow {
  valueId: string;
  code: string;
  name: string;
  amount: string | null;
  isActive: boolean;
  mapped: boolean;
  general: PriceSlot;
  customer: PriceSlot | null;
  customerOverrideCount: number;
  effective: {
    price: string | null;
    source: ServicePriceSource | null;
    tierMissing: boolean;
    gramFormula: string | null;
  };
}

export interface ServicePriceTable {
  item: { id: string; code: string; name: string; unit: string; lifecycleStatus: ItemLifecycleStatus };
  currency: Currency;
  customerId: string | null;
  itemPrice: { general: PriceSlot; customer: PriceSlot | null };
  gram: { customer: string | null; stations: Array<{ id: string; name: string; price: string }> };
  hasTiers: boolean;
  tiers: ServicePriceTierRow[];
}

export interface ServiceListRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  lifecycleStatus: ItemLifecycleStatus;
  tierRowCount: number;
}

export type HistoryState = "ACTIVE" | "SCHEDULED" | "PENDING" | "CLOSED";
export interface HistoryRow {
  id: string;
  price: string;
  priceUnit: PriceUnit | null;
  propertyValueId: string | null;
  tierName: string | null;
  customerId: string | null;
  customerName: string | null;
  validFrom: string;
  until: string | null;
  revokeReason: string | null;
  createdAt: string;
  state: HistoryState;
}

export async function listServices(): Promise<ServiceListRow[]> {
  const res = await apiClient.get("/api/service-prices/services");
  return (res.data as { data: ServiceListRow[] }).data;
}

export async function getServicePriceTable(p: {
  itemId: string;
  currency: Currency;
  customerId: string | null;
}): Promise<ServicePriceTable> {
  const res = await apiClient.get("/api/service-prices/table", {
    params: { itemId: p.itemId, currency: p.currency, ...(p.customerId ? { customerId: p.customerId } : {}) },
  });
  return (res.data as { data: ServicePriceTable }).data;
}

/** `customerId`/`propertyValueId`: `null` = yalnız genel / kalem geneli; atlanmış = hepsi. */
export async function getServicePriceHistory(p: {
  itemId: string;
  currency: Currency;
  customerId?: string | null;
  propertyValueId?: string | null;
}): Promise<HistoryRow[]> {
  const params: Record<string, string> = { currency: p.currency };
  if (p.customerId !== undefined) params.customerId = p.customerId ?? "null";
  if (p.propertyValueId !== undefined) params.propertyValueId = p.propertyValueId ?? "null";
  const res = await apiClient.get(`/api/service-prices/${p.itemId}/history`, { params });
  return (res.data as { data: HistoryRow[] }).data;
}

export interface ServicePriceWrite {
  clientToken: string;
  itemId: string;
  propertyValueId: string | null;
  customerId: string | null;
  currency: Currency;
  price: number;
  priceUnit?: PriceUnit | null;
  /** ISO; null = hemen. */
  validFrom: string | null;
}

export async function writeServicePrice(
  body: ServicePriceWrite,
): Promise<{ data: { id: string; created: boolean }; message?: string }> {
  const res = await apiClient.post("/api/service-prices", body);
  return res.data as { data: { id: string; created: boolean }; message?: string };
}

export async function revokeServicePrice(id: string): Promise<{ message?: string }> {
  const res = await apiClient.post(`/api/service-prices/${id}/revoke`);
  return res.data as { message?: string };
}
