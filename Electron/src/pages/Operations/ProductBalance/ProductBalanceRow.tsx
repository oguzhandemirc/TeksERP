import {
  ChevronRight,
  ChevronDown,
  Factory,
  PackageCheck,
  AlertTriangle,
} from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import type { BalanceSpec } from "./types";

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

interface Props {
  spec: BalanceSpec;
  isOpen: boolean;
  covered: boolean;
  onToggle: () => void;
  onOpenWo: () => void;
}

/** Ürün Dengesi tablosunda tek spec satırı + (açıksa) drill-down detayı. */
export function ProductBalanceRow({
  spec: s,
  isOpen,
  covered,
  onToggle,
  onOpenWo,
}: Props) {
  return (
    <>
      <tr className="border-t [&>td]:px-3 [&>td]:py-2">
        <td className="text-left">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1.5 text-left hover:text-primary"
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            {s.colorHex && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{ backgroundColor: s.colorHex }}
              />
            )}
            <span className="font-medium">{s.itemName}</span>
            {s.colorName && (
              <span className="text-muted-foreground">· {s.colorName}</span>
            )}
            {s.width != null && (
              <span className="text-muted-foreground">· {s.width}cm</span>
            )}
          </button>
        </td>
        <td className="text-right text-foreground">{fmt(s.talep)}</td>
        <td className="text-right text-muted-foreground">{fmt(s.depo)}</td>
        <td className="text-right text-muted-foreground">{fmt(s.uretimde)}</td>
        <td className="text-right text-muted-foreground">{fmt(s.ham)}</td>
        <td className="text-right">
          {covered ? (
            <span className="inline-flex items-center justify-end gap-1 font-medium text-emerald-600 dark:text-emerald-400">
              <PackageCheck className="h-3.5 w-3.5" /> Karşılanıyor
            </span>
          ) : (
            <div className="flex flex-col items-end leading-tight">
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {fmt(s.uretilecek)} m
              </span>
              {s.malzemeAcigi > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-amber-600/80 dark:text-amber-400/80">
                  <AlertTriangle className="h-3 w-3" /> ham açığı{" "}
                  {fmt(s.malzemeAcigi)}
                </span>
              )}
            </div>
          )}
        </td>
        <td className="text-right">
          {!covered && (
            <PermissionGate permission="workorder:write">
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onOpenWo}>
                <Factory className="h-3.5 w-3.5" /> İş Emri Aç
              </Button>
            </PermissionGate>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="border-t bg-muted/20">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Talep eden siparişler ({s.lines.length})
                </div>
                {s.lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Açık sipariş yok.</p>
                ) : (
                  <ul className="space-y-1">
                    {s.lines.map((l) => (
                      <li
                        key={l.lineId}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono">{l.orderNumber}</span>
                          <span className="text-muted-foreground">
                            {l.customerName}
                          </span>
                          <DeadlineBadge deadline={l.deadline} />
                        </span>
                        <span className="tabular-nums font-medium">
                          {fmt(l.remaining)} m
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Üretimdeki iş emirleri ({s.wos.length})
                </div>
                {s.wos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Bu ürün için canlı iş emri yok.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {s.wos.map((w) => (
                      <li
                        key={w.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono">{w.batchNumber}</span>
                          <Badge variant="muted" className="text-[10px]">
                            {w.status}
                          </Badge>
                        </span>
                        <span className="tabular-nums font-medium">
                          {fmt(w.inFlight)} m
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
