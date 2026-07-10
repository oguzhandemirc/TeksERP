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

const fmtM = (n: number) => Number(n).toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface Props {
  /** İptal edilecek sevkiyat id'si — null ise dialog kapalı. */
  shipmentId: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sevkiyat iptali — yıkıcı onay (CLAUDE.md kuralı: etkilenen her kayıt SOMUT
 * listelenir; soyut "N kayıt" yetmez). Önizleme backend cancel-preview'dan
 * canlı gelir: serbest kalacak toplar, silinecek çuvallar, karşılanması geri
 * sarılacak siparişler. DISPATCHED iptal edilemez (backend de reddeder).
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
      void qc.invalidateQueries({ queryKey: ["packing"] });
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
                {p.branchName ? ` · ${p.branchName}` : ""} — sevkiyat <strong>iptal</strong> edilecek: toplar
                serbest depoya döner, çuvallar (tartılarıyla) silinir, sipariş karşılanması geri sarılır.
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
            {p.rolls.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Serbest kalacak {p.rolls.length} top
                  {p.sackCount > 0 ? ` · silinecek ${p.sackCount} çuval` : ""}
                  {p.swatchCount > 0 ? ` · ${p.swatchCount} kartela` : ""}
                </div>
                <ul className="max-h-48 divide-y overflow-y-auto text-xs">
                  {p.rolls.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1">
                      <span className="font-mono">{r.barcode ?? "Açık Kumaş"}</span>
                      <span className="truncate text-muted-foreground">
                        {r.itemName}
                        {r.colorName ? ` · ${r.colorName}` : ""}
                      </span>
                      <span className="shrink-0 tabular-nums">{fmtM(r.currentQty)} m</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.affectedOrders.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Karşılanması geri sarılacak siparişler
                </div>
                <ul className="divide-y text-xs">
                  {p.affectedOrders.map((o) => (
                    <li key={o.orderNumber} className="flex items-center justify-between px-3 py-1">
                      <span className="font-mono">{o.orderNumber}</span>
                      <span className="tabular-nums">−{fmtM(Number(o.qty))} m</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.rolls.length === 0 && p.affectedOrders.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Sevkiyat boş — içerik/karşılanma etkisi yok, kayıt iptal olarak işaretlenecek.
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
