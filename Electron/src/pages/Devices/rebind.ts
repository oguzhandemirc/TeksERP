import { useQuery } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { deviceService } from "./service";
import type { RebindRequest } from "./types";

export const REBIND_QUERY_KEY = "admin-device-rebind-requests";

/**
 * Yeniden bağlama talepleri (cihaz eşleme v2). Eski backend 404 verir → `null`
 * (bölüm ve sayaç gizlenir). Sayfa bölümü ve Yetkilendirme karosu AYNI sorguyu okur.
 */
export function useRebindRequests() {
  const { hasPermission } = useRoleAccess();
  const tabActive = useIsTabActive();
  return useQuery({
    queryKey: [REBIND_QUERY_KEY],
    queryFn: deviceService.rebindRequests,
    enabled: hasPermission("admin:settings"),
    retry: false,
    refetchInterval: tabActive ? 60_000 : false,
  });
}

export function openRebindRequests(list: RebindRequest[] | null | undefined): RebindRequest[] {
  return (list ?? []).filter((r) => r.status === "OPEN");
}
