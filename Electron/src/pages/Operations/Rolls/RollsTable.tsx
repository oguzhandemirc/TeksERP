import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PanelRight } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { CopyMenuItem } from "@/components/data-table/row-menu-items";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, StandaloneDateRangeFilter, type FilterDef } from "@/components/data-table/FilterBar";
import { Checkbox } from "@/components/ui/checkbox";
import { useDataTable } from "@/hooks/useDataTable";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { parseUrlToQueryParams } from "@/lib/query-builder";
import { rollColumns } from "./columns";
import {
  rollService,
  ROLL_STATUS_TABS,
  type RollStats,
  type RollStatusTabKey,
} from "./service";
import { RollDetailSheet } from "./RollDetailSheet";
import type { Roll } from "./types";

const NUM_FMT = new Intl.NumberFormat("tr-TR");
const DEC_FMT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

function RollsStats({ data, isLoading }: { data: RollStats | undefined; isLoading: boolean }) {
  if (isLoading && !data) {
    return <span className="text-xs text-muted-foreground">Yükleniyor…</span>;
  }
  if (!data) return null;
  return (
    <div className="flex items-center gap-3 text-xs">
      <Stat label="Top" value={NUM_FMT.format(data.totalCount)} unit="adet" />
      <Divider />
      <Stat label="Metre" value={DEC_FMT.format(data.totalQty)} unit="mt" />
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

function Divider() {
  return <span className="h-3 w-px bg-border" aria-hidden />;
}

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
];

// Tarih filtresi FilterBar'da DEĞİL, araç çubuğunda (Sütunlar/Görünümler satırı, sola dayalı).
const DATE_FILTER = { kind: "dateRange", label: "Tarih", defaultField: "createdAt" } as const;

// Sadece "Bitmiş Depo" sekmesinde anlamlı: WAREHOUSE topu serbest mi yoksa bir
// çuvala/sevkiyata rezerve mi? (backend filter[shipmentScope]=free|committed)
const SHIPMENT_SCOPE_FILTER: FilterDef = {
  kind: "select",
  key: "shipmentScope",
  label: "Sevkiyat",
  options: [
    { value: "free", label: "Serbest depo" },
    { value: "committed", label: "Çuvalda (rezerve)" },
  ],
};

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

  // Serbest/rezerve filtresi yalnız depo (Bitmiş Depo) sekmesinde gösterilir.
  const filters = useMemo<FilterDef[]>(
    () => (tab === "FINISHED_STOCK" ? [...FILTERS, SHIPMENT_SCOPE_FILTER] : FILTERS),
    [tab],
  );

  const { table, query, search, setSearch, pagination } = useDataTable<Roll>({
    queryKey: `rolls:${tab}`, // tercih anahtarı (sütun sırası/görünürlük) — değişmeden kalır
    // Y2 fix: React Query key'i array varyantlı — roll mutate eden her yerin
    // ["rolls"] invalidate'i artık TÜM sekme tablolarına çarpar (string-suffix
    // varyant array prefix eşleşmesine asla yakalanmıyordu).
    queryKeyParts: ["rolls", tab],
    fetchFn: rollService.listCursor,
    columns: rollColumns,
    defaultPageSize: 100,
    forceFilters,
  });

  // Stats query — liste ile aynı filtreleri paylaşır (URL filtreleri + forceFilters
  // + search). Backend /api/rolls/stats aynı buildRollWhere kullanır, listeden sapmaz.
  const urlParams = useMemo(
    () => parseUrlToQueryParams(searchParams.toString(), { pageSize: 100 }),
    [searchParams],
  );
  const statsFilters = useMemo(
    () => ({ ...urlParams.filters, ...forceFilters }),
    [urlParams.filters, forceFilters],
  );
  // Tablo ile aynı array prefix (["rolls", tab]) — ["rolls"] invalidate'i
  // stats'ı da tabloyla birlikte tazeler.
  const statsQuery = useQuery({
    queryKey: [
      "rolls",
      tab,
      "stats",
      statsFilters,
      urlParams.search,
      urlParams.dateField,
      urlParams.dateFrom,
      urlParams.dateTo,
    ],
    queryFn: () =>
      rollService.getStats({
        page: 1,
        pageSize: 1,
        sortBy: "createdAt",
        sortOrder: "desc",
        filters: statsFilters,
        search: urlParams.search,
        dateField: urlParams.dateField,
        dateFrom: urlParams.dateFrom,
        dateTo: urlParams.dateTo,
      }),
    staleTime: 0,
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
        hideSearch // Arama sayfa üstündeki birleşik "okut/ara" input'undan sürülüyor (URL search).
        table={table}
        exportName="Toplar"
        leading={<StandaloneDateRangeFilter def={DATE_FILTER} />}
        actions={
          <RollsStats
            data={statsQuery.data?.data}
            isLoading={statsQuery.isLoading}
          />
        }
      />
      <FilterBar filters={filters} />
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
        rowContextMenu={(roll) => (
          <>
            <ContextMenuItem onSelect={() => setSelected(roll)}>
              <PanelRight /> Detayı aç (panel)
            </ContextMenuItem>
            {roll.barcode && (
              <>
                <ContextMenuSeparator />
                <CopyMenuItem label="Barkod" value={roll.barcode} />
              </>
            )}
          </>
        )}
      />
      <RollDetailSheet
        roll={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
