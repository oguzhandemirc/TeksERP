// =============================================================================
// NUMARA SERİSİ KATALOĞU — ENVANTER (52 seri)
// =============================================================================
// ⚠️ SÖZLEŞME AYRI DOSYADA (`number-series-catalog.types.ts`): satır TİPİ, panel
// grupları ve etiket yardımcıları orada. Bölme ekseni bu depodaki alışılmış
// çizgi: "kural kalır, ENVANTER ayrılır" — burası büyüyen taraftır (her yeni
// seri bir satır), sözleşme ise seyrek değişir. Tek dosyada kalsalardı her seri
// eklemesi sözleşme dosyasını da kirletirdi ve boyut tavanı bir gün ikisini
// birden kesmeye zorlardı.
//
// ⚠️ İÇE AKTARMA YOLU DEĞİŞMEDİ: sözleşme buradan yeniden dışa veriliyor, yani
// `from "../constants/number-series-catalog"` yazan 40+ dosyaya dokunulmadı.
// =============================================================================
export * from "./number-series-catalog.types";
import type { NumberSeriesCatalogEntry } from "./number-series-catalog.types";
import type { NumberSeries } from "@prisma/client";

type NumberSeriesDateSegment = NumberSeries["dateSegment"];
const D = "DDMMYY" as NumberSeriesDateSegment;
const NONE = "NONE" as NumberSeriesDateSegment;
const YYMM = "YYMM" as NumberSeriesDateSegment;

