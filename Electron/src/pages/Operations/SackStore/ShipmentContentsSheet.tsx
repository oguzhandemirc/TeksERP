import { useQuery } from "@tanstack/react-query";
import { Package, Scale, Layers, Truck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat } from "@/lib/format";
import { sackStoreService } from "./service";
import { sackStoreStatusLabels, type SackStoreShipment } from "./types";

const fmtKg = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

interface Props {
  /** Açılan sevkiyat (board kartı) — null ise sheet kapalı. */
  shipment: SackStoreShipment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Çuval Depo board kartına tıklayınca açılan slide-over. Sevkiyatın çuval+rulo
 * dökümünü LAZY çeker (board listesi rulo taşımaz). Tek sevkiyat = sınırlı kapsam.
 */
export function ShipmentContentsSheet({ shipment, open, onOpenChange }: Props) {
  const query = useQuery({
    queryKey: ["sack-contents", shipment?.id],
    queryFn: () => sackStoreService.shipmentContents(shipment!.id),
    enabled: open && !!shipment?.id,
    staleTime: 30_000,
  });
  const detail = query.data?.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{shipment?.shipmentNo}</span>
            {shipment && (
              <Badge variant="outline" className="text-[10px]">
                {sackStoreStatusLabels[shipment.status]}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {shipment?.customer.name}
            {shipment?.branch ? ` · ${shipment.branch.name}` : ""}
          </SheetDescription>
        </SheetHeader>

        {shipment && (
          <div className="mt-4 space-y-4">
            {/* Özet sayaçlar + taşıma bilgisi */}
            <div className="grid grid-cols-3 gap-2">
              <SummaryStat icon={Package} label="Çuval" value={fmtInt(shipment.sackCount)} />
              <SummaryStat icon={Scale} label="Kg" value={fmtKg(shipment.totalKg)} />
              <SummaryStat icon={Layers} label="Metraj" value={`${fmtM(shipment.totalQty)} m`} />
            </div>

            {detail && (detail.plateNumber || detail.driverName || detail.carrier) && (
              <Card>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-xs">
                  <span className="flex items-center gap-1 font-medium text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" /> Taşıma
                  </span>
                  {detail.plateNumber && <span className="font-mono">{detail.plateNumber}</span>}
                  {detail.driverName && <span>{detail.driverName}</span>}
                  {detail.carrier && <span className="text-muted-foreground">{detail.carrier}</span>}
                </CardContent>
              </Card>
            )}

            {/* Çuvallar → içindeki toplar */}
            {query.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : !detail || detail.sacks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Bu sevkiyatta çuval yok.
              </p>
            ) : (
              <div className="space-y-3">
                {detail.sacks.map((sack) => (
                  <Card key={sack.id}>
                    <CardContent className="space-y-2 p-3">
                      {/* Çuval başlığı */}
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
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

                      {/* Tek tek toplar (barkodlu) */}
                      {sack.rolls.length === 0 && sack.swatches.length === 0 ? (
                        <div className="text-[11px] text-muted-foreground">Boş çuval.</div>
                      ) : (
                        <ul className="space-y-1">
                          {sack.rolls.map((r) => (
                            <li
                              key={r.id}
                              className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1 text-[11px]"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                {r.color?.hex && (
                                  <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                                    style={{ backgroundColor: r.color.hex }}
                                  />
                                )}
                                <span className="truncate font-mono font-medium">
                                  {r.barcode ?? "Açık Kumaş"}
                                </span>
                              </span>
                              <span className="shrink-0 truncate text-muted-foreground">
                                {r.item.name}
                                {r.color ? ` · ${r.color.name}` : ""}
                                {r.width != null ? ` · ${fmtInt(r.width)} cm` : ""}
                                {r.qualityGrade && r.qualityGrade !== "1.KALITE"
                                  ? ` · ${r.qualityGrade}`
                                  : ""}
                              </span>
                              <span className="shrink-0 tabular-nums font-medium">
                                {fmtM(r.qty)} m
                              </span>
                            </li>
                          ))}
                          {sack.swatches.map((s) => (
                            <li
                              key={s.id}
                              className="flex items-center justify-between gap-2 rounded border border-dashed bg-muted/30 px-2 py-1 text-[11px]"
                            >
                              <span className="truncate font-mono font-medium">
                                {s.barcode ?? "Kartela"}
                              </span>
                              <span className="shrink-0 truncate text-muted-foreground">
                                {s.item.name}
                                {s.color ? ` · ${s.color.name}` : ""} · kartela
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Package;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border bg-card p-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
