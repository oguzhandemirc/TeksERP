import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Input } from "@/components/ui/input";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { productBalanceService } from "./service";
import { ProductBalanceRow } from "./ProductBalanceRow";
import { ProductBalanceWoDialog } from "./ProductBalanceWoDialog";
import type { BalanceGroup, BalanceSpecRow, WoTarget } from "./types";

const QUERY_KEY = "product-balance";

// Ürün → backend (sorguları daraltır). Renk/Durum → client-side (anlık).
const FILTERS: FilterDef[] = [
  { kind: "lookup", key: "itemId", label: "Ürün", service: itemService, queryKey: "items" },
  { kind: "lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    kind: "select",
    key: "status",
    label: "Durum",
    options: [
      { value: "OPEN", label: "Açık (üretilecek var)" },
      { value: "COVERED", label: "Karşılanıyor" },
      { value: "MATERIAL_SHORT", label: "Ham açığı var" },
    ],
  },
];

export function ProductBalancePage() {
  const [searchParams] = useSearchParams();
  // itemId server-side (queryKey + ?itemId=...); diğerleri client-side filtre.
  const itemId = searchParams.get("filter[itemId]") ?? undefined;
  const colorId = searchParams.get("filter[colorId]") ?? undefined;
  const status = searchParams.get("filter[status]") ?? undefined;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [woTarget, setWoTarget] = useState<WoTarget | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: [QUERY_KEY, itemId ?? null],
    queryFn: () => productBalanceService.getBalance({ itemId }),
    staleTime: 15_000,
  });
  const groups = useMemo(() => data?.data ?? [], [data]);

  // Renk + durum + arama: küçük grup listesi üzerinde anlık (ağ isteği yok).
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return groups.filter((g) => {
      if (colorId && g.colorId !== colorId) return false;
      if (status === "OPEN" && !(g.uretilecek > 0)) return false;
      if (status === "COVERED" && g.uretilecek > 0) return false;
      if (status === "MATERIAL_SHORT" && !(g.malzemeAcigi > 0)) return false;
      if (!q) return true;
      return (
        g.itemName.toLocaleLowerCase("tr").includes(q) ||
        (g.colorName?.toLocaleLowerCase("tr").includes(q) ?? false) ||
        g.specs.some(
          (s) =>
            (s.width != null && String(s.width).includes(q)) ||
            s.lines.some(
              (l) =>
                l.orderNumber.toLocaleLowerCase("tr").includes(q) ||
                l.customerName.toLocaleLowerCase("tr").includes(q),
            ) ||
            s.wos.some((w) => w.batchNumber.toLocaleLowerCase("tr").includes(q)),
        )
      );
    });
  }, [groups, colorId, status, search]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openWo = (g: BalanceGroup, s: BalanceSpecRow) =>
    setWoTarget({
      key: s.key,
      itemId: s.itemId,
      itemName: s.itemName,
      colorId: s.colorId,
      colorName: s.colorName,
      width: s.width,
      talep: s.talep,
      depo: s.depo,
      uretimde: s.uretimde,
      uretilecek: s.uretilecek,
      ham: g.ham,
      lines: s.lines,
    });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Ürün Dengesi"
        description="Ürün+renk bazında talep ↔ depo + üretim dengesi. Açık varsa eksik kadar iş emri aç."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ürün, renk, sipariş no, müşteri, parti ara..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        {!isLoading && (
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} ürün
          </span>
        )}
      </div>
      <FilterBar filters={FILTERS} />

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Hesaplanıyor…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Açık talep veya üretimde ürün yok.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Filtreyle eşleşen ürün yok.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th className="text-left">Ürün</th>
                  <th className="text-left" title="En (cm)">En</th>
                  <th className="text-right" title="Açık siparişler (istenen − sevk)">
                    Talep
                  </th>
                  <th className="text-right" title="Depoda hazır (sevksiz)">Depo</th>
                  <th className="text-right" title="Canlı iş emirlerinde">Üretimde</th>
                  <th
                    className="text-right"
                    title="İşlenecek ham kumaş — ürün+renk havuzu (eni önemsiz)"
                  >
                    Ham
                  </th>
                  <th className="text-right" title="Talep − Depo − Üretimde">Üretilecek</th>
                  <th className="text-right" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => (
                  <ProductBalanceRow
                    key={g.key}
                    group={g}
                    isOpen={expanded.has(g.key)}
                    onToggle={() => toggle(g.key)}
                    onOpenWo={(s) => openWo(g, s)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Üretilecek = Talep − Depo − Üretimde. Fabrika kumaş üretmez, işler —
          ham stok yetmiyorsa "ham açığı" kadar kumaş tedariki gerekir. Ham
          kumaşın eni önemsizdir: ham havuzu ürün+renk düzeyinde tutulur, en'lere
          bölünmez (renksiz ham boyanacağı için her renge sayılır).
        </p>
      </div>

      <ProductBalanceWoDialog
        spec={woTarget}
        open={woTarget !== null}
        onOpenChange={(o) => !o && setWoTarget(null)}
      />
    </div>
  );
}
