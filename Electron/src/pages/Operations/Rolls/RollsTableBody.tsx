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
import { useFoldValues } from "@/hooks/useFoldValues";
import type { Roll } from "./types";

/** Kat filtresinin yer tutucusu — seçenekleri `buildRollFilterDefs` doldurur. */
const FOLD_FILTER_PLACEHOLDER: FilterDef = {
  kind: "multi-select",
  key: "foldType",
  label: "Kat",
  options: [],
};

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
  // Kumaş/renk ÇOKLU (VEYA): "patos VEYA saten", "mavi VEYA kırmızı". Backend
  // `buildRollWhere` CSV'yi `readIdCondition` ile `in`'e çevirir; iki filtre
  // birlikte verilirse AND'lenir (kesişim) — `/rolls/stats` de aynı where'i
  // paylaştığı için sayaçlar listeyle tutarlı kalır.
  {
    kind: "multi-lookup",
    key: "itemId",
    label: "Kumaş",
    service: itemService,
    queryKey: "items",
  },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    kind: "multi-lookup",
    key: "propertyIds",
    label: "Özellik",
    service: fabricPropertyService,
    queryKey: "fabric-properties",
  },
  { kind: "numberRange", key: "width", label: "En", unit: "cm" },
  { kind: "numberRange", key: "qty", label: "Boy", unit: "mt" },
  // KAT — seçenekler KATALOGDAN enjekte edilir (aşağıdaki `buildRollFilterDefs`).
  // Sabit liste, panelden eklenen 6-KAT'ı filtrede GÖRÜNMEZ yapardı ve backend
  // değeri kanonik tuttuğu için serbest metin de sessizce 0 sonuç verirdi.
  // Buradaki `options` yer tutucudur; boşsa filtre HİÇ ÇİZİLMEZ.
  FOLD_FILTER_PLACEHOLDER,
  // GİRİŞ KAYNAĞI (2026-08-04): "elle eklenen toplar" tek filtreyle çıksın.
  // Zincir-dışı doğan topları (Tambur manuel / Electron manuel) saymak ve
  // sebeplerine bakmak için — manuel giriş bir semptomdur, ölçülmeden
  // kaynağındaki sorun (etiket kopması, kayıt atlanması) çözülemez.
  // Backend filtresi HAZIRDI: buildWhereClause düz Roll alanlarını geçiriyor.
  {
    // ÇOKLU: "elle eklenen toplar" iki kaynağa birden dağılıyor (Tambur manuel +
    // Electron manuel) — tek seçimle sayılamıyordu.
    kind: "multi-select",
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
  //
  // ÇOKLU: "iki boyahanede ne var" tek sorguda. ⚠️ Backend bu alanı UUID
  // regex'inden geçiriyor; süzgeç LİSTENİN HER ELEMANINA uygulanmazsa filtre
  // sessizce düşer ve liste FİLTRESİZ döner (bekçi ölçümü: 2 yerine 6 satır).
  {
    kind: "multi-lookup",
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
// Firma/işlem ÇOKLU: her biri kendi içinde VEYA, ikisi arasında AND — yani
// "seçili firmalardan birindeki, seçili işlemlerden birini gören toplar".
const FASON_FILTERS: FilterDef[] = [
  {
    kind: "multi-lookup",
    key: "subcontractorId",
    label: "Fason Firması",
    service: subcontractorService,
    queryKey: "subcontractors",
  },
  {
    kind: "multi-lookup",
    key: "subcontractorCategoryId",
    label: "İşlem",
    service: subcontractorCategoryService,
    queryKey: "subcontractor-categories",
  },
];

// Serbest/rezerve filtresi yalnız depo (Bitmiş Depo); fason filtreleri yalnız Fasonda.
//
// `foldOptions` katalogdan gelir (`useFoldValues`). BOŞ ise kat filtresi listeden
// DÜŞÜRÜLÜR: seçeneksiz bir çoklu-seçim kutusu, kullanıcıya tıklayıp hiçbir şey
// bulamayacağı ölü bir kontrol vaat eder.
export function buildRollFilterDefs(
  tab: RollStatusTabKey,
  foldOptions: { value: string; label: string }[] = [],
): FilterDef[] {
  // `kind` ile daralt: FilterDef bir union ve `dateRange` varyantında `key` YOK
  // (düz `f.key` derlenmez).
  const base = FILTERS.flatMap<FilterDef>((f) => {
    if (f.kind !== "multi-select" || f.key !== "foldType") return [f];
    return foldOptions.length > 0 ? [{ ...f, options: foldOptions }] : [];
  });
  if (tab === "FINISHED_STOCK") return [...base, SHIPMENT_SCOPE_FILTER];
  if (tab === "SUBCONTRACTOR") return [...base, ...FASON_FILTERS];
  return base;
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

  const { values: foldValues } = useFoldValues();
  const filters = useMemo(
    () => buildRollFilterDefs(tab, foldValues.map((v) => ({ value: v.code, label: v.name }))),
    [tab, foldValues],
  );

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
