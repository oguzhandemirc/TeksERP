// =============================================================================
// FASON DOKUMA — sevk ve makbuz listeleri (FasonSheet'in alt bileşenleri)
// =============================================================================
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { formatM } from "@/pages/Operations/WarpBeams/types";
import { dispatchMeters } from "./fason-summary";
import type { FasonDispatch, FasonReceipt } from "./types";

const day = (iso: string) => new Date(iso).toLocaleDateString("tr-TR");

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <PermissionGate permission="weavingorder:write">
      <Button size="sm" variant="ghost" onClick={onClick}>
        İptal
      </Button>
    </PermissionGate>
  );
}

export function DispatchList({ rows, onCancel, onReturn }: { rows: FasonDispatch[]; onCancel: (d: FasonDispatch) => void; onReturn: (d: FasonDispatch) => void }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Sevkler ({rows.length})</h3>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Sevk yok — fasoncu kendi ipliğini kullanıyorsa bu normaldir.</p>}
      {rows.map((d) => {
        const mt = dispatchMeters(d);
        return (
          <div key={d.id} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
            <span className="font-mono">{d.dispatchNo}</span>
            <span className="text-muted-foreground">{day(d.dispatchedAt)}</span>
            <span>{d.items.map((it) => it.warpBeam?.beamNo ?? "?").join(", ")}</span>
            <span className="ml-auto tabular-nums">
              {formatM(mt.sentM)} gitti · {formatM(mt.returnedM)} döndü
            </span>
            {d.cancelledAt ? (
              <Badge variant="outline">İptal</Badge>
            ) : (
              <PermissionGate permission="weavingorder:write">
                <Button size="sm" variant="ghost" onClick={() => onReturn(d)}>
                  Levent döndü
                </Button>
                <CancelButton onClick={() => onCancel(d)} />
              </PermissionGate>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function ReceiptList({ rows, onCancel }: { rows: FasonReceipt[]; onCancel: (r: FasonReceipt) => void }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Makbuzlar ({rows.length})</h3>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Kabul yok.</p>}
      {rows.map((r) => {
        const liveM = r.bornRolls.filter((x) => x.status !== "CANCELLED").reduce((a, x) => a + x.initialQty, 0);
        return (
          <div key={r.id} className="rounded border px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono">{r.receiptNo}</span>
              <span className="text-muted-foreground">
                {day(r.receivedAt)}
                {r.manifestNo ? ` · irsaliye ${r.manifestNo}` : ""}
              </span>
              <span className="ml-auto tabular-nums">
                {r.bornRolls.length} top · {formatM(liveM)}
              </span>
              {r.cancelledAt ? <Badge variant="outline">İptal</Badge> : <CancelButton onClick={() => onCancel(r)} />}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {r.bornRolls.map((x) => (
                <Badge key={x.id} variant={x.status === "CANCELLED" ? "outline" : "secondary"} className="font-mono">
                  {x.barcode ?? x.id.slice(0, 8)} · {x.initialQty} m
                </Badge>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
