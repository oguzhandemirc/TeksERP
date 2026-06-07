import { DoorOpen, Undo2, Truck, Package, Scale, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { safeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sackStoreStatusLabels, type SackStoreShipment } from "./types";

// Tone seti "purple" içermiyor; Çuval Depo (READY) için mor className ile
// override; Kapı Önü (AT_DOOR) için mevcut "warning" (amber) tonu.
const STATUS_TONES = { READY: "neutral", AT_DOOR: "warning" } as const;
const READY_CLASS =
  "bg-purple-500/15 text-purple-600 dark:text-purple-300 border-transparent";

const fmtKg = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

interface Props {
  shipment: SackStoreShipment;
  busy: boolean;
  onMoveToDoor: (s: SackStoreShipment) => void;
  onPullBack: (s: SackStoreShipment) => void;
  onDispatch: (s: SackStoreShipment) => void;
}

export function SackStoreCard({ shipment, busy, onMoveToDoor, onPullBack, onDispatch }: Props) {
  const isReady = shipment.status === "READY";

  return (
    <Card className={cn("overflow-hidden", isReady ? "border-purple-500/30" : "border-warning/40")}>
      <CardContent className="space-y-3 p-4">
        {/* Başlık + durum + müşteri/şube */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{shipment.shipmentNo}</span>
              <StatusBadge
                status={shipment.status}
                labels={sackStoreStatusLabels}
                tones={STATUS_TONES}
                className={isReady ? READY_CLASS : undefined}
              />
            </div>
            <div className="mt-0.5 truncate text-sm text-muted-foreground">
              {shipment.customer.name}
              {shipment.branch ? ` · ${shipment.branch.name}` : ""}
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
            onDispatch={onDispatch}
          />
        </div>

        {/* Özet sayaçlar */}
        <div className="grid grid-cols-3 gap-2">
          <Stat icon={Package} label="Çuval" value={shipment.sackCount} />
          <Stat icon={Scale} label="Kg" value={shipment.totalKg} decimals={1} />
          <Stat icon={Layers} label="Metraj" value={shipment.totalQty} decimals={2} />
        </div>

        {/* Çuvallar — kod, ağırlık, içerik */}
        <div className="space-y-2">
          {shipment.sacks.length === 0 ? (
            <div className="rounded border border-dashed p-2 text-center text-xs text-muted-foreground">
              Çuval yok
            </div>
          ) : (
            shipment.sacks.map((sack) => (
              <div key={sack.id} className="rounded border bg-muted/30 p-2">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold">
                    Çuval #{sack.seq}
                    {sack.manualCode && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
                        {sack.manualCode}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {sack.weightKg != null ? `${fmtKg(sack.weightKg)} kg` : "tartılmadı"} ·{" "}
                    {sack.rollCount} top
                    {sack.swatchCount > 0 ? ` · ${sack.swatchCount} kartela` : ""}
                  </span>
                </div>
                {sack.contents.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">boş</div>
                ) : (
                  <div className="space-y-0.5 text-[11px]">
                    {sack.contents.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {c.itemName}
                          {c.colorName ? ` · ${c.colorName}` : ""}
                          {c.width != null ? ` · ${fmtInt(c.width)} cm` : ""}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {fmtM(c.qty)} m · {c.rollCount} top
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SackStoreActions({ shipment, busy, onMoveToDoor, onPullBack, onDispatch }: Props) {
  const isReady = shipment.status === "READY";
  return (
    <PermissionGate permission="shipping:write">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {isReady ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={busy}
            onClick={() => onMoveToDoor(shipment)}
          >
            <DoorOpen className="h-3.5 w-3.5" /> Kapı Önüne Koy
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={busy}
            onClick={() => onPullBack(shipment)}
          >
            <Undo2 className="h-3.5 w-3.5" /> Çuval Depoya Geri Çek
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          className="gap-1"
          disabled={busy}
          onClick={() => onDispatch(shipment)}
        >
          <Truck className="h-3.5 w-3.5" /> {isReady ? "Sevk Et" : "Sevk Et / Alındı"}
        </Button>
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