export const NUMBER_SERIES_CATALOG: readonly NumberSeriesCatalogEntry[] = [
  // ── Okutulan seriler (istemci sınıflandırmasına girer) ─────────────────────
  {
    key: "roll",
    // Teknik ayrıntı YORUMDA kalır: sıra `roll_barcode_counters` üzerinde
    // `INSERT … ON CONFLICT DO UPDATE` ile atomik alınır, kapasite `MAX_ROLL_SEQ`.
    // Kullanıcıya dönen cümlede tablo/sabit adı GEÇMEZ.
    ownCounter: { not: "Top barkodunun sırası kendi sayaç tablosundan atomik olarak alınır, var olan kodlardan hesaplanmaz; günlük kapasitesi de ayrı bir sınırdır." },
    panelGroup: "uretim",
    // ⚠️ `Roll.barcode` NULLABLE (barkodsuz top var: açık kumaş, kartela tüketimi)
    // ⇒ §4 gereği kapsam BEYANLI: sayım yalnız bu serinin ön ekiyle başlayan
    // kodları sayar, `null` barkodları ve eski `TEKS…` kalıbını DEĞİL.
    countTable: { model: "roll", field: "barcode", birim: "kayıt", kapsam: "seri-onekli" },
    label: "Top barkodu",
    seedPrefix: "T",
    seedDateSegment: D,
    seedDigits: 4,
    seedSeparator: "",
    kind: "ROLL",
    infix: { re: "[HF]", aciklama: "faz harfi (H=ham · F=final) — `RollBarcodeCounter` anahtarının parçası, biçim ayarı değil" },
    scopedCounter: {
      durum: "hazir",
      not: "Sıra kendi sayaç tablosundan (`roll_barcode_counters`) atomik alınıyor; biçim (ön ek · tarih · hane · ayraç) seriden okunuyor, kapasite `maxValue`dan geliyor.",
      uretec: "services/helpers/roll-barcode.helper.ts",
    },
    // ⚠️ YAPISAL KİLİT 2026-09-23'te KALKTI ve yerini EKSEN kilitlerine bıraktı.
    // Gerekçe ölçüldü (`test_eski_istemci_okutma`): faz harfi gerçekten yapısaldır
    // ama o `infix` alanında zaten beyanlı ve panelden DÜZENLENEMEZ; serinin
    // GERİ KALANINI (ön ek · tarih · hane · ayraç) kilitlemek için bir sebep
    // değildi. Hangi eksenin sahadaki istemciyi kırdığı artık tek tek ölçülüyor
    // ve `SCANNED_CLIENT_BREAKING_AXES.roll`da gerekçesiyle yazılı.
    //
    // ⚠️ `maxValue` TOHUMU BUGÜNKÜ DAVRANIŞTIR: `MAX_ROLL_SEQ = 9999` kod sabiti
    // olmaktan çıkıp serinin üst sınırı oldu. HANE DEĞİL SINIR kapasiteyi belirler
    // (D2③) — fabrika dolguyu kaldırıp (`digits: 1`) `…H5` yazdırabilir ve sınır
    // yine 9999 kalır; sınırı boşaltırsa kapasite `Int` tavanına kadar açılır.
    seedMaxValue: 9999,
  },
  {
    key: "workOrder",
    scopedCounter: { durum: "hazir", not: "İKİ üreteç de `nextSeriesNo` yolundan geçiyor (iş emri açılışı + klon/split); yükleyiciler doğuş anını taşıyor (E2 okutulan aile dilimi, 2026-09-23).", uretec: ["services/workorder.service.ts", "services/helpers/workorder-clone.helper.ts"] },
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
  { key: "swatch", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesSeq` ile `nextSeriesNo` ile AYNI çekirdekten geçiyor (toplu kabul sırayı ister, kodu değil); yükleyici doğuş anını taşıyor (E2 okutulan aile dilimi, 2026-09-23).", uretec: "services/kartela.service.ts" }, panelGroup: "fason-kartela", countTable: { model: "swatch", field: "cardNumber", birim: "kayıt" }, label: "Kartela kart no", seedPrefix: "KRT", seedDateSegment: D, seedDigits: 4, seedSeparator: "", kind: "SWATCH" },
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
    scopedCounter: { durum: "hazir", not: "İKİ üreteç de `nextSeriesNo` yolundan geçiyor (fason sevk + parti ameliyatı); yükleyiciler doğuş anını taşıyor (E2 okutulan aile dilimi, 2026-09-23).", uretec: ["services/subcontractor.service.ts", "services/helpers/batch-dispatch-surgery.helper.ts"] },
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
    scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 okutulan aile dilimi, 2026-09-23).", uretec: "services/subcontractor.service.ts" },
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
    scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 okutulan aile dilimi, 2026-09-23).", uretec: "services/kartela.service.ts" },
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
    scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 okutulan aile dilimi, 2026-09-23).", uretec: "services/kartela.service.ts" },
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
    ownCounter: { not: "Sevk partisi adının sırası sayaçtan değil grubun kendi sırasından gelir; seri yalnız ön eki ve ayracı belirler." },
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
  { key: "directShipment", scopedCounter: { durum: "hazir", not: "Üreteç zaten `nextSeriesNo` yolundaydı ama yükleyici ÇIPLAK string döndürüyordu — kapsam damgası SESSİZCE kapalıydı; doğuş anı eklendi (E2 okutulan aile dilimi, 2026-09-23).", uretec: "services/subcontractor.service.ts" }, panelGroup: "fason-kartela", countTable: { model: "directShipment", field: "shipmentNo", birim: "belge" }, label: "Doğrudan sevk no", seedPrefix: "DSK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "manifest", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor: kod listesi `formatChangedAt` damgasına göre süzülüyor ve çakışma atlaması aynı yerde (E2 depo-ticaret dilimi, 2026-09-23)." }, panelGroup: "uretim", countTable: { model: "manifest", field: "manifestNo", birim: "belge" }, label: "Çeki listesi no", seedPrefix: "CL", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  {
    key: "order",
    scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor; kapsam damgası + çakışma atlaması tek yerde, advisory kilit numara üretiminden ÖNCE alınıyor (E2 üretim dilimi, 2026-09-23).", uretec: "services/order.service.ts" },
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
    exclusiveWith: {
      key: "batchShort",
      not: "Parti numarasının iki rejimi `batch.shortNumberEnabled` bayrağıyla BİRBİRİNİ DIŞLAR; bir anda yalnız biri kod üretir, yani aynı kolonu paylaşsalar da aynı numarayı üretemezler.",
    },
    // 2026-09-23'e kadar YAPISAL KİLİTLİYDİ ve gerekçe ÖTEKİ rejimin biçimiydi
    // (P01…P99 sarması). Kısa rejim kendi serisine (`batchShort`) taşınınca bu
    // seride anlatılamayan bir şey kalmadı: prefix + GGAAYY + dolgusuz sıra,
    // `nextSeriesNo`nun birebir kalıbı.
    scopedCounter: {
      durum: "hazir",
      not: "Günlük rejim `nextSeriesNo` yolundan geçiyor; kapsam damgası + çakışma atlaması tek yerde, 8022 advisory kilit numara üretiminden ÖNCE alınıyor.",
      uretec: "services/batch.service.ts",
    },
    panelGroup: "uretim",
    // ⚠️ `batch.batchNumber` İKİ seri tarafından paylaşılıyor (`batchShort`) —
    // kapsam beyansız kalsaydı panel iki rejimin TOPLAMINI tek serinin sayısı
    // diye basardı.
    countTable: { model: "batch", field: "batchNumber", birim: "kayıt", kapsam: "seri-onekli" },
    label: "Parti no (günlük biçim)",
    seedPrefix: "P",
    // ⚠️ 1 = DOLGU YOK. Eski kodlar (`P0508260019`) dolgusuz doğdu; tohumu
    // değiştirmek dünkü biçimi bozar.
    seedDigits: 1,
    seedDateSegment: D,
    seedSeparator: "",
  },
  {
    key: "batchShort",
    exclusiveWith: {
      key: "batchDaily",
      not: "Parti numarasının iki rejimi `batch.shortNumberEnabled` bayrağıyla BİRBİRİNİ DIŞLAR; bir anda yalnız biri kod üretir, yani aynı kolonu paylaşsalar da aynı numarayı üretemezler.",
    },
    scopedCounter: {
      durum: "hazir",
      not: "Kısa rejim `nextCounterSeq` çekirdeğinden geçiyor; sayacın kaynağı (EN SON DOĞAN kod) `wrap` bayrağına bağlı tek yüklemde yaşıyor, 8022 kilit numara üretiminden ÖNCE alınıyor.",
      uretec: "services/batch.service.ts",
    },
    panelGroup: "uretim",
    countTable: { model: "batch", field: "batchNumber", birim: "kayıt", kapsam: "seri-onekli" },
    label: "Parti no (kısa, dönen)",
    seedPrefix: "P",
    // Tarih YOK: sayaç gün başında sıfırlanmaz, plaka seti gibi sürekli döner.
    seedDateSegment: NONE,
    seedDigits: 2,
    seedSeparator: "",
    // BUGÜNKÜ DAVRANIŞ VERİYE TAŞINDI: P01…P99, 99'dan sonra P01.
    seedMaxValue: 99,
    seedWrap: true,
  },
  { key: "weavingOrder", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor; kapsam damgası + çakışma atlaması tek yerde, advisory kilit numara üretiminden ÖNCE alınıyor (E2 üretim dilimi, 2026-09-23).", uretec: "services/helpers/weaving-order.helper.ts" }, panelGroup: "uretim", countTable: { model: "weavingOrder", field: "weavingOrderNumber", birim: "kayıt" }, label: "Dokuma işi no", seedPrefix: "DK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warpBeam", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor; kapsam damgası + çakışma atlaması tek yerde, advisory kilit numara üretiminden ÖNCE alınıyor (E2 üretim dilimi, 2026-09-23).", uretec: "services/helpers/warp-beam.helper.ts" }, panelGroup: "uretim", countTable: { model: "warpBeam", field: "beamNo", birim: "kayıt" }, label: "Levent no", seedPrefix: "LV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "doffEvent", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor; kapsam damgası + çakışma atlaması tek yerde, advisory kilit numara üretiminden ÖNCE alınıyor (E2 üretim dilimi, 2026-09-23).", uretec: "services/helpers/machine-doff-open.helper.ts" }, panelGroup: "uretim", countTable: { model: "doffEvent", field: "code", birim: "kayıt" }, label: "Doff kodu", seedPrefix: "DF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "goodsReceipt", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor: kapsam damgası + çakışma atlaması tek yerde (E2, 2026-09-23)." }, panelGroup: "depo-ticaret", countTable: { model: "goodsReceipt", field: "receiptNo", birim: "belge" }, label: "Mal kabul fiş no", seedPrefix: "MK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "purchaseOrder", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor: kapsam damgası + çakışma atlaması tek yerde (E2, 2026-09-23)." }, panelGroup: "depo-ticaret", countTable: { model: "purchaseOrder", field: "orderNo", birim: "belge" }, label: "Alış siparişi no", seedPrefix: "AS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warehouseTransfer", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor: kapsam damgası + çakışma atlaması tek yerde (E2, 2026-09-23)." }, panelGroup: "depo-ticaret", countTable: { model: "warehouseTransfer", field: "transferNo", birim: "belge" }, label: "Depo transfer no", seedPrefix: "DT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "stockCount", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor: kapsam damgası + çakışma atlaması tek yerde (E2, 2026-09-23)." }, panelGroup: "depo-ticaret", countTable: { model: "stockCount", field: "countNo", birim: "belge" }, label: "Sayım no", seedPrefix: "SAY", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "freeDocument", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor: kapsam damgası + çakışma atlaması tek yerde (E2, 2026-09-23)." }, panelGroup: "depo-ticaret", countTable: { model: "freeDocument", field: "documentNo", birim: "belge" }, label: "Serbest belge no", seedPrefix: "SB", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },

  // ── Finans ─────────────────────────────────────────────────────────────────
  { key: "invoiceSales", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/helpers/finance.helper.ts" }, panelGroup: "finans", countTable: { model: "invoice", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Satış faturası no", seedPrefix: "SF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoicePurchase", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/helpers/finance.helper.ts" }, panelGroup: "finans", countTable: { model: "invoice", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Alış faturası no", seedPrefix: "AF", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoiceSalesReturn", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/helpers/finance.helper.ts" }, panelGroup: "finans", countTable: { model: "invoice", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Satış iade faturası no", seedPrefix: "SI", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "invoicePurchaseReturn", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/helpers/finance.helper.ts" }, panelGroup: "finans", countTable: { model: "invoice", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Alış iade faturası no", seedPrefix: "AI", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "paymentIn", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/helpers/finance.helper.ts" }, panelGroup: "finans", countTable: { model: "payment", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Tahsilat no", seedPrefix: "TH", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "paymentOut", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/helpers/finance.helper.ts" }, panelGroup: "finans", countTable: { model: "payment", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Ödeme no", seedPrefix: "OD", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "cashTransaction", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 finans dilimi, 2026-09-23).", uretec: "services/helpers/cash-ledger.helper.ts" }, panelGroup: "finans", countTable: { model: "cashTransaction", field: "docNo", birim: "belge" }, label: "Kasa fiş no", seedPrefix: "KH", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeReceived", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/cheque.service.ts" }, panelGroup: "finans", countTable: { model: "cheque", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Alınan çek no", seedPrefix: "CKA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeIssued", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/cheque.service.ts" }, panelGroup: "finans", countTable: { model: "cheque", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Verilen çek no", seedPrefix: "CKV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "noteReceived", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/cheque.service.ts" }, panelGroup: "finans", countTable: { model: "cheque", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Alınan senet no", seedPrefix: "SNA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "noteIssued", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; anahtar PARAMETREDEN geldiği için üreteç dosyası beyanlı (E2 finans dilimi, 2026-09-23).", uretec: "services/cheque.service.ts" }, panelGroup: "finans", countTable: { model: "cheque", field: "docNo", birim: "belge", kapsam: "seri-onekli" }, label: "Verilen senet no", seedPrefix: "SNV", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "chequeDeliveryNote", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 finans dilimi, 2026-09-23).", uretec: "services/cheque-delivery-note.service.ts" }, panelGroup: "finans", countTable: { model: "chequeDeliveryNote", field: "docNo", birim: "belge" }, label: "Çek teslim bordro no", seedPrefix: "BRD", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "reconciliationLetter", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 finans dilimi, 2026-09-23).", uretec: "services/reconciliation-letter.service.ts" }, panelGroup: "finans", countTable: { model: "reconciliationLetter", field: "docNo", birim: "belge" }, label: "Mutabakat mektubu no", seedPrefix: "MBT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },

  // ── Master data kodları ────────────────────────────────────────────────────
  { key: "customer", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23)." }, panelGroup: "master-veri", countTable: { model: "customer", field: "code", birim: "kayıt" }, label: "Cari kodu", seedPrefix: "MUS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  // ⚠️ `FSN` ile okutulan `FS` (fason sevk belgesi) ön ek olarak çakışmaz:
  // çakışma kapısı yalnız TARAMA uzayında küreseldir ve bu ikisi okutulmaz;
  // ayrıca istemci çapası ön ekten sonra RAKAM ister, `FSN…` `FS`ye uymaz.
  { key: "subcontractor", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/subcontractor-management.service.ts" }, panelGroup: "master-veri", countTable: { model: "subcontractor", field: "code", birim: "kayıt" }, label: "Fason firma kodu", seedPrefix: "FSN", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "subcontractorCategory", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/subcontractor-management.service.ts" }, panelGroup: "master-veri", countTable: { model: "subcontractorCategory", field: "code", birim: "kayıt" }, label: "Fason kategori kodu", seedPrefix: "KAT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "fabricProperty", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23)." }, panelGroup: "master-veri", countTable: { model: "fabricProperty", field: "code", birim: "kayıt" }, label: "Kumaş özelliği kodu", seedPrefix: "OZL", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "item", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23)." }, panelGroup: "master-veri", countTable: { model: "item", field: "code", birim: "kayıt" }, label: "Stok kodu", seedPrefix: "STK", seedDateSegment: NONE, seedDigits: 6, seedSeparator: "-" },
  { key: "color", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "color", field: "code", birim: "kayıt" }, label: "Renk kodu", seedPrefix: "RNK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "station", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "station", field: "code", birim: "kayıt" }, label: "İstasyon kodu", seedPrefix: "IST", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "machine", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "machine", field: "code", birim: "kayıt" }, label: "Makine kodu", seedPrefix: "MAK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "cashAccount", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "cashBox", field: "code", birim: "kayıt" }, label: "Kasa kodu", seedPrefix: "KS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "bankAccount", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "bankAccount", field: "code", birim: "kayıt" }, label: "Banka hesap kodu", seedPrefix: "BN", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "returnReason", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "returnReason", field: "code", birim: "kayıt" }, label: "İade sebebi kodu", seedPrefix: "IADE", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "productRecipe", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "productRecipe", field: "code", birim: "kayıt" }, label: "Ürün reçetesi kodu", seedPrefix: "REC", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "defectType", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "defectType", field: "code", birim: "kayıt" }, label: "Hata tipi kodu", seedPrefix: "HATA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warehouse", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "warehouse", field: "code", birim: "kayıt" }, label: "Depo kodu", seedPrefix: "DP", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  {
    key: "routeTemplate",
    scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" },
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
