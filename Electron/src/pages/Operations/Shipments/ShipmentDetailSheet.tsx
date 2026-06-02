import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Package } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { safeFormat } from "@/lib/format";
import { shipmentService } from "./service";
import { shipmentStatusLabels, shipmentStatusTones } from "./types";
import { ShipmentDispatchNote } from "./ShipmentDispatchNote";

const fmt = (n: number) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

interface Props {
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShipmentDetailSheet({ shipmentId, open, onOpenChange }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);

  // Lazy — yalnız açılınca detay çekilir. queryKey irsaliye ile paylaşılır (cache).
  const q = useQuery({
    queryKey: ["shipment-detail", shipmentId],
    queryFn: () => shipmentService.getDetail(shipmentId!),
    enabled: open && Boolean(shipmentId),
    staleTime: 30_000,
  });
  const d = q.data?.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{d?.shipmentNo ?? "Sevkiyat"}</span>
            {d && (
              <StatusBadge
                status={d.status}
                labels={shipmentStatusLabels}
                tones={shipmentStatusTones}
              />
            )}
          </SheetTitle>
          <SheetDescription>
            {d ? `${d.customer.name}${d.branch ? " · " + d.branch.name : ""}` : "Yükleniyor…"}
          </SheetDescription>
        </SheetHeader>

        {q.isLoading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : !d ? (
          <p className="mt-4 text-sm text-muted-foreground">Sevkiyat bulunamadı.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setNoteOpen(true)}
            >
              <FileText className="h-3.5 w-3.5" /> Sevk İrsaliyesi
            </Button>

            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label="Top" value={`${d.summary.rollCount}`} />
              <SummaryCard label="Toplam Metraj" value={`${fmt(d.summary.totalMeters)} m`} />
              <SummaryCard
                label="Çuval / Kg"
                value={`${d.summary.sackCount} · ${fmt(d.summary.totalKg)} kg`}
              />
            </div>

            <Card>
              <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-sm">
                <Info label="Plaka" value={d.plateNumber} />
                <Info label="Sürücü" value={d.driverName} />
                <Info label="Taşıyıcı" value={d.carrier} />
                <Info
                  label="Sevk Tarihi"
                  value={d.dispatchedAt ? safeFormat(d.dispatchedAt, "dd.MM.yyyy HH:mm") : null}
                />
              </CardContent>
            </Card>

            {d.orders.map((o) => (
              <Card key={o.id}>
                <CardContent className="p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <span className="font-mono font-semibold">{o.orderNumber}</span>
                    {o.deadline && (
                      <span className="text-muted-foreground">
                        termin {safeFormat(o.deadline, "dd.MM.yyyy")}
                      </span>
                    )}
                  </div>
                  <table className="w-full text-[11px] tabular-nums">
                    <thead>
                      <tr className="text-muted-foreground [&>th]:px-1 [&>th]:py-0.5 [&>th]:font-medium">
                        <th className="text-left">Ürün</th>
                        <th className="text-right">İstenen</th>
                        <th className="text-right">Açık</th>
                        <th className="text-right">Bu sevk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.lines.map((l) => (
                        <tr key={l.lineId} className="border-t [&>td]:px-1 [&>td]:py-0.5">
                          <td className="text-left">
                            {l.customerItemName ?? l.item.name}
                            {l.color ? ` · ${l.customerColorName ?? l.color.name}` : ""}
                            {l.width ? ` · ${l.width}cm` : ""}
                          </td>
                          <td className="text-right text-muted-foreground">{fmt(l.requested)}</td>
                          <td className="text-right text-muted-foreground">{fmt(l.openQty)}</td>
                          <td className="text-right font-semibold">{fmt(l.thisShipment)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ))}

            {d.rolls.length > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Package className="h-3.5 w-3.5" /> Toplar ({d.rolls.length})
                  </div>
                  <div className="space-y-0.5 text-[11px]">
                    {d.rolls.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{r.barcode ?? "—"}</span>
                        <span className="truncate text-muted-foreground">
                          {r.item?.name}
                          {r.color ? ` · ${r.color.name}` : ""}
                        </span>
                        <span className="tabular-nums">{fmt(r.currentQty)} m</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {d.sacks.length > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Çuvallar ({d.sacks.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {d.sacks.map((s) => (
                      <span key={s.id} className="rounded border px-1.5 py-0.5 tabular-nums">
                        #{s.seq}: {s.weightKg != null ? `${fmt(s.weightKg)} kg` : "—"}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <ShipmentDispatchNote
          shipmentId={shipmentId}
          open={noteOpen}
          onOpenChange={setNoteOpen}
        />
      </SheetContent>
    </Sheet>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value || "—"}</div>
    </>
  );
}
