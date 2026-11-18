// Sipariş sayfası "Dönen leventler" bölümü — `GET /:id/receipts`: mutabakat (hedef ↔ gelen metre, iplik başına
// sarılan/devir/dağıtılamayan/deverecide kalan, tartı) + kabuller (eskiden yeniye; levent satırları). Kabul geri
// alma önizlemelidir; LIFO ve kapanış engelini sunucu söyler. "Levent kabulü" OPEN/IN_PROGRESS + `warping-order:write`.
import { Fragment, useState } from "react";
import { PackageCheck, Undo2 } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/services/apiClient";
import { yarnNamesOf } from "./holding-model";
import { fmtKg, fmtM } from "./order-model";
import { ReceiptCancelDialog } from "./ReceiptCancelDialog";
import { ReceiveDialog } from "./ReceiveDialog";
import { signedKg } from "./receive-model";
import { useWarpingReceipts } from "./receive-service";
import { SettlementSummary } from "./SettlementSummary";
import type { WarpingOrder } from "./types";
import type { WarpingReceipt, WarpingReceiptBeam } from "./receive-types";

const num = "text-right tabular-nums";
const kgOr = (v: string | null) => (v === null ? "—" : fmtKg(v));

function BeamRow({ b }: { b: WarpingReceiptBeam }) {
  return (
    <TableRow className={cn("text-xs", b.cancelled && "text-muted-foreground line-through decoration-muted-foreground/40")}>
      <TableCell className="pl-8">{b.beamNo}{b.physicalBeamNo && <span className="text-muted-foreground"> · gövde {b.physicalBeamNo}</span>}</TableCell>
      <TableCell className={num}>{b.lengthM === null ? "—" : fmtM(b.lengthM)}</TableCell>
      <TableCell className={num}>{kgOr(b.nominalKg)}</TableCell>
      <TableCell className={num}>{b.grossKg === null ? "—" : `${fmtKg(b.grossKg)}${b.tareKg !== null ? ` / ${fmtKg(b.tareKg)}` : ""}`}</TableCell>
      <TableCell className={num}>{kgOr(b.weighedNetKg)}</TableCell>
      <TableCell className={num}>{b.weighDiffKg === null ? "—" : signedKg(b.weighDiffKg)}</TableCell>
      <TableCell />
    </TableRow>
  );
}

function ReceiptHead({ r, canUndo, onUndo }: { r: WarpingReceipt; canUndo: boolean; onUndo: () => void }) {
  const dead = r.liveBeamCount === 0;
  return (
    <TableRow className={cn("bg-muted/30", dead && "text-muted-foreground")}>
      <TableCell>
        <span className="font-medium">{r.deliveryNoteNo ? `İrsaliye ${r.deliveryNoteNo}` : "İrsaliyesiz kabul"}</span>{" "}
        <span className="text-xs text-muted-foreground">· {r.liveBeamCount} levent{r.beamCount !== r.liveBeamCount ? ` (${r.beamCount - r.liveBeamCount} iptal)` : ""} ·</span>{" "}
        <span className="text-xs text-muted-foreground">{fmtFactoryDateTime(r.receivedAt)}</span>
        {dead && <Badge variant="outline" className="ml-2 font-normal">Geri alındı</Badge>}
      </TableCell>
      <TableCell className={cn(num, "font-medium")}>{fmtM(r.lengthM)}</TableCell>
      <TableCell colSpan={4} />
      <TableCell className="whitespace-nowrap text-right">
        {canUndo && !dead && (
          <PermissionGate permission="warpbeam:cancel">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={onUndo} aria-label="Kabulü geri al" title="Kabulü geri al (yalnız en yeni kabul geri alınabilir)">
              <Undo2 className="h-4 w-4" />
            </Button>
          </PermissionGate>
        )}
      </TableCell>
    </TableRow>
  );
}

function ReceiptTable({ rows, canUndo, onUndo }: { rows: WarpingReceipt[]; canUndo: boolean; onUndo: (r: WarpingReceipt) => void }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table aria-label="Levent kabulleri">
        <TableHeader>
          <TableRow>
            <TableHead>Kabul · levent</TableHead>
            <TableHead className={num}>Metre</TableHead>
            <TableHead className={num} title="Tel × denye × metre">Hesap kg</TableHead>
            <TableHead className={num} title="Girildiyse brüt / dara">Tartı brüt / dara</TableHead>
            <TableHead className={num}>Tartı net</TableHead>
            <TableHead className={num} title="Tartı net − hesap (yalnız bilgi)">Tartı farkı</TableHead>
            <TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <Fragment key={r.receiptKey}>
              <ReceiptHead r={r} canUndo={canUndo} onUndo={() => onUndo(r)} />
              {r.beams.map((b) => <BeamRow key={b.id} b={b} />)}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type Open = { kind: "receive" } | { kind: "undo"; r: WarpingReceipt } | null;

export function ReceiptsSection({ order }: { order: WarpingOrder }) {
  const q = useWarpingReceipts(order.id);
  const [open, setOpen] = useState<Open>(null);
  const receivable = order.status === "OPEN" || order.status === "IN_PROGRESS";
  const rows = q.data?.receipts ?? [];
  return (
    <section className="space-y-2" aria-label="Dönen leventler">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Dönen leventler ve mutabakat</h2>
        {receivable && (
          <PermissionGate permission="warping-order:write">
            <Button size="sm" onClick={() => setOpen({ kind: "receive" })}><PackageCheck className="mr-1 h-4 w-4" /> Levent kabulü</Button>
          </PermissionGate>
        )}
      </div>
      {q.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
      {q.data && <SettlementSummary s={q.data.settlement} />}
      {q.isSuccess && rows.length === 0 && <p className="text-sm text-muted-foreground">Henüz levent dönmedi.{receivable ? " Devereci leventleri getirince “Levent kabulü” ile girin." : ""}</p>}
      {rows.length > 0 && <ReceiptTable rows={rows} canUndo={order.status !== "CANCELLED"} onUndo={(r) => setOpen({ kind: "undo", r })} />}
      {open?.kind === "receive" && <ReceiveDialog order={order} onClose={() => setOpen(null)} />}
      {open?.kind === "undo" && <ReceiptCancelDialog orderId={order.id} receipt={open.r} names={yarnNamesOf(order)} onClose={() => setOpen(null)} />}
    </section>
  );
}
