// =============================================================================
// İPLİK KG-STOK
// =============================================================================
// NEDEN AYRI EKRAN: iplik `Roll` DEĞİLDİR. Top metreyle ölçülür, barkodlanır,
// kesilir ve tek tek izlenir; iplik kg ile gelir, çuvaldan çuvala karışır ve tek
// tek izlenmez. Bu yüzden ipliğin kendi defteri (`YarnStock` + `YarnMovement`)
// ve kendi ekranı var; Toplar ekranında görünmez ve görünmemeli.
//
// ⚠️ EKSİ BAKİYE HATA DEĞİLDİR. Açılış/sayım girilmeden çıkış yazıldıysa defter
// gerçekten eksidir. Sıfıra kırpmak eksiği gizleyip envanteri sessizce
// yanlışlar; kırmızı "hata" rozeti ise operatörü olmayan bir arıza aramaya
// gönderir. Doğru cevap: GÖRÜNÜR yap, nötr uyar, ne yapılacağını söyle.
//
// ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR. İstek düşerse (modül kapalı, izin
// yok, sunucuya ulaşılamıyor) elimizde boş bir dizi kalır ve onu "stok yok" diye
// basmak DÜPEDÜZ YALANDIR — kullanıcı ipliğin bitmiş olduğu sonucuna varır ve
// gereksiz sipariş açar. Interceptor'ın toast'ı birkaç saniyede kaybolur;
// ekranda kalan cümle doğruyu söylemek zorunda (2026-08-12 FilterBar vakası).
//
// ⚠️ SÜZME SUNUCUDA. Liste sayfalıdır; istemcide süzmek yalnız O ANKİ SAYFAYI
// süzer ve kullanıcı "kayıt yok" sanır — oysa kayıt sonraki sayfadadır.
//
// ⚠️ SAYFALAMA GİZLENMEZ. Kalem × depo satırı ürün kataloğu büyüdükçe artar ve
// tek sayfaya sığmayabilir; kırpmayı sessizce yapmak "o iplik sistemde yok"
// diye okunur. Sayfa göstergesi ve ileri/geri düğmeleri bu yüzden her zaman
// (tek sayfada bile) sayıyı yazar.
//
// ⚠️ REJİM: bu ekran TİCARET paketine aittir. Menü görünürlüğü saf yüklemle
// verilir (`yarn-regime.isYarnStockVisible`); asıl sed backend'dedir
// (`yarn.routes.ts` her uçta önce `requireFinanceEnabled`). Okuma
// `warehouse:read` — iplik stoğu bir DEPO sorusudur ("depoda ne var") ve ayrı
// bir `yarn:read` açmak, kurulumda atanması unutulacak bir adım daha demekti.
// YAZMA ayrı yetkidir (`yarn:write`): hareket yazmak defteri değiştirir.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { ListFooter } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { listYarnStocks, type YarnMovementKind, type YarnStockRow } from "./service";
import { isNegative, kg } from "./qty";
import {
  EMPTY_YARN_FILTERS,
  YarnFilterBar,
  yarnEmptyStateMessage,
  type YarnFilterState,
} from "./YarnFilterBar";
import { YarnBelowMinNote, YarnStockTable, useYarnStockTable } from "./YarnStockTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { YarnMovementsSheet } from "./YarnMovementsSheet";
import { YarnMovementDialog } from "./YarnMovementDialog";
import { YarnLotsPanel } from "./YarnLotsPanel";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";

const PAGE_SIZE = 100;

/** Diyaloğun ön-doldurması — satırdan mı, başlıktan mı açıldı. */
interface MovementDraft {
  itemId: string | null;
  warehouseId: string | null;
  kind?: YarnMovementKind;
}

/** Sekme gövdesi: kalan yüksekliği doldurur; içindeki ListBody tek kaydırıcıdır. */
const TAB_PANE = "mt-0 flex min-h-0 flex-1 flex-col";

