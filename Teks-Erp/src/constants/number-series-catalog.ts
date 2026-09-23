// =============================================================================
// NUMARA SERİSİ KATALOĞU — kimlik koda, biçim veriye (2026-09-22)
// =============================================================================
// Bu dosya "hangi seriler VAR" sorusunu cevaplar; "bu serinin ön eki NE" sorusunu
// `number_series` tablosu cevaplar. Ayrım izin kataloğunun birebir emsalidir
// (`permission-catalog.ts` + boot uzlaştırması): katalog satırı ekler, DB'dekini
// DEĞİŞTİRMEZ — fabrikanın seçtiği ön ek bir daha koda dönmez.
//
// Kod-sahipli alanlar (her boot'ta katalogdan tazelenir): `label`, `kind`,
// `scanned`, `editable`. Veri-sahipli alanlar (yalnız panel yazar):
// `prefix`, `dateSegment`, `digits`, `separator`, `retiredPrefixes`.
//
// ⚠️ `seed*` değerleri BUGÜNKÜ ÜRETEÇLERDEN ÖLÇÜLDÜ; bekçi `test_number_series §1`
// her satırı gerçek üreteçle karşılaştırır. Buraya "olması gereken" yazma, OLANI yaz.
// =============================================================================
import type { NumberSeriesDateSegment } from "@prisma/client";

/** Barkod sınıflandırmasında kodun hangi varlığa çözüleceği (yalnız `scanned` seriler). */
export type NumberSeriesKind =
  | "ROLL"
  | "TRAVELER_CARD"
  | "SWATCH"
  | "SACK"
  | "SHIPMENT"
  | "DISPATCH_DOC";

