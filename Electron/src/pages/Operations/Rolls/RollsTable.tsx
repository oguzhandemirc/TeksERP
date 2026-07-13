import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { useDataTable } from "@/hooks/useDataTable";
import { rollColumns } from "./columns";
import { rollService, buildRollForceFilters, type RollStatusTabKey } from "./service";
import { RollsTableBody } from "./RollsTableBody";
import type { Roll } from "./types";

interface Props {
  tab: RollStatusTabKey;
}

/**
 * KENDİ KENDİNE YETEN rulo tablosu — kendi useDataTable + araç çubuğunu (Sütunlar/
 * Görünümler + "Fire" toggle) kurar, gövdeyi [[RollsTableBody]]'ye çizdirir.
 * Kartela "Gönderilen Toplar" sekmesi bunu kullanır.
 *
 * NOT: Envanter sayfası (RollsPage) bunu KULLANMAZ — tabloyu üst chrome'da kurup
 * araçları okut/ara satırına, "Top/Metre" özetini sekme şeridine taşımak için
 * RollsTableBody'yi doğrudan besler.
 */
export function RollsTable({ tab }: Props) {
  const forceFilters = useMemo(() => buildRollForceFilters(tab), [tab]);
  const { table, query, pagination } = useDataTable<Roll>({
    queryKey: `rolls:${tab}`, // sütun sırası/görünürlük tercih anahtarı
    queryKeyParts: ["rolls", tab], // ["rolls"] invalidate'i array-prefix eşleşir
    fetchFn: rollService.listCursor,
    columns: rollColumns,
    defaultPageSize: 100,
    forceFilters,
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const includeFire = searchParams.get("filter[includeFire]") === "true";
  const toggleIncludeFire = (next: boolean) => {
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("filter[includeFire]", "true");
    else sp.delete("filter[includeFire]");
    setSearchParams(sp, { replace: true });
  };

  return (
    <>
      <DataTableToolbar
        search=""
        onSearchChange={() => {}}
        hideSearch // Arama bu sekmede yok (Kartela kendi barkod okutmasını üstte sunuyor).
        table={table}
        exportName="Envanter"
        actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={includeFire}
              onCheckedChange={(v) => toggleIncludeFire(v === true)}
            />
            Fire kaliteyi de göster
          </label>
        }
      />
      <RollsTableBody
        tab={tab}
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
      />
    </>
  );
}
