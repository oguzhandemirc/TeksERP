// SY-d: atkı/çözgü kartı düzenlenirken "bu kartı N açık iş emri kullanıyor" bilgisi. Engellemez;
// sayı sunucudan (açık durum kümesi ve etkin kart kuralı backend'de tek kaynak).
import { useQuery } from "@tanstack/react-query";
import { Callout } from "@/components/ui/callout";
import apiClient from "@/services/apiClient";
import { TERIM } from "@/lib/terim";
import type { ApiResponse } from "@/types/api";

export interface SpecOpenOrders {
  weavingOrders: number;
  warpingOrders: number;
  total: number;
  numbers: string[];
}

const PATH = { weft: "/api/weft-specs", warp: "/api/warp-specs" } as const;

export function specOpenOrdersTitle(d: SpecOpenOrders): string {
  const parts = [
    d.weavingOrders > 0 ? `${d.weavingOrders} açık ${TERIM.dokumaIsEmri.tekilKucuk}` : null,
    d.warpingOrders > 0 ? `${d.warpingOrders} açık çözgü emri` : null,
  ].filter(Boolean);
  return `Bu kartı ${parts.join(" ve ")} kullanıyor`;
}

export function specOpenOrdersDetail(d: SpecOpenOrders): string {
  const more = d.total > d.numbers.length ? ` ve ${d.total - d.numbers.length} diğer` : "";
  return `${d.numbers.join(", ")}${more}. Kaydettiğiniz değişiklik bu açık işlerin iş kartına ve planına hemen yansır; bitmiş işlerin kayıtları değişmez.`;
}

export function SpecOpenOrdersNotice({ kind, id }: { kind: "weft" | "warp"; id: string }) {
  const q = useQuery({
    queryKey: ["spec-open-orders", kind, id],
    queryFn: () => apiClient.get<ApiResponse<SpecOpenOrders>>(`${PATH[kind]}/${id}/open-orders`).then((r) => r.data.data),
    staleTime: 30_000,
  });
  if (!q.data || q.data.total === 0) return null;
  return (
    <div data-testid="spec-open-orders">
      <Callout tone="info" title={specOpenOrdersTitle(q.data)}>{specOpenOrdersDetail(q.data)}</Callout>
    </div>
  );
}
