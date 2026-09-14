// =============================================================================
// Audit (denetim) etiketleri — TEK KAYNAK.
// -----------------------------------------------------------------------------
// Backend audit kayıtları ham İngilizce tutar (tableName, action, oldData/newData
// alan adları + enum değerleri). Kullanıcıya gösterirken burada Türkçeleştirilir.
// Hem "Aktivite Günlüğü" (System/Activity) hem "Denetim Raporları" (Reports/Audit)
// bu haritalardan besleniyor — iki ayrı harita drift ederdi, artık tek kaynak.
//
// Bilinmeyen anahtar/enum → ham değer geri döner (yeni tablo eklenince ekranda
// görünür, sessizce kaybolmaz; buraya eklemek yeterli).
//
// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-25 — KONU BAŞINA TEK SÖZLÜK. Önceden alan adları için burada İKİNCİ
// bir `FIELD_LABELS` haritası vardı (ham veri bloğu onu, "Ne değişti" listesi
// `audit-field-labels`i kullanıyordu) → aynı çekmecede iki dil. Artık:
//   • alan adı  → `audit-field-labels.ts` (backend aynası)   ← buradan RE-EXPORT
//   • modül adı → TABLE_LABELS            (bu dosya)
//   • olay adı  → EVENT_ACTION_LABELS     (bu dosya)  ← Sistem Kayıtları + Denetim Raporları
//   • değerler  → ENUM_LABELS             (bu dosya)
// `Teks-Erp/scripts/test_audit_labels.ts` backend'in bastığı HER tableName ve
// HER sistem olayının burada karşılığı olduğunu mekanik doğrular (KIRMIZI).
// =============================================================================

import { format, parseISO, isValid } from "date-fns";
import { tr } from "date-fns/locale";

