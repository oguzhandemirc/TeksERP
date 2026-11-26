// Çözgü talimatı basılı görünüm — iframe önizleme = baskı (aynı HTML string, `printTracked` tek basım boğazı).
// Bir sevkten açılırsa "İrsaliyeyi de bas" seçeneği gelir (varsayılan açık): irsaliye + talimat tek baskı.
import { useState } from "react";
import { Printer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { printTracked } from "@/lib/print";
import { apiErrorMessage } from "@/services/apiClient";
import { buildInstructionHtml } from "./instruction-html";
import { useReedUnit } from "@/hooks/useReedUnit";
import { useWarpingInstruction } from "./yarn-service";
import type { WarpingDispatchRow } from "./yarn-types";

export function InstructionPrintDialog({ orderId, dispatch, onClose }: { orderId: string; dispatch?: WarpingDispatchRow | null; onClose: () => void }) {
  const q = useWarpingInstruction(orderId, true);
  const [withDispatch, setWithDispatch] = useState(Boolean(dispatch));
  const reedUnit = useReedUnit();
  const html = q.data ? buildInstructionHtml(q.data, withDispatch ? dispatch : null, reedUnit) : null;
  const print = () => {
    if (!html || !q.data) return;
    const subject = withDispatch && dispatch
      ? { kind: "BELGE" as const, table: "subcontractor_dispatches" as const, id: dispatch.dispatchId, no: dispatch.dispatchNo }
      : { kind: "BELGE" as const, no: q.data.orderNo };
    void printTracked({ subject, html });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{dispatch ? `${dispatch.dispatchNo} — irsaliye ve çözgü talimatı` : "Çözgü talimatı"}</DialogTitle>
          <DialogDescription>Devereciye giden belge: kart, iplik başına harf/tel/denye, çözgü raporu ve tel düzeni şeridi, tarak planı, levent ve termin. Fiyat ve stok bilgisi yer almaz.</DialogDescription>
        </DialogHeader>
        {dispatch && (
          <div className="flex items-center gap-2">
            <Checkbox id="wd-print-dispatch" checked={withDispatch} onCheckedChange={(v) => setWithDispatch(v === true)} />
            <Label htmlFor="wd-print-dispatch">Sevk irsaliyesini de bas (talimat ayrı sayfada)</Label>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {q.isLoading && <div className="p-4"><Skeleton className="h-64 w-full" /></div>}
          {q.isError && <p role="alert" className="p-4 text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
          {html && <iframe title="Çözgü talimatı önizleme" srcDoc={html} sandbox="allow-same-origin allow-modals" className="h-full w-full border-0 bg-white" />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          <Button className="gap-1" disabled={!html} onClick={print}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
