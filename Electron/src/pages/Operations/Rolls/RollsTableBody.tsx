import { useMemo, useState, type ReactNode } from "react";
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
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import { RollDetailSheet } from "./RollDetailSheet";
import { BulkCancelRollsDialog } from "./BulkCancelRollsDialog";
import type { RollStatusTabKey } from "./service";
import { stationService } from "@/pages/Stations/service";
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
    label: "Kumaş",
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
  // KAT — backend değeri KANONİKLEŞTİRİLMİŞ tutuyor ("4-KAT"); serbest metin
  // göndermek sessizce 0 sonuç verirdi, o yüzden seçenekli filtre.
  {
    kind: "select",
    key: "foldType",
    label: "Kat",
    options: [
      { value: "2-KAT", label: "2 Kat" },
      { value: "4-KAT", label: "4 Kat" },
    ],
  },
  // GİRİŞ KAYNAĞI (2026-08-04): "elle eklenen toplar" tek filtreyle çıksın.
  // Zincir-dışı doğan topları (Tambur manuel / Electron manuel) saymak ve
  // sebeplerine bakmak için — manuel giriş bir semptomdur, ölçülmeden
  // kaynağındaki sorun (etiket kopması, kayıt atlanması) çözülemez.
  // Backend filtresi HAZIRDI: buildWhereClause düz Roll alanlarını geçiriyor.
  {
    kind: "select",
    key: "entrySource",
    label: "Giriş Kaynağı",
    options: [
      { value: "SUPPLIER_RECEIPT", label: "Ham Giriş" },
      { value: "TAMBUR_SPLIT", label: "Tambur Kesim" },
      { value: "SUBCONTRACTOR_RETURN", label: "Fason Dönüşü" },
      { value: "TAMBUR_MANUAL", label: "Tambur (Manuel)" },
      { value: "MANUAL_ENTRY", label: "Manuel Giriş" },
    ],
  },
  // İSTASYON (2026-08-05): "şu makinede ne var" sorusu. Backend
  // filter[currentStationId] ile karşılanıyor — o blok bu filtre için yazıldı;
  // öncesinde yalnız istasyon TÜRÜ filtresi vardı (currentStepKind) ve o da
  // kullanıcıya hiç açılmamıştı, yalnız sabit sekmelerde kullanılıyordu.
  //
  // Tür değil KİMLİK filtreleniyor: tür iki ayrı boyahaneyi tek seçenekte
  // birleştirirdi, oysa operatör belirli bir makineyi soruyor.
  {
    kind: "lookup",
    key: "currentStationId",
    label: "İstasyon",
    service: stationService,
    queryKey: "stations",
  },
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

// Yalnız "Fasonda" sekmesi: aktif fason sevkine göre firma + işlem (kategori)
// daraltması. Özet şeridi chip/kartları da AYNI filter anahtarlarına yazar —
// FilterBar dropdown'ı ile chip seçimi tek URL state'inde buluşur.
const FASON_FILTERS: FilterDef[] = [
  {
    kind: "lookup",
    key: "subcontractorId",
    label: "Fason Firması",
    service: subcontractorService,
    queryKey: "subcontractors",
  },
  {
    kind: "lookup",
    key: "subcontractorCategoryId",
    label: "İşlem",
    service: subcontractorCategoryService,
    queryKey: "subcontractor-categories",
  },
];

// Serbest/rezerve filtresi yalnız depo (Bitmiş Depo); fason filtreleri yalnız Fasonda.
export function buildRollFilterDefs(tab: RollStatusTabKey): FilterDef[] {
  if (tab === "FINISHED_STOCK") return [...FILTERS, SHIPMENT_SCOPE_FILTER];
  if (tab === "SUBCONTRACTOR") return [...FILTERS, ...FASON_FILTERS];
  return FILTERS;
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
  /** Seçili satırların PDF/Excel indirme dosya adı öneki (ör. "Envanter"). Verilmezse
   *  DataTable varsayılanı ("Liste") kullanılır. */
  exportName?: string;
  /** Sayfalama çubuğunun sağına eklenen aksiyonlar ("Tümünü İndir" + "Envanter Özeti"). */
  paginationActions?: ReactNode;
}

/**
 * Rulo tablosunun GÖVDESİ — filtre satırı + DataTable + detay paneli + toplu iptal.
 * Tabloyu kendisi kurmaz (Sütunlar/Görünümler araçlarının konumunu çağıran seçsin
 * diye). Envanter sayfası (RollsPage) ve Kartela ("Kartelada Toplar" sekmesi)
 * tabloyu kendi üst chrome'unda kurup araçları istediği satıra (okut/ara satırı,
 * sekme şeridi vb.) yerleştirir; `hideFilterBar` ile bu gövdenin kendi filtre
 * satırı bastırılabilir.
 */
export function RollsTableBody({ tab, table, isLoading, pagination, hideFilterBar = false, exportName, paginationActions }: Props) {
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
        paginationActions={paginationActions}
        emptyText="Top bulunamadı."
        exportName={exportName}
        // Seçim çubuğunda ipucu metni yok (sevkiyat ekranlarıyla tutarlı) — "Seçili
        // PDF/Excel" ve varsa "Stoktan Kaldır" butonları zaten kendini anlatıyor.
        selectionHint={null}
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
