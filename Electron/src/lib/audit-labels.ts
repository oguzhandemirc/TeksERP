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

  // Paketleme & Sevkiyat
  SACK: "Çuval",
  SACK_SHIPMENT_ASSIGN: "Çuval → Sevkiyat",
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
  LOGIN_CONFLICT: "Giriş engellendi (oturum açık)",
  LOGOUT: "Çıkış yapıldı",

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
  CONFIG_BUNDLE_IMPORT: "Ayar paketi içe aktarıldı",
  PERMISSION_CATALOG_RECONCILED: "Yetki kataloğu eşitlendi",
  PERMISSION_CATALOG_RECONCILE_FAILED: "Yetki kataloğu eşitlenemedi",
  ROLE_TEMPLATE_CATALOG_RECONCILED: "Rol kataloğu eşitlendi",

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
  TABLET: "Tablet",
  PHONE: "Telefon",
  DESKTOP: "Masaüstü",
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
};

export function enumValueLabel(value: string): string {
  return ENUM_LABELS[value] ?? value;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Bir audit alan değerini kullanıcıya okunur Türkçe metne çevirir:
 * null→"—", boolean→Evet/Hayır, ISO tarih→gg.AA.yyyy SS:dd, enum→Türkçe, aksi ham.
 * Nesne/dizi burada ele alınmaz (çağıran taraf ham JSON'a düşer).
 */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) {
      const d = parseISO(value);
      if (isValid(d)) return format(d, "dd.MM.yyyy HH:mm", { locale: tr });
    }
    return ENUM_LABELS[value] ?? value;
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
