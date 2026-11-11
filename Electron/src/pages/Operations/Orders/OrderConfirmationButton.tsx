// SY-3 L1 "Sipariş teyidi" — genel basılı belge akışı (ORDER_CONFIRMATION, kaynak = sipariş). İlk açılışta donar,
// sürümler ve yeniden basım diyalogda (`order:write`); iptal siparişte belge VOIDED gelir. Okuma izni sipariş uçlarıyla aynı.
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { CommercialDocButton } from "@/pages/Cost/shared/CommercialDocButton";
import type { Order } from "./types";

export const ORDER_CONFIRMATION_READ = ["order:read", "order:write"];

export function OrderConfirmationButton({
  order,
  className,
}: {
  order: Pick<Order, "id" | "orderNumber" | "customer">;
  className?: string;
}) {
  const { hasPermission } = useRoleAccess();
  if (!ORDER_CONFIRMATION_READ.some((p) => hasPermission(p))) return null;
  return (
    <span className={className}>
      <CommercialDocButton
        docType="ORDER_CONFIRMATION"
        sourceId={order.id}
        label={`Sipariş ${order.orderNumber}${order.customer?.name ? ` · ${order.customer.name}` : ""}`}
        draft={false}
        buttonLabel="Sipariş teyidi"
      />
    </span>
  );
}
