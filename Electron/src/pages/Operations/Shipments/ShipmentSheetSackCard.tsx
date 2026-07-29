import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import type { ShipmentDetailSack, ShipmentDetailRoll } from "./types";

const num = (v: number | null | undefined) => formatNumber(v, 1);

/**
 * Sheet'te tek çuval — varsayılan KAPALI, başlığa tıklayınca içindeki toplar tablosu
 * (Barkod/En/Kalite/Metraj) açılır (ui/collapsible YOK — useState toggle + dönen
 * ChevronDown). Panel araması aktifken (`forceOpen`) eşleşmeler görünsün diye açık gelir.
 */
export function ShipmentSheetSackCard({
  sack,
  rolls,
  forceOpen,
  matchedIds,
}: {
  sack: ShipmentDetailSack;
  rolls: ShipmentDetailRoll[];
  forceOpen: boolean;
  /** Liste kumaş/renk filtresine uyan top id'leri — satır amber vurgulanır. */
  matchedIds?: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;

  return (
    <div className="rounded border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold">
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen ? "rotate-0" : "-rotate-90")}
          />
          Çuval #{sack.seq}
          <span className="font-mono font-normal text-muted-foreground">· {sack.sackNo}</span>
        </span>
        <span className="shrink-0 tabular-nums text-[11px] font-normal text-muted-foreground">
          {sack.weightKg != null ? `${num(sack.weightKg)} kg` : "tartılmadı"} · {rolls.length} top
          {sack.swatchCount > 0 ? ` · ${sack.swatchCount} kartela` : ""}
        </span>
      </button>

      {isOpen && (
        <div className="border-t px-2 py-1.5">
          {rolls.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Eşleşen top yok.</div>
          ) : (
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr className="text-muted-foreground [&>th]:px-1 [&>th]:py-0.5 [&>th]:font-medium">
                  <th className="text-left">Barkod</th>
                  <th className="text-left">Kumaş</th>
                  <th className="text-right">En</th>
                  <th className="text-left">Kalite</th>
                  <th className="text-right">Metraj</th>
                </tr>
              </thead>
              <tbody>
                {rolls.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-t [&>td]:px-1 [&>td]:py-0.5",
                      matchedIds?.has(r.id) && "bg-amber-500/10",
                    )}
                  >
                    <td className="text-left font-mono">{r.barcode ?? "—"}</td>
                    <td className="text-left">
                      {r.item?.name ?? "—"}
                      {r.color ? (
                        <span className="text-muted-foreground"> · {r.color.name}</span>
                      ) : null}
                    </td>
                    <td className="text-right text-muted-foreground">
                      {r.width != null ? `${num(r.width)} cm` : "—"}
                    </td>
                    <td className="text-left text-muted-foreground">{r.qualityGrade ?? "—"}</td>
                    <td className="text-right font-medium">{num(r.currentQty)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sack.swatches.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t pt-1 text-[11px] text-muted-foreground">
              {sack.swatches.map((sw) => (
                <div key={sw.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    Kartela · {sw.item?.name ?? "—"}
                    {sw.color ? ` · ${sw.color.name}` : ""}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {sw.length != null ? `${num(sw.length)} cm` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