export function YarnStockPage() {
  const qc = useQueryClient();
  const { multiWarehouse } = useMultiWarehouse();
  const [filters, setFilters] = useState<YarnFilterState>(EMPTY_YARN_FILTERS);
  const [page, setPage] = useState(1);
  const [detailRow, setDetailRow] = useState<YarnStockRow | null>(null);
  const [draft, setDraft] = useState<MovementDraft | null>(null);
  const [tab, setTab] = useState<"stok" | "lotlar">("stok");
  const [creatingLot, setCreatingLot] = useState(false);

  const { search, itemId, warehouseId, onlyNonZero, belowMin } = filters;

  const q = useQuery({
    queryKey: ["yarn", "stocks", page, search, itemId ?? "", warehouseId, onlyNonZero, belowMin],
    queryFn: () =>
      listYarnStocks({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        itemId: itemId ?? undefined,
        warehouseId: warehouseId || undefined,
        onlyNonZero,
        belowMin,
      }),
  });

  // Filtre değişince sayfa 1'e döner — aksi halde 3. sayfadayken daraltma yapan
  // kullanıcı, sonuç 1 sayfaya sığdığı için BOŞ liste görür ve "kayıt yok" sanır.
  const applyFilters = (next: YarnFilterState) => {
    setFilters(next);
    setPage(1);
  };

  // Hareket defteri hem bakiyeyi hem dökümü oynatır → dar invalidate ekranın bir
  // yarısını bayat bırakır (kullanıcı yeni satırı görür, bakiye eskidir).
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["yarn"] });

  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const table = useYarnStockTable(rows, multiWarehouse, {
    onOpenMovements: setDetailRow,
    onAddMovement: (r) => setDraft({ itemId: r.item.id, warehouseId: r.warehouse.id }),
  });
  const total = q.data?.pagination.total ?? 0;
  const totalPages = q.data?.pagination.totalPages ?? 1;
  const negativeCount = rows.filter((r) => isNegative(r.balanceKg)).length;

  return (
    <PageShell>
      <PageHeader
        title="İplik Stoğu"
        description="İplik kg ile izlenir (top/barkod yok). Defter satırları silinmez — yanlış giriş ters kayıtla (sayım düzeltmesi) kapatılır."
        actions={
          <div className="flex flex-wrap gap-2">
            <RefreshButton queryKey="yarn" />
            <PermissionGate permission="yarn:write">
              {tab === "lotlar" ? (
                <Button onClick={() => setCreatingLot(true)}>
                  <Plus className="mr-1 h-4 w-4" />
                  Lot Aç
                </Button>
              ) : (
                <Button onClick={() => setDraft({ itemId: itemId ?? null, warehouseId: warehouseId || null })}>
                  <Plus className="mr-1 h-4 w-4" />
                  Hareket Ekle
                </Button>
              )}
            </PermissionGate>
          </div>
        }
      />

      {/* Devere Faz 2: "Lotlar" sekmesi — lot kaydı bayraksız her kurulumda mümkün (sekme hep çizilir). */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "stok" | "lotlar")} className="flex min-h-0 flex-1 flex-col">
        <PageTabsList>
            <PageTabsTrigger value="stok">Stok</PageTabsTrigger>
            <PageTabsTrigger value="lotlar">Lotlar</PageTabsTrigger>
        </PageTabsList>
        <TabsContent value="lotlar" className={TAB_PANE}>
          <YarnLotsPanel creating={creatingLot} onCreatingChange={setCreatingLot} />
        </TabsContent>
        <TabsContent value="stok" className={TAB_PANE}>
      <YarnFilterBar value={filters} onChange={applyFilters} tools={<DataTableTools table={table} compact exportName="İplik stoğu" />} />

      {/* ⚠️ Boş cümle saf kuraldan (`yarnEmptyStateMessage`): varsayılan filtre ("yalnız bakiyesi olanlar") AÇIK
          olduğu için boş liste "hiç kayıt yok" DEMEK DEĞİLDİR. Hata satırı boş durumun önünde (DataTable). */}
      <YarnStockTable
        table={table}
        onOpenMovements={setDetailRow}
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="İplik stok listesi yüklenemedi. Defter yerinde duruyor; hareket yazmadan önce tekrar deneyin."
        onRetry={() => void q.refetch()}
        emptyText={yarnEmptyStateMessage(filters)}
      />
        <ListFooter
          loaded={rows.length}
          label={
            <span className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="text-foreground">
                Filtre toplamı: <b className="tabular-nums">{kg(q.data?.totals.balanceKg)}</b>
              </span>
              <span>
                {total} satır{totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
              </span>
              {/* Eksi bakiye hata değildir (dosya başı): görünür kalır, açıklaması ipucunda. */}
              {negativeCount > 0 && (
                <span
                  className="flex items-center gap-1 text-amber-700 dark:text-amber-400"
                  title="Bu bir sistem hatası değildir: açılış ya da sayım girilmeden çıkış yazıldığında defter gerçekten eksiye düşer. Düzeltmek için sayım sonucunu “Sayım düzeltmesi (+)” hareketi olarak girin."
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {negativeCount} satır eksi bakiye
                </span>
              )}
              <YarnBelowMinNote count={q.data?.totals.belowMinItemCount} />
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
        </TabsContent>
      </Tabs>

      <YarnMovementsSheet
        row={detailRow}
        onClose={() => setDetailRow(null)}
        showWarehouse={multiWarehouse}
        onAddMovement={(r) => setDraft({ itemId: r.item.id, warehouseId: r.warehouse.id })}
      />

      {/* Diyalog KOŞULLU mount edilir: her açılış taze bileşen demektir ve
          ön-doldurma yalnız başlangıç değeri olarak kalır (kullanıcının
          değiştirdiği kalem/depo bir sonraki render'da geri alınmaz). */}
      {draft && (
        <YarnMovementDialog
          open
          onOpenChange={(o) => !o && setDraft(null)}
          initialItemId={draft.itemId}
          initialWarehouseId={draft.warehouseId}
          initialKind={draft.kind}
          onCreated={invalidate}
        />
      )}
    </PageShell>
  );
}
