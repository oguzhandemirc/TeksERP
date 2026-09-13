// =============================================================================
// DEFTER BEYAN TABLOSU — her append-only modelin SINIFI ve ters yol MEKANİZMASI
// =============================================================================
// NEDEN beyan: ters yolun TEK bir biçimi yok. Dört mekanizma ölçüldü (2026-09-13)
// ve "her ileri olayın `*_CANCEL`i olur" gibi tek kurallı bir kapı EN AZ ALTI
// yanlış kırmızı üretir: `ADJUST`ın tersi net ters `ADJUST`tır, `TRANSFORM`un
// tersi karşı gruptur, `RollVariance`ın tersi bir damgadır, `WarehouseMovement`ın
// tersi `reversesMovementId` bağıdır (enum değeri YALNIZ BETİMLEYİCİDİR — helper
// şerhi, tasarım §D2a). Kapı bu yüzden mekanizmayı ÇIKARMAZ, BEYANDAN okur.
//
// EVREN: şemadaki TÜM append-only modeller (`updatedAt` taşımayan) + bilinçli
// "yarı" istisnalar. Yeni bir append-only model sınıfsız kalamaz — kapı düşer.
// Amaç bir liste tutmak değil: sınıfsız bir modelin sessizce defter sanılması ya
// da sanılmaması, bu projede altı kez ısıran hatanın kaynağı.
// =============================================================================

export type DefterSinifi =
  /** "Ne oldu"yu tutar; ters yolu OLMAK ZORUNDA. */
  | "DEFTER"
  /** Ters yolu ait olduğu BELGENİN ters yoludur (fatura `VOIDED` olur, satırı onunla gider). */
  | "SATIR_EBEVEYN"
  /** ③b saf yapılandırma pivotu — parasal/ticari/kalite sonucu yok, fiziksel silme meşru. */
  | "PIVOT_YAPILANDIRMA"
  /** ③a ticari pivot — versiyonlanır ya da ters kayıt alır; sil-yaz YAPILMAZ. */
  | "PIVOT_TICARI"
  /** Raporlanan hiçbir sayı değişmiyor ⇒ budanabilir; saklama KARARIN UFKUYLA sınırlı. */
  | "TELEMETRI"
  /** Defter değil, durum/tek-kullanım kaydı. */
  | "DURUM";

export type TersMekanizma =
  | { tur: "DAMGA"; kolon: string }
  | { tur: "TERS_BAG"; kolon: string }
  | { tur: "DURUM_IPTAL"; kolon: string }
  | { tur: "KARSI_OLAY"; enumAdi: string; ciftler: [string, string][] }
  | { tur: "ENUM_CIFTI"; enumAdi: string; ciftler: [string, string][] }
  /** Ters yolu YOK — yalnız `borc` ile birlikte meşrudur (muafiyet DEĞİL, borç). */
  | { tur: "YOK" };

export interface TersYazan {
  /** Backend köküne göreli dosya. */
  dosya: string;
  /** Ters yazımı içeren adlı fonksiyon/metot — yeniden adlandırılırsa kapı düşer. */
  sembol: string;
}

export interface DefterBorcu {
  ne: string;
  /** Ölçüm — "nasıl biliyoruz". Beyan değil kanıt. */
  kanit: string;
  /** Alan sahibi; borç GÖRÜNÜR kalır, muaf listesine gömülmez. */
  sahibi: string;
  /**
   * Çözümü TASARLANMIŞ borcun tasarım belgesi (repo köküne göreli).
   *
   * "Tasarlanmış borç" ile "tasarımsız borç" AYRI DURUMLARDIR ve ikisini aynı
   * satırda göstermek, üzerinde çalışılanı çalışılmayandan ayırt edilemez kılar.
   * Kapı bu yolun VAR OLDUĞUNU da ölçer: ölü tasarım atfı, kapanmış sanılan bir
   * borçtan daha kötüdür (§6c).
   */
  tasarim?: string;
  /**
   * Borç notunun YANLIŞLANABİLİR hâli — dar kapsamlı, tek biçim.
   *
   * NEDEN: beyan tablosunda iki tür satır var — ÖLÇÜLEN (kapı yakalar) ve
   * ANLATILAN (kapı yakalamaz). `kanit` düz metindir ve SESSİZCE bayatlar:
   * `RETURN` borcunun kanıtı 2026-09-13'te yanlışa düştü (ters yol indi) ve kapı
   * görmedi. Bir borç notu, iddiasını ölçülebilir bir sondaya çevirebiliyorsa
   * çevirir. ⚠️ Genel kural DEĞİL: yalnız çevrilebilen borçta kullanılır, ve
   * bugün TEK biçim var — "şu enum değeri hiçbir yerden yazılmıyor".
   */
  kanitSondasi?: { tur: "ENUM_DEGERI_YAZILMIYOR"; enumAdi: string; deger: string };
}

