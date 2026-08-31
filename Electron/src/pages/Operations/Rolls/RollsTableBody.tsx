import { useMemo, useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { Factory, PanelRight, Recycle, Ruler, Trash2, Truck } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { CopyMenuItem } from "@/components/data-table/row-menu-items";
import { FilterBar, StandaloneDateRangeFilter, type FilterDef } from "@/components/data-table/FilterBar";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import type { DataTablePagination } from "@/hooks/useDataTable";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import { RollDetailSheet } from "./RollDetailSheet";
import { BulkCancelRollsDialog } from "./BulkCancelRollsDialog";
import { ReworkRollsDialog } from "./ReworkRollsDialog";
import { QuickShipDialog } from "./QuickShipDialog";
import { ShipmentDispatchNote } from "@/pages/Operations/Shipments/ShipmentDispatchNote";
import { canQuickShip, type QuickShipRoll } from "./quickShipService";
import { canAdjustRollQty } from "./qtyAdjustService";
import { RollQtyAdjustDialog } from "./RollQtyAdjustDialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { RollStatusTabKey } from "./service";
import { stationService } from "@/pages/Stations/service";
import { entryStationLookupService, entryUserLookupService, warehouseLookupService } from "./entryLookupServices";
import { useFoldValues } from "@/hooks/useFoldValues";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import type { Roll } from "./types";

/**
 * Liste satırı → Hızlı Sevk satırı. Ad alanları listede zaten çözülü geliyor
 * (`ROLL_LIST_INCLUDE`); diyalog ikinci bir istek atmaz.
 */
function toQuickShipRoll(r: Roll): QuickShipRoll {
  return {
    id: r.id,
    barcode: r.barcode,
    qty: Number(r.currentQty),
    width: r.width,
    itemName: r.item?.name ?? "—",
    colorName: r.color?.name ?? null,
    warehouseId: r.warehouseId ?? null,
  };
}

/** Kat filtresinin yer tutucusu — seçenekleri `buildRollFilterDefs` doldurur. */
const FOLD_FILTER_PLACEHOLDER: FilterDef = {
  kind: "multi-select",
  key: "foldType",
  label: "Kat",
  options: [],
};

const FILTERS: FilterDef[] = [
  {
    kind: "select",
    key: "processingStatus",
    label: "İşlem Durumu",
    options: [
      { value: "raw", label: "Ham" },
      { value: "processed", label: "İşleniyor" },
      { value: "finished", label: "Bitmiş" },
      { value: "open_fabric", label: "Açık Kumaş" },
    ],
  },
  // Kumaş/renk ÇOKLU (VEYA): "patos VEYA saten", "mavi VEYA kırmızı". Backend
  // `buildRollWhere` CSV'yi `readIdCondition` ile `in`'e çevirir; iki filtre
  // birlikte verilirse AND'lenir (kesişim) — `/rolls/stats` de aynı where'i
  // paylaştığı için sayaçlar listeyle tutarlı kalır.
  {
    kind: "multi-lookup",
    key: "itemId",
    label: "Kumaş",
    service: itemService,
    queryKey: "items",
  },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    kind: "multi-lookup",
    key: "propertyIds",
    label: "Özellik",
    service: fabricPropertyService,
    queryKey: "fabric-properties",
  },
  { kind: "numberRange", key: "width", label: "En", unit: "cm" },
  { kind: "numberRange", key: "qty", label: "Boy", unit: "mt" },
  // KAT — seçenekler KATALOGDAN enjekte edilir (aşağıdaki `buildRollFilterDefs`).
  // Sabit liste, panelden eklenen 6-KAT'ı filtrede GÖRÜNMEZ yapardı ve backend
  // değeri kanonik tuttuğu için serbest metin de sessizce 0 sonuç verirdi.
  // Buradaki `options` yer tutucudur; boşsa filtre HİÇ ÇİZİLMEZ.
  FOLD_FILTER_PLACEHOLDER,
  // GİRİŞ KAYNAĞI (2026-08-04): "elle eklenen toplar" tek filtreyle çıksın.
  // Zincir-dışı doğan topları (Tambur manuel / Electron manuel) saymak ve
  // sebeplerine bakmak için — manuel giriş bir semptomdur, ölçülmeden
  // kaynağındaki sorun (etiket kopması, kayıt atlanması) çözülemez.
  // Backend filtresi HAZIRDI: buildWhereClause düz Roll alanlarını geçiriyor.
  {
    // ÇOKLU: "elle eklenen toplar" iki kaynağa birden dağılıyor (Tambur manuel +
    // Electron manuel) — tek seçimle sayılamıyordu.
    //
    // ⚠️ `entrySource` anahtarına yazan TEK filtre budur. 2026-08-17'de Ham Stok'a
    // ikinci bir "Giriş Türü" filtresi eklenmişti (aynı anahtar, farklı seçenekler)
    // — ikisi aynı URL parametresine yazıp birbirini eziyordu. Yarı mamul kendi
    // sekmesine taşınınca o filtrenin varlık sebebi de kalktı, silindi (2026-08-26).
    // İkinci bir entrySource filtresi EKLEME; seçenek gerekiyorsa buraya ekle.
    kind: "multi-select",
    key: "entrySource",
    label: "Giriş Kaynağı",
    options: [
      { value: "SUPPLIER_RECEIPT", label: "Ham Giriş" },
      { value: "SEMI_FINISHED", label: "Yarı Mamul (Dış Alım)" },
      { value: "TAMBUR_SPLIT", label: "Tambur Kesim" },
      { value: "SUBCONTRACTOR_RETURN", label: "Fason Dönüşü" },
      { value: "TAMBUR_MANUAL", label: "Tambur (Manuel)" },
      { value: "MANUAL_ENTRY", label: "Manuel Giriş" },
    ],
  },
  // GİRİŞ İSTASYONU (2026-08-12): "bu top SİSTEME nereden girdi" — kalıcı köken.
  // Yukarıdaki "İstasyon" (currentStationId) topun ŞU AN bulunduğu yerdir; ikisi
  // farklı soru. Seçenekler kataloğun tamamı değil, gerçekten giriş istasyonu
  // olmuş istasyonlar (/rolls/entry-stations). Backend'de generic yol karşılar
  // (CSV→in otomatik; bekçi: test_filter_multi_select §2b).
  {
    kind: "multi-lookup",
    key: "entryStationId",
    label: "Giriş İstasyonu",
    service: entryStationLookupService,
    queryKey: "roll-entry-stations",
  },
  // DEPO (2026-08-13): malın ŞU AN hangi FİZİKSEL depoda durduğu.
  // ⚠️ Üç komşu filtreyle karıştırma — dördü FARKLI soru sorar:
  //   İstasyon (currentStationId)    → şu an hangi ÜRETİM noktasında
  //   Giriş İstasyonu (entryStationId) → sisteme nereden GİRDİ (kalıcı köken)
  //   Giriş Kaynağı (entrySource)     → girişin TÜRÜ
  //   Depo (warehouseId)              → hangi BİNADA duruyor
  // Yalnız ÇOK DEPOLU kurulumda listeye eklenir (tek depoda ayırt edeceği şey yok).
  {
    kind: "multi-lookup",
    key: "warehouseId",
    label: "Depo",
    service: warehouseLookupService,
    queryKey: "warehouses-filter",
  },
  // EKLEYEN (2026-08-12): "hangi personel girdi". Kolon 2026-08-05'ten beri
  // vardı, filtre yoktu — 50 bin satırda gözle aranıyordu. Seçenekler yalnız
  // top girmiş kullanıcılar (/rolls/entry-users) — admin:users GEREKMEZ.
  {
    kind: "multi-lookup",
    key: "createdById",
    label: "Ekleyen",
    service: entryUserLookupService,
    queryKey: "roll-entry-users",
  },
];

