// Sipariş sayfası "Sevkler" bölümü — `GET /:id/dispatches` (iptal edilenler DAHİL, eskiden yeniye). Sevk başına
// kalem satırları (iplik · lot · depo · giden BRÜT · iade · aktarma · levente sarılan · deverecide). Yazdır =
// irsaliye + çözgü talimatı; iptal önizlemeli (engel varsa önizleme sebebini gösterir). Yeni sevk OPEN/IN_PROGRESS'te.
import { Fragment, useState } from "react";
import { Ban, Printer, Truck } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/services/apiClient";
import { DispatchCancelDialog } from "./DispatchCancelDialog";
import { InstructionPrintDialog } from "./InstructionPrintDialog";
import { fmtKg } from "./order-model";
import { transferText } from "./holding-model";
import { YarnDispatchDialog } from "./YarnDispatchDialog";
import { useWarpingDispatches } from "./yarn-service";
import type { WarpingOrder } from "./types";
import type { WarpingDispatchItem, WarpingDispatchRow } from "./yarn-types";

const num = "text-right tabular-nums";
const kgOrDash = (v: string) => (Number(v) === 0 ? "—" : fmtKg(v));
/** Başlık özeti yalnız biçimdir: sunucunun sevk başı toplamlarının toplamı (iptaller hariç). */
const sumKg = (rows: WarpingDispatchRow[], k: "totalOutKg" | "totalHoldingKg") => rows.reduce((s, d) => s + Number(d[k]), 0);

function ItemRow({ it, muted }: { it: WarpingDispatchItem; muted: boolean }) {
  return (
    <TableRow className={cn("text-xs", muted && "text-muted-foreground line-through decoration-muted-foreground/40")}>
      <TableCell className="pl-8">{it.yarnItemCode} <span className="text-muted-foreground">{it.yarnItemName}</span></TableCell>
      <TableCell>{it.lotNo ?? "lotsuz"} · {it.warehouseName ?? "—"}</TableCell>
      <TableCell className={num}>{fmtKg(it.outKg)}</TableCell>
      <TableCell className={num}>{kgOrDash(it.returnedKg)}</TableCell>
      <TableCell className={num}>{transferText(it.transferOutKg, it.transferInKg)}</TableCell>
      <TableCell className={num}>{kgOrDash(it.allocatedKg)}</TableCell>
      <TableCell className={num}>{fmtKg(it.holdingKg)}</TableCell>
      <TableCell />
    </TableRow>
  );
}

