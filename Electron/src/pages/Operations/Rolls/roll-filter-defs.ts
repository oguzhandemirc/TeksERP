// Kumaş Stoğu süzgeç tanımları — sekmeye göre (Kumaş Stoğu, Kartela, Top Arşivi aynı listeden).
import { useMemo } from "react";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import { stationService } from "@/pages/Stations/service";
import { useFoldValues } from "@/hooks/useFoldValues";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { entryStationLookupService, entryUserLookupService, warehouseLookupService } from "./entryLookupServices";
import type { RollStatusTabKey } from "./service";

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
      { value: "WEAVING", label: "Dokuma (Tezgahtan)" },
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
const SHIPMENT_SCOPE_FILTER: Extract<FilterDef, { kind: "select" }> = {
  kind: "select",
  key: "shipmentScope",
  label: "Sevkiyat",
  options: [
    { value: "free", label: "Serbest depo" },
    { value: "committed", label: "Çuval içinde" },
  ],
};

/** Yalnız "Bitmiş Depo": kartelalık işaretli toplar (filtre satırının sağındaki onay kutusu; backend
 *  filter[markedForKartela]=true, liste · cursor · /rolls/stats aynı buildRollWhere). Sekmeden çıkınca
 *  sekme başına filtre kaydı (`rollPersistConfig`) URL'den siler. */
export const KARTELA_MARKED_PARAM = "filter[markedForKartela]";

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

/** Sekmenin süzgeç tanımları — kat kataloğu ve çok depo durumu kancalardan. */
export function useRollFilterDefs(tab: RollStatusTabKey): FilterDef[] {
  const { values: foldValues } = useFoldValues();
  const { multiWarehouse } = useMultiWarehouse();
  return useMemo(
    () => buildRollFilterDefs(tab, foldValues.map((v) => ({ value: v.code, label: v.name })), multiWarehouse),
    [tab, foldValues, multiWarehouse],
  );
}
