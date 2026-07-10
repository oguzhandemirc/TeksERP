import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  Package,
  Cog,
  Send,
  Archive,
  FlaskConical,
  Disc3,
  Plus,
  Warehouse,
  Columns3,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/PermissionGate";
import { usePreferences } from "@/providers/PreferencesProvider";
import { ReorderableTabBar } from "@/components/layout/ReorderableTabBar";
import { ScanField } from "@/components/scanner/ScanField";
import { classifyBarcode, BARCODE_FORMATS } from "@/lib/scanner/barcode-kind";
import { useTabOrder } from "@/hooks/useTabOrder";
import { useScanSeed } from "@/hooks/useScanSeed";
import { RollsTable } from "./RollsTable";
import { RollsKanban } from "./RollsKanban";
import { ManualEntryDialog } from "./ManualEntryDialog";
import { RollDetailSheet } from "./RollDetailSheet";
import { rollService, type RollStatusTabKey } from "./service";
import type { Roll } from "./types";

type RollTabKey = RollStatusTabKey | "KANBAN";

// Sıralama: stoklar (giriş/çıkış) önde yan yana → üretim akışı (super-set +
// alt-kümeler) → arşiv/kartela. Operatör en sık giriş/çıkış sayım için
// stoklara bakar, üretim akışı sekmeleri orta blokta.
const TABS: Array<{ key: RollTabKey; label: string; Icon: typeof Package }> = [
  { key: "RAW_STOCK",      label: "Ham Stok",        Icon: Package },
  { key: "FINISHED_STOCK", label: "Bitmiş Depo",     Icon: Warehouse },
  { key: "PRODUCTION",     label: "Üretimde",        Icon: Cog },
  { key: "KANBAN",         label: "Üretim Akışı",    Icon: Columns3 },
  { key: "SUBCONTRACTOR",  label: "Fasonda",         Icon: Send },
  { key: "KURSUN_PENDING", label: "Kurşun Bekleyen", Icon: FlaskConical },
  { key: "TAMBUR_PENDING", label: "Tambur Bekleyen", Icon: Disc3 },
  // Arşiv varsayılan olarak en sonda — nadiren bakılır. Kullanıcı sürükleyerek
  // değiştirebilir; sıra tercihte (backend) saklanır.
  { key: "ARCHIVE",        label: "Arşiv",           Icon: Archive },
];

const TAB_KEYS = new Set<RollTabKey>(TABS.map((t) => t.key));
// Arşiv reorder dışında — sağ kenara sabit, "çöp kutusu" gibi ayrı tutulur.
const REORDERABLE_KEYS = TABS.filter((t) => t.key !== "ARCHIVE").map((t) => t.key);
const ARCHIVE_TAB = TABS.find((t) => t.key === "ARCHIVE")!;

function isRollTabKey(v: string | null): v is RollTabKey {
  return v !== null && TAB_KEYS.has(v as RollTabKey);
}