export interface NumberSeriesCatalogEntry {
  key: string;
  label: string;
  seedPrefix: string;
  seedDateSegment: NumberSeriesDateSegment;
  seedDigits: number;
  seedSeparator: string;
  seedRetiredPrefixes?: string[];
  /** Okutulan kod mu? Küresel ön ek tekilliği YALNIZ bu kümede aranır. */
  kind?: NumberSeriesKind;
  /**
   * Panelden biçimi değiştirilemeyen seri + GEREKÇESİ. Gerekçe zorunlu: "kilitli"
   * demek bir karardır ve karar gerekçesiz yazılmaz.
   */
  lockedReason?: string;
  /**
   * Tarih ile sıra ARASINDA duran sabit parça (regex parçası). Serinin YAPISAL
   * özelliğidir, biçim AYARI değil — fabrika panelden değiştiremez, bu yüzden
   * `number_series` tablosunda değil burada, kodda yaşar.
   */
  infix?: { re: string; aciklama: string };
  /**
   * ÜRETEÇ BAĞI — bu satır üreteci SÜRÜYOR mu, yoksa yalnız TARİF mi ediyor?
   *
   * Normalde katalog satırı üreteci SÜRER: üreteç biçimi `resolveSeriesFormat`
   * ile bir kez okur, ön eki `seriesPrefix`ten, haneyi `formatSeriesCode`tan
   * alır. Alan VARSA bu bağ YOKTUR — üreteç kodu
   * kendi literalleriyle kurar ve katalog satırı yalnız sınıflandırma/tarif
   * içindir. Beyan ZORUNLU çünkü beyansız hâli SESSİZ BİR YALANDIR: panel
   * satırı gösterir, fabrika biçimi değiştirdiğini sanır, üreteç eski kodu
   * yazmaya devam ederdi.
   *
   * ⚠️ Beyanlı satır `lockedReason` da taşımalı (bekçi `test_number_series §11c`):
   * sürmediğimiz bir biçimi panelden düzenlemeye AÇAMAYIZ.
   *
   * `uretec` üreteç dosyasının `src/` göreli yoludur — §11b'nin literal taraması
   * muafiyetini BURADAN okur, kendi içine gömülü bir listeden değil.
   */
  uretecBagi?: { durum: "tarif"; uretec: string; not: string };
  /**
   * KENDİ SAYAÇ MEKANİZMASI olan seri — sırası "mevcut kodların SAYISAL max'ı"
   * ile bulunmaz. Sayaç ayarları (başlangıç · adım · üst sınır) bu serilerde
   * FAIL-CLOSED reddedilir (400), çünkü ayar hiçbir şey yapmazdı ve bu SESSİZ
   * olurdu — kullanıcı "adımı 10 yaptım" der, üreteç 1'er artmaya devam ederdi.
   *
   * ⚠️ Biçim kilidiyle (`lockedReason`) AYRI BİR SORU: `workOrder` biçimi kilitli
   * ama sayacı max-türetilmiş, yani sayaç ayarları ORADA anlamlıdır. İki kilit
   * iki farklı gün kalkar.
   */
  ownCounter?: { not: string };
  /**
   * ELLE NUMARA YOLU olan seri — `numberSource` ayarı YALNIZ burada anlamlıdır.
   * Ölçüldü 2026-09-23: 52 serinin yalnız DÖRDÜNDE elle değer kabul eden bir yol
   * var. Kalan 48'de ayarı açmak, OLMAYAN bir kabul yolunu inşa etmek demek
   * olurdu; panel orada alanı hiç çizmez, uç 400 döner (`ownCounter` kalıbı).
   *
   * `path` yolun yeri — bekçi burayı okuyup gerçekten var olduğunu ölçer.
   */
  manualEntry?: { path: string; not: string };
  /**
   * SAYACIN KAPSAMI BİÇİM DEĞİŞİMİNE HAZIR MI? (Faz C ön koşulu C0)
   *
   * ⚠️ KONFİGÜRASYON SINIRI, üretim sınırı DEĞİL: bu alan yoksa serinin biçimi
   * PANELDEN DEĞİŞTİRİLEMEZ (`updateSeriesFormat` 400
   * `NUMBER_SERIES_COUNTER_NOT_SCOPED`), ama numara üretimi bugünkü gibi sürer.
   * Ters kurgu — üretimde fail-closed — çuvalı açılamaz hâle getirirdi; asıl
   * engellenmesi gereken RİSKLİ AYAR DEĞİŞİKLİĞİDİR.
   *
   * Alan YOKSA üçüncü sonuç geçerlidir: *ölçülmedi / çağrı yeri hazır değil.*
   * `durum` iki hazır hâli ayırır ve `not` GEREKÇEYİ taşır — beyan burada yaşar,
   * commit mesajında değil, çünkü okunması gereken yer burasıdır.
   */
  scopedCounter?: { durum: "hazir" | "sayac-yok"; not: string };
  /**
   * Panelde hangi bölümde görünür. ZORUNLU (bekçi `test_number_series_panel §4d`):
   * etiketsiz seri ekrandan DÜŞER ve "çuval numarası neden burada yok?"
   * sorusunun ekranda cevabı olmaz. Kilitli seriler de çizilir — gerekçeleriyle.
   */
  panelGroup: NumberSeriesPanelGroup;
  /**
   * ETKİ CÜMLESİNİN kaynağı: bu seriyle numaralanmış şeyin sayısı nereden
   * okunur. Panel "bugüne kadarki N …nin numarası değişmez" derken bu sayıyı
   * kullanır ve sayı UYDURULMAZ — ölçülür. Alan yoksa panel sayı YAZMAZ
   * (üçüncü sonuç: "ölçülmedi"), "0" demez.
   *
   * ⚠️ `birim` BEYAN ZORUNLUDUR çünkü SATIR ile BELGE aynı şey değildir: iade
   * numarası çok kalemli iadede ÜYE satırlara da kopyalanır, yani `count(*)`
   * üç satırı üç belge sayardı ve cümle yalan olurdu ("1.314 iade" ≠ "438
   * iade belgesi"). Ekrandaki cümle bu birimden kurulur.
   *
   * ⚠️ `field` ZORUNLU bir kolon OLMALI, ya da `where` ile null'lar ELENMELİ —
   * nullable bir kolonda "satır sayısı" ile "numaralanmış sayı" ayrışır.
   * Şart `test_number_series_panel §4`te şema METNİNDEN ölçülür (çalışma
   * anında yapılamıyor: Prisma 7 DMMF alanı `isRequired` taşımıyor).
   */
  countTable?: {
    model: string;
    field: string;
    birim: "kayıt" | "belge";
    /**
     * Sayım yüklemi — KAPALI KÜME, serbest `where` nesnesi DEĞİL.
     *
     * ⚠️ Katalog bir SABİTLER dosyasıdır ve prisma'ya bağlanamaz; oysa belge
     * çapası yüklemi kolon-kolon karşılaştırma ister (`returnGroupId = id`) ve
     * o ancak prisma'nın alan referansıyla kurulur (ölçüldü: Prisma 7
     * `p.rollReturn.fields.id` DESTEKLİYOR). Bu yüzden katalog yüklemin ADINI
     * yazar, gerçek yüklemi servis kurar. Serbest nesne olsaydı, katalogda
     * çalışmayan bir `where` sessizce yanlış sayı üretirdi.
     *
     * · `belge-capasi` — tekil kayıt ya da grup lideri (iade belgesi).
     * · `seri-onekli`  — AYNI TABLOYU BİRDEN ÇOK SERİ paylaşıyor; sayım yalnız
     *   BU serinin ön ekiyle (emekli ön ekler dahil) başlayan kodları sayar.
     *   Beyansız bırakılırsa düz `count(*)` dört fatura serisinin TOPLAMINI
     *   basar ve cümle "bugüne kadarki N satış faturası" derken yalan söyler —
     *   `null` değil, YANLIŞ bir sayı; bu yüzden ölçüldüğü yerde (bekçi
     *   `test_number_series_panel §4`) paylaşım varsa beyan ZORUNLUDUR.
     */
    kapsam?: "belge-capasi" | "seri-onekli";
  };
}

