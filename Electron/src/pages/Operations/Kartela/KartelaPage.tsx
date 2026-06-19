import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, PackageCheck, Package, Palette } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { cn } from "@/lib/utils";
import { ScanField } from "@/components/scanner/ScanField";
import { useScanSeed } from "@/hooks/useScanSeed";
import { RollsTable } from "@/pages/Operations/Rolls/RollsTable";
import { SwatchesPanel } from "@/pages/Operations/Rolls/SwatchesPanel";
import { SwatchDetailSheet } from "@/pages/Operations/Rolls/SwatchDetailSheet";
import { swatchService, type Swatch } from "@/pages/Operations/Rolls/swatchService";
import { KartelaDetailSheet, type KartelaSelection } from "./KartelaDetailSheet";
import { DispatchesTab, ReceiptsTab } from "./KartelaTabs";

// Tek kokpit: belge akışı (Sevkler/Kabuller) + envanter (Kartelada Toplar =
// AT_KARTELA rulolar, Üretilen Kartelalar = swatch'lar). Envanter görünümleri
// Toplar sayfasından buraya taşındı — kartela tek yerden yönetilir.
type Tab = "dispatches" | "receipts" | "rolls" | "swatches";

const TABS: { key: Tab; label: string; Icon: typeof Send }[] = [
  { key: "dispatches", label: "Sevkler", Icon: Send },
  { key: "receipts", label: "Kabuller", Icon: PackageCheck },
  { key: "rolls", label: "Kartelada Toplar", Icon: Package },
  { key: "swatches", label: "Üretilen Kartelalar", Icon: Palette },
];

function KartelaTabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div className="flex items-center gap-1 border-b px-3">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onTab(t.key)}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab === t.key
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <t.Icon className="h-4 w-4" />
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function KartelaPage() {
  const [tab, setTab] = useState<Tab>("dispatches");
  const [selection, setSelection] = useState<KartelaSelection>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanSwatch, setScanSwatch] = useState<Swatch | null>(null);

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

  const refreshKey =
    tab === "dispatches"
      ? "kartela-dispatches"
      : tab === "receipts"
        ? "kartela-receipts"
        : tab === "rolls"
          ? "rolls:KARTELA_SENT"
          : "swatches";

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Kartela"
        description="Kartela sevk/kabul belgeleri, fasondaki toplar ve üretilen kartelalar — tek yerden."
        actions={<RefreshButton queryKey={refreshKey} extraKeys={[["kartela"]]} />}
      />
      <KartelaTabBar tab={tab} onTab={setTab} />
      <ScanField
        className="border-b px-4 py-2"
        widthClassName="max-w-xs"
        value={scanCode}
        onChange={setScanCode}
        onScan={openSwatch}
        placeholder="Kartela barkodu okut → detay (SW-…)"
        expectPrefix="SWATCH"
        validateChecksum
        submitLabel="Aç"
        busy={swatchLookup.isPending}
        busyLabel="…"
      />

      {tab === "dispatches" ? (
        <DispatchesTab onSelect={setSelection} />
      ) : tab === "receipts" ? (
        <ReceiptsTab onSelect={setSelection} />
      ) : tab === "rolls" ? (
        <RollsTable tab="KARTELA_SENT" />
      ) : (
        <SwatchesPanel />
      )}

      <KartelaDetailSheet selection={selection} onClose={() => setSelection(null)} />
      <SwatchDetailSheet
        swatch={scanSwatch}
        open={Boolean(scanSwatch)}
        onOpenChange={(o) => !o && setScanSwatch(null)}
      />
    </div>
  );
}