export function RollsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const [tab, setTab] = useState<RollTabKey>(
    isRollTabKey(urlTab) ? urlTab : "RAW_STOCK",
  );
  const [manualOpen, setManualOpen] = useState(false);
  // Manuel giriş hangi sekmeden açıldı — Bitmiş Depo'da renk zorunlu + WAREHOUSE doğar.
  const [manualTarget, setManualTarget] = useState<"RAW_STOCK" | "FINISHED_STOCK">("RAW_STOCK");
  // Birleşik "okut/ara" input'u: yazınca listeyi süzer (URL search), okut/Enter'da
  // (ROLL barkodu ise) detay panelini açar. Açılışta URL'deki search ile senkron.
  const [scanBarcode, setScanBarcode] = useState(() => searchParams.get("search") ?? "");
  const [scanRoll, setScanRoll] = useState<Roll | null>(null);
  const { ordered, reorder } = useTabOrder("rolls", REORDERABLE_KEYS);

  // Okutunca detay panelini otomatik aç mı? — iş istasyonu tercihi (default açık).
  // Kapalıyken okutma yalnız listeyi süzer; detay "Aç" butonu / satır tıklamasıyla açılır.
  const { prefs, setPreference } = usePreferences();
  const openOnScan = prefs.rolls?.openDetailOnScan ?? true;
  const setOpenOnScan = (v: boolean) =>
    setPreference({ rolls: { ...prefs.rolls, openDetailOnScan: v } });

  // Yazma → URL `search` (debounce). RollsTable/stats urlParams.search okur → liste süzülür.
  useEffect(() => {
    const h = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      const v = scanBarcode.trim();
      if (v) next.set("search", v);
      else next.delete("search");
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanBarcode]);

  // Barkod → topu getir → detay panelini aç (404 toast'ı interceptor'dan).
  const scanLookup = useMutation({
    mutationFn: (code: string) => rollService.getByBarcode(code),
    onSuccess: (res) => setScanRoll(res.data ?? null),
  });
  // Detayı aç (açık niyet: "Aç" butonu / useScanSeed navigasyonu / okutma+toggle-açık).
  // Yalnız TAM-FORMAT top barkodunda dener — gevşek /^TEKS/ değil tam regex ki
  // "TEKSTİL BEYAZ" gibi ürün adı yanlışlıkla barkod sayılıp 404 toast'ı vermesin.
  const openDetail = (code: string) => {
    if (!BARCODE_FORMATS.ROLL.test(classifyBarcode(code).code)) return;
    scanLookup.mutate(code);
  };
  // Okut/Enter → her zaman listeyi süz; detay yalnız toggle AÇIK ise açılır.
  const handleScan = (code: string) => {
    setScanBarcode(code); // input + liste süzme senkron
    if (openOnScan) openDetail(code);
  };
  // Başka sayfadan "bu topu aç" niyetiyle gelindi → toggle'dan bağımsız aç.
  useScanSeed("scanBarcode", (code: string) => {
    setScanBarcode(code);
    openDetail(code);
  });
  const canOpen = BARCODE_FORMATS.ROLL.test(classifyBarcode(scanBarcode).code);
  const orderedTabs = ordered.flatMap((k) => {
    const t = TABS.find((x) => x.key === k);
    return t ? [t] : [];
  });

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
    <div className="flex h-full flex-col">
      <PageHeader
        title="Toplar"
        description="Envanterdeki ve üretimdeki tüm topların listesi."
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
      <ManualEntryDialog open={manualOpen} onOpenChange={setManualOpen} target={manualTarget} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <ScanField
          className="min-w-0 flex-1"
          widthClassName="max-w-md"
          value={scanBarcode}
          onChange={setScanBarcode}
          onScan={handleScan}
          placeholder="Barkod okut/yaz → detay · ürün adı-kodu yazarak listeyi süz"
        />
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={openOnScan}
            onCheckedChange={(v) => setOpenOnScan(v === true)}
          />
          Okutunca paneli aç
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => openDetail(scanBarcode.trim())}
          disabled={!canOpen || scanLookup.isPending}
          title={canOpen ? "Bu barkodun detayını aç" : "Tam bir top barkodu okut/yaz"}
        >
          {scanLookup.isPending ? "…" : "Aç"}
        </Button>
      </div>
      <RollDetailSheet
        roll={scanRoll}
        open={Boolean(scanRoll)}
        onOpenChange={(o) => !o && setScanRoll(null)}
      />
      <ReorderableTabBar
        tabs={orderedTabs}
        pinnedTab={ARCHIVE_TAB}
        activeKey={tab}
        onSelect={(k) => setTab(k as RollTabKey)}
        onReorder={reorder}
      />
      {tab === "KANBAN" ? (
        <RollsKanban />
      ) : (
        <RollsTable tab={tab} />
      )}
    </div>
  );
}
