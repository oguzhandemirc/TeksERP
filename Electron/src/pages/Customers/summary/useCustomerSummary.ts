import { useQuery } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useCustomerFinanceAccess } from "../CustomerFinanceSection";
import { customerSummaryService as svc } from "./customerSummaryService";

// Bölüm izinleri backend uç kapılarının AYNASIDIR (`requireAnyPermission` listeleri):
// izni olmayan kullanıcı için istek HİÇ atılmaz, bölüm çizilmez (403 yutulmaz).
export const SUMMARY_PERMS = {
  orders: ["order:read", "mobile:siparis"],
  shipping: ["shipping:read", "shipping:write", "mobile:tarti-paket", "mobile:sevkiyat"],
  returns: ["return:read", "return:write", "mobile:iade"],
} as const;

/** "Tümünü gör" bağlantısının hedef route izni (`content-routes.tsx`). */
export const SUMMARY_ROUTE_PERMS = { orders: "order:read", shipping: "shipping:read", returns: "return:read" } as const;

export function useCustomerSummaryAccess() {
  const { hasAnyPermission, hasPermission } = useRoleAccess();
  const finance = useCustomerFinanceAccess();
  return {
    orders: hasAnyPermission([...SUMMARY_PERMS.orders]),
    shipping: hasAnyPermission([...SUMMARY_PERMS.shipping]),
    returns: hasAnyPermission([...SUMMARY_PERMS.returns]),
    /** Tutar/bakiye yalnız finans okuma kapısıyla (modül açık + `finance:read`). */
    amounts: finance.canRead,
    link: {
      orders: hasPermission(SUMMARY_ROUTE_PERMS.orders),
      shipping: hasPermission(SUMMARY_ROUTE_PERMS.shipping),
      returns: hasPermission(SUMMARY_ROUTE_PERMS.returns),
    },
  };
}

export type CustomerSummaryAccess = ReturnType<typeof useCustomerSummaryAccess>;

// Bakış özeti, karar verisi değil: 30 sn tazelik sekme gidip gelişinde yeniden çekmez.
const STALE = 30_000;

export function useCustomerSummaryQueries(customerId: string, access: CustomerSummaryAccess) {
  const key = ["customers", "summary", customerId] as const;
  return {
    orders: useQuery({ queryKey: [...key, "orders"], queryFn: () => svc.recentOrders(customerId), enabled: access.orders, staleTime: STALE }),
    stats: useQuery({ queryKey: [...key, "order-stats"], queryFn: () => svc.orderStats(customerId), enabled: access.orders, staleTime: STALE }),
    open: useQuery({ queryKey: [...key, "open-orders"], queryFn: () => svc.openOrders(customerId), enabled: access.shipping, staleTime: STALE }),
    shipments: useQuery({ queryKey: [...key, "shipments"], queryFn: () => svc.dispatchedShipments(customerId), enabled: access.shipping, staleTime: STALE }),
    returns: useQuery({ queryKey: [...key, "returns"], queryFn: () => svc.returns(customerId), enabled: access.returns, staleTime: STALE }),
    cari: useQuery({ queryKey: [...key, "cari"], queryFn: () => svc.cari(customerId), enabled: access.amounts, staleTime: STALE }),
  };
}

export type CustomerSummaryQueries = ReturnType<typeof useCustomerSummaryQueries>;
