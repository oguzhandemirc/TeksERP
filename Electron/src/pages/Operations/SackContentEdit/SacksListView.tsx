import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Eye, PackageOpen, Scale, Tag, Truck } from "lucide-react";
import { SackLabelDialog } from "@/components/labels/SackLabelDialog";
import { Button } from "@/components/ui/button";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { ScanField } from "@/components/scanner/ScanField";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { useScanSeed } from "@/hooks/useScanSeed";
import { useDataTable } from "@/hooks/useDataTable";
import { sackHubService } from "./service";
import { hasContentFilter, sacksKolonlari } from "./sacksColumns";
import { useCustomerBranchesEnabled, usePackingGroupMode, usePackingGroupsEnabled } from "@/hooks/usePricingEnabled";
import { RollLocateCard } from "./RollLocateCard";
import { PickListPrintDialog } from "./PickListPrintDialog";
import { CreateShipmentDialog } from "./CreateShipmentDialog";
import { PackingGroupBar } from "./PackingGroupBar";
import { isLotMode } from "./packingLotUi";
import { AssignPackingGroupDialog } from "./AssignPackingGroupDialog";
import { WeighSackDialog } from "./WeighSackDialog";
import { SackDetailSheet } from "./SackDetailSheet";
import { BulkDistributeSacksDialog } from "./BulkDistributeSacksDialog";
import { SackBulkActions } from "./SackBulkActions";
import { SACK_PERSIST, isTargetedOpen, sackRowSplit } from "./sack-filter-defs";
import { CUSTOMERLESS_FILTER_VALUE, UNGROUPED_FILTER_VALUE, isWarehouseSack, hasSackContents, type LocatedRoll, type SackSearchRow } from "./types";

interface Props {
  onEditSack: (sack: SackSearchRow) => void;
}
/**
 * Çuval listesi (ana görünüm) — Siparişler paritesinde satır/sütunlu DataTable.
 * Depodaki çuvallar seçilebilir (havuzdan sevkiyat) ve tıklayınca editöre açılır;
 * sevkteki çuvallar salt-okunur önizleme sheet'ine düşer.
 */
