// Emanet çıkış belgesi detayı: başlık, kalemler (levent metresi / lot × depo kg), iptal durumu ve iptal eylemi.
import { useQuery } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { formatFactory } from "@/lib/factory-time";
import { CONSIGNMENT_DISPATCHES_QUERY_KEY, getConsignmentDispatch } from "./service";
import { fmtNum, fmtQty, KIND_LABEL } from "./consignmentText";
import type { ConsignmentDispatchDto, ConsignmentDispatchItemDto } from "./types";

interface Props {
  dispatchId: string | null;
  onClose: () => void;
  onCancel: (id: string) => void;
}

function itemLabel(it: ConsignmentDispatchItemDto): { name: string; sub: string; qty: string } {
  if (it.kind === "WARP_BEAM") {
    return {
      name: `Levent ${it.warpBeam?.beamNo ?? "—"}`,
      sub: it.warpBeam?.warpSpecName ?? "",
      qty: fmtQty(it.lengthM, "METER"),
    };
  }
  return {
    name: `Lot ${it.lot?.lotNo ?? "—"}`,
    sub: `${it.yarnItem?.name ?? ""} · ${it.warehouse?.name ?? ""}`,
    qty: fmtQty(it.qtyKg, "KG"),
  };
}

export function ConsignmentDispatchDetailSheet({ dispatchId, onClose, onCancel }: Props) {
  const q = useQuery({
    queryKey: [CONSIGNMENT_DISPATCHES_QUERY_KEY, "detail", dispatchId],
    queryFn: () => getConsignmentDispatch(dispatchId!),
    enabled: Boolean(dispatchId),
  });
  const d = q.data;
  return (
    <Sheet open={Boolean(dispatchId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[640px] sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{d?.dispatchNo ?? "…"}</span>
            {d?.cancelledAt && <Badge variant="outline">İptal</Badge>}
          </SheetTitle>
        </SheetHeader>
        {q.isError ? (
          <div className="mt-4 text-sm">
            <p className="text-destructive">Belge yüklenemedi.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : !d ? (
          <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            <DispatchFacts d={d} />
            <DispatchItems items={d.items} />
            <p className="text-muted-foreground">
              {d.totals.beamCount} levent · {fmtNum(d.totals.beamLengthM)} m · {fmtNum(d.totals.yarnKg)} kg
              iplik
            </p>
            {!d.cancelledAt && (
              <PermissionGate permission="consignment:write">
                <Button variant="destructive" onClick={() => onCancel(d.id)}>
                  <Ban className="mr-1 h-4 w-4" />
                  İptal Et…
                </Button>
              </PermissionGate>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DispatchFacts({ d }: { d: ConsignmentDispatchDto }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">Müşteri</dt>
      <dd className="font-medium">{d.ownerCustomer.name}</dd>
      <dt className="text-muted-foreground">Çıkış</dt>
      <dd>
        {formatFactory(d.dispatchedAt, "dd MMM yyyy HH:mm")}
        {d.dispatchedBy ? ` · ${d.dispatchedBy.name}` : ""}
      </dd>
      {d.plateNumber && (
        <>
          <dt className="text-muted-foreground">Plaka</dt>
          <dd>{d.plateNumber}</dd>
        </>
      )}
      {d.driverName && (
        <>
          <dt className="text-muted-foreground">Şoför</dt>
          <dd>{d.driverName}</dd>
        </>
      )}
      {d.notes && (
        <>
          <dt className="text-muted-foreground">Not</dt>
          <dd>{d.notes}</dd>
        </>
      )}
      {d.cancelledAt && (
        <>
          <dt className="text-muted-foreground">İptal</dt>
          <dd>
            {formatFactory(d.cancelledAt, "dd MMM yyyy HH:mm")} — {d.cancelReason}
          </dd>
        </>
      )}
    </dl>
  );
}

function DispatchItems({ items }: { items: ConsignmentDispatchItemDto[] }) {
  return (
    <div className="max-h-[45vh] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Tür</th>
            <th className="p-2 text-left">Kalem</th>
            <th className="p-2 text-right">Miktar</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const l = itemLabel(it);
            return (
              <tr key={it.id} className="border-t">
                <td className="p-2">{KIND_LABEL[it.kind]}</td>
                <td className="p-2">
                  <div>{l.name}</div>
                  <div className="text-xs text-muted-foreground">{l.sub}</div>
                </td>
                <td className="p-2 text-right tabular-nums">{l.qty}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