export interface DefterBeyani {
  model: string;
  sinif: DefterSinifi;
  /** Sınıfın NEDEN bu olduğu — tek cümle. */
  gerekce: string;
  /** `updatedAt` taşıyan bilinçli istisna (defter + durum kaynağı aynı tabloda). */
  yari?: true;
  mekanizma?: TersMekanizma;
  tersYazan?: TersYazan[];
  /** Satır YARATAN yazıcı dosyalar — keşfedilen kümeyle BİREBİR eşleşmeli. */
  yazan?: string[];
  ebeveyn?: string;
  borc?: DefterBorcu[];
  /** TELEMETRI: budamanın sınırı — hangi KARARI besliyor. */
  kararUfku?: string;
  /**
   * Deftere `delete`/`deleteMany` atan BEYANLI dosyalar. Doktrin bunu YASAKLAR;
   * burada yalnız BORÇ olarak görünür kalır (muafiyet değil). Beyansız bir silme
   * yolu kırmızıdır.
   */
  silen?: string[];
}

const D = (
  model: string, gerekce: string, mekanizma: TersMekanizma,
  tersYazan: TersYazan[], yazan: string[], ek: Partial<DefterBeyani> = {},
): DefterBeyani => ({ model, sinif: "DEFTER", gerekce, mekanizma, tersYazan, yazan, ...ek });

const SATIR = (model: string, ebeveyn: string, gerekce: string, ek: Partial<DefterBeyani> = {}): DefterBeyani =>
  ({ model, sinif: "SATIR_EBEVEYN", ebeveyn, gerekce, ...ek });

const PIVOT = (model: string, gerekce = "saf ayar kümesi — parasal/ticari/kalite sonucu yok (③b)"): DefterBeyani =>
  ({ model, sinif: "PIVOT_YAPILANDIRMA", gerekce });