/** Backend `tableName` → Türkçe modül adı. */
export const TABLE_LABELS: Record<string, string> = {
  // Sistem event kategorileri (tableName = kategori string'i)
  AUTH: "Kimlik Doğrulama",
  SYSTEM: "Sistem",

  // Master data
  USER: "Kullanıcı",
  ITEM: "Kumaş / Stok Kalemi",
  CUSTOMER: "Müşteri",
  CUSTOMER_BRANCH: "Müşteri Şubesi",
  CUSTOMER_ITEM_ALIAS: "Müşteri Kumaş Kodu",
  CUSTOMER_COLOR_ALIAS: "Müşteri Renk Kodu",
  STATION: "İstasyon",
  STATION_CAPABILITY: "İstasyon Yeteneği",
  MACHINE: "Makine",
  ROUTE: "Rota",
  COLOR: "Renk",
  FABRIC_PROPERTY: "Kumaş Özelliği",
  QUALITY_GRADE: "Kalite Sınıfı",
  DEFECT_TYPE: "Hata Tipi",
  RETURN_REASON: "İade Sebebi",
  PRODUCT_RECIPE: "İş Emri Şablonu",
  PERIPHERAL_DEVICE: "Saha Cihazı",

  // Sipariş & İş Emri
  ORDER: "Sipariş",
  BATCH: "Parti",
  ORDER_LINE: "Sipariş Satırı",
  WORK_ORDER: "İş Emri",
  WORK_ORDER_STEP: "İş Emri Adımı",
  MANIFEST: "Çeki Listesi",

  // Top & Üretim
  ROLL: "Top",
  ROLL_MOVEMENT: "Top Hareketi",
  ROLL_OPERATION: "Top İşlemi",
  ROLL_ERROR: "Top Hatası",
  ROLL_MANUAL_OVERRIDE: "Top Manuel Düzeltme",
  ROLL_RETURN: "Top İadesi",
  ROLL_SACK_ASSIGN: "Top → Çuval Atama",
  TRAVELER_CARD: "Refakat Kartı",
  TRAVELER_CARD_SCAN: "Refakat Kartı Okutması",

  // Fason akışı
  SUBCONTRACTOR: "Fason Firma",
  SUBCONTRACTOR_CATEGORY: "Fason Kategorisi",
  SUBCONTRACTOR_DISPATCH: "Fason Sevki",
  SUBCONTRACTOR_RECEIPT: "Fason Mal Kabul",
  DIRECT_SHIPMENT: "Fasondan Sevk",

  // Kartela
  SWATCH: "Kartela",
  SWATCH_SACK_ASSIGN: "Kartela → Çuval",
  KARTELA_DISPATCH: "Kartela Sevki",
  KARTELA_RECEIPT: "Kartela Mal Kabul",
  SWATCH_STOCK_REDUCTION: "Kartela Stok Düşümü",

  // Paketleme & Sevkiyat
  SACK: "Çuval",
  SACK_SHIPMENT_ASSIGN: "Çuval → Sevkiyat",
  // Çuval izi (etiket) KATALOĞU. ⚠️ Ayrı satır bilinçli: iz ATAMALARI `SACK`
  // altına yazılır (çuvalın kendi geçmişi orada okunuyor — `SACK_NOTES` emsali),
  // katalog düzenlemesi ise bir çuval olayı DEĞİLDİR.
  sack_tags: "Çuval İzi Kataloğu",
  // Paketleme grubu (çalışma yaftası). ⚠️ Ayrı satır: grubun KENDİ düzenlemesi
  // (ad/not/kuruluş) bir çuval olayı değildir; çuvalın gruba girip çıkması ise
  // `SACK` altına yazılır — iz atamalarıyla aynı emsal.
  packing_groups: "Paketleme Grubu",
  SHIPMENT: "Sevkiyat",
  // Sevk defteri — mali etkisi olan tek defter (sipariş karşılanması ondan
  // türer). 2026-08-29'a dek değişim geçmişi HİÇ yoktu (BULGU-T2-003).
  SACK_ALLOCATION: "Sevk Tahsisi",
  SHIPMENT_LINE: "Sevkiyat Satırı",
  SHIPMENT_PLANNED_ORDER: "Sevkiyat Planlı Sipariş",
  packaging_queue: "Paketleme Kuyruğu",

  // Etiket & Baskı
  LABEL_TEMPLATE: "Etiket Şablonu",
  CUSTOMER_STANDALONE_LABEL: "Müşteriye Özel Serbest Etiket",
  CUSTOMER_TEMPLATE_ROUTE: "Müşteri–Şablon Yönlendirmesi",
  TRAVELER_CARD_TEMPLATE: "Refakat Kartı Şablonu",
  FREE_DOCUMENT: "Serbest Belge",
  LABEL_TEMPLATE_VARIANT: "Etiket Şablon Varyantı",
  LABEL_PRINT_EVENT: "Etiket Baskısı",
  LABEL_NATIVE_PRINT: "Yazıcı Baskısı",
  PRINTED_DOCUMENT: "Basılı Belge",
  DOCUMENT_PROFILE: "Belge Profili",

  // Kullanıcı & Yetki
  USER_PASSWORD: "Kullanıcı Şifresi",
  USER_PREFERENCE: "Kullanıcı Tercihi",
  USER_PERMISSION: "Kullanıcı Yetkisi",
  USER_PERMISSION_SET: "Yetki Ataması",
  USER_QUICK_PIN: "Hızlı PIN",
  USER_CARD_TOKEN: "Kart Anahtarı",
  PERMISSION: "Yetki",
  PERMISSION_TEMPLATE: "Yetki Şablonu",
  SYSTEM_SETTING: "Sistem Ayarı",
  WORK_SESSION: "Çalışma Oturumu",
  MACHINE_RUN: "Tezgah Koşumu",
  DOFF_EVENT: "Top İndirme",
  MACHINE_STOP_EVENT: "Tezgah Duruşu",
  KURSUN_BYPASS_ASSIGNMENT: "Kurşun Dağıtım Ataması",
  PERIPHERAL_TEMPLATE_ROUTE: "Cihaz–Şablon Yönlendirmesi",
  // Boot uzlaştırması + panel işleri: tablo adı küçük harfle yazılmış
  // (backend'de bilinçli, kayıt "kod tarafı" olduğunu belli etsin diye).
  permissions: "Yetki Kataloğu",
  permission_templates: "Yetki Şablonu",
  reason_presets: "Hazır Sebep",
  duplicate_reviews: "Mükerrer İncelemesi",
  system_settings: "Sistem Ayarı",

  // Cihaz (mobil eşleştirme)
  users: "Kullanıcı",
  devices: "Cihaz",
  pairing_codes: "Eşleştirme Kodu",
  latency_stats: "Gecikme İstatistiği",
  sessions: "Oturum",
  totp_enrollments: "İki Adımlı Doğrulama Kurulumu",
  user_recovery_codes: "Kurtarma Kodu",

  // ---------------------------------------------------------------------------
  // TİCARET (ön muhasebe + satın alma + depo) — 2026-08-15
  // ---------------------------------------------------------------------------
  // ⚠️ `WAREHOUSE` BURADA "Depo" (tablo), `ENUM_LABELS`te "Depoda" (RollStatus).
  // İki AYRI harita, iki AYRI soru — "zaten var" sanıp atlama.
  INVOICE: "Fatura",
  PAYMENT: "Tahsilat / Ödeme",
  PAYMENT_ALLOCATION: "Fatura Kapama (Mahsup)",
  CHEQUE: "Çek / Senet",
  CHEQUE_DELIVERY_NOTE: "Çek Teslim Bordrosu",
  CARI_ACCOUNT: "Cari Hesap",
  CARI_PERIOD_CLOSE: "Cari Dönem Kapanışı",
  CASH_TRANSACTION: "Kasa Hareketi",
  CASH_PERIOD_CLOSE: "Kasa Dönem Kapanışı",
  CASH_BOX: "Kasa",
  BANK_ACCOUNT: "Banka Hesabı",
  EXCHANGE_RATE: "Döviz Kuru",
  RECONCILIATION_LETTER: "Mutabakat Mektubu",
  GOODS_RECEIPT: "Mal Kabul Fişi",
  PURCHASE_ORDER: "Alış Siparişi",
  ITEM_PRICE: "Ürün Fiyatı",
  STOCK_COUNT: "Stok Sayımı",
  STOCK_COUNT_LINE: "Stok Sayım Satırı",
  WAREHOUSE: "Depo",
  WAREHOUSE_TRANSFER: "Depo Transferi",
  YARN_MOVEMENT: "İplik Hareketi",
  WARP_SPEC: "Çözgü Kartı",
  WEAVING_ORDER: "Dokuma İşi",
  WARP_BEAM: "Levent",
  WARP_BEAM_EVENT: "Levent Olayı",

  // Fabrika tarafında da etiketsiz kalmış olanlar (aynı tarama).
  ROLL_QTY_ADJUST: "Top Metraj Düzeltmesi",
};