export function SacksListView({ onEditSack }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const subeAcik = useCustomerBranchesEnabled();
  const groupsEnabled = usePackingGroupsEnabled();
  // Sevk partisi modu (2026-09-21): şerit, sütun ve "Partiye Al" sözü buna göre.
  const lotMode = isLotMode(groupsEnabled, usePackingGroupMode());
  const [located, setLocated] = useState<LocatedRoll | null>(null);
  const [pickListIds, setPickListIds] = useState<string[] | null>(null);
  const [shipSacks, setShipSacks] = useState<SackSearchRow[] | null>(null);
  /** Toplu dağıtma diyaloğu — seçili çuval id'leri; null = kapalı. */
  const [bulkDistribute, setBulkDistribute] = useState<string[] | null>(null);
  const [bulkDelete, setBulkDelete] = useState<string[] | null>(null);
  /** "Parti Ata" diyaloğu — seçili çuvallar; null = kapalı. */
  const [groupSacks, setGroupSacks] = useState<SackSearchRow[] | null>(null);
  const [detail, setDetail] = useState<SackSearchRow | null>(null);
  const [weighSack, setWeighSack] = useState<SackSearchRow | null>(null);
  const [labelSack, setLabelSack] = useState<SackSearchRow | null>(null);

  // Okutma tohumu ya da parti içi açılış hedeflidir (derin bağlantı): kayıt uygulanmaz, o oturumda yazılmaz.
  const location = useLocation();
  const seededRef = useRef(isTargetedOpen(location.state, searchParams));
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<SackSearchRow>({
    queryKey: "sack-search",
    persistFilters: seededRef.current ? undefined : SACK_PERSIST,
    fetchFn: sackHubService.listSacks,
    columns: sacksKolonlari(subeAcik, lotMode, hasContentFilter(searchParams), lotMode && !!searchParams.get("filter[packingGroupId]")),
    defaultPageSize: 50,
    // Yalnız depodaki (sevk edilmemiş) çuvallar seçilebilir → havuzdan sevk kurulur.
    enableSelection: (row) => isWarehouseSack(row.original),
  });

  // Barkod okut — top: nerede?; çuval kodu (CV-): arama kutusuna uygula (sackNo eşleşir).
  const locate = useMutation({
    mutationFn: (code: string) => sackHubService.locateRoll(code),
    onSuccess: (res) => setLocated(res.data),
    onError: () => setLocated(null),
  });

  // Tek giriş: top barkodu → "nerede?" (locate); metin/çuval kodu → aramaya.
  const handleScan = (code: string) => {
    if (classifyBarcode(code).kind === "ROLL") {
      locate.mutate(code);
      setSearch(""); // barkod arama kutusunu kirletmesin
      return;
    }
    setSearch(code);
  };

  // Scan-anywhere yönlendirmeleri (eski Çuval Arama + Paketleme hedefleri birleşti).
  useScanSeed("scanCode", (code) => handleScan(code));
  useScanSeed("focusBarcode", (code) => handleScan(code));
  useScanSeed("scanCodeDispatched", (code) => {
    // Arama + kapsam=DISPATCHED'i TEK URL yazımında set et (debounce yarışını önler).
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("search", code);
        next.set("filter[scope]", "DISPATCHED");
        return next;
      },
      { replace: true },
    );
    toast.info(`Sevk edilmiş çuval arandı: ${code}`);
  });

  // "SEVK EDİLMİŞLERDE ARA" İPUCU — varsayılan kapsam POOL+PLANNED olduğu için sevk
  // edilmiş bir çuval aranınca liste BOŞ döner ve ekran sebebini söylemez; operatör
  // "böyle bir çuval yok" sanır. Okutma yolunda bu telafi zaten vardı
  // (`scanCodeDispatched`), yazarak arama yolunda YOKTU. Varsayılan kapsam
  // DEĞİŞTİRİLMEDİ (bilinçli): "depoda ne var" sorusu sevk edilmişlerle bulanmasın.
  // Şeridin ön koşulu: süzgeçte TEK cari var mı (CSV de bir string'dir).
  const cariFiltresi = (searchParams.get("filter[customerId]") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v && v !== CUSTOMERLESS_FILTER_VALUE);
  const tekCariId = cariFiltresi.length === 1 ? (cariFiltresi[0] ?? null) : null;
  const customerHidden = lotMode && !!tekCariId;
  const rowSplit = useMemo(() => sackRowSplit(subeAcik, customerHidden), [subeAcik, customerHidden]);

  const scopeFilter = searchParams.get("filter[scope]") ?? "";
  const groupFilter = searchParams.get("filter[packingGroupId]") ?? "";
  /** Parti içi (partisiz değil) → parti id; döküm/hepsini sevk kapsamı bu. */
  const lotParti = lotMode && groupFilter && groupFilter !== UNGROUPED_FILTER_VALUE ? groupFilter : null;
  // "Hepsini Sevk Et": partinin depodaki TÜM çuvalları — cursor'lu listenin sayfası
  // değil, süzgecin tamamı (`fetchAll`); sevk edilebilir olanlar (depoda) süzülür.
  const shipAll = useMutation({
    mutationFn: async () => (await fetchAll()).filter(isWarehouseSack).filter(hasSackContents),
    onSuccess: (all) => {
      if (all.length === 0) { toast.info("Bu partide depoda sevk edilebilir (dolu) çuval yok."); return; }
      setShipSacks(all);
    },
  });
  const showDispatchedHint =
    !query.isLoading &&
    search.trim().length > 0 &&
    table.getRowModel().rows.length === 0 &&
    scopeFilter !== "DISPATCHED" &&
    scopeFilter !== "ALL";
  const applyDispatchedScope = () =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("filter[scope]", "DISPATCHED");
        return next;
      },
      { replace: true },
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* TEK SATIR: [Ara·Okut][Kapsam][Müşteri][Kumaş][Renk][+ Filtre] … [Temizle][Görünümler][Araçlar]. */}
      <FilterRow
        leading={
          <ScanField
            value={search}
            onChange={setSearch}
            onScan={handleScan}
            placeholder="Ara ya da barkod okut…"
            expectPrefix={["ROLL", "SACK"]}
            busy={locate.isPending}
            className="w-56 min-w-[10rem] shrink 2xl:w-72"
            inputClassName="h-8 text-sm"
            clearable
          />
        }
        primary={rowSplit.primary}
        more={rowSplit.more}
        trailing={
          <>
            <SavedViewsMenu compact />
            <DataTableTools table={table} exportName="Çuvallar" fetchAll={fetchAll} compact />
          </>
        }
      />

      {/* PAKETLEME GRUBU ŞERİDİ — yalnız bayrak açık VE tek cari seçiliyken.
          Gruplar cariye özeldir; çok carili listede iki farklı "P1" yan yana
          gelir ve numara benzersizmiş yanılgısı üretirdi. */}
      {/* Parti modunda çuval listesi bir PARTİNİN içidir: parti sayfa başlığında rozet,
          eylemleri alt şeritte (`PackingLotBarActions`). Grup modunda çip şeridi bugünkü gibi. */}
      {groupsEnabled && !lotMode && <PackingGroupBar customerId={tekCariId} />}

      {located && <RollLocateCard roll={located} onClear={() => setLocated(null)} />}

      {showDispatchedHint && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-md border border-info/40 bg-info/5 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Bu kapsamda sonuç yok — aradığınız çuval <strong>sevk edilmiş</strong> olabilir.
            Liste varsayılan olarak yalnız depodaki ve planlı sevkiyattaki çuvalları gösterir.
          </span>
          <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={applyDispatchedScope}>
            Sevk Edilmiş kapsamında göster
          </Button>
        </div>
      )}

      <DataTable<SackSearchRow>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Filtrelerle eşleşen çuval yok."
        // Toolbar'daki ile AYNI ad — verilmezse seçili indirmeler "Liste (seçili)" olur.
        exportName="Çuvallar"
        onRowClick={(s) => (isWarehouseSack(s) ? onEditSack(s) : setDetail(s))}
        rowContextMenu={(s) =>
          isWarehouseSack(s) ? (
            <>
              <ContextMenuItem onSelect={() => onEditSack(s)}>
                <PackageOpen /> İçeriği düzenle
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => setWeighSack(s)}>
                <Scale /> Tart
              </ContextMenuItem>
              {/* Etiket — barkod/karekod çuval no'yu taşır. Sevkteki çuvalda DA
                  basılabilir (baskı içeriği değiştirmez; yırtılan etiket yenilenir). */}
              <ContextMenuItem onSelect={() => setLabelSack(s)}>
                <Tag /> Etiket Yazdır
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => setShipSacks([s])}>
                <Truck /> Sevk Et
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onSelect={() => setDetail(s)}>
                <Eye /> Detayı göster
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => setLabelSack(s)}>
                <Tag /> Etiket Yazdır
              </ContextMenuItem>
            </>
          )
        }
        selectionHint={null}
        // Sağdaki jenerik tuşlar ÇUVAL SATIRLARINI indirir; içerik dökümü ayrı menüde.
        selectedExportHint="Ekrandaki çuval listesini indirir — çuvalların İÇİNDEKİ topların dökümü için 'İçerik Dökümü'nü kullanın."
        bulkActions={(rows) => (
          <SackBulkActions
            rows={rows}
            lotMode={lotMode}
            groupsEnabled={groupsEnabled}
            lotParti={lotParti}
            groupFilter={groupFilter}
            shipping={shipAll.isPending}
            onShip={setShipSacks}
            onPickList={(ids) => setPickListIds(ids)}
            onGroup={setGroupSacks}
            onDistribute={setBulkDistribute}
            onDelete={setBulkDelete}
            onShipAll={() => shipAll.mutate()}
            onTagsDone={() => table.resetRowSelection()}
          />
        )}
      />

      <PickListPrintDialog sackIds={pickListIds} onOpenChange={(o) => !o && setPickListIds(null)} />
      <AssignPackingGroupDialog
        sacks={groupSacks}
        lot={lotMode}
        onOpenChange={(o) => !o && setGroupSacks(null)}
        onDone={() => table.resetRowSelection()}
      />

      {/* Toplu dağıtma — önizlemeli, engelli çuvalları sebebiyle gösterir. */}
      <BulkDistributeSacksDialog
        sackIds={bulkDistribute}
        onOpenChange={(o) => !o && setBulkDistribute(null)}
        onDone={() => {
          setBulkDistribute(null);
          table.resetRowSelection();
        }}
      />
      <BulkDistributeSacksDialog
        sackIds={bulkDelete}
        mod="sil"
        onOpenChange={(o) => !o && setBulkDelete(null)}
        onDone={() => {
          setBulkDelete(null);
          table.resetRowSelection();
        }}
      />
      <CreateShipmentDialog
        sacks={shipSacks}
        onOpenChange={(o) => !o && setShipSacks(null)}
        onCreated={() => {
          setShipSacks(null);
          table.resetRowSelection();
        }}
      />
      <SackDetailSheet sack={detail} onOpenChange={(o) => !o && setDetail(null)} />
      <WeighSackDialog
        sack={weighSack ? { id: weighSack.id, sackNo: weighSack.sackNo, weightKg: weighSack.weightKg } : null}
        onOpenChange={(o) => !o && setWeighSack(null)}
      />
      <SackLabelDialog
        sack={labelSack ? { id: labelSack.id, sackNo: labelSack.sackNo } : null}
        onOpenChange={(o) => !o && setLabelSack(null)}
      />
    </div>
  );
}