export const DEFTER_BEYANI: DefterBeyani[] = [
  // ── DEFTERLER ──────────────────────────────────────────────────────────────
  D("WarehouseMovement", "depo giriş/çıkış defteri; 13 olay", { tur: "TERS_BAG", kolon: "reversesMovementId" },
    // ⚠️ Ters helper'lar AYRI DOSYAYA taşındı (kaynak dosya 281/300 kod satırındaydı,
    // lint tavanı her eklemeyi reddediyordu) ve dördüncüsü o bölmede doğdu:
    // `reverseLegacyStockMove` — statüsüz eski satırların ters yolu.
    // Bu satırın bayatlığını KAPININ KENDİSİ yakaladı (§4a, 111/3): dosya taşıması
    // yeniden adlandırma DEĞİLDİR ama aynı sınıftır — beyan yolu da güncellenir.
    [
      { dosya: "src/services/helpers/warehouse-ledger-reverse.helper.ts", sembol: "reverseStockMove" },
      { dosya: "src/services/helpers/warehouse-ledger-reverse.helper.ts", sembol: "reverseLegacyStockMove" },
      { dosya: "src/services/helpers/warehouse-ledger-reverse.helper.ts", sembol: "reverseAllRollStockMoves" },
      { dosya: "src/services/helpers/warehouse-ledger-reverse.helper.ts", sembol: "reverseLatestScopedStockMove" },
    ],
    ["src/services/helpers/warehouse-ledger.helper.ts"],
    // `RETURN` borcu KAPANDI (2026-09-13): `cancelReturn` artık `RETURN_CANCEL`
    // sebep koduyla `reverseStockMove`/`reverseLegacyStockMove` çağırıyor (6e dalında
    // ölçüldü). Kapanan borç satırı SİLİNİR — kapanmış borca sonda yazmak ölü muaf
    // üretir, ve açık borç listesinde durması listeyi ağırlıksızlaştırır.
    // `EXTERNAL` borcu KAPANDI (2026-09-13) — ve ölçülerek kapandı, beyanla değil:
    //   yazan yollar : subcontractor.service.ts (fason sevki) · kartela.service.ts
    //                  (kartela sevki + iptali)   [grep ile ölçüldü: 2 dosya]
    //   K            : 0  (`scripts/lib/stok-defteri-bag-olcumu.ts`, kapısı
    //                  `test_stok_defteri_bag_olcumu`) — kapısız yol kalmadı
    // Kapanan borç satırı SİLİNİR: kapanmış borca sonda yazmak ölü muaf üretir ve
    // açık borç listesinde durması listeyi ağırlıksızlaştırır (`RETURN` emsali).
    // ⚠️ Ters yol da KAPALI: kartela iptali `reverseStockMove` ile BAĞLI ters satır
    // yazıyor; fason sevkinin tersi ise fason KABULÜdür (ayrı olay, `ENTRY`).
  ),

  D("CariTransaction", "cari borç/alacak defteri", { tur: "TERS_BAG", kolon: "reversesTxnId" },
    [{ dosya: "src/services/cari.service.ts", sembol: "cancelOpeningBalance" }],
    ["src/services/cari.service.ts", "src/services/cheque.service.ts", "src/services/invoice.service.ts", "src/services/payment.service.ts"]),

  D("ChequeEvent", "çek durum defteri; her terminalden tek çıkış",
    { tur: "ENUM_CIFTI", enumAdi: "ChequeEventType", ciftler: [
      ["COLLECT", "COLLECT_CANCEL"], ["ENDORSE", "ENDORSE_CANCEL"], ["BOUNCE", "BOUNCE_CANCEL"],
      ["RETURN", "RETURN_CANCEL"], ["PAY", "PAY_CANCEL"],
    ] },
    [{ dosya: "src/services/cheque.service.ts", sembol: "writeEventTx" }],
    ["src/services/cheque.service.ts"]),

  D("CashTransaction", "kasa/banka defteri", { tur: "DURUM_IPTAL", kolon: "cancelledAt" },
    [{ dosya: "src/services/cash-transaction.service.ts", sembol: "cancel" }],
    ["src/services/cash-transaction.service.ts"], { yari: true }),

  D("YarnMovement", "iplik stok defteri", { tur: "KARSI_OLAY", enumAdi: "YarnMovementKind", ciftler: [["ADJUST_IN", "ADJUST_OUT"], ["IN", "OUT"]] },
    [{ dosya: "src/services/yarn.service.ts", sembol: "applyYarnMovementTx" }],
    ["src/services/yarn.service.ts"]),

  D("RollMovement", "topun adım içi giriş/çıkışı; açık satır çıkışta kapanır", { tur: "DAMGA", kolon: "revokedAt" },
    [{ dosya: "src/services/helpers/roll-movement.helper.ts", sembol: "revokeRollMovements" }],
    [
      "src/services/helpers/roll-step.helper.ts", "src/services/inventory.service.ts",
      "src/services/kursun-bypass.service.ts", "src/services/kursun-qc.service.ts",
      "src/services/subcontractor.service.ts", "src/services/tambur-manual.service.ts",
      "src/services/tambur-undo.service.ts", "src/services/workorder-manual-move.service.ts",
      "src/services/workorder-split.service.ts", "src/services/workorder.service.ts",
    ], { yari: true }),

  D("RollOperation", "kurşun/QC2/tambur/fason kanıtı", { tur: "DAMGA", kolon: "revokedAt" },
    [{ dosya: "src/services/helpers/roll-operation.helper.ts", sembol: "revokeRollOperations" }],
    ["src/services/inventory.service.ts", "src/services/kursun-qc.service.ts",
     "src/services/subcontractor.service.ts", "src/services/tambur.service.ts"]),

  D("RollVariance", "fire · düzeltme · aşım defteri", { tur: "DAMGA", kolon: "reversedAt" },
    [
      { dosya: "src/services/stock-count-reversal.service.ts", sembol: "reverseTx" },
      { dosya: "src/services/tambur-undo.service.ts", sembol: "applyFull" },
    ],
    ["src/services/helpers/roll-variance.helper.ts"]),

  D("SwatchStockReduction", "kartela düşüm defteri", { tur: "DAMGA", kolon: "reversedAt" },
    [{ dosya: "src/services/kartela.service.ts", sembol: "reverseStockReductionTx" }],
    ["src/services/kartela.service.ts"]),

  D("PaymentAllocation", "fatura kapama defteri; negatif satır CHECK ile yasak", { tur: "DAMGA", kolon: "revokedAt" },
    [
      { dosya: "src/services/payment-allocation.service.ts", sembol: "releaseRowsTx" },
      { dosya: "src/services/payment-allocation.service.ts", sembol: "deallocate" },
    ],
    ["src/services/payment-allocation.service.ts"]),

  D("PrintedDocument", "belge versiyon defteri", { tur: "DAMGA", kolon: "supersededAt" },
    [{ dosya: "src/services/printed-document.service.ts", sembol: "reissue" }],
    ["src/services/printed-document.service.ts", "src/services/traveler-card.service.ts"], { yari: true }),

  D("ShipmentEvent", "sevkiyat durum defteri; tek damga ikinci turda birincisini ezerdi",
    { tur: "KARSI_OLAY", enumAdi: "ShipmentEventType", ciftler: [["DISPATCHED", "UNDISPATCHED"], ["INVOICED", "INVOICE_CLEARED"]] },
    [{ dosya: "src/services/helpers/shipment-event.helper.ts", sembol: "writeShipmentEvent" }],
    ["src/services/helpers/shipment-event.helper.ts"]),

  D("SackWeighing", "çuval tartı ölçümü", { tur: "KARSI_OLAY", enumAdi: "SackWeighingKind", ciftler: [["WEIGHED", "CLEARED"], ["REWEIGHED", "CLEARED"]] },
    [{ dosya: "src/services/shipping.service.ts", sembol: "markSackContentChangedTx" }],
    ["src/services/shipping.service.ts"]),

  D("ImportRunLine", "içe aktarım geri sarmasının TEK kaynağı", { tur: "DAMGA", kolon: "revertedAt" },
    [{ dosya: "src/services/import/import-revert.branches.ts", sembol: "stampReverted" }],
    ["src/services/import/import.service.ts"]),

  D("MergeOperation", "master-data birleştirme karar defteri", { tur: "DAMGA", kolon: "revertedAt" },
    [{ dosya: "src/services/master-data-unmerge.service.ts", sembol: "revertTx" }],
    ["src/services/master-data-merge.service.ts"]),

  // ── DEFTER (ters yol 2026-09-13te KAPANDI — borç girdisi kaldırıldı) ───────
  D("RollPlanDeviation", "plan-dışı kimlikle inen metrajın KARAR defteri",
    { tur: "DAMGA", kolon: "revokedAt" },
    [
      // DÖRT damgalayan dal — ölçüldü 2026-09-13, dördü de canlı.
      { dosya: "src/services/tambur-undo.service.ts", sembol: "applyFull" },
      { dosya: "src/services/tambur-undo.service.ts", sembol: "applySingle" },
      { dosya: "src/services/tambur-undo.service.ts", sembol: "applySingleRestore" },
      { dosya: "src/services/subcontractor.service.ts", sembol: "cancelReceipt" },
    ],
    ["src/services/helpers/tambur-plan-gate.helper.ts"]),
  // ⚠️ TANECİK `confirmationId`, SATIR DEĞİL: renk+en birlikte saparsa 2 satır ama
  //    BİR imza; tek satırı damgalamak imzayı YARIM geri alır ve yarım geri alınmış
  //    bir imza hiç geri alınmamıştan KÖTÜDÜR — karne onu tutarlı GÖRÜR.
  // ⚠️ ONARIMIN İKİ AYAĞI AYRILAMAZ ve ikisi de indi: `revokedAt IS NULL` süzgeci
  //    DÖRT okuyucuda (karne findMany + ham SQL gün serisi + karşılaştırma dönemi +
  //    Tambur kapısının `findFirst`i) VE kabul iptalinin `fason-receipt` satırlarını
  //    damgalaması. Süzgeç tek başına boş küme üzerinde çalışırdı.
  // ⚠️ SINGLE dallarında `finalize` imzası DAMGALANMAZ (childRollId NULL, qtyM =
  //    topun TAMAMI): kardeşler ayakta, topun geri kalanı hâlâ sapan kimlikle depoda.
  // Uygulama: 4b666d33 · tasarım: docs/design/PLAN-SAPMA-GERI-ALMA-TASARIM.md
  // Bekçi: scripts/test_plan_deviation_undo.ts (25 kontrol, iki negatif sonda koşuldu)

  D("SackAllocation", "sipariş karşılama defteri — MALİ ETKİSİ OLAN tek tahsis defteri", { tur: "YOK" }, [],
    ["src/services/shipping.service.ts"],
    { silen: ["src/services/shipping.service.ts"], borc: [{
      ne: "sil-yaz (3 deleteMany); değişim geçmişi AUDIT'e yazılıyor (tx dışında, best-effort, 6 ayda arşivlenir)",
      kanit: "shipping.service.ts deleteMany ×3: writeShipmentAllocationsTx · setShipmentOrders · cancelPlannedShipmentTx · flushAllocationAudit tx DIŞINDA · kod yorumu tabloyu \"mali etkisi olan tek defter\" diyor",
      sahibi: "sevkiyat alanı",
    }] }),

  // ⚠️ ESKİ BORÇ KAPANDI (2026-09-13) — ÖNCÜLÜ YANLIŞTI, koşulu sağlandığı için değil.
  // Not "aynı ilişki iki rejimle kapanıyor: deleteMany ve isActive:false" diyordu.
  // Sonda (yanlışlanabilir): BİR SOFT-DELETE GERİ ALINMAZ. `undoDispatch` `isActive`i
  // `true`ya çeviriyor ⇒ o bir silme damgası değil, `shipment.status = PLANNED`
  // denormu — şema zaten böyle tanımlıyor. İki farklı soru yan yana görülüp aynı
  // sanılmış. Kural: "iki yol var" demek, ikisinin AYNI soruyu cevapladığı
  // ölçülmeden bir borç değil bir GÖZLEMDİR.
  //
  // AÇIK SORU (borç DEĞİL — öncülü henüz ölçülmedi): `setShipmentOrdersTx`in
  // `deleteMany`i "bu sevkiyat eskiden şu siparişi kapsıyordu" izini siler ve
  // kapsam sevk SONRASI da değişebilir (test_shipment_order_ledger §5 onarım yolu).
  // Ölçülen: iz siliniyor. ÖLÇÜLMEYEN: silinmemeli mi — kapsam replace'i meşru
  // olabilir; asıl soru sevk sonrası değişimin bir deftere yazılıp yazılmadığı.
  D("ShipmentOrder", "sevkiyat ↔ sipariş bağı; isActive = shipment.status PLANNED denormu",
    { tur: "DAMGA", kolon: "isActive" },
    [{ dosya: "src/services/shipping.service.ts", sembol: "undoDispatch" }],
    ["src/services/shipping.service.ts"],
    { silen: ["src/services/shipping.service.ts"] }),

  D("SackTagAssignment", "çuval izi (etiket) ataması", { tur: "YOK" }, [],
    ["src/services/sack-tag.service.ts"],
    { silen: ["src/services/sack-tag.service.ts"], borc: [{
      ne: "YALNIZ ELLE KALDIRMA yolunda satır fiziksel siliniyor — SEVK yolu ZATEN soft (clearedAt + clearedShipmentId, undoDispatch geri alıyor, applyTagsTx'te diriliş dalı var)",
      kanit: "sack-tag.service.ts applyTagsTx deleteMany ×2 (removeAll · remove) · ACTIVE_TAG_WHERE süzgeç olarak sack-search.service.ts'te kullanılıyor",
      sahibi: "sevkiyat alanı",
    }] }),

  // ── SATIRLAR — ters yolu EBEVEYNİNDE ──────────────────────────────────────
  SATIR("SwatchStockReductionItem", "SwatchStockReduction", "düşümün iptal kümesi; storno kalemden okur"),
  SATIR("MergeOperationSource", "MergeOperation", "birleştirmenin kaynak kaydı"),
  SATIR("MergeOperationRef", "MergeOperation", "taşınan satırın kimlik fotoğrafı"),
  SATIR("InvoiceLine", "Invoice", "fatura satırı; düzenleme sil-yaz ama ATOMİK CLAIM `status: DRAFT` arkasında ⇒ hard-delete sınıf ④ (deftere hiç yazmamış taslak), \"bağımsız sil-yaz\" ile KARIŞTIRILMAZ — fark claim'dir"),
  SATIR("SubcontractorDispatchItem", "SubcontractorDispatch", "fason sevk kalemi ⚠️ SINIRDA: 5 bağımsız yazım, 0 silme — bağımsız düzenlenebilir tarafa yakın (ölçüldü 2026-09-13)"),
  SATIR("SubcontractorReceiptItem", "SubcontractorReceipt", "fason kabul kalemi"),
  SATIR("SubcontractorDirectShipAllocation", "SubcontractorDispatch", "açık-sevk tahsisi"),
  SATIR("KartelaDispatchItem", "KartelaDispatch", "kartela sevk kalemi"),
  SATIR("KartelaReceiptItem", "KartelaReceipt", "kartela kabul kalemi"),
  SATIR("ChequeDeliveryNoteItem", "ChequeDeliveryNote", "çek teslim makbuzu kalemi"),

  // ── PİVOTLAR ───────────────────────────────────────────────────────────────
  PIVOT("PermissionTemplateItem"), PIVOT("RouteStepProperty"), PIVOT("ProductRecipeProperty"),
  PIVOT("OrderLineRequiredProperty"), PIVOT("SubcontractorReceiptProperty"), PIVOT("SubcontractorToCategory"),
  PIVOT("ItemAllowedProperty"), PIVOT("ItemAllowedColor"), PIVOT("DevicePeripheral"),
  PIVOT("CustomerStandaloneLabel", "müşteriye bağlı bağımsız etiket tanımı — ayar kümesi (③b)"),
  { model: "RollProperty", sinif: "PIVOT_TICARI",
    gerekce: "topun özelliği rota kapsamasını belirleyen GERÇEK kısıt, ayar değil (2026-09-11 kararı)",
    borc: [{ ne: "7 site sil-yazdan versiyonlamaya geçecek", kanit: "docs/kurallar/defter.md ③a satırı (2026-09-11)", sahibi: "rota/renk alanı" }] },
  { model: "WorkOrderTargetProperty", sinif: "PIVOT_TICARI",
    gerekce: "iş emri hedef özelliği — topun özelliğiyle aynı sınıf (2026-09-11 kararı)",
    borc: [{ ne: "sil-yazdan versiyonlamaya geçecek", kanit: "docs/kurallar/defter.md ③a satırı (2026-09-11)", sahibi: "rota/renk alanı" }] },

  // ── TELEMETRİ — budanabilir, ama KARAR UFKU beyan edilir ──────────────────
  { model: "TravelerCardScan", sinif: "TELEMETRI",
    gerekce: "hiçbir rapor/panel/tablet yüzeyi okutma SAYISI basmıyor (ölçüldü 2026-09-13: rapor servisleri · dashboard · panel · mobil = sıfır)",
    kararUfku: "istasyon/makine KALICI SİLME guard'ı okutma sayar (guarded-hard-remove.ts:126 scanCount → 409). Budama o kararı SESSİZCE serbest bırakır: budanan ufuktan eski okutmalar silinirse kalıcı silinemeyen bir istasyon silinebilir hâle gelir. Budamadan önce ya guard'a kalıcı ikinci tanık verilir (machineHistoryCount zaten orada) ya budama bu ufku aşmaz. İkinci tüketici 10 sn'lik mükerrer okutma penceresidir (geçici, budamadan etkilenmez)." },
  { model: "SystemLog", sinif: "TELEMETRI",
    gerekce: "kalıcı sayaç/rapor SystemLog'tan değil KALICI KOLONDAN okunur ⇒ audit satırı silindiğinde raporlanan hiçbir sayı değişmez",
    kararUfku: "6 ayda arşivlenir; iş kaynağı olarak okunmaz. ⚠️ ÇÜRÜTMENİN ZAYIF HALKASI ÖLÇÜLDÜ (2026-09-13): audit satırı BİR sayaçta okunuyor — backup-impact.service.ts:331 `systemLog.count`. Ama o satır \"İş kaybı DEĞİL — iz kaydı\" etiketiyle `system` grubunda duruyor (iş sayısı değil) ve kod arşivleme ufkunu ZATEN biliyor: :404 `_min(createdAt)` ile kapsamı ölçüp en eski log cutoff'tan sonraysa rollup'ı alt sınır saymıyor, \"ölçülemedi\" diyor — 0 demiyor. Panzehir yerinde olduğu için sınıf TELEMETRİ kalır. Audit'e uzanma ihtiyacı bir DEFTER EKSİKLİĞİNİN işaretidir (bkz. SackAllocation borcu)." },

  // ── DURUM ──────────────────────────────────────────────────────────────────
  { model: "UserRecoveryCode", sinif: "DURUM", gerekce: "tek kullanımlık kurtarma kodu; tüketimi `usedAt` ile işaretlenir, defter değil" },
];

