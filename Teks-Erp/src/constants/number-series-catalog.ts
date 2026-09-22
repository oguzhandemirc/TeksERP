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
   * Panelde hangi bölümde görünür. Faz C YALNIZ "sevkiyat" ailesini açar;
   * Faz D bu etiketi genişletir — ekran kodu değişmez, katalog satırı değişir.
   */
  panelGroup?: "sevkiyat";
  /**
   * ETKİ CÜMLESİNİN kaynağı: bu seriyle numaralanmış KAYIT sayısı nereden
   * okunur. Panel "bugüne kadarki N kaydın numarası değişmez" derken bu sayıyı
   * kullanır ve sayı UYDURULMAZ — ölçülür. Alan yoksa panel sayı YAZMAZ
   * (üçüncü sonuç: "ölçülmedi"), "0" demez.
   */
  countTable?: { model: string; field: string };
}

const D = "DDMMYY" as NumberSeriesDateSegment;
const NONE = "NONE" as NumberSeriesDateSegment;
const YYMM = "YYMM" as NumberSeriesDateSegment;

export const NUMBER_SERIES_CATALOG: readonly NumberSeriesCatalogEntry[] = [
  // ── Okutulan seriler (istemci sınıflandırmasına girer) ─────────────────────
  {
    key: "roll",
    label: "Top barkodu",
    seedPrefix: "T",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "ROLL",
    infix: { re: "[HF]", aciklama: "faz harfi (H=ham · F=final) — `RollBarcodeCounter` anahtarının parçası, biçim ayarı değil" },
    lockedReason:
      "Kod tarih ile sıra ARASINDA faz harfi taşır (H/F) ve bu harf `RollBarcodeCounter` anahtarının parçasıdır; yapı seri biçimiyle ifade edilemez.",
  },
  {
    key: "workOrder",
    label: "İş emri / refakat kartı no",
    seedPrefix: "IE",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    seedRetiredPrefixes: ["RK"],
    kind: "TRAVELER_CARD",
    lockedReason:
      "Kart no = iş emri no (tek kod kuralı) ve eski `RK` kartları hâlâ sahada; ön ek Faz B (sunucu sınıflandırması) inmeden açılmaz.",
  },
  { key: "swatch", label: "Kartela kart no", seedPrefix: "KRT", seedDateSegment: D, seedDigits: 4, seedSeparator: "", kind: "SWATCH" },
  {
    key: "sack",
    panelGroup: "sevkiyat",
    countTable: { model: "sack", field: "sackNo" },
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
    countTable: { model: "shipment", field: "shipmentNo" },
    label: "Sevkiyat no",
    seedPrefix: "SVK",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "SHIPMENT",
    scopedCounter: { durum: "hazir", not: "`shipping.service.nextShipmentNo` zengin biçime geçirildi." },
  },
  { key: "subcontractorDispatch", label: "Fason sevk belge no", seedPrefix: "FS", seedDateSegment: D, seedDigits: 4, seedSeparator: "", kind: "DISPATCH_DOC" },
  { key: "subcontractorReceipt", label: "Fason kabul belge no", seedPrefix: "FK", seedDateSegment: D, seedDigits: 4, seedSeparator: "", kind: "DISPATCH_DOC" },
  { key: "kartelaDispatch", label: "Kartela sevk belge no", seedPrefix: "KS", seedDateSegment: D, seedDigits: 4, seedSeparator: "", kind: "DISPATCH_DOC" },
  { key: "kartelaReceipt", label: "Kartela kabul belge no", seedPrefix: "KK", seedDateSegment: D, seedDigits: 4, seedSeparator: "", kind: "DISPATCH_DOC" },

  // ── Sevkiyat ailesi (Faz C'de panele açılan küme) ──────────────────────────
  {
    key: "packingLotCode",
    panelGroup: "sevkiyat",
    countTable: { model: "packingGroup", field: "code" },
    label: "Sevk partisi kodu",
    seedPrefix: "PRT",
    seedDateSegment: YYMM,
    seedDigits: 4,
    seedSeparator: "-",
    scopedCounter: { durum: "hazir", not: "`helpers/packing-group.nextPackingGroupCodeTx` zengin biçime geçirildi." },
  },
  {
    key: "packingLotName",
    panelGroup: "sevkiyat",
    label: "Sevk partisi adı",
    seedPrefix: "P",
    seedDateSegment: NONE,
    seedDigits: 1,
    seedSeparator: "-",
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
    lockedReason:
      "Bugün sayaç YOK: numara her okumada `RollReturn.id`'nin ilk 6 hanesinden türetiliyor. Faz C'de `returnNo` kolonu doğup geçmiş doldurulana kadar biçim değiştirilemez.",
  },
  { key: "directShipment", label: "Doğrudan sevk no", seedPrefix: "DSK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "manifest", label: "Çeki listesi no", seedPrefix: "CL", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "order", label: "Sipariş no", seedPrefix: "SIP", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },

  // ── Üretim / depo ──────────────────────────────────────────────────────────
  {
    key: "batchDaily",
    label: "Parti no (günlük biçim)",
    seedPrefix: "P",
    seedDateSegment: D,
    seedDigits: 1,
    seedSeparator: "",
    lockedReason:
      "Parti no fabrikanın FİZİKSEL plaka setine bağlı (P01…P99 körlemesine sarar, benzersiz değil — 2026-08-05 kullanıcı kararı); dolgusuzluk ve sarma biçim ayarıyla ifade edilemez.",
  },
  { key: "weavingOrder", label: "Dokuma işi no", seedPrefix: "DK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warpBeam", label: "Levent no", seedPrefix: "LV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "doffEvent", label: "Doff kodu", seedPrefix: "DF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "goodsReceipt", label: "Mal kabul fiş no", seedPrefix: "MK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "purchaseOrder", label: "Alış siparişi no", seedPrefix: "AS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warehouseTransfer", label: "Depo transfer no", seedPrefix: "DT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "stockCount", label: "Sayım no", seedPrefix: "SAY", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "freeDocument", label: "Serbest belge no", seedPrefix: "SB", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },

  // ── Finans ─────────────────────────────────────────────────────────────────
  { key: "invoiceSales", label: "Satış faturası no", seedPrefix: "SF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoicePurchase", label: "Alış faturası no", seedPrefix: "AF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoiceSalesReturn", label: "Satış iade faturası no", seedPrefix: "SI", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoicePurchaseReturn", label: "Alış iade faturası no", seedPrefix: "AI", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "paymentIn", label: "Tahsilat no", seedPrefix: "TH", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "paymentOut", label: "Ödeme no", seedPrefix: "OD", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "cashTransaction", label: "Kasa fiş no", seedPrefix: "KH", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeReceived", label: "Alınan çek no", seedPrefix: "CKA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeIssued", label: "Verilen çek no", seedPrefix: "CKV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "noteReceived", label: "Alınan senet no", seedPrefix: "SNA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "noteIssued", label: "Verilen senet no", seedPrefix: "SNV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeDeliveryNote", label: "Çek teslim bordro no", seedPrefix: "BRD", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "reconciliationLetter", label: "Mutabakat mektubu no", seedPrefix: "MBT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },

  // ── Master data kodları ────────────────────────────────────────────────────
  { key: "customer", label: "Cari kodu", seedPrefix: "MUS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  // ⚠️ `FSN` ile okutulan `FS` (fason sevk belgesi) ön ek olarak çakışmaz:
  // çakışma kapısı yalnız TARAMA uzayında küreseldir ve bu ikisi okutulmaz;
  // ayrıca istemci çapası ön ekten sonra RAKAM ister, `FSN…` `FS`ye uymaz.
  { key: "subcontractor", label: "Fason firma kodu", seedPrefix: "FSN", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "subcontractorCategory", label: "Fason kategori kodu", seedPrefix: "KAT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "fabricProperty", label: "Kumaş özelliği kodu", seedPrefix: "OZL", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "item", label: "Stok kodu", seedPrefix: "STK", seedDateSegment: NONE, seedDigits: 6, seedSeparator: "-" },
  { key: "color", label: "Renk kodu", seedPrefix: "RNK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "station", label: "İstasyon kodu", seedPrefix: "IST", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "machine", label: "Makine kodu", seedPrefix: "MAK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "cashAccount", label: "Kasa kodu", seedPrefix: "KS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "bankAccount", label: "Banka hesap kodu", seedPrefix: "BN", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "returnReason", label: "İade sebebi kodu", seedPrefix: "IADE", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "productRecipe", label: "Ürün reçetesi kodu", seedPrefix: "REC", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "defectType", label: "Hata tipi kodu", seedPrefix: "HATA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warehouse", label: "Depo kodu", seedPrefix: "DP", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "routeTemplate", label: "Rota kodu", seedPrefix: "ROT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
] as const;

/** Katalog anahtarı — servis çağrıları bunu kullanır (serbest string değil). */
export type NumberSeriesKey = (typeof NUMBER_SERIES_CATALOG)[number]["key"];

const BY_KEY = new Map(NUMBER_SERIES_CATALOG.map((e) => [e.key, e]));

export function numberSeriesCatalogEntry(key: string): NumberSeriesCatalogEntry {
  const e = BY_KEY.get(key);
  if (!e) throw new Error(`Numara serisi katalogda yok: ${key}`);
  return e;
}
