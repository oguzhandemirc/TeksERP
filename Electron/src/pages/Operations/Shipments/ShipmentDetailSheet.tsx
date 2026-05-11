import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { StatusBadge, shipmentStatusTones } from "@/components/operations/StatusBadge";
import { shipmentStatusLabels } from "@/types/enums";
import { safeFormat, formatNumber } from "@/lib/format";
import { shipmentService } from "./service";
import type { Shipment } from "./types";

interface Props {
  shipment: Shipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShipmentDetailSheet({ shipment, open, onOpenChange }: Props) {
  const detail = useQuery({
    queryKey: ["shipment-detail", shipment?.id],
    queryFn: () => shipmentService.getById(shipment!.id),
    enabled: open && Boolean(shipment?.id),
    // Detay paneli her açılışta refetch atmaz; mutation sonrası
    // `invalidateQueries(['shipment-detail', id])` ile tazelenir.
    staleTime: 60_000,
  });

  const ship = detail.data?.data ?? shipment;
  const items = ship?.items ?? [];
  const totalQty = items.reduce((a, i) => a + i.shippedQty, 0);
  const totalKg = items.reduce((a, i) => a + (i.shippedWeight ?? 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{ship?.shipmentNumber}</span>
            {ship && (
              <StatusBadge
                status={ship.status}
                labels={shipmentStatusLabels}
                tones={shipmentStatusTones}
              />
            )}
          </SheetTitle>
          <SheetDescription>
            {ship?.customer?.name ?? ship?.customerNameSnapshot}
            {(ship?.branch?.name ?? ship?.branchNameSnapshot) && (
              <> · {ship?.branch?.name ?? ship?.branchNameSnapshot}</>
            )}
          </SheetDescription>
        </SheetHeader>

        {detail.isLoading && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {ship && !detail.isLoading && (
          <div className="mt-4 space-y-4">
            {ship.status === "PREPARING" && (
              <PermissionGate permission="shipment:write">
                <Button asChild size="sm" className="w-full gap-1.5">
                  <Link to={`/operations/shipments/${ship.id}/edit`}>
                    <Pencil className="h-4 w-4" /> Düzenle ve Onayla
                  </Link>
                </Button>
              </PermissionGate>
            )}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Top Sayısı</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {ship._count?.items ?? items.length}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Toplam Metre</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {formatNumber(totalQty, 0)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Toplam Kg</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {formatNumber(totalKg, 1)}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="space-y-1 p-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <div className="text-xs text-muted-foreground">Oluşturma</div>
                  <div className="text-xs">{safeFormat(ship.createdAt, "dd.MM.yyyy HH:mm")}</div>
                  {ship.plannedDate && (
                    <>
                      <div className="text-xs text-muted-foreground">Planlanan Sevk</div>
                      <div className="text-xs">{safeFormat(ship.plannedDate, "dd.MM.yyyy")}</div>
                    </>
                  )}
                  {ship.shippedAt && (
                    <>
                      <div className="text-xs text-muted-foreground">Sevk Zamanı</div>
                      <div className="text-xs">{safeFormat(ship.shippedAt, "dd.MM.yyyy HH:mm")}</div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {(ship.driverName || ship.plateNumber || ship.carrier) && (
              <Card>
                <CardContent className="space-y-1 p-3 text-sm">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Nakliye
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                    {ship.carrier && (
                      <>
                        <div className="text-muted-foreground">Firma</div>
                        <div>{ship.carrier}</div>
                      </>
                    )}
                    {ship.driverName && (
                      <>
                        <div className="text-muted-foreground">Şoför</div>
                        <div>{ship.driverName}</div>
                      </>
                    )}
                    {ship.plateNumber && (
                      <>
                        <div className="text-muted-foreground">Plaka</div>
                        <div className="font-mono">{ship.plateNumber}</div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {items.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Sevk Edilen Toplar ({items.length})
                </div>
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li key={item.id} className="rounded-md border p-2.5 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs">
                              {item.rollBarcodeSnapshot ?? item.rollId}
                            </span>
                            {item.orderNumberSnapshot && (
                              <Badge variant="muted" className="text-[10px]">
                                {item.orderNumberSnapshot}
                              </Badge>
                            )}
                          </div>
                          {(item.itemCodeSnapshot ?? item.itemNameSnapshot) && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {item.itemCodeSnapshot} · {item.itemNameSnapshot}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="tabular-nums text-sm">
                            {formatNumber(item.shippedQty, 0)} m
                          </div>
                          {item.shippedWeight != null && (
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              {formatNumber(item.shippedWeight, 1)} kg
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ship.plannedOrders && ship.plannedOrders.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Planlanan Siparişler ({ship.plannedOrders.length})
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {ship.plannedOrders.map((p) => (
                    <li key={p.id}>
                      <Badge variant="muted" className="font-mono text-[10px]">
                        {p.order?.orderNumber ?? p.orderId}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