// =============================================================================
// OLAY DÜZEYİ — TANECİK BEYANI
// =============================================================================
// NEDEN AYRI BİR TABLO: bir defterin ters yolu olması, o defterin HER OLAYININ
// ters yolu olduğunu SÖYLEMEZ. `WarehouseMovement` tek tablodur ama 13 olay tipi
// ve 28 sebep kodu taşır; yukarıdaki model düzeyi beyan `reversesMovementId`i
// görüp yeşil verir ve tek tek olayları hiç sormaz. `FASON_DISPATCH` bu boşlukta
// yaşadı: ileri satır yazıldı (39), tersi hiç yazılmadı, kapı 127/0 yeşildi.
//
// NEDEN AD KALIBI DEĞİL: "her ileriye bir `*_CANCEL`" kuralı burada da yanlıştır.
// `SCRAP` terminaldir, `ENTRY_RECEIPT`in tersi `ROLL_CANCEL`dır, `PRODUCTION_ISSUE`un
// tersi `WO_DETACH`tır — hiçbirinin adında `CANCEL` geçmez. ⇒ "`_CANCEL` yok" ile
// "geri alınamıyor" AYRI ŞEYLERDİR ve liste grep'le üretilemez; beyan gerekir.
//
// ⚠️ KAPSAM — BU TABLO DEFTERİN TAMAMINI KONUŞMAZ. Sebep kodu TAŞIYAN satırları
// konuşur. Fabrika yedeğinde (`tekserp_fabrika_dev`, ölçüm 2026-09-13) 778
// satırın 721'i sebep kodsuzdur (ufuk öncesi eski küme; kullanıcı kararıyla
// ONARILMAYACAK) ⇒ bu koldaki yeşil, o satırlar hakkında HİÇBİR ŞEY söylemez.
// Sayı damgalıdır çünkü kapı statiktir (DB'ye bakmaz); tazelenmesi elle yapılır.
// =============================================================================

