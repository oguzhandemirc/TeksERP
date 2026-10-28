// =============================================================================
// AUDIT DEĞER ETİKETLERİ — İKİNCİ PARÇA (izlenebilirlik B2, 2026-10-25)
// -----------------------------------------------------------------------------
// `audit-enum-etiketleri.ts`deki `ENUM_LABELS`in devamıdır (dosya boyu tavanı yüzünden
// bölündü; anlam tek harita). Elle yazılan audit işaretleri + ticaret/dokuma/cihaz
// enum'ları. `Electron/src/lib/` altındaki aynı adlı dosya BAYT-EŞİT aynadır.
// =============================================================================

/** `ENUM_LABELS`in ikinci parçası — tek başına kullanılmaz, ana haritaya yayılır. */
export const ENUM_LABELS_EK: Record<string, string> = {
  // ── Elle yazılan audit işaretleri (`event`/`source`/`via` alanlarının değeri).
  // Prisma enum'u DEĞİLLER; çağrı noktalarında string olarak yazılırlar.
  LABEL_PRINTED: "Etiket basıldı",
  PRINT_EVENT: "Baskı olayı",
  PRINT_REVISION: "Baskı revizyonu",
  REISSUE: "Yeniden düzenlendi",
  RELABEL: "Yeniden etiketlendi",
  LABEL_OVERRIDE_EDIT: "Etiket üzerinde elle düzenleme",
  QUALITY_CERTIFICATE: "Kalite belgesi",
  INSPECTION_REPORT: "Muayene raporu",
  SALES_QUOTE: "Satış teklifi", // PrintedDocType (MAL-6)
  WEIGH: "Tartım",
  SESSION: "Oturum",
  PRIMARY: "Birincil",
  FIELD_PAIR: "Alan çifti",
  LAZY_RECONSTRUCT: "Sonradan yeniden kuruldu",
  BACKFILL_ENTRY_STATION: "Giriş istasyonu geriye dönük dolduruldu",
  SET_CONTEXT_DEFAULT: "Bağlam varsayılanı atandı",
  // Tambur
  TAMBUR_CUT_FROM_OPEN_FABRIC: "Tamburda açık kumaştan kesim",
  TAMBUR_CUT_FROM_WAREHOUSE: "Tamburda depo topundan kesim",
  TAMBUR_MANUAL_PRODUCE: "Tamburda elle üretim",
  TAMBUR_UNDO_SINGLE: "Tek topun geri alınması",
  TAMBUR_UNDO_FULL: "Kesimin tümüyle geri alınması",
  TAMBUR_UNDO_RESTORE: "Geri almada metraj iadesi",
  WAREHOUSE_CUT_FINALIZED: "Depo kesimi tamamlandı",
  PRODUCED_STEP: "Üretildiği adım",
  CANCEL_RESTORED: "İptal geri alındı",
  // İş emri
  WO_CLOSE_DISPOSITION: "Terbiye iş emri kapanış kararı",
  ORDER_LINK_ADDED: "Sipariş bağı eklendi",
  TYPE_DERIVED_FROM_LINKS: "Tür bağlardan türetildi",
  TARGET_COLOR_CHANGED: "Hedef renk değişti",
  TARGET_WIDTH_CHANGED: "Hedef en değişti",
  MANUAL_MOVE: "Elle taşıma",
  // Kurşun dağıtımı
  KURSUN_BYPASS_ASSIGN: "Kurşun dağıtım ataması",
  KURSUN_BYPASS_UNASSIGN: "Kurşun dağıtım ataması kaldırıldı",
  KURSUN_BYPASS_TAMBUR_COMPLETE: "Kurşun tamburda kapandı",
  KURSUN_BYPASS_TAMBUR_COMPLETE_UNASSIGNED: "Kurşun tamburda kapandı (makine atanmamış)",
  // Çuval / sevkiyat / fason
  SACK_SCAN: "Çuval okutması",
  SACK_DISTRIBUTE: "Çuvala dağıtım",
  SACK_MOVE_BULK: "Toplu çuval taşıma",
  SACK_REMOVE_WITH_CONTENTS: "Çuval içeriğiyle çıkarıldı",
  SACK_NOTES: "Çuval notu",
  DISPATCH_NOTE: "Sevk notu",
  UNDO_DISPATCH: "Sevk storno",
  FASON_RECEIPT: "Fason kabulü",
  SUBCONTRACTOR_RECEIPT: "Fason mal kabul",

  // SystemLog / Permission kategorileri (değer olarak da geçebilir)
  DOMAIN: "Veri Değişikliği",
  web: "Web",
  admin: "Yönetim",

  // ---------------------------------------------------------------------------
  // TİCARET ENUM DEĞERLERİ — 2026-08-15
  // ---------------------------------------------------------------------------
  // ⚠️ BU HARİTA DEĞER-KAPSAMLIDIR, alan-kapsamlı DEĞİL: aynı değer iki enum'da
  // birden geçebilir ve etiket HER İKİSİ İÇİN DE doğru olmak zorundadır. Bağlamı
  // satırın alan adı verir (`fieldLabel` → "Yön" / "Tür" / "Durum"):
  //   • IN/OUT   → PaymentDirection **ve** YarnMovementKind → "Giriş"/"Çıkış"
  //     (yön-nötr; "Tahsilat" yazmak iplik hareketinde düpedüz yanlış olurdu)
  //   • ISSUED   → ChequeStatus (verildi) **ve** ChequeKind (kendi çekimiz)
  //   • DRAFT    → InvoiceStatus **ve** StockCountStatus
  // İki değer farklı enum'larda ÇELİŞİRSE alan-kapsamlı ikinci bir katman
  // gerekir; bugün gerekmiyor ve gereksiz katman iki sözlüğü drift ettirir.
  // ⚠️ Zaten var olanları TEKRAR EKLEME: CANCELLED · COMPLETED · ACTIVE ·
  // CUSTOMER · SUBCONTRACTOR · OTHER · TRY/USD/EUR/GBP yukarıda tanımlı.

  // InvoiceStatus / StockCountStatus
  DRAFT: "Taslak",
  CONFIRMED: "Onaylandı",
  // InvoiceType
  SALES: "Satış Faturası",
  PURCHASE: "Alış Faturası",
  // PriceKind.SALE — `PURCHASE` ile ÇİFT DEĞİL: `SALE` yalnız PriceKind'da
  // geçer, dolayısıyla global etiketi çelişmez. Kardeşi `PURCHASE` ise
  // InvoiceType ile ÇAKIŞIR ve `FIELD_ENUM_OVERRIDES` ile ayrılır. Bu satır
  // olmadan bir SATIŞ fiyatı düzenlemesi denetimde ham "SALE" basıyordu.
  SALE: "Satış",
  SALES_RETURN: "Satış İadesi",
  PURCHASE_RETURN: "Alış İadesi",
  // PaymentDirection (Payment + CashTransaction) / YarnMovementKind
  IN: "Giriş",
  OUT: "Çıkış",
  // PaymentMethod
  CASH: "Nakit",
  BANK_TRANSFER: "Havale / EFT",
  CREDIT_CARD: "Kredi Kartı",
  // CashTxnKind
  EXPENSE: "Gider",
  INCOME: "Gelir",
  TRANSFER_IN: "Virman (gelen)",
  TRANSFER_OUT: "Virman (giden)",
  OPENING: "Açılış / Devir",
  // Tek yazar (2026-09-18): carili tahsilatın kasa defteri satırı; PAYMENT (ödeme satırı) CariTxnSource ile ORTAK — CASH_TRANSACTION.kind override'ı
  COLLECTION: "Tahsilat",
  // ChequeStatus (metinler `Cheques/labels.STATUS_LABEL` ile aynı anlamda)
  PORTFOLIO: "Elimizde (portföy)",
  AT_BANK: "Bankada (tahsilde)",
  ENDORSED: "Ciro edildi",
  COLLECTED: "Tahsil edildi",
  BOUNCED: "Karşılıksız",
  RETURNED: "İade edildi",
  PAID: "Ödendi",
  // ChequeKind — `ISSUED` ChequeStatus ile ORTAK; etiket ikisinde de doğru.
  RECEIVED: "Aldığımız",
  ISSUED: "Verdiğimiz (kendi çekimiz)",
  // PurchaseOrderStatus — `PO_STATUS_LABEL` ile aynı anlam; "Bekliyor"/"Tamamlandı"
  // burada PENDING/COMPLETED ile çakışacağı için ayırt edici yazıldı.
  OPEN: "Açık (mal bekleniyor)",
  CLOSED: "Kapandı (tamamlandı)",
  // YarnMovementKind (düzeltme kayıtları)
  ADJUST_IN: "Düzeltme (giriş)",
  ADJUST_OUT: "Düzeltme (çıkış)",
  // YarnMovementKind — devere 1b (levent): brüt çıkış + ayrı iade + tersleri
  // WarpBeamStatus/WarpBeamOrigin/WarpKgSource (devere 1b) — PLANNED/CANCELLED/IN_HOUSE ortak değerler
  READY: "Hazır",
  SHIPPED_OUT: "Fasona verildi",
  // SubcontractorDispatchItemKind (fason F1, 2026-09-14) — ROLL ortak ("Top"), levent kalemi:
  WARP_BEAM: "Levent",
  SUBCONTRACT: "Fasona sardırıldı",
  PURCHASED: "Hazır alındı",
  // G3 emanet (2026-09-15): müşterinin emanet leventi (mal bizim değil; taraf `ownerCustomerId`).
  CONSIGNED: "Müşterinin emanet leventi",
  THEORETICAL: "Nominal (hesap)",
  // YarnLotQualityStatus (iplik lotu kalite bekletme, 2026-09-18)
  RELEASED: "Serbest",
  ON_HOLD: "Kalite bekletmede",
  BLOCKED: "Bloke",
  WARP_ISSUE: "Çözgü çıkışı (levente sarım)",
  WARP_ISSUE_REVERSAL: "Çözgü çıkışı iptali",
  WARP_RETURN: "Levent dibi iadesi",
  WARP_RETURN_REVERSAL: "Levent dibi iadesi iptali",
  // Devere Faz 3 (2026-09-14): levent durumları · bağlama yöntemi · metre kaynağı · sebep katalogları
  MOUNTED: "Tezgahta (bağlı)",
  EXHAUSTED: "Bitti (levent dibi)",
  SCRAPPED: "Hurdaya ayrıldı",
  TYING_IN: "Düğüm",
  DRAWING_IN: "Tahar",
  HARNESS_CHANGE: "Takım değişimi",
  LOOM_COUNTER: "Tezgah sayacı",
  DIAMETER: "Çap ölçümü",
  ESTIMATED: "Tahmin",
  WARP_BEAM_ADJUST: "Levent kalan düzeltmesi",
  WARP_BEAM_SCRAP: "Levent hurda / artık",
  // Fason G1 (2026-09-15): iplik defteri fason türleri · dönüş sebep kataloğu (kalem türü `YARN` ItemType ile ORTAK — :349)
  SUBCONTRACT_OUT: "Fasona iplik çıkışı",
  SUBCONTRACT_OUT_CANCEL: "Fasona iplik çıkışı iptali",
  SUBCONTRACT_RETURN: "Fasondan iplik dönüşü",
  SUBCONTRACT_RETURN_CANCEL: "Fasondan iplik dönüşü iptali",
  YARN_SUBCONTRACT_RETURN: "Fasondan iplik dönüş sebebi",
  WORK_ORDER_PLAN_CHANGE: "Terbiye iş emri plan düzeltme sebebi",
  INSPECTION_VOID: "Muayene iptal sebebi",
  // ───────────────────────────────────────────────────────────────────────
  // TİCARET PAKETİ ENUM DEĞERLERİ (merge, 2026-09-01)
  // Bekçi `test_audit_labels` §4 her Prisma enum değerinin Türkçesini ister;
  // bu değerler `feature/depo-mal-kabul`ta doğdu, bekçi ise `adnansahin`de —
  // ikisi ilk kez burada karşılaştı ve 40 değer etiketsizdi (denetim ekranı
  // ham `CHEQUE_ENDORSE` basıyordu).
  // ───────────────────────────────────────────────────────────────────────
  // ── Cari hareket kaynağı (CariTxnSource) — ön muhasebe defteri
  INVOICE: "Fatura",
  INVOICE_CANCEL: "Fatura iptali",
  PAYMENT: "Tahsilat / Ödeme",
  PAYMENT_CANCEL: "Tahsilat / Ödeme iptali",
  CHEQUE_RECEIVE: "Çek/senet alındı",
  CHEQUE_ISSUE: "Çek/senet verildi",
  CHEQUE_ENDORSE: "Çek/senet cirosu",
  CHEQUE_BOUNCE: "Çek/senet karşılıksız",
  CHEQUE_CANCEL: "Çek/senet iptali",
  ADJUSTMENT: "Düzeltme kaydı",
  ADJUSTMENT_CANCEL: "Düzeltme iptali",
  CHEQUE_ENDORSE_CANCEL: "Çek/senet ciro stornosu",
  CHEQUE_BOUNCE_CANCEL: "Çek/senet karşılıksız stornosu",
  CHEQUE_RETURN_CANCEL: "Çek/senet iade stornosu",
  // ── Çek/senet olayı (ChequeEventType)
  ISSUE: "Düzenlendi",
  RECEIVE: "Alındı",
  DEPOSIT: "Bankaya verildi",
  COLLECT: "Tahsil edildi",
  COLLECT_CANCEL: "Tahsil stornosu",
  ENDORSE: "Ciro edildi",
  BOUNCE: "Karşılıksız çıktı",
  PAY: "Ödendi",
  ENDORSE_CANCEL: "Ciro stornosu",
  BOUNCE_CANCEL: "Karşılıksız stornosu",
  RETURN_CANCEL: "İade stornosu",
  PAY_CANCEL: "Ödeme stornosu",
  DEPOSIT_CANCEL: "Bankaya verme stornosu",
  // ── Çek/senet türü (ChequeDocType)
  CHEQUE: "Çek",
  PROMISSORY_NOTE: "Senet",
  // ── Depo defteri olayı (WarehouseEventType)
  ENTRY: "Depoya giriş",
  TRANSFER: "Depolar arası transfer",
  TRANSFER_REVERSAL: "Transfer stornosu",
  SHIPMENT: "Sevk çıkışı",
  SHIPMENT_REVERSAL: "Sevk stornosu",
  RETURN: "İade girişi",
  CANCEL: "Kayıttan düşme",
  CANCEL_REVERSAL: "Kayıttan düşme stornosu",
  PRODUCTION: "Üretim hareketi",
  TRANSFORM: "Kesim dönüşümü",
  ADJUST: "Metraj düzeltmesi",
  OPENING_BALANCE: "Açılış bakiyesi",
  // ── Birleştirme defteri referans tipi (MergeRefKind)
  MOVED: "Taşındı",
  DELETED: "Silindi (çakışma)",
  FIELD_MERGED: "Alan birleşti",
  // ── Patron bulutu eşitleme işareti (SyncMarkKind) — DELETED MergeRefKind ile ORTAK
  DIRTY: "Kirli (buluta yeniden gönderilecek)",
  // ── Donmuş belge türü (PrintedDocType) — ticaret paketi
  TRANSFER_DISPATCH: "Depo transfer irsaliyesi",
  GOODS_RECEIPT: "Mal kabul fişi",
  INVOICE_INTERNAL: "İç fatura",
  PAYMENT_RECEIPT: "Tahsilat/Ödeme makbuzu",
  RECONCILIATION_LETTER: "Mutabakat mektubu",
  CHEQUE_DELIVERY_NOTE: "Çek/senet teslim bordrosu",
  STOCK_COUNT: "Sayım tutanağı",
  // ── Diğer ticaret enum'ları
  PURCHASE_RECEIPT: "Satın alınan mal (mal kabul)",
  ROLL: "Top",
  RUB: "Rus Rublesi",
  TCMB: "TCMB",
  BOTH: "Hem müşteri hem tedarikçi",

  // ── Tezgah künyesi (dokuma P4, 2026-09-13) — LoomShedType
  ARMUR: "Armür",
  JAKAR: "Jakar",
  KAM: "Kam (Eksantrik)",
  // ── MachineMonitoringState
  // ⚠️ Bu üç değer bugün ÇAKIŞMASIZ (ölçüldü: şemada 26 çakışmanın hiçbirinde
  // yoklar), o yüzden `SHARED_ENUM_VALUES` beyanı gerekmedi. Faz 2'nin makine
  // DURUM enum'u da bir `OFF` getirecek; o gün çakışma doğar ve "izleme kapalı"
  // ile "makine kapalı" için ORTAK bir Türkçe doğru mu sorusu açılır.
  // Çakışmanın güncel hâli buradan değil, `SHARED_ENUM_VALUES`ten ÖLÇÜLÜR.
  OFF: "İzleme kapalı",
  SHADOW: "Gölge mod",
  LIVE: "Yayında",

  // ── Tezgah duruş defteri (dokuma P2b-1, 2026-09-13)
  // MachineDataSource — bir sayının ya da kararın NEREDEN geldiği.
  // ⚠️ `SIMULATED` `OPERATOR`dan AYRI: farklı güven sınıfı. Uydurulmuş değer
  // beyanıyla gider; birleştirmek o beyanı yok ederdi.
  MACHINE: "Makine",
  OPERATOR: "Operatör",
  INFERRED: "Çıkarım",
  SUPERVISOR: "Vardiya amiri",
  // MachineStopLossClass — duruşun randımana etkisi.
  UNPLANNED: "Plansız duruş",
  SETUP: "Kurulum",
  NON_SCHEDULED: "Çalışma dışı",
  // MachineSignalKind — sinyalin ANLAMI (marka bağımsız).
  RUN_CONTACT: "Çalışma kontağı",
  PICK_COUNTER: "Atkı sayacı",
  COURSE_COUNTER: "Sıra sayacı",
  RACK_COUNTER: "Rack sayacı",
  RUN_SECONDS: "Çalışma saati sayacı",
  INSTANT_RPM: "Anlık devir",
  WARP_STOP: "Çözgü kopuşu",
  WEFT_STOP: "Atkı kopuşu",
  OPERATOR_STOP: "Elle durdurma",
  STOP_CODE: "Duruş kodu",
  FABRIC_LENGTH: "Kumaş metre sayacı",
  // MachineStopEndSource — duruşu kim kapattı.
  SIGNAL: "Sinyal",
  WATCHDOG: "Bekçi (ajan sustu)",

  // ── Vardiya karnesi mührü (dokuma raporları Dilim 1, 2026-09-14)
  // MachineSealState — `OPEN` PurchaseOrderStatus ile ÇAKIŞIR → MACHINE_SHIFT_STAT.sealState override'ı.
  SEALED: "Mühürlü",
  // MachineSealAction — mühür defterinin eylemi.
  SEAL: "Mühürlendi",
  UNSEAL: "Mühür açıldı",
  RESEAL: "Yeniden mühürlendi",

  // ── Tezgah alarmı (dokuma alarm A1a, 2026-10-11) — LoomAlarmKind · LoomAlarmState · LoomAlarmEventKind.
  // `OPEN`/`CANCELLED`/`RESOLVED` ÇAKIŞIR (SHARED_ENUM_VALUES); alarm audit'i A1b'de doğar.
  STOP_OVERDUE: "Duruş hedefi aşıldı",
  ACKED: "Üstlenildi",
  RESOLVED: "Çözüldü",
  RAISED: "Kademe çaldı",
  TIER_SKIPPED: "Kademe atlandı",
  ACK: "Üstlenildi",
  ACK_RELEASE: "Üstlenme bırakıldı",
  SNOOZE: "Susturuldu",
  UNSNOOZE: "Susturma kaldırıldı",
  NOTE: "Not",
  NOTE_RETRACT: "Not geri çekildi",
  // ── Alarm sorumluları (A4) — LoomAlarmRecipientMode · LoomAlarmRecipientSource · LoomAlarmRuleRecipientKind.
  BY_PERMISSION: "Yetkisi olan herkes",
  LISTED: "Tanımlı alıcılar",
  HALL_SHIFT: "Hol vardiya sorumlusu",
  DUTY_OVERRIDE: "Nöbet değişikliği",
  USER: "Kişi",
  PERMISSION: "Yetki",

  // ── Patron bulutu gelen kutusu makbuzu (B3) — CloudInboxKind · CloudInboxOutcome.
  SIPARIS: "Sipariş",
  CARI: "Cari",
  ISLENDI: "İşlendi",
  REDDEDILDI: "Reddedildi",

  // ── e-İrsaliye (E1-SEMA) — EIrsaliyeStatus · EIrsaliyeEventType (`REDDEDILDI` yukarıda ortak).
  TASLAK: "Taslak",
  OLUSTURULDU: "Oluşturuldu",
  GONDERILDI: "Gönderildi",
  KABUL: "Kabul edildi",
  KISMI_KABUL: "Kısmen kabul edildi",
  HATA: "Hata",
  IPTAL: "İptal edildi",
  HAZIRLANDI: "Hazırlandı",
  XML_YENIDEN_URETILDI: "XML yeniden üretildi",
  GONDERIM_GERI_ALINDI: "Gönderim geri alındı",
  YANIT_KAYDEDILDI: "İrsaliye yanıtı kaydedildi",
  YANIT_GERI_ALINDI: "İrsaliye yanıtı geri alındı",
  HATA_ALINDI: "Hata alındı",
  IPTAL_EDILDI: "İptal edildi",
  // ── Cihaz bağlama defteri (eşleme v2, D1) — DeviceBindingEventType. `MERGED` DuplicateReviewDecision ile ORTAK.
  REGISTERED: "Kaydedildi",
  REBIND_REQUESTED: "Yeniden bağlama istendi",
  REBOUND: "Yeniden bağlandı",
  REBIND_REJECTED: "Yeniden bağlama reddedildi",
  REVOKED: "Onay geri alındı",
  UNMERGED: "Birleştirme geri alındı",
  PROOF_RESET: "Cihaz sırrı sıfırlandı",
  PURGED: "Kalıcı silindi",
  HW_CONFLICT: "Donanım özeti çakıştı",
  // ── K4P 4 puan muayene (SEMA, 2026-10-24)
  // RollErrorOrigin
  PROCESS: "Süreç hatası",
  INSPECTION: "Muayene hatası",
  // FourPointSize (ASTM D5430 boyut sınıfı)
  UP_TO_3IN: "≤ 7,5 cm (1 puan)",
  IN_3_TO_6: "7,5–15 cm (2 puan)",
  IN_6_TO_9: "15–23 cm (3 puan)",
  OVER_9IN: "> 23 cm (4 puan)",
  // InspectionPhase
  RAW: "Ham muayene",
  FINAL: "Mamul muayene",
  // InspectionWidthSource — MANUAL ortak ("Elle girildi")
  ITEM_CARD: "Ürün kartı eni",
  ROLL_MEASURED: "Topta ölçülen en",
  UNKNOWN: "En bilinmiyor",
  // RuleScope — CUSTOMER ortak ("Müşteri")
  FACTORY: "Fabrika varsayılanı",
  // ScoreUnit
  M2: "100 m² başına",
  YD2: "100 yd² başına",
  // RunningCap — METER/NONE FIELD_ENUM_OVERRIDES ile ayrılır
  YARD: "Yarda başına en fazla 4 puan",
  // ── Gelen belge (D2, 2026-10-29) — DRAFT/APPROVED/PARTIAL/CANCELLED/PENDING/FAILED/SKIPPED ortak (paylaşım beyanı)
  // DeliveryNoteStatus
  APPROVING: "Onaylanıyor",
  // DeliveryNoteSourceKind
  OCR: "Fotoğraftan okundu",
  IMPORT: "Dosyadan aktarıldı",
  // DeliveryNoteLineKind — TOP ortak ("Top (rulo)")
  ARABA: "Araba (tek top)",
  // DeliveryNoteLineStatus
  ENTERING: "Giriş yapılıyor",
  ENTERED: "Girişi yapıldı",
  // DocumentScanStatus
  READING: "Okunuyor",
  READ: "Okundu",
  READ_FAILED: "Okunamadı",
  // DeliveryNoteAliasScope — ITEM/COLOR/PROCESS ortak
  SENDER: "Gönderen firma",
};