// İSTASYON (2026-08-05): "şu makinede ne var" — topun ŞU AN bulunduğu istasyon.
// Tür değil KİMLİK filtrelenir (tür iki boyahaneyi tek seçenekte birleştirirdi).
// ⚠️ Backend bu alanı UUID regex'inden geçirir; süzgeç listenin her elemanına
// uygulanmazsa filtre sessizce düşer (bekçi ölçümü: 2 yerine 6 satır).
// ⚠️ base FILTERS'ta DEĞİL: yalnız üretim sekmelerinde eklenir (buildRollFilterDefs) —
// Ham Stok/Bitmiş Depo'da anlamı yok, hep boş liste döndürüp "bozuk" görünüyordu.
const CURRENT_STATION_FILTER: FilterDef = {
  kind: "multi-lookup",
  key: "currentStationId",
  label: "İstasyon",
  service: stationService,
  queryKey: "stations",
};

export const DATE_FILTER = { kind: "dateRange", label: "Tarih", defaultField: "createdAt" } as const;

/**
 * ARŞİV — "hangi tür emeklilik" daraltması.
 *
 * ⚠️ Anahtar bilerek `statusIn`, `status` DEĞİL: backend'de öncelik
 * `statusIn[] > status > varsayılan` şeklindedir, yani bu filtre sayfanın
 * zorunlu `status` kümesini EZER. Seçenekler arşiv kümesinin ALT KÜMESİ olduğu
 * için ezmek zararsız — kullanıcı arşivin dışına çıkamaz. `status` anahtarını
 * kullansaydık iki değer aynı alana yazılır ve hangisinin kazandığı belirsiz
 * kalırdı.
 */
