import { useQueries } from "@tanstack/react-query";
import { PlayCircle, Package, Layers, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { packingService } from "./service";
import { shipmentStatusLabels, type ShipmentStatus } from "./types";

export interface OngoingShipment {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  customer: string;
}

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/** Devam eden sevkiyat kartı — ilerleme (çuval · top · metraj) per-sevkiyat
 *  `getShipment` ile lazy çekilir (liste ucu ilerleme taşımıyor). Kart tıklanınca
 *  paketleme workspace'i açılır. */
function ShipmentCard({ s, onOpen }: { s: OngoingShipment; onOpen: (id: string) => void }) {
  const q = useQueries({
    queries: [
      {
        queryKey: ["packing", "shipment-progress", s.id],
        queryFn: () => packingService.getShipment(s.id),
        staleTime: 10_000,
      },
    ],
  })[0];
  const sum = q.data?.data?.summary;

  return (
    <button
      type="button"
      onClick={() => onOpen(s.id)}
      className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="font-mono font-semibold">{s.shipmentNo}</span>
          <span className="ml-2 text-sm text-muted-foreground">{s.customer}</span>
        </span>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {shipmentStatusLabels[s.status]}
        </Badge>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {q.isLoading ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> yükleniyor…
          </span>
        ) : sum ? (
          <>
            <span className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground tabular-nums">{sum.sackCount}</span> çuval
            </span>
            <span className="flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground tabular-nums">{sum.rollCount}</span> top
            </span>
            <span className="tabular-nums">
              <span className="font-medium text-foreground">{DEC.format(sum.totalMeters)}</span> m
            </span>
          </>
        ) : (
          <span>ilerleme okunamadı</span>
        )}
      </div>
    </button>
  );
}

/** Sağ pano — devam eden (PREPARING/READY/AT_DOOR) sevkiyatlar, ilerlemeli. */
export function OngoingShipmentsBoard({
  shipments,
  onOpen,
  className,
}: {
  shipments: OngoingShipment[];
  onOpen: (id: string) => void;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col", className)}>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <PlayCircle className="h-4 w-4 text-primary" /> Devam Eden Sevkiyatlar
        {shipments.length > 0 && (
          <span className="text-xs font-normal text-muted-foreground">({shipments.length})</span>
        )}
      </h3>
      {shipments.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          Devam eden sevkiyat yok.
        </div>
      ) : (
        <div className="grid content-start gap-2 overflow-auto">
          {shipments.map((s) => (
            <ShipmentCard key={s.id} s={s} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
