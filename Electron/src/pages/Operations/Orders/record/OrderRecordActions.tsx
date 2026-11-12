// Kayıt sayfası eylem şeridi — hızlı eylemler + takip + "Diğer" menüsü (elle kapat · iptal; sheet'teki diyaloglar).
// İzni/durumu uymayan eylem çizilmez.
import { useState } from "react";
import { Ban, Lock, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FollowButton } from "@/components/bildirim/FollowButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { OrderCancelDialog } from "../OrderCancelDialog";
import { OrderManualCloseDialog } from "../OrderManualCloseDialog";
import type { Order } from "../types";
import { isOrderCancellable, isOrderClosable } from "./order-record";
import { OrderQuickActions } from "./OrderQuickActions";

export function OrderRecordActions({ order, onEdit }: { order: Order; onEdit: (o: Order) => void }) {
  const { hasPermission } = useRoleAccess();
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const write = hasPermission("order:write");
  const canClose = write && isOrderClosable(order);
  const canCancel = write && isOrderCancellable(order);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <OrderQuickActions order={order} onEdit={onEdit} />
      <FollowButton type="siparis" id={order.id} className="h-8 gap-1 text-xs" />
      {(canClose || canCancel) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Diğer eylemler" title="Diğer eylemler">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canClose && (
              <DropdownMenuItem onSelect={() => setCloseOpen(true)} title="Eksik sevkiyat olsa bile siparişi tamamlanmış işaretler">
                <Lock className="h-4 w-4" /> Manuel kapat
              </DropdownMenuItem>
            )}
            {canCancel && (
              <DropdownMenuItem onSelect={() => setCancelOpen(true)} className="text-destructive focus:text-destructive">
                <Ban className="h-4 w-4" /> İptal et
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <OrderManualCloseDialog open={closeOpen} onOpenChange={setCloseOpen} orderId={order.id} />
      <OrderCancelDialog open={cancelOpen} onOpenChange={setCancelOpen} orderId={order.id} orderNumber={order.orderNumber} onCancelled={() => setCancelOpen(false)} />
    </div>
  );
}
