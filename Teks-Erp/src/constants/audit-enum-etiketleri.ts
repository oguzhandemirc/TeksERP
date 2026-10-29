// =============================================================================
// AUDIT DEĞER (ENUM) ETİKETLERİ — TEK KAYNAK (izlenebilirlik B2, 2026-10-25)
// -----------------------------------------------------------------------------
// Backend anlatıcısı değerleri okuma anında Türkçeleştirir; sözlük bu yüzden backend'dedir.
// `Electron/src/lib/audit-enum-etiketleri.ts` bu dosyanın BAYT-EŞİT aynasıdır.
// ⚠️ İKİSİNİ BİRLİKTE değiştir — `scripts/test_audit_labels.ts` sha256 + şema kapsamıyla ölçer.
// =============================================================================

import { ENUM_LABELS_EK } from "./audit-enum-etiketleri-ek";
export { SHARED_ENUM_VALUES } from "./audit-enum-paylasim";

/** `ENUM_LABELS`in ilk parçası (üretim/ana veri); ikinci parça `audit-enum-etiketleri-ek.ts`. */
const ENUM_LABELS_ANA: Record<string, string> = {
  // NumberSourceMode — numara kaynağı. ⚠️ `SYSTEM` ve `MANUAL` bu haritada ZATEN
  // var (başka enum'lardan) ve anlamları buraya da uyuyor; yalnız `FREE` yeni.
  FREE: "Serbest (sistem üretir, elle yazılabilir)",
  // NumberSeriesLineOrigin — biçim satırının kökeni (tahmin mi, kayıt mı).
  RECORDED: "Kayıtlı (o an gerçekten bu biçimdi)",
  MIGRATED_GUESS: "Göç tahmini (eski biçim yazılı değildi)",
  // NumberSeriesDateSegment — numara serisindeki tarih parçası. Sıfırlama dönemini
  // de BU belirler, yani etiket "gösterim" değil "sayaç kapsamı" anlatır.
  NONE: "Tarih yok (sayaç sıfırlanmaz)",
  DDMMYY: "Gün-Ay-Yıl (günlük sayaç)",
  DDMMYYYY: "Gün-Ay-Yıl, 4 haneli yıl — 23092026 (günlük sayaç)",
  YYYYMMDD: "Yıl-Ay-Gün — 20260923 (günlük sayaç)",
  MMYY: "Ay-Yıl, 2 haneli yıl — 0926 (aylık sayaç)",
  YYMM: "Yıl-Ay, 2 haneli yıl (aylık sayaç)",
  YYYYMM: "Yıl-Ay, 4 haneli yıl (aylık sayaç)",
  YY: "Yıl, 2 haneli (yıllık sayaç)",
  YYYY: "Yıl, 4 haneli (yıllık sayaç)",
  // StationKind / StationType
  RAW_QC: "Ham Kalite (KK1)",
  PROCESS_QC: "Kurşun + Kalite (KK2)",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason",
  SHIPPING: "Sevkiyat",
  OTHER: "Diğer",
  INTERNAL: "İç",
  EXTERNAL: "Dış",
  // RollStatus
  STOCK: "Stok",
  IN_PRODUCTION: "Üretimde",
  SCRAP: "Fire",
  AT_SUBCONTRACTOR: "Fasonda",
  A1_STOCK: "2. Kalite Stok",
  RETURNED_FROM_SUBCONTRACTOR: "Fasondan Döndü",
  WAREHOUSE: "Depoda",
  SHIPPED: "Sevk Edildi",
  TAMBUR_CONSUMED: "Tamburda Bölündü",
  SUBCONTRACTOR_CONSUMED: "Fasonda Kapandı",
  AT_KARTELA: "Kartelada",
  KARTELA_CONSUMED: "Kartelada Kapandı",
  // ── Kartela olay defteri (2026-09-26) — SwatchStatus · SwatchEventType
  IN_STOCK: "Stokta",
  IN_SACK: "Çuvalda",
  IN_SHIPMENT: "Sevkiyatta",
  REDUCED: "Stoktan düşüldü",
  BORN: "Kabulde doğdu",
  SACKED: "Çuvala girdi",
  UNSACKED: "Çuvaldan çıktı",
  SHIPMENT_ADDED: "Sevkiyata eklendi",
  SHIPMENT_REMOVED: "Sevkiyattan çıkarıldı",
  SHIP_UNDONE: "Sevk geri alındı",
  REDUCTION_REVERSED: "Düşüm geri alındı",
  // QualityGradeRole (2026-09-13) — "bu fabrikada 1./2./fire kalitesi HANGİ
  // KATALOG SATIRI". `RollStatus`taki `SCRAP` ile AYNI anahtarı paylaşır ve
  // paylaşması sorun değil: iki enum da o değere "Fire" der. `FIRST`/`SECOND`
  // ise yeni — yazılmazsa audit yükünde ham `FIRST` görünürdü.
  FIRST: "1. Kalite",
  SECOND: "2. Kalite",
  // RollOperationType
  KURSUN_APPLIED: "Kurşun Geçildi",
  QC2_COMPLETED: "KK2 Tamamlandı",
  TAMBUR_PROCESSED: "Tambur Kararı",
  SUBCONTRACTOR_SENT: "Fasona Sevk",
  SUBCONTRACTOR_RETURNED: "Fasondan Döndü",
  // RollEntrySource
  SUPPLIER_RECEIPT: "Tedarikçi Mal Kabul",
  MANUAL_ENTRY: "Manuel Giriş",
  TAMBUR_SPLIT: "Tambur Ayrımı",
  SUBCONTRACTOR_RETURN: "Fason Dönüşü",
  // ItemType / ItemUnit
  YARN: "İplik",
  FABRIC: "Kumaş",
  CONSUMABLE: "Sarf",
  SERVICE: "Hizmet",
  MT: "Metre",
  KG: "Kilogram",
  ADET: "Adet",
  // CompanyType / ClientType / DeviceKind
  CUSTOMER: "Müşteri",
  SUPPLIER: "Tedarikçi",
  ELECTRON: "Masaüstü",
  MOBILE: "Mobil",
  // Tarayıcıdaki panel (patron/uzaktan erişim) — Electron'dan AYRI bir oturum
  // yuvası taşır, o yüzden denetim kaydında da ayrı görünmeli.
  WEB: "Web",
  TABLET: "Tablet",
  PHONE: "Telefon",
  DESKTOP: "Masaüstü",
  // WeavingExecutionKind — dokuma işini KİM koşuyor (2026-09-13).
  IN_HOUSE: "Kendi tezgahımızda",
  SUBCONTRACTED: "Fasonda dokunuyor",
  // WorkOrderEventType — iş emri hareket defteri olay tipi (2026-09-25).
  CREATED: "Terbiye iş emri açıldı",
  STATUS_CHANGED: "Durum değişti",
  FIELD_CHANGED: "Plan alanı değişti",
  STEP_PLAN_CHANGED: "Adım planı değişti",
  ROLL_ATTRIBUTES_APPLIED: "Toplara uygulandı",
  BATCH_ADDED: "Parti eklendi",
  // OrderStatus / WorkOrderStatus / StepStatus (ortak durumlar dahil)
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  PARTIAL_SHIPPED: "Kısmi Sevk",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  PLANNED: "Planlandı",
  IN_PROGRESS: "Devam Ediyor",
  ACTIVE: "Aktif",
  // ItemLifecycleStatus (ürün kartı yaşam döngüsü — ACTIVE yukarıda ortak)
  PHASE_OUT: "Tükenene kadar",
  ARCHIVED: "Pasif",
  SKIPPED: "Atlandı",
  // WorkOrderType
  ORDER_PRODUCTION: "Siparişe Özel",
  STOCK_PRODUCTION: "Stoğa Üretim",
  // TravelerCardStatus / PrintedDocStatus
  REPRINTED: "Yeniden Basıldı",
  VOIDED: "İptal",
  SUPERSEDED: "Eski Versiyon",
  // ManifestSourceKind — çeki listesinin kaynağı
  WORK_ORDER: "Terbiye iş emri",
  SACK_SELECTION: "Çuval seçimi",
  // ScanType
  ARRIVAL: "Varış",
  DEPARTURE: "Ayrılış",
  INFO: "Bilgi",
  // LabelKind / PrinterLanguage / MediaType / Orientation
  ROLL_RAW: "Ham Top",
  ROLL_FINISHED: "Bitmiş Top",
  SWATCH: "Kartela",
  SACK: "Çuval",
  RASTER_HTML: "Raster (HTML)",
  DIRECT_THERMAL: "Direkt Termal",
  THERMAL_TRANSFER: "Termal Transfer (Ribonlu)",
  PORTRAIT: "Dikey",
  LANDSCAPE: "Yatay",
  // ConnectionType / PeripheralKind / ReadMode
  NETWORK_TCP: "Ağ (TCP)",
  BLUETOOTH_SPP: "Bluetooth (SPP)",
  BLE: "Bluetooth LE",
  USB: "USB",
  SERIAL_COM: "Seri (COM)",
  LABEL_PRINTER: "Etiket Yazıcı",
  SCALE: "Kantar",
  METER: "Metre Sayacı",
  SIGNAL_SOURCE: "Sinyal Kaynağı",
  POLL: "Sorgulama",
  STREAM: "Akış",
  // RollErrorAction / DefectSeverity
  CUT: "Kesildi",
  NO_CUT: "Kesilmedi",
  MINOR: "Küçük",
  MAJOR: "Büyük",
  CRITICAL: "Kritik",
  // Currency
  TRY: "₺ TL",
  USD: "$ USD",
  EUR: "€ EUR",
  GBP: "£ GBP",
  // WorkSessionEndReason
  LOGOUT: "Çıkış",
  NEW_LOGIN: "Yeni Oturum",
  TAKEOVER: "Devralındı",
  IDLE: "Zaman Aşımı",
  ADMIN: "Panelden Kapatıldı",
  // ShipmentStatus / Destination
  DISPATCHED: "Sevk Edildi",
  // Sevkiyat olay defteri (2026-09-11) — ters yolu olan çiftler.
  UNDISPATCHED: "Sevk Geri Alındı",
  INVOICED: "Faturalandı",
  INVOICE_CLEARED: "Fatura İşareti Kaldırıldı",
  // Çuval tartı defteri (2026-09-11).
  WEIGHED: "Tartıldı",
  REWEIGHED: "Yeniden Tartıldı",
  CLEARED: "Tartı Sıfırlandı",
  DOMESTIC: "Yurtiçi",
  EXPORT: "İhracat",
  // PrintedDocType
  SHIPMENT_DISPATCH: "Sevk İrsaliyesi",
  SUBCONTRACTOR_DISPATCH: "Fason Sevk İrsaliyesi",
  KARTELA_DISPATCH: "Kartela Çeki Listesi",
  SUBCONTRACTOR_DIRECT_SHIP: "Fasondan Sevk",
  // SystemLogCategory / DuplicateReviewEntity (değer olarak da geçer)
  AUTH: "Kimlik Doğrulama",
  SYSTEM: "Sistem",
  ITEM: "Kumaş",
  COLOR: "Renk",
  // ImportRunStatus
  APPLIED: "Uygulandı",
  PARTIAL: "Kısmi",
  FAILED: "Başarısız",
  // ImportLineAction — koşumun YAZDIĞI satırın türü. `REVIVE` ayrı değerdir:
  // pasif kaydın kodu gelince servis onu diriltir, tersi "pasife al" DEĞİLDİR.
  CREATE: "Oluşturma",
  UPDATE: "Güncelleme",
  REVIVE: "Diriltme",
  // DuplicateReviewDecision
  MERGED: "Birleştirildi",
  NOT_DUPLICATE: "Mükerrer değil",
  DEFERRED: "Ertelendi",
  // RollVarianceKind
  OVERAGE: "Aşım",
  RECORD_CORRECTION: "Kayıt düzeltmesi",
  // ReasonPresetKind
  ROLL_CANCEL: "Top iptal sebebi",
  ROLL_SCRAP: "Fire sebebi",
  ROLL_MANUAL_ENTRY: "Elle top ekleme sebebi",
  ROLL_RECORD_CORRECTION: "Kayıt düzeltme sebebi",
  WORK_ORDER_REWORK: "Yeniden üretim sebebi",
  ORDER_CANCEL: "Sipariş iptal sebebi",
  MACHINE_STOP: "Tezgah duruş sebebi",
  // TravelerTemplateMode
  BUILTIN: "Yerleşik",
  SECTIONS: "Bölümlü",
  RAW_HTML: "Serbest HTML",
  // PrinterLanguage (marka kodu — çeviri değil, açıklama)
  ZPL: "ZPL (Zebra)",
  PPLA: "PPLA (Argox)",
  PPLB: "PPLB (Argox)",
  // RollEntrySource (eksik kalanlar)
  SEMI_FINISHED: "Yarı Mamul",
  TAMBUR_MANUAL: "Tamburda Elle Eklendi",
  WEAVING: "Dokumadan İndi",
  // StationKind.WARPING (devere, 2026-09-18) — tek anlam, çakışma yok.
  WARPING: "Devere (Levent Sarım)",
  // KursunBypassCompletionSource
  TAMBUR_SCAN: "Tambur Okutması",
  DISTRIBUTION_LAST_STEP: "Dağıtımın Son Adımı",

  // RollForm
  TOP: "Top (rulo)",
  ACIK: "Açık kumaş",
  // FabricPropertyValueType / StationPropertyMode
  FLAG: "Bayrak (var/yok)",
  CHOICE: "Seçim",
  AUTO: "Otomatik uygulanır",
  OPTIONAL: "İsteğe bağlı",
  REQUIRED: "Zorunlu",
  // SackWeightSource (YarnCostPriceSource.MANUAL da aynı anlam)
  MANUAL: "Elle girildi",
  // LabResultKind / LabVerdict (K4P-LAB)
  NUMERIC: "Sayısal ölçüm",
  PASS_FAIL: "Geçti / Kaldı",
  PASS: "Geçti",
  FAIL: "Kaldı",
  // CertificateHolder (K4P-SERT)
  OWN: "Fabrika",
  PARTNER: "İş ortağı",
  // YarnCostPriceSource
  LAST_RECEIPT: "Son mal kabulden",
  PURCHASE_PRICE: "Alış fiyatından",
  // FinishingBasis
  RAW_M: "Ham metre",
  FINISHED_M: "Mamul metre",
  // SalesQuoteStatus (MAL-4; DRAFT/CANCELLED/SUPERSEDED ortak)
  SENT: "Gönderildi",
  ACCEPTED: "Kabul Edildi",
  REJECTED: "Reddedildi",
  CONVERTED: "Siparişe Dönüştü",
  // QuotePriceSource (MAL-4; MANUAL ortak)
  COST_PLUS: "Maliyet + kâr",
  PRICE_LIST: "Fiyat listesi",
  ITEM_PRICE: "Ürün satış fiyatı",
  // PriceListStatus (MAL-4; DRAFT ortak, ARCHIVED override)
  PUBLISHED: "Yayında",
  // CostComponent (standart maliyet kalemi)
  WARP_YARN: "Çözgü ipliği",
  WEFT_YARN: "Atkı ipliği",
  LOOM_MACHINE: "Tezgah",
  LOOM_LABOR: "İşçilik",
  ENERGY: "Enerji",
  BEAM_PREP: "Levent hazırlığı",
  FINISHING: "Terbiye",
  LENGTH_SHRINK: "Boy çekmesi",
  FABRIC_WASTE: "Kalite firesi",
  OVERHEAD: "Genel gider",
  EXTRA: "Ek kalem",
  SIMULATED: "Simüle edildi",
  // PrintedDocType (eksik kalanlar)
  TRAVELER_CARD: "Refakat Kartı",
  RETURN_DISPATCH: "İade İrsaliyesi",
  // `source` alanının serbest değerleri
  RECEIPT: "Mal kabul",

};

