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
import { PermissionGate } from "@/components/PermissionGate";
import { ReorderableTabBar } from "@/components/layout/ReorderableTabBar";
import { ScanField } from "@/components/scanner/ScanField";
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
  const [scanBarcode, setScanBarcode] = useState("");
  const [scanRoll, setScanRoll] = useState<Roll | null>(null);
  const { ordered, reorder } = useTabOrder("rolls", REORDERABLE_KEYS);

  // Barkod okut → topu getir → detay panelini aç (404 toast'ı interceptor'dan).
  const scanLookup = useMutation({
    mutationFn: (code: string) => rollService.getByBarcode(code),
    onSuccess: (res) => setScanRoll(res.data ?? null),
  });
  const openByBarcode = (code: string) => {
    setScanBarcode(code);
    scanLookup.mutate(code);
  };
  useScanSeed("scanBarcode", openByBarcode);
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
            {tab === "RAW_STOCK" && (
              <PermissionGate permission="roll:write">
                <Button size="sm" onClick={() => setManualOpen(true)}>
                  <Plus className="h-4 w-4" /> Manuel Top Ekle
                </Button>
              </PermissionGate>
            )}
          </>
        }
      />
      <ManualEntryDialog open={manualOpen} onOpenChange={setManualOpen} />
      <ScanField
        className="border-b px-4 py-2"
        widthClassName="max-w-xs"
        value={scanBarcode}
        onChange={setScanBarcode}
        onScan={openByBarcode}
        placeholder="Top barkodu okut → detayı aç"
        expectPrefix="ROLL"
        submitLabel="Aç"
        busy={scanLookup.isPending}
        busyLabel="…"
      />
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
