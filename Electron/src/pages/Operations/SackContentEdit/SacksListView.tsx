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
import { branchLookupService } from "@/pages/Operations/Shipments/service";
import type { BranchLookupItem } from "@/pages/Operations/Shipments/types";
import { loadAllForPicker } from "@/lib/picker-loader";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { sackTagService } from "@/pages/SackTags/service";
import { sackHubService } from "./service";
import { sacksColumns } from "./sacksColumns";
import { SackContentDumpMenu } from "./SackContentDumpMenu";
import { fromDumpRows } from "./sackDump";
import { RollLocateCard } from "./RollLocateCard";
import { PickListPrintDialog } from "./PickListPrintDialog";
import { CreateShipmentDialog } from "./CreateShipmentDialog";
import { WeighSackDialog } from "./WeighSackDialog";
import { SackDetailSheet } from "./SackDetailSheet";
import { SackTagsBulkMenu } from "./SackTagsBulkMenu";
import { BulkDistributeSacksDialog } from "./BulkDistributeSacksDialog";
import {
  CUSTOMERLESS_FILTER_VALUE,
  UNTAGGED_FILTER_VALUE,
  isWarehouseSack,
  scopeLabels,
  type LocatedRoll,
  type SackSearchRow,
  type SackSearchScope,
} from "./types";

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
  {
    kind: "multi-lookup",
    key: "customerId",
    label: "Müşteri",
    service: customerService,
    queryKey: "customers",
    // ⚠️ "Müşterisiz (genel stok)" KATALOGDA YOKTUR — `Sack.customerId` opsiyonel
    // olduğu için gerçek ve büyük bir kümedir (ölçüm 2026-09-04: depodaki 9
    // çuvalın 4'ü). Sentinel eklenene kadar bu küme hiçbir yüzeyden
    // SÜZÜLEMİYORDU; giriş kapısındaki "Müşterisiz" satırı da buraya düşer.
    sentinelOption: { value: CUSTOMERLESS_FILTER_VALUE, label: "Müşterisiz (genel stok)" },
  },
  {
    // ŞUBE — cariye BAĞLI (Siparişler/Sevkiyatlar ile aynı `dependent-lookup`
    // kalıbı; yeni kalıp icat edilmedi). Liste "Şube" kolonunu zaten basıyordu,
    // süzgeci yoktu.
    kind: "dependent-lookup",
    key: "branchId",
    label: "Şube",
    dependsOn: "customerId",
    queryKey: "branch-lookup",
    placeholderNoParent: "Şube (önce müşteri)",
    fetchOptions: (customerCsv) => {
      // ⚠️ "Müşterisiz" SENTİNELİ AYIKLANIR: `customerId` bu ekranda katalogda
      // karşılığı olmayan bir değer (`none`) taşıyabilir (giriş kapısındaki
      // "Müşterisiz (genel stok)" satırı). Ham gönderilse `/api/customer-branches`
      // onu UUID sanar → P2007 → lookup 500. Sentinelden başka bir şey kalmazsa
      // sorgu HİÇ yapılmaz (müşterisiz çuvalın şubesi de olamaz).
      const ids = customerCsv
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v && v !== CUSTOMERLESS_FILTER_VALUE);
      if (ids.length === 0) return Promise.resolve([]);
      return loadAllForPicker(branchLookupService, {
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true", customerId: ids.join(",") },
      }).then((r) => r.data);
    },
    getLabel: (it) => {
      const b = it as Partial<BranchLookupItem> & { id: string };
      if (!b.name) return b.id;
      return b.city ? `${b.name} (${b.city})` : b.name;
    },
  },
  { kind: "multi-lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  // KALİTE (2026-08-13 saha isteği: "hangi çuvalda 2. kalite var?"). Semantik
  // İÇEREN'dir: seçilen kaliteden EN AZ BİR top taşıyan çuvallar gelir — karışık
  // çuval meşru ve zaten aranan da "içine karışmış mı" sorusu.
  // Katalogdan okunur (sabit liste YOK): fabrika kalite ekler/adlandırırsa
  // filtre kendiliğinden doğru kalır.
  {
    kind: "multi-lookup",
    key: "qualityGrade",
    label: "Kalite",
    service: qualityGradeService,
    queryKey: "quality-grades",
  },
  { kind: "numberRange", key: "width", label: "En", unit: "cm" },
  {
    // TARTI — "hangi çuvallar hâlâ tartılmadı?" (ölçüm 2026-09-04, tekserp_demo:
    // 33 çuvalın 32'si tartısız). Liste "Kg" kolonunu basıyor ama süzemiyordu;
    // `shipping.weighRequiredEnabled` açık kurulumda bu liste yapılacak işin kendisi.
    kind: "select",
    key: "weighed",
    label: "Tartı",
    options: [
      { value: "true", label: "Tartıldı" },
      { value: "false", label: "Tartılmadı" },
    ],
  },
  {
    // İÇERİK — yalnız "boş mu" sorulabilir (ilişki sayımına göre aralık süzmesi
    // Prisma'da tek sorguda ifade edilemez); soru gerçek: boş çuval silinir.
    // ⚠️ "Boş" sunucuda HAYALET TOPU dışlayan yüklemle çözülür (PRESENT_ROLL_WHERE)
    // — listedeki "Top: 0" ile bu filtre aynı kümeyi göstermek zorunda.
    kind: "select",
    key: "empty",
    label: "İçerik",
    options: [
      { value: "false", label: "Dolu" },
      { value: "true", label: "Boş" },
    ],
  },
  {
    // ÇUVAL İZİ (2026-09-04) — "kontrol edilecek çuvallar hangileri?".
    // ⚠️ ÇOKLU SEÇİM SEMANTİĞİ **VEYA**: seçilen izlerden EN AZ BİRİNİ taşıyan
    // çuvallar gelir (alan içi OR standardı). Ekranda AÇIKÇA yazılı olması
    // gerekiyor — "ikisi de olanlar" sanan operatör listeyi yanlış okur; etiket
    // metni bu yüzden "Etiket" değil "İz (VEYA)".
    // ⚠️ "İzsiz" katalogda KARŞILIĞI OLMAYAN bir kümedir → `sentinelOption`
    // (müşterisiz kovasının birebir emsali); sunucu sentineli UUID listesinden
    // AYIRIR (`splitTagFilter`), ham geçseydi `@db.Uuid` kolonda P2007 → 400.
    kind: "multi-lookup",
    key: "tagId",
    label: "İz (VEYA)",
    service: sackTagService,
    queryKey: "sack-tags",
    sentinelOption: { value: UNTAGGED_FILTER_VALUE, label: "İzsiz (etiketi olmayan)" },
  },
  {
    // NOT — liste "Not" kolonunu basıyor; "notu olanları göster" tarama sorusu.
    kind: "select",
    key: "hasNote",
    label: "Not",
    options: [
      { value: "true", label: "Notu olanlar" },
      { value: "false", label: "Notu olmayanlar" },
    ],
  },
  {
    // TARİH — `createdAt` sıralanabilir kolonun süzgeç ikizi. "Tartı" alanı
    // seçilirse tartılmamış çuvallar (weighedAt NULL) tanım gereği düşer.
    kind: "dateRange",
    label: "Tarih",
    defaultField: "createdAt",
    fieldOptions: [
      { value: "createdAt", label: "Oluşturma" },
      { value: "weighedAt", label: "Tartı" },
    ],
  },
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [located, setLocated] = useState<LocatedRoll | null>(null);
  const [pickListIds, setPickListIds] = useState<string[] | null>(null);
  const [shipSacks, setShipSacks] = useState<SackSearchRow[] | null>(null);
  /** Toplu dağıtma diyaloğu — seçili çuval id'leri; null = kapalı. */
  const [bulkDistribute, setBulkDistribute] = useState<string[] | null>(null);
  const [detail, setDetail] = useState<SackSearchRow | null>(null);
  const [weighSack, setWeighSack] = useState<SackSearchRow | null>(null);
  const [labelSack, setLabelSack] = useState<SackSearchRow | null>(null);

  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<SackSearchRow>({
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

  // "SEVK EDİLMİŞLERDE ARA" İPUCU — varsayılan kapsam POOL+PLANNED olduğu için sevk
  // edilmiş bir çuval aranınca liste BOŞ döner ve ekran sebebini söylemez; operatör
  // "böyle bir çuval yok" sanır. Okutma yolunda bu telafi zaten vardı
  // (`scanCodeDispatched`), yazarak arama yolunda YOKTU. Varsayılan kapsam
  // DEĞİŞTİRİLMEDİ (bilinçli): "depoda ne var" sorusu sevk edilmişlerle bulanmasın.
  const scopeFilter = searchParams.get("filter[scope]") ?? "";
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
      {/* Üst satır: birleşik ara/okut kutusu + Sütunlar/Görünümler.
          ⚠️ FİLTRELER AYRI SATIRDA (Toplar/Sevkiyatlar kalıbı): filtre sayısı
          6'dan 11'e çıktı ve araç çubuğuna gömülü hâlleri "Sütunlar/Görünümler"i
          ikinci satıra itip filtre şeridini araç çubuğu gibi göstermiyordu. */}
      <DataTableToolbar
        fetchAll={fetchAll}
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
          </>
        }
      />

      <FilterBar filters={SACK_FILTERS} />

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
            {/* İZ — tek popover (bırak + kaldır aynı hamlede; üç durumlu
                kutucuklar). Sonuç PARÇALI olabilir; atlananlar uyarıyla söylenir. */}
            <SackTagsBulkMenu rows={rows} onDone={() => table.resetRowSelection()} />
            {/* DAĞIT — kullanıcının kafasındaki "listeden çuval sil" işi. Gerçekte
                çuval SİLİNMEZ, içeriği depoya çıkar; diyalog bunu söyler ve
                etkilenen HER topu listeler (yıkıcı işlem kuralı). */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={rows.length === 0}
              title="Seçili çuvalların içindeki topları serbest depoya çıkarır — çuval kaydı silinmez"
              onClick={() => setBulkDistribute(rows.map((r) => r.id))}
            >
              <PackageOpen className="h-4 w-4" /> Dağıt ({rows.length})
            </Button>
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
      {/* Toplu dağıtma — önizlemeli, engelli çuvalları sebebiyle gösterir. */}
      <BulkDistributeSacksDialog
        sackIds={bulkDistribute}
        onOpenChange={(o) => !o && setBulkDistribute(null)}
        onDone={() => {
          setBulkDistribute(null);
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
