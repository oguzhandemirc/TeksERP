import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ClipboardList, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/PermissionGate";
import { ReorderableTabBar } from "@/components/layout/ReorderableTabBar";
import { classifyBarcode, BARCODE_FORMATS } from "@/lib/scanner/barcode-kind";
import { useTabOrder } from "@/hooks/useTabOrder";
import { useDataTable } from "@/hooks/useDataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ExportMenu } from "@/components/data-table/ExportMenu";
import { exportTableToPdf, exportTableToXlsx, exportListName } from "@/lib/table-export";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { RollScanBar } from "./RollScanBar";
import { RollsTableBody } from "./RollsTableBody";
import { RollsKanban } from "./RollsKanban";
import { RollsStats } from "./RollsStats";
import { useRollStats } from "./useRollStats";
import { rollColumns } from "./columns";
import { ManualEntryDialog } from "./ManualEntryDialog";
import { RollDetailSheet } from "./RollDetailSheet";
import { useFasonScopeLabel } from "./useFasonScopeLabel";
import { RollLabelDialog } from "@/components/labels/RollLabelDialog";
import {
  rollService,
  buildRollForceFilters,
  rollTabDefaultSortBy,
  type RollStatusTabKey,
} from "./service";
import { ROLL_TABS, isRollTabKey, type RollTabKey } from "./tabs-config";
import { downloadInventorySummary } from "./inventorySummary";
import type { LabelCustomerContext } from "@/services/labelService";
import type { Roll } from "./types";

// Sekme listesi `tabs-config.ts`te — komut paleti aynı listeden `?tab=` derin
// bağlantısı üretiyor (kopyalanırsa palet ile sayfa ayrışır).
const TABS = ROLL_TABS;
const REORDERABLE_KEYS = TABS.map((t) => t.key);

