import {
  DoorOpen,
  Undo2,
  PackageOpen,
  Truck,
  Package,
  Scale,
  Layers,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { useShipmentConfirmationEnabled } from "@/hooks/usePricingEnabled";
import { safeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sackStoreStatusLabels, destinationLabels, type SackStoreShipment } from "./types";

// Tone seti "purple" içermiyor; Çuval Depo (READY) için mor className ile
// override; Kapı Önü (AT_DOOR) için mevcut "warning" (amber) tonu.
const STATUS_TONES = { READY: "neutral", AT_DOOR: "warning" } as const;
const READY_CLASS =
  "bg-purple-500/15 text-purple-600 dark:text-purple-300 border-transparent";

interface Props {
  shipment: SackStoreShipment;
  busy: boolean;
  onOpen: (s: SackStoreShipment) => void;
  onMoveToDoor: (s: SackStoreShipment) => void;
  onPullBack: (s: SackStoreShipment) => void;
  onUnready: (s: SackStoreShipment) => void;
  onDispatch: (s: SackStoreShipment) => void;
}

export function SackStoreCard({
  shipment,
  busy,
  onOpen,
  onMoveToDoor,
  onPullBack,
  onUnready,
  onDispatch,
}: Props) {
  const isReady = shipment.status === "READY";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(shipment)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(shipment);
        }
      }}
      className={cn(
        "cursor-pointer overflow-hidden transition-colors hover:border-primary/50 hover:bg-muted/30",
        isReady ? "border-purple-500/30" : "border-warning/40",
      )}
    >
      <CardContent className="space-y-3 p-4">
        {/* Başlık + durum + müşteri/şube */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{shipment.shipmentNo}</span>
              <StatusBadge
                status={shipment.status}
                labels={sackStoreStatusLabels}
                tones={STATUS_TONES}
                className={isReady ? READY_CLASS : undefined}
              />
              {/* Saha #22: yurtiçi/yurtdışı rozeti — farkedilebilirlik (sıkı ayrım değil) */}
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  shipment.destination === "EXPORT"
                    ? "bg-sky-500/15 text-sky-600 dark:text-sky-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {destinationLabels[shipment.destination]}
              </span>
            </div>
            <div className="mt-0.5 truncate text-sm text-muted-foreground">
              {shipment.customer.name}
              {shipment.branch ? ` · ${shipment.branch.name}` : ""}
              {/* Saha #21: prosedür/ihracat kodu veya müşteri/şube kodu */}
              {(shipment.procedureCode || shipment.branch?.code || shipment.customer.code) && (
                <span className="ml-1 font-mono text-xs">
                  · {shipment.procedureCode || shipment.branch?.code || shipment.customer.code}
                </span>
              )}
            </div>
            {shipment.readyAt && (
              <div className="text-xs text-muted-foreground">
                Hazır: {safeFormat(shipment.readyAt, "dd.MM.yyyy HH:mm")}
              </div>
            )}
          </div>
          <SackStoreActions
            shipment={shipment}
            busy={busy}
            onMoveToDoor={onMoveToDoor}
            onPullBack={onPullBack}
            onUnready={onUnready}
            onDispatch={onDispatch}
          />
        </div>

        {/* Özet sayaçlar — rulo çekmeden (ucuz aggregate) */}
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={Package} label="Çuval" value={shipment.sackCount} />
          <Stat icon={Scale} label="Kg" value={shipment.totalKg} decimals={1} />
          <Stat icon={Layers} label="Metraj" value={shipment.totalQty} decimals={2} />
        </div>

        {/* İçeriği gör ipucu */}
        <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {shipment.rollCount} top · içeriği görmek için tıkla
          <ChevronRight className="h-3.5 w-3.5" />
        </div>
      </CardContent>
    </Card>
  );
}

function SackStoreActions({
  shipment,
  busy,
  onMoveToDoor,
  onPullBack,
  onUnready,
  onDispatch,
}: Omit<Props, "onOpen">) {
  const isReady = shipment.status === "READY";
  // İki-adım kapı disiplini: onay akışı bayrağı AÇIKKEN READY'nin birincil yolu
  // "Kapı Önüne Koy"dur; doğrudan sevk ikincil menüye iner (Okutarak Sevk ile
  // aynı kural — kazara READY'den sevk tek tıkla mümkün olmasın). Bayrak
  // KAPALIYKEN tek-adım kurulumların READY→sevk yolu aynen korunur.
  const confirmationEnabled = useShipmentConfirmationEnabled();
  const twoStep = isReady && confirmationEnabled;
  // Aksiyon butonları kart onClick'ini tetiklemesin → stopPropagation.
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <PermissionGate permission="shipping:write">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {isReady ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={busy}
              onClick={stop(() => onUnready(shipment))}
            >
              <PackageOpen className="h-3.5 w-3.5" /> Hazırlığa Geri Al
            </Button>
            <Button
              type="button"
              variant={twoStep ? "default" : "outline"}
              size="sm"
              className="gap-1"
              disabled={busy}
              onClick={stop(() => onMoveToDoor(shipment))}
            >
              <DoorOpen className="h-3.5 w-3.5" /> Kapı Önüne Koy
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={busy}
            onClick={stop(() => onPullBack(shipment))}
          >
            <Undo2 className="h-3.5 w-3.5" /> Çuval Depoya Geri Çek
          </Button>
        )}
        {twoStep ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={(e) => e.stopPropagation()}
                aria-label="Diğer aksiyonlar"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive"
                onClick={stop(() => onDispatch(shipment))}
              >
                <Truck className="mr-1.5 h-3.5 w-3.5" /> Sevk Et (kapıyı atla)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            type="button"
            size="sm"
            className="gap-1"
            disabled={busy}
            onClick={stop(() => onDispatch(shipment))}
          >
            <Truck className="h-3.5 w-3.5" /> {isReady ? "Sevk Et" : "Sevk Et / Alındı"}
          </Button>
        )}
      </div>
    </PermissionGate>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  decimals = 0,
}: {
  icon: typeof Package;
  label: string;
  value: number;
  decimals?: number;
}) {
  return (
    <div className="rounded border bg-card p-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">
        <AnimatedNumber value={value} decimals={decimals} />
      </div>
    </div>
  );
}
