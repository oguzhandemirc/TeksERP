import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { safeFormat } from "@/lib/format";
import { workOrderService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  workOrderNumber: string;
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

/**
 * "Sipariş Bağla" — üretim başlamış (hatta boyahanedeki) bir iş emrine sonradan
 * sipariş bağlama yolu (2026-08-17, madde 8).
 *
 * Neden "Düzenle" ekranı DEĞİL: orası iş emrinin her şeyini açıyor ve saha
 * personeli sipariş bağlarken yanlışlıkla rotayı/hedefi bozabiliyordu. Bu
 * diyalog yalnız bağ kurar.
 *
 * ⚠️ Liste zaten kumaş+renk uyumuna göre SUNUCUDA süzülür — burada ikinci bir
 * süzgeç kurma; uyuşmazlık kararı tek yerde (backend) yaşamalı, yoksa ekran
 * "bağlanabilir" dediği satırda 400 alır.
 */
export function LinkOrderDialog({ open, onOpenChange, workOrderId, workOrderNumber }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["work-order-linkable-lines", workOrderId],
    queryFn: () => workOrderService.getLinkableOrderLines(workOrderId),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: (ids: string[]) => workOrderService.linkOrderLines(workOrderId, ids),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sipariş bağlandı");
      // Uyarılar ayrı basılır: bağ KURULDU ama planlamacının bilmesi gereken
      // bir fark var (bugün: en). Başarı toast'ına gömmek onu görünmez yapardı.
      for (const w of res.data.warnings) toast.warning(w);
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order", workOrderId] });
      setSelected(new Set());
      onOpenChange(false);
    },
  });

  const lines = q.data?.data ?? [];
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Sipariş Bağla — {workOrderNumber}
          </DialogTitle>
          <DialogDescription>
            Yalnız bu iş emrinin ürettiği kumaş ve renkle uyumlu sipariş satırları
            listelenir. Bağlamak iş emrinin hedefini <strong>değiştirmez</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] overflow-auto rounded-md border">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </div>
          ) : lines.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Bu iş emriyle uyumlu, açık bir sipariş satırı yok.
              <div className="mt-1 text-xs">
                Kumaş veya renk farklıysa satır burada görünmez — üretim rengi
                gerçekten değişecekse önce “Rengi Değiştir”i kullanın.
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs">
                <tr>
                  <th className="w-9 p-2" />
                  <th className="p-2 text-left font-medium">Sipariş / Müşteri</th>
                  <th className="p-2 text-left font-medium">Kumaş / Renk</th>
                  <th className="p-2 text-right font-medium">Açık</th>
                  <th className="p-2 text-left font-medium">Termin</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.id}
                    className="cursor-pointer border-t transition-colors hover:bg-accent/40"
                    onClick={() => toggle(l.id)}
                  >
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} />
                    </td>
                    <td className="p-2">
                      <div className="font-mono text-xs">{l.orderNumber}</div>
                      <div className="text-xs text-muted-foreground">{l.customerName}</div>
                    </td>
                    <td className="p-2">
                      <div>{l.itemName}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.colorName ?? "renksiz"}
                        {l.width != null ? ` · ${l.width} cm` : ""}
                      </div>
                      {l.warnings.map((w) => (
                        <div
                          key={w}
                          className="mt-1 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300"
                        >
                          <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
                        </div>
                      ))}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      <div className="font-medium">{fmt(l.openQty)} m</div>
                      <div className="text-[11px] text-muted-foreground">
                        {fmt(l.quantity)} istendi
                      </div>
                    </td>
                    <td className="p-2 text-xs">
                      {l.deadline ? safeFormat(l.deadline, "dd.MM.yyyy") : <Badge variant="muted">—</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || mutation.isPending}
            onClick={() => mutation.mutate([...selected])}
          >
            {mutation.isPending ? "Bağlanıyor…" : `Bağla (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