/** Ham tableName'i Türkçe etiketle. Boş → "—", bilinmeyen → ham değer. */
export function tableLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return TABLE_LABELS[raw] ?? raw;
}

/**
 * SİSTEM OLAYLARI (`category` = AUTH/SYSTEM) — TEK KAYNAK.
 *
 * ⚠️ Eskiden İKİ harita vardı: `System/Events/labels.ts` 11 olayı, Denetim
 * Raporları'ndaki harita 8'ini biliyordu — backend ise 30 olay basıyor. Fark
 * ekranda ham İngilizce olarak görünüyordu (`BACKUP_COMPLETED`,
 * `PERMISSION_CATALOG_RECONCILED`, `DB_COPY_*`…). Artık iki ekran da buradan
 * beslenir; `test_audit_labels.ts` backend'in `logEvent` çağrılarındaki her
 * action için karşılık arar ve eksikte KIRMIZI verir.
 *
 * CREATE/UPDATE/DELETE burada YOK: onların çekimi ekrana özeldir (Aktivite
 * Günlüğü geçmiş zaman "oluşturdu", raporlar emir kipi "Oluştur").
 */
export const EVENT_ACTION_LABELS: Record<string, string> = {
  // ── AUTH ──
  LOGIN_SUCCESS: "Başarılı giriş",
  LOGIN_FAILED: "Başarısız giriş",
  // Dilim 1 (modül/bayrak) olayları — Sistem → Olaylar ekranında ham kodla
  // görünmesinler diye Türkçeleri burada. `test_audit_labels` bunları ölçer.
  LOGIN_LOCKED: "Giriş kilitlendi",
  MODULE_PROFILE_APPLIED: "Kurulum profili uygulandı",
  SUPERADMIN_PROVISIONED: "Satıcı hesabı kuruldu",
  SUPERADMIN_ROTATED: "Satıcı hesabının parolası/PIN'i yenilendi",
  SUPERADMIN_ACCOUNT_CREATED: "Satıcı hesabı oluşturuldu",
  SUPERADMIN_ABSENT_MODULE_WRITE: "Satıcı hesabı yokken modül anahtarı yazıldı",
  SYSTEM_ACCOUNT_ACCESS_BLOCKED: "Sistem hesabına erişim engellendi",
  SYSTEM_ACCOUNT_WRITE_BLOCKED: "En yetkili hesabı değiştirme denemesi engellendi",
  LOGIN_CONFLICT: "Giriş engellendi (oturum açık)",
  LOGOUT: "Çıkış yapıldı",

  // ── SYSTEM · ayar şifresi (süperadmin yönetir) ──
  // ⚠️ Bu altı olayı `test_audit_labels` §3 İSTEMEDİ ve istemesi de beklenmez:
  // çağrılar sabit üzerinden yazılıyor (`action: SETTINGS_PASSWORD_EVENTS.FAILED`)
  // ve §3 yalnız dizge literalini tarar ⇒ etiketleri ELLE eklendi. Metinler
  // servisin kendi Türkçesinden alındı. Etiket yalnız olay ADIDIR: şifre/hash
  // ne burada ne audit yükünde durur (sır hijyeni).
  SETTINGS_PASSWORD_SET: "Ayar şifresi ilk kez tanımlandı",
  SETTINGS_PASSWORD_ROTATED: "Ayar şifresi değiştirildi",
  SETTINGS_PASSWORD_REVOKED: "Ayar şifresi kaldırıldı",
  SETTINGS_PASSWORD_USED: "Ayar şifresi kullanıldı",
  SETTINGS_PASSWORD_FAILED: "Ayar şifresi hatalı girildi",
  SETTINGS_PASSWORD_LOCKED: "Ayar şifresi denemeleri kilitlendi",

  // ── SYSTEM · çalışma ──
  STARTUP: "Sunucu başlatıldı",
  ERROR: "Beklenmeyen hata",
  UNHANDLED_REJECTION: "Yakalanmayan hata (async)",
  UNCAUGHT_EXCEPTION: "Yakalanmayan istisna",
  AUDIT_ARCHIVE: "Log arşivlendi",
  // BULGU-T1-013: bir kullanıcının hızlı PIN'i / kart kodu OKUNDU. Okuyan kişi
  // hedefin kimliğine bürünebileceği için bu satır bir "yetki kullanımı" değil
  // bir GÜVENLİK OLAYIDIR; metin de öyle okunmalı.
  USER_CREDENTIAL_READ: "Kullanıcı giriş bilgileri görüntülendi (PIN/kart)",
  PERIPHERAL_TEST: "Cihaz testi",

  // ── SYSTEM · yedekleme ──
  BACKUP_TRIGGER: "Yedekleme başlatıldı",
  BACKUP_COMPLETED: "Yedekleme tamamlandı",
  BACKUP_FAILED: "Yedekleme başarısız",
  BACKUP_DOWNLOAD: "Yedek indirildi",
  BACKUP_RESTORE_PREVIEW: "Geri yükleme önizlemesi",
  OFFSITE_REMOTE_AUTHORIZED: "Dış kopya yetkilendirildi",

  // ── SYSTEM · kopyaya geri yükleme ──
  DB_COPY_STARTED: "Kopya oluşturma başladı",
  DB_COPY_VERIFIED: "Kopya doğrulandı",
  DB_COPY_COMPLETED: "Kopya tamamlandı",
  DB_COPY_FAILED: "Kopya oluşturulamadı",
  DB_COPY_DROPPED: "Kopya silindi",
  DB_SWAP_COMMAND_ISSUED: "Veritabanı takas komutu verildi",

  // ── SYSTEM · içe aktarım & katalog uzlaştırması ──
  IMPORT_RUN: "İçe aktarım çalıştırıldı",
  // Koşumun YAZDIĞI satırların ters kaydı. Koşum silinmez: üstüne damga yazılır,
  // o yüzden olay adı "geri alındı" değil "geri sarıldı".
  IMPORT_REVERT: "İçe aktarım geri sarıldı",
  CONFIG_BUNDLE_IMPORT: "Ayar paketi içe aktarıldı",
  PERMISSION_CATALOG_RECONCILED: "Yetki kataloğu eşitlendi",
  PERMISSION_CATALOG_RECONCILE_FAILED: "Yetki kataloğu eşitlenemedi",
  ROLE_TEMPLATE_CATALOG_RECONCILED: "Rol kataloğu eşitlendi",

  // ── SYSTEM · onarım / backfill izleri ──
  // Bunlar `scripts/*.ts --apply` koşumlarının bıraktığı izdir: operatör "bu veriyi
  // kim değiştirdi" diye sorduğunda cevabı bu satırlar verir. ⚠️ Türkçeleri birlik
  // (`system-events.ts`) kurulurken eklendi — o güne dek ekran ham kod basıyordu.
  DENETIM_ONARIM: "Denetim bulgusu onarıldı (betik)",
  MASTER_DATA_NAME_NORMALIZE: "Ana veri adları normalize edildi (betik)",
  ROLL_FOLD_AND_REASON_BACKFILL: "Top kat/sebep alanları geriye dönük dolduruldu (betik)",
  ROLL_LABEL_CUSTOMER_BACKFILL: "Top etiket müşterisi geriye dönük dolduruldu (betik)",
  ROLL_PRODUCTION_TIMESTAMPS_BACKFILL: "Top üretim damgaları geriye dönük dolduruldu (betik)",
  ROLL_WAREHOUSE_BACKFILL: "Top depo bağı geriye dönük dolduruldu (betik)",
  TAMBUR_UNDO_CANCEL_MARKER_BACKFILL: "Tambur geri alma iptal işareti dolduruldu (betik)",

  // ── SYSTEM · servis keşfi (kurulum kimliği) ──
  INSTALLATION_ID_CREATED: "Kurulum kimliği oluşturuldu",
  // ⚠️ Bu satırı görmek NORMAL DEĞİLDİR: kimlik yalnız kayıt bozulduğunda
  // yenilenir ve yenilenince sahadaki her cihaz "farklı sunucu" uyarısı alır.
  INSTALLATION_ID_REGENERATED: "Kurulum kimliği YENİLENDİ",
};

