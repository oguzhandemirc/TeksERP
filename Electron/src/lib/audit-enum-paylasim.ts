// =============================================================================
// PAYLAŞILAN ENUM DEĞERLERİ BEYANI (izlenebilirlik B2, 2026-10-25 — `audit-labels.ts`ten taşındı)
// -----------------------------------------------------------------------------
// `test_audit_labels` §4 şemadaki her çakışan değeri burada arar (iki yönlü).
// `Electron/src/lib/` altındaki aynı adlı dosya BAYT-EŞİT aynadır.
// =============================================================================

/**
 * PAYLAŞILAN ENUM DEĞERLERİ — BEYAN EDİLMİŞ BİRLİK (2026-09-13).
 *
 * ⚠️ BİR DEĞERİN PAYLAŞILMASI KUSUR DEĞİLDİR; BEYAN EDİLMEMİŞ OLMASI KUSURDUR.
 * Aşağıdaki satırlar borç değil, ONAYLANMIŞ ortaklıklardır.
 *
 * ⚠️ BU BAŞLIKTA SAYI YAZMIYOR ve bu bilinçlidir: önceki hâli *"25 satır / 239
 * değerin 25'i"* diyordu ve bayatlamıştı (gerçek 26/241 idi; dokuma P4 ile
 * 26/247 oldu). Sayı taşıyan her başlık, listeye satır ekleyen HER commit'in
 * bakım borcudur ve o borç sessizce ödenmez. Güncel sayı ÖLÇÜLÜR — kaynak
 * `schema.prisma` + bu liste, ve `test_audit_labels` §4 ikisini iki yönlü
 * karşılaştırır.
 *
 * NEDEN VAR: `ENUM_LABELS` düz `değer → Türkçe`dir ve bir değeri birden çok
 * enum paylaşabilir (`CANCELLED` tek başına 14 enum'da). Harita ilk göreni tutar ⇒ paylaşılan bir
 * değerde TEK cevap verilir. O cevap tüm paylaşanlar için doğruysa sorun yok;
 * değilse denetim ekranı yanlış Türkçe basar ve DERLEYİCİ SUSAR.
 *
 * Bu liste kusuru değil, kusurun SESSİZLİĞİNİ kapatır: `test_audit_labels`
 * şemadaki her çakışmayı bu listede arar. Yeni bir enum değeri var olan bir
 * değerle çakıştığında kapı KIRMIZI verir ve yazan kişiyi tek bir soruyla
 * yüzleştirir: *ortak Türkçe bu yeni enum için de doğru mu?* Doğruysa buraya
 * satır eklenir, değilse `FIELD_ENUM_OVERRIDES`a girdi yazılır.
 *
 * ⚠️ Liste İKİ YÖNLÜ denetlenir: şemadan düşmüş bir çakışma burada kalırsa
 * (ölü satır) kapı yine kırmızı verir — tek yönlü beyan listeleri şişer ve
 * şişmiş bir liste kapının kendisi olur.
 */
