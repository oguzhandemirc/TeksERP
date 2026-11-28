// Kabul satırı GÖVDE SEÇİCİSİ (devere D3) — `GET /api/warping-orders/:id/receive-body-options`. Seçenekler ve sıra
// sunucudan (bu siparişle gidenler önce); burada yalnız biçim ve "farklı gövde" işareti (seçilen ∉ gönderilenler).
// Seçim opsiyoneldir; gönderilenden farklı gövde kabulü engellenmez (devereci gövdeyi sonraya saklayabilir).
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ReceiveBodyDraft } from "./receive-model";
import { WARPING_ORDERS_QUERY_KEY } from "./service";

export interface ReceiveBodyOption {
  id: string;
  bodyNo: string;
  owner: { kind: "OURS" | "WARPER" | "CUSTOMER" | "OTHER"; label: string; customer: { id: string; code: string; name: string } | null };
  sentWith: { dispatchId: string; dispatchNo: string; warpingOrderId: string | null; orderNo: string | null; at: string } | null;
  statusSince: string;
  statusAgeDays: number;
  sentWithOrder: boolean;
}

export interface ReceiveBodyOptions {
  subcontractorId: string;
  sent: Array<{ id: string; bodyNo: string; status: string; statusLabel: string; atThisWarper: boolean; dispatchNo: string }>;
  options: ReceiveBodyOption[];
}

export const getReceiveBodyOptions = (orderId: string) =>
  apiClient.get<ApiResponse<ReceiveBodyOptions>>(`/api/warping-orders/${orderId}/receive-body-options`).then((r) => r.data.data as ReceiveBodyOptions);

export function useReceiveBodyOptions(orderId: string, enabled: boolean) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "receive-body-options", orderId], queryFn: () => getReceiveBodyOptions(orderId), enabled });
}

/** Seçenek satırının ikincil metni: nereden geldi + sahip (bizim değilse). */
export function optionHint(o: ReceiveBodyOption): string {
  const where = o.sentWithOrder ? "bu siparişle gönderildi" : o.sentWith?.orderNo ? `${o.sentWith.orderNo} ile gönderildi` : `${o.statusAgeDays} gündür deverecide`;
  return o.owner.kind === "OURS" ? where : `${where} · ${o.owner.customer?.name ?? o.owner.label}`;
}

/** Satırda seçilebilecekler: başka satırda seçilmiş gövde tekrar önerilmez (sunucu da 400 verir). */
export function availableOptions(choices: ReceiveBodyOptions | undefined, takenIds: ReadonlySet<string>): ReceiveBodyOption[] {
  return (choices?.options ?? []).filter((o) => !takenIds.has(o.id));
}

/**
 * "Farklı gövde": bu siparişle gövde gönderilmişken satırdaki gövde onlardan biri değil (yerinde tanımlanan yeni gövde dahil).
 * Gövde hiç gönderilmediyse kıyas yok → işaret yok. Bilgi amaçlıdır, kabulü engellemez.
 */
export function isDifferentBody(draft: ReceiveBodyDraft | null | undefined, choices: ReceiveBodyOptions | undefined): boolean {
  if (!draft || !choices || choices.sent.length === 0) return false;
  return draft.kind === "new" || !choices.sent.some((s) => s.id === draft.id);
}

export const sentBodiesText = (choices: ReceiveBodyOptions | undefined): string => (choices?.sent ?? []).map((s) => s.bodyNo).join(", ");
