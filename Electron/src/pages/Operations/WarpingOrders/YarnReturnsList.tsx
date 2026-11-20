// İadeler listesi (D6b-2) — `GET /:id/yarn-returns` (geri alınanlar DAHİL, soluk). "Geri al" yalnız canlı ve sunucunun
// `canCancel` dediği satırda; engel sebebi düğmenin ipucunda. Geri alma iade satırını silmez: karşı satır yazar,
// iplik yeniden deverecide sayılır (onay diyaloğu etkilenen kaydı ve sonucu listeler).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { toastServerSuccess } from "@/lib/serverNotes";
import { cn } from "@/lib/utils";
import { warpingHoldingService, useWarpingReturns } from "./holding-service";
import { pieceText } from "./dispatch-model";
import { fmtKg } from "./order-model";
import { YarnLabel, yarnText } from "./YarnLabel";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingYarnReturnRow } from "./holding-types";

const num = "text-right tabular-nums";

function ReturnCancelDialog({ orderId, row, onClose }: { orderId: string; row: WarpingYarnReturnRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => warpingHoldingService.cancelReturn(orderId, row.movementId, reason.trim()),
    onSuccess: (res) => {
      toastServerSuccess(res, "İade geri alındı.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{yarnText(row.yarnItemName, row.yarnItemCode)} iadesi geri alınsın mı?</DialogTitle>
          <DialogDescription>İade satırı silinmez; karşı satır yazılır ve iplik yeniden deverecide sayılır.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 rounded-md border p-3 text-sm" aria-label="Etkilenen kayıtlar">
          <li><b>{row.dispatchNo}</b> · {row.lotNo ? `lot ${row.lotNo}` : "lotsuz"} — iade {fmtKg(row.qtyKg)} kg → Geri alındı</li>
          <li className="text-muted-foreground">{fmtKg(row.qtyKg)} kg depodan düşer ({row.warehouseName ?? "iade deposu"}), deverecide tutulan iplik {fmtKg(Number(row.qtyKg) + Number(row.wasteKg ?? 0))} kg artar.</li>
          {Number(row.wasteKg ?? 0) > 0 && <li className="text-muted-foreground">Bu iadeyle yazılan {fmtKg(row.wasteKg!)} kg fire de geri alınır.</li>}
        </ul>
        <FormField label="Geri alma sebebi" htmlFor="wr-cancel-reason" required hint="En az 3 karakter.">
          <Input id="wr-cancel-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Geri alınıyor…" : "İadeyi geri al"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnRow({ r, onCancel }: { r: WarpingYarnReturnRow; onCancel: () => void }) {
  const cancelled = r.status === "CANCELLED";
  return (
    <TableRow className={cn("text-sm", cancelled && "text-muted-foreground line-through decoration-muted-foreground/40")}>
      <TableCell className="whitespace-nowrap">{fmtFactoryDateTime(r.createdAt)}</TableCell>
      <TableCell><YarnLabel name={r.yarnItemName} code={r.yarnItemCode} /></TableCell>
      <TableCell>{r.dispatchNo}{r.ownDispatch ? "" : " (aktarımla gelen)"} · {r.lotNo ?? "lotsuz"}</TableCell>
      <TableCell>{r.warehouseName ?? "—"}</TableCell>
      <TableCell>{r.reasonLabel ?? r.reasonCode ?? "—"}</TableCell>
      <TableCell className={num}>
        {fmtKg(r.qtyKg)}
        {Number(r.wasteKg ?? 0) > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">fire {fmtKg(r.wasteKg!)} kg</span>}
        {pieceText(r.packageCount, r.bobbinCount) && <span className="block text-xs text-muted-foreground">{pieceText(r.packageCount, r.bobbinCount)}</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right">
        {cancelled ? <Badge variant="outline" className="font-normal no-underline">Geri alındı</Badge> : (
          <PermissionGate permission="warping-order:write">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={!r.canCancel} title={r.canCancel ? "İadeyi geri al" : (r.cancelBlockedReason ?? undefined)} onClick={onCancel} aria-label={`${r.yarnItemCode} iadesini geri al`}>
              <Undo2 className="mr-1 h-4 w-4" /> Geri al
            </Button>
          </PermissionGate>
        )}
      </TableCell>
    </TableRow>
  );
}

export function YarnReturnsList({ orderId }: { orderId: string }) {
  const q = useWarpingReturns(orderId);
  const [target, setTarget] = useState<WarpingYarnReturnRow | null>(null);
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1 pt-2" aria-label="İadeler">
      <h3 className="text-sm font-semibold">İadeler</h3>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tarih</TableHead>
              <TableHead>İplik</TableHead>
              <TableHead>Sevk · lot</TableHead>
              <TableHead>Depo</TableHead>
              <TableHead>Sebep</TableHead>
              <TableHead className={num}>Kg</TableHead>
              <TableHead><span className="sr-only">İşlem</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows.map((r) => <ReturnRow key={r.movementId} r={r} onCancel={() => setTarget(r)} />)}</TableBody>
        </Table>
      </div>
      {target && <ReturnCancelDialog orderId={orderId} row={target} onClose={() => setTarget(null)} />}
    </div>
  );
}