export function RollsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const [tab, setTab] = useState<RollTabKey>(
    isRollTabKey(urlTab) ? urlTab : "RAW_STOCK",
  );
  const [manualOpen, setManualOpen] = useState(false);
  // Manuel giriş hangi sekmeden açıldı — Bitmiş Depo'da renk zorunlu + WAREHOUSE doğar.
  const [manualTarget, setManualTarget] = useState<"RAW_STOCK" | "FINISHED_STOCK">("RAW_STOCK");
  // "Ekle ve Etiket Bas": yeni topun etiket diyalogu (önizleme + Bas). ctx = etiket müşterisi.
  const [labelRoll, setLabelRoll] = useState<{ id: string; ctx?: LabelCustomerContext } | null>(null);
  const [scanRoll, setScanRoll] = useState<Roll | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  // "Tümünü İndir" ilerlemesi (sağ alt) — 30k'da "N / ~T" göstergesi için.
  const [dlProgress, setDlProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const { ordered, reorder } = useTabOrder("rolls", REORDERABLE_KEYS);

  // "Envanter Özeti" — her kategori için backend sayımı (top + metre) tek Excel'e.
  // Tablo-dışı KANBAN hariç tüm sekmeler; ekrandaki 100 değil GERÇEK toplamlar.
  const handleSummary = async () => {
    if (summaryBusy) return;
    setSummaryBusy(true);
    try {
      const summaryTabs = TABS.filter((t) => t.key !== "KANBAN").map((t) => ({
        key: t.key as RollStatusTabKey,
        label: t.label,
      }));
      if (await downloadInventorySummary(summaryTabs)) {
        toast.success("Envanter özeti indirildi.");
      }
    } catch {
      toast.error("Envanter özeti oluşturulamadı.");
    } finally {
      setSummaryBusy(false);
    }
  };

  // Barkod → topu getir → detay panelini aç (404 toast'ı interceptor'dan).
  // Not: okut/ara input'u + "okutunca aç" tercihi RollScanBar'a taşındı (perf:
  // tuş vuruşu artık RollsPage'i / tabloyu re-render etmez).
  const scanLookup = useMutation({
    mutationFn: (code: string) => rollService.getByBarcode(code),
    onSuccess: (res) => setScanRoll(res.data ?? null),
  });
  // Detayı aç (açık niyet: "Aç" butonu / useScanSeed navigasyonu / okutma+toggle-açık).
  // Yalnız TAM-FORMAT top barkodunda dener — gevşek /^T\d/ değil tam regex ki
  // "TEKSTİL BEYAZ" gibi kumaş adı yanlışlıkla barkod sayılıp 404 toast'ı vermesin.
  const openDetail = (code: string) => {
    if (!BARCODE_FORMATS.ROLL.test(classifyBarcode(code).code)) return;
    scanLookup.mutate(code);
  };
  const orderedTabs = ordered.flatMap((k) => {
    const t = TABS.find((x) => x.key === k);
    return t ? [t] : [];
  });

  // "Top/Metre" özeti — Üretim Akışı (KANBAN) sekmesinde rulo tablosu olmadığından
  // gizli (sorgu da kapalı). Artık sekme şeridinin sağında (Arşiv'in eski yeri).
  const statsQuery = useRollStats(tab === "KANBAN" ? null : tab);
  // Fasonda rozetinde "Fasonda" yerine seçili işlem/firmayı göster
  // ("Boyahane (Boyer Boyacılık)" / "Boyahane" / firma seçili değilse "Fasonda").
  const fasonScopeLabel = useFasonScopeLabel(tab === "SUBCONTRACTOR");

  // Rulo tablosu state'i BURADA (üst chrome ile aynı yerde) — böylece Sütunlar/
  // Görünümler araçları + "Fire" toggle okut/ara satırına konabilir (tablo örneği
  // gerekiyor). KANBAN'da tablo gösterilmez → fetch kapalı. RollsTableBody tabloyu
  // prop olarak alır (sadece gövdeyi çizer).
  const isTableTab = tab !== "KANBAN";
  const dataTable = useDataTable<Roll>({
    queryKey: `rolls:${tab}`,
    queryKeyParts: ["rolls", tab],
    fetchFn: rollService.listCursor,
    columns: rollColumns,
    defaultPageSize: 100,
    forceFilters: tab === "KANBAN" ? {} : buildRollForceFilters(tab),
    // Ham Stok dışındaki sekmelerde "buraya geliş" ≠ "oluşturma" → son hareket
    // sıralaması (bkz. rollTabDefaultSortBy). Kolon başlığına basınca URL kazanır.
    defaultSortBy: tab === "KANBAN" ? undefined : rollTabDefaultSortBy(tab),
    // Fason sütunları ("İşlem" + "Fason Firması") yalnız Fasonda sekmesinde
    // default açık; diğer sekmelerde gizli başlar (Sütunlar'dan açılabilir,
    // hücre "—" gösterir — veri yalnız AT_SUBCONTRACTOR'da dolar).
    // "Son Hareket" kolonu YALNIZ ona göre sıralanan sekmelerde açık — sıralama
    // kolonu görünmezse "eski tarihli top neden en üstte?" karışıklığı doğuyor.
    // Ham Stok'ta giriş = oluşturma olduğundan gereksiz, gizli başlar.
    initialVisibility: {
      // Fason sütunları yalnız Fasonda sekmesinde açık.
      ...(tab === "SUBCONTRACTOR"
        ? {}
        : { subcontractorCategory: false, subcontractor: false }),
      // TEK tarih kolonu görünür: sıralanan kolonun aynısı. Ham Stok'ta giriş =
      // oluşturma olduğu için orada "Giriş", diğerlerinde "Son İşlem" gösterilir —
      // iki tarih birlikte gösterilmez (operatörü karıştırıyor).
      updatedAt: tab !== "RAW_STOCK",
      createdAt: tab === "RAW_STOCK",
      // İZLENEBİLİRLİK sütunları varsayılan GİZLİ (2026-08-05 kullanıcı kararı).
      // Gerekçe envanter listesi standardı: liste yüzeyi operatörün ANLIK
      // kararı için sade kalır, izlenebilirlik verisi ihtiyaç duyanın açtığı
      // sütunda ve detay panelinde durur. Tercih kaydedilir (Görünümler) —
      // her açılışta tekrar açmak gerekmez.
      entrySource: false,
      createdBy: false,
      entryStation: false,
    },
    enabled: isTableTab,
  });

  // Sağ alttaki "Tümünü İndir" — aktif sekmenin (filtreli) SUNUCUDAKİ TÜM kayıtlarını
  // PDF/Excel indirir (ekrandaki 100 değil). İlerleme sağ altta "N / ~T" görünür.
  const handleExportAll = async (kind: "pdf" | "excel") => {
    setDlProgress(null);
    try {
      const rows = await dataTable.fetchAll((loaded, total) => setDlProgress({ loaded, total }));
      if (rows.length === 0) {
        toast.info("İndirilecek kayıt yok.");
        return;
      }
      const name = exportListName("Envanter");
      if (kind === "pdf") await exportTableToPdf(dataTable.table, rows, name);
      else await exportTableToXlsx(dataTable.table, rows, name);
    } catch {
      toast.error("İndirme hazırlanamadı.");
    } finally {
      setDlProgress(null);
    }
  };

  // "Fire kaliteyi de göster" — URL filter[includeFire]; tablo + özet ikisi de okur.
  const includeFire = searchParams.get("filter[includeFire]") === "true";
  const toggleIncludeFire = (next: boolean) => {
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("filter[includeFire]", "true");
    else sp.delete("filter[includeFire]");
    setSearchParams(sp, { replace: true });
  };

  // Fason chip/kart filtreleri yalnız Fasonda sekmesinde anlamlı — sekmeden
  // ayrılırken URL'den temizle (başka sekmede dispatch-bazlı filtre listeyi
  // sessizce yanlış daraltırdı).
  const selectTab = (next: RollTabKey) => {
    if (tab === "SUBCONTRACTOR" && next !== "SUBCONTRACTOR") {
      const sp = new URLSearchParams(searchParams);
      if (sp.has("filter[subcontractorId]") || sp.has("filter[subcontractorCategoryId]")) {
        sp.delete("filter[subcontractorId]");
        sp.delete("filter[subcontractorCategoryId]");
        setSearchParams(sp, { replace: true });
      }
    }
    setTab(next);
  };

  // Dashboard'tan `?tab=...` ile gelindiğinde initial state ile senkron;
  // URL'i temizle ki sekme değişimi geri-tuş davranışına karışmasın.
  useEffect(() => {
    if (!urlTab) return;
    if (isRollTabKey(urlTab) && urlTab !== tab) setTab(urlTab);
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);

  return (
    <PageShell>
      <PageHeader
        title="Envanter"
        actions={
          <>
            {/* Y2 fix: tablo key'leri artık ["rolls", tab] array formunda —
                aktif sekmeyi hedefli tazele; KANBAN'da ["rolls"] hepsini kapsar. */}
            <RefreshButton
              queryKey={tab === "KANBAN" ? ["rolls"] : ["rolls", tab]}
            />
            {(tab === "RAW_STOCK" || tab === "FINISHED_STOCK") && (
              <PermissionGate permission="roll:write">
                <Button
                  size="sm"
                  onClick={() => {
                    setManualTarget(tab === "FINISHED_STOCK" ? "FINISHED_STOCK" : "RAW_STOCK");
                    setManualOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> Manuel Top Ekle
                </Button>
              </PermissionGate>
            )}
          </>
        }
      />
      <ManualEntryDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        target={manualTarget}
        onCreatedForPrint={(id, ctx) => setLabelRoll({ id, ctx })}
      />
      <RollLabelDialog
        rollId={labelRoll?.id ?? null}
        onOpenChange={(o) => !o && setLabelRoll(null)}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        {/* Okut/ara kutusu + "Aç" + toggle — izole alt bileşen (perf: tuş vuruşu
            tabloyu re-render etmesin). */}
        <RollScanBar openDetail={openDetail} scanPending={scanLookup.isPending} />
        {/* Tablo araçları (Sütunlar/Görünümler) + "Fire" toggle okut/ara satırında,
            en sağda. KANBAN'da rulo tablosu yok → gizli. */}
        {isTableTab && (
          <div className="ml-auto flex items-center gap-2">
            <DataTableTools table={dataTable.table} hideExport />
            <SavedViewsMenu />
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={includeFire}
                onCheckedChange={(v) => toggleIncludeFire(v === true)}
              />
              Fire kaliteyi de göster
            </label>
          </div>
        )}
      </div>
      <RollDetailSheet
        roll={scanRoll}
        open={Boolean(scanRoll)}
        onOpenChange={(o) => !o && setScanRoll(null)}
      />
      <ReorderableTabBar
        tabs={orderedTabs}
        activeKey={tab}
        onSelect={(k) => selectTab(k as RollTabKey)}
        onReorder={reorder}
        // "Top/Metre" özeti şeridin sağında (Arşiv'in eski yeri).
        trailing={
          isTableTab ? (
            <RollsStats
              data={statsQuery.data?.data}
              isLoading={statsQuery.isLoading}
              scopeLabel={
                tab === "SUBCONTRACTOR"
                  ? fasonScopeLabel ?? "Fasonda"
                  : TABS.find((t) => t.key === tab)?.label ?? ""
              }
            />
          ) : undefined
        }
      />
      {tab === "KANBAN" ? (
        <RollsKanban />
      ) : (
        <RollsTableBody
          tab={tab}
          table={dataTable.table}
          isLoading={dataTable.query.isLoading}
          pagination={dataTable.pagination}
          exportName="Envanter"
          paginationActions={
            <>
              <ExportMenu
                label="Tümünü İndir"
                busyLabel={
                  dlProgress
                    ? `${dlProgress.loaded.toLocaleString("tr-TR")}${
                        dlProgress.total ? ` / ~${dlProgress.total.toLocaleString("tr-TR")}` : ""
                      } indiriliyor…`
                    : undefined
                }
                onPdf={() => handleExportAll("pdf")}
                onExcel={() => handleExportAll("excel")}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5"
                onClick={handleSummary}
                disabled={summaryBusy}
                title="Tüm kategorilerin gerçek top/metre sayımını Excel indir"
              >
                {summaryBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ClipboardList className="h-3.5 w-3.5" />
                )}
                Envanter Özeti
              </Button>
            </>
          }
        />
      )}
    </PageShell>
  );
}
