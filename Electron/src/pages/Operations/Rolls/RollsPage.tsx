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
  ShoppingBag,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/PermissionGate";
import { ReorderableTabBar } from "@/components/layout/ReorderableTabBar";
import { classifyBarcode, BARCODE_FORMATS } from "@/lib/scanner/barcode-kind";
import { useTabOrder } from "@/hooks/useTabOrder";
import { useDataTable } from "@/hooks/useDataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { RollScanBar } from "./RollScanBar";
import { RollsTableBody } from "./RollsTableBody";
import { RollsKanban } from "./RollsKanban";
import { RollsStats } from "./RollsStats";
import { useRollStats } from "./useRollStats";
import { rollColumns } from "./columns";
import { ManualEntryDialog } from "./ManualEntryDialog";
import { RollDetailSheet } from "./RollDetailSheet";
import { RollLabelDialog } from "@/components/labels/RollLabelDialog";
import { rollService, buildRollForceFilters, type RollStatusTabKey } from "./service";
import type { LabelCustomerContext } from "@/services/labelService";
import type { Roll } from "./types";

type RollTabKey = RollStatusTabKey | "KANBAN";

// Sıralama: stoklar (giriş/çıkış) önde yan yana → üretim akışı (super-set +
// alt-kümeler) → arşiv/kartela. Operatör en sık giriş/çıkış sayım için
// stoklara bakar, üretim akışı sekmeleri orta blokta.
const TABS: Array<{ key: RollTabKey; label: string; Icon: typeof Package }> = [
  { key: "RAW_STOCK",      label: "Ham Stok",        Icon: Package },
  { key: "FINISHED_STOCK", label: "Bitmiş Depo",     Icon: Warehouse },
  { key: "IN_SACK",        label: "Çuvalda",         Icon: ShoppingBag },
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
  // "Ekle ve Etiket Bas": yeni topun etiket diyalogu (önizleme + Bas). ctx = etiket müşterisi.
  const [labelRoll, setLabelRoll] = useState<{ id: string; ctx?: LabelCustomerContext } | null>(null);
  const [scanRoll, setScanRoll] = useState<Roll | null>(null);
  const { ordered, reorder } = useTabOrder("rolls", REORDERABLE_KEYS);

  // Barkod → topu getir → detay panelini aç (404 toast'ı interceptor'dan).
  // Not: okut/ara input'u + "okutunca aç" tercihi RollScanBar'a taşındı (perf:
  // tuş vuruşu artık RollsPage'i / tabloyu re-render etmez).
  const scanLookup = useMutation({
    mutationFn: (code: string) => rollService.getByBarcode(code),
    onSuccess: (res) => setScanRoll(res.data ?? null),
  });
  // Detayı aç (açık niyet: "Aç" butonu / useScanSeed navigasyonu / okutma+toggle-açık).
  // Yalnız TAM-FORMAT top barkodunda dener — gevşek /^T\d/ değil tam regex ki
  // "TEKSTİL BEYAZ" gibi ürün adı yanlışlıkla barkod sayılıp 404 toast'ı vermesin.
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
    enabled: isTableTab,
  });

  // "Fire kaliteyi de göster" — URL filter[includeFire]; tablo + özet ikisi de okur.
  const includeFire = searchParams.get("filter[includeFire]") === "true";
  const toggleIncludeFire = (next: boolean) => {
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("filter[includeFire]", "true");
    else sp.delete("filter[includeFire]");
    setSearchParams(sp, { replace: true });
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
    <div className="flex h-full flex-col">
      <PageHeader
        title="Envanter"
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
            <DataTableTools table={dataTable.table} exportName="Envanter" />
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
        pinnedTab={ARCHIVE_TAB}
        activeKey={tab}
        onSelect={(k) => setTab(k as RollTabKey)}
        onReorder={reorder}
        // "Top/Metre" özeti şeridin sağında (Arşiv'in eski yeri).
        trailing={
          isTableTab ? (
            <RollsStats
              data={statsQuery.data?.data}
              isLoading={statsQuery.isLoading}
              scopeLabel={TABS.find((t) => t.key === tab)?.label ?? ""}
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
        />
      )}
    </div>
  );
}
