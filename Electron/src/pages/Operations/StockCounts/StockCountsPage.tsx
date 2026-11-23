// =============================================================================
// STOK SAYIMI — LİSTE
// =============================================================================
// Sayım üç durumlu bir BELGEDİR: taslak (çalışma kâğıdı) → tamamlandı (fark fişi
// + donmuş tutanak) ya da iptal. Liste bu üçünü de gösterir ve rozetle ayırır;
// iptal/tamamlanmış satırlar GİZLENMEZ — "geçen ay ne saydık" sorusunun cevabı
// onlarda.
//
// ⚠️ REJİM: bu ekran TİCARET paketine aittir. Menü/palet görünürlüğü saf
// yüklemle verilir (`stockCount-regime.isStockCountVisible`); asıl sed
// backend'dedir (`stock-count.routes.ts` router'ın tamamına
// `requireFinanceEnabled`). Route açık kalır — kural görünürlüktür, erişim
// engeli değil.
//
// ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR. İstek düşerse (modül kapalı, izin
// yok, sunucuya ulaşılamıyor) elimizde boş bir dizi kalır ve onu "sayım yok"
// diye basmak yalandır — kullanıcı açık bir sayım varken ikincisini açmaya
// çalışır ve 409'un sebebini anlamaz.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus, RotateCcw } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { useLocalTable } from "@/hooks/useLocalTable";
import { STOCK_COUNT_COLUMNS } from "./StockCountTable";
import { PermissionGate } from "@/components/PermissionGate";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { listStockCounts } from "./service";
import { NewStockCountDialog } from "./NewStockCountDialog";
import { stockCountPath } from "./stockCount-regime";
import {
  EMPTY_STOCK_COUNT_FILTERS,
  buildListQuery,
  isStockCountFilterDirty,
  stockCountEmptyMessage,
  type StockCountFilterState,
} from "./stockCountRules";

const PAGE_SIZE = 50;
const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Taslak" },
  { value: "COMPLETED", label: "Tamamlandı" },
  { value: "CANCELLED", label: "İptal" },
] as const;

export function StockCountsPage() {
  const openTarget = useOpenTarget();
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const [filters, setFilters] = useState<StockCountFilterState>(EMPTY_STOCK_COUNT_FILTERS);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);

  const query = buildListQuery(filters);
  const q = useQuery({
    // Anahtar SORGUDAN türer, ham süzgeç durumundan değil: iki farklı süzgeç
    // aynı sorguya çözülüyorsa (ör. bozuk tarih → parametre yok) aynı cache
    // satırını paylaşmaları DOĞRUDUR.
    queryKey: ["stock-counts", page, query],
    queryFn: () => listStockCounts({ page, pageSize: PAGE_SIZE, ...query }),
  });

  const apply = (next: StockCountFilterState) => {
    setFilters(next);
    // Filtre değişince sayfa 1'e döner — aksi halde 3. sayfadayken daraltma
    // yapan kullanıcı boş liste görür ve "kayıt yok" sanır.
    setPage(1);
  };
  const set = <K extends keyof StockCountFilterState>(key: K, v: StockCountFilterState[K]) =>
    apply({ ...filters, [key]: v });

  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const table = useLocalTable({ tableKey: "stock-count:list", data: rows, columns: STOCK_COUNT_COLUMNS });
  const total = q.data?.pagination.total ?? 0;
  const totalPages = q.data?.pagination.totalPages ?? 1;

  return (
    <PageShell>
      <PageHeader
        title="Stok Sayımı"
        description="Depoyu baştan sona say, defterle karşılaştır, farkı kayda geçir. Sayım açmak ve işaretlemek hiçbir deftere yazmaz — fark yalnız “Tamamla” ile kaydedilir."
        actions={
          <div className="flex flex-wrap gap-2">
            <RefreshButton queryKey="stock-counts" />
            <PermissionGate permission="warehouse:transfer">
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni Sayım
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={filters.search} onSearchChange={(v) => set("search", v)} searchHint="Sayım no ara" />
        {multiWarehouse && (
          <SelectChip
            id="stock-count-warehouse"
            label="Depo"
            value={filters.warehouseId || null}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            onChange={(v) => set("warehouseId", v ?? "")}
          />
        )}
        <SelectChip
          id="stock-count-status"
          label="Durum"
          value={filters.status || null}
          options={STATUS_OPTIONS}
          onChange={(v) => set("status", v ?? "")}
        />
        <DayRangeChip id="stock-count-date" label="Tarih" from={filters.from} to={filters.to} onChange={(r) => apply({ ...filters, ...r })} />
        {isStockCountFilterDirty(filters) && (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => apply(EMPTY_STOCK_COUNT_FILTERS)}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Filtreleri temizle
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Stok sayımları" />
        </div>
      </ListToolbar>

      {/* Hata satırı boş durumun önünde (DataTable): "sayım yok" sanan kullanıcı ikinci sayımı açmaya çalışır, 409 alır. */}
      <DataTable
        table={table}
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Sayım listesi yüklenemedi. Yeni sayım açmadan önce tekrar deneyin: aynı depoda açık bir sayım varsa ikincisi reddedilir."
        onRetry={() => void q.refetch()}
        onRowClick={(r, click) => openTarget(stockCountPath(r.id), click)}
        exportName="Stok sayımları"
        emptyText={stockCountEmptyMessage(filters)}
      />
      <ListFooter
          loaded={rows.length}
          label={
            <span className="flex items-center gap-1">
              <ClipboardList className="h-3 w-3" />
              {total} sayım{totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
            </span>
          }
        >
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7" disabled={page <= 1 || q.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Önceki
              </Button>
              <span>
                Sayfa {page} / {totalPages}
              </span>
              <Button variant="outline" size="sm" className="h-7" disabled={page >= totalPages || q.isFetching} onClick={() => setPage((p) => p + 1)}>
                Sonraki
              </Button>
            </div>
          )}
        </ListFooter>

      {/* Diyalog KOŞULLU mount edilir: her açılış taze bileşen demektir (depo/not
          alanları önceki denemeden kalmaz). */}
      {formOpen && (
        <NewStockCountDialog
          open
          onOpenChange={setFormOpen}
          onCreated={(id) => openTarget(stockCountPath(id))}
        />
      )}
    </PageShell>
  );
}
