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
  /**
   * KARŞI KAYIT — ters yol AYNI DEFTERE from↔to takaslanmış İKİNCİ BİR SATIRDIR ve
   * onu yazan, ileri yolun ta kendisidir. `KARSI_OLAY`dan farkı: tersliği taşıyan şey
   * satırın TİPİ (enum değeri) değil, yön KOLONLARININ sırasıdır — enum çifti aranmaz.
   * `ciftler` o yön kolonlarıdır ([from, to]) ve §3k1 onları şemada arar; §3k2 ters
   * yazanın ileri yazan dosyada olduğunu ölçer (ayrı dosyadaysa mekanizma karşı kayıt
   * DEĞİL, ayrı bir geri alma ucudur ve sınıf yanlıştır).
   */
  | { tur: "KARSI_KAYIT"; ciftler: [string, string][] }
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
      // Beşincisi GRUP kapsamı: TRANSFORM çifti (ebeveyn OUT + çocuk IN) tek kalem
      // olarak terslenir — topa göre ters alma çocuğu görüp ebeveyni yetim bırakıyordu.
      { dosya: "src/services/helpers/warehouse-ledger-reverse.helper.ts", sembol: "reverseTransformGroupsOf" },
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

  D("YarnMovement", "iplik stok defteri; devere 1b çiftleri: çözgü çıkışı ↔ tersi · dip iadesi ↔ tersi (brüt çıkış + ayrı iade, §3.7)",
    { tur: "KARSI_OLAY", enumAdi: "YarnMovementKind", ciftler: [["ADJUST_IN", "ADJUST_OUT"], ["IN", "OUT"], ["WARP_ISSUE", "WARP_ISSUE_REVERSAL"], ["WARP_RETURN", "WARP_RETURN_REVERSAL"]] },
    [{ dosya: "src/services/yarn.service.ts", sembol: "applyYarnMovementTx" }],
    ["src/services/yarn.service.ts"]),

  D("WarpBeamEvent", "levent olay defteri (devere 1b) — WOUND doğuş gerçekleri değişmez; ters yol tipli WOUND_CANCEL, orijinaline `reversesEventId` (tek ters, çift iptal DB'de imkânsız); durum CANCELLED (terminal), PLANNED'a dönmez",
    { tur: "TERS_BAG", kolon: "reversesEventId" },
    [{ dosya: "src/services/warp-beam-wind.service.ts", sembol: "cancelWound" }],
    ["src/services/warp-beam-wind.service.ts"]),

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

  // ⭐ BORÇ KAPANDI (K2, 6e 2026-09-14): sil-yaz BİTTİ — üç `deleteMany` sitesi (writeShipmentAllocationsTx ·
  // setShipmentOrders · cancelPlannedShipmentTx) TEK boğaza indi (`clearShipmentAllocationsTx`), satır
  // `clearedAt` + `clearedShipmentId` + `clearedById` ile DAMGALANIR; tam unique `sack_allocations_active_uq`
  // partial'a döndü (`WHERE "clearedAt" IS NULL`, envanteri test_db_invariants); Σ okuyucuların hepsi
  // `ACTIVE_SACK_ALLOCATION` süzer (AST+tip kapısı `test_sack_allocation_cleared §4`, damga: clearedAt).
  // Geri alma ucu YOK ve olmamalı: yeni tahsis yeni satırdır, damgalı satır tarihtir (versiyon değil damga —
  // hüküm 1e, SackTagAssignment deseni). "Kim değiştirdi" artık audit'te değil satırın kendisinde.
  D("SackAllocation", "sipariş karşılama defteri — MALİ ETKİSİ OLAN tek tahsis defteri; damga clearedAt/clearedById, adres clearedShipmentId",
    { tur: "DAMGA", kolon: "clearedAt" },
    [{ dosya: "src/services/helpers/sack-allocation.helper.ts", sembol: "clearShipmentAllocationsTx" }],
    ["src/services/shipping.service.ts"]),

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

  // BORÇ KAPANDI (2026-09-14): elle kaldırma da soft — `applyTagsTx` remove/removeAll
  // `clearedAt`+`clearedById` damgalar (`clearedShipmentId` NULL = elle; sevk temizliği
  // `performDispatchTx`→`clearSackTagsOnDispatchTx` adres yazar). Ters yol iki yazıcı:
  // storno adresle (`restoreSackTagsOnUndoDispatchTx`), yeniden bırakma ① dalıyla
  // (`applyTagsTx`, künye taze). Satır artık hiçbir yoldan silinmiyor (§10 ölçer).
  D("SackTagAssignment", "çuval izi (etiket) ataması — damga çifti clearedAt/clearedById; adres kolonu clearedShipmentId sevk ↔ elle ayrımı",
    { tur: "DAMGA", kolon: "clearedAt" },
    [{ dosya: "src/services/sack-tag.service.ts", sembol: "restoreSackTagsOnUndoDispatchTx" },
     { dosya: "src/services/sack-tag.service.ts", sembol: "applyTagsTx" }],
    ["src/services/sack-tag.service.ts"]),

  // ── TEZGAH DEFTERLERİ (dokuma P2/P2b-1, 2026-09-13) — yazma yüzeyi HENÜZ YOK ──
  // Dört model şema-only indi; hiçbirinin `src/`de satır yaratan yolu yok (ölçüldü:
  // keşif 0/0/0/0). `yazan: []` bu yüzden ölçülmüş bir gerçek, tembellik değil:
  // ilk yazıcı doğduğu gün §5 "YENİ YOL" der ve beyanı adıyla ister; §4c ise
  // yazan bir defterin ters yazanını da ister. Sınıflar DEVRALINMADI, şemanın kendi
  // şerhlerinden ve tasarım §4 tablosundan ÖLÇÜLDÜ.
  D("MachineRun", "tezgah koşumu — kapanışta DONAN üretim/duruş terimleri taşır (picksAtClose · producedM · stopSecAtClose · closedTermsAt); şerhi birebir: \"kova budandıktan sonra KOŞUM EKSENİ bu terimlerden cevaplanır\" ⇒ kova telemetri, koşum onun donmuş DEFTERİ; tasarım §4 BUDANMAZ; üç bağ Restrict; `clientToken` idempotent; makine kalıcı silme guard'ını besler (karar ufku). Randıman raporu henüz yok ⇒ \"satır silinince rapor değişir mi\" sondası KONUSUZ, okuyucusu koşum ekseni raporu olacak (01 düzeltmesi: karne vardiya×makine, runId taşımaz, DEFTER'i teyit eder çürütemez)",
    { tur: "DAMGA", kolon: "revokedAt" },
    // 2026-09-13 (6e, P2b yazma yüzeyi): açan `openMachineRun`, kapatan `closeMachineRunTx`
    // (tek yazar, terimler donar), geri alan `revokeMachineRun` — üçü aynı dosyada.
    [{ dosya: "src/services/machine-run.service.ts", sembol: "revokeMachineRun" }],
    ["src/services/machine-run.service.ts"],
    { yari: true }),

  // 2026-09-13 (01, dokuma P3 → P3b yazma yüzeyi): kaydeden `openDoff`, geri alan
  // `revokeDoff` — aynı dosyada. Ters yol DAMGA, yalnız hiç top doğurmamış indirmede
  // açık (`rolls: { none: {} }`, statüye BAKILMAZ). Bağ KK1'de `claimDoffForRollTx`
  // ile (FOR UPDATE) kurulur; o helper doff YAZMAZ, kilitler — yazan listesine girmez.
  D("DoffEvent", "top İNDİRME defteri — tezgahtan kumaş indiği AN'ın kaydı; top burada DOĞMAZ (KK1'de `entrySource=WEAVING`, `doffEventId` bağı). Append-only, updatedAt YOK; `counterAtDoff` sayacın o anki değerini DONDURUR (sıfırlama beyan edilmiş olay olur, yorumlanacak anomali değil); makine kalıcı silme guard'ını besler (`doffEventCount`)",
    { tur: "DAMGA", kolon: "revokedAt" },
    [{ dosya: "src/services/machine-doff.service.ts", sembol: "revokeDoff" }],
    ["src/services/machine-doff.service.ts"]),

  D("MachineStopEvent", "duruş defteri — duruşun OLGULARI (startedAt · endedAt · pickCounter · stopKey) değişmez, KARARI (reasonCode · lossClass) değişir ve her değişim `MachineStopReclass`a satır yazar ⇒ doktrinin durum+defter çifti tek tabloda: reasonCode DURUM, reclass DEFTER. ⚠️ İKİ YAŞAM SÜRESİ tek tabloda (tasarım §4): insan kararlı duruş BUDANMAZ, makine sınıflı duruş kovayla budanır — yüklem `classifiedById IS NOT NULL OR reasonSource IN (OPERATOR,SUPERVISOR)`. Budayıcı bugün YOK; indiği gün §10 `silen` beyanını ister ve tasarım §4 sed ③ (tek helper) onunla doğar; sed ④ BEFORE DELETE trigger (`machine_stop_events_block_classified_delete`, insan kararlı satır RAISE) 2026-09-14'te İNDİ — budayıcı ondan geçemez. 01'in guard muafiyetiyle aynı okuma: \"duruş bir DEFTERDİR, guard ingest dilimiyle gelecek\"",
    // Faz 1b (6e, 2026-09-14): yazma yüzeyi DOĞDU — tek yazıcı `machine-stop.service` (aç · kapa ·
    // sınıfla · yeniden sınıfla · geri al). Ters yol DAMGA (`revokeStop`); mühür kapısı tek
    // fonksiyonda (`assertStopShiftWritableTx`, seal modeli inince aynı yer).
    { tur: "DAMGA", kolon: "revokedAt" },
    [{ dosya: "src/services/machine-stop.service.ts", sembol: "revokeStop" }],
    ["src/services/machine-stop.service.ts"], { yari: true }),

  D("MachineStopReclass", "sebep DEĞİŞİM defteri — \"ne oldu değişmez\" kuralının NERESİNDE: duruşun olguları değişmez, SINIFLANDIRMASI bir KARARDIR ve karar revize edilir; revizyonun kendisi bu deftere from→to satırı olarak düşer ve o satır bir daha değişmez (append-only, updatedAt YOK). Ters yolu karşı kayıttır (to→from yeni satır), damga değil — bir kararı geri almak onu silmek değil tersini yazmaktır",
    // Faz 1b (6e, 2026-09-14) yazma yüzeyini getirdi; tipolojinin KARSI_KAYIT türü
    // 2026-09-14'te açıldı (d9) ve `{ tur: "YOK" }` + borç satırı DÜŞTÜ. Ters yol AYNI
    // FONKSİYONDUR — `reclassifyStop`un to→from çağrısı — bu yüzden mühür kapısını
    // (`assertStopShiftWritableTx`) ileri yolla BİRLİKTE taşır ve taşımaması imkânsızdır
    // (ölçüldü 2026-09-14: machine-stop.service.ts:265, claim'den önceki ilk kapı).
    // Kapının SEALED ayağı henüz yok — bugün yalnız 409 SHIFT_CANCELLED; mühür modeli
    // (01 Faz 1a) inince AYNI yere iner, borç orada görünür.
    { tur: "KARSI_KAYIT", ciftler: [["fromReasonCode", "toReasonCode"], ["fromLossClass", "toLossClass"]] },
    [{ dosya: "src/services/machine-stop.service.ts", sembol: "reclassifyStop" }],
    ["src/services/machine-stop.service.ts"]),

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
  PIVOT("MachineCollectorLink", "toplayıcı → makine KAPSAM satırı; iki FK de Cascade, Decimal yok, karar/ölçüm taşımaz — 01'in guard muafiyetiyle aynı okuma: \"yapılandırmadır, defter değil\" (③b)"),
  // ③a TİCARİ pivot → DEFTER (2026-09-14, OZELLIK-PIVOT-SURUMLEME-PLAN Faz 1–2e): satır
  // silinmez, `revokedAt` damgalanır; değişiklik = eski aktif satırın damgası + yeni satır.
  // Ters yazanlar tek helper'da; `silen` YOK (AST kapısı `test_roll_property_revoke` §13d
  // src'de silme sitesini kırmızı yapar). Mekanizma DAMGA — un-revoke yoktur (yeniden
  // ekleme YENİ satır); ters yol "geri alma satır yazar" değil "damga" sınıfıdır.
  D("RollProperty", "topun özelliği ve SEÇİM değeri — rota kapsamasını belirleyen GERÇEK kısıt (2026-09-11 kararı); sürümlenir: değer değişimi (50GR→25GR) eski satırın damgası + yeni satır, partial unique aktif çifti tekil tutar",
    { tur: "DAMGA", kolon: "revokedAt" },
    [{ dosya: "src/services/helpers/property-revoke.helper.ts", sembol: "revokeRollProperties" },
     { dosya: "src/services/helpers/property-revoke.helper.ts", sembol: "setRollPropertyValueTx" },
     { dosya: "src/services/helpers/property-revoke.helper.ts", sembol: "applyRollFlagSetTx" }],
    // 3c53deaf (G2): miras yazımı tambur.service'ten helper'a (`inheritRollPropertiesTx`) taşındı.
    ["src/services/helpers/property-revoke.helper.ts", "src/services/inventory.service.ts",
      "src/services/subcontractor.service.ts", "src/services/workorder.service.ts",
      "src/services/tambur-undo.service.ts"]),
  // ③a ticari pivot → DEFTER (2026-09-14, WOTOL-BAG-DAMGA-PLAN): bağ silinmez, `unlinkedAt`
  // damgalanır; yeniden bağlama YENİ satır (un-unlink yok) — ters yazan `linkOrderLines`.
  // `updatedAt` kalır (yarı: `allocatedQty` replace'te yerinde güncellenir). AST kapısı
  // `test_order_link_unlink` §13 src'de silme ve süzgeçsiz okuru kırmızı yapar.
  D("WorkOrderToOrderLine", "iş emri ↔ sipariş kalemi bağı + `allocatedQty`: `WorkOrder.type` AÇIK bağ sayısının aynası, sipariş karşılaması ve refakat kartı sipariş bloğu açık bağdan okunur; koparma damgası MANUAL_UNLINK · WO_REPLACE · ORDER_LINE_CANCEL · ORDER_DELETE · ORDER_CANCEL",
    { tur: "DAMGA", kolon: "unlinkedAt" },
    // Ters yazan = DAMGAYI yazan helper (RollProperty emsali); yeniden bağlama ileri satırdır (47 K3).
    [{ dosya: "src/services/helpers/order-link.helper.ts", sembol: "unlinkOrderLinesTx" }],
    ["src/services/workorder-link.service.ts", "src/services/helpers/workorder-clone.helper.ts", "src/services/workorder.service.ts"],
    { yari: true }),
  D("WorkOrderTargetProperty", "iş emrinin hedef özelliği — topun özelliğiyle aynı sınıf (2026-09-11 kararı); replace/updateTargetProperties FARK bazlı, çıkan damgalanır (WO_REPLACE · WO_TARGET_UPDATE)",
    { tur: "DAMGA", kolon: "revokedAt" },
    [{ dosya: "src/services/helpers/property-revoke.helper.ts", sembol: "revokeTargetProperties" }],
    ["src/services/helpers/workorder-clone.helper.ts", "src/services/workorder.service.ts"]),

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
// konuşur. Fabrika yedeğinde (fabrikanın dev kopyası, ölçüm 2026-09-13) 778
// satırın 721'i sebep kodsuzdur (ufuk öncesi eski küme; kullanıcı kararıyla
// ONARILMAYACAK) ⇒ bu koldaki yeşil, o satırlar hakkında HİÇBİR ŞEY söylemez.
// Sayı damgalıdır çünkü kapı statiktir (DB'ye bakmaz); tazelenmesi elle yapılır.
// =============================================================================

