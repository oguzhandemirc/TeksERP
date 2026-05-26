import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { safeFormat } from "@/lib/format";
import { Lock, Pencil, Ban } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PermissionGate } from "@/components/PermissionGate";
import { StatusBadge, orderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { orderStatusLabels } from "@/types/enums";
import { orderService } from "./service";
import { OrderCancelDialog } from "./OrderCancelDialog";
import type { Order } from "./types";

interface Props {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (order: Order) => void;
}

export function OrderDetailSheet({ order, open, onOpenChange, onEdit }: Props) {
  const qc = useQueryClient();
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const closeMut = useMutation({
    mutationFn: ({ id, r }: { id: string; r: string }) => orderService.manualClose(id, r),
    onSuccess: () => {
      toast.success("Sipariş manuel olarak kapatıldı.");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      setCloseOpen(false);
      setReason("");
      onOpenChange(false);
    },
  });

  const totalQty = order?.lines.reduce((acc, l) => acc + Number(l.quantity), 0) ?? 0;
  const isEditable = order && (order.status === "APPROVED" || order.status === "PARTIAL_SHIPPED");
  const isCancellable = order && order.status !== "COMPLETED" && order.status !== "CANCELLED";
  const canClose = order && (order.status === "PENDING" || order.status === "APPROVED" || order.status === "PARTIAL_SHIPPED");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{order?.orderNumber}</span>
            {order && (
              <StatusBadge
                status={order.status}
                labels={orderStatusLabels}
                tones={orderStatusTones}
              />
            )}
          </SheetTitle>
          <SheetDescription>
            {order?.customer?.name}
            {order?.branch && (
              <>
                {" — "}
                <span className="font-medium text-foreground">Şube: {order.branch.name}</span>
                {(order.branch.city || order.branch.district) && (
                  <span className="text-muted-foreground">
                    {" ("}
                    {[order.branch.district, order.branch.city].filter(Boolean).join(" / ")}
                    {")"}
                  </span>
                )}
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        {order && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Sipariş Tarihi</div>
                  <div className="font-medium">{safeFormat(order.orderDate, "dd.MM.yyyy")}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Termin</div>
                  <div className="mt-1">
                    <DeadlineBadge deadline={order.deadline} />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Toplam</div>
                  <div className="font-medium tabular-nums">
                    {totalQty.toLocaleString("tr-TR")} m
                  </div>
                </CardContent>
              </Card>
            </div>

            {order.completedAt && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-medium">
                  Tamamlandı: {safeFormat(order.completedAt, "dd.MM.yyyy HH:mm")}
                </div>
                {order.manualCloseReason && (
                  <div className="mt-1 text-muted-foreground">
                    Manuel kapatma sebebi: {order.manualCloseReason}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sipariş Kalemleri ({order.lines.length})
              </div>
              <ul className="space-y-2">
                {order.lines.map((line) => (
                  <li key={line.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs">{line.item?.code}</span>
                          <span className="font-medium">{line.item?.name}</span>
                          {line.color && (
                            <Badge variant="muted" className="gap-1 text-[10px]">
                              {line.color.hex && (
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: line.color.hex }}
                                />
                              )}
                              {line.color.name}
                            </Badge>
                          )}
                          {line.customerItemName && (
                            <Badge variant="outline" className="text-[10px]">
                              Müşteride: {line.customerItemName}
                              {line.customerColorName ? ` · ${line.customerColorName}` : ""}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>
                            <span className="font-medium text-foreground">
                              {line.quantity.toLocaleString("tr-TR")}
                            </span>{" "}
                            metre
                          </span>
                          {line.width != null && <span>En: {line.width} cm</span>}
                          {line.unitPrice && (
                            <span>
                              {line.unitPrice} {order.currency}
                            </span>
                          )}
                        </div>
                        {line.requiredProperties && line.requiredProperties.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">
                              Özellik:
                            </span>
                            {line.requiredProperties.map((p) => (
                              <Badge key={p.propertyId} variant="muted" className="text-[10px]">
                                {p.property.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <PermissionGate permission="order:write">
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {isEditable && onEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(order)}
                    className="gap-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Düzenle
                  </Button>
                )}
                {canClose && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCloseOpen(true)}
                    className="gap-1.5"
                  >
                    <Lock className="h-3.5 w-3.5" /> Manuel Kapat
                  </Button>
                )}
                {isCancellable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCancelOpen(true)}
                    className="ml-auto gap-1.5 text-destructive hover:text-destructive"
                  >
                    <Ban className="h-3.5 w-3.5" /> İptal Et
                  </Button>
                )}
              </div>
              {canClose && (
                <p className="text-xs text-muted-foreground">
                  Manuel Kapat: eksik sevkiyat olsa bile tamamlanmış işaretler.
                </p>
              )}
            </PermissionGate>
          </div>
        )}

        <OrderCancelDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          orderId={order?.id ?? null}
          orderNumber={order?.orderNumber}
          onCancelled={() => onOpenChange(false)}
        />

        <Dialog
          open={closeOpen}
          onOpenChange={(open) => {
            setCloseOpen(open);
            if (!open) setReason("");
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Siparişi manuel kapat</DialogTitle>
              <DialogDescription>
                Bu işlem siparişi "Tamamlandı" duruma alır ve audit log'a düşer. Sebep zorunludur.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Örn: müşteri talebi, fire kabul edildi..."
              autoFocus
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCloseOpen(false);
                  setReason("");
                }}
              >
                İptal
              </Button>
              <Button
                disabled={!reason.trim() || closeMut.isPending}
                onClick={() => {
                  if (!order) return;
                  closeMut.mutate({ id: order.id, r: reason.trim() });
                }}
              >
                {closeMut.isPending ? "Kapatılıyor..." : "Kapat"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