const ARCHIVE_STATUS_FILTER: FilterDef = {
  kind: "multi-select",
  key: "statusIn",
  label: "Kayıt Türü",
  options: [
    { value: "CANCELLED", label: "İptal edilmiş (kayıt hatası)" },
    { value: "SCRAP", label: "Fire (mal vardı, gitti)" },
    { value: "TAMBUR_CONSUMED", label: "Tambur'da kesilmiş" },
    { value: "SUBCONTRACTOR_CONSUMED", label: "Fasonda tüketilmiş" },
    { value: "KARTELA_CONSUMED", label: "Kartelaya dönüşmüş" },
    { value: "RETURNED_FROM_SUBCONTRACTOR", label: "Fason dönüşü" },
  ],
};

/**
 * Sekmenin KAPSAMI dışında kalan giriş kaynağı seçeneklerini eler.
 *
 * Force filtre bir kaynağı zaten dışladıysa onu listede bırakmak, seçilince
 * **daima 0 satır** döndüren ölü bir kontrol vaat eder (kat filtresi ve
 * "İstasyon" filtresiyle aynı ders). Sekmede tek seçenek kalıyorsa filtre hiç
 * çizilmez — seçeneksiz kutu da aynı yalanı söyler.
 */
function narrowEntrySource(tab: RollStatusTabKey, defs: FilterDef[]): FilterDef[] {
  // Yarı Mamul sekmesinde her satır zaten SEMI_FINISHED — filtre anlamsız.
  const drop: string | null =
    tab === "SEMI_FINISHED" ? "*" : tab === "RAW_STOCK" ? "SEMI_FINISHED" : null;
  if (drop === null) return defs;
  return defs.flatMap<FilterDef>((f) => {
    if (f.kind !== "multi-select" || f.key !== "entrySource") return [f];
    if (drop === "*") return [];
    return [{ ...f, options: f.options.filter((o) => o.value !== drop) }];
  });
}

// Sadece "Bitmiş Depo" sekmesinde anlamlı: WAREHOUSE topu serbest mi yoksa bir
// çuvala/sevkiyata rezerve mi? (backend filter[shipmentScope]=free|committed)
const SHIPMENT_SCOPE_FILTER: FilterDef = {
  kind: "select",
  key: "shipmentScope",
  label: "Sevkiyat",
  options: [
    { value: "free", label: "Serbest depo" },
    { value: "committed", label: "Çuval içinde" },
  ],
};

// Yalnız "Fasonda" sekmesi: aktif fason sevkine göre firma + işlem (kategori)
// daraltması. Özet şeridi chip/kartları da AYNI filter anahtarlarına yazar —
// FilterBar dropdown'ı ile chip seçimi tek URL state'inde buluşur.
// Firma/işlem ÇOKLU: her biri kendi içinde VEYA, ikisi arasında AND — yani
// "seçili firmalardan birindeki, seçili işlemlerden birini gören toplar".
const FASON_FILTERS: FilterDef[] = [
  {
    kind: "multi-lookup",
    key: "subcontractorId",
    label: "Fason Firması",
    service: subcontractorService,
    queryKey: "subcontractors",
  },
  {
    kind: "multi-lookup",
    key: "subcontractorCategoryId",
    label: "İşlem",
    service: subcontractorCategoryService,
    queryKey: "subcontractor-categories",
  },
];

