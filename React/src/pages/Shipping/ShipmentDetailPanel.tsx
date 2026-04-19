import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  X,
  Truck,
  Package,
  CheckCircle2,
  Loader2,
  ScanBarcode,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { shipmentStatusLabels } from "@/types/enums";
import type { ShipmentStatus } from "@/types/enums";
import { shippingService } from "@/services/shippingService";

interface ShipmentDetailPanelProps {
  shipmentId: string;
  onClose: () => void;
}

const statusColorMap: Record<string, string> = {
  PREPARING:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  SHIPPED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function ShipmentDetailPanel({
  shipmentId,
  onClose,
}: ShipmentDetailPanelProps) {
  const qc = useQueryClient();
  const [rollIdInput, setRollIdInput] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["shipment", shipmentId],
    queryFn: () => shippingService.getById(shipmentId),
    enabled: !!shipmentId,
  });

  const shipment = data?.data;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
    qc.invalidateQueries({ queryKey: ["shipments"] });
    qc.invalidateQueries({ queryKey: ["ready-orders"] });
  };

  const addItemsMutation = useMutation({
    mutationFn: (rollIds: string[]) =>
      shippingService.addItems(shipmentId, rollIds),
    onSuccess: (res) => {
      toast.success(res.message ?? "Ürünler eklendi");
      setRollIdInput("");
      invalidateAll();
    },
    onError: () => {
      toast.error("Ürün ekleme başarısız");
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: () => shippingService.finalize(shipmentId),
    onSuccess: (res) => {
      const body = res.data;
      let msg = res.message ?? "Sevkiyat onaylandı";
      if (body?.ordersCompleted?.length) {
        msg += ` | Tamamlanan: ${body.ordersCompleted.join(", ")}`;
      }
      if (body?.ordersPartial?.length) {
        msg += ` | Kısmi: ${body.ordersPartial.join(", ")}`;
      }
      toast.success(msg);
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["rolls"] });
    },
    onError: () => {
      toast.error("Finalizasyon başarısız");
    },
  });

  const handleAddRoll = () => {
    const trimmed = rollIdInput.trim();
    if (!trimmed) return;
    addItemsMutation.mutate([trimmed]);
  };

  const isPreparing = shipment?.status === "PREPARING";
  const totalItems = shipment?.items?.length ?? 0;
  const totalQty =
    shipment?.items?.reduce((s, i) => s + i.shippedQty, 0) ?? 0;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background border-l shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-lg">
            {shipment?.shipmentNumber ?? "Yükleniyor..."}
          </h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading || !shipment ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Durum</span>
                <div className="mt-1">
                  <Badge
                    className={statusColorMap[shipment.status] ?? ""}
                  >
                    {shipmentStatusLabels[
                      shipment.status as ShipmentStatus
                    ] ?? shipment.status}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Müşteri</span>
                <p className="font-medium mt-1">
                  {shipment.customerNameSnapshot ??
                    shipment.customer?.name ??
                    "-"}
                </p>
              </div>
              {shipment.driverName && (
                <div>
                  <span className="text-muted-foreground">Şoför</span>
                  <p className="font-medium mt-1">{shipment.driverName}</p>
                </div>
              )}
              {shipment.plateNumber && (
                <div>
                  <span className="text-muted-foreground">Plaka</span>
                  <p className="font-medium mt-1">{shipment.plateNumber}</p>
                </div>
              )}
              {shipment.carrier && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Taşıyıcı</span>
                  <p className="font-medium mt-1">{shipment.carrier}</p>
                </div>
              )}
              {shipment.shippedAt && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Sevk Tarihi</span>
                  <p className="font-medium mt-1">
                    {new Date(shipment.shippedAt).toLocaleString("tr-TR")}
                  </p>
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Top Sayısı</p>
                  <p className="text-xl font-bold">{totalItems}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">
                    Toplam Metraj
                  </p>
                  <p className="text-xl font-bold">{totalQty.toFixed(1)}m</p>
                </CardContent>
              </Card>
            </div>

            {/* Add Roll (only if PREPARING) */}
            {isPreparing && (
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <ScanBarcode className="h-4 w-4" />
                  Roll Barkodu / ID ile Ürün Ekle
                </label>
                <div className="flex gap-2">
                  <Input
                    value={rollIdInput}
                    onChange={(e) => setRollIdInput(e.target.value)}
                    placeholder="Roll UUID giriniz"
                    onKeyDown={(e) => e.key === "Enter" && handleAddRoll()}
                  />
                  <Button
                    type="button"
                    onClick={handleAddRoll}
                    disabled={
                      !rollIdInput.trim() || addItemsMutation.isPending
                    }
                    size="icon"
                  >
                    {addItemsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Items List */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1">
                <Package className="h-4 w-4" />
                Sevkiyat Kalemleri
              </h3>
              {totalItems === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Henüz ürün eklenmedi
                </p>
              ) : (
                <div className="space-y-2">
                  {shipment.items?.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-md border text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium truncate block">
                          {item.rollBarcodeSnapshot ??
                            item.roll?.barcode ??
                            item.rollId.slice(0, 8)}
                        </span>
                        {(item.itemCodeSnapshot ||
                          item.itemNameSnapshot) && (
                          <span className="text-xs text-muted-foreground">
                            {item.itemCodeSnapshot}
                            {item.itemCodeSnapshot && item.itemNameSnapshot
                              ? " — "
                              : ""}
                            {item.itemNameSnapshot}
                          </span>
                        )}
                        {item.orderNumberSnapshot && (
                          <span className="text-xs text-muted-foreground block">
                            Sipariş: {item.orderNumberSnapshot}
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-medium">{item.shippedQty}m</span>
                        {item.shippedWeight && (
                          <span className="text-xs text-muted-foreground block">
                            {item.shippedWeight}kg
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {isPreparing && (
        <div className="border-t p-4">
          <Button
            onClick={() => finalizeMutation.mutate()}
            disabled={finalizeMutation.isPending || totalItems === 0}
            className="w-full h-12 text-base font-semibold"
            size="lg"
          >
            {finalizeMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            Sevkiyatı Onayla ({totalItems} top)
          </Button>
        </div>
      )}
    </div>
  );
}
