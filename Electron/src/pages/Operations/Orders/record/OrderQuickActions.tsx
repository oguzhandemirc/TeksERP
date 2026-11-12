// Sipariş hızlı eylemleri — izni/modülü/ayarı kapalı olan HİÇ çizilmez. Üretime gönder ve Sipariş teyidi
// mevcut düğmelerdir (kendi kapıları ve diyaloglarıyla); düzenle form sahibine (`useOrderFormHost`) gider.
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import { OrderConfirmationButton } from "../OrderConfirmationButton";
import { ProductionProposalButton } from "../production-proposal/ProductionProposalButton";
import type { Order } from "../types";
import { isOrderEditable } from "./order-record";

export function OrderQuickActions({ order, onEdit, className }: { order: Order; onEdit?: ((o: Order) => void) | null; className?: string }) {
  const { hasPermission } = useRoleAccess();
  const canEdit = Boolean(onEdit) && hasPermission("order:write") && isOrderEditable(order);
  return (
    <div data-order-actions="" className={cn("flex flex-wrap items-center gap-2", className)}>
      {canEdit && (
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => onEdit?.(order)}>
          <Pencil className="h-3.5 w-3.5" /> Düzenle
        </Button>
      )}
      <ProductionProposalButton order={order} />
      <OrderConfirmationButton order={order} />
    </div>
  );
}
