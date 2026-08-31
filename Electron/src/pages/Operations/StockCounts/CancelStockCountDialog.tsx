// =============================================================================
// TASLAK SAYIMI İPTAL ET
// =============================================================================
// ⚠️ BU İŞLEM DEFTERE DOKUNMAZ ve diyalog bunu açıkça söyler: taslak sayım bir
// ÇALIŞMA KÂĞIDIDIR, tamamlanmadığı sürece hiçbir top iptal edilmemiş, hiçbir
// bakiye değişmemiştir. Buradaki "yıkım" yalnız girilmiş işaretlerin ARTIK
// KULLANILAMAZ olmasıdır — satırlar silinmez, sayım kaydı durur.
//
// ⚠️ SEBEP OPSİYONELDİR (backend de öyle). Zorunlu kılmak, vardiya ortasında
// "aaa" doldurmaları üretirdi (2026-08-04 katalog dersi) ve bu karar — yanlış
// depoda açılmış bir taslağı kapatmak — çoğu zaman gerçekten açıklamasızdır.
// Yazılırsa audit'e girer.
// =============================================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelStockCount, type StockCountDetail } from "./service";
import { countProgress } from "./stockCountRules";

interface Props {
  count: StockCountDetail;
  onOpenChange: (open: boolean) => void;
  onCancelled: () => void;
}

export function CancelStockCountDialog({ count, onOpenChange, onCancelled }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const p = countProgress(count.lines);
  const marked = p.rollFound + p.rollMissing + p.yarnCounted;

  const cancelM = useMutation({
    mutationFn: () => cancelStockCount(count.id, reason.trim() || undefined),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.countNo} iptal edildi.`);
      void qc.invalidateQueries({ queryKey: ["stock-counts"] });
      void qc.invalidateQueries({ queryKey: ["stock-count", count.id] });
      onOpenChange(false);
      onCancelled();
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Taslak sayım iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            <b className="font-mono">{count.countNo}</b> kapanır ve bir daha işaretlenemez. Stok,
            bakiye ve belgeler ETKİLENMEZ — taslak sayım hiçbir deftere yazmamıştı. Girilmiş{" "}
            <b>{marked}</b> işaret kayıtta kalır ama kullanılamaz; aynı depo için yeni bir sayım
            açabilirsiniz.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="sc-cancel-reason">İptal sebebi (opsiyonel)</Label>
          <Textarea
            id="sc-cancel-reason"
            className="mt-1"
            rows={2}
            maxLength={300}
            placeholder="Örn. yanlış depoda açıldı."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={cancelM.isPending} onClick={() => cancelM.mutate()}>
            {cancelM.isPending ? "İptal ediliyor…" : "Sayımı iptal et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
