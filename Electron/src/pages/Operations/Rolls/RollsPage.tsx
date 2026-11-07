import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ClipboardList, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DemoBar } from "@/components/demo/DemoBar";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { ReorderableTabBar } from "@/components/layout/ReorderableTabBar";
import { classifyBarcode, matchesFullFormat } from "@/lib/scanner/barcode-kind";
import { useTabOrder } from "@/hooks/useTabOrder";
import { useDataTable } from "@/hooks/useDataTable";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ExportMenu } from "@/components/data-table/ExportMenu";
import { useTableExportAll } from "@/hooks/useTableExportAll";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { RollScanBar } from "./RollScanBar";
import { UrlFlagToggle } from "./UrlFlagToggle";
import { RollsTableBody } from "./RollsTableBody";
import { KARTELA_MARKED_PARAM, useRollFilterDefs } from "./roll-filter-defs";
import { RollsFilterRow, rollPersistConfig } from "./RollsFilterRow";
import { FILTER_ROW_CLASS } from "@/components/data-table/filter-row/FilterRow";
import { RollsKanban } from "./RollsKanban";
import { RollsStats } from "./RollsStats";
import { useRollStats } from "./useRollStats";
import { makeRollColumns } from "./columns";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { loadAllForPicker } from "@/lib/picker-loader";
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
import { isRollTabKey, orderRollTabsByGroup, type RollTabKey } from "./tabs-config";
import { resolveRollTabs } from "./tabs-regime";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { downloadInventorySummary } from "./inventorySummary";
import type { LabelCustomerContext } from "@/services/labelService";
import type { Roll } from "./types";

