// Cari hızlı bakış verisi (yan panel + kayıt sayfası başlığı). Her sorgu kendi ekranının izin+modül kapısı
// açıkken koşar (kapalı kaynağa 403 isteği atılmaz); hesap yoksa (404) null — uydurma bakiye yok.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useRouteAccess } from "@/hooks/useRouteAccess";
import { getCariByCustomer, listCari, type CariRow } from "@/pages/Finance/service";
import { orderService } from "@/pages/Operations/Orders/service";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { CARI_TARGETS, fetchFasonDispatches, fetchRecentOrders, fetchRecentPayments, fetchRecentShipments, type CariSourceKey } from "./cari-sources";
import { fasonMovement, mergeMovements, orderMovement, paymentMovement, shipmentMovement } from "./cari-movements";

/** Kaynak başına "açılır mı" — sekme/kart/eylem görünürlüğünün tek cevabı. */
export function useCariAccess(): Record<CariSourceKey, boolean> {
  const { canGo } = useRouteAccess();
  const out = {} as Record<CariSourceKey, boolean>;
  for (const k of Object.keys(CARI_TARGETS) as CariSourceKey[]) out[k] = canGo(CARI_TARGETS[k]);
  return out;
}

export function useCustomerRecord(customerId: string | null) {
  return useQuery({
    queryKey: ["customers", "record", customerId],
    queryFn: () => customerService.getById(customerId as string).then((r) => r.data as Customer),
    enabled: Boolean(customerId),
    staleTime: 15_000,
  });
}

/** Kartın cari hesabı + vadesi geçmiş (para birimi başına). Hesap yoksa null. */
async function fetchAccount(customerId: string): Promise<CariRow | null> {
  const acc = await getCariByCustomer(customerId);
  if (!acc) return null;
  const withOverdue = await listCari({ page: 1, pageSize: 1, filters: { id: acc.id }, withOverdue: true });
  return withOverdue.data?.find((r) => r.id === acc.id) ?? acc;
}

export function useCariAccount(customerId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["finance", "cari", "overview", customerId],
    queryFn: () => fetchAccount(customerId as string),
    enabled: enabled && Boolean(customerId),
    staleTime: 15_000,
  });
}

export function useCariOrderStats(customerId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["orders", "stats", "cari", customerId],
    queryFn: () => orderService.getStats({ page: 1, pageSize: 1, sortBy: "createdAt", sortOrder: "desc", filters: { customerId: customerId as string } }).then((r) => r.data),
    enabled: enabled && Boolean(customerId),
    staleTime: 15_000,
  });
}

interface MovementArgs {
  customerId: string | null;
  cariAccountId: string | null;
  subcontractorId: string | null;
  access: Record<CariSourceKey, boolean>;
  limit?: number;
}

/** Son hareketler — sipariş · sevk · tahsilat/ödeme · fasona giden; açık kaynaklardan birleşik. */
export function useCariMovements({ customerId, cariAccountId, subcontractorId, access, limit = 5 }: MovementArgs) {
  const qs = useQueries({
    queries: [
      { queryKey: ["orders", "cari-recent", customerId, limit], queryFn: () => fetchRecentOrders(customerId!, limit).then((r) => r.map(orderMovement)), enabled: access.orders && Boolean(customerId) },
      { queryKey: ["shipments", "cari-recent", customerId, limit], queryFn: () => fetchRecentShipments(customerId!, limit).then((r) => r.map(shipmentMovement)), enabled: access.shipments && Boolean(customerId) },
      { queryKey: ["finance", "payments", "cari-recent", cariAccountId, limit], queryFn: () => fetchRecentPayments(cariAccountId!, limit).then((r) => r.map(paymentMovement)), enabled: access.payments && Boolean(cariAccountId) },
      { queryKey: ["subcontractor", "dispatches", "cari-recent", subcontractorId, limit], queryFn: () => fetchFasonDispatches(subcontractorId!, limit).then((r) => r.map(fasonMovement)), enabled: access.fason && Boolean(subcontractorId) },
    ],
  });
  const loading = qs.some((q) => q.isLoading);
  const error = qs.some((q) => q.isError);
  const items = mergeMovements(qs.map((q) => q.data ?? []), limit);
  return { items, loading, error, retry: () => qs.forEach((q) => void q.refetch()) };
}