// Serbest/rezerve filtresi yalnız depo (Bitmiş Depo); fason filtreleri yalnız Fasonda.
//
// `foldOptions` katalogdan gelir (`useFoldValues`). BOŞ ise kat filtresi listeden
// DÜŞÜRÜLÜR: seçeneksiz bir çoklu-seçim kutusu, kullanıcıya tıklayıp hiçbir şey
// bulamayacağı ölü bir kontrol vaat eder.
export function buildRollFilterDefs(
  tab: RollStatusTabKey,
  foldOptions: { value: string; label: string }[] = [],
  multiWarehouse = false,
): FilterDef[] {
  // `kind` ile daralt: FilterDef bir union ve `dateRange` varyantında `key` YOK
  // (düz `f.key` derlenmez).
  const base = narrowEntrySource(
    tab,
    FILTERS.flatMap<FilterDef>((f) => {
      if (f.kind === "multi-lookup" && f.key === "warehouseId") {
        // TEK DEPOLU kurulumda düşürülür: seçeneksiz/tek seçenekli bir kutu,
        // kullanıcıya ayırt edecek bir şey vaat eder ama hiçbir şey ayırmaz
        // (kat filtresinin boş katalogda düşürülmesiyle aynı gerekçe).
        return multiWarehouse ? [f] : [];
      }
      if (f.kind !== "multi-select" || f.key !== "foldType") return [f];
      return foldOptions.length > 0 ? [{ ...f, options: foldOptions }] : [];
    }),
  );
  if (tab === "FINISHED_STOCK") return [...base, SHIPMENT_SCOPE_FILTER];
  if (tab === "SUBCONTRACTOR") return [...base, ...FASON_FILTERS];
  if (tab === "ARCHIVE") return [...base, ARCHIVE_STATUS_FILTER];
  // İSTASYON (currentStationId) YALNIZ topun gerçekten bir istasyonda DURDUĞU
  // sekmelerde: "şu an nerede" filtresi Ham Stok / Bitmiş Depo'da her zaman boş
  // döner (o toplarda currentStep yok) ve saha bunu "filtre bozuk" diye okudu
  // (2026-08-12). "Nereden girdi" sorusunun cevabı Giriş İstasyonu filtresidir.
  if (tab === "PRODUCTION" || tab === "KURSUN_PENDING" || tab === "TAMBUR_PENDING") {
    return [...base, CURRENT_STATION_FILTER];
  }
  return base;
}

interface Props {
  tab: RollStatusTabKey;
  /** Tablo örneği + yükleme/sayfalama ÇAĞIRAN'da kurulur (useDataTable). Gövde salt
   *  görünüm: filtre satırı + tablo + detay/iptal diyalogları. */
  table: Table<Roll>;
  isLoading: boolean;
  pagination: DataTablePagination;
  /** true ise dahili filtre satırı çizilmez — çağıran filtreleri kendi araç
   *  çubuğuna (ör. okutma kutusuyla aynı satıra) taşımak istiyor (Kartela). */
  hideFilterBar?: boolean;
  /** Seçili satırların PDF/Excel indirme dosya adı öneki (ör. "Envanter"). Verilmezse
   *  DataTable varsayılanı ("Liste") kullanılır. */
  exportName?: string;
  /** Sayfalama çubuğunun sağına eklenen aksiyonlar ("Tümünü İndir" + "Envanter Özeti"). */
  paginationActions?: ReactNode;
}

/**
 * Rulo tablosunun GÖVDESİ — filtre satırı + DataTable + detay paneli + toplu iptal.
 * Tabloyu kendisi kurmaz (Sütunlar/Görünümler araçlarının konumunu çağıran seçsin
 * diye). Envanter sayfası (RollsPage) ve Kartela ("Kartelada Toplar" sekmesi)
 * tabloyu kendi üst chrome'unda kurup araçları istediği satıra (okut/ara satırı,
 * sekme şeridi vb.) yerleştirir; `hideFilterBar` ile bu gövdenin kendi filtre
 * satırı bastırılabilir.
 */
