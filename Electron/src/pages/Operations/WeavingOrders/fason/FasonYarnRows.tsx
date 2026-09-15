// =============================================================================
// FASON DOKUMA (G1p) — sevk satırındaki İPLİK kalemleri: giden · dönen · sarılan · kalan + eylemler
// =============================================================================
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { formatKg } from "@/pages/Operations/WarpBeams/types";
import { kgSourceLabel, openYarnReturns } from "./fason-summary";
import type { FasonDispatch, FasonYarnItem } from "./types";

interface Props {
  d: FasonDispatch;
  onReturn: (d: FasonDispatch) => void;
  onCancelReturn: (d: FasonDispatch, item: FasonYarnItem) => void;
}

export function FasonYarnRows({ d, onReturn, onCancelReturn }: Props) {
  const items = d.yarnItems ?? [];
  if (items.length === 0) return null;
  const openReturn = (it: FasonYarnItem) => openYarnReturns(it).length > 0;
  return (
    <div className="mt-1 space-y-1 rounded bg-muted/40 px-2 py-1 text-xs">
      {items.map((it) => (
        <div key={it.dispatchItemId} className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono">{it.item.code}</Badge>
          <span className="tabular-nums">
            {formatKg(it.dispatchedKg)} gitti · {formatKg(it.returnedKg)} döndü · {formatKg(it.sarilanKg)} sarıldı · <b>{formatKg(it.remainingKg)}</b> fasonda
          </span>
          {it.sarilan.map((s) => (
            <span key={s.beamNo} className="text-muted-foreground">
              {s.beamNo} {formatKg(s.kg)} ({kgSourceLabel(s.kaynak)})
            </span>
          ))}
          {!d.cancelledAt && (
            <PermissionGate permission="weavingorder:write">
              {it.remainingKg > 0 && (
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => onReturn(d)}>
                  İplik döndü
                </Button>
              )}
              {openReturn(it) && (
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => onCancelReturn(d, it)}>
                  Dönüşü geri al
                </Button>
              )}
            </PermissionGate>
          )}
        </div>
      ))}
    </div>
  );
}