/** Sistem olayının Türkçe adı; bilinmeyen → ham değer (fail-open). */
export function eventActionLabel(action: string): string {
  return EVENT_ACTION_LABELS[action] ?? action;
}

// Alan adı sözlüğü BURADA DEĞİL — `audit-field-labels.ts` (backend aynası).
// `fieldLabel` eski çağrı noktalarını bozmamak için korunan takma addır.
export { AUDIT_FIELD_LABELS, auditFieldLabel } from "./audit-field-labels";
// Takma ad (merge, 2026-09-01): ticaret bekçisi (`audit-labels.trade.test.ts`)
// sözlüğü bu adla import ediyor. İKİNCİ BİR SÖZLÜK DEĞİL — aynı nesne.
export { AUDIT_FIELD_LABELS as FIELD_LABELS } from "./audit-field-labels";
export { auditFieldLabel as fieldLabel } from "./audit-field-labels";

/** Enum DEĞERLERİ (durum/tür kolonlarının içeriği) → Türkçe. Bilinmeyen → ham. */
export const ENUM_LABELS: Record<string, string> = {
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
  // OrderStatus / WorkOrderStatus / StepStatus (ortak durumlar dahil)
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  PARTIAL_SHIPPED: "Kısmi Sevk",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  PLANNED: "Planlandı",
  IN_PROGRESS: "Devam Ediyor",
  ACTIVE: "Aktif",
  SKIPPED: "Atlandı",
  // WorkOrderType
  ORDER_PRODUCTION: "Siparişe Özel",
  STOCK_PRODUCTION: "Stoğa Üretim",
  // TravelerCardStatus / PrintedDocStatus
  REPRINTED: "Yeniden Basıldı",
  VOIDED: "İptal",
  SUPERSEDED: "Eski Versiyon",
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
  // SackWeightSource
  MANUAL: "Elle girildi",
  SIMULATED: "Simüle edildi",
  // PrintedDocType (eksik kalanlar)
  TRAVELER_CARD: "Refakat Kartı",
  RETURN_DISPATCH: "İade İrsaliyesi",
  // `source` alanının serbest değerleri
  RECEIPT: "Mal kabul",

  // ── Elle yazılan audit işaretleri (`event`/`source`/`via` alanlarının değeri).
  // Prisma enum'u DEĞİLLER; çağrı noktalarında string olarak yazılırlar.
  LABEL_PRINTED: "Etiket basıldı",
  PRINT_EVENT: "Baskı olayı",
  PRINT_REVISION: "Baskı revizyonu",
  REISSUE: "Yeniden düzenlendi",
  RELABEL: "Yeniden etiketlendi",
  LABEL_OVERRIDE_EDIT: "Etiket üzerinde elle düzenleme",
  QUALITY_CERTIFICATE: "Kalite belgesi",
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
  WO_CLOSE_DISPOSITION: "İş emri kapanış kararı",
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
  SUBCONTRACT: "Fasona sardırıldı",
  PURCHASED: "Hazır alındı",
  THEORETICAL: "Nominal (hesap)",
  WARP_ISSUE: "Çözgü çıkışı (levente sarım)",
  WARP_ISSUE_REVERSAL: "Çözgü çıkışı iptali",
  WARP_RETURN: "Levent dibi iadesi",
  WARP_RETURN_REVERSAL: "Levent dibi iadesi iptali",
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
};

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
const FIELD_ENUM_OVERRIDES: Record<string, Record<string, string>> = {
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
  // StationKind.WEAVING (dokuma ⓪, 2026-09-14) — istasyon TÜRÜ; global `WEAVING`
  // RollEntrySource dilinde ("Dokumadan İndi", topun kaynağı). Ortak Türkçe YETMEZ.
  "STATION.kind": { WEAVING: "Dokuma Tezgahı" },
};

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
  WEAVING:
    "RollEntrySource(top tezgahtan indi) ve StationKind(istasyon bir tezgah) — ortak Türkçe YETMEZ: " +
    "ilki topun KAYNAĞI, ikincisi istasyonun TÜRÜ. STATION.kind override'ı ile ayrıldı (2026-09-14)",
  SUBCONTRACTOR: "istasyon/mükerrer-varlık/cari — üçü de aynı gerçek kişiyi işaret eder: 'Fason'",
  OTHER: "istasyon türü ve ödeme yöntemi — ikisi de 'Diğer'",
  YARN: "kalem türü ve sayım satırı türü — ikisi de 'İplik'",
  SCRAP: "sapma türü / top statüsü / kalite rolü — üçünde de 'Fire'",
  SCALE: "tartı kaynağı ve çevre birimi türü — ikisi de 'Kantar'",
  MANUAL: "tartı kaynağı ve kur kaynağı — ikisi de 'Elle girildi'",
  CANCELLED: "on beş durum enum'u — hepsinde 'İptal' (en geniş ortaklık)",
  IN_PROGRESS:
    "WorkOrderStatus ve WeavingOrderStatus — ikisi de 'Devam Ediyor'. Dokuma işi " +
    "IN_PROGRESS iken tezgah koşuyordur; iş emrininkiyle aynı cümle doğru (2026-09-13)",
  CUSTOMER: "firma türü / mükerrer-varlık / cari — üçü de 'Müşteri'",
  PENDING: "sipariş/adım/cihaz — üçü de 'Bekliyor'",
  APPROVED: "sipariş ve cihaz — ikisi de 'Onaylandı'",
  COMPLETED: "yedi durum enum'u — hepsinde 'Tamamlandı'",
  // ⚠️ 2026-09-13: metin "dördü" diyordu, gerçek BEŞ — `MachineStopLossClass.PLANNED`
  // (planlı duruş) P2b-1'de eklendi ve bekçi SAYIYI değil VARLIĞI ölçtüğü için
  // metin sessizce bayatladı. "Planlandı" planlı duruş için de doğru cevaptır
  // (o duruş PLANLANMIŞTIR) ⇒ ortak Türkçe tutuyor, yalnız sayı düzeltildi.
  PLANNED:
    "iş emri / dokuma işi / sevkiyat / sevkiyat olayı / planlı duruş (MachineStopLossClass) — beşi de 'Planlandı'",
  SUPERSEDED: "iş emri ve basılı belge — ikisi de 'Eski Versiyon'",
  ACTIVE: "yedi durum enum'u — hepsinde 'Aktif'",
  VOIDED: "refakat kartı ve basılı belge — ikisi de 'İptal'",
  DISPATCHED: "sevkiyat ve sevkiyat olayı — ikisi de 'Sevk Edildi'",
  PARTIAL: "içe aktarım ve alış siparişi — ikisi de 'Kısmi'",
  DRAFT: "fatura ve sayım — ikisi de 'Taslak'",
  IN: "ödeme yönü ve iplik hareketi — ikisi de 'Giriş'",
  OUT: "ödeme yönü ve iplik hareketi — ikisi de 'Çıkış'",
  ISSUED: "ChequeKind ve ChequeStatus — global 'Verdiğimiz (kendi çekimiz)' ikisinde de doğru; durum alanı ayrıca CHEQUE.status override'ı taşır",

  // ── Ortak Türkçe YETMEYEN — FIELD_ENUM_OVERRIDES ile ayrılmış ──────────────
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Bir audit alan değerini kullanıcıya okunur Türkçe metne çevirir:
 * null→"—", boolean→Evet/Hayır, ISO tarih→gg.AA.yyyy SS:dd, enum→Türkçe, aksi ham.
 * Nesne/dizi burada ele alınmaz (çağıran taraf ham JSON'a düşer).
 */
export function formatAuditValue(value: unknown, ctx?: EnumLabelContext): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) {
      const d = parseISO(value);
      if (isValid(d)) return format(d, "dd.MM.yyyy HH:mm", { locale: tr });
    }
    // ⚠️ Bağlam VARSA alan-kapsamlı katmandan geçer (çelişen enum değerleri);
    // yoksa bugünkü davranış birebir korunur.
    return enumValueLabel(value, ctx);
  }
  return String(value);
}

/**
 * "Ne değişti" satırının değer biçimlendiricisi (eski→yeni).
 *
 * ⚠️ `formatAuditValue`'dan farkı UZUNLUK KIRPMASI ve nesne davranışıdır: diff
 * satırı tek satırda iki değer taşır, ham JSON oraya sığmaz — ham blok zaten
 * hemen altta duruyor. Enum çevirisi İKİSİNDE DE aynı sözlükten gelir; eskiden
 * bu fonksiyon `String(v)` diyordu ve aynı çekmecede ham blok **Depoda** derken
 * diff satırı **WAREHOUSE** diyordu.
 */
export function auditValueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return "(içerik)";
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  const s = formatAuditValue(v);
  // Uzun metin satırı taşırmasın; tam değer title'da gösterilir.
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
