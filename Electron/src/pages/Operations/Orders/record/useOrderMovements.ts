// Yan panel ve Genel sekmesinin "son hareketler" listesi — sevkiyat + dokuma işi + bağlı iş emri.
import { useQuery } from "@tanstack/react-query";
import type { Order } from "../types";
import { mergeOrderMovements, shipmentMovement, weavingMovement, workOrderMovements, type OrderMovement } from "./order-movements";
import { orderShipmentsQuery, orderWeavingQuery, type OrderAccess } from "./useOrderRecordData";

export interface OrderMovementsState {
  items: OrderMovement[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}

export function useOrderMovements(order: Pick<Order, "id" | "lines">, access: OrderAccess, limit = 5): OrderMovementsState {
  const ships = useQuery(orderShipmentsQuery(order.id));
  const weaving = useQuery({ ...orderWeavingQuery(order.id), enabled: access.weaving });
  const items = mergeOrderMovements(
    [
      (ships.data?.data?.shipments ?? []).map((r, i) => shipmentMovement(r, i, access.shipments)),
      (weaving.data ?? []).map(weavingMovement),
      access.production ? workOrderMovements(order.lines, access.workOrders) : [],
    ],
    limit,
  );
  return {
    items,
    loading: ships.isLoading || (access.weaving && weaving.isLoading),
    error: ships.isError,
    retry: () => {
      void ships.refetch();
      if (access.weaving) void weaving.refetch();
    },
  };
}
