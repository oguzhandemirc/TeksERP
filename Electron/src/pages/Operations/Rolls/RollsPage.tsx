import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Package,
  Cog,
  Send,
  Archive,
  Palette,
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
import { RollsTable } from "./RollsTable";
import { RollsKanban } from "./RollsKanban";
import { SwatchesPanel } from "./SwatchesPanel";
import { ManualEntryDialog } from "./ManualEntryDialog";
import type { RollStatusTabKey } from "./service";

type RollTabKey = RollStatusTabKey | "SWATCH" | "KANBAN";

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
  { key: "ARCHIVE",        label: "Arşiv",           Icon: Archive },
  { key: "SWATCH",         label: "Kartela",         Icon: Palette },
];

const TAB_KEYS = new Set<RollTabKey>(TABS.map((t) => t.key));

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
            {/* Aktif sekmenin queryKey'i `rolls:<tab>` formatında (useDataTable);
                "rolls" prefix match etmiyor — tek string'in başlangıcı array
                matching ile yakalanmaz. */}
            <RefreshButton
              queryKey={tab === "SWATCH" ? "swatches" : tab === "KANBAN" ? "rolls" : `rolls:${tab}`}
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
      <div className="flex items-center gap-1 border-b px-3 pt-2">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      {tab === "SWATCH" ? (
        <SwatchesPanel />
      ) : tab === "KANBAN" ? (
        <RollsKanban />
      ) : (
        <RollsTable tab={tab} />
      )}
    </div>
  );
}
