import { useMemo, useState } from "react";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/DataTable";
import { sackContentsColumns } from "./sackContentsColumns";
import type { SackContentRoll } from "./types";

const fmtQty = (n: number) =>
  `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/** Arama eşleşmesi — barkod / kumaş / renk / en (Türkçe küçültme). */
function matches(r: SackContentRoll, q: string): boolean {
  if (!q) return true;
  const hay = [r.barcode ?? "", r.item.name, r.color?.name ?? "", r.width != null ? `${r.width}` : ""]
    .join(" ")
    .toLocaleLowerCase("tr");
  return hay.includes(q);
}

interface Props {
  rolls: SackContentRoll[];
  isLoading?: boolean;
  /** Toplar boşken gösterilecek metin (kartela varsa çağıran farklı metin verir). */
  emptyText?: string;
}

/**
 * Çuval içeriği — SALT-OKUNUR DataTable + arama. Editördeki `SackContentsTable`
 * ile AYNI kolonları (`sackContentsColumns`) kullanır; fark: seçim/toplu aksiyon
 * yok (sevkteki çuval kilitli) ve istemci-taraflı filtre var.
 *
 * Filtre `getFilteredRowModel` yerine veri dizisinde uygulanır — çuval içeriği
 * onlarca satır (tek çuval), tanstack global-filter'ın kolon-bazlı semantiğine
 * girmeye değmez ve "kaç eşleşme / kaç metre" özeti doğrudan hesaplanır.
 */
export function SackContentsReadonlyTable({ rolls, isLoading, emptyText }: Props) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLocaleLowerCase("tr");
  const shown = useMemo(() => rolls.filter((r) => matches(r, needle)), [rolls, needle]);
  const shownQty = shown.reduce((a, r) => a + Number(r.currentQty), 0);

  const table = useReactTable({
    data: shown,
    columns: sackContentsColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    // Seçim YOK → DataTable checkbox kolonunu hiç eklemez (salt-okunur panel).
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-2">
      {/* Arama — 1'den fazla top varsa anlamlı. */}
      {rolls.length > 1 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Barkod, kumaş, renk veya en ara…"
              className="h-8 pl-8 pr-8 text-xs"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Aramayı temizle"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {needle && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {shown.length} eşleşme · {fmtQty(shownQty)}
            </span>
          )}
        </div>
      )}

      <DataTable<SackContentRoll>
        table={table}
        emptyText={needle ? `“${q}” ile eşleşen top yok.` : (emptyText ?? "Çuval boş.")}
      />
    </div>
  );
}
