import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Package, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat } from "@/lib/format";
import { shipmentService } from "./service";
import { DirectShipPrintDialog } from "./DirectShipPrintDialog";

const fmt = (n: number) =>
  Number(n).toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });

/** Fasondan sevk detayını çeker — Sheet + Modal + içerik aynı queryKey'i paylaşır (dedupe). */
export function useDirectShipmentDetail(directShipmentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["direct-shipment-detail", directShipmentId],
    queryFn: () => shipmentService.getDirectShipmentDetail(directShipmentId!),
    enabled: enabled && Boolean(directShipmentId),
    staleTime: 30_000,
  });
}

/** Küçük künye satırı — etiket + değer. */
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{value}</span>
    </div>
  );
}

/**
 * Fasondan sevk (DirectShipment) detayının GÖVDESİ — künye + toplar + karşılanan
 * siparişler + "İrsaliye". Sheet (Sevkiyatlar) ve Modal (Parti Geçmişi) tarafından
 * paylaşılır; başlığı (shipmentNo/müşteri) saran bileşen kendi query'siyle gösterir.
 */
export function DirectShipmentDetailContent({
  directShipmentId,
  enabled = true,
}: {
  directShipmentId: string | null;
  enabled?: boolean;
}) {
  const [printOpen, setPrintOpen] = useState(false);
  const q = useDirectShipmentDetail(directShipmentId, enabled);
  const d = q.data?.data;

  return (
    <>
      {q.isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !d ? (
        <p className="mt-4 text-sm text-muted-foreground">Fasondan sevk kaydı bulunamadı.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Künye */}
          <Card>
            <CardContent className="space-y-1.5 py-4">
              <Row label="Müşteri" value={d.customer.name} />
              {d.branch && (
                <Row
                  label="Şube"
                  value={d.branch.code ? `${d.branch.name} (${d.branch.code})` : d.branch.name}
                />
              )}
              <Row
                label="Fason Firma"
                value={
                  <span>
                    {d.dispatch.subcontractor.name}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      ({d.dispatch.dispatchNo})
                    </span>
                  </span>
                }
              />
              <Row
                label="İş Emri"
                value={<span className="font-mono">{d.dispatch.workOrder.workOrderNumber}</span>}
              />
              <Row label="Adım" value={d.dispatch.stationName} />
              <Row label="Toplam" value={`${fmt(d.totalQty)} m · ${d.rollCount} top`} />
              <Row label="Sevk Tarihi" value={safeFormat(d.shippedAt, "dd.MM.yyyy HH:mm")} />
              {d.shippedBy && <Row label="Sevk Eden" value={d.shippedBy} />}
              <Row label="Sebep" value={d.reason} />
            </CardContent>
          </Card>

          {/* Toplar */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
              <Package className="h-4 w-4 text-muted-foreground" />
              Sevk Edilen Toplar ({d.rolls.length})
            </div>
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <tbody>
                    {d.rolls.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{r.barcode ?? "açık kumaş"}</td>
                        <td className="px-3 py-2">
                          <span className="text-muted-foreground">{r.itemName}</span>
                          {r.colorName && (
                            <Badge variant="muted" className="ml-1.5 text-[10px]">
                              {r.colorName}
                            </Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                          {r.width != null ? `${fmt(r.width)} cm` : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.qualityGrade ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {fmt(r.currentQty)} m
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          {/* Karşılanan siparişler */}
          {d.allocations.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                <Truck className="h-4 w-4 text-muted-foreground" />
                Karşılanan Siparişler ({d.allocations.length})
              </div>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <tbody>
                      {d.allocations.map((a, i) => (
                        <tr key={`${a.orderNumber}-${i}`} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">{a.orderNumber}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {a.itemName}
                            {a.colorName ? ` · ${a.colorName}` : ""}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {fmt(a.qty)} m
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}

          <Button type="button" className="w-full gap-1.5" onClick={() => setPrintOpen(true)}>
            <FileText className="h-4 w-4" /> İrsaliye
          </Button>
        </div>
      )}

      <DirectShipPrintDialog
        directShipmentId={directShipmentId}
        open={printOpen}
        onOpenChange={setPrintOpen}
        onBack={() => setPrintOpen(false)}
      />
    </>
  );
}