/**
 * PANEL BÖLÜMLERİ — sıra ve ETİKET burada, tek kaynak.
 *
 * ⚠️ Etiket panelde KOPYALANMAZ, satırla birlikte gider (`countBirim` emsali):
 * iki yerde yaşayan bir etiket bayatlar ve yeni bir grup eklendiğinde panel onu
 * SESSİZCE düşürürdü — "kaydedilen ama görünmeyen kayıt" sınıfı.
 */
export const NUMBER_SERIES_PANEL_GROUPS = [
  { key: "uretim", label: "Üretim" },
  { key: "sevkiyat", label: "Sevkiyat" },
  { key: "depo-ticaret", label: "Depo ve ticaret" },
  { key: "fason-kartela", label: "Fason ve kartela" },
  { key: "finans", label: "Finans" },
  { key: "master-veri", label: "Master veri kodları" },
] as const;

export type NumberSeriesPanelGroup = (typeof NUMBER_SERIES_PANEL_GROUPS)[number]["key"];

export function numberSeriesPanelGroupLabel(g: NumberSeriesPanelGroup): string {
  return NUMBER_SERIES_PANEL_GROUPS.find((x) => x.key === g)!.label;
}

const D = "DDMMYY" as NumberSeriesDateSegment;
const NONE = "NONE" as NumberSeriesDateSegment;
const YYMM = "YYMM" as NumberSeriesDateSegment;