export type OlayTersYolu =
  /** Tersi YOK ve olmamalı — kararın kendisi nihaidir. */
  | { tur: "TERMINAL"; gerekce: string }
  /**
   * Tersi AYRI BİR İLERİ OLAYDIR (bağ yok, karşı yön). `tersYazan`: karşı olayı
   * yazan fonksiyon — §13f onu kodda arar.
   */
  | { tur: "KARSI_OLAY"; kod: string | string[]; gerekce: string; tersYazan: TersYazan[] }
  // ↑ `kod` küme olabilir: bir karşı olay birden çok ileriyi karşılar (ölçüldü 2026-09-13:
  //   PRODUCTION_ISSUE hem WO_DETACH'ın hem DISPOSITION'ın karşısı — raftan üretime giriş,
  //   iki farklı çıkışın ortak geri yolu). TAMBUR_UNDO.ileri kümesiyle aynı ders.
  /**
   * Tersi `reversesMovementId` ile BAĞLI yazılır. `tersYazan`: ters satırı yazan
   * fonksiyon(lar) — §13f onu kodda arar. NEDEN (1c ölçtü 2026-09-13): `CUT_DISCARD`ı
   * bu kümeye kod YOKKEN eklemek kapıyı 168/0 yeşil bırakıyordu — beyan ile kod
   * arasında hiçbir bağ ölçülmüyordu, yalan söyleyen yeşil. Sembol adı bir çapadır:
   * yeniden adlandırılır ya da silinirse kapı düşer.
   */
  | { tur: "BAGLI_TERS"; kod: string; tersYazan: TersYazan[] }
  /**
   * Bu kodun KENDİSİ bir ters kayıttır; hangi ilerinin tersi olduğunu söyler.
   * Birden çok ileri kod AYNI ters kodla terslenebilir (ölçüldü 2026-09-13:
   * `TAMBUR_UNDO` hem `TAMBUR_FINALIZE`ın PRODUCTION satırını hem `CUT_SPLIT`in
   * TRANSFORM çiftini tersler — `reverseAllRollStockMoves` ve
   * `reverseTransformGroupsOf` aynı sebep kodunu yazar). Tek string'e sığdırmak,
   * ikinci ileri kodu §13d'de YANLIŞ asimetri diye düşürürdü.
   */
  | { tur: "TERS_KODU"; ileri: string | string[] }
  /** Kodun tarif ettiği iş BAŞKA BİR DEFTERDE yaşıyor — ölü değil, YERİNDEN OLMUŞ. */
  | { tur: "BASKA_DEFTER"; nerede: string; gerekce: string }
  /** Ters yolu YOK ya da ÖLÇÜLMEDİ — muafiyet değil, görünür borç. */
  | { tur: "BORC"; ne: string; kanit: string; sahibi: string };

