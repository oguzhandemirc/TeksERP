import { useQuery } from "@tanstack/react-query";
import { X, AlertTriangle, Package, Barcode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rollService } from "@/services/rollService";
import { rollStatusLabels } from "@/types/enums";
import { itemTypeLabels } from "@/types/enums";
import type { ItemType } from "@/types/enums";

interface RollDetailPanelProps {
  rollId: string | null;
  onClose: () => void;
}

const statusColorMap: Record<string, string> = {
  STOCK: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  IN_PRODUCTION: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  PRODUCED: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  READY_FOR_SHIP: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  SHIPPED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  SCRAP: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function RollDetailPanel({ rollId, onClose }: RollDetailPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["roll-detail", rollId],
    queryFn: () => rollService.getById(rollId!),
    enabled: !!rollId,
  });

  if (!rollId) return null;

  const roll = data?.data;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-background border-l shadow-xl overflow-y-auto">
      <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Top Detayı</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="p-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-6 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : !roll ? (
        <div className="p-6 text-center text-muted-foreground">Top bulunamadı</div>
      ) : (
        <div className="p-4 space-y-6">
          {/* Barkod & Durum */}
          <div className="flex items-center gap-3">
            <Barcode className="h-5 w-5 text-muted-foreground" />
            <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
              {roll.barcode}
            </code>
            <Badge className={statusColorMap[roll.status] ?? ""} variant="secondary">
              {rollStatusLabels[roll.status] ?? roll.status}
            </Badge>
          </div>

          {/* Ürün Bilgisi */}
          {roll.item && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Package className="h-4 w-4 text-muted-foreground" />
                Ürün Bilgisi
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Kod:</span>
                <span className="font-medium">{roll.item.code}</span>
                <span className="text-muted-foreground">İsim:</span>
                <span>{roll.item.name}</span>
                <span className="text-muted-foreground">Tür:</span>
                <span>{itemTypeLabels[roll.item.itemType as ItemType] ?? roll.item.itemType}</span>
              </div>
            </div>
          )}

          {/* Ölçümler */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-sm font-medium">Ölçümler</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted-foreground">İlk Miktar:</span>
              <span className="font-medium">{roll.initialQty} mt</span>
              <span className="text-muted-foreground">Mevcut Miktar:</span>
              <span className="font-medium">{roll.currentQty} mt</span>
              {roll.width != null && (
                <>
                  <span className="text-muted-foreground">En:</span>
                  <span>{roll.width} cm</span>
                </>
              )}
              {(roll.variant?.code || roll.design) && (
                <>
                  <span className="text-muted-foreground">Desen/Varyant:</span>
                  <span>{roll.variant?.code ?? roll.design}</span>
                </>
              )}
              {roll.weightKg != null && (
                <>
                  <span className="text-muted-foreground">Ağırlık:</span>
                  <span>{roll.weightKg} kg</span>
                </>
              )}
              <span className="text-muted-foreground">Kalite:</span>
              <span>{roll.qualityGrade}</span>
            </div>
          </div>

          {/* Paketleme */}
          {(roll.packageId || roll.grossWeightKg != null) && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-sm font-medium">Paketleme</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {roll.packageId && (
                  <>
                    <span className="text-muted-foreground">Paket ID:</span>
                    <span className="font-mono text-xs">{roll.packageId}</span>
                  </>
                )}
                {roll.grossWeightKg != null && (
                  <>
                    <span className="text-muted-foreground">Brüt Ağırlık:</span>
                    <span>{roll.grossWeightKg} kg</span>
                  </>
                )}
                {roll.netWeightKg != null && (
                  <>
                    <span className="text-muted-foreground">Net Ağırlık:</span>
                    <span>{roll.netWeightKg} kg</span>
                  </>
                )}
                {roll.packagingDate && (
                  <>
                    <span className="text-muted-foreground">Paketleme Tarihi:</span>
                    <span>{new Date(roll.packagingDate).toLocaleDateString("tr-TR")}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Hatalar */}
          {roll.errors && roll.errors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Hatalar ({roll.errors.length})
              </div>
              <div className="space-y-2">
                {roll.errors.map((err) => (
                  <div
                    key={err.id}
                    className="flex items-center justify-between rounded border p-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">
                        {err.startMeter}m – {err.endMeter}m
                      </span>
                      {err.errorType && (
                        <span className="text-muted-foreground ml-2">({err.errorType})</span>
                      )}
                    </div>
                    <Badge variant={err.isProcessed ? "default" : "secondary"}>
                      {err.isProcessed ? err.actionTaken ?? "İşlendi" : "Bekliyor"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tahsisler */}
          {roll.allocations && roll.allocations.length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-sm font-medium">
                Sipariş Tahsisleri ({roll.allocations.length})
              </div>
              <div className="space-y-2">
                {roll.allocations.map((alloc) => (
                  <div
                    key={alloc.id}
                    className="flex items-center justify-between rounded border p-2 text-sm"
                  >
                    <span className="font-medium">
                      {alloc.orderLine?.order?.orderNumber ?? "—"}
                    </span>
                    <span>{alloc.allocatedQty} mt</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tarihler */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Oluşturulma: {new Date(roll.createdAt).toLocaleString("tr-TR")}</div>
            <div>Son Güncelleme: {new Date(roll.updatedAt).toLocaleString("tr-TR")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