export const SHARED_ENUM_VALUES: Record<string, string> = {
  // ── Cihaz eşleme v2 (D1, 2026-10-24)
  MERGED:
    "DuplicateReviewDecision(mükerrer kart birleşti) ve DeviceBindingEventType(cihaz kopyası ana kayda birleşti) — 'Birleştirildi' ikisinde de doğru",
  // ── Kasa tek yazar (2026-09-18)
  PAYMENT:
    "CariTxnSource(cari hareketinin kaynağı: tahsilat ya da ödeme) ve CashTxnKind(kasa defterinde ÖDEME satırı, çıkış) — ortak Türkçe YETMEZ: " +
    "CASH_TRANSACTION.kind override'ı 'Ödeme' ile ayrıldı (2026-09-18)",
  // ── Fason F1 polimorfik kalem (2026-09-14)
  ROLL: "StockCountLineKind(sayım satırı top) ve SubcontractorDispatchItemKind(fason sevk kalemi top) — ikisi de kalemin TOP olduğunu söyler; ortak Türkçe doğru",
  // ── Devere 1b (2026-09-14)
  WEIGHED: "SackWeighingKind(çuval tartıldı) ve WarpKgSource(levent kg tartıyla bilindi) — ikisi de 'Tartıldı'; ortak Türkçe doğru",
  IN_HOUSE:
    "WeavingExecutionKind(kendi tezgahında dokundu) ve WarpBeamOrigin(içeride sarıldı) — ortak Türkçe YETMEZ: " +
    "ilki dokuma icrası, ikincisi levent kökeni. WARP_BEAM.originKind override'ı ile ayrıldı (2026-09-14)",
  WARP_RETURN:
    "YarnMovementKind(dip iplik depoya döndü) ve ReasonPresetKind(o iadenin sebep kataloğu) — ikisi de LEVENT DİBİ İADESİdir; ortak Türkçe doğru",
  // ── Ortak Türkçe TÜM paylaşanlar için doğru ────────────────────────────────
  // ── Tezgah duruş defteri (dokuma P2b-1, 2026-09-13)
  OPERATOR:
    "MachineDataSource(değeri operatör girdi) ve MachineStopEndSource(duruşu operatör kapattı) — ikisinde de eylemi yapan OPERATÖRDÜR",
  SIMULATED:
    "SackWeightSource ve MachineDataSource — ikisi de UYDURULMUŞ değerin beyanıdır; ortak Türkçe tam da o beyanı taşır",
  MINOR:
    "DefectSeverity ve MachineStopLossClass — ortak Türkçe YETMEZ: ilkinde bir ŞİDDET " +
    "(kusur ne kadar büyük), ikincisinde bir SÜRE sınıfı (mikro-duruş eşiğinin altı). " +
    "MACHINE_STOP_EVENT.lossClass override'ı ile ayrıldı (2026-09-13)",
  EXTERNAL: "StationType(dış istasyon) ve WarehouseEventType(dış hareket) — ikisi de 'Dış'",
  // ── Tezgah + levent etiketi (dokuma manuel veri S1b, 2026-10-21)
  MACHINE:
    "MachineDataSource(değer makineden geldi) ve LabelKind(tezgah etiketi) — ikisi de 'Makine'yi işaret eder; ortak Türkçe doğru",
  WARP_BEAM:
    "SubcontractorDispatchItemKind(fason sevk kalemi levent) ve LabelKind(levent etiketi) — ikisi de 'Levent'; ortak Türkçe doğru",
  WEAVING:
    "RollEntrySource(top tezgahtan indi) ve StationKind(istasyon bir tezgah) — ortak Türkçe YETMEZ: " +
    "ilki topun KAYNAĞI, ikincisi istasyonun TÜRÜ. STATION.kind override'ı ile ayrıldı (2026-09-14)",
  SUBCONTRACTOR: "istasyon/mükerrer-varlık/cari — üçü de aynı gerçek kişiyi işaret eder: 'Fason'",
  OTHER: "istasyon türü ve ödeme yöntemi — ikisi de 'Diğer'",
  YARN: "kalem türü, sayım satırı türü ve fason sevk kalemi türü (G1) — üçü de 'İplik'",
  SCRAP: "sapma türü / top statüsü / kalite rolü — üçünde de 'Fire'",
  SCALE:
    "tartı kaynağı ve çevre birimi türü — ikisi de 'Kantar'; LabResultKind(gri ölçek) için YANLIŞ — " +
    "LAB_TEST_TYPE.resultKind override'ı ile ayrıldı (K4P-LAB, 2026-10-25)",
  MANUAL:
    "tartı kaynağı, kur kaynağı ve NUMARA KAYNAĞI (2026-09-23) — üçünde de " +
    "değeri ELLE giren insandır; LabVerdictSource(hükmü elle veren) de aynı — ortak Türkçe doğru",
  // ── Numara kaynağı (2026-09-23)
  SYSTEM:
    "SystemLogCategory(olayın kaynağı sistemdir) ve NumberSourceMode(numarayı " +
    "yalnız sistem üretir) — ikisinde de eylemi yapan SİSTEMDİR, insan değil; " +
    "ortak Türkçe doğru",
  CANCELLED: "on beş durum enum'u — hepsinde 'İptal' (en geniş ortaklık)",
  // ── Alarm sorumluları (A4): alıcının KAYNAĞI ile kuralın ALICI TÜRÜ aynı üç olgudur — ortak Türkçe doğru.
  HALL_SHIFT: "LoomAlarmRecipientSource(alıcı holün vardiya sorumlusu olduğu için) ve LoomAlarmRuleRecipientKind(kural: holün vardiya sorumlusu) — aynı olgu",
  USER: "LoomAlarmRecipientSource(kişi kuralıyla) ve LoomAlarmRuleRecipientKind(kural: belirli kişi) — ikisi de 'Kişi'",
  PERMISSION: "LoomAlarmRecipientSource(yetki kuralıyla) ve LoomAlarmRuleRecipientKind(kural: yetki koduna sahip herkes) — ikisi de 'Yetki'",
  RESOLVED:
    "LoomAlarmState(alarm çözüldü) ve LoomAlarmEventKind(çözülme olayı) — aynı olgunun durumu ve olayı; ortak 'Çözüldü' doğru",
  IN_PROGRESS:
    "WorkOrderStatus ve WeavingOrderStatus — ikisi de 'Devam Ediyor'. Dokuma iş emri " +
    "IN_PROGRESS iken tezgah koşuyordur; terbiye iş emrininkiyle aynı cümle doğru (2026-09-13)",
  CUSTOMER: "firma türü / mükerrer-varlık / cari — üçü de 'Müşteri'",
  PENDING: "sipariş/adım/cihaz — üçü de 'Bekliyor'",
  APPROVED: "sipariş ve cihaz — ikisi de 'Onaylandı'",
  COMPLETED: "yedi durum enum'u — hepsinde 'Tamamlandı'",
  // ⚠️ 2026-09-13: metin "dördü" diyordu, gerçek BEŞ — `MachineStopLossClass.PLANNED`
  // (planlı duruş) P2b-1'de eklendi ve bekçi SAYIYI değil VARLIĞI ölçtüğü için
  // metin sessizce bayatladı. "Planlandı" planlı duruş için de doğru cevaptır
  // (o duruş PLANLANMIŞTIR) ⇒ ortak Türkçe tutuyor, yalnız sayı düzeltildi.
  PLANNED:
    "terbiye iş emri / dokuma iş emri / sevkiyat / sevkiyat olayı / planlı duruş (MachineStopLossClass) — beşi de 'Planlandı'",
  SUPERSEDED: "terbiye iş emri ve basılı belge — ikisi de 'Eski Versiyon'",
  ACTIVE: "sekiz durum enum'u (ürün yaşam döngüsü dahil) — hepsinde 'Aktif'",
  VOIDED: "refakat kartı, basılı belge ve kartela (durum + kabul iptali olayı) — hepsinde 'İptal'",
  SHIPPED: "top durumu, kartela durumu ve kartela olayı — üçü de 'Sevk Edildi'",
  REDUCED: "kartela durumu ve kartela olayı — ikisi de 'Stoktan düşüldü'",
  DISPATCHED: "sevkiyat ve sevkiyat olayı — ikisi de 'Sevk Edildi'",
  PARTIAL: "içe aktarım ve alış siparişi — ikisi de 'Kısmi'",
  DRAFT: "fatura ve sayım — ikisi de 'Taslak'",
  IN: "ödeme yönü ve iplik hareketi — ikisi de 'Giriş'",
  OUT: "ödeme yönü ve iplik hareketi — ikisi de 'Çıkış'",
  ISSUED: "ChequeKind ve ChequeStatus — global 'Verdiğimiz (kendi çekimiz)' ikisinde de doğru; durum alanı ayrıca CHEQUE.status override'ı taşır",
  DELETED:
    "MergeRefKind(birleştirmede çakışan satır silindi) ve SyncMarkKind(eşitleme işareti: kök satır silindi, 2026-09-29) — " +
    "SyncMark hiçbir denetim kaydına girmez (tetikleyici yazar, audit muafiyeti TELEMETRİ); ekranda yalnız birleştirme bağlamı görünür, ortak Türkçe orada doğru",

  // ── e-İrsaliye (E1-SEMA, 2026-10-24) — durum ile olay aynı fiili taşır
  GONDERILDI: "EIrsaliyeStatus(kayıt gönderildi) ve EIrsaliyeEventType(gönderim olayı) — aynı fiil; ortak Türkçe doğru",
  OLUSTURULDU: "EIrsaliyeStatus(numara+XML üretildi) ve EIrsaliyeEventType(üretim olayı) — aynı fiil; ortak Türkçe doğru",
  REDDEDILDI: "CloudInboxOutcome(bulut makbuzu reddedildi) ve EIrsaliyeStatus(alıcı yanıtı red) — ikisi de 'Reddedildi'; ortak Türkçe doğru",

  // ── Basılı belge türü ile fiyat kaynağı (MAL-6, 2026-10-26)
  PRICE_LIST: "QuotePriceSource(fiyat listeden geldi) ve PrintedDocType(fiyat listesi belgesi) — ikisi de 'Fiyat listesi'; ortak Türkçe doğru",

  // ── Ortak Türkçe YETMEYEN — FIELD_ENUM_OVERRIDES ile ayrılmış ──────────────
  ARCHIVED:
    "ItemLifecycleStatus('Pasif') ve PriceListStatus(yayından kalktı) — ortak cevap fiyat listesi için YANLIŞ; " +
    "PRICE_LIST.status override'ı ile ayrıldı (MAL-4, 2026-10-25)",
  AUTO:
    "StationPropertyMode('Otomatik uygulanır') ve LabVerdictSource(hüküm sınırdan hesaplandı) — ortak cevap hüküm için YANLIŞ; " +
    "LAB_TEST.verdictSource override'ı ile ayrıldı (K4P-LAB, 2026-10-25)",
  METER:
    "PeripheralKind('Metre Sayacı') ve RunningCap(koşu tavanı metre başına) — ortak cevap tavan için YANLIŞ; " +
    "FOUR_POINT_RULE_SET.runningCap override'ı ile ayrıldı (K4P, 2026-10-24)",
  NONE:
    "NumberSeriesDateSegment('Tarih yok') ve RunningCap(koşu tavanı yok) — ortak cevap tavan için YANLIŞ; " +
    "FOUR_POINT_RULE_SET.runningCap override'ı ile ayrıldı (K4P, 2026-10-24)",
  SHIPMENT:
    "WarehouseEventType('Sevk çıkışı') ve EIrsaliyeSourceType(kaydın kaynağı sevkiyat) — ortak cevap kaynak türü için YANLIŞ; " +
    "E_IRSALIYE.sourceType override'ı ile ayrıldı (2026-10-24)",
  OPEN:
    "PurchaseOrderStatus('Açık (mal bekleniyor)'), MachineSealState(karne mühürsüz) ve PackingGroupStatus(sevk partisi) — ortak cevap karne ve parti için YANLIŞ; " +
    "MACHINE_SHIFT_STAT.sealState ve packing_groups.status override'ları ile ayrıldı (2026-09-14 · 2026-09-21); " +
    "LoomAlarmState de paylaşır — alarm audit'i (A1b) kendi tableName'iyle override alır",
  CLOSED:
    "PurchaseOrderStatus('Kapandı (tamamlandı)') ve PackingGroupStatus('Sevk edildi') — ortak cevap parti için YANLIŞ (parti 'kapanmaz', sevk edilir); " +
    "packing_groups.status override'ı ile ayrıldı (2026-09-21)",
  PURCHASE:
    "InvoiceType('Alış Faturası') ve PriceKind — ortak cevap PriceKind için YANLIŞ; " +
    "ITEM_PRICE.kind override'ı ile ayrıldı (bu kusur 2026 öncesinde ELLE yakalandı, bekçisi yoktu)",
  RETURN:
    "WarehouseEventType('İade girişi') ve ChequeEventType — ortak cevap çek için YANLIŞ; " +
    "CHEQUE.event override'ı ile ayrıldı (2026-09-13)",
  CANCEL:
    "WarehouseEventType('Kayıttan düşme') ve ChequeEventType — ortak cevap çek için YANLIŞ; " +
    "CHEQUE.event override'ı ile ayrıldı (2026-09-13)",
};