export const STOK_OLAY_BEYANI: Record<string, OlayTersYolu> = {
  PRODUCTION_ISSUE: { tur: "KARSI_OLAY", kod: ["WO_DETACH", "DISPOSITION", "RESCUE"], gerekce: "raftan üretime giriş — üç çıkışın (detach · dispozisyon · kurtarma) ortak karşı yönü; üçü de PRODUCTION olayı, bağ yok",
    tersYazan: [{ dosya: "src/services/workorder.service.ts", sembol: "detachRolls" }] },
  // WO_DETACH TERS_KODU DEĞİL (ölçüldü 2026-09-13): yazıcısı `detachRolls` `postStockMove` ile
  // İLERİ satır yazar (eventType PRODUCTION, reasonCode WO_DETACH), `reverseStockMove` ile
  // bağlı ters DEĞİL — 1e'nin işaret ettiği tutarsızlık. Karşı olay çifti SİMETRİKTİR:
  // attach'ın karşısı detach, detach'ın karşısı attach.
  WO_DETACH: { tur: "KARSI_OLAY", kod: "PRODUCTION_ISSUE", gerekce: "detachRolls ↔ attachRolls — karşı yön, ileri satır (postStockMove), bağ yok",
    tersYazan: [{ dosya: "src/services/helpers/production-issue-ledger.helper.ts", sembol: "postProductionIssuesTx" }] },
  PRODUCTION_RECEIPT: { tur: "BAGLI_TERS", kod: "KURSUN_REOPEN", tersYazan: [{ dosya: "src/services/kursun-qc.service.ts", sembol: "reopenStep" }] },
  KURSUN_REOPEN: { tur: "TERS_KODU", ileri: "PRODUCTION_RECEIPT" },
  TAMBUR_FINALIZE: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO", tersYazan: [{ dosya: "src/services/tambur-undo.service.ts", sembol: "applySingle" }, { dosya: "src/services/tambur-undo.service.ts", sembol: "applySingleRestore" }, { dosya: "src/services/tambur-undo.service.ts", sembol: "applyFull" }] },
  // TAMBUR_CUT (01, hüküm §11 giriş kalemi, 2026-09-13/14): `cutOpenFabric` çocuğunun üretimden
  // depoya GİRİŞİ — K kümesinin ikinci üyesi kapandı. Geri alma yolu finalize çocuğuyla AYNI:
  // applySingle/applySingleRestore/applyFull `reverseAllRollStockMoves` ile TAMBUR_UNDO yazar
  // (bekçi `test_stock_ledger_tambur_undo §18`).
  TAMBUR_CUT: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO", tersYazan: [{ dosya: "src/services/tambur-undo.service.ts", sembol: "applySingle" }, { dosya: "src/services/tambur-undo.service.ts", sembol: "applySingleRestore" }, { dosya: "src/services/tambur-undo.service.ts", sembol: "applyFull" }] },
  TAMBUR_UNDO: { tur: "TERS_KODU", ileri: ["TAMBUR_FINALIZE", "TAMBUR_CUT", "CUT_SPLIT", "CUT_DISCARD", "SCRAP", "OVERAGE"] },
  ENTRY_RECEIPT: { tur: "KARSI_OLAY", kod: "ROLL_CANCEL", gerekce: "topun doğuşunun tersi kayıttan düşmesidir; ayrı olay, bağ yok",
    tersYazan: [{ dosya: "src/services/inventory.service.ts", sembol: "softDelete" }] },
  ROLL_CANCEL: { tur: "BAGLI_TERS", kod: "CANCEL_RESTORE", tersYazan: [{ dosya: "src/services/inventory.service.ts", sembol: "restoreCancelledRoll" }] },
  CANCEL_RESTORE: { tur: "TERS_KODU", ileri: "ROLL_CANCEL" },
  CUSTOMER_RETURN: { tur: "BAGLI_TERS", kod: "RETURN_CANCEL", tersYazan: [{ dosya: "src/services/return.service.ts", sembol: "cancelReturn" }] },
  RETURN_CANCEL: { tur: "TERS_KODU", ileri: "CUSTOMER_RETURN" },
  TRANSFER: { tur: "BAGLI_TERS", kod: "TRANSFER_CANCEL", tersYazan: [{ dosya: "src/services/warehouse-transfer.service.ts", sembol: "cancel" }] },
  TRANSFER_CANCEL: { tur: "TERS_KODU", ileri: "TRANSFER" },
  SHIPMENT_DISPATCH: { tur: "BAGLI_TERS", kod: "SHIPMENT_CANCEL", tersYazan: [{ dosya: "src/services/shipping.service.ts", sembol: "writeUndoDispatchLedgerTx" }] },
  SHIPMENT_CANCEL: { tur: "TERS_KODU", ileri: "SHIPMENT_DISPATCH" },
  KARTELA_DISPATCH: { tur: "BAGLI_TERS", kod: "KARTELA_CANCEL", tersYazan: [{ dosya: "src/services/kartela.service.ts", sembol: "cancelDispatch" }] },
  KARTELA_CANCEL: { tur: "TERS_KODU", ileri: "KARTELA_DISPATCH" },
  STOCK_COUNT: { tur: "BAGLI_TERS", kod: "STOCK_COUNT", tersYazan: [{ dosya: "src/services/stock-count-reversal.service.ts", sembol: "reverseTx" }] },
  // SCRAP (stok sebep kodu) TERMINAL DEĞİL (6e ① 6a59aa6c, hüküm ① b1+b2+b3-dar): TEK yazıcısı
  // depo kesimi kapanışının ham-scrap dalı (tambur.service.ts:2938, CUT_DISCARD ile aynı ternary)
  // ve FULL geri alma `reverseVarianceBoundStockMovesTx` ile bağlı tersler (§14). Kök CLAUDE.md'nin
  // "SCRAP gerçek fire kararıdır" cümlesi RollStatus.SCRAP / RollVariance KARARINI anlatır — bu
  // satır yalnız o kararın STOK DEFTERİ ayağıdır ve kapanış geri alınınca o ayak da döner.
  SCRAP: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO", tersYazan: [{ dosya: "src/services/tambur-undo.service.ts", sembol: "reverseVarianceBoundStockMovesTx" }] },
  OPENING: { tur: "TERMINAL", gerekce: "defterin epoch fotoğrafı; ÖNCESİ YOK, dolayısıyla tersi de yok (warehouse-ledger-reverse.helper.ts epoch şerhi)" },
  SHRINK: { tur: "BASKA_DEFTER", nerede: "RollVariance", gerekce: "çekme ÖLÇÜMdür ve `SHRINK_REASON_CODE=\"FASON_CEKME\"` ile varyans defterine yazılır; stok defterinde hiç yazarı yok (ölçüldü 2026-09-13: 0 yazar / 0 satır)" },

  FASON_DISPATCH: { tur: "BAGLI_TERS", kod: "FASON_DISPATCH_CANCEL", tersYazan: [{ dosya: "src/services/subcontractor.service.ts", sembol: "cancel" }] },
  FASON_DISPATCH_CANCEL: { tur: "TERS_KODU", ileri: "FASON_DISPATCH" },
  // ── Beş kod 2026-09-13'te ÖLÇÜLDÜ (82): geri alma yolları OKUNDU, tahmin edilmedi.
  //    Ölçüm STATİKTİR (kod okuması; çalıştırılmadı). Yöntem: her kodun yazan yolu +
  //    o işin iptal/geri alma yolunda ters helper çağrısı ya da karşı olay var mı.
  //    Ters helper KAPSAMLARI (reverse*/reasonCode) tarandı: ROLL_CANCEL · KARTELA_CANCEL ·
  //    PRODUCTION_RECEIPT · RETURN_CANCEL · STOCK_COUNT · FASON_DISPATCH_CANCEL ·
  //    TAMBUR_UNDO — beşinin HİÇBİRİ yok. Kapanma koşulu her `kanit`in sonunda.
  // 2026-09-13 (6e): 82'nin ölçtüğü "ters yolu YOK" borcu KAPANDI — `cancelReceipt`
  // doğan toplar için giriş satırını `FASON_RECEIPT_CANCEL` ile tersliyor
  // (`reverseLatestScopedStockMove`, bekçi `test_stock_ledger_fason §9`).
  FASON_RECEIPT: { tur: "BAGLI_TERS", kod: "FASON_RECEIPT_CANCEL", tersYazan: [{ dosya: "src/services/subcontractor.service.ts", sembol: "cancelReceipt" }] },
  FASON_RECEIPT_CANCEL: { tur: "TERS_KODU", ileri: "FASON_RECEIPT" },
  // DISPOSITION — KARŞI OLAY (1c ③ 75b1eb0d): kapanış dispozisyonu topu üretimden RAFA indirir
  // (PRODUCTION çıkışı); karşı yönü raftan ÜRETİME giriş = PRODUCTION_ISSUE, artık TEK helper
  // `postProductionIssuesTx` yazar (raftan üretime giren üç satırsız yol da ona bağlandı). Bağ yok,
  // karşı yön var. ⚠️ ÇOCUK KAPSAMI ŞERHİ: tambur-undo FULL yalnız ÇOCUK topların satırlarını
  // tersler; dispozisyon alan top çocuk değilse (kaynak/kardeş) onun yolu geri alma değil
  // yeniden üretime alma = bu karşı olaydır.
  DISPOSITION: { tur: "KARSI_OLAY", kod: "PRODUCTION_ISSUE", gerekce: "üretim → raf (dispozisyon) ↔ raf → üretim (production issue); bağ yok, karşı yön; çocuk kapsamı dışı toplar için tek geri yol",
    tersYazan: [{ dosya: "src/services/helpers/production-issue-ledger.helper.ts", sembol: "postProductionIssuesTx" }] },
  // RESCUE (01, hüküm §11 giriş kalemi, 2026-09-13/14): `rescueStuckRoll` — istasyonda takılı top
  // süpervizörce depoya alınır (PRODUCTION girişi); K kümesinin ilk üyesi kapandı. Karşı yönü
  // DISPOSITION ile aynı: raftan üretime giriş = PRODUCTION_ISSUE (elle taşıma / attach), bağ yok.
  RESCUE: { tur: "KARSI_OLAY", kod: "PRODUCTION_ISSUE", gerekce: "üretim → raf (kurtarma) ↔ raf → üretim (production issue); bağ yok, karşı yön — kurtarılan top yeniden üretime elle taşımayla girer",
    tersYazan: [{ dosya: "src/services/helpers/production-issue-ledger.helper.ts", sembol: "postProductionIssuesTx" }] },
  // CUT_SPLIT — BORÇ KAPANDI (01, `c2a10e88`, koşullu sürüm; 82 statik okuma → 01 çalıştırma:
  // 100 → kes 40 → geri al ⇒ durum 100 ↔ defter 60 ayrışması kapandı). Ters yol
  // `reverseTransformGroupsOf` (warehouse-ledger-reverse.helper.ts:262): çocuğun üye
  // olduğu açık TRANSFORM gruplarının BÜTÜN ileri satırları (ebeveyn OUT dahil),
  // reasonCode TAMBUR_UNDO, `reversesMovementId` bağlı. ⚠️ KOŞULLU: yalnız metraj
  // EBEVEYNE GERİ KONAN dallarda — applySingle `if (!parentArchived)` (:1174),
  // SINGLE_RESTORE (:1408) ve FULL (:1697) koşulsuz. "Kaynak ARŞİVDE" dalında metraj
  // geri dönmez, ebeveynin OUT'u GERÇEK kalır ve terslenmez (RECORD_CORRECTION yazılır)
  // — ilk koşulsuz sürüm orada TERS ayrışma üretiyordu (durum 0 ↔ defter 40).
  // Ölçen: `test_stock_ledger_tambur_undo` §11 beş dal (A depo-restore · B adım-restore ·
  // C kaynak-arşivde · D SINGLE_RESTORE · E FULL), consistency §31 yetim sondası.
  CUT_SPLIT: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO", tersYazan: [{ dosya: "src/services/tambur-undo.service.ts", sembol: "applySingle" }, { dosya: "src/services/tambur-undo.service.ts", sembol: "applySingleRestore" }, { dosya: "src/services/tambur-undo.service.ts", sembol: "applyFull" }] },
  // CUT_DISCARD — BORÇ KAPANDI (6e ① 6a59aa6c): kapanışın sapmaya BAĞLI çıkışı (rollVarianceId)
  // FULL geri almada `reverseVarianceBoundStockMovesTx` ile bağlı terslenir (§13, durum=defter 100=100);
  // SINGLE_RESTORE dokunmaz (§15, bilinçli — kapanış kararı ayakta); scrap-kalan çocuğuna yalnız FULL
  // (§19, 409 UNDO_SCRAP_REMAINDER_FULL_ONLY). İki defter (stok + sapma) birlikte döner — eski
  // "iki defter farklı tersliyor" borcu bu yüzden kapandı.
  CUT_DISCARD: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO", tersYazan: [{ dosya: "src/services/tambur-undo.service.ts", sembol: "reverseVarianceBoundStockMovesTx" }] },
  // OVERAGE — BORÇ KAPANDI (6e ②+④ ef5a40f8 + şema 154998a8 `RollVariance.sourceRollId`; hüküm 1c).
  // İKİ DEFTER, İKİ SINIF — ve ikisi birlikte doğru:
  //   · SAPMA defteri (RollVariance OVERAGE, EBEVEYNDE): TERMİNAL — keşif geri alınmaz, satır
  //     terslenmez, ebeveynde kalır; `restoreBumpTx` mevcut canlı OVERAGE sapmasını bulur ya da
  //     TAMBUR_UNDO_RESTORE kaynaklı yenisini yazar, initialQty yalnız AŞIMDA bump alır (§12).
  //   · STOK defteri (ADJUST, ÇOCUKTA, reasonCode OVERAGE): BAGLI_TERS/TAMBUR_UNDO — çocuğun
  //     satırı `reverseAllRollStockMoves` ile bağlı terslenir ve ebeveyn stok kümesindeyse AYNI
  //     `rollVarianceId` ile +aşım ADJUST ebeveyne TAŞINIR (`readChildOverageRowsTx` →
  //     `transferOverageRowsToParentTx`, `restoreBumpTx` tek kaynak, dört geri alma dalı çağırır).
  //   Bekçi: test_stock_ledger_tambur_undo §12 — durum = defter = 120, canlı OVERAGE n=1 Σ=20,
  //   taşıma satırı aynı rollVarianceId; initialQty şişmez (100 → 100).
  // Tarihçe: ilk yazım tersini iddia etmişti (stok ebeveynde/terslenmez, sapma terslenir), 01'in
  // çalıştırmasıyla çürüdü (`1745b1d6` düzeltti); bugün iki defterin AYRI sınıfta olması ölçülmüş ve
  // kasıtlı — "iki defter farklı tersliyor" bir kusur değil, keşfin doğası.
  OVERAGE: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO", tersYazan: [{ dosya: "src/services/tambur-undo.service.ts", sembol: "restoreBumpTx" }] },
  // MANUAL_ADJUST — BORÇ KAPANDI (6e `fd33f205`, hüküm 1e şık a). Eski beyan "YAZARI BİLİNMİYOR ama
  // SATIRI VAR — sınıfı belirlenemiyor" ÇÜRÜDÜ: main'de yazar yoktu çünkü katalog kodu ÖLÜYDÜ;
  // ea'nın test hedefindeki 24 satır tek seferlik bir koşum iziydi (fabrika kopyasında 0). "Sahibi
  // bulunamadı" da düştü: `roll:manual-adjust` SoD üçlüsü → top-düzeltme alanı (6e).
  // Yazıcı artık VAR: `adjustRollQty` (inventory.service.ts) `postStockMove` ile ADJUST yazar —
  // düşükse `from` −fark, yüksekse `to` +fark — ve `rollVarianceId` ile sapma satırına BAĞLI.
  // Ters yolu DAMGA ya da bağlı ters DEĞİL: geri alma ucu yok; ters yönde ikinci elle düzeltme
  // yeni bir OLGUDUR ⇒ karşı olay KENDİSİ (aynı kod, ters işaret, sapma defterinde karşı satır).
  // §13d simetri kendine döner (KARSI_OLAY ⇄ kendisi); §13f çapa yazıcının kendisi.
  MANUAL_ADJUST: { tur: "KARSI_OLAY", kod: "MANUAL_ADJUST", gerekce: "elle metraj düzeltmesinin tersi ters yönde ikinci bir elle düzeltmedir — aynı kod, ters işaret, rollVarianceId ile sapma defterine bağlı; geri alma ucu yok ve olmamalı (operatör kararı, damga değil olgu)",
    tersYazan: [{ dosya: "src/services/inventory.service.ts", sembol: "adjustRollQty" }] },
  // ENTRY_CORRECTION — giriş ölçümü düzeltmesi (6e 2026-09-14, 1e ② a): `applyManualProperties`
  // bütün topta currentQty = initialQty = m yazarken ADJUST satırı (düşükse from −fark, yüksekse
  // to +fark, `rollVarianceId` ENTRY_QTY_CORRECTION sapmasına bağlı, goodsReceiptId'li). Kabul-anı
  // okuyucuları (`RECEIPT_QTY_REASONS`) ENTRY ile birlikte işaretli toplar. Tersi MANUAL_ADJUST
  // emsali: geri alma ucu yok, ters yönde ikinci düzeltme yeni olgudur ⇒ karşı olay KENDİSİ.
  ENTRY_CORRECTION: { tur: "KARSI_OLAY", kod: "ENTRY_CORRECTION", gerekce: "giriş ölçümü düzeltmesinin tersi ters yönde ikinci bir düzeltmedir — aynı kod, ters işaret, rollVarianceId ile sapma defterine bağlı; geri alma ucu yok (operatör kararı, damga değil olgu)",
    tersYazan: [{ dosya: "src/services/inventory.service.ts", sembol: "applyManualProperties" }] },
};
