import { useMemo } from "react";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { compareRolls, type RollSortField } from "../roll-search";
import type { RollSort } from "./useShipmentDetailFilter";
import type { ShipmentDetailRoll, ShipmentDetailSack, SackProductSummary } from "../types";
import { ReturnedRollBadge } from "../ReturnedRollBadge";

const num = (v: number | null | undefined) => formatNumber(v, 1);

/** Çuval içeriğinin kısa özeti: ilk 2 "kumaş·renk ×adet" + taşarsa "+k". */
function summaryHint(summary: SackProductSummary[]): string {
  if (summary.length === 0) return "";
  const head = summary
    .slice(0, 2)
    .map((s) => `${s.itemName}${s.colorName ? `·${s.colorName}` : ""} ×${s.rollCount}`)
    .join(", ");
  const extra = summary.length - 2;
  return extra > 0 ? `${head} +${extra}` : head;
}

/** Sıralanabilir kolon başlığı — tıkla: bu alana geç / aynı alandaysa yön çevir. */
function SortTh({
  field,
  label,
  align = "left",
  activeField,
  dir,
  onSort,
}: {
  field: RollSortField;
  label: string;
  align?: "left" | "right";
  activeField: RollSortField | null;
  dir: "asc" | "desc";
  onSort: (f: RollSortField) => void;
}) {
  const active = activeField === field;
  return (
    <th className={align === "right" ? "text-right" : "text-left"}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-0.5 font-medium hover:text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-30" />
        )}
      </button>
    </th>
  );
}

/**
 * Tam-sayfa detayda tek çuval — YOĞUN TEK SATIR (Card değil): chevron + Çuval #seq +
 * sackNo + kg + top sayısı + içerik özeti + (süzgeç aktifse) "N eşleşen" rozeti. Tıkla →
 * satır altında SIRALANABİLİR top tablosu (Barkod/Kumaş+renk/En/Kalite/Metraj) + (süzgeç
 * kapalıysa) kartelalar açılır. `rolls` süzgeçten geçmiş gelir; aç/kapa dışarıdan yönetilir
 * (sanallaştırıcı satır yüksekliğini ResizeObserver ile ölçer).
 */
export function SackRow({
  sack,
  rolls,
  open,
  isFiltering,
  onToggle,
  sort,
  onSort,
}: {
  sack: ShipmentDetailSack;
  rolls: ShipmentDetailRoll[];
  open: boolean;
  isFiltering: boolean;
  onToggle: () => void;
  /** Çuval-içi top sıralaması — dışarıda (hook'ta) tutulur ki remount'ta kaybolmasın. */
  sort: RollSort | null;
  onSort: (field: RollSortField) => void;
}) {
  const sortField = sort?.field ?? null;
  const sortDir = sort?.dir ?? "asc";
  const sortedRolls = useMemo(
    () => (sortField ? [...rolls].sort((a, b) => compareRolls(a, b, sortField, sortDir)) : rolls),
    [rolls, sortField, sortDir],
  );
  const hint = summaryHint(sack.productSummary);

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="shrink-0 font-semibold">{sack.seqLabel ?? `Çuval #${sack.seq}`}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{sack.sackNo}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {sack.weightKg != null ? `${num(sack.weightKg)} kg` : "tartılmadı"} · {rolls.length} top
          {sack.returnedCount > 0 && (
            <span className="text-amber-700 dark:text-amber-400"> · {sack.returnedCount} iade</span>
          )}
        </span>
        {hint && <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span>}
        {isFiltering && (
          <span className="ml-auto shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
            {rolls.length} eşleşen
          </span>
        )}
      </button>

      {open && (
        <div className="border-t px-2 pb-2 pt-1.5">
          {rolls.length === 0 ? (
            <div className="text-xs text-muted-foreground">Top yok.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground [&>th]:px-2 [&>th]:py-1 [&>th]:font-medium">
                    <SortTh field="barcode" label="Barkod" activeField={sortField} dir={sortDir} onSort={onSort} />
                    <SortTh field="item" label="Kumaş" activeField={sortField} dir={sortDir} onSort={onSort} />
                    <SortTh field="width" label="En" align="right" activeField={sortField} dir={sortDir} onSort={onSort} />
                    <SortTh field="qualityGrade" label="Kalite" activeField={sortField} dir={sortDir} onSort={onSort} />
                    <SortTh field="currentQty" label="Metraj" align="right" activeField={sortField} dir={sortDir} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedRolls.map((r) => (
                    <tr
                      key={r.returned?.returnId ?? r.id}
                      className={cn(
                        "border-t [&>td]:px-2 [&>td]:py-1",
                        // Sevk anında bu çuvaldaydı, sonradan iade alındı — satır
                        // duruyor ama mal burada değil (bkz. ReturnedRollBadge).
                        r.returned && "text-muted-foreground",
                      )}
                    >
                      <td className="text-left font-mono">
                        {r.returned && (
                          <ReturnedRollBadge
                            returnedAt={r.returned.returnedAt}
                            reasonName={r.returned.reasonName}
                          />
                        )}
                        {r.barcode ?? <span className="italic text-muted-foreground/60">açık kumaş</span>}
                      </td>
                      <td className="text-left">
                        {r.item?.name ?? "—"}
                        {r.color && <span className="text-muted-foreground"> · {r.color.name}</span>}
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
            </div>
          )}

          {!isFiltering && sack.swatches.length > 0 && (
            <div className="mt-2 space-y-0.5 border-t pt-1.5 text-[11px] text-muted-foreground">
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