/** Enum DEĞERLERİ (durum/tür kolonlarının içeriği) → Türkçe. Bilinmeyen → ham. */
export const ENUM_LABELS: Record<string, string> = { ...ENUM_LABELS_ANA, ...ENUM_LABELS_EK };

// =============================================================================
// ALAN-KAPSAMLI İKİNCİ KATMAN — SADECE GERÇEK ÇELİŞKİLER İÇİN
// =============================================================================
// `ENUM_LABELS` DEĞER-kapsamlıdır ve paylaşılan değerlerin çoğunda bu doğrudur
// (IN/OUT hem PaymentDirection hem YarnMovementKind için "Giriş"/"Çıkış"tır).
// Ama iki değer farklı enum'larda GERÇEKTEN ÇELİŞİYORSA tek harita yalan söyler
// ve dosyanın kendi uyarısı bunu zaten öngörüyordu. 2026-08-15'te iki gerçek
// çelişki ölçüldü:
//
//   • `PURCHASE` → InvoiceType'ta "Alış Faturası" · PriceKind'da bir FATURA
//     DEĞİL bir fiyat türüdür. `ITEM_PRICE` audit'i `kind: PURCHASE|SALE`
//     yazıyor (`item-price.service`), yani bir fiyat düzenlemesinin diff'i
//     "Tür: Alış Faturası" basıyordu; kardeşi `SALE` ise haritada HİÇ yoktu →
//     aynı alanın iki değeri, biri yanlış Türkçe, diğeri ham İngilizce.
//   • `ISSUED` → ChequeKind'da "Verdiğimiz (kendi çekimiz)" · ChequeStatus'ta
//     "Verildi" (çek ekranının kendi sözlüğü: `Cheques/labels.STATUS_LABEL`).
//     İkisi AYNI tabloda yaşadığı için tablo-kapsamlı bir katman YETMEZ.
//
// ⚠️ ANAHTAR `TABLO.alan` — yalnız tablo yeterli değildir (CHEQUE hem `kind`
// hem `status` taşır), yalnız alan da yeterli değildir (`kind` bir düzine
// tabloda geçer). Bağlam `AuditDataBlock`a `tableName` prop'uyla girer.
// ⚠️ BU KATMAN KÜÇÜK KALMALI: her paylaşılan değer için satır eklemek iki
// sözlüğü kaçınılmaz olarak drift ettirir. Kural — yalnız ANLAMLARI ÇELİŞEN
// değerler buraya girer; anlamı ortak olan (IN/OUT, DRAFT) global haritada
// kalır. Bekçi: `audit-labels.trade.test.ts` (aile bazında, bağlamıyla ölçer).
export const FIELD_ENUM_OVERRIDES: Record<string, Record<string, string>> = {
  // PriceKind.PURCHASE — fiyat KARTI türü; "fatura" kelimesi buraya girmez.
  // ⚠️ Kardeşi `SALE` burada YOK ve olmamalı: o değer yalnız PriceKind'da geçer,
  // yani global "Satış" etiketi zaten doğrudur. Global cevapla AYNI olan bir
  // override iki sözlüğü gereksizce drift ettirir (bekçi bunu reddeder).
  "ITEM_PRICE.kind": { PURCHASE: "Alış" },
  // ChequeStatus.ISSUED — çekin DURUMU ("verildi"), türü değil.
  // ⚠️ `CHEQUE.kind` bilerek override ALMAZ: global "Verdiğimiz (kendi
  // çekimiz)" onun için zaten doğrudur.
  "CHEQUE.status": { ISSUED: "Verildi" },
  // ChequeEventType (2026-09-13) — `cheque.service` audit yüküne `event: "..."`
  // yazıyor (`:1598` RETURN · `:1840` CANCEL) ve o değerler `WarehouseEventType`
  // ile ÇAKIŞIYOR. Global cevap DEPO dilinde yazılmış:
  //   RETURN → "İade girişi"     (müşteri iadesinin DEPOYA girişi)
  //   CANCEL → "Kayıttan düşme"  (top iptali/fire — depodan düştü)
  // Çekin iadesi bir depo girişi, çek olayının iptali bir fire DEĞİLDİR;
  // denetim ekranı bu iki olayı yanlış Türkçeyle basıyordu. Kusur, düz
  // `değer → Türkçe` haritasının ilk göreni tutmasından doğuyor ve bekçisi
  // YOKTU (aynı sınıf `ITEM_PRICE.kind`te bir kez ELLE yakalanmıştı).
  "CHEQUE.event": { RETURN: "Çek iade edildi", CANCEL: "Çek kaydı iptal edildi" },
  // MachineStopLossClass.MINOR (2026-09-13) — global cevap "Küçük"tür ve o
  // `DefectSeverity` dilinde yazılmıştır (kusur şiddeti). Duruş tarafında MINOR
  // bir şiddet değil bir SÜRE sınıfıdır: mikro-duruş eşiğinin ALTINDA kalan
  // duruş. "Küçük duruş" demek onu bir sebep gibi gösterirdi; tasarımın kendi
  // uyarısı bu — `MINOR` bir SEBEP sınıfı DEĞİL, bir SÜRE sınıfıdır ve
  // `ReasonPreset.stopLossClass`a asla yazılamaz.
  "MACHINE_STOP_EVENT.lossClass": { MINOR: "Mikro duruş (eşik altı)" },
  // WarpBeamOrigin.IN_HOUSE "içeride SARILDI" — WeavingExecutionKind'ın "kendi tezgahımızda"sı levent için yanlış (devere 1b)
  "WARP_BEAM.originKind": { IN_HOUSE: "İçeride sarıldı" },
  // CashTxnKind.PAYMENT "ödeme satırı (çıkış)" — CariTxnSource.PAYMENT'ın "Tahsilat / Ödeme"si kasa türünde yanlış (tek yazar, 2026-09-18)
  "CASH_TRANSACTION.kind": { PAYMENT: "Ödeme" },
  // RunningCap (K4P, 2026-10-24) — METER global "Metre Sayacı" (PeripheralKind), NONE global "Tarih yok" (NumberSeriesDateSegment); koşu tavanı için ikisi de yanlış
  "FOUR_POINT_RULE_SET.runningCap": { METER: "Metre başına en fazla 4 puan", NONE: "Koşu tavanı yok" },
  // LabResultKind.SCALE (K4P-LAB) — global "Kantar" çevre birimi dilidir; lab türünde gri ölçek notudur
  "LAB_TEST_TYPE.resultKind": { SCALE: "Gri ölçek (1–5)" },
  // LabVerdictSource.AUTO — global "Otomatik uygulanır" özellik modudur; hüküm sınırdan hesaplandı
  "LAB_TEST.verdictSource": { AUTO: "Sınırdan otomatik" },
  // PriceListStatus.ARCHIVED (MAL-4) — global "Pasif" ürün yaşam döngüsü dili; liste için yayından kalkmıştır.
  "PRICE_LIST.status": { ARCHIVED: "Arşivlendi" },
  // StationKind.WEAVING (dokuma ⓪, 2026-09-14) — istasyon TÜRÜ; global `WEAVING`
  // RollEntrySource dilinde ("Dokumadan İndi", topun kaynağı). Ortak Türkçe YETMEZ.
  "STATION.kind": { WEAVING: "Dokuma Tezgahı" },
  // MachineSealState.OPEN (2026-09-14) — karne MÜHÜRSÜZ; global `OPEN` alış siparişi
  // dilinde ("Açık (mal bekleniyor)"). Ortak Türkçe YETMEZ.
  "MACHINE_SHIFT_STAT.sealState": { OPEN: "Açık (mühürsüz)" },
  // DeliveryNoteAliasScope.PROCESS (gelen belge D4, 2026-10-29) — belgedeki İŞLEM metninin eşlemesi;
  // global `PROCESS` RollErrorOrigin dilinde ("Süreç hatası"). Ortak Türkçe YETMEZ.
  "DELIVERY_NOTE_ALIAS.scope": { PROCESS: "İşlem" },
  // PackingGroupStatus (sevk partisi, 2026-09-21) — `OPEN`/`CLOSED` PurchaseOrderStatus
  // ile ÇAKIŞIR; global cevap alış siparişi dilinde ("mal bekleniyor" / "tamamlandı").
  // Partide CLOSED "sevk edildi"dir: son çuvalı sevk edilince sunucu yazar, elle
  // kapatma yoktur (2026-09-22); storno geri getirirse yeniden açık olur.
  "packing_groups.status": { OPEN: "Açık", CLOSED: "Sevk edildi" },
  // EIrsaliyeSourceType.SHIPMENT (E1-SEMA) — kaydın KAYNAK türü; global `SHIPMENT` depo olayı dilinde ("Sevk çıkışı").
  "E_IRSALIYE.sourceType": { SHIPMENT: "Sevkiyat" },
};

/** Audit değeri bağlamı — `tableName` yoksa yalnız global harita kullanılır. */
export interface EnumLabelContext {
  tableName?: string | null;
  field?: string | null;
}

export function enumValueLabel(value: string, ctx?: EnumLabelContext): string {
  if (ctx?.tableName && ctx.field) {
    const scoped = FIELD_ENUM_OVERRIDES[`${ctx.tableName}.${ctx.field}`]?.[value];
    if (scoped) return scoped;
  }
  return ENUM_LABELS[value] ?? value;
}
