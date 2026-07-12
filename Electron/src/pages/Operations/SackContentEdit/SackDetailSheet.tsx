import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat } from "@/lib/format";
import { sackHubService } from "./service";
import { shipmentStatusLabels, type SackContentRoll, type SackSearchRow } from "./types";

const fmtQty = (n: number) =>
  `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/** İçerik → ürün·renk·en özet grupları (renkli çip için). */
function specGroups(rolls: SackContentRoll[]) {
  const m = new Map<
    string,
    { item: string; color: string | null; hex: string | null; width: number | null; qty: number; count: number }
  >();
  for (const r of rolls) {
    const key = `${r.item.name}|${r.color?.name ?? ""}|${r.width ?? ""}`;
    const g =
      m.get(key) ??
      { item: r.item.name, color: r.color?.name ?? null, hex: r.color?.hex ?? null, width: r.width, qty: 0, count: 0 };
    g.qty += Number(r.currentQty);
    g.count += 1;
    m.set(key, g);
  }
  return [...m.values()];
}

interface Props {
  /** Görüntülenecek (sevkteki) çuval; null → kapalı. Depo çuvalları editöre gider. */
  sack: SackSearchRow | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Sevk edilmiş/sevkteki çuvalın SALT-OKUNUR içerik önizlemesi (slide-over). Depo
 * çuvalları düzenlenebilir olduğundan onlar editöre açılır; buraya yalnız sevke
 * atanmış çuvallar düşer. İçerik lazy çekilir (`contents`).
 */
export function SackDetailSheet({ sack, onOpenChange }: Props) {
  const open = sack !== null;

  const contents = useQuery({
    queryKey: ["sack-contents", sack?.id],
    queryFn: () => sackHubService.contents(sack!.id),
    enabled: open,
    staleTime: 30_000,
  });
  const rolls = contents.data?.data.rolls ?? [];
  const swatches = contents.data?.data.swatches ?? [];
  const groups = useMemo(() => specGroups(rolls), [rolls]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{sack?.sackNo ?? "Çuval"}</span>
            {sack?.shipment && (
              <span className="text-xs font-normal text-muted-foreground">
                {sack.shipment.shipmentNo} · {shipmentStatusLabels[sack.shipment.status]}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {sack
              ? `${sack.customer?.name ?? "—"}${sack.branch ? ` · ${sack.branch.name}` : ""} · ${safeFormat(sack.createdAt, "dd.MM.yyyy")}`
              : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {contents.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : rolls.length === 0 && swatches.length === 0 ? (
            <p className="flex items-center gap-1.5 py-6 text-sm text-muted-foreground">
              <Package className="h-4 w-4" /> Boş çuval.
            </p>
          ) : (
            <>
              {/* Renkli içerik özeti çipleri (ürün · renk · en). */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {groups.map((g, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]"
                  >
                    {g.hex && (
                      <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: g.hex }} />
                    )}
                    <span className="font-medium">{g.item}</span>
                    {g.color && <span className="text-muted-foreground">{g.color}</span>}
                    {g.width != null && <span className="text-muted-foreground">{g.width}cm</span>}
                    <span className="tabular-nums font-medium">{fmtQty(g.qty)}</span>
                  </span>
                ))}
                {swatches.length > 0 && (
                  <span className="inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {swatches.length} kartela
                  </span>
                )}
              </div>

              {/* Barkodlu döküm. */}
              <table className="w-full text-xs">
                <tbody>
                  {rolls.map((r) => (
                    <tr key={r.id} className="border-b border-dashed last:border-0">
                      <td className="py-1 font-mono">{r.barcode ?? "Açık Kumaş"}</td>
                      <td className="py-1">{r.item.name}</td>
                      <td className="py-1">
                        <span className="inline-flex items-center gap-1.5">
                          {r.color?.hex && (
                            <span
                              className="h-2.5 w-2.5 rounded-full border"
                              style={{ backgroundColor: r.color.hex }}
                            />
                          )}
                          {r.color?.name ?? "Ham"}
                        </span>
                      </td>
                      <td className="py-1 text-right">{r.width ? `${r.width} cm` : "—"}</td>
                      <td className="py-1 text-right tabular-nums">{fmtQty(Number(r.currentQty))}</td>
                      <td className="py-1 text-right text-muted-foreground">{r.qualityGrade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
