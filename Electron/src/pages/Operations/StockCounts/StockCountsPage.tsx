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
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { ClipboardList, Plus, RotateCcw, Search } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { listStockCounts } from "./service";
import { NewStockCountDialog } from "./NewStockCountDialog";
import { stockCountPath } from "./stockCount-regime";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import {
  EMPTY_STOCK_COUNT_FILTERS,
  STATUS_BADGE,
  STATUS_LABEL,
  buildListQuery,
  isStockCountFilterDirty,
  stockCountEmptyMessage,
  type StockCountFilterState,
} from "./stockCountRules";

const PAGE_SIZE = 50;

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

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination.total ?? 0;
  const totalPages = q.data?.pagination.totalPages ?? 1;

  return (
    <PageShell>
      <PageHeader
        title="Stok Sayımı"
        description="Depoyu baştan sona say, defterle karşılaştır, farkı kayda geçir. Sayım açmak ve işaretlemek hiçbir deftere yazmaz — fark yalnız “Tamamla” ile kaydedilir."
        actions={
          <PermissionGate permission="warehouse:transfer">
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Yeni Sayım
            </Button>
          </PermissionGate>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Sayım no ara…"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
          />
        </div>

        {multiWarehouse && (
          <select
            aria-label="Depo"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={filters.warehouseId}
            onChange={(e) => set("warehouseId", e.target.value)}
          >
            <option value="">Tüm depolar</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Durum"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={filters.status}
          onChange={(e) => set("status", e.target.value)}
        >
          <option value="">Tüm durumlar</option>
          <option value="DRAFT">Taslak</option>
          <option value="COMPLETED">Tamamlandı</option>
          <option value="CANCELLED">İptal</option>
        </select>

        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <DateRangeInput from={filters.from} to={filters.to} onFrom={(v) => set("from", v)} onTo={(v) => set("to", v)} inputClassName="h-9 w-[9.5rem]" />
        </div>

        {isStockCountFilterDirty(filters) && (
          <Button variant="ghost" size="sm" onClick={() => apply(EMPTY_STOCK_COUNT_FILTERS)}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Filtreleri temizle
          </Button>
        )}
      </div>

      <PageBody className="p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Sayım listesi yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “sayım yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi. Yeni
              sayım açmadan önce tekrar deneyin: aynı depoda açık bir sayım varsa ikincisi
              reddedilir.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {stockCountEmptyMessage(filters)}
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Sayım No</th>
                    <th className="p-3 text-left">Açılış</th>
                    <th className="p-3 text-left">Depo</th>
                    <th className="p-3 text-right">Satır</th>
                    <th className="p-3 text-left">Durum</th>
                    <th className="p-3 text-left">Kapanış</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const closedAt = r.completedAt ?? r.cancelledAt;
                    return (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-t hover:bg-muted/40"
                        onClick={(e) => openTarget(stockCountPath(r.id), e)}
                      >
                        <td className="p-3 font-mono text-xs">{r.countNo}</td>
                        <td className="p-3">
                          {format(new Date(r.createdAt), "dd MMM yyyy HH:mm", { locale: tr })}
                        </td>
                        <td className="p-3">{r.warehouse?.name ?? "—"}</td>
                        {/* Kırılım (top/iplik) DETAYDA — listede tek sayı yeterli ve
                            iki birimi tek hücrede toplamak zaten yanlış olurdu. */}
                        <td className="p-3 text-right tabular-nums">{r._count.lines}</td>
                        <td className="p-3">
                          <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                          {r.reversedAt && (
                            <Badge variant="outline" className="ml-1">
                              Stornolandı
                            </Badge>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {closedAt ? format(new Date(closedAt), "dd MMM yyyy HH:mm", { locale: tr }) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
              <ClipboardList className="h-3 w-3" />
              {total} sayım{totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""} — satıra
              tıklayarak sayım kâğıdını açın.
            </p>

            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-end gap-2 text-sm">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || q.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Önceki
                </Button>
                <span className="text-muted-foreground">
                  Sayfa {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || q.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sonraki
                </Button>
              </div>
            )}
          </>
        )}
      </PageBody>

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
