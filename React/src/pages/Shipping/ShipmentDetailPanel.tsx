import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Truck,
  Package,
  CheckCircle2,
  Loader2,
  ScanBarcode,
  Plus,
  ClipboardList,
  Printer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { shipmentStatusLabels } from "@/types/enums";
import type { ShipmentStatus } from "@/types/enums";
import { shippingService } from "@/services/shippingService";
import { SlideOverPanel } from "@/components/ui/SlideOverPanel";
import ShipmentPrintDialog from "./ShipmentPrintDialog";

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
  const [printOpen, setPrintOpen] = useState(false);

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
    qc.invalidateQueries({ queryKey: ["ready-fason"] });
  };

  const addItemsMutation = useMutation({
    mutationFn: (rollIds: string[]) =>
      shippingService.addItems(shipmentId, rollIds),
    onSuccess: (res) => {
      const added = res.data?.added ?? 0;
      const msg = res.message ?? "";
      if (added > 0) {
        toast.success(msg || "Ürün eklendi");
        setRollIdInput("");
      } else {
        toast.error(msg || "Ürün eklenemedi");
      }
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
        msg += ` | Tamamlanan Siparişler: ${body.ordersCompleted.join(", ")}`;
      }
      if (body?.ordersPartial?.length) {
        msg += ` | Kısmi: ${body.ordersPartial.join(", ")}`;
      }
      if (body?.workOrdersCompleted?.length) {
        msg += ` | Kapanan İş Emirleri: ${body.workOrdersCompleted.join(", ")}`;
      }
      toast.success(msg);
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["workorders"] });
      qc.invalidateQueries({ queryKey: ["workorder-detail"] });
      qc.invalidateQueries({ queryKey: ["workorder-shipments"] });
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
    <>
    <SlideOverPanel
      isOpen={!!shipmentId}
      onClose={onClose}
      title={shipment?.shipmentNumber ?? "İrsaliye Detayı"}
      headerActions={
        <div className="flex items-center gap-2">
          {shipment && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPrintOpen(true)}
            >
              <Printer className="h-4 w-4 mr-1" />
              Yazdır
            </Button>
          )}
          <Truck className="h-5 w-5 text-primary" />
        </div>
      }
    >
      <div className="space-y-6">
        {isLoading || !shipment ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground font-medium">Durum</span>
                <div className="mt-1">
                  <Badge className={statusColorMap[shipment.status] ?? ""}>
                    {shipmentStatusLabels[shipment.status as ShipmentStatus] ??
                      shipment.status}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground font-medium">Müşteri</span>
                <p className="font-semibold text-foreground mt-1 truncate">
                  {shipment.customerNameSnapshot ??
                    shipment.customer?.name ??
                    "-"}
                </p>
              </div>
              {shipment.driverName && (
                <div>
                  <span className="text-muted-foreground font-medium">Şoför</span>
                  <p className="font-medium mt-1">{shipment.driverName}</p>
                </div>
              )}
              {shipment.plateNumber && (
                <div>
                  <span className="text-muted-foreground font-medium">Plaka</span>
                  <p className="font-medium mt-1 uppercase">
                    {shipment.plateNumber}
                  </p>
                </div>
              )}
              {shipment.carrier && (
                <div className="col-span-2">
                  <span className="text-muted-foreground font-medium">
                    Taşıyıcı
                  </span>
                  <p className="font-medium mt-1">{shipment.carrier}</p>
                </div>
              )}
              {shipment.shippedAt && (
                <div className="col-span-2">
                  <span className="text-muted-foreground font-medium">
                    Sevk Tarihi
                  </span>
                  <p className="font-medium mt-1">
                    {new Date(shipment.shippedAt).toLocaleString("tr-TR")}
                  </p>
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-muted/30">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    Top Sayısı
                  </p>
                  <p className="text-2xl font-bold mt-1">{totalItems}</p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    Toplam Metraj
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {totalQty.toFixed(1)}m
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Add Roll (only if PREPARING) */}
            {isPreparing && (
              <div className="space-y-2 p-3 border rounded-lg bg-primary/5">
                <label className="text-sm font-semibold flex items-center gap-2 text-primary">
                  <ScanBarcode className="h-4 w-4" />
                  Ürün Ekle (Roll Barkodu)
                </label>
                <div className="flex gap-2">
                  <Input
                    value={rollIdInput}
                    onChange={(e) => setRollIdInput(e.target.value)}
                    placeholder="Roll Barkodu Okutun..."
                    onKeyDown={(e) => e.key === "Enter" && handleAddRoll()}
                    className="bg-background shadow-sm"
                  />
                  <Button
                    type="button"
                    onClick={handleAddRoll}
                    disabled={!rollIdInput.trim() || addItemsMutation.isPending}
                    size="icon"
                    className="shrink-0"
                  >
                    {addItemsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Müşteri malı (fason üretim kabul) toplar sadece sahip müşteriye
                  sevk edilebilir.
                </p>
              </div>
            )}

            {/* Items List */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-2 border-b pb-2">
                <Package className="h-4 w-4 text-primary" />
                Sevkiyat Kalemleri
              </h3>
              {totalItems === 0 ? (
                <div className="text-center py-10 bg-muted/20 rounded-lg border border-dashed">
                  <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    Henüz ürün eklenmedi
                  </p>
                </div>
              ) : (
                <div className="space-y-2 pb-20">
                  {shipment.items?.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-background hover:border-primary/30 transition-colors shadow-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-bold font-mono text-sm block">
                          {item.rollBarcodeSnapshot ??
                            item.roll?.barcode ??
                            item.rollId.slice(0, 8)}
                        </span>
                        {(item.itemCodeSnapshot || item.itemNameSnapshot) && (
                          <span className="text-xs text-muted-foreground truncate block italic">
                            {item.itemCodeSnapshot}
                            {item.itemCodeSnapshot && item.itemNameSnapshot
                              ? " — "
                              : ""}
                            {item.itemNameSnapshot}
                          </span>
                        )}
                        {(() => {
                          const customerLabel =
                            item.customerAlias?.customerLabel ??
                            item.roll?.customerDescription ??
                            null;
                          const customerCode = item.customerAlias?.customerCode;
                          if (!customerLabel) return null;
                          return (
                            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 block mt-0.5">
                              Müşteri Adı: {customerLabel}
                              {customerCode && (
                                <span className="text-muted-foreground font-normal">
                                  {" "}· {customerCode}
                                </span>
                              )}
                            </span>
                          );
                        })()}
                        {item.orderNumberSnapshot && (
                          <span className="text-xs text-primary/80 font-medium mt-0.5 block">
                            Sipariş: {item.orderNumberSnapshot}
                          </span>
                        )}
                        {item.roll?.producedInStep?.workOrder && (
                          <span className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            <ClipboardList className="h-3 w-3" />
                            İş Emri:
                            <span className="font-mono font-semibold text-foreground/80">
                              {item.roll.producedInStep.workOrder.batchNumber}
                            </span>
                          </span>
                        )}
                        {item.roll?.ownerCustomer && (
                          <Badge
                            variant="outline"
                            className="mt-1 bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-800"
                          >
                            Müşteri Malı
                          </Badge>
                        )}
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <span className="font-bold text-base text-foreground">
                          {item.shippedQty}m
                        </span>
                        {item.shippedWeight && (
                          <span className="text-xs text-muted-foreground block font-medium">
                            {item.shippedWeight}kg
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Finalize Button (Fixed at bottom within the panel content) */}
            {isPreparing && (
              <div className="sticky bottom-0 left-0 right-0 bg-background pt-4 pb-2 border-t mt-4">
                <Button
                  onClick={() => finalizeMutation.mutate()}
                  disabled={finalizeMutation.isPending || totalItems === 0}
                  className="w-full h-14 text-base font-bold shadow-lg"
                  size="lg"
                >
                  {finalizeMutation.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                  )}
                  {totalItems > 0
                    ? `Sevkiyatı Onayla (${totalItems} Top)`
                    : "Sevkiyatı Onayla"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </SlideOverPanel>

    <ShipmentPrintDialog
      open={printOpen}
      onOpenChange={setPrintOpen}
      shipmentId={shipmentId}
    />
    </>
  );
}