export function RollsTableBody({
  tab,
  table,
  isLoading,
  pagination,
  hideFilterBar = false,
  exportName,
  paginationActions,
}: Props) {
  const [selected, setSelected] = useState<Roll | null>(null);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [quickShipOpen, setQuickShipOpen] = useState(false);
  const [shippedId, setShippedId] = useState<string | null>(null);
  // G4 — sayım metraj düzeltmesi (yalnız ticaret rejimi + roll:manual-adjust).
  const [qtyAdjustRoll, setQtyAdjustRoll] = useState<Roll | null>(null);
  const { hasPermission } = useRoleAccess();
  const canManualAdjust = hasPermission("roll:manual-adjust");

  const { values: foldValues } = useFoldValues();
  // Depo filtresi yalnız ÇOK DEPOLU kurulumda listeye girer (tek kaynak hook).
  const { multiWarehouse } = useMultiWarehouse();
  const filters = useMemo(
    () =>
      buildRollFilterDefs(
        tab,
        foldValues.map((v) => ({ value: v.code, label: v.name })),
        multiWarehouse,
      ),
    [tab, foldValues, multiWarehouse],
  );

  // Toplu iptal — Ham Stok + Bitmiş Depo'da sunulur (STOCK/WAREHOUSE→CANCELLED,
  // yanlış giriş düzeltmesi). Backend softDelete WAREHOUSE'a izin verir; rezerve
  // topsa çuval/sevkiyattan da çıkarır. Seçili satırlar TanStack table state'inden okunur.
  const selectedRolls = table.getSelectedRowModel().rows.map((r) => r.original);
  // ⚠️ Sekme listeleri AÇIK yazılır, "X değilse" diye NEGATİF kurulmaz: bu gövdeyi
  // Kartela ("Kartelada Toplar") ve Top Arşivi sayfaları da kullanıyor — negatif
  // koşul oralara toplu iptal/üretim butonu sızdırır.
  const bulkCancelable =
    tab === "RAW_STOCK" || tab === "SEMI_FINISHED" || tab === "FINISHED_STOCK";
  /**
   * ÜRETİME AL — seçili topları yeni bir iş emrine sokar (`quick-start`).
   *
   * ⚠️ 2026-08-26'da KARAR DÖNDÜ. Buton eskiden yalnız Bitmiş Depo'daydı ve
   * gerekçesi şuydu: *"Ham Stok'ta gösterilmez, oradaki top zaten üretime
   * girmemiş — normal iş emri açma yolu kullanılır."* O yol masaüstünde YOK:
   * Yeni İş Emri formu top almıyor ve mevcut iş emrine top ekleme ucu
   * 2026-06-12'de kaldırıldı. Yani gizlenen buton, olmayan bir kuralı taklit
   * ediyordu ve ham stoktaki top (özellikle dışarıdan alınan yarı mamul)
   * masaüstünden hiçbir iş emrine bağlanamıyordu.
   *
   * Backend baştan beri üçünü de kabul ediyor: STOCK / WAREHOUSE / A1_STOCK.
   */
  const reworkable =
    tab === "RAW_STOCK" || tab === "SEMI_FINISHED" || tab === "FINISHED_STOCK";
  // Bitmiş depo topu "yeniden" üretime alınır (bir tur görmüş); ham stok ve yarı
  // mamul ilk kez girer. Fark yalnız başlık/ikon/toast metnindedir.
  const reworkMode = tab === "FINISHED_STOCK" ? "rework" : "start";
  // HIZLI SEVK GÖRÜNÜRLÜĞÜ — iki koşul, ikisi de gerekli:
  //  ① Sekme "Bitmiş Depo": sevk edilebilir topların yaşadığı tek sekme. Diğer
  //     sekmelerdeki toplar tanım gereği sevk edilemez (üretimde/fasonda/çuvalda)
  //     ve buton orada sürekli 400 üreten ölü bir yol olurdu.
  //  ② TİCARET REJİMİ (`finance.enabled`): FABRİKADA SIFIR FARK kuralı. Fabrikanın
  //     sevk akışı FİZİKSEL çuval üzerinden yürür (Paketleme/Çuvallar; ihracatta
  //     çuval tartısı zorunlu) — orada "tartısız çuvalı otomatik açan" bir kestirme
  //     yeni bir yol AÇMAK olurdu, mevcut yolu hızlandırmak değil.
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const quickShippable = canQuickShip(tab, financeEnabled);

  return (
    <>
      {/* Filtre satırı — tarih aralığı en başta. */}
      {!hideFilterBar && (
        <FilterBar filters={filters} leading={<StandaloneDateRangeFilter def={DATE_FILTER} />} />
      )}
      <DataTable<Roll>
        table={table}
        isLoading={isLoading}
        pagination={pagination}
        paginationActions={paginationActions}
        emptyText="Top bulunamadı."
        exportName={exportName}
        // Seçim çubuğunda ipucu metni yok (sevkiyat ekranlarıyla tutarlı) — "Seçili
        // PDF/Excel" ve varsa "Stoktan Kaldır" butonları zaten kendini anlatıyor.
        selectionHint={null}
        onRowClick={setSelected}
        // Ham Stok'ta seçim çubuğuna "Stoktan Kaldır" (iptal) — DataTable bunu
        // alt şeride (Seçimi temizle'nin yanına) koyar; ayrı üst şerit yok.
        bulkActions={
          bulkCancelable || reworkable || quickShippable
            ? (rows) =>
                rows.length > 0 ? (
                  <>
                    {/* HIZLI SEVK — "seçtiklerimi gönder". Yalnız Bitmiş Depo
                        sekmesinde + ticaret rejiminde (bkz. yukarıdaki yüklem). */}
                    {quickShippable && (
                      <PermissionGate permission="shipping:write">
                        <Button size="sm" className="gap-1.5" onClick={() => setQuickShipOpen(true)}>
                          <Truck className="h-4 w-4" /> Seçilenleri Sevk Et
                        </Button>
                      </PermissionGate>
                    )}
                    {reworkable && (
                      // İzin `workorder:write` — uç zaten onu kabul ediyor
                      // (`quick-start`). Yeni izin kodu AÇILMADI.
                      <PermissionGate permission="workorder:write">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => setReworkOpen(true)}
                        >
                          {reworkMode === "rework" ? (
                            <>
                              <Recycle className="h-4 w-4" /> Yeniden Üretime Al
                            </>
                          ) : (
                            <>
                              <Factory className="h-4 w-4" /> Üretime Al
                            </>
                          )}
                        </Button>
                      </PermissionGate>
                    )}
                    {bulkCancelable && (
                      <PermissionGate permission="roll:write">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1.5"
                          onClick={() => setBulkCancelOpen(true)}
                        >
                          <Trash2 className="h-4 w-4" /> Stoktan Kaldır
                        </Button>
                      </PermissionGate>
                    )}
                  </>
                ) : null
            : undefined
        }
        rowContextMenu={(roll) => (
          <>
            <ContextMenuItem onSelect={() => setSelected(roll)}>
              <PanelRight /> Detayı aç (panel)
            </ContextMenuItem>
            {/* G4 — "Metraj Düzelt" (sayım): YALNIZ ticaret rejiminde çizilir
                (`canAdjustRollQty` yüklemi financeEnabled'ı da içerir, bekçili:
                qtyAdjust.test.ts) + roll:manual-adjust. Fabrika yüzeyi bugünküyle
                birebir — orada metraj istasyon akışının işidir. */}
            {canManualAdjust && canAdjustRollQty(roll, financeEnabled) && (
              <ContextMenuItem onSelect={() => setQtyAdjustRoll(roll)}>
                <Ruler /> Metraj Düzelt (sayım)
              </ContextMenuItem>
            )}
            {roll.barcode && (
              <>
                <ContextMenuSeparator />
                <CopyMenuItem label="Barkod" value={roll.barcode} />
              </>
            )}
          </>
        )}
      />
      <RollDetailSheet
        roll={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
      <RollQtyAdjustDialog
        roll={qtyAdjustRoll}
        onOpenChange={(open) => !open && setQtyAdjustRoll(null)}
      />
      <BulkCancelRollsDialog
        open={bulkCancelOpen}
        onOpenChange={setBulkCancelOpen}
        rolls={selectedRolls}
        onDone={() => table.resetRowSelection()}
      />
      <ReworkRollsDialog
        open={reworkOpen}
        onOpenChange={setReworkOpen}
        mode={reworkMode}
        rolls={selectedRolls}
        onDone={() => table.resetRowSelection()}
      />
      {/* Koşullu mount: her açılış taze bileşen → seçim `useState` başlangıcı
          olarak girer, prop senkronu (ve onun sonsuz döngü riski) gerekmez. */}
      {quickShipOpen && (
        <QuickShipDialog
          open
          onOpenChange={(open) => {
            setQuickShipOpen(open);
            if (!open) table.resetRowSelection();
          }}
          initialRolls={selectedRolls.map(toQuickShipRoll)}
          onShipped={setShippedId}
        />
      )}
      {/* Sevk sonrası kestirme: irsaliye. Kullanıcı sevk ekranını aramaz —
          kâğıt zaten sevk anında istenen tek şeydir. */}
      <ShipmentDispatchNote
        shipmentId={shippedId}
        open={Boolean(shippedId)}
        onOpenChange={(open) => !open && setShippedId(null)}
      />
    </>
  );
}
