// Sipariş sayfası "Deverecide tutulan iplik" bölümü (D6b-2) — `GET /:id/yarn-holdings`: kalem başına (kendi sevki ya da
// aktarımla gelen) bugün deverecide duran kg. Satırdan İade; başlıktan "Başka siparişe aktar". Yazma yüzeyi yalnız
// sipariş ipliği tutarken (Sevkte/Tamamlandı) + `warping-order:write`. Altında iadeler ve aktarma geçmişi.
import { useState } from "react";
import { ArrowRightLeft, Undo2 } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDate } from "@/lib/factory-time";
import { apiErrorMessage } from "@/services/apiClient";
import { holdsYarn, transferText, yarnNamesOf, type YarnNames } from "./holding-model";
import { useWarpingHoldings } from "./holding-service";
import { fmtKg } from "./order-model";
import { TransferDialog } from "./TransferDialog";
import { TransfersList } from "./TransfersList";
import { useWarpingDispatches } from "./yarn-service";
import { YarnReturnDialog } from "./YarnReturnDialog";
import { YarnReturnsList } from "./YarnReturnsList";
import { YarnLabel, yarnText } from "./YarnLabel";
import type { WarpingOrder } from "./types";
import type { WarpingYarnHolding } from "./holding-types";

const num = "text-right tabular-nums";

function HoldingRow({ h, names, canWrite, onReturn }: { h: WarpingYarnHolding; names: YarnNames; canWrite: boolean; onReturn: () => void }) {
  const y = names.get(h.yarnItemId);
  const code = yarnText(y?.name, y?.code);
  const empty = Number(h.holdingKg) === 0;
  return (
    <TableRow className={empty ? "text-muted-foreground" : undefined}>
      <TableCell><YarnLabel name={y?.name} code={y?.code} /></TableCell>
      <TableCell>{h.dispatchNo} <span className="text-xs text-muted-foreground">{h.own ? fmtFactoryDate(h.dispatchedAt) : "aktarımla gelen"}</span></TableCell>
      <TableCell>{h.lotNo ?? "lotsuz"}</TableCell>
      <TableCell className={num}>{h.own ? fmtKg(h.outKg) : "—"}</TableCell>
      <TableCell className={num}>{Number(h.returnedKg) === 0 ? "—" : fmtKg(h.returnedKg)}</TableCell>
      <TableCell className={num}>{transferText(h.transferOutKg, h.transferInKg)}</TableCell>
      <TableCell className={`${num} font-medium`}>{fmtKg(h.holdingKg)}</TableCell>
      <TableCell className="text-right">
        {canWrite && !empty && (
          <PermissionGate permission="warping-order:write">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onReturn} aria-label={`${code} ${h.dispatchNo} iade al`}><Undo2 className="mr-1 h-4 w-4" /> İade</Button>
          </PermissionGate>
        )}
      </TableCell>
    </TableRow>
  );
}

function HoldingsTable({ rows, names, canWrite, onReturn }: { rows: WarpingYarnHolding[]; names: YarnNames; canWrite: boolean; onReturn: (h: WarpingYarnHolding) => void }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>İplik</TableHead>
            <TableHead>Sevk</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead className={num} title="Bu sevkle giden iplik (brüt)">Giden kg</TableHead>
            <TableHead className={num} title="Depoya iade alınan">İade kg</TableHead>
            <TableHead className={num} title="Başka siparişten gelen (+) / başka siparişe giden (−)">Aktarma kg</TableHead>
            <TableHead className={num} title="Bu siparişin bugün deverecide duran ipliği">Deverecide kg</TableHead>
            <TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{rows.map((h) => <HoldingRow key={h.dispatchItemId} h={h} names={names} canWrite={canWrite} onReturn={() => onReturn(h)} />)}</TableBody>
      </Table>
    </div>
  );
}

type Open = { kind: "return"; h: WarpingYarnHolding } | { kind: "transfer" } | null;

export function HoldingsSection({ order }: { order: WarpingOrder }) {
  const q = useWarpingHoldings(order.id);
  const dispatches = useWarpingDispatches(order.id);
  const [open, setOpen] = useState<Open>(null);
  const names = yarnNamesOf(order);
  const rows = q.data ?? [];
  const total = rows.reduce((s, h) => s + Number(h.holdingKg), 0);
  const canWrite = holdsYarn(order.status);
  const exitWarehouse = (itemId: string) => dispatches.data?.flatMap((d) => d.items).find((i) => i.dispatchItemId === itemId)?.warehouseName ?? null;
  return (
    <section className="space-y-2" aria-label="Deverecide tutulan iplik">
      <div className={rows.length > 0 || q.isError ? "flex items-center justify-between gap-2" : "hidden"}>
        <h2 className="text-base font-semibold">
          Deverecide tutulan iplik
          {rows.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">toplam {fmtKg(total)} kg</span>}
        </h2>
        {canWrite && total > 0 && (
          <PermissionGate permission="warping-order:write">
            <Button size="sm" variant="outline" onClick={() => setOpen({ kind: "transfer" })}><ArrowRightLeft className="mr-1 h-4 w-4" /> Başka siparişe aktar</Button>
          </PermissionGate>
        )}
      </div>
      {q.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
      {rows.length > 0 && <HoldingsTable rows={rows} names={names} canWrite={canWrite} onReturn={(h) => setOpen({ kind: "return", h })} />}
      <YarnReturnsList orderId={order.id} />
      <TransfersList orderId={order.id} />
      {open?.kind === "return" && <YarnReturnDialog orderId={order.id} holding={open.h} names={names} exitWarehouseName={exitWarehouse(open.h.dispatchItemId)} onClose={() => setOpen(null)} />}
      {open?.kind === "transfer" && <TransferDialog order={order} holdings={rows} names={names} onClose={() => setOpen(null)} />}
    </section>
  );
}
