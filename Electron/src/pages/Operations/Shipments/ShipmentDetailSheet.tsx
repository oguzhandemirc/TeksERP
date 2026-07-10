import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, FileText, Package, Undo2, Target } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { RetargetOrdersDialog } from "./RetargetOrdersDialog";
import { CancelShipmentDialog } from "./CancelShipmentDialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { safeFormat } from "@/lib/format";
import { shipmentService } from "./service";
import { shipmentStatusLabels, shipmentStatusTones } from "./types";
import { ShipmentDispatchNote } from "./ShipmentDispatchNote";

const fmt = (n: number) => Number(n).toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });
const fmtKg = (n: number) => Number(n).toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface Props {
  shipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShipmentDetailSheet({ shipmentId, open, onOpenChange }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [retargetOpen, setRetargetOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Lazy — yalnız açılınca detay çekilir. queryKey irsaliye ile paylaşılır (cache).
  const q = useQuery({
    queryKey: ["shipment-detail", shipmentId],
    queryFn: () => shipmentService.getDetail(shipmentId!),
    enabled: open && Boolean(shipmentId),
    staleTime: 30_000,
  });
  const d = q.data?.data;
  const sackSeqById = new Map((d?.sacks ?? []).map((s) => [s.id, s.seq]));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{d?.shipmentNo ?? "Sevkiyat"}</span>
            {d && <StatusBadge status={d.status} labels={shipmentStatusLabels} tones={shipmentStatusTones} />}
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setNoteOpen(true)}
              >
                <FileText className="h-3.5 w-3.5" /> Sevk İrsaliyesi
              </Button>
              {/* Saha #7: yeniden hedefle — sevk edilmemiş her durumda (DISPATCHED/CANCELLED hariç) */}
              {d.status !== "DISPATCHED" && d.status !== "CANCELLED" && (
                <PermissionGate permission="shipping:write">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setRetargetOpen(true)}
                  >
                    <Target className="h-3.5 w-3.5" /> Siparişleri Değiştir
                  </Button>
                  {/* İptal: araç vazgeçti / sipariş komple iptal — cancel-preview'lı yıkıcı onay */}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 text-destructive hover:text-destructive"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban className="h-3.5 w-3.5" /> İptal Et
                  </Button>
                </PermissionGate>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label="Top" value={`${d.summary.rollCount}`} />
              <SummaryCard label="Toplam Metraj" value={`${fmt(d.summary.totalMeters)} m`} />
              <SummaryCard
                label="Çuval / Kg"
                value={`${d.summary.sackCount} · ${fmtKg(d.summary.totalKg)} kg`}
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
                        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                          {r.sackId != null && sackSeqById.has(r.sackId) && (
                            <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                              Ç#{sackSeqById.get(r.sackId)}
                            </span>
                          )}
                          {fmt(r.currentQty)} m
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {d.summary.returnedCount > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Undo2 className="h-3.5 w-3.5" /> Bu sevkiyattan iade edilenler ({d.summary.returnedCount}
                    )
                  </div>
                  <div className="space-y-0.5 text-[11px]">
                    {d.returnedRolls.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{r.barcode ?? "—"}</span>
                        <span className="truncate text-muted-foreground">
                          {r.item?.name}
                          {r.color ? ` · ${r.color.name}` : ""}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                          {r.reasonName && (
                            <span
                              className="rounded px-1 text-[10px]"
                              style={
                                r.reasonColor
                                  ? { backgroundColor: `${r.reasonColor}22`, color: r.reasonColor }
                                  : undefined
                              }
                            >
                              {r.reasonName}
                            </span>
                          )}
                          {fmt(r.qty)} m
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 border-t pt-1.5 text-[11px] text-muted-foreground">
                    Gönderilen toplam:{" "}
                    <span className="font-semibold tabular-nums text-foreground">
                      {d.summary.rollCount + d.summary.returnedCount} top ·{" "}
                      {fmt(d.summary.totalMeters + d.summary.returnedMeters)} m
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {d.sacks.length > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Çuval İçeriği ({d.sacks.length})
                  </div>
                  <div className="space-y-2">
                    {d.sacks.map((s) => (
                      <div key={s.id} className="rounded border p-2">
                        <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
                          <span>Çuval #{s.seq}</span>
                          <span className="tabular-nums font-normal text-muted-foreground">
                            {s.weightKg != null ? `${fmtKg(s.weightKg)} kg` : "tartılmadı"} · {s.rollCount}{" "}
                            top
                            {s.swatchCount > 0 ? ` · ${s.swatchCount} kartela` : ""}
                          </span>
                        </div>
                        {s.productSummary.length === 0 && s.swatchCount === 0 ? (
                          <div className="text-[11px] text-muted-foreground">boş</div>
                        ) : (
                          <div className="space-y-0.5 text-[11px]">
                            {s.productSummary.map((p, i) => (
                              <div key={i} className="flex items-center justify-between gap-2">
                                <span className="truncate">
                                  {p.itemName}
                                  {p.colorName ? ` · ${p.colorName}` : ""}
                                  {p.width != null ? ` · ${fmt(p.width)}cm` : ""}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {fmt(p.totalQty)} m · {p.rollCount} top
                                </span>
                              </div>
                            ))}
                            {s.swatches.map((sw) => (
                              <div
                                key={sw.id}
                                className="flex items-center justify-between gap-2 text-muted-foreground"
                              >
                                <span className="truncate">
                                  Kartela · {sw.item?.name ?? "—"}
                                  {sw.color ? ` · ${sw.color.name}` : ""}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {sw.length != null ? `${fmt(sw.length)} cm` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <ShipmentDispatchNote shipmentId={shipmentId} open={noteOpen} onOpenChange={setNoteOpen} />

        {d && (
          <RetargetOrdersDialog
            shipmentId={d.id}
            customerId={d.customer.id}
            branchId={d.branch?.id ?? null}
            currentOrderIds={d.orders.map((o) => o.id)}
            open={retargetOpen}
            onOpenChange={setRetargetOpen}
          />
        )}

        <CancelShipmentDialog
          shipmentId={cancelOpen ? shipmentId : null}
          onOpenChange={(o) => setCancelOpen(o)}
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
