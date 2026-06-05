import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import { returnsService, type ReturnRow } from "./service";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

export function ReturnsDetailSheet({ row, onClose }: { row: ReturnRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const cancelMut = useMutation({
    mutationFn: () => returnsService.cancel(row!.id, reason.trim()),
    onSuccess: () => {
      toast.success("İade iptal edildi — top sevkiyatına geri döndü.");
      void qc.invalidateQueries({ queryKey: ["returns"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      setReason("");
      onClose();
    },
  });

  const cancelled = !!row?.cancelledAt;

  return (
    <Sheet
      open={!!row}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="font-mono">{row.roll?.barcode ?? "—"}</span>
                {cancelled ? (
                  <Badge variant="destructive">İptal</Badge>
                ) : (
                  <Badge variant="secondary">İade</Badge>
                )}
              </SheetTitle>
              <SheetDescription>
                {row.item?.name ?? "—"}
                {row.color ? ` · ${row.color.name}` : ""}
                {row.width != null ? ` · ${row.width} cm` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-3">
              <div className="space-y-2 rounded-md border bg-card/40 p-3">
                <Row label="Metraj">{DEC.format(row.qty)} m</Row>
                <Row label="Müşteri">{row.customer?.name ?? "—"}</Row>
                <Row label="Sipariş">{row.order?.orderNumber ?? "—"}</Row>
                <Row label="Sevkiyat">{row.fromShipment?.shipmentNo ?? "—"}</Row>
                <Row label="Neden">{row.reason?.name ?? row.reasonText ?? "—"}</Row>
                {row.reason && row.reasonText && <Row label="Açıklama">{row.reasonText}</Row>}
                {row.qualityGrade && <Row label="Kalite">{row.qualityGrade.name}</Row>}
                {row.note && <Row label="Not">{row.note}</Row>}
                <Row label="Teslim alan">{row.receivedBy?.fullName ?? "—"}</Row>
                <Row label="Tarih">{safeFormat(row.createdAt, "dd.MM.yyyy HH:mm")}</Row>
              </div>

              {cancelled ? (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">İptal Edildi</div>
                  <div className="font-medium">{row.cancelReason ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.cancelledBy?.fullName ?? "—"} ·{" "}
                    {safeFormat(row.cancelledAt!, "dd.MM.yyyy HH:mm")}
                  </div>
                </div>
              ) : (
                <PermissionGate permission="return:write">
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">
                      İadeyi İptal Et (geri al)
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Yanlış iade kabulünü geri alır: top tekrar sevk edilmiş sayılır (sevkiyatına
                      döner). Sadece top iade sonrası işlem görmediyse mümkün. Sebep zorunlu.
                    </p>
                    <Input
                      placeholder="İptal sebebi (örn. yanlış top okutuldu)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Button
                      variant="destructive"
                      className="w-full"
                      disabled={reason.trim().length < 3 || cancelMut.isPending}
                      onClick={() => cancelMut.mutate()}
                    >
                      {cancelMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                      İadeyi İptal Et
                    </Button>
                  </div>
                </PermissionGate>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
