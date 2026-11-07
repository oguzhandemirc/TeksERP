import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { FilterBar, StandaloneDateRangeFilter } from "@/components/data-table/FilterBar";
import { ScanField } from "@/components/scanner/ScanField";
import { useScanSeed } from "@/hooks/useScanSeed";
import { useDataTable } from "@/hooks/useDataTable";
import { makeRollColumns } from "@/pages/Operations/Rolls/columns";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import { rollService, buildRollForceFilters } from "@/pages/Operations/Rolls/service";
import { RollsTableBody, buildRollFilterDefs, DATE_FILTER } from "@/pages/Operations/Rolls/RollsTableBody";
import { SwatchesPanel } from "@/pages/Operations/Rolls/SwatchesPanel";
import { SwatchDetailSheet } from "@/pages/Operations/Rolls/SwatchDetailSheet";
import { swatchService, type Swatch } from "@/pages/Operations/Rolls/swatchService";
import type { Roll } from "@/pages/Operations/Rolls/types";
import { useFoldValues } from "@/hooks/useFoldValues";
import { KartelaDetailSheet, type KartelaSelection } from "./KartelaDetailSheet";
import { DispatchesTab, ReceiptsTab } from "./KartelaTabs";
import { KartelaEventsTab } from "./KartelaEventsTab";
import { KartelaTabBar } from "./KartelaTabBar";
import { OutstandingTab } from "./OutstandingTab";
import { KartelaDispatchDialog } from "./KartelaDispatchDialog";
import { KartelaCekiPrintDialog } from "./KartelaCekiPrintDialog";
import { KartelaStockTab } from "./KartelaStockTab";
import type { KartelaPickedRoll } from "./kartelaActions";
import { useKartelaTab, kartelaRefreshKey } from "./useKartelaTab";
import { NEW_DISPATCH_ACTION } from "./tabs-config";

