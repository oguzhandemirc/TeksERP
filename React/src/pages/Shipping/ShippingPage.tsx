import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Truck,
  Package,
  PackagePlus,
  ChevronDown,
  ChevronRight,
  Ruler,
  ShoppingCart,
  FileText,
  Clock,
  CheckCircle2,
  Handshake,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { shippingService } from "@/services/shippingService";
import { orderStatusLabels, shipmentStatusLabels } from "@/types/enums";
import type { OrderStatus, ShipmentStatus } from "@/types/enums";
import type { ReadyOrderView, Shipment } from "@/types/models";
import PreparePackageDialog from "./PreparePackageDialog";
import CreateShipmentDialog from "./CreateShipmentDialog";
import ShipmentDetailPanel from "./ShipmentDetailPanel";

const statusColorMap: Record<string, string> = {
  APPROVED:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  IN_PRODUCTION:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  PARTIAL_SHIPPED:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const shipmentStatusColorMap: Record<string, string> = {
  PREPARING:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  SHIPPED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function ShippingPage() {
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const [packageRolls, setPackageRolls] = useState<
    { rollId: string; barcode: string }[]
  >([]);
  const [shipmentDialogOpen, setShipmentDialogOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>();
  const [activeShipmentId, setActiveShipmentId] = useState<string | null>(null);

  const { data: readyData, isLoading } = useQuery({
    queryKey: ["ready-orders"],
    queryFn: () => shippingService.getReadyOrders(),
    refetchInterval: 30000,
  });

  const { data: readyFasonData } = useQuery({
    queryKey: ["ready-fason"],
    queryFn: () => shippingService.getReadyFason(),
    refetchInterval: 30000,
  });

  const { data: preparingData } = useQuery({
    queryKey: ["shipments", "PREPARING"],
    queryFn: () => shippingService.list({ status: "PREPARING" }),
    refetchInterval: 30000,
  });

  const { data: shippedData } = useQuery({
    queryKey: ["shipments", "SHIPPED"],
    queryFn: () => shippingService.list({ status: "SHIPPED" }),
    refetchInterval: 60000,
  });

  const readyOrders = readyData?.data ?? [];
  const readyFasonGroups = readyFasonData?.data ?? [];
  const preparingShipments = preparingData?.data ?? [];
  const shippedShipments = shippedData?.data ?? [];

  const toggleOrder = (orderId: string) => {
    setExpandedOrder((prev) => (prev === orderId ? null : orderId));
  };

  const handlePackageRolls = (
    rolls: { rollId: string; barcode: string }[],
  ) => {
    setPackageRolls(rolls);
    setPackageDialogOpen(true);
  };

  const handleCreateShipment = (customerId?: string) => {
    setSelectedCustomerId(customerId);
    setShipmentDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Sevkiyat</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleCreateShipment()}>
            <PackagePlus className="h-4 w-4 mr-1" />
            Yeni İrsaliye
          </Button>
        </div>
      </div>

      {/* Hazırlanan İrsaliyeler */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-5 w-5" />
            Hazırlanan İrsaliyeler
            <Badge variant="default" className="ml-1">
              {preparingShipments.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {preparingShipments.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Hazırlanan irsaliye yok.
            </div>
          ) : (
            <div className="space-y-2">
              {preparingShipments.map((s: Shipment) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveShipmentId(s.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-md border hover:bg-muted/50 transition-colors text-left cursor-pointer"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold font-mono">
                        {s.shipmentNumber}
                      </span>
                      <Badge
                        className={shipmentStatusColorMap[s.status] ?? ""}
                      >
                        {shipmentStatusLabels[s.status as ShipmentStatus] ??
                          s.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>
                        {s.customerNameSnapshot ?? s.customer?.name ?? "-"}
                      </span>
                      <span>
                        {s._count?.items ?? 0} kalem
                      </span>
                      <span>
                        {new Date(s.createdAt).toLocaleString("tr-TR")}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ready Orders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="h-5 w-5" />
            Sevkiyata Hazır Siparişler
            <Badge variant="default" className="ml-1">
              {readyOrders.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-muted animate-pulse rounded-md"
                />
              ))}
            </div>
          ) : readyOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Sevkiyata hazır sipariş bulunmuyor.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {readyOrders.map((order: ReadyOrderView) => {
                const isExpanded = expandedOrder === order.orderId;
                const totalAllocatedRolls = order.lines.reduce(
                  (sum, line) => sum + line.allocatedRolls.length,
                  0,
                );

                return (
                  <div
                    key={order.orderId}
                    className="border rounded-lg overflow-hidden"
                  >
                    {/* Order Header */}
                    <button
                      type="button"
                      onClick={() => toggleOrder(order.orderId)}
                      className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">
                            {order.orderNumber}
                          </span>
                          <Badge
                            className={statusColorMap[order.status] ?? ""}
                          >
                            {orderStatusLabels[
                              order.status as OrderStatus
                            ] ?? order.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                          <span>{order.customerName}</span>
                          <span>{totalAllocatedRolls} top hazır</span>
                          {order.deadline && (
                            <span>
                              Termin:{" "}
                              {new Date(order.deadline).toLocaleDateString(
                                "tr-TR",
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateShipment(order.customerId);
                        }}
                      >
                        <Truck className="h-3.5 w-3.5 mr-1" />
                        Sevk
                      </Button>
                    </button>

                    {/* Expanded: Order Lines */}
                    {isExpanded && (
                      <div className="border-t bg-muted/20 p-4 space-y-3">
                        {order.lines.map((line) => {
                          const readyRolls = line.allocatedRolls.filter(
                            (r) =>
                              r.rollStatus === "PRODUCED" ||
                              r.rollStatus === "READY_FOR_SHIP",
                          );
                          const totalAllocatedQty = readyRolls.reduce(
                            (s, r) => s + r.allocatedQty,
                            0,
                          );

                          return (
                            <div key={line.lineId} className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  {line.itemName}
                                </span>
                                <div className="flex items-center gap-2 text-sm">
                                  <span className="text-muted-foreground">
                                    Talep: {line.requestedQty}m
                                  </span>
                                  <span className="font-medium">
                                    Hazır: {totalAllocatedQty.toFixed(1)}m
                                  </span>
                                </div>
                              </div>

                              {readyRolls.length > 0 && (
                                <div className="space-y-1">
                                  {readyRolls.map((roll) => (
                                    <div
                                      key={roll.allocationId}
                                      className="flex items-center justify-between p-2 rounded border bg-background text-sm"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs">
                                          {roll.barcode}
                                        </span>
                                        {roll.packageId && (
                                          <Badge
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            {roll.packageId}
                                          </Badge>
                                        )}
                                      </div>
                                      <span className="flex items-center gap-1">
                                        <Ruler className="h-3 w-3" />
                                        {roll.allocatedQty}m
                                      </span>
                                    </div>
                                  ))}

                                  {/* Package Button */}
                                  {readyRolls.some(
                                    (r) => r.rollStatus === "PRODUCED",
                                  ) && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="w-full mt-1"
                                      onClick={() =>
                                        handlePackageRolls(
                                          readyRolls
                                            .filter(
                                              (r) =>
                                                r.rollStatus === "PRODUCED",
                                            )
                                            .map((r) => ({
                                              rollId: r.rollId,
                                              barcode: r.barcode,
                                            })),
                                        )
                                      }
                                    >
                                      <Package className="h-3.5 w-3.5 mr-1" />
                                      Paketle (
                                      {
                                        readyRolls.filter(
                                          (r) => r.rollStatus === "PRODUCED",
                                        ).length
                                      }{" "}
                                      top)
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ready Fason (Müşteri Malı) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Handshake className="h-5 w-5 text-purple-600" />
            Sevke Hazır Müşteri Malı (Fason)
            <Badge variant="default" className="ml-1">
              {readyFasonGroups.reduce((s, g) => s + g.rolls.length, 0)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {readyFasonGroups.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Sevke hazır fason top yok.
            </div>
          ) : (
            <div className="space-y-3">
              {readyFasonGroups.map((group) => {
                const totalQty = group.rolls.reduce(
                  (s, r) => s + r.currentQty,
                  0,
                );
                return (
                  <div
                    key={group.customerId}
                    className="border rounded-lg overflow-hidden border-purple-200 dark:border-purple-900"
                  >
                    <div className="flex items-center gap-3 p-4 bg-purple-50/60 dark:bg-purple-950/30">
                      <Handshake className="h-4 w-4 shrink-0 text-purple-600" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">
                            {group.customerName}
                          </span>
                          <Badge
                            variant="outline"
                            className="bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900 dark:text-purple-200"
                          >
                            Müşteri Malı
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                          <span>{group.rolls.length} top hazır</span>
                          <span>{totalQty.toFixed(1)}m toplam</span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCreateShipment(group.customerId)}
                      >
                        <Truck className="h-3.5 w-3.5 mr-1" />
                        Sevk
                      </Button>
                    </div>
                    <div className="bg-muted/20 p-3 space-y-1">
                      {group.rolls.map((roll) => (
                        <div
                          key={roll.rollId}
                          className="flex items-center justify-between p-2 rounded border bg-background text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-xs font-semibold">
                              {roll.barcode}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {roll.itemCode} — {roll.itemName}
                              {roll.variantCode ? ` · ${roll.variantCode}` : ""}
                            </div>
                          </div>
                          <span className="flex items-center gap-1 shrink-0 ml-2">
                            <Ruler className="h-3 w-3" />
                            {roll.currentQty}m
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sevk Edilen İrsaliyeler (geçmiş) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5" />
            Sevk Edilmiş İrsaliyeler
            <Badge variant="default" className="ml-1">
              {shippedShipments.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shippedShipments.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              Henüz sevk edilmiş irsaliye yok.
            </div>
          ) : (
            <div className="space-y-2">
              {shippedShipments.slice(0, 20).map((s: Shipment) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveShipmentId(s.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-md border hover:bg-muted/50 transition-colors text-left cursor-pointer"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold font-mono">
                        {s.shipmentNumber}
                      </span>
                      <Badge
                        className={shipmentStatusColorMap[s.status] ?? ""}
                      >
                        {shipmentStatusLabels[s.status as ShipmentStatus] ??
                          s.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>
                        {s.customerNameSnapshot ?? s.customer?.name ?? "-"}
                      </span>
                      <span>{s._count?.items ?? 0} kalem</span>
                      {s.shippedAt && (
                        <span>
                          {new Date(s.shippedAt).toLocaleString("tr-TR")}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <PreparePackageDialog
        open={packageDialogOpen}
        onOpenChange={setPackageDialogOpen}
        preselectedRolls={packageRolls}
      />
      <CreateShipmentDialog
        open={shipmentDialogOpen}
        onOpenChange={setShipmentDialogOpen}
        preselectedCustomerId={selectedCustomerId}
        onCreated={(shipmentId) => setActiveShipmentId(shipmentId)}
      />

      {/* Detail Panel */}
      <ShipmentDetailPanel
        shipmentId={activeShipmentId || ""}
        onClose={() => setActiveShipmentId(null)}
      />
    </div>
  );
}
