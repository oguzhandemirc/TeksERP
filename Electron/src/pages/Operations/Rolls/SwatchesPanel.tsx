import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Minus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { swatchService, type KartelaStockGroup } from "./swatchService";
import { ReduceKartelaStockDialog } from "./ReduceKartelaStockDialog";

const NUM_FMT = new Intl.NumberFormat("tr-TR", { useGrouping: false });

function groupKey(g: KartelaStockGroup): string {
  return `${g.itemId}__${g.colorId ?? "none"}`;
}

/**
 * Kartela Stoğu — kartelalar sahada tek tek okutulup düşülmediğinden envanter
 * ADET bazlı gösterilir: ürün+renk grubu → kaç adet müsait. "Depoda Patos Mavi
 * karteladan kaç tane var" sorusunun tek-bakış cevabı. Stok yalnız kabulde (+)
 * ve sevkiyatta (−) değişir; kayıp/hasar/sayım için "Düş" ile elle azaltılır.
 */
export function SwatchesPanel() {
  const [search, setSearch] = useState("");
  const [reduceGroup, setReduceGroup] = useState<KartelaStockGroup | null>(null);
  const debounced = useDebouncedValue(search.trim(), 300);

  const query = useQuery({
    queryKey: ["kartela", "stock", debounced],
    queryFn: () => swatchService.getStock(debounced || undefined),
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar — arama + toplam özet */}
      <div className="flex items-center gap-3 border-b px-3 py-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ürün / renk ara..."
            className="h-8 pl-8 text-sm"
          />
        </div>
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
            {debounced ? `'${debounced}' için kartela stoğu yok.` : "Kartela stoğu yok."}
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
