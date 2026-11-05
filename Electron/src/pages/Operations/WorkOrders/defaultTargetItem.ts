// İE varsayılan stok kartı (`workorder.defaultTargetItemId`): hedef kumaşı boş bırakılan stoğa üretim İE'si bu kartla açılır.
// Öncelik sunucuda (elle > müşteri varsayılanı > İE varsayılanı > gelen belge fabrika varsayılanı); panel yalnız ipucu çizer.
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";

export interface DefaultTargetItemView {
  id: string;
  code: string;
  name: string;
  /** null = kullanılabilir; dolu = açılışta 409 verecek sebep. */
  problem: string | null;
}

export interface DefaultTargetItemResponse {
  item: DefaultTargetItemView | null;
  source: "CUSTOMER" | "WORK_ORDER" | "FACTORY" | null;
  workOrderDefault: DefaultTargetItemView | null;
}

export const DEFAULT_TARGET_ITEM_QUERY_KEY = ["work-orders", "default-target-item"] as const;

export async function getDefaultTargetItem(): Promise<DefaultTargetItemResponse> {
  return (await apiClient.get<ApiResponse<DefaultTargetItemResponse>>("/api/work-orders/default-target-item")).data.data;
}

export function updateDefaultTargetItem(itemId: string | null): Promise<DefaultTargetItemView | null> {
  return withSettingsPassword((headers) =>
    apiClient.put<ApiResponse<DefaultTargetItemView | null>>("/api/feature-flags/work-order-default-item", { itemId }, { headers }).then((r) => r.data.data),
  );
}

/** Eski backend (uç yok) → hata; çağıran ipucunu çizmez (bugünkü davranış). */
export function useDefaultTargetItem(enabled = true) {
  return useQuery({ queryKey: DEFAULT_TARGET_ITEM_QUERY_KEY, queryFn: getDefaultTargetItem, enabled, staleTime: 60_000, retry: false });
}

/** Boş hedefte gösterilecek ipucu; kullanılamaz kart ipucu değil uyarıdır. */
export function defaultTargetHint(d: DefaultTargetItemResponse | undefined): { text: string; usable: boolean } | null {
  const it = d?.item;
  if (!it) return null;
  return it.problem
    ? { text: `Varsayılan stok kartı kullanılamıyor (${it.name}): ${it.problem}`, usable: false }
    : { text: `Boş bırakılırsa: ${it.name}`, usable: true };
}
