// Kartelada Toplar — AT_KARTELA rulolar. Tablo bu sekmeyle bağlanır (filtre kaydı `rolls:KARTELA_SENT`).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { ScanField } from "@/components/scanner/ScanField";
import { useDataTable } from "@/hooks/useDataTable";
import { loadAllForPicker } from "@/lib/picker-loader";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { makeRollColumns } from "@/pages/Operations/Rolls/columns";
import { buildRollForceFilters, rollService } from "@/pages/Operations/Rolls/service";
import { RollsTableBody } from "@/pages/Operations/Rolls/RollsTableBody";
import { buildRollFilterDefs } from "@/pages/Operations/Rolls/roll-filter-defs";
import { useFoldValues } from "@/hooks/useFoldValues";
import { RollsFilterRow, rollPersistConfig } from "@/pages/Operations/Rolls/RollsFilterRow";
import type { Roll } from "@/pages/Operations/Rolls/types";

const FORCE = buildRollForceFilters("KARTELA_SENT");
const PERSIST = rollPersistConfig("KARTELA_SENT");

interface Props {
  scanCode: string;
  onScanCodeChange: (v: string) => void;
  /** Okutulan kartela (SW-) barkodu → kartela detayı. */
  onScanSwatch: (code: string) => void;
  swatchLookupPending: boolean;
}

export function KartelaRollsTab({ scanCode, onScanCodeChange, onScanSwatch, swatchLookupPending }: Props) {
  // Kalite kataloğu anahtarı Kumaş Stoğu ile aynı (tek önbellek girdisi, aynı tazelik).
  const qualityGradesQuery = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    staleTime: 5 * 60_000,
  });
  const qualityGrades = useMemo(() => qualityGradesQuery.data?.data ?? [], [qualityGradesQuery.data]);
  const columns = useMemo(() => makeRollColumns(qualityGrades), [qualityGrades]);
  // Kartelada depo/sahip süzgeci yok (bugünkü gibi); kat seçenekleri katalogdan.
  const { values: foldValues } = useFoldValues();
  const filters = useMemo(() => buildRollFilterDefs("KARTELA_SENT", foldValues.map((v) => ({ value: v.code, label: v.name }))), [foldValues]);
  const { table, query, pagination, fetchAll } = useDataTable<Roll>({
    queryKey: "rolls:KARTELA_SENT",
    queryKeyParts: ["rolls", "KARTELA_SENT"],
    fetchFn: rollService.listCursor,
    columns,
    defaultPageSize: 100,
    forceFilters: FORCE,
    // Fason sütunları kartelada anlamsız (AT_KARTELA topta aktif fason sevki yok).
    initialVisibility: { subcontractorCategory: false, subcontractor: false },
    persistFilters: PERSIST,
  });
  return (
    <>
      <RollsFilterRow
        filters={filters}
        leading={
          <ScanField
            value={scanCode}
            onChange={onScanCodeChange}
            onScan={onScanSwatch}
            placeholder="Barkod okut..."
            expectPrefix="SWATCH"
            busy={swatchLookupPending}
            className="w-44 min-w-[8rem] shrink 2xl:w-64"
            inputClassName="h-8 text-sm"
            clearable
          />
        }
        trailing={
          <>
            <SavedViewsMenu compact />
            <DataTableTools table={table} exportName="Kumaş Stoğu" fetchAll={fetchAll} compact />
          </>
        }
      />
      <RollsTableBody tab="KARTELA_SENT" table={table} isLoading={query.isLoading} pagination={pagination} hideFilterBar />
    </>
  );
}