// Tek kokpit: belge akışı (Sevkler/Bekleyen Kabul/Kabuller) + envanter (Kartelada Toplar =
// AT_KARTELA rulolar, Kartela Stoğu = swatch'lar). Sevk/kabul/iptal tabletle eşit (kartela:write).
export function KartelaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selection, setSelection] = useState<KartelaSelection>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanSwatch, setScanSwatch] = useState<Swatch | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [cekiId, setCekiId] = useState<string | null>(null);
  // Kartelalık Stok → "Sevke ekle": seçilen toplar Yeni Sevk'e hazır listeyle gider.
  const [dispatchSeed, setDispatchSeed] = useState<KartelaPickedRoll[] | null>(null);
  const { tab, changeTab } = useKartelaTab(() => setSelection(null));
  // Palet derin bağlantısı (`?action=new-dispatch`) diyaloğu bir kez açar; parametre tüketilir.
  useEffect(() => {
    if (searchParams.get("action") !== NEW_DISPATCH_ACTION) return;
    setDispatchOpen(true);
    const sp = new URLSearchParams(searchParams);
    sp.delete("action");
    setSearchParams(sp, { replace: true });
  }, [searchParams, setSearchParams]);

  // Kartela (SW-) barkodu okut → kartela detayını aç (404 toast'ı interceptor'dan).
  const swatchLookup = useMutation({
    mutationFn: (code: string) => swatchService.getByBarcode(code),
    onSuccess: (res) => setScanSwatch(res.data ?? null),
  });
  const openSwatch = (code: string) => {
    setScanCode(code);
    swatchLookup.mutate(code);
  };
  useScanSeed("scanCode", openSwatch);

  // "Kartelada Toplar" tablosu — Sütunlar/Görünümler/Fire araçlarını sekme
  // şeridiyle AYNI satırda göstermek için tablo örneği burada (üst chrome'da)
  // kurulur; diğer sekmelerde `enabled: false` ile fetch atılmaz.
  // Kat seçenekleri katalogdan; boşsa filtre hiç çizilmez (buildRollFilterDefs).
  const { values: foldValues } = useFoldValues();
  const rollFilterDefs = useMemo(
    () =>
      buildRollFilterDefs(
        "KARTELA_SENT",
        foldValues.map((v) => ({ value: v.code, label: v.name })),
      ),
    [foldValues],
  );
  const rollForceFilters = useMemo(() => buildRollForceFilters("KARTELA_SENT"), []);
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

  const rollsTable = useDataTable<Roll>({
    queryKey: "rolls:KARTELA_SENT",
    queryKeyParts: ["rolls", "KARTELA_SENT"],
    fetchFn: rollService.listCursor,
    columns,
    defaultPageSize: 100,
    forceFilters: rollForceFilters,
    // Fason sütunları kartela tablosunda anlamsız (AT_KARTELA topta aktif fason
    // sevki yok) — default gizli; Sütunlar'dan açılırsa "—" gösterir.
    initialVisibility: { subcontractorCategory: false, subcontractor: false },
    enabled: tab === "rolls",
  });
  const includeFire = searchParams.get("filter[includeFire]") === "true";
  const toggleIncludeFire = (next: boolean) => {
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("filter[includeFire]", "true");
    else sp.delete("filter[includeFire]");
    setSearchParams(sp, { replace: true });
  };

  const refreshKey = kartelaRefreshKey(tab);

  return (
    <PageShell>
      <PageHeader
        title="Kartela"
        actions={
          <>
            <PermissionGate permission="kartela:write">
              <Button size="sm" className="gap-1.5" onClick={() => setDispatchOpen(true)}>
                <Send className="h-4 w-4" /> Yeni Sevk
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={refreshKey} extraKeys={[["kartela"]]} />
          </>
        }
      />
      <KartelaTabBar
        tab={tab}
        onTab={changeTab}
        trailing={
          tab === "rolls" ? (
            <>
              <DataTableTools table={rollsTable.table} exportName="Kumaş Stoğu" fetchAll={rollsTable.fetchAll} />
              <SavedViewsMenu />
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <Checkbox
                  checked={includeFire}
                  onCheckedChange={(v) => toggleIncludeFire(v === true)}
                />
                Fire kaliteyi de göster
              </label>
            </>
          ) : null
        }
      />

      {tab === "dispatches" ? (
        <DispatchesTab onSelect={setSelection} onScanSwatch={openSwatch} swatchLookupPending={swatchLookup.isPending} />
      ) : tab === "outstanding" ? (
        <OutstandingTab />
      ) : tab === "receipts" ? (
        <ReceiptsTab onSelect={setSelection} onScanSwatch={openSwatch} swatchLookupPending={swatchLookup.isPending} />
      ) : tab === "stock" ? (
        <KartelaStockTab
          onAddToDispatch={(rolls) => {
            setDispatchSeed(rolls);
            setDispatchOpen(true);
          }}
        />
      ) : tab === "rolls" ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <ScanField
              value={scanCode}
              onChange={setScanCode}
              onScan={openSwatch}
              placeholder="Barkod okut..."
              expectPrefix="SWATCH"
              busy={swatchLookup.isPending}
              widthClassName="w-64"
              inputClassName="h-8 text-xs"
              clearable
            />
            <StandaloneDateRangeFilter def={DATE_FILTER} />
            <FilterBar filters={rollFilterDefs} inline />
          </div>
          <RollsTableBody
            tab="KARTELA_SENT"
            table={rollsTable.table}
            isLoading={rollsTable.query.isLoading}
            pagination={rollsTable.pagination}
            hideFilterBar
          />
        </>
      ) : tab === "events" ? (
        <KartelaEventsTab />
      ) : (
        <SwatchesPanel onScanSwatch={openSwatch} swatchLookupPending={swatchLookup.isPending} />
      )}

      <KartelaDispatchDialog
        open={dispatchOpen}
        onOpenChange={(o) => {
          setDispatchOpen(o);
          if (!o) setDispatchSeed(null);
        }}
        onCreated={setCekiId}
        initialRolls={dispatchSeed}
      />
      <KartelaCekiPrintDialog dispatchId={cekiId} open={cekiId !== null} onOpenChange={(o) => !o && setCekiId(null)} />
      <KartelaDetailSheet selection={selection} onClose={() => setSelection(null)} />
      <SwatchDetailSheet
        swatch={scanSwatch}
        open={Boolean(scanSwatch)}
        onOpenChange={(o) => !o && setScanSwatch(null)}
      />
    </PageShell>
  );
}
