import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { useScanSeed } from "@/hooks/useScanSeed";
import { SwatchesPanel } from "@/pages/Operations/Rolls/SwatchesPanel";
import { SwatchDetailSheet } from "@/pages/Operations/Rolls/SwatchDetailSheet";
import { swatchService, type Swatch } from "@/pages/Operations/Rolls/swatchService";
import { KartelaDetailSheet, type KartelaSelection } from "./KartelaDetailSheet";
import { DispatchesTab, ReceiptsTab } from "./KartelaTabs";
import { KartelaEventsTab } from "./KartelaEventsTab";
import { KartelaTabBar } from "./KartelaTabBar";
import { OutstandingTab } from "./OutstandingTab";
import { KartelaDispatchDialog } from "./KartelaDispatchDialog";
import { KartelaCekiPrintDialog } from "./KartelaCekiPrintDialog";
import { KartelaStockTab } from "./KartelaStockTab";
import { KartelaRollsTab } from "./KartelaRollsTab";
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
  const { tab, changeTab, settled } = useKartelaTab(() => setSelection(null));
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
      <KartelaTabBar tab={tab} onTab={changeTab} />

      {/* Sekme geçişinde eski sekmenin süzgeci URL'den çıkana dek yeni sekme bağlanmaz (filtre kaydı). */}
      {!settled ? null : tab === "dispatches" ? (
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
        <KartelaRollsTab scanCode={scanCode} onScanCodeChange={setScanCode} onScanSwatch={openSwatch} swatchLookupPending={swatchLookup.isPending} />
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
