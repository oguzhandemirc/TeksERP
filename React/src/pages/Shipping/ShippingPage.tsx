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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { shippingService } from "@/services/shippingService";
import { orderStatusLabels } from "@/types/enums";
import type { OrderStatus } from "@/types/enums";
import type { ReadyOrderView } from "@/types/models";
import PreparePackageDialog from "./PreparePackageDialog";
import CreateShipmentDialog from "./CreateShipmentDialog";

const statusColorMap: Record<string, string> = {
  APPROVED:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  IN_PRODUCTION:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  PARTIAL_SHIPPED:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

export default function ShippingPage() {
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const [packageRolls, setPackageRolls] = useState<
    { rollId: string; barcode: string }[]
  >([]);
  const [shipmentDialogOpen, setShipmentDialogOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>();

  const { data: readyData, isLoading } = useQuery({
    queryKey: ["ready-orders"],
    queryFn: () => shippingService.getReadyOrders(),
    refetchInterval: 30000,
  });

  const readyOrders = readyData?.data ?? [];

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
          <Button
            variant="outline"
            onClick={() => handleCreateShipment()}
          >
            <PackagePlus className="h-4 w-4 mr-1" />
            Yeni İrsaliye
          </Button>
        </div>
      </div>

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
                            className={
                              statusColorMap[order.status] ?? ""
                            }
                          >
                            {orderStatusLabels[
                              order.status as OrderStatus
                            ] ?? order.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                          <span>{order.customerName}</span>
                          <span>
                            {totalAllocatedRolls} top hazır
                          </span>
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
      />
    </div>
  );
}