// Sekme listesi `tabs-config.ts`te — komut paleti aynı listeden `?tab=` derin
// bağlantısı üretiyor (kopyalanırsa palet ile sayfa ayrışır).
export function RollsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const [tab, setTab] = useState<RollTabKey>(
    isRollTabKey(urlTab) ? urlTab : "RAW_STOCK",
  );
  const [manualOpen, setManualOpen] = useState(false);
  // Manuel giriş hangi sekmeden açıldı — hedef statüyü ve ön ayarları belirler:
  // Bitmiş Depo'da renk zorunlu + WAREHOUSE doğar; Yarı Mamul'de yarı mamul kutusu
  // ön-işaretli gelir (renk zorunlu, top ham stokta kalır).
  const [manualTarget, setManualTarget] =
    useState<"RAW_STOCK" | "SEMI_FINISHED" | "FINISHED_STOCK">("RAW_STOCK");
  // "Ekle ve Etiket Bas": yeni topun etiket diyalogu (önizleme + Bas). ctx = etiket müşterisi.
  const [labelRoll, setLabelRoll] = useState<{ id: string; ctx?: LabelCustomerContext } | null>(null);
  const [scanRoll, setScanRoll] = useState<Roll | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  // "Tümünü İndir" ilerlemesi (sağ alt) — 30k'da "N / ~T" göstergesi için.
  const [dlProgress, setDlProgress] = useState<{ loaded: number; total?: number } | null>(null);
  // TİCARET REJİMİ: üretim sekmeleri süzülür, depo etiketleri değişir.
  // ⚠️ Şerit, "Kumaş Stoğu Özeti" indirmesi ve sekme sırası AYNI listeyi okur —
  // biri ham `ROLL_TABS`e dönerse ticaret kullanıcısına gizlenen sekme geri
  // gelir (ya da özet Excel'i tanım gereği boş sayfalar üretir).
  const flags = useFeatureFlags().data?.data;
  const financeEnabled = flags?.financeEnabled ?? false;
  // ⚠️ Varsayılan TRUE: ayar hiç yazılmamış bir kurulumda (ve bayrak henüz
  // yüklenmemişken) fabrika sekmelerini kaybetmemeli.
  const productionEnabled = flags?.productionEnabled ?? true;
  const TABS = useMemo(
    () => resolveRollTabs(productionEnabled, financeEnabled),
    [productionEnabled, financeEnabled],
  );
  const REORDERABLE_KEYS = useMemo(() => TABS.map((t) => t.key), [TABS]);
  const { ordered, reorder } = useTabOrder("rolls", REORDERABLE_KEYS);
  // Depo kolonu + filtresi yalnız ÇOK DEPOLU kurulumda çizilir (tek kaynak hook).
  const { multiWarehouse } = useMultiWarehouse();

  // "Kumaş Stoğu Özeti" — her kategori için backend sayımı (top + metre) tek Excel'e.
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
        toast.success("Kumaş stoğu özeti indirildi.");
      }
    } catch {
      toast.error("Kumaş stoğu özeti oluşturulamadı.");
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
  // Yalnız TAM-FORMAT top barkodunda dener — gevşek ön ek çapası değil tam
  // biçim ki "TEKSTİL BEYAZ" gibi kumaş adı yanlışlıkla barkod sayılıp 404
  // toast'ı vermesin. Biçim sunucunun seri tablosundan gelir.
  const openDetail = (code: string) => {
    if (!matchesFullFormat("ROLL", classifyBarcode(code).code)) return;
    scanLookup.mutate(code);
  };
  // Kayıtlı sıra grup içinde uygulanır; durum → ayraç → yer sırası sabit.
  const orderedTabs = orderRollTabsByGroup(
    ordered.flatMap((k) => {
      const t = TABS.find((x) => x.key === k);
      return t ? [t] : [];
    }),
  );

  // Fasonda rozetinde "Fasonda" yerine seçili işlem/firmayı göster
  // ("Boyahane (Boyer Boyacılık)" / "Boyahane" / firma seçili değilse "Fasonda").
  const fasonScopeLabel = useFasonScopeLabel(tab === "SUBCONTRACTOR");

  // Rulo tablosu state'i BURADA (üst chrome ile aynı yerde) — böylece Sütunlar/
  // Görünümler araçları + "Fire" toggle okut/ara satırına konabilir (tablo örneği
  // gerekiyor). KANBAN'da tablo gösterilmez → fetch kapalı. RollsTableBody tabloyu
  // prop olarak alır (sadece gövdeyi çizer).
  const isTableTab = tab !== "KANBAN";
  // GİRİŞ SEKMELERİ — malın sisteme YAZILDIĞI yerler. Yalnız burada "oluşturma =
  // buraya geliş" olduğu için tarih kolonu "Giriş" (createdAt); diğer sekmelerde
  // top oraya sonradan gelir ve "Son İşlem" (updatedAt) gösterilir (2026-07-30).
  const isEntryTab = tab === "RAW_STOCK" || tab === "SEMI_FINISHED";
  // KALİTE KATALOĞU — rozet rengi/kararı buradan (karar ①). Anahtar mevcut
  // `picker` ile AYNI: react-query anahtar bazında tekilleştirir, yeni önbellek
  // girdisi doğmaz (Electron'da bu katalog altı farklı anahtarla çekiliyor —
  // birleştirme ayrı iş).
  const qualityGradesQuery = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    // 5 dk — bu anahtarın ÖNCEDEN VAR OLAN dört okuyucusuyla aynı. Farklı
    // yazsaydık aynı önbellek girdisi iki farklı yaşta veriyi taze sayardı
    // (react-query staleTime'ı GÖZLEMCİ BAŞINA uygular): admin bir kaliteyi
    // pasifleştirir, bir sekme 10 dk eski kataloğu doğru sayar, öteki 5'te
    // tazeler. Görünmez, çünkü ikisi de geçerli bir katalog döner.
    staleTime: 5 * 60_000,
  });
  // Boş dizi = katalog henüz yok → rozet çizilmez, kalite ham koduyla yazılır.
  // ⚠️ KENDİ useMemo'sunda: `?? []` her render'da YENİ dizi üretir ve ona bağlı
  // `useMemo` her render'da yeniden koşardı (`exhaustive-deps`).
  const qualityGrades = useMemo(
    () => qualityGradesQuery.data?.data ?? [],
    [qualityGradesQuery.data],
  );
  const columns = useMemo(() => makeRollColumns(qualityGrades), [qualityGrades]);
  const filterDefs = useRollFilterDefs(tab === "KANBAN" ? "RAW_STOCK" : tab);

  const dataTable = useDataTable<Roll>({
    queryKey: `rolls:${tab}`,
    queryKeyParts: ["rolls", tab],
    fetchFn: rollService.listCursor,
    columns,
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
      updatedAt: !isEntryTab,
      createdAt: isEntryTab,
      // İZLENEBİLİRLİK sütunları varsayılan GİZLİ (2026-08-05 kullanıcı kararı).
      // Gerekçe envanter listesi standardı: liste yüzeyi operatörün ANLIK
      // kararı için sade kalır, izlenebilirlik verisi ihtiyaç duyanın açtığı
      // sütunda ve detay panelinde durur. Tercih kaydedilir (Görünümler) —
      // her açılışta tekrar açmak gerekmez.
      entrySource: false,
      createdBy: false,
      entryStation: false,
      // DEPO kolonu TEK DEPOLU kurulumda gizli: orada her top aynı depoda ve
      // kolon yalnız gürültü olur ("fabrikada sıfır görünür fark"). İkinci depo
      // açıldığı gün kendiliğinden görünür.
      warehouse: multiWarehouse,
    },
    enabled: isTableTab,
    // Son kullanılan süzgeç SEKME BAŞINA (anahtar = queryKey); Üretim Akışı'nda tablo yok.
    persistFilters: tab === "KANBAN" ? undefined : rollPersistConfig(tab),
  });

  // "Top/Metre" özeti — Üretim Akışı (KANBAN) sekmesinde gizli (sorgu da kapalı); kayıtlı
  // süzgeç URL'ye yazılana dek beklenir (filtresiz + filtreli çift istek olmasın).
  const statsQuery = useRollStats(tab === "KANBAN" ? null : tab, dataTable.filtersReady);

  // Sağ alttaki "Tümünü İndir" — aktif sekmenin (filtreli) SUNUCUDAKİ TÜM kayıtlarını
  // PDF/Excel/CSV indirir (ekrandaki 100 değil). İlerleme sağ altta "N / ~T" görünür.
  const exportAll = useTableExportAll({
    table: dataTable.table,
    fetchAll: dataTable.fetchAll,
    name: "Kumaş Stoğu",
  });

  // Sekmeler aynı URL'i paylaşır; eski sekmenin süzgecini çıkarıp yeni sekmenin kaydını getiren
  // `usePersistedTableFilters` (anahtar `rolls:<sekme>`) — Fasonda/Bitmiş Depo'ya özgü süzgeç taşınmaz.
  const selectTab = (next: RollTabKey) => setTab(next);

  // ⚠️ REJİM DEĞİŞİNCE / GİZLİ SEKMEYE DERİN BAĞLANTIYLA GELİNİNCE düşülecek
  // bir yer olmalı: ticarette `?tab=PRODUCTION` sekmeyi ŞERİTTE göstermez ama
  // state'te tutar → kullanıcı hiçbir sekmesi seçili görünmeyen bir ekranda
  // tanım gereği boş bir tabloya bakar ve "liste bozuk" der. İlk görünür
  // sekmeye düşülür. (Bayrak yüklenmeden liste tam olduğu için bu effect
  // fabrikada HİÇ tetiklenmez.)
  useEffect(() => {
    if (TABS.length > 0 && !TABS.some((t) => t.key === tab)) setTab(TABS[0]!.key);
  }, [TABS, tab]);

  // Dashboard'tan `?tab=...` ile gelindiğinde initial state ile senkron;
  // URL'i temizle ki sekme değişimi geri-tuş davranışına karışmasın.
  // Kayıtlı süzgeç yazılana dek beklenir: bayat kopyadan silmek geri yüklemeyi geri alırdı.
  useEffect(() => {
    if (!urlTab || !dataTable.filtersReady) return;
    if (isRollTabKey(urlTab) && urlTab !== tab) setTab(urlTab);
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab, dataTable.filtersReady]);

  const scanBar = <RollScanBar openDetail={openDetail} scanPending={scanLookup.isPending} />;

  return (
    <PageShell>
      <PageHeader
        title="Kumaş Stoğu"
        actions={
          <>
            {/* Y2 fix: tablo key'leri artık ["rolls", tab] array formunda —
                aktif sekmeyi hedefli tazele; KANBAN'da ["rolls"] hepsini kapsar. */}
            <RefreshButton
              queryKey={tab === "KANBAN" ? ["rolls"] : ["rolls", tab]}
            />
            {/* DEMO yardımcısı — bayrak kapalıyken HİÇBİR ŞEY çizmez (bileşenin
                ilk satırı kapı). "Yeniden Etiketle" akışı elle kurulması zor bir
                ön koşul ister: topun ÖNCE etiketlenmiş SONRA değişmiş olması. */}
            <DemoBar scenario="RELABEL_STALE" invalidateKeys={[["rolls"]]} />
            {(tab === "RAW_STOCK" || tab === "SEMI_FINISHED" || tab === "FINISHED_STOCK") && (
              <PermissionGate permission="roll:write">
                <Button
                  size="sm"
                  onClick={() => {
                    // Sekme = hedef. Yarı Mamul'den açılınca kutu ön-işaretli gelir;
                    // operatörün "renk girdim ama kutuyu unuttum" tuzağına düşmesi
                    // gereken sekmede imkânsızlaşır.
                    setManualTarget(tab);
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
      {/* Okutma alanı satırın başında (arama kutusunun yeri); Üretim Akışı'nda süzgeç yok. */}
      {tab === "KANBAN" ? (
        <div className={FILTER_ROW_CLASS}>{scanBar}</div>
      ) : (
        <RollsFilterRow
          filters={filterDefs}
          leading={scanBar}
          trailing={
            <>
              {tab === "FINISHED_STOCK" && <UrlFlagToggle param={KARTELA_MARKED_PARAM} label="Kartelalık" />}
              <SavedViewsMenu compact />
              <DataTableTools table={dataTable.table} hideExport compact />
            </>
          }
        />
      )}
      {tab === "KANBAN" ? (
        <RollsKanban />
      ) : (
        <RollsTableBody
          tab={tab}
          table={dataTable.table}
          isLoading={dataTable.query.isLoading}
          pagination={dataTable.pagination}
          exportName="Kumaş Stoğu"
          hideFilterBar
          paginationActions={
            <>
              <ExportMenu
                label="Tümünü İndir"
                busyLabel={exportAll.busyLabel}
                onPdf={exportAll.onPdf}
                onExcel={exportAll.onExcel}
                onCsv={exportAll.onCsv}
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
                Kumaş Stoğu Özeti
              </Button>
            </>
          }
        />
      )}
    </PageShell>
  );
}
