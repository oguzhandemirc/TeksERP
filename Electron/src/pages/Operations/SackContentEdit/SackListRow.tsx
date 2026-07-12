import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, PencilLine, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import { sackHubService } from "./service";
import { isWarehouseSack, shipmentStatusLabels, type SackContentRoll, type SackSearchRow } from "./types";

const fmtQty = (n: number) => `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/** LOUD durum rozeti — Depoda (emerald) / Sevkte (violet/amber) / Sevk Edildi (zinc). */
function statusBadge(sack: SackSearchRow): { label: string; className: string } {
  if (isWarehouseSack(sack)) return { label: "Depoda", className: "bg-emerald-600 text-white" };
  switch (sack.shipment!.status) {
    case "AT_DOOR":
      return { label: "Sevkte", className: "bg-amber-500 text-white" };
    case "DISPATCHED":
      return { label: "Sevk Edildi", className: "bg-zinc-600 text-white" };
    default:
      return { label: "Sevkte", className: "bg-violet-600 text-white" };
  }
}

/** İçerik → ürün·renk·en özet grupları (renkli çip için). */
function specGroups(rolls: SackContentRoll[]) {
  const m = new Map<string, { item: string; color: string | null; hex: string | null; width: number | null; qty: number; count: number }>();
  for (const r of rolls) {
    const key = `${r.item.name}|${r.color?.name ?? ""}|${r.width ?? ""}`;
    const g = m.get(key) ?? { item: r.item.name, color: r.color?.name ?? null, hex: r.color?.hex ?? null, width: r.width, qty: 0, count: 0 };
    g.qty += Number(r.currentQty);
    g.count += 1;
    m.set(key, g);
  }
  return [...m.values()];
}

interface Props {
  sack: SackSearchRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (sack: SackSearchRow) => void;
}

/** Tek çuval satırı — LOUD durum + kimlik + sayaçlar; genişletince renkli içerik çipleri. */
export function SackListRow({ sack, selected, onToggleSelect, onEdit }: Props) {
  const [open, setOpen] = useState(false);
  const warehouse = isWarehouseSack(sack);
  const badge = statusBadge(sack);
  const hasMatch = sack.matchRollCount !== null;

  const contents = useQuery({
    queryKey: ["sack-contents", sack.id],
    queryFn: () => sackHubService.contents(sack.id),
    enabled: open,
    staleTime: 30_000,
  });
  const rolls = contents.data?.data.rolls ?? [];
  const swatches = contents.data?.data.swatches ?? [];
  const groups = useMemo(() => specGroups(rolls), [rolls]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        selected ? "border-primary/70 bg-primary/5 ring-1 ring-primary/30" : "hover:border-primary/30",
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Seçim yalnız depodaki (sevk edilebilir) çuvallarda. */}
        <div className="w-5 shrink-0">
          {warehouse ? (
            <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(sack.id)} aria-label={`Çuval ${sack.sackNo} seç`} />
          ) : null}
        </div>

        {/* Ana tık: depo çuvalı → editör; sevkteki → içerik önizleme. */}
        <button
          type="button"
          onClick={() => (warehouse ? onEdit(sack) : setOpen((v) => !v))}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide", badge.className)}>
            {badge.label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono text-sm font-semibold">{sack.sackNo}</span>
              <span className="text-sm text-foreground/80">{sack.customer?.name ?? "—"}</span>
              {sack.branch && <Badge variant="secondary" className="text-[10px]">{sack.branch.name}</Badge>}
              {sack.shipment && (
                <span className="text-xs text-muted-foreground">
                  {sack.shipment.shipmentNo} · {shipmentStatusLabels[sack.shipment.status]}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                <span className="font-medium text-foreground">{sack.rollCount}</span> top
              </span>
              <span className="tabular-nums font-medium text-foreground">{fmtQty(sack.totalQty)}</span>
              {sack.swatchCount > 0 && <span className="tabular-nums">{sack.swatchCount} kartela</span>}
              {sack.weightKg !== null && (
                <span className="tabular-nums">{sack.weightKg.toLocaleString("tr-TR", { useGrouping: false })} kg</span>
              )}
              <span>{safeFormat(sack.createdAt, "dd.MM.yyyy")}</span>
              {hasMatch && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
                  Eşleşen: {sack.matchRollCount} top · {fmtQty(sack.matchQty ?? 0)}
                </span>
              )}
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {warehouse && (
            <button
              type="button"
              onClick={() => onEdit(sack)}
              className="hidden items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 sm:inline-flex"
            >
              <PencilLine className="h-3.5 w-3.5" /> Düzenle
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="İçeriği göster"
            aria-expanded={open}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t px-4 py-3">
          {contents.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : rolls.length === 0 && swatches.length === 0 ? (
            <p className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
              <Package className="h-3.5 w-3.5" /> Boş çuval.
            </p>
          ) : (
            <>
              {/* Renkli içerik özeti çipleri (ürün · renk · en). */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {groups.map((g, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px]">
                    {g.hex && <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: g.hex }} />}
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
                          {r.color?.hex && <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: r.color.hex }} />}
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
      )}
    </div>
  );
}