export type OlayTersYolu =
  /** Tersi YOK ve olmamalı — kararın kendisi nihaidir. */
  | { tur: "TERMINAL"; gerekce: string }
  /** Tersi AYRI BİR İLERİ OLAYDIR (bağ yok, karşı yön). */
  | { tur: "KARSI_OLAY"; kod: string; gerekce: string }
  /** Tersi `reversesMovementId` ile BAĞLI yazılır. */
  | { tur: "BAGLI_TERS"; kod: string }
  /** Bu kodun KENDİSİ bir ters kayıttır; hangi ilerinin tersi olduğunu söyler. */
  | { tur: "TERS_KODU"; ileri: string }
  /** Kodun tarif ettiği iş BAŞKA BİR DEFTERDE yaşıyor — ölü değil, YERİNDEN OLMUŞ. */
  | { tur: "BASKA_DEFTER"; nerede: string; gerekce: string }
  /** Ters yolu YOK ya da ÖLÇÜLMEDİ — muafiyet değil, görünür borç. */
  | { tur: "BORC"; ne: string; kanit: string; sahibi: string };

export const STOK_OLAY_BEYANI: Record<string, OlayTersYolu> = {
  PRODUCTION_ISSUE: { tur: "KARSI_OLAY", kod: "WO_DETACH", gerekce: "attachRolls ↔ detachRolls, ikisi de PRODUCTION olayı, karşı yön" },
  WO_DETACH: { tur: "TERS_KODU", ileri: "PRODUCTION_ISSUE" },
  PRODUCTION_RECEIPT: { tur: "BAGLI_TERS", kod: "KURSUN_REOPEN" },
  KURSUN_REOPEN: { tur: "TERS_KODU", ileri: "PRODUCTION_RECEIPT" },
  TAMBUR_FINALIZE: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO" },
  TAMBUR_UNDO: { tur: "TERS_KODU", ileri: "TAMBUR_FINALIZE" },
  ENTRY_RECEIPT: { tur: "KARSI_OLAY", kod: "ROLL_CANCEL", gerekce: "topun doğuşunun tersi kayıttan düşmesidir; ayrı olay, bağ yok" },
  ROLL_CANCEL: { tur: "BAGLI_TERS", kod: "CANCEL_RESTORE" },
  CANCEL_RESTORE: { tur: "TERS_KODU", ileri: "ROLL_CANCEL" },
  CUSTOMER_RETURN: { tur: "BAGLI_TERS", kod: "RETURN_CANCEL" },
  RETURN_CANCEL: { tur: "TERS_KODU", ileri: "CUSTOMER_RETURN" },
  TRANSFER: { tur: "BAGLI_TERS", kod: "TRANSFER_CANCEL" },
  TRANSFER_CANCEL: { tur: "TERS_KODU", ileri: "TRANSFER" },
  SHIPMENT_DISPATCH: { tur: "BAGLI_TERS", kod: "SHIPMENT_CANCEL" },
  SHIPMENT_CANCEL: { tur: "TERS_KODU", ileri: "SHIPMENT_DISPATCH" },
  KARTELA_DISPATCH: { tur: "BAGLI_TERS", kod: "KARTELA_CANCEL" },
  KARTELA_CANCEL: { tur: "TERS_KODU", ileri: "KARTELA_DISPATCH" },
  STOCK_COUNT: { tur: "BAGLI_TERS", kod: "STOCK_COUNT" },
  SCRAP: { tur: "TERMINAL", gerekce: "gerçek fire kararı; doktrin onu arşivleme değil KARAR sayar (kök CLAUDE.md) — geri alınacak şey top değil kararın kendisidir" },
  OPENING: { tur: "TERMINAL", gerekce: "defterin epoch fotoğrafı; ÖNCESİ YOK, dolayısıyla tersi de yok (warehouse-ledger-reverse.helper.ts epoch şerhi)" },
  SHRINK: { tur: "BASKA_DEFTER", nerede: "RollVariance", gerekce: "çekme ÖLÇÜMdür ve `SHRINK_REASON_CODE=\"FASON_CEKME\"` ile varyans defterine yazılır; stok defterinde hiç yazarı yok (ölçüldü 2026-09-13: 0 yazar / 0 satır)" },

  FASON_DISPATCH: { tur: "BORC",
    ne: "TERS YOLU YOK — fason sevk iptali topu AT_SUBCONTRACTOR → STOCK'a döndürüyor ama deftere HİÇBİR satır yazmıyor; katalogda FASON_*_CANCEL kodu da yok",
    kanit: "subcontractor.service.ts `cancel` (soft cancel) gövdesinde tek defter çağrısı yok · ölçüldü 2026-09-13: 39 ileri / 0 ters / 0 bağlı",
    sahibi: "fason alanı (6e)" },
  FASON_RECEIPT: { tur: "BORC",
    ne: "ÖLÇÜLMEDİ — fason kabulünün geri alınması deftere satır yazıyor mu bilinmiyor",
    kanit: "yazan: subcontractor.service.ts `receiveInner` (ENTRY). Geri alma yolu ARANMADI",
    sahibi: "fason alanı" },
  DISPOSITION: { tur: "BORC",
    ne: "ÖLÇÜLMEDİ — iş emri kapanış dispozisyonunun geri alınması deftere satır yazıyor mu bilinmiyor",
    kanit: "yazan: roll-disposition.helper.ts `applyRollDispositionsTx` (PRODUCTION). Geri alma yolu ARANMADI",
    sahibi: "iş emri alanı" },
  CUT_SPLIT: { tur: "BORC",
    ne: "ÖLÇÜLMEDİ — depo kesiminin geri alınması ebeveyn/çocuk satırlarını tersliyor mu bilinmiyor (net sıfır olay, iki uçlu)",
    kanit: "yazan: tambur.service.ts `cutWarehouseRoll` · `finalizeWarehouseCut` (TRANSFORM ×4). Geri alma yolu ARANMADI",
    sahibi: "tambur alanı" },
  CUT_DISCARD: { tur: "BORC",
    ne: "ÖLÇÜLMEDİ — kesim kalanının atılması geri alınabiliyor mu bilinmiyor",
    kanit: "yazan: tambur.service.ts `finalizeWarehouseCut` (ADJUST)",
    sahibi: "tambur alanı" },
  OVERAGE: { tur: "BORC",
    ne: "ÖLÇÜLMEDİ — kesimde aşım düzeltmesinin tersi bilinmiyor",
    kanit: "yazan: tambur.service.ts `cutWarehouseRoll` (ADJUST)",
    sahibi: "tambur alanı" },
  MANUAL_ADJUST: { tur: "BORC",
    // ⚠️ "YAZARSIZ" DEĞİL "YAZARI BİLİNMİYOR" (ea'nın ayrımı): ilki bir ölçüm
    // sonucu gibi okunur, oysa ölçtüğümüz tek şey MAIN'DE yazar görmediğimiz.
    ne: "YAZARI BİLİNMİYOR ama SATIRI VAR — sınıfı belirlenemiyor",
    kanit: "main'de 0 yazar; git geçmişinde de yok (`-S` yalnız kataloğa eklendiği `15410b07` ve tasarım notunu buluyor). `tekserp_ea_test`te 24 satır: 2026-09-12 08:17–08:24Z, ardışık ÜRETİM barkodları, eventType CANCEL — yani tek bir toplu koşum ve `15410b07`den SONRA. Sahibi ea'ya soruldu: KENDİSİ DEĞİL (üç ölçüm: tarih · barkod öneki · yazdığı tablolar). ⇒ yazar inmemiş bir çalışma ağacında yaşamış olabilir ve bu git'ten YANLIŞLANAMAZ",
    sahibi: "AÇIK — sahibi bulunamadı" },
};
