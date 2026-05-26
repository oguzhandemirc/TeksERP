import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { Checkbox } from "@/components/ui/checkbox";
import { useDataTable } from "@/hooks/useDataTable";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { rollColumns } from "./columns";
import { rollService, ROLL_STATUS_TABS, type RollStatusTabKey } from "./service";
import { RollDetailSheet } from "./RollDetailSheet";
import type { Roll } from "./types";

const FILTERS: FilterDef[] = [
  {
    kind: "select",
    key: "processingStatus",
    label: "İşlem Durumu",
    options: [
      { value: "raw", label: "Ham" },
      { value: "processed", label: "İşleniyor" },
      { value: "finished", label: "Bitmiş" },
      { value: "open_fabric", label: "Açık Kumaş" },
    ],
  },
  {
    kind: "lookup",
    key: "itemId",
    label: "Ürün",
    service: itemService,
    queryKey: "items",
  },
  { kind: "lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    kind: "multi-lookup",
    key: "propertyIds",
    label: "Özellik",
    service: fabricPropertyService,
    queryKey: "fabric-properties",
  },
  { kind: "numberRange", key: "width", label: "En", unit: "cm" },
  { kind: "numberRange", key: "qty", label: "Boy", unit: "mt" },
  { kind: "dateRange", label: "Tarih", defaultField: "createdAt" },
];

interface Props {
  tab: RollStatusTabKey;
}

export function RollsTable({ tab }: Props) {
  const [selected, setSelected] = useState<Roll | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const includeFire = searchParams.get("filter[includeFire]") === "true";

  const forceFilters = useMemo<Record<string, string | string[]>>(() => {
    if (tab === "RAW_STOCK") {
      // KK1 ham kumaş: renksiz + henüz hiçbir adıma girmemiş.
      // rollScope=RAW_STOCK backend'de tek noktadan tanımlı.
      return { rollScope: "RAW_STOCK", status: "ALL" };
    }
    if (tab === "PRODUCTION") {
      // Super-set: WO akışındaki tüm toplar (Fasonda + Kurşun/Tambur bekleyen
      // açık kumaş + IN_PRODUCTION). Diğer sekmeler bu süper-setin alt-kümesi.
      return { rollScope: "PRODUCTION_ACTIVE", status: "ALL" };
    }
    if (tab === "FINISHED_STOCK") {
      // Tambur sonrası depoya alınmış, sevke hazır.
      return { rollScope: "FINISHED_STOCK", status: "ALL" };
    }
    if (tab === "KURSUN_PENDING") {
      // Kurşun/KK2 istasyonundaki açık kumaş kayıtları.
      // status=ALL göndermek şart — backend filter[status] yoksa default
      // STOCK uyguluyor, IN_PRODUCTION'daki açık kumaş kayıtları kaybolur.
      return {
        currentStepKind: "PROCESS_QC",
        rollKind: "OPEN_FABRIC",
        status: "ALL",
      };
    }
    if (tab === "TAMBUR_PENDING") {
      // Tambur istasyonunda bekleyen açık kumaş — Kurşun/KK2'den geçmiş,
      // operatörün kesip top oluşturmasını bekleyen kayıtlar.
      return {
        currentStepKind: "TAMBUR",
        rollKind: "OPEN_FABRIC",
        status: "ALL",
      };
    }
    const statusVal = ROLL_STATUS_TABS[tab];
    const out: Record<string, string | string[]> = {};
    if (statusVal) out.status = statusVal;
    return out;
  }, [tab]);

  const { table, query, search, setSearch, pagination } = useDataTable<Roll>({
    queryKey: `rolls:${tab}`,
    fetchFn: rollService.listCursor,
    columns: rollColumns,
    defaultPageSize: 100,
    forceFilters,
  });

  const toggleIncludeFire = (next: boolean) => {
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("filter[includeFire]", "true");
    else sp.delete("filter[includeFire]");
    setSearchParams(sp, { replace: true });
  };

  return (
    <>
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Barkod ara..."
      />
      <FilterBar filters={FILTERS} />
      <label className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground cursor-pointer select-none">
        <Checkbox
          checked={includeFire}
          onCheckedChange={(v) => toggleIncludeFire(v === true)}
        />
        Fire kaliteyi de göster
      </label>
      <DataTable<Roll>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Top bulunamadı."
        onRowClick={setSelected}
      />
      <RollDetailSheet
        roll={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
