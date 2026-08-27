import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Factory, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { orderService } from "./service";
import { reasonPresetService } from "@/pages/ReasonPresets/service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  lineId: string | null;
  onCancelled?: () => void;
}

const NUM = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/**
 * KALEM İPTALİ ONAY EKRANI.
 *
 * CLAUDE.md kuralı: yıkıcı işlemde etkilenen HER kayıt somut listelenir —
 * "3 kayıt etkilenecek" gibi soyut sayı yetmez. Bu yüzden koparılacak iş emri
 * bağları tek tek, siparişin akıbeti de açıkça yazılır.
 */
export function OrderLineCancelDialog({ open, onOpenChange, orderId, lineId, onCancelled }: Props) {
  const qc = useQueryClient();
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");

  const previewQuery = useQuery({
    queryKey: ["order-line-cancel-preview", orderId, lineId],
    queryFn: () => orderService.getLineCancelPreview(orderId!, lineId!),
    enabled: open && Boolean(orderId && lineId),
    staleTime: 0,
  });
  const preview = previewQuery.data?.data;

  const presets = useQuery({
    queryKey: ["reason-presets", "order-cancel"],
    queryFn: () => reasonPresetService.list(false),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  // Kalem iptali sipariş iptaliyle AYNI kataloğu kullanır: fabrikanın tek
  // yerden düzenlediği sebep listesi ikiye bölünmesin.
  const reasonOptions = useMemo(
    () => (presets.data ?? []).filter((p) => p.kind === "ORDER_CANCEL").sort((a, b) => a.sortOrder - b.sortOrder),
    [presets.data],
  );
  const chosen = reasonOptions.find((p) => p.code === reasonCode);
  const needsText = chosen?.requiresText === true;
  const reasonIncomplete = needsText && reasonText.trim().length === 0;

  const mut = useMutation({
    mutationFn: () => {
      // Serbest metinde KOD gönderilmez — sunucu türetemezse NULL bırakır ve
      // rapor onu "kodsuz" kovasında gösterir (uydurulmuş kod raporu kirletir).
      const reason = chosen
        ? needsText
          ? { reasonText: reasonText.trim() }
          : { reasonCode: chosen.code, reasonText: chosen.fullText ?? chosen.label }
        : undefined;
      return orderService.cancelOrderLine(orderId!, lineId!, reason);
    },
    onSuccess: (res) => {
      toast.success(res.message ?? "Kalem iptal edildi.");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onOpenChange(false);
      setReasonCode("");
      setReasonText("");
      onCancelled?.();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Kalemi İptal Et
          </DialogTitle>
          <DialogDescription>
            Kalem <strong>silinmez</strong> — listede "iptal" işaretli kalır ve varsa sevk edilmiş
            metrajı defterde durmaya devam eder. İptal edilen yalnız <strong>kalan</strong> kısımdır.
          </DialogDescription>
        </DialogHeader>

        {previewQuery.isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : !preview ? (
          <p className="py-4 text-sm text-destructive">Önizleme alınamadı.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">
                {preview.itemName}
                {preview.colorName ? ` · ${preview.colorName}` : ""}
                {preview.width != null ? ` · ${NUM.format(preview.width)} cm` : ""}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>İstenen: {NUM.format(preview.requestedQty)} m</span>
                <span>Sevk edilen: {NUM.format(preview.shippedQty)} m</span>
                <span className="font-medium text-destructive">
                  İptal edilecek: {NUM.format(preview.remainingQty)} m
                </span>
              </div>
            </div>

            {preview.affectedWorkOrders.length > 0 && (
              <div className="rounded-md border p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                  <Factory className="h-3.5 w-3.5" />
                  Bağı koparılacak iş emirleri ({preview.affectedWorkOrders.length})
                </div>
                <ul className="space-y-1 text-sm">
                  {preview.affectedWorkOrders.map((w) => (
                    <li key={w.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{w.workOrderNumber}</span>
                      {w.willBecomeStock && (
                        <Badge variant="muted" className="text-[10px]">
                          son bağ → stok üretimine döner
                        </Badge>
                      )}
                      {w.blockedNoTargetItem && (
                        <Badge variant="destructive" className="text-[10px]">
                          hedef kumaşı yok — dönemez
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  İş emirleri iptal edilmez, yalnız bu siparişle bağları kopar.
                </p>
              </div>
            )}

            {preview.isLastActiveLine && preview.resultingOrderStatus && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  Bu, siparişin <strong>son aktif kalemi</strong>. İptal edilince sipariş{" "}
                  <strong>
                    {preview.resultingOrderStatus === "COMPLETED" ? "TAMAMLANDI" : "İPTAL"}
                  </strong>{" "}
                  durumuna geçecek
                  {preview.resultingOrderStatus === "COMPLETED"
                    ? " (bir kısmı sevk edilmiş olduğu için)."
                    : " (hiç sevk yapılmadığı için)."}
                </span>
              </div>
            )}

            {preview.blockers.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <div className="mb-1 font-semibold text-destructive">İptal edilemiyor:</div>
                <ul className="list-inside list-disc space-y-0.5">
                  {preview.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sebep İSTEĞE BAĞLI (sipariş iptaliyle aynı gerekçe: zorunlu tutmak
                operatörü rastgele kategori seçmeye iter). */}
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">İptal sebebi (isteğe bağlı)</label>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={reasonCode}
                disabled={mut.isPending || !preview.canCancel}
                onChange={(e) => {
                  setReasonCode(e.target.value);
                  setReasonText("");
                }}
              >
                <option value="">— Seçilmedi</option>
                {reasonOptions.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
              {needsText && (
                <input
                  autoFocus
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  placeholder="Sebebi yazın"
                  value={reasonText}
                  disabled={mut.isPending}
                  onChange={(e) => setReasonText(e.target.value)}
                />
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={
              previewQuery.isLoading ||
              !preview?.canCancel ||
              mut.isPending ||
              reasonIncomplete
            }
            onClick={() => mut.mutate()}
          >
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Kalemi iptal et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
