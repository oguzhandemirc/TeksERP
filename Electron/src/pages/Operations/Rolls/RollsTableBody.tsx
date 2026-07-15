import { useMemo, useState } from "react";
import type { Table } from "@tanstack/react-table";
import { PanelRight, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { CopyMenuItem } from "@/components/data-table/row-menu-items";
import { FilterBar, StandaloneDateRangeFilter, type FilterDef } from "@/components/data-table/FilterBar";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import type { DataTablePagination } from "@/hooks/useDataTable";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { RollDetailSheet } from "./RollDetailSheet";
import { BulkCancelRollsDialog } from "./BulkCancelRollsDialog";
import type { RollStatusTabKey } from "./service";
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
];

export const DATE_FILTER = { kind: "dateRange", label: "Tarih", defaultField: "createdAt" } as const;

// Sadece "Bitmiş Depo" sekmesinde anlamlı: WAREHOUSE topu serbest mi yoksa bir
// çuvala/sevkiyata rezerve mi? (backend filter[shipmentScope]=free|committed)
const SHIPMENT_SCOPE_FILTER: FilterDef = {
  kind: "select",
  key: "shipmentScope",
  label: "Sevkiyat",
  options: [
    { value: "free", label: "Serbest depo" },
    { value: "committed", label: "Çuval içinde" },
  ],
};

// Serbest/rezerve filtresi yalnız depo (Bitmiş Depo) sekmesinde gösterilir.
export function buildRollFilterDefs(tab: RollStatusTabKey): FilterDef[] {
  return tab === "FINISHED_STOCK" ? [...FILTERS, SHIPMENT_SCOPE_FILTER] : FILTERS;
}

interface Props {
  tab: RollStatusTabKey;
  /** Tablo örneği + yükleme/sayfalama ÇAĞIRAN'da kurulur (useDataTable). Gövde salt
   *  görünüm: filtre satırı + tablo + detay/iptal diyalogları. */
  table: Table<Roll>;
  isLoading: boolean;
  pagination: DataTablePagination;
  /** true ise dahili filtre satırı çizilmez — çağıran filtreleri kendi araç
   *  çubuğuna (ör. okutma kutusuyla aynı satıra) taşımak istiyor (Kartela). */
  hideFilterBar?: boolean;
}

/**
 * Rulo tablosunun GÖVDESİ — filtre satırı + DataTable + detay paneli + toplu iptal.
 * Tabloyu kendisi kurmaz (Sütunlar/Görünümler araçlarının konumunu çağıran seçsin
 * diye). Envanter sayfası (RollsPage) ve Kartela ("Kartelada Toplar" sekmesi)
 * tabloyu kendi üst chrome'unda kurup araçları istediği satıra (okut/ara satırı,
 * sekme şeridi vb.) yerleştirir; `hideFilterBar` ile bu gövdenin kendi filtre
 * satırı bastırılabilir.
 */
export function RollsTableBody({ tab, table, isLoading, pagination, hideFilterBar = false }: Props) {
  const [selected, setSelected] = useState<Roll | null>(null);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);

  const filters = useMemo(() => buildRollFilterDefs(tab), [tab]);

  // Toplu iptal — Ham Stok + Bitmiş Depo'da sunulur (STOCK/WAREHOUSE→CANCELLED,
  // yanlış giriş düzeltmesi). Backend softDelete WAREHOUSE'a izin verir; rezerve
  // topsa çuval/sevkiyattan da çıkarır. Seçili satırlar TanStack table state'inden okunur.
  const selectedRolls = table.getSelectedRowModel().rows.map((r) => r.original);
  const bulkCancelable = tab === "RAW_STOCK" || tab === "FINISHED_STOCK";

  return (
    <>
      {/* Filtre satırı — tarih aralığı en başta. */}
      {!hideFilterBar && (
        <FilterBar filters={filters} leading={<StandaloneDateRangeFilter def={DATE_FILTER} />} />
      )}
      <DataTable<Roll>
        table={table}
        isLoading={isLoading}
        pagination={pagination}
        emptyText="Top bulunamadı."
        onRowClick={setSelected}
        // Ham Stok'ta seçim çubuğuna "Stoktan Kaldır" (iptal) — DataTable bunu
        // alt şeride (Seçimi temizle'nin yanına) koyar; ayrı üst şerit yok.
        bulkActions={
          bulkCancelable
            ? (rows) =>
                rows.length > 0 ? (
                  <PermissionGate permission="roll:write">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1.5"
                      onClick={() => setBulkCancelOpen(true)}
                    >
                      <Trash2 className="h-4 w-4" /> Stoktan Kaldır
                    </Button>
                  </PermissionGate>
                ) : null
            : undefined
        }
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
      <BulkCancelRollsDialog
        open={bulkCancelOpen}
        onOpenChange={setBulkCancelOpen}
        rolls={selectedRolls}
        onDone={() => table.resetRowSelection()}
      />
    </>
  );
}
