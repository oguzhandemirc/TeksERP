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
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
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
import { YarnStockTable } from "./YarnStockTable";
import { YarnMovementsSheet } from "./YarnMovementsSheet";
import { YarnMovementDialog } from "./YarnMovementDialog";

const PAGE_SIZE = 100;

/** Diyaloğun ön-doldurması — satırdan mı, başlıktan mı açıldı. */
interface MovementDraft {
  itemId: string | null;
  warehouseId: string | null;
  kind?: YarnMovementKind;
}

export function YarnStockPage() {
  const qc = useQueryClient();
  const { multiWarehouse } = useMultiWarehouse();
  const [filters, setFilters] = useState<YarnFilterState>(EMPTY_YARN_FILTERS);
  const [page, setPage] = useState(1);
  const [detailRow, setDetailRow] = useState<YarnStockRow | null>(null);
  const [draft, setDraft] = useState<MovementDraft | null>(null);

  const { search, itemId, warehouseId, onlyNonZero } = filters;

  const q = useQuery({
    queryKey: ["yarn", "stocks", page, search, itemId ?? "", warehouseId, onlyNonZero],
    queryFn: () =>
      listYarnStocks({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        itemId: itemId ?? undefined,
        warehouseId: warehouseId || undefined,
        onlyNonZero,
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

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination.total ?? 0;
  const totalPages = q.data?.pagination.totalPages ?? 1;
  const negativeCount = rows.filter((r) => isNegative(r.balanceKg)).length;

  return (
    <PageShell>
      <PageHeader
        title="İplik Kg-Stok"
        description="İplik kg ile izlenir (top/barkod yok). Defter satırları silinmez — yanlış giriş ters kayıtla (sayım düzeltmesi) kapatılır."
        actions={
          <PermissionGate permission="yarn:write">
            <Button onClick={() => setDraft({ itemId: itemId ?? null, warehouseId: warehouseId || null })}>
              <Plus className="mr-1 h-4 w-4" />
              Hareket Ekle
            </Button>
          </PermissionGate>
        }
      />

      <YarnFilterBar value={filters} onChange={applyFilters} />

      <PageBody className="p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">İplik stok listesi yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “stok yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi. Defter yerinde
              duruyor; hareket yazmadan önce tekrar deneyin.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {/* ⚠️ Cümle saf kuraldan gelir: varsayılan süzgeç (“yalnız bakiyesi
                olanlar”) AÇIK olduğu için boş liste “hiç kayıt yok” DEMEK
                DEĞİLDİR — bkz. `yarnEmptyStateMessage`. */}
            {yarnEmptyStateMessage(filters)}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span>
                Filtre toplamı: <b className="tabular-nums">{kg(q.data?.totals.balanceKg)}</b>
              </span>
              <span className="text-muted-foreground">
                {total} satır{totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
              </span>
            </div>

            <YarnStockTable
              rows={rows}
              showWarehouse={multiWarehouse}
              onOpenMovements={setDetailRow}
              onAddMovement={(r) => setDraft({ itemId: r.item.id, warehouseId: r.warehouse.id })}
            />

            {negativeCount > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Bu sayfada <b>{negativeCount}</b> satırın bakiyesi eksi. Bu bir sistem hatası değildir:
                  açılış ya da sayım girilmeden çıkış yazıldığında defter gerçekten eksiye düşer. Düzeltmek
                  için sayım sonucunu “Sayım düzeltmesi (+)” hareketi olarak girin.
                </span>
              </div>
            )}

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
