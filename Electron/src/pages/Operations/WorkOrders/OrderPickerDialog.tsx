import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { orderService } from "@/pages/Operations/Orders/service";
import type { Order, OrderLine } from "@/pages/Operations/Orders/types";

export interface PickedOrderLineProperty {
  id: string;
  name: string;
}

export interface PickedOrderLine {
  lineId: string;
  orderId: string;
  orderNumber: string;
  orderDeadline: string | null;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  itemColorHex: string | null;
  itemColorName: string | null;
  quantity: number;
  width: number | null;
  requiredProperties: PickedOrderLineProperty[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSelectedIds: string[];
  onConfirm: (lines: PickedOrderLine[]) => void;
}

function buildPicked(order: Order, line: OrderLine): PickedOrderLine {
  return {
    lineId: line.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderDeadline: order.deadline,
    customerId: order.customerId,
    customerName: order.customer?.name ?? "—",
    itemId: line.itemId,
    itemName: line.item?.name ?? "—",
    itemColorHex: line.item?.color?.hex ?? null,
    itemColorName: line.item?.color?.name ?? null,
    quantity: line.quantity,
    width: line.width ?? null,
    requiredProperties: (line.requiredProperties ?? []).map((rp) => ({
      id: rp.propertyId,
      name: rp.property.name,
    })),
  };
}

export function OrderPickerDialog({ open, onOpenChange, initialSelectedIds, onConfirm }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelected(new Set(initialSelectedIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDebounced("");
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: ["orders", "wo-picker", debounced],
    queryFn: () =>
      orderService.getAll({
        page: 1,
        pageSize: 50,
        sortBy: "deadline",
        sortOrder: "asc",
        search: debounced || undefined,
        filters: { status: "APPROVED,PARTIAL_SHIPPED" },
      }),
    enabled: open,
    staleTime: 30_000,
  });

  const orders = query.data?.data ?? [];

  const toggle = (lineId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const toggleOrder = (order: Order, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const line of order.lines ?? []) {
        if (checked) next.add(line.id);
        else next.delete(line.id);
      }
      return next;
    });
  };

  const orderAllSelected = (o: Order) =>
    (o.lines ?? []).length > 0 && (o.lines ?? []).every((l) => selected.has(l.id));

  const handleConfirm = () => {
    const picked: PickedOrderLine[] = [];
    for (const order of orders) {
      for (const line of order.lines ?? []) {
        if (selected.has(line.id)) picked.push(buildPicked(order, line));
      }
    }
    onConfirm(picked);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Müsait Sipariş Kalemleri</DialogTitle>
          <DialogDescription>
            Onaylı ve kısmi sevk edilmiş sipariş kalemleri. İş emrine bağlanacakları seç.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sipariş no veya müşteri ara..."
              className="h-10 pl-9"
            />
          </div>
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            {selected.size > 0 ? (
              <span>
                <span className="font-medium text-foreground">{selected.size}</span> kalem seçildi
              </span>
            ) : (
              <span>{orders.length} sipariş</span>
            )}
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto rounded-md border">
          {query.isLoading && (
            <div className="p-6 text-sm text-muted-foreground">Yükleniyor...</div>
          )}
          {!query.isLoading && orders.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {debounced ? "Sonuç yok." : "Müsait sipariş yok."}
            </div>
          )}
          <ul className="divide-y">
            {orders.map((order) => (
              <li key={order.id} className="p-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <Checkbox
                    checked={orderAllSelected(order)}
                    onCheckedChange={(c) => toggleOrder(order, Boolean(c))}
                  />
                  <span className="font-mono text-sm font-semibold">{order.orderNumber}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-sm">{order.customer?.name}</span>
                  {order.deadline && (
                    <Badge variant="muted" className="ml-auto">
                      Termin: {new Date(order.deadline).toLocaleDateString("tr-TR")}
                    </Badge>
                  )}
                </div>
                <div className="ml-7 grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {(order.lines ?? []).map((line) => (
                    <div
                      key={line.id}
                      className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm"
                    >
                      <Checkbox
                        checked={selected.has(line.id)}
                        onCheckedChange={() => toggle(line.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{line.item?.name ?? "—"}</span>
                          {line.item?.color && (
                            <Badge variant="muted" className="gap-1">
                              {line.item.color.hex && (
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: line.item.color.hex }}
                                />
                              )}
                              {line.item.color.name}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {line.quantity.toLocaleString("tr-TR")} m
                          {line.width ? ` × ${line.width} cm` : ""}
                        </div>
                        {line.requiredProperties && line.requiredProperties.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">
                              Özellik:
                            </span>
                            {line.requiredProperties.map((rp) => (
                              <Badge
                                key={rp.propertyId}
                                variant="outline"
                                className="text-[10px]"
                              >
                                {rp.property.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button type="button" disabled={selected.size === 0} onClick={handleConfirm}>
            {selected.size > 0 ? `Seçili ${selected.size} Kalemi Ekle` : "Seç"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
