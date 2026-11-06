// "Hedef kumaş" boşken "Boş bırakılırsa: <kart>" ipucu. Sıra sunucuda (açılışla aynı yüklem): elle > müşteri varsayılanı >
// İE varsayılan stok kartı > gelen belge fabrika varsayılanı. Eski backend (uç yok) → ipucu yok (bugünkü davranış).
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../../services/api';
import type { ApiResponse } from '../../../../types/api';

export interface DefaultTargetItem {
  item: { id: string; code: string; name: string; problem: string | null } | null;
  source: 'CUSTOMER' | 'WORK_ORDER' | 'FACTORY' | null;
}

export async function fetchDefaultTargetItem(customerId: string | null): Promise<DefaultTargetItem> {
  const q = customerId ? `?forNote=true&customerId=${encodeURIComponent(customerId)}` : '?forNote=true';
  return (await apiClient.get<ApiResponse<DefaultTargetItem>>(`/work-orders/default-target-item${q}`)).data.data;
}

const SOURCE_LABEL: Record<NonNullable<DefaultTargetItem['source']>, string> = {
  CUSTOMER: 'müşteri varsayılanı',
  WORK_ORDER: 'İE varsayılanı',
  FACTORY: 'fabrika varsayılanı',
};

/** İpucu metni; kullanılamaz kart (açılışta 409) uyarı olarak söylenir. */
export function defaultTargetHintText(d: DefaultTargetItem | undefined): string | null {
  if (!d?.item || !d.source) return null;
  if (d.item.problem) return `Varsayılan kart kullanılamıyor (${d.item.name}) — hedef kumaş seçin`;
  return `Boş bırakılırsa: ${d.item.name} (${SOURCE_LABEL[d.source]})`;
}

export function useDefaultTargetHint(customerId: string | null, enabled: boolean): string | null {
  const q = useQuery({
    queryKey: ['work-orders', 'default-target-item', customerId ?? ''],
    queryFn: () => fetchDefaultTargetItem(customerId),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  return defaultTargetHintText(q.data);
}
