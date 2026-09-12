import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Minus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { swatchService, type KartelaStockGroup } from "./swatchService";

interface Props {
  group: KartelaStockGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Kartela stoğunu elle düşürme — kayıp/hasar/numune/sayım düzeltmesi için.
 * Kartelalar fungible ADET sayıldığından per-kayıt seçim YOK; onay somut grubu
 * (kumaş+renk) + adet + zorunlu gerekçeyi gösterir. Backend FIFO ile N kartelayı
 * iptal eder (soft-cancel) → stoktan düşer.
 */
export function ReduceKartelaStockDialog({ group, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [count, setCount] = useState("1");
  const [reason, setReason] = useState("");
  // ⚠️ İDEMPOTENCY ANAHTARI MANTIKSAL DENEME BAŞINA ÜRETİLİR (mobil ikizi
  // `KartelaStockReduceModal`). Token gövdede gitmezse 15 sn zaman aşımında
  // operatör tekrar basar ve FIFO BAŞKA N kartelayı iptal eder: ikinci düşüm satırı.
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (open) {
      setCount("1");
      setReason("");
      setClientToken(crypto.randomUUID());
    }
  }, [open, group?.itemId, group?.colorId]);

  const max = group?.count ?? 0;
  const parsedCount = Number.parseInt(count.trim(), 10);
  const countValid =
    Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= max;
  const reasonValid = reason.trim().length >= 3;

  const mut = useMutation({
    mutationFn: () =>
      swatchService.reduceStock({
        itemId: group!.itemId,
        colorId: group!.colorId,
        count: parsedCount,
        reason: reason.trim(),
        clientToken,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.reduced} kartela düşüldü`);
      void qc.invalidateQueries({ queryKey: ["kartela", "stock"] });
      void qc.invalidateQueries({ queryKey: ["kartela", "stock-reductions"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Minus className="h-4 w-4" /> Stoktan Düş
          </DialogTitle>
          <DialogDescription>
            Kayıp / hasar / numune / sayım düzeltmesi için kartela stoğunu elle
            düşürür. Yanlış düşüm "Düşüm Geçmişi"nden geri alınabilir.
          </DialogDescription>
        </DialogHeader>

        {group && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-black/10"
              style={{ backgroundColor: group.colorHex ?? "transparent" }}
            />
            <span className="min-w-0">
              <span className="block truncate font-medium">{group.itemName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {group.colorName ?? "Renksiz"}
              </span>
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground">
              {group.count} adet mevcut
            </span>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reduce-count">Düşülecek adet</Label>
            <Input
              id="reduce-count"
              type="number"
              min={1}
              max={max}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-32"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reduce-reason">Gerekçe</Label>
            <Input
              id="reduce-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="örn. kayıp, hasar, numune verildi…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mut.isPending}
          >
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            onClick={() => mut.mutate()}
            disabled={!countValid || !reasonValid || mut.isPending}
            className="gap-1"
          >
            <Minus className="h-4 w-4" />
            {mut.isPending ? "Düşülüyor…" : "Stoktan Düş"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
