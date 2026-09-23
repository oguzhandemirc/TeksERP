import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { shipmentService } from "./service";
import { invalidateSackHub } from "@/pages/Operations/SackContentEdit/useSackData";

const fmtM = (n: number) => Number(n).toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface Props {
  /** İptal edilecek sevkiyat id'si — null ise dialog kapalı. */
  shipmentId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sevkiyat iptali — yıkıcı onay (CLAUDE.md kuralı: etkilenen kayıtlar SOMUT
 * gösterilir). Önizleme backend cancel-preview'dan canlı gelir (havuz modeli):
 * havuza dönecek çuval/top/kartela sayıları + sevkiyattan çıkacak siparişler.
 * DISPATCHED iptal edilemez (backend de reddeder).
 */
export function CancelShipmentDialog({ shipmentId, onOpenChange }: Props) {
  const qc = useQueryClient();
  const open = !!shipmentId;

  const previewQ = useQuery({
    queryKey: ["shipment-cancel-preview", shipmentId],
    queryFn: () => shipmentService.cancelPreview(shipmentId!),
    enabled: open,
    gcTime: 0, // her açılışta taze — bayat dökümle iptal onaylanmasın
  });
  const p = previewQ.data?.data;

  const cancelMut = useMutation({
    mutationFn: () => shipmentService.cancel(shipmentId!),
    onSuccess: () => {
      toast.success(`Sevkiyat iptal edildi: ${p?.shipmentNo ?? ""}`);
      // Toplar serbest kaldı, karşılanma değişti — dokunan tüm cache'ler tazelensin.
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["shipment-detail", shipmentId] });
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
      void qc.invalidateQueries({ queryKey: ["sack-search"] });
      // Sevk/iptal/geri al partiyi kapatır ya da yeniden açar — parti listesi dahil hub ailesi (K16).
      invalidateSackHub(qc);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (cancelMut.isPending) return; // çift-tık/kaza kapanma kilidi
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sevkiyatı İptal Et — {p?.shipmentNo ?? ""}</DialogTitle>
          <DialogDescription>
            {p ? (
              <>
                {p.customerName}
                {p.branchName ? ` · ${p.branchName}` : ""} — sevkiyat <strong>iptal</strong> edilirse çuvallar
                havuza döner, ilgili siparişler bu sevkiyattan çıkar.
              </>
            ) : (
              "Önizleme yükleniyor…"
            )}
          </DialogDescription>
        </DialogHeader>

        {previewQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !p ? (
          <p className="text-sm text-destructive">
            Önizleme yüklenemedi — döküm görülmeden iptal onaylanamaz.
          </p>
        ) : !p.canCancel ? (
          <p className="text-sm text-destructive">{p.reason}</p>
        ) : (
          <div className="space-y-3 text-sm">
            {(p.sackCount > 0 || p.rollCount > 0 || p.swatchCount > 0) && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Havuza dönecek:{" "}
                <span className="font-semibold tabular-nums text-foreground">{p.sackCount}</span> çuval ·{" "}
                <span className="font-semibold tabular-nums text-foreground">{p.rollCount}</span> top
                {p.swatchCount > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold tabular-nums text-foreground">{p.swatchCount}</span> kartela
                  </>
                )}
              </div>
            )}

            {p.affectedOrders.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Sevkiyattan çıkacak siparişler
                </div>
                <ul className="max-h-48 divide-y overflow-y-auto text-xs">
                  {p.affectedOrders.map((o) => (
                    <li key={o.orderNumber} className="flex items-center justify-between px-3 py-1">
                      <span className="font-mono">{o.orderNumber}</span>
                      <span className="tabular-nums">−{fmtM(Number(o.qty))} m</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.sackCount === 0 && p.rollCount === 0 && p.affectedOrders.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Sevkiyat boş — içerik/rezerv etkisi yok, kayıt iptal olarak işaretlenecek.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button variant="outline" disabled={cancelMut.isPending} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={cancelMut.isPending || previewQ.isLoading || !p?.canCancel}
            onClick={() => cancelMut.mutate()}
          >
            {cancelMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Ban className="mr-1 h-4 w-4" />
            )}
            İptal Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
