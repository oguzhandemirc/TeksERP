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
    { borc: [{
      ne: "`EXTERNAL` olayının YAZAN YOLU YOK — fason ve kartela firmasına çıkış/dönüş deftere EXTERNAL olarak düşmüyor",
      kanit: "şema yorumu onu \"üçüncü şahıs: fason ve kartela firmasına çıkış / dönüş\" diye tanımlıyor, fason dönüşü ise ENTRY yazıyor",
      kanitSondasi: { tur: "ENUM_DEGERI_YAZILMIYOR", enumAdi: "WarehouseEventType", deger: "EXTERNAL" },
      sahibi: "depo/stok defteri alanı",
    }] }),

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

  // ── DEFTER + BORÇ (ters yolu YOK; muaf DEĞİL, GÖRÜNÜR borç) ────────────────
  D("RollPlanDeviation", "plan-dışı kimlikle inen metrajın KARAR defteri", { tur: "YOK" }, [],
    ["src/services/helpers/tambur-plan-gate.helper.ts"],
    { borc: [{
      ne: "ters yol YOK, damga kolonu bile yok; geri alınan kapanışın sapması karnede sayılmaya devam ediyor",
      // İKİ kusur da GEÇERLİ; ikincisinin MEKANİZMASI bir tur çürütülüp geri alındı:
      //   ① Karne fazla sayar — rapor where'i YALNIZ `createdAt` (:107/:187/:212),
      //      `roll.status` hiçbir sorguda yok; `finalize` kaynağında qtyM TOPUN
      //      TAMAMI ⇒ geri alınıp yeniden finalize edilen top iki tam imza +
      //      iki tam metraj üretir.
      //   ② Kapı soruyu bastırır — ama yolu `tambur-undo` DEĞİL, KABUL İPTALİ +
      //      DİRİLTME zinciri: `cancelReceipt` hareketi silmiyor GERİ ALIYOR →
      //      restore guard'ı `ACTIVE_MOVEMENT` sayıyor, geri alınmışı görmüyor (0) →
      //      cascade `currentStepId`i null'a çekiyor → `cancelReasonCode` HİÇ
      //      yazılmıyor ⇒ doğan top restore guard'ının HER sinyalinden geçer,
      //      diriltilir ve `fason-receipt` sapma satırı CANLI kalıp Tambur'da
      //      soruyu bastırır. Sapma satırı kabulde DOĞAN topa yazılır
      //      (subcontractor.service.ts:3302 `bornRollInputs`), iptal onu cascade eder.
      //      ⚠️ Onarımın iki ayağı AYRILAMAZ: `revokedAt IS NULL` süzgeci + kabul
      //      iptalinin `fason-receipt` satırlarını DAMGALAMASI; yoksa süzgeç boş
      //      küme üzerinde çalışır.
      kanit: "canlı uç quality.routes.ts:67 ham SQL COUNT/SUM (where yalnız createdAt) · tambur-undo bu satıra DOKUNMUYOR · cancelReceipt+restore zinciri ölçüldü (roll-cancel-restore.helper.ts:88 sekiz sinyal) · damga kolonu yok",
      // ÇÖZÜM TASARLANDI (2026-09-13), UYGULANMADI. Karar: DAMGA (`revokedAt` +
      // `revokedById` + `revokeReason`), karşı kayıt REDDEDİLDİ — karne onayı
      // `COUNT(DISTINCT confirmationId)` ile sayıyor, karşı satır ya onay sayısını
      // artırır ya `qtyM`yi belirsizleştirir. Tanecik SATIR DEĞİL `confirmationId`
      // (renk + en birlikte saparsa 2 satır ama BİR imza; yarım damga bir imzayı
      // yarım geri almaktır). Dört damgalayan dal: FULL · SINGLE (yalnız
      // `childRollId`e bağlı; `finalize` satırı DAMGALANMAZ, topun geri kalanı hâlâ
      // sapan kimlikle depoda) · SINGLE_RESTORE · cancelReceipt cascade. Üç okuyucu
      // süzer (karne: findMany + ham SQL gün serisi + karşılaştırma dönemi) + kapı.
      // ⚠️ `revokedAt` kolonu indiği AN bu kapı §6b'den KIRMIZI verir ve beyanın
      // `{ tur: "DAMGA", kolon: "revokedAt" }`a çevrilmesini ister — kusur değil,
      // beyanın güncellenme çağrısıdır.
      tasarim: "docs/design/PLAN-SAPMA-GERI-ALMA-TASARIM.md",
      sahibi: "tambur alanı (tasarım 01, uygulama sahibine verilecek)",
    }] }),

  D("SackAllocation", "sipariş karşılama defteri — MALİ ETKİSİ OLAN tek tahsis defteri", { tur: "YOK" }, [],
    ["src/services/shipping.service.ts"],
    { silen: ["src/services/shipping.service.ts"], borc: [{
      ne: "sil-yaz (3 deleteMany); değişim geçmişi AUDIT'e yazılıyor (tx dışında, best-effort, 6 ayda arşivlenir)",
      kanit: "shipping.service.ts:2066/2817/3546 deleteMany · flushAllocationAudit tx DIŞINDA · kod yorumu tabloyu \"mali etkisi olan tek defter\" diyor",
      sahibi: "sevkiyat alanı",
    }] }),

  D("ShipmentOrder", "sevkiyat ↔ sipariş bağı", { tur: "YOK" }, [],
    ["src/services/shipping.service.ts"],
    { silen: ["src/services/shipping.service.ts"], borc: [{
      ne: "AYNI ilişki iki rejimle kapanıyor: fiziksel deleteMany ve isActive:false — hangisinin doğru olduğu yazılı değil",
      kanit: "shipping.service.ts:1964 setShipmentOrdersTx deleteMany · :3547 updateMany({isActive:false})",
      sahibi: "sevkiyat alanı",
    }] }),

  D("SackTagAssignment", "çuval izi (etiket) ataması", { tur: "YOK" }, [],
    ["src/services/sack-tag.service.ts"],
    { silen: ["src/services/sack-tag.service.ts"], borc: [{
      ne: "\"geçersiz iz\" kavramı KURULMUŞ (ACTIVE_TAG_WHERE) ama satır yine fiziksel siliniyor",
      kanit: "sack-tag.service.ts:488/492 deleteMany · ACTIVE_TAG_WHERE sack-search.service.ts:211/431'de süzgeç olarak kullanılıyor",
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
