import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { ScanField } from "@/components/scanner/ScanField";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { swatchService, type KartelaStockGroup } from "./swatchService";
import { ReduceKartelaStockDialog } from "./ReduceKartelaStockDialog";

const NUM_FMT = new Intl.NumberFormat("tr-TR", { useGrouping: false });

const FILTERS: FilterDef[] = [
  { kind: "lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
];

function groupKey(g: KartelaStockGroup): string {
  return `${g.itemId}__${g.colorId ?? "none"}`;
}

interface Props {
  /** Okutulan kod bir kartela (KRT…) ise: liste araması yerine kartela detayını aç. */
  onScanSwatch: (code: string) => void;
  swatchLookupPending: boolean;
}

/**
 * Kartela Stoğu — kartelalar sahada tek tek okutulup düşülmediğinden envanter
 * ADET bazlı gösterilir: ürün+renk grubu → kaç adet müsait. "Depoda Patos Mavi
 * karteladan kaç tane var" sorusunun tek-bakış cevabı. Stok yalnız kabulde (+)
 * ve sevkiyatta (−) değişir; kayıp/hasar/sayım için "Düş" ile elle azaltılır.
 */
export function SwatchesPanel({ onScanSwatch, swatchLookupPending }: Props) {
  const [search, setSearch] = useState("");
  const [reduceGroup, setReduceGroup] = useState<KartelaStockGroup | null>(null);
  const debounced = useDebouncedValue(search.trim(), 300);
  const [searchParams] = useSearchParams();
  const itemId = searchParams.get("filter[itemId]") ?? undefined;
  const colorId = searchParams.get("filter[colorId]") ?? undefined;

  const query = useQuery({
    queryKey: ["kartela", "stock", debounced, itemId, colorId],
    queryFn: () => swatchService.getStock({ search: debounced || undefined, itemId, colorId }),
    staleTime: 5_000,
  });

  const groups = useMemo(() => query.data?.data ?? [], [query.data]);
  const totals = useMemo(
    () => ({
      count: groups.reduce((sum, g) => sum + g.count, 0),
      kinds: groups.length,
    }),
    [groups],
  );

  // Tek giriş: kartela barkodu (KRT…) → detay sheet; ürün/renk metni → liste araması.
  const handleScan = (code: string) => {
    if (classifyBarcode(code).kind === "SWATCH") {
      onScanSwatch(code);
      setSearch("");
      return;
    }
    setSearch(code);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar — ara/okut + filtreler + toplam özet */}
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <ScanField
          value={search}
          onChange={setSearch}
          onScan={handleScan}
          placeholder="Ara ya da barkod okut..."
          expectPrefix="SWATCH"
          busy={swatchLookupPending}
          widthClassName="w-64"
          inputClassName="h-8 text-xs"
          clearable
        />
        <FilterBar filters={FILTERS} inline />
        <div className="ml-auto flex items-center gap-3 text-xs">
          <Stat label="Toplam" value={NUM_FMT.format(totals.count)} unit="adet" />
          <span className="h-3 w-px bg-border" aria-hidden />
          <Stat label="Çeşit" value={NUM_FMT.format(totals.kinds)} unit="grup" />
        </div>
      </div>

      {/* Liste — gruplu adet */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {query.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</div>
        ) : groups.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {debounced
              ? `'${debounced}' için kartela stoğu yok.`
              : itemId || colorId
                ? "Filtrelerle eşleşen kartela stoğu yok."
                : "Kartela stoğu yok."}
          </div>
        ) : (
          <ul className="space-y-1">
            {groups.map((g) => (
              <li
                key={groupKey(g)}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: g.colorHex ?? "transparent" }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.itemName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {g.colorName ?? "Renksiz"}
                    {g.itemCode ? ` · ${g.itemCode}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-1 tabular-nums">
                  <span className="text-base font-semibold">{NUM_FMT.format(g.count)}</span>
                  <span className="text-[10px] text-muted-foreground">adet</span>
                </span>
                <PermissionGate permission="kartela:write">
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-2 h-7 shrink-0 gap-1"
                    onClick={() => setReduceGroup(g)}
                  >
                    <Minus className="h-3.5 w-3.5" /> Düş
                  </Button>
                </PermissionGate>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ReduceKartelaStockDialog
        group={reduceGroup}
        open={Boolean(reduceGroup)}
        onOpenChange={(open) => !open && setReduceGroup(null)}
      />
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
      <span className="text-[10px] text-muted-foreground">{unit}</span>
    </div>
  );
}
