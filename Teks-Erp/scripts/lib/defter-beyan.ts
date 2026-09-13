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

  // 2026-09-13 (01, dokuma P3): ŞEMA-ONLY — yazan uç yok, `yazan: []` bilinçli (§5 ilk
  // yazıcıyı beyansız gelirse KIRMIZI yapar). Ters yol tasarımda `DOFF_CANCEL`: damga,
  // ve yalnız hiç top doğurmamış indirmede açık (NOT EXISTS rolls.doffEventId) — top
  // doğduysa doff tarihsel olgudur, topun kaderi onu değiştirmez. Ters yazan sembol
  // yazma yüzeyiyle doğar; o gün bu satıra `tersYazan` + `yazan` girer.
  D("DoffEvent", "top İNDİRME defteri — tezgahtan kumaş indiği AN'ın kaydı; top burada DOĞMAZ (KK1'de `entrySource=WEAVING`, `doffEventId` bağı). Append-only, updatedAt YOK; `counterAtDoff` sayacın o anki değerini DONDURUR (sıfırlama beyan edilmiş olay olur, yorumlanacak anomali değil); makine kalıcı silme guard'ını besler (`doffEventCount`)",
    { tur: "DAMGA", kolon: "revokedAt" }, [], []),

  D("MachineStopEvent", "duruş defteri — duruşun OLGULARI (startedAt · endedAt · pickCounter · stopKey) değişmez, KARARI (reasonCode · lossClass) değişir ve her değişim `MachineStopReclass`a satır yazar ⇒ doktrinin durum+defter çifti tek tabloda: reasonCode DURUM, reclass DEFTER. ⚠️ İKİ YAŞAM SÜRESİ tek tabloda (tasarım §4): insan kararlı duruş BUDANMAZ, makine sınıflı duruş kovayla budanır — yüklem `classifiedById IS NOT NULL OR reasonSource IN (OPERATOR,SUPERVISOR)`. Budayıcı bugün YOK; indiği gün §10 `silen` beyanını ister ve tasarım §4 sed ③/④ (tek helper + BEFORE DELETE trigger) onunla birlikte doğar. 01'in guard muafiyetiyle aynı okuma: \"duruş bir DEFTERDİR, guard ingest dilimiyle gelecek\"",
    { tur: "DAMGA", kolon: "revokedAt" }, [], [], { yari: true }),

  D("MachineStopReclass", "sebep DEĞİŞİM defteri — \"ne oldu değişmez\" kuralının NERESİNDE: duruşun olguları değişmez, SINIFLANDIRMASI bir KARARDIR ve karar revize edilir; revizyonun kendisi bu deftere from→to satırı olarak düşer ve o satır bir daha değişmez (append-only, updatedAt YOK). Ters yolu karşı kayıttır (to→from yeni satır), damga değil — bir kararı geri almak onu silmek değil tersini yazmaktır",
    { tur: "YOK" }, [], [],
    { borc: [{
      ne: "ters yolu KARŞI KAYIT olacak (to→from) ama yazma yüzeyi de ters yolu da henüz YOK (P2b-1 şema-only)",
      kanit: "src/ içinde machineStopReclass yaratan 0 yol (keşif 2026-09-13); şemada damga/ters bağ kolonu yok ve olmaması DOĞRU — mekanizma karşı kayıt. Kapanma: reclass yazan uç doğduğunda §5 kırmızı verir; o commit `yazan` + karşı-kayıt yolunu beyan eder ve bu borç silinir",
      tasarim: "docs/design/DOKUMA-TEZGAH-IZLEME-TASARIMI.md",
      sahibi: "dokuma alanı (01, P2b)",
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
  PIVOT("MachineCollectorLink", "toplayıcı → makine KAPSAM satırı; iki FK de Cascade, Decimal yok, karar/ölçüm taşımaz — 01'in guard muafiyetiyle aynı okuma: \"yapılandırmadır, defter değil\" (③b)"),
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
// konuşur. Fabrika yedeğinde (fabrikanın dev kopyası, ölçüm 2026-09-13) 778
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
  PRODUCTION_ISSUE: { tur: "KARSI_OLAY", kod: "WO_DETACH", gerekce: "attachRolls ↔ detachRolls, ikisi de PRODUCTION olayı, karşı yön" },
  WO_DETACH: { tur: "TERS_KODU", ileri: "PRODUCTION_ISSUE" },
  PRODUCTION_RECEIPT: { tur: "BAGLI_TERS", kod: "KURSUN_REOPEN" },
  KURSUN_REOPEN: { tur: "TERS_KODU", ileri: "PRODUCTION_RECEIPT" },
  TAMBUR_FINALIZE: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO" },
  TAMBUR_UNDO: { tur: "TERS_KODU", ileri: ["TAMBUR_FINALIZE", "CUT_SPLIT"] },
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

  FASON_DISPATCH: { tur: "BAGLI_TERS", kod: "FASON_DISPATCH_CANCEL" },
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
  FASON_RECEIPT: { tur: "BAGLI_TERS", kod: "FASON_RECEIPT_CANCEL" },
  FASON_RECEIPT_CANCEL: { tur: "TERS_KODU", ileri: "FASON_RECEIPT" },
  DISPOSITION: { tur: "BORC",
    ne: "ters yolu KISMİ — bağımsız \"iş emrini yeniden aç\" yolu yok; tambur-undo FULL yalnız ÇOCUK topların satırlarını tersler",
    kanit: "yazan: roll-disposition.helper.ts:304 (PRODUCTION, WO kapanışında dispozisyon alan her topa). Geri alma: workorder*.ts içinde reopen/undoClose YOK; `WO_CANCEL_DISPOSITION` (workorder.service.ts:3844) İLERİ bir olaydır (WO iptali), ters değil. tambur-undo applyFull (:1673) `reverseAllRollStockMoves(ids)` ile ÇOCUKLARIN tüm satırlarını tersler (TAMBUR_UNDO bağlı) — dispozisyon satırı çocuk üstündeyse terslenir, kaynak/kardeş top üstündeyse TERSLENMEZ. Kapanır: WO yeniden açma yolu doğduğunda dispozisyon satırlarını `reverseLatestScopedStockMove(rollIds, {reasonCode: DISPOSITION, workOrderStepId})` ile tersler; ya da tambur-undo FULL kapsamı dispozisyon alan TÜM topları kapsar ve `test_stock_ledger_tambur_undo` bunu ölçer",
    sahibi: "iş emri alanı (01)" },
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
  CUT_SPLIT: { tur: "BAGLI_TERS", kod: "TAMBUR_UNDO" },
  CUT_DISCARD: { tur: "BORC",
    ne: "ters yazıcısı YOK — kesim kalanının atılması (ADJUST çıkış) hiçbir geri alma dalında terslenmez; TERMİNAL olabilir (SCRAP ile aynı sınıf), hüküm sahibinde",
    kanit: "yazan: tambur.service.ts:2939 (`finalizeWarehouseCut` discard dalı, tek ÇIKIŞ satırı — `test_stock_ledger_transform` §D, grup YOK). Geri alma: satır EBEVEYN üstünde ve tambur-undo ebeveyn satırını hiçbir dalda terslemiyor (CUT_SPLIT kanıtıyla aynı). Semantik: kalanı atmak SCRAP gibi bir KARARDIR (kök CLAUDE.md SCRAP'ı karar sayar, tablo TERMINAL tutar) — ama o hüküm CUT_DISCARD için YAZILI DEĞİL ve analoji ölçüm değildir. Kapanır: sahibi TERMINAL hükmü verir (satır TERMINAL + gerekçeye döner) YA DA depo-kesimi geri alması discard satırını bağlı tersler",
    sahibi: "tambur alanı (01)" },
  OVERAGE: { tur: "BORC",
    // ⚠️ İLK YAZIM TERSİNİ İDDİA ETMİŞTİ ("stok satırı ebeveynde, terslenmez; sapma
    // terslenir") ve 01'in ÇALIŞTIRMASIYLA ÇÜRÜDÜ (2026-09-13). Taze tabanda yeniden
    // ölçüldü: statik okuma `rollId`yi yanlış topa bağlamıştı. Çürütülen satır silinmez,
    // düzeltilir — envanterin güvenilirliği çürütülen satırlarını da taşımasıyla ölçülür.
    ne: "iki defter AYRIŞIYOR ama ilk yazımın TERSİ yönde: stok ADJUST satırı (çocukta) geri almada bağlı terslenir, sapma defterindeki OVERAGE (ebeveynde) terslenmez",
    kanit: "yazan: tambur.service.ts:2480 (`cutWarehouseRoll`, ADJUST, `rollId: child.id` — ÇOCUĞA; aşım DEVİR değil KEŞİFtir, gruba girmez; `test_stock_ledger_transform` §B/§B2). RollVariance OVERAGE ise EBEVEYNE yazılır (:2415 · :3342 `rollId: parent.id`). Geri alma: tambur-undo `reverseAllRollStockMoves([childId])` çocuğun tüm satırlarını tersler ⇒ stok tarafı TAMBUR_UNDO ile bağlı terslenir (01 çalıştırdı: çocuk OVERAGE stok satırı terslendi); ebeveyndeki sapma satırı aynı koşumda TERSLENMEDİ (ebeveyn cur=120 / init=220, OVERAGE:20 duruyor). Yani §13'ün kapsamı olan stok tarafı mekanik olarak BAGLI_TERS biçimindedir; açık kalan soru SAPMA tarafı ve semantiği: keşif geri alınır mı, yoksa ebeveynin init=220'si gerçek olup sapma yerinde mi durmalı? Kapanır: sahibi hüküm verir — (a) \"keşif TERMİNAL, sapma durur\" ⇒ bu satır BAGLI_TERS/TAMBUR_UNDO olur ve sapma tarafı RollVariance beyanında şerh alır; (b) \"geri alma sapmayı da damgalar\" ⇒ tambur-undo :1815 yüklemi OVERAGE'ı kapsar ve test_stock_ledger_tambur_undo ölçer. Hüküm P3 sonrası (1e sırası)",
    sahibi: "tambur alanı (01)" },
  MANUAL_ADJUST: { tur: "BORC",
    // ⚠️ "YAZARSIZ" DEĞİL "YAZARI BİLİNMİYOR" (ea'nın ayrımı): ilki bir ölçüm
    // sonucu gibi okunur, oysa ölçtüğümüz tek şey MAIN'DE yazar görmediğimiz.
    ne: "YAZARI BİLİNMİYOR ama SATIRI VAR — sınıfı belirlenemiyor",
    kanit: "main'de 0 yazar; git geçmişinde de yok (`-S` yalnız kataloğa eklendiği `15410b07` ve tasarım notunu buluyor). `tekserp_ea_test`te 24 satır: 2026-09-12 08:17–08:24Z, ardışık ÜRETİM barkodları, eventType CANCEL — yani tek bir toplu koşum ve `15410b07`den SONRA. Sahibi ea'ya soruldu: KENDİSİ DEĞİL (üç ölçüm: tarih · barkod öneki · yazdığı tablolar). ⇒ yazar inmemiş bir çalışma ağacında yaşamış olabilir ve bu git'ten YANLIŞLANAMAZ",
    sahibi: "AÇIK — sahibi bulunamadı" },
};
