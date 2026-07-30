import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ClipboardList, Eye, PackageOpen, Scale, Tag, Truck } from "lucide-react";
import { SackLabelDialog } from "@/components/labels/SackLabelDialog";
import { Button } from "@/components/ui/button";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { ScanField } from "@/components/scanner/ScanField";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { useScanSeed } from "@/hooks/useScanSeed";
import { useDataTable } from "@/hooks/useDataTable";
import { customerService } from "@/pages/Customers/service";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { sackHubService } from "./service";
import { sacksColumns } from "./sacksColumns";
import { SackContentDumpMenu } from "./SackContentDumpMenu";
import { fromDumpRows } from "./sackDump";
import { RollLocateCard } from "./RollLocateCard";
import { PickListPrintDialog } from "./PickListPrintDialog";
import { CreateShipmentDialog } from "./CreateShipmentDialog";
import { WeighSackDialog } from "./WeighSackDialog";
import { SackDetailSheet } from "./SackDetailSheet";
import { isWarehouseSack, scopeLabels, type LocatedRoll, type SackSearchRow, type SackSearchScope } from "./types";

// Filtreler URL-driven (FilterBar → useSearchParams → useDataTable cursor reset).
// Kapsam omit edilirse backend POOL+PLANNED (sevk edilmemiş) döner — sağlıklı varsayılan.
const SACK_FILTERS: FilterDef[] = [
  {
    kind: "select",
    key: "scope",
    label: "Kapsam",
    // Etiketler `scopeLabels`'tan (TEK KAYNAK) — elle kopyalanmıyor. Buradaki eski
    // kopya "Planlı/Kapıda" diyordu; KAPI ÖNÜ ARA ADIMI KALDIRILDI (PLANNED →
    // DISPATCHED, kök CLAUDE.md) → operatöre artık var olmayan bir aşama gösteriyordu.
    // String kopyalamak aynı bayatlamayı tekrar doğurur.
    options: (Object.keys(scopeLabels) as SackSearchScope[]).map((v) => ({
      value: v,
      label: scopeLabels[v],
    })),
  },
  // Çoklu seçim (VEYA): backend virgülle ayrılmış ID'leri IN'e çevirir (searchSacks).
  { kind: "multi-lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  { kind: "multi-lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  { kind: "numberRange", key: "width", label: "En", unit: "cm" },
];

interface Props {
  onEditSack: (sack: SackSearchRow) => void;
}

/**
 * Çuval listesi (ana görünüm) — Siparişler paritesinde satır/sütunlu DataTable.
 * Depodaki çuvallar seçilebilir (havuzdan sevkiyat) ve tıklayınca editöre açılır;
 * sevkteki çuvallar salt-okunur önizleme sheet'ine düşer.
 */
export function SacksListView({ onEditSack }: Props) {
  const [, setSearchParams] = useSearchParams();
  const [located, setLocated] = useState<LocatedRoll | null>(null);
  const [pickListIds, setPickListIds] = useState<string[] | null>(null);
  const [shipSacks, setShipSacks] = useState<SackSearchRow[] | null>(null);
  const [detail, setDetail] = useState<SackSearchRow | null>(null);
  const [weighSack, setWeighSack] = useState<SackSearchRow | null>(null);
  const [labelSack, setLabelSack] = useState<SackSearchRow | null>(null);

  const { table, query, search, setSearch, pagination } = useDataTable<SackSearchRow>({
    queryKey: "sack-search",
    fetchFn: sackHubService.listSacks,
    columns: sacksColumns,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* TEK satır: birleşik ara/okut kutusu + filtreler + Sütunlar/Görünümler. */}
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        hideSearch
        table={table}
        exportName="Çuvallar"
        leading={
          <>
            <ScanField
              value={search}
              onChange={setSearch}
              onScan={handleScan}
              placeholder="Ara ya da barkod okut…"
              expectPrefix={["ROLL", "SACK"]}
              busy={locate.isPending}
              widthClassName="w-72"
              clearable
            />
            <FilterBar filters={SACK_FILTERS} inline size="md" />
          </>
        }
      />

      {located && <RollLocateCard roll={located} onClear={() => setLocated(null)} />}

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
        selectionHint="Depodaki çuvalları seç → havuzdan sevkiyat kur."
        // Sağdaki jenerik tuşlar ÇUVAL SATIRLARINI indirir; içerik dökümü ayrı menüde.
        selectedExportHint="Ekrandaki çuval listesini indirir — çuvalların İÇİNDEKİ topların dökümü için 'İçerik Dökümü'nü kullanın."
        bulkActions={(rows) => (
          <div className="flex gap-2">
            <Button
              size="sm"
              className="gap-1.5 font-semibold"
              disabled={rows.length === 0}
              onClick={() => setShipSacks(rows)}
            >
              <Truck className="h-4 w-4" /> Sevk Et ({rows.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={rows.length === 0}
              title="Sahada çuval aramak için gruplu özet (ürün·renk·en) — top barkodu içermez"
              onClick={() => setPickListIds(rows.map((r) => r.id))}
            >
              <ClipboardList className="h-4 w-4" /> Çeki Listesi
            </Button>
            {/* İçerik dökümü — top bazlı. Döküm YALNIZ aksiyon tıklanınca çekilir
                (menü açılışı ağ çağrısı yapmaz). hasNote liste satırında zaten var →
                not onay kutusunun görünürlüğü fetch beklemeden çözülür. */}
            <SackContentDumpMenu
              label={`İçerik Dökümü (${rows.length})`}
              disabled={rows.length === 0}
              hasNotes={rows.some((r) => r.hasNote)}
              load={async () => fromDumpRows((await sackHubService.contentDump(rows.map((r) => r.id))).data)}
            />
          </div>
        )}
      />

      <PickListPrintDialog sackIds={pickListIds} onOpenChange={(o) => !o && setPickListIds(null)} />
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
