// Sipariş sayfası "Kapanış" bölümü — `GET /:id/settlements` (kapanış ve yeniden açma geçmişi, eskiden yeniye) +
// "Siparişi kapat" (IN_PROGRESS) / "Yeniden aç" (COMPLETED); ikisi de `warping-order:settle`. Fire satırları kalem kalem.
import { Fragment, useMemo, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/services/apiClient";
import { fmtKg } from "./order-model";
import { YarnLabel, yarnLabelParts } from "./YarnLabel";
import { labelOf, ReopenDialog, type ItemLabels } from "./ReopenDialog";
import { SettleDialog } from "./SettleDialog";
import { pctText } from "./settle-model";
import { useWarpingSettlements } from "./settle-service";
import { useWarpingDispatches } from "./yarn-service";
import type { WarpingOrder } from "./types";
import type { WarpingSettlementRecord } from "./settle-types";

const num = "text-right tabular-nums";

function RecordRows({ r, labels }: { r: WarpingSettlementRecord; labels: ItemLabels }) {
  const overCodes = [...new Set(r.wastes.filter((w) => w.kind === "WASTE" && w.overTolerance).map((w) => yarnLabelParts(w.name, w.code).primary))];
  const settle = r.kind === "SETTLE";
  return (
    <Fragment>
      <TableRow className={cn("bg-muted/30", r.reopened && "text-muted-foreground")}>
        <TableCell>
          <span className="font-medium">{settle ? "Kapanış" : "Yeniden açma"}</span> <span className="text-xs text-muted-foreground">{fmtFactoryDateTime(r.createdAt)}</span>
          {r.reopened && <Badge variant="outline" className="ml-2 font-normal">Yeniden açıldı · {fmtFactoryDateTime(r.reopened.createdAt)}</Badge>}
          {r.overTolerance && <Badge className="ml-2 bg-amber-100 font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300">{overCodes.length > 0 ? `Toleransı aşan iplik: ${overCodes.join(", ")}` : "Tolerans aşıldı"}</Badge>}
          {r.reason && <span className="block text-xs">Gerekçe: {r.reason}</span>}
        </TableCell>
        <TableCell className={num}>{settle ? fmtKg(r.totalReturnKg) : "—"}</TableCell>
        <TableCell className={num}>{settle ? fmtKg(r.totalWasteKg) : "—"}</TableCell>
        <TableCell className={num}>{settle ? pctText(r.wastePct) : "—"}{settle && r.tolerancePct !== null && <span className="block text-xs text-muted-foreground">tolerans {pctText(r.tolerancePct)}</span>}</TableCell>
      </TableRow>
      {r.wastes.filter((w) => w.kind === "WASTE").map((w) => (
        <TableRow key={w.id} className="text-xs">
          <TableCell className="pl-8">Fire · <YarnLabel name={w.name} code={w.code} /> · {w.dispatchNo} · {w.lotNo ? `lot ${w.lotNo}` : "lotsuz"}</TableCell>
          <TableCell />
          <TableCell className={num}>{fmtKg(w.qtyKg)}</TableCell>
          <TableCell />
        </TableRow>
      ))}
      {r.returns.map((m) => (
        <TableRow key={m.movementId} className="text-xs">
          <TableCell className="pl-8">İade · {labelOf(labels, m.dispatchItemId)}</TableCell>
          <TableCell className={num}>{fmtKg(m.qtyKg)}</TableCell>
          <TableCell colSpan={2} />
        </TableRow>
      ))}
    </Fragment>
  );
}

function useItemLabels(orderId: string): ItemLabels {
  const dq = useWarpingDispatches(orderId);
  return useMemo(() => new Map((dq.data ?? []).flatMap((d) => d.items.map((it) => [it.dispatchItemId, `${yarnLabelParts(it.yarnItemName, it.yarnItemCode).primary} · ${d.dispatchNo} · ${it.lotNo ? `lot ${it.lotNo}` : "lotsuz"}`] as const))), [dq.data]);
}

export function SettlementsSection({ order }: { order: WarpingOrder }) {
  const q = useWarpingSettlements(order.id);
  const labels = useItemLabels(order.id);
  const [open, setOpen] = useState<"settle" | "reopen" | null>(null);
  const rows = q.data ?? [];
  return (
    <section className="space-y-2" aria-label="Kapanış">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Kapanış</h2>
        <PermissionGate permission="warping-order:settle">
          {order.status === "IN_PROGRESS" && <Button size="sm" onClick={() => setOpen("settle")}><Lock className="mr-1 h-4 w-4" /> Siparişi kapat</Button>}
          {order.status === "COMPLETED" && <Button size="sm" variant="outline" onClick={() => setOpen("reopen")}><LockOpen className="mr-1 h-4 w-4" /> Yeniden aç</Button>}
        </PermissionGate>
      </div>
      {q.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Henüz kapanış yok.{order.status === "IN_PROGRESS" ? " Leventler dönünce “Siparişi kapat” ile kalan ipliği iade / fire / deverecide kalır olarak ayırın." : ""}
        </p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Kapanış geçmişi">
            <TableHeader>
              <TableRow>
                <TableHead>Kayıt</TableHead>
                <TableHead className={num}>İade kg</TableHead>
                <TableHead className={num}>Fire kg</TableHead>
                <TableHead className={num} title="Fire / (sarılan + fire)">Fire %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{rows.map((r) => <RecordRows key={r.id} r={r} labels={labels} />)}</TableBody>
          </Table>
        </div>
      )}
      {open === "settle" && <SettleDialog order={order} onClose={() => setOpen(null)} />}
      {open === "reopen" && <ReopenDialog order={order} labels={labels} onClose={() => setOpen(null)} />}
    </section>
  );
}