export const NUMBER_SERIES_CATALOG: readonly NumberSeriesCatalogEntry[] = [
  // ── Okutulan seriler (istemci sınıflandırmasına girer) ─────────────────────
  {
    key: "roll",
    ownCounter: { not: "Sıra `roll_barcode_counters` tablosundan atomik olarak alınır (`INSERT … ON CONFLICT DO UPDATE n = n + :count RETURNING n`), mevcut kodlardan türetilmez; kapasite ayrı bir sabittir (`MAX_ROLL_SEQ`)." },
    panelGroup: "uretim",
    label: "Top barkodu",
    seedPrefix: "T",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "ROLL",
    infix: { re: "[HF]", aciklama: "faz harfi (H=ham · F=final) — `RollBarcodeCounter` anahtarının parçası, biçim ayarı değil" },
    uretecBagi: {
      durum: "tarif",
      uretec: "services/helpers/roll-barcode.helper.ts",
      not:
        "Üreteç ön eki `T`, altı haneli tarihi ve dört haneyi LİTERAL yazar; ayrıca " +
        "`ROLL_BARCODE_RE` ve `rollBarcodePrefix` aynı literalleri ikinci ve üçüncü kez " +
        "taşır ve `MAX_ROLL_SEQ = 9999` dört haneye çivilidir. Üçünü birden seriye " +
        "bağlamak tek satırlık iş değil; seri KİLİTLİ olduğu için davranış riski yok, " +
        "ama bağ olmadığı BEYAN EDİLİR — bu satır sınıflandırma (`kind`/`infix`) içindir, " +
        "üreteci sürmez.",
    },
    lockedReason:
      "Kod tarih ile sıra ARASINDA faz harfi taşır (H/F) ve bu harf `RollBarcodeCounter` anahtarının parçasıdır; yapı seri biçimiyle ifade edilemez.",
  },
  {
    key: "workOrder",
    manualEntry: { path: "services/workorder.service.ts", not: "İş emri açılırken KÖPRÜ alan `batchNumber` ile gelir (Zod adı sonraki fazda değişir); TARANAN seri (TRAVELER_CARD) — refakat kartının barkodu aynı koddur." },
    panelGroup: "uretim",
    countTable: { model: "workOrder", field: "workOrderNumber", birim: "kayıt" },
    label: "İş emri / refakat kartı no",
    seedPrefix: "IE",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    seedRetiredPrefixes: ["RK"],
    kind: "TRAVELER_CARD",
    // ⚠️ YAPISAL KİLİT KALDIRILDI (2026-09-23) — `returnDoc` emsali: gerekçesi
    // çürüyen bir kilit, kilit değil KALINTIDIR. Eski gerekçe iki şey diyordu ve
    // ikisi de bugün YANLIŞ: ① "ön ek Faz B inmeden açılmaz" — Faz B İNDİ ve o
    // engel artık `ISTEMCI` kilidinin işi (ayrı cümle, ayrı gün kalkar) · ②
    // "kart no = iş emri no, eski `RK` kartları sahada" — bu YAPISAL bir engel
    // DEĞİL: tek seri iki yüzeyi de besliyor (biçim değişince İKİSİ BİRDEN
    // değişir) ve `RK` zaten `seedRetiredPrefixes`te, yani okutulmaya devam
    // ediyor. Seri bugün yine düzenlenemez — ama doğru gerekçeyle: sayacı
    // kapsam damgasına geçmedi (`SAYAC`) ve okutulan bir seri (`ISTEMCI`).
  },
  { key: "swatch", panelGroup: "fason-kartela", countTable: { model: "swatch", field: "cardNumber", birim: "kayıt" }, label: "Kartela kart no", seedPrefix: "KRT", seedDateSegment: D, seedDigits: 4, seedSeparator: "", kind: "SWATCH" },
  {
    key: "sack",
    manualEntry: { path: "services/shipping.service.ts", not: "Çuval açılırken `data.sackNo` gelirse o kullanılır; TARANAN seri (SACK) — elle değer okutulabilir olmalı." },
    panelGroup: "sevkiyat",
    countTable: { model: "sack", field: "sackNo", birim: "kayıt" },
    label: "Çuval no",
    seedPrefix: "CV",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "SACK",
    scopedCounter: { durum: "hazir", not: "`shipping.service.nextSackNo` zengin biçime geçirildi (kod + createdAt)." },
  },
  {
    key: "shipment",
    panelGroup: "sevkiyat",
    countTable: { model: "shipment", field: "shipmentNo", birim: "kayıt" },
    label: "Sevkiyat no",
    seedPrefix: "SVK",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "SHIPMENT",
    scopedCounter: { durum: "hazir", not: "`shipping.service.nextShipmentNo` zengin biçime geçirildi." },
  },
  {
    key: "subcontractorDispatch",
    panelGroup: "fason-kartela",
    countTable: { model: "subcontractorDispatch", field: "dispatchNo", birim: "belge" },
    label: "Fason sevk belge no",
    seedPrefix: "FS",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "DISPATCH_DOC",
  },
  {
    key: "subcontractorReceipt",
    panelGroup: "fason-kartela",
    countTable: { model: "subcontractorReceipt", field: "receiptNo", birim: "belge" },
    label: "Fason kabul belge no",
    seedPrefix: "FK",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "DISPATCH_DOC",
  },
  {
    key: "kartelaDispatch",
    panelGroup: "fason-kartela",
    countTable: { model: "kartelaDispatch", field: "dispatchNo", birim: "belge" },
    label: "Kartela sevk belge no",
    seedPrefix: "KS",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "DISPATCH_DOC",
  },
  {
    key: "kartelaReceipt",
    panelGroup: "fason-kartela",
    countTable: { model: "kartelaReceipt", field: "receiptNo", birim: "belge" },
    label: "Kartela kabul belge no",
    seedPrefix: "KK",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "DISPATCH_DOC",
  },

  // ── Sevkiyat ailesi (Faz C'de panele açılan küme) ──────────────────────────
  {
    key: "packingLotCode",
    panelGroup: "sevkiyat",
    countTable: { model: "packingGroup", field: "code", birim: "kayıt" },
    label: "Sevk partisi kodu",
    seedPrefix: "PRT",
    seedDateSegment: YYMM,
    seedDigits: 4,
    seedSeparator: "-",
    scopedCounter: { durum: "hazir", not: "`helpers/packing-group.nextPackingGroupCodeTx` zengin biçime geçirildi." },
  },
  {
    key: "packingLotName",
    manualEntry: { path: "services/packing-group.service.ts", not: "Grup/parti adı elle verilirse sıra HİÇ tahsis edilmez; bu seri OKUTULMUYOR." },
    ownCounter: { not: "Adın sırası sayaçtan değil GRUBUN KENDİ sırasından gelir (`formatPackingGroupName(seq)`); seri yalnız ön eki ve ayracı verir." },
    panelGroup: "sevkiyat",
    label: "Sevk partisi adı",
    seedPrefix: "P",
    seedDateSegment: NONE,
    seedDigits: 1,
    seedSeparator: "-",
    countTable: { model: "packingGroup", field: "name", birim: "kayıt" },
    scopedCounter: {
      durum: "sayac-yok",
      not: "Adın sırası sayaçtan DEĞİL grubun kendi sırasından gelir (`formatPackingGroupName(seq)`); biçim değişimi hiçbir sayacı bozamaz.",
    },
  },
  {
    key: "returnDoc",
    panelGroup: "sevkiyat",
    label: "İade belge no",
    seedPrefix: "IADE",
    seedDateSegment: D,
    seedDigits: 6,
    seedSeparator: "-",
    // ⚠️ BİRİM "belge": `returnNo` üye satırlara da kopyalanır, `count(*)` üç
    // satırı üç belge sayardı. Yüklem partial unique'in AYNISI — sayılan şey
    // BELGE ÇAPASI (tekil iade ya da grup lideri) — ve aynı zamanda null'ları
    // eler, yani nullable kolon sözleşmesi de karşılanır.
    countTable: {
      model: "rollReturn",
      field: "returnNo",
      birim: "belge",
      kapsam: "belge-capasi",
    },
    scopedCounter: {
      durum: "hazir",
      not: "`return.service` BELGE BAŞINA tek numara üretir (üyeler liderin kopyasını taşır) ve kapsam damgası migration'da kuruldu — `id`den türemiş eski hex kuyruklar sayaca giremez.",
    },
  },
  { key: "directShipment", panelGroup: "fason-kartela", countTable: { model: "directShipment", field: "shipmentNo", birim: "belge" }, label: "Doğrudan sevk no", seedPrefix: "DSK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "manifest", panelGroup: "uretim", countTable: { model: "manifest", field: "manifestNo", birim: "belge" }, label: "Çeki listesi no", seedPrefix: "CL", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  {
    key: "order",
    panelGroup: "depo-ticaret",
    countTable: { model: "order", field: "orderNumber", birim: "belge" },
    manualEntry: { path: "services/order.service.ts", not: "Sipariş açılırken `data.orderNumber` gelirse o kullanılır (uzunluk ≤ 40); bu seri OKUTULMUYOR." },
    label: "Sipariş no",
    seedPrefix: "SIP",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
  },

  // ── Üretim / depo ──────────────────────────────────────────────────────────
  {
    key: "batchDaily",
    ownCounter: { not: "İki üreteç yolu var: bayrak açıkken kısa parti kodu (P01…P99, körlemesine SARAR) devreye girer ve sıra `readLastShortBatchSeqTx`ten gelir. Ayar yolların yalnız BİRİNDE etkili olurdu — yarısı çalışan bir ayar, hiç çalışmayandan kötüdür." },
    panelGroup: "uretim",
    countTable: { model: "batch", field: "batchNumber", birim: "kayıt" },
    label: "Parti no (günlük biçim)",
    seedPrefix: "P",
    seedDateSegment: D,
    seedDigits: 1,
    seedSeparator: "",
    lockedReason:
      "Parti no fabrikanın FİZİKSEL plaka setine bağlı (P01…P99 körlemesine sarar, benzersiz değil — 2026-08-05 kullanıcı kararı); dolgusuzluk ve sarma biçim ayarıyla ifade edilemez.",
  },
  { key: "weavingOrder", panelGroup: "uretim", countTable: { model: "weavingOrder", field: "weavingOrderNumber", birim: "kayıt" }, label: "Dokuma işi no", seedPrefix: "DK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warpBeam", panelGroup: "uretim", countTable: { model: "warpBeam", field: "beamNo", birim: "kayıt" }, label: "Levent no", seedPrefix: "LV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "doffEvent", panelGroup: "uretim", countTable: { model: "doffEvent", field: "code", birim: "kayıt" }, label: "Doff kodu", seedPrefix: "DF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "goodsReceipt", panelGroup: "depo-ticaret", countTable: { model: "goodsReceipt", field: "receiptNo", birim: "belge" }, label: "Mal kabul fiş no", seedPrefix: "MK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "purchaseOrder", panelGroup: "depo-ticaret", countTable: { model: "purchaseOrder", field: "orderNo", birim: "belge" }, label: "Alış siparişi no", seedPrefix: "AS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warehouseTransfer", panelGroup: "depo-ticaret", countTable: { model: "warehouseTransfer", field: "transferNo", birim: "belge" }, label: "Depo transfer no", seedPrefix: "DT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "stockCount", panelGroup: "depo-ticaret", countTable: { model: "stockCount", field: "countNo", birim: "belge" }, label: "Sayım no", seedPrefix: "SAY", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "freeDocument", panelGroup: "depo-ticaret", countTable: { model: "freeDocument", field: "documentNo", birim: "belge" }, label: "Serbest belge no", seedPrefix: "SB", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },

  // ── Finans ─────────────────────────────────────────────────────────────────
  { key: "invoiceSales", panelGroup: "finans", countTable: { model: "invoice", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Satış faturası no", seedPrefix: "SF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoicePurchase", panelGroup: "finans", countTable: { model: "invoice", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Alış faturası no", seedPrefix: "AF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoiceSalesReturn", panelGroup: "finans", countTable: { model: "invoice", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Satış iade faturası no", seedPrefix: "SI", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoicePurchaseReturn", panelGroup: "finans", countTable: { model: "invoice", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Alış iade faturası no", seedPrefix: "AI", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "paymentIn", panelGroup: "finans", countTable: { model: "payment", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Tahsilat no", seedPrefix: "TH", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "paymentOut", panelGroup: "finans", countTable: { model: "payment", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Ödeme no", seedPrefix: "OD", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "cashTransaction", panelGroup: "finans", countTable: { model: "cashTransaction", field: "docNo", birim: "belge" }, label: "Kasa fiş no", seedPrefix: "KH", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeReceived", panelGroup: "finans", countTable: { model: "cheque", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Alınan çek no", seedPrefix: "CKA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeIssued", panelGroup: "finans", countTable: { model: "cheque", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Verilen çek no", seedPrefix: "CKV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "noteReceived", panelGroup: "finans", countTable: { model: "cheque", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Alınan senet no", seedPrefix: "SNA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "noteIssued", panelGroup: "finans", countTable: { model: "cheque", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Verilen senet no", seedPrefix: "SNV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeDeliveryNote", panelGroup: "finans", countTable: { model: "chequeDeliveryNote", field: "docNo", birim: "belge" }, label: "Çek teslim bordro no", seedPrefix: "BRD", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "reconciliationLetter", panelGroup: "finans", countTable: { model: "reconciliationLetter", field: "docNo", birim: "belge" }, label: "Mutabakat mektubu no", seedPrefix: "MBT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },

  // ── Master data kodları ────────────────────────────────────────────────────
  { key: "customer", panelGroup: "master-veri", countTable: { model: "customer", field: "code", birim: "kayıt" }, label: "Cari kodu", seedPrefix: "MUS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  // ⚠️ `FSN` ile okutulan `FS` (fason sevk belgesi) ön ek olarak çakışmaz:
  // çakışma kapısı yalnız TARAMA uzayında küreseldir ve bu ikisi okutulmaz;
  // ayrıca istemci çapası ön ekten sonra RAKAM ister, `FSN…` `FS`ye uymaz.
  { key: "subcontractor", panelGroup: "master-veri", countTable: { model: "subcontractor", field: "code", birim: "kayıt" }, label: "Fason firma kodu", seedPrefix: "FSN", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "subcontractorCategory", panelGroup: "master-veri", countTable: { model: "subcontractorCategory", field: "code", birim: "kayıt" }, label: "Fason kategori kodu", seedPrefix: "KAT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "fabricProperty", panelGroup: "master-veri", countTable: { model: "fabricProperty", field: "code", birim: "kayıt" }, label: "Kumaş özelliği kodu", seedPrefix: "OZL", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "item", panelGroup: "master-veri", countTable: { model: "item", field: "code", birim: "kayıt" }, label: "Stok kodu", seedPrefix: "STK", seedDateSegment: NONE, seedDigits: 6, seedSeparator: "-" },
  { key: "color", panelGroup: "master-veri", countTable: { model: "color", field: "code", birim: "kayıt" }, label: "Renk kodu", seedPrefix: "RNK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "station", panelGroup: "master-veri", countTable: { model: "station", field: "code", birim: "kayıt" }, label: "İstasyon kodu", seedPrefix: "IST", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "machine", panelGroup: "master-veri", countTable: { model: "machine", field: "code", birim: "kayıt" }, label: "Makine kodu", seedPrefix: "MAK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "cashAccount", panelGroup: "master-veri", countTable: { model: "cashBox", field: "code", birim: "kayıt" }, label: "Kasa kodu", seedPrefix: "KS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "bankAccount", panelGroup: "master-veri", countTable: { model: "bankAccount", field: "code", birim: "kayıt" }, label: "Banka hesap kodu", seedPrefix: "BN", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "returnReason", panelGroup: "master-veri", countTable: { model: "returnReason", field: "code", birim: "kayıt" }, label: "İade sebebi kodu", seedPrefix: "IADE", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "productRecipe", panelGroup: "master-veri", countTable: { model: "productRecipe", field: "code", birim: "kayıt" }, label: "Ürün reçetesi kodu", seedPrefix: "REC", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "defectType", panelGroup: "master-veri", countTable: { model: "defectType", field: "code", birim: "kayıt" }, label: "Hata tipi kodu", seedPrefix: "HATA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warehouse", panelGroup: "master-veri", countTable: { model: "warehouse", field: "code", birim: "kayıt" }, label: "Depo kodu", seedPrefix: "DP", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  {
    key: "routeTemplate",
    panelGroup: "master-veri",
    // ⚠️ `Route.code` NULLABLE ve ELLE de yazılabiliyor ("BKT-STD" — desen kodu
    // saha dilidir). Kapsam null'ları ve seri-dışı kodları eler; §4'ün "zorunlu
    // kolon YA DA kapsam" sözleşmesinin ikinci ayağı. BEYAN: ön ek kapsamı,
    // tesadüfen aynı ön ekle başlayan elle yazılmış bir kodu (`ROTA-1`) DA
    // sayar — etki cümlesi için kabul edilebilir bir AŞIRI sayım, çünkü o kayıt
    // da biçim değişiminden etkilenmez; eksik sayım olsaydı kabul edilmezdi.
    countTable: { model: "route", field: "code", birim: "kayıt", kapsam: "seri-onekli" },
    label: "Rota kodu",
    seedPrefix: "ROT",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
  },
] as const;

/** Katalog anahtarı — servis çağrıları bunu kullanır (serbest string değil). */
export type NumberSeriesKey = (typeof NUMBER_SERIES_CATALOG)[number]["key"];

const BY_KEY = new Map(NUMBER_SERIES_CATALOG.map((e) => [e.key, e]));

export function numberSeriesCatalogEntry(key: string): NumberSeriesCatalogEntry {
  const e = BY_KEY.get(key);
  if (!e) throw new Error(`Numara serisi katalogda yok: ${key}`);
  return e;
}