function DispatchHead({ d, onPrint, onCancel }: { d: WarpingDispatchRow; onPrint: () => void; onCancel: () => void }) {
  const cancelled = d.status === "CANCELLED";
  return (
    <TableRow className={cn("bg-muted/30", cancelled && "text-muted-foreground")}>
      <TableCell colSpan={2}>
        <span className="font-medium">{d.dispatchNo}</span> <span className="text-xs text-muted-foreground">{fmtFactoryDateTime(d.dispatchedAt)}</span>
        {d.goodsReceiptId && <Badge variant="secondary" className="ml-2 font-normal">Tedarikçiden doğrudan</Badge>}
        {cancelled && (
          <span className="block text-xs">
            <Badge variant="outline" className="mr-1 font-normal">İptal</Badge>
            {fmtFactoryDateTime(d.cancelledAt)} — {d.cancelReason ?? "sebep yok"}
          </span>
        )}
      </TableCell>
      <TableCell className={cn(num, "font-medium")}>{fmtKg(d.totalOutKg)}</TableCell>
      <TableCell className={num}>{kgOrDash(d.totalReturnedKg)}</TableCell>
      <TableCell className={num}>{transferText(d.totalTransferOutKg, d.totalTransferInKg)}</TableCell>
      <TableCell className={num}>{kgOrDash(d.totalAllocatedKg)}</TableCell>
      <TableCell className={cn(num, "font-medium")}>{cancelled ? "—" : fmtKg(d.totalHoldingKg)}</TableCell>
      <TableCell className="whitespace-nowrap text-right">
        {!cancelled && (
          <>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onPrint} aria-label={`${d.dispatchNo} irsaliye ve talimatı yazdır`}><Printer className="h-4 w-4" /></Button>
            <PermissionGate permission="warping-order:cancel">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={onCancel} aria-label={`${d.dispatchNo} sevkini iptal et`} title={d.canCancel ? "Sevki iptal et" : (d.cancelBlockedReason ?? undefined)}>
                <Ban className="h-4 w-4" />
              </Button>
            </PermissionGate>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

function DispatchTable({ rows, onPrint, onCancel }: { rows: WarpingDispatchRow[]; onPrint: (d: WarpingDispatchRow) => void; onCancel: (d: WarpingDispatchRow) => void }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead colSpan={2}>Sevk · iplik</TableHead>
            <TableHead className={num} title="Giden iplik (brüt)">Giden kg</TableHead>
            <TableHead className={num} title="Depoya iade alınan">İade kg</TableHead>
            <TableHead className={num} title="Başka siparişten gelen (+) / başka siparişe giden (−)">Aktarma kg</TableHead>
            <TableHead className={num} title="Devereden dönen leventlere sarılan">Levente sarılan</TableHead>
            <TableHead className={num} title="Bu siparişin deverecide duran ipliği">Deverecide kg</TableHead>
            <TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <Fragment key={d.dispatchId}>
              <DispatchHead d={d} onPrint={() => onPrint(d)} onCancel={() => onCancel(d)} />
              {d.items.map((it) => <ItemRow key={it.dispatchItemId} it={it} muted={d.status === "CANCELLED"} />)}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type Open = { kind: "new" } | { kind: "print"; d: WarpingDispatchRow } | { kind: "cancel"; d: WarpingDispatchRow } | null;

export function DispatchesSection({ order }: { order: WarpingOrder }) {
  const q = useWarpingDispatches(order.id);
  const [open, setOpen] = useState<Open>(null);
  const rows = q.data ?? [];
  const live = rows.filter((d) => d.status === "ACTIVE");
  const canDispatch = order.status === "OPEN" || order.status === "IN_PROGRESS";
  const afterDispatch = (dispatchId: string) => {
    void q.refetch().then((r) => {
      const d = r.data?.find((x) => x.dispatchId === dispatchId);
      setOpen(d ? { kind: "print", d } : null);
    });
  };
  return (
    <section className="space-y-2" aria-label="Sevkler">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          Sevkler
          {live.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">giden {fmtKg(sumKg(live, "totalOutKg"))} kg · deverecide {fmtKg(sumKg(live, "totalHoldingKg"))} kg</span>}
        </h2>
        {canDispatch && (
          <PermissionGate permission="warping-order:write">
            <Button size="sm" onClick={() => setOpen({ kind: "new" })}><Truck className="mr-1 h-4 w-4" /> Yeni sevk</Button>
          </PermissionGate>
        )}
      </div>
      {q.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
      {q.isSuccess && rows.length === 0 && <p className="text-sm text-muted-foreground">Henüz iplik sevki yok.{canDispatch ? " “Yeni sevk” ile plandaki ipliği devereciye gönderin." : ""}</p>}
      {rows.length > 0 && <DispatchTable rows={rows} onPrint={(d) => setOpen({ kind: "print", d })} onCancel={(d) => setOpen({ kind: "cancel", d })} />}
      {open?.kind === "new" && <YarnDispatchDialog order={order} onClose={() => setOpen(null)} onDone={afterDispatch} />}
      {open?.kind === "print" && <InstructionPrintDialog orderId={order.id} dispatch={open.d} onClose={() => setOpen(null)} />}
      {open?.kind === "cancel" && <DispatchCancelDialog orderId={order.id} row={open.d} onClose={() => setOpen(null)} />}
    </section>
  );
}
