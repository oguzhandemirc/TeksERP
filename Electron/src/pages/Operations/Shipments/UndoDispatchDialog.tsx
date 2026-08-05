import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/FormField";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import { shipmentService } from "./service";

interface Props {
  /** Geri alınacak sevkiyat id'si — null ise dialog kapalı. */
  shipmentId: string | null;
  onOpenChange: (open: boolean) => void;
}

const shelfLabel = (s: string) => rollStatusLabels[s as RollStatus] ?? s;

/**
 * "Sevki Geri Al" (storno) — İADE DEĞİL.
 *
 * Kullanım anı: mal FİZİKSEL olarak çıkmadı (araç kapıda, yanlış sevkiyat
 * onaylandı). Sevk irsaliyesi İPTAL edilir, toplar sevk ÖNCESİ rafına döner,
 * sipariş karşılanması geri alınır. İade defterine kayıt GİRMEZ.
 *
 * Mal müşteriye ulaşıp geri geldiyse burası DEĞİL, "İade Takibi → Yeni İade"
 * kullanılır (çıkış belgesi düzeltilmez, ayrı iade irsaliyesi kesilir).
 *
 * Yıkıcı onay kuralı: etkilenen kayıtlar SOMUT listelenir (çuval/top/sipariş +
 * hangi rafa döneceği) ve gerekçe zorunludur. Engel sebebi backend'in TEK
 * kaynağından (`blockReason`) gelir — istemci kendi kuralını kurmaz.
 */
export function UndoDispatchDialog({ shipmentId, onOpenChange }: Props) {
  const qc = useQueryClient();
  const open = !!shipmentId;
  const [reason, setReason] = useState("");

  const previewQ = useQuery({
    queryKey: ["shipment-undo-preview", shipmentId],
    queryFn: () => shipmentService.undoDispatchPreview(shipmentId!),
    enabled: open,
    gcTime: 0, // her açılışta taze — bayat dökümle geri alma onaylanmasın
  });
  const p = previewQ.data?.data;

  const undoMut = useMutation({
    mutationFn: () => shipmentService.undoDispatch(shipmentId!, reason.trim()),
    onSuccess: (r) => {
      toast.success(r.message ?? `Sevk geri alındı: ${p?.shipmentNo ?? ""}`);
      // Stok + karşılanma + belge durumu değişti — dokunan tüm cache'ler tazelensin.
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["shipment-detail", shipmentId] });
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
      void qc.invalidateQueries({ queryKey: ["sack-search"] });
      void qc.invalidateQueries({ queryKey: ["packing"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["ops-visibility"] });
      setReason("");
      onOpenChange(false);
    },
  });

  const reasonOk = reason.trim().length >= 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (undoMut.isPending) return; // çift-tık/kaza kapanma kilidi
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sevki Geri Al — {p?.shipmentNo ?? ""}</DialogTitle>
          <DialogDescription>
            {p ? (
              <>
                {p.customerName}
                {p.branchName ? ` · ${p.branchName}` : ""} — mal <strong>fiziksel olarak çıkmadıysa</strong>{" "}
                kullanılır. Müşteriye ulaşıp geri geldiyse bunun yerine <strong>İade</strong> alın.
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
            Önizleme yüklenemedi — döküm görülmeden geri alma onaylanamaz.
          </p>
        ) : !p.canUndo ? (
          <p className="text-sm text-destructive">{p.blockReason}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Depoya dönecek:{" "}
              <span className="font-semibold tabular-nums text-foreground">{p.sackCount}</span> çuval ·{" "}
              <span className="font-semibold tabular-nums text-foreground">{p.rollCount}</span> top
              {p.swatchCount > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold tabular-nums text-foreground">{p.swatchCount}</span> kartela
                </>
              )}
            </div>

            {p.returnTargets.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Toplar hangi rafa dönecek
                </div>
                <ul className="divide-y text-xs">
                  {p.returnTargets.map((t) => (
                    <li key={t.status} className="flex items-center justify-between px-3 py-1">
                      <span>{shelfLabel(t.status)}</span>
                      <span className="tabular-nums">{t.rollCount} top</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.affectedOrders.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Karşılanması geri alınacak siparişler
                </div>
                <ul className="max-h-32 divide-y overflow-y-auto text-xs">
                  {p.affectedOrders.map((o) => (
                    <li key={o} className="px-3 py-1 font-mono">
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Sevk irsaliyesi <strong>İPTAL</strong> edilecek (silinmez — İPTAL filigranıyla basılabilir
              kalır). Yeniden sevk edildiğinde yeni bir versiyon üretilir.
              {(p.plateNumber || p.driverName) && (
                <>
                  {" "}
                  Araç/şoför bilgisi ({[p.plateNumber, p.driverName].filter(Boolean).join(" · ")}) korunur.
                </>
              )}
            </div>

            <FormField label="Geri alma gerekçesi" required>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Örn: araç yüklenmeden sevk onaylandı, 2 top eksik çıktı"
              />
            </FormField>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button variant="outline" disabled={undoMut.isPending} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={undoMut.isPending || previewQ.isLoading || !p?.canUndo || !reasonOk}
            onClick={() => undoMut.mutate()}
          >
            {undoMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Undo2 className="mr-1 h-4 w-4" />
            )}
            Sevki Geri Al
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
