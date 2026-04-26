import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Package,
  Barcode,
  History,
  Truck,
  PackageCheck,
  ArrowDownLeft,
  ArrowUpRight,
  LogIn,
  LogOut,
  Sparkles,
  Send,
  RotateCcw,
  ClipboardList,
  Handshake,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { rollService } from "@/services/rollService";
import { rollStatusLabels } from "@/types/enums";
import type {
  RollHistoryEvent,
  RollHistoryEventKind,
} from "@/types/models";
import {
  computeCurrentRollState,
  getInitialTypeLabel,
} from "@/lib/roll-state";
import {
  SlideOverPanel,
  SlideOverContentLoader,
} from "@/components/ui/SlideOverPanel";

interface RollDetailPanelProps {
  rollId: string | null;
  isOpen: boolean;
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

function getEventIcon(kind: RollHistoryEventKind, subKind?: string) {
  if (kind === "CREATED") return ClipboardList;
  if (kind === "MOVEMENT_IN") return LogIn;
  if (kind === "MOVEMENT_OUT") return LogOut;
  if (kind === "SUBCONTRACTOR_DISPATCH") return Send;
  if (kind === "SUBCONTRACTOR_RECEIPT") return RotateCcw;
  if (kind === "SHIPPED") return Truck;
  if (kind === "OPERATION") {
    switch (subKind) {
      case "PACKAGED":
        return PackageCheck;
      case "SUBCONTRACTOR_SENT":
        return ArrowUpRight;
      case "SUBCONTRACTOR_RETURNED":
        return ArrowDownLeft;
      default:
        return Sparkles;
    }
  }
  return History;
}

function EventRow({ event }: { event: RollHistoryEvent }) {
  const Icon = getEventIcon(event.kind, event.subKind);
  const d = event.details;

  const detailsText = (() => {
    const parts: string[] = [];
    if (event.kind === "CREATED") {
      if (d["initialQty"] != null) parts.push(`İlk miktar: ${d["initialQty"]}m`);
      if (d["weightKg"] != null) parts.push(`Ağırlık: ${d["weightKg"]}kg`);
    } else if (event.kind === "MOVEMENT_IN") {
      if (d["qtyIn"] != null) parts.push(`Girişte: ${d["qtyIn"]}m`);
      if (d["weightIn"] != null) parts.push(`${d["weightIn"]}kg`);
    } else if (event.kind === "MOVEMENT_OUT") {
      if (d["qtyIn"] != null && d["qtyOut"] != null) {
        const loss = Number(d["qtyIn"]) - Number(d["qtyOut"]);
        parts.push(`${d["qtyIn"]}m → ${d["qtyOut"]}m`);
        if (loss > 0) parts.push(`fire: ${loss.toFixed(1)}m`);
      } else if (d["qtyOut"] != null) {
        parts.push(`Çıkışta: ${d["qtyOut"]}m`);
      }
    } else if (event.kind === "SUBCONTRACTOR_DISPATCH") {
      if (d["dispatchNo"]) parts.push(String(d["dispatchNo"]));
      if (d["dispatchedQty"] != null)
        parts.push(`${d["dispatchedQty"]}m gönderildi`);
      if (d["plateNumber"]) parts.push(String(d["plateNumber"]));
    } else if (event.kind === "SUBCONTRACTOR_RECEIPT") {
      if (d["receiptNo"]) parts.push(String(d["receiptNo"]));
      if (d["manifestNo"]) parts.push(`İrs: ${d["manifestNo"]}`);
    } else if (event.kind === "SHIPPED") {
      if (d["shipmentNumber"]) parts.push(String(d["shipmentNumber"]));
      if (d["shippedQty"] != null) parts.push(`${d["shippedQty"]}m`);
    }
    return parts.join(" · ");
  })();

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>
      <div className="flex-1 pb-4 -mt-0.5">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="text-sm font-medium">{event.title}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(event.at).toLocaleString("tr-TR")}
          </div>
        </div>
        {detailsText && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {detailsText}
          </div>
        )}
        {event.operatorName && (
          <div className="text-xs text-muted-foreground mt-0.5">
            Operatör: {event.operatorName}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RollDetailPanel({
  rollId,
  isOpen,
  onClose,
}: RollDetailPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["roll-detail", rollId],
    queryFn: () => rollService.getById(rollId!),
    enabled: !!rollId && isOpen,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["roll-history", rollId],
    queryFn: () => rollService.getHistory(rollId!),
    enabled: !!rollId && isOpen,
  });

  const roll = data?.data;
  const events = historyData?.data?.events ?? [];

  return (
    <SlideOverPanel
      title={roll ? `Top Detayı: ${roll.barcode}` : "Top Detayı"}
      isOpen={isOpen}
      onClose={onClose}
    >
      {isLoading ? (
        <SlideOverContentLoader />
      ) : !roll ? (
        <div className="p-6 text-center text-muted-foreground">
          Top bulunamadı
        </div>
      ) : (
        <div className="space-y-6">
          {/* Barkod & Durum */}
          <div className="flex items-center gap-3 font-medium">
            <Barcode className="h-5 w-5 text-muted-foreground" />
            <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
              {roll.barcode}
            </code>
            <Badge
              className={statusColorMap[roll.status] ?? ""}
              variant="secondary"
            >
              {rollStatusLabels[roll.status] ?? roll.status}
            </Badge>
          </div>

          {/* Müşteri Malı (Fason Üretim Kabul) */}
          {roll.ownerCustomer && (
            <div className="rounded-lg border border-purple-300 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-purple-900 dark:text-purple-200">
                <Handshake className="h-4 w-4" />
                Müşteri Malı (Fason Üretim Kabul)
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Sahip Müşteri:</span>
                <span className="font-medium">{roll.ownerCustomer.name}</span>
                {roll.customerDescription && (
                  <>
                    <span className="text-muted-foreground">Müşteri Tanımı:</span>
                    <span>{roll.customerDescription}</span>
                  </>
                )}
              </div>
              <div className="text-xs text-purple-800 dark:text-purple-300">
                Bu top sadece sahibi müşteriye sevk edilebilir.
              </div>
            </div>
          )}

          {/* Ürün + Giriş/Güncel */}
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
                <span className="text-muted-foreground">Giriş Türü:</span>
                <span>{getInitialTypeLabel(roll)}</span>
                <span className="text-muted-foreground">Güncel Durum:</span>
                <span className="font-semibold">
                  {computeCurrentRollState(roll)}
                </span>
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
                    <span className="text-muted-foreground">
                      Paketleme Tarihi:
                    </span>
                    <span>
                      {new Date(roll.packagingDate).toLocaleDateString("tr-TR")}
                    </span>
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
                        <span className="text-muted-foreground ml-2">
                          ({err.errorType})
                        </span>
                      )}
                    </div>
                    <Badge
                      variant={err.isProcessed ? "default" : "secondary"}
                    >
                      {err.isProcessed
                        ? err.actionTaken ?? "İşlendi"
                        : "Bekliyor"}
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

          {/* Geçmiş / Timeline */}
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4 text-muted-foreground" />
              Süreç Geçmişi
              {events.length > 0 && (
                <Badge variant="secondary" className="ml-auto">
                  {events.length} olay
                </Badge>
              )}
            </div>
            {historyLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Yükleniyor...
              </div>
            ) : events.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Henüz olay kaydı yok.
              </div>
            ) : (
              <div className="pt-1">
                {events.map((event, idx) => (
                  <EventRow key={`${event.kind}-${event.at}-${idx}`} event={event} />
                ))}
              </div>
            )}
          </div>

          {/* Tarihler */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              Oluşturulma: {new Date(roll.createdAt).toLocaleString("tr-TR")}
            </div>
            <div>
              Son Güncelleme:{" "}
              {new Date(roll.updatedAt).toLocaleString("tr-TR")}
            </div>
          </div>
        </div>
      )}
    </SlideOverPanel>
  );
}
