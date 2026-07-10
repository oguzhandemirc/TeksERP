import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { rollService } from "./service";
import type { Roll } from "./types";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rolls: Roll[];
  /** İşlem sonrası (kısmi bile olsa) — tabloyu/seçimi tazelemek için. */
  onDone?: () => void;
}

/**
 * Ham stoktan toplu iptal — yanlış/mükerrer giriş düzeltmesi. Her top backend
 * `DELETE /api/rolls/:id` (softDelete) ile CANCELLED'a çekilir — fire (SCRAP)
 * DEĞİL; audit korunur, movement/sevkiyat rezervi temizlenir. Tekli StatusOverride
 * ile aynı domain; burada çoklu seçim + tek onay. Yıkıcı-işlem kuralı: etkilenen
 * her top somut listelenir.
 */
export function BulkCancelRollsDialog({ open, onOpenChange, rolls, onDone }: Props) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;

  const run = async () => {
    setProgress({ done: 0, total: rolls.length });
    let ok = 0;
    const failed: string[] = [];
    for (const r of rolls) {
      try {
        await rollService.remove(r.id);
        ok++;
      } catch {
        failed.push(r.barcode ?? r.item?.name ?? r.id);
      }
      setProgress({ done: ok + failed.length, total: rolls.length });
    }
    await qc.invalidateQueries({ queryKey: ["rolls"] });
    if (failed.length === 0) {
      toast.success(`${ok} top stoktan kaldırıldı (iptal edildi)`);
    } else {
      toast.error(`${ok} başarılı, ${failed.length} başarısız`, {
        description: failed.slice(0, 5).join(", ") + (failed.length > 5 ? "…" : ""),
      });
    }
    setProgress(null);
    onDone?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Stoktan Kaldır — {rolls.length} top
          </DialogTitle>
          <DialogDescription>
            Seçili toplar <strong>iptal (CANCELLED)</strong> edilir — fire (SCRAP) değil.
            Kayıt audit için korunur, aktif stoktan düşer. Yanlış/mükerrer giriş düzeltmesi
            içindir. Bir top çuval/sevkiyata rezerveyse iptal onu oradan da çıkarır.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-56 divide-y overflow-auto rounded-md border text-sm">
          {rolls.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-1.5">
              <span className="font-mono text-xs">{r.barcode ?? "—"}</span>
              <span className="flex-1 truncate">{r.item?.name ?? "—"}</span>
              <span className="tabular-nums text-muted-foreground">
                {DEC.format(r.currentQty)} mt
              </span>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={busy || rolls.length === 0} onClick={() => void run()}>
            {busy ? `${progress?.done}/${progress?.total}…` : `${rolls.length} topu stoktan kaldır`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
