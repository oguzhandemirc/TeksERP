// =============================================================================
// AUDIT MODÜL + SİSTEM OLAYI ETİKETLERİ — TEK KAYNAK (izlenebilirlik B2, 2026-10-25)
// -----------------------------------------------------------------------------
// Backend anlatıcısı (`services/audit-narrative/`) cümleyi okuma anında kurar; bu
// yüzden modül adı sözlüğü artık backend'dedir. `Electron/src/lib/audit-tablo-etiketleri.ts`
// bu dosyanın BAYT-EŞİT aynasıdır (Electron backend'i import edemez; `terim.ts` deseni).
// ⚠️ İKİSİNİ BİRLİKTE değiştir — `scripts/test_audit_labels.ts` sha256 ile ölçer.
// Bilinmeyen anahtar → ham değer (fail-open; ekran asla boş kalmaz).
// =============================================================================

/** Backend `tableName` → Türkçe modül adı. */
export const TABLE_LABELS: Record<string, string> = {
  NumberSeries: "Numara serisi",
  // Vadesi gelmemiş biçim değişikliği satırı (iptal edildiğinde denetime düşer).
  NumberSeriesLine: "Numara serisi biçim satırı",
  number_series: "Numara serisi",
  number_series_lines: "Numara serisi biçim satırı",
  // Sistem event kategorileri (tableName = kategori string'i)
  AUTH: "Kimlik Doğrulama",
  SYSTEM: "Sistem",

  // Master data
  USER: "Kullanıcı",
  REPORT_CATEGORY: "Rapor Kategorisi",
  REPORT_DEFINITION: "Özel Rapor",
  REPORT_DEFINITION_VERSION: "Özel Rapor Sürümü",
  REPORT_PRESET: "Rapor Ön Ayarı",
  REPORT_SHARE: "Rapor Paylaşımı",
  ITEM: "Kumaş / Stok Kalemi",
  CUSTOMER: "Müşteri",
  CUSTOMER_BRANCH: "Müşteri Şubesi",
  CUSTOMER_ITEM_ALIAS: "Müşteri Kumaş Kodu",
  CUSTOMER_COLOR_ALIAS: "Müşteri Renk Kodu",
  CUSTOMER_ITEM_COLOR_ALIAS: "Müşteri Kumaşa Özel Renk Adı",
  STATION: "İstasyon",
  STATION_CAPABILITY: "İstasyon Yeteneği",
  MACHINE: "Makine",
  ROUTE: "Rota",
  COLOR: "Renk",
  FABRIC_PROPERTY: "Kumaş Özelliği",
  QUALITY_GRADE: "Kalite Sınıfı",
  DEFECT_TYPE: "Hata Tipi",
  RETURN_REASON: "İade Sebebi",
  PRODUCT_RECIPE: "Terbiye İş Emri Şablonu",
  PERIPHERAL_DEVICE: "Saha Cihazı",

  // Sipariş & İş Emri
  ORDER: "Sipariş",
  BATCH: "Parti",
  ORDER_LINE: "Sipariş Satırı",
  WORK_ORDER: "Terbiye İş Emri",
  WORK_ORDER_STEP: "Terbiye İş Emri Adımı",
  MANIFEST: "Çeki Listesi",

  // Top & Üretim
  ROLL: "Top",
  ROLL_MOVEMENT: "Top Hareketi",
  ROLL_OPERATION: "Top İşlemi",
  ROLL_ERROR: "Top Hatası",
  ROLL_INSPECTION: "Top Muayenesi (4 Puan)",
  FOUR_POINT_RULE_SET: "4 Puan Kural Seti",
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
  E_IRSALIYE: "e-İrsaliye",
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
  DOCUMENT_TEMPLATE: "Belge Şablonu",
  DOCUMENT_TEMPLATE_VERSION: "Belge Şablonu Sürümü",
  DOCUMENT_TEMPLATE_DEFAULT: "Varsayılan Belge Şablonu",
  DOCUMENT_PROFILE_TEMPLATE: "Profil Belge Şablonu Ataması",

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
  FACTORY_TIMEZONE_PERIOD: "Saat Dilimi Dönemi",
  WORK_SESSION: "Çalışma Oturumu",
  MACHINE_RUN: "Tezgah Koşumu",
  MACHINE_SPEC: "Tezgah Künyesi",
  SHIFT_DEFINITION: "Vardiya Tanımı",
  DOFF_EVENT: "Top İndirme",
  MACHINE_STOP_EVENT: "Tezgah Duruşu",
  MACHINE_STOP_CODE_MAP: "Duruş Kodu Eşlemesi",
  MACHINE_COLLECTOR: "Makine Kartı",
  LOOM_ALARM_EVENT: "Tezgah Alarmı",
  LOOM_ALARM_RESPONSIBLE: "Alarm Sorumlusu",
  LOOM_ALARM_DUTY_OVERRIDE: "Alarm Nöbet Değişikliği",
  LOOM_ALARM_TIER_RULE: "Alarm Kademe Kuralı",
  MACHINE_SHIFT_STAT: "Vardiya Karnesi",
  MACHINE_SHIFT_SEAL: "Vardiya Karnesi Mührü",
  KURSUN_BYPASS_ASSIGNMENT: "Kurşun Dağıtım Ataması",
  WORK_ORDER_TARGET_VALUE: "Terbiye İş Emri Hedef Gramajı",
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
  device_rebind_requests: "Cihaz Yeniden Bağlama Talebi",
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
  CARI_HOLD: "Cari Kilidi",
  CASH_TRANSACTION: "Kasa Hareketi",
  CASH_PERIOD_CLOSE: "Kasa Dönem Kapanışı",
  CASH_BOX: "Kasa",
  BANK_ACCOUNT: "Banka Hesabı",
  EXCHANGE_RATE: "Döviz Kuru",
  RECONCILIATION_LETTER: "Mutabakat Mektubu",
  GOODS_RECEIPT: "Mal Kabul Fişi",
  PURCHASE_ORDER: "Alış Siparişi",
  ITEM_PRICE: "Ürün Fiyatı",
  LAB_TEST: "Lab Testi",
  LAB_TEST_TYPE: "Lab Test Türü",
  CERTIFICATE: "Sertifika",
  CERTIFICATE_FILE: "Sertifika Belgesi",
  CUSTOMER_DELIVERY_NOTE: "Gelen Belge Taslağı",
  CUSTOMER_DELIVERY_NOTE_LINE: "Gelen Belge Satırı",
  DOCUMENT_SCAN: "Belge Taraması",
  ROLL_METER_READING: "Metre Okuması",
  ROLL_METER_ACK: "Kurşun Metre Sapma Onayı",
  ROLL_METER_STOCK_APPLY: "Kurşun Metre Stok Uygulaması",
  ROLL_CUSTOMER_CODE: "Müşteri Barkodu",
  CUSTOMER_BARCODE_SERIES: "Müşteri Barkod Serisi",
  DELIVERY_NOTE_ALIAS: "Gelen Belge Eşlemesi",
  SENDER_TEMPLATE: "Gönderen Şablonu",
  DELIVERY_NOTE_CUSTOMER_DEFAULT: "Gelen Belge Müşteri Varsayılan Ürünü",
  CUSTOMER_LAB_SPEC: "Müşteri Lab Spesifikasyonu",
  COST_PARAMETER_SET: "Maliyet Parametre Seti",
  COST_STRUCTURE: "Ürün Maliyet Yapısı",
  STANDARD_COST_VERSION: "Standart Maliyet Sürümü",
  SALES_QUOTE: "Satış Teklifi",
  PRICE_LIST: "Fiyat Listesi",
  FINISHING_RATE: "Apre Tarifesi",
  WEFT_SPEC: "Atkı Spesifikasyonu",
  WEAVE_DESIGN: "Desen Kartı",
  YARN_COST_PRICE: "İplik Maliyet Fiyatı",
  MACHINE_COST_RATE: "Makine Saat Ücreti",
  EXPENSE_ALLOCATION: "Masraf Bağı",
  SERVICE_CONSUMABLE_NORM: "Hizmet Sarf Normu",
  STOCK_COUNT: "Stok Sayımı",
  STOCK_COUNT_LINE: "Stok Sayım Satırı",
  WAREHOUSE: "Depo",
  WAREHOUSE_TRANSFER: "Depo Transferi",
  YARN_MOVEMENT: "İplik Hareketi",
  YARN_LOT: "İplik Lotu",
  WARP_SPEC: "Çözgü Kartı",
  WEAVING_ORDER: "Dokuma İş Emri",
  WARP_BEAM: "Levent",
  WARP_BEAM_EVENT: "Levent Olayı",

  // Fabrika tarafında da etiketsiz kalmış olanlar (aynı tarama).
  ROLL_QTY_ADJUST: "Top Metraj Düzeltmesi",
  // Patron bulutu gelen kutusu makbuzu (B3) · destek talebi (3d-2) · lisans sözleşmesi kabulü (Ek-7).
  CLOUD_INBOX_RECEIPT: "Bulut Gelen Kutusu Makbuzu",
  SUPPORT_TICKET: "Destek Talebi",
  CREDENTIAL_RESET_REQUEST: "Kimlik Sıfırlama Onay Talebi",
  LICENSE_ACCEPTANCE: "Lisans Sözleşmesi Kabulü",
  // Dağıtım v2 (D7): sunucu güncellemesi onayı (Sistem → Güncellemeler).
  UPDATE_APPROVAL: "Sunucu Güncellemesi Onayı",
  // Bildirim tercih katmanı (N4-MOTOR): yönetici profilleri ve fabrika varsayılanı.
  NOTIFICATION_PROFILE: "Bildirim Profili",
  NOTIFICATION_FACTORY_DEFAULT: "Bildirim Fabrika Varsayılanı",
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
  SUPERADMIN_DEFAULT_PROVISIONED: "Varsayılan satıcı hesabı doğdu (ortak parola, değişim zorunlu)",
  SUPERADMIN_DEFAULT_TAKEN_OVER: "Varsayılan satıcı hesabı kurulum aracıyla devralındı",
  SUPERADMIN_ACCOUNT_CREATED: "Satıcı hesabı oluşturuldu",
  SUPERADMIN_ABSENT_MODULE_WRITE: "Satıcı hesabı yokken modül anahtarı yazıldı",
  SYSTEM_ACCOUNT_ACCESS_BLOCKED: "Sistem hesabına erişim engellendi",
  SYSTEM_ACCOUNT_WRITE_BLOCKED: "En yetkili hesabı değiştirme denemesi engellendi",
  SYSTEM_ACCOUNT_SEAL_INVALID: "En yetkili hesabın mührü geçersiz — yetki verilmedi",
  SYSTEM_ACCOUNT_SEALED: "En yetkili hesap sunucuda mühürlendi",
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
  AUDIT_ARCHIVE_PURGE: "Saklama süresi dolan log arşivi budandı",
  AUDIT_CHAIN_START: "Denetim kaydı zinciri başlatıldı",
  AUDIT_CHAIN_CUT: "Denetim zinciri kesit çapası (arşiv budaması)",
  AUDIT_CHAIN_BROKEN: "Denetim kaydında kurcalama tespit edildi",
  TOTP_ENROLLMENT_PURGE: "Kullanılmadan süresi dolan 2FA kurulum bağlantıları budandı",
  // BULGU-T1-013: bir kullanıcının hızlı PIN'i / kart kodu OKUNDU. Okuyan kişi
  // hedefin kimliğine bürünebileceği için bu satır bir "yetki kullanımı" değil
  // bir GÜVENLİK OLAYIDIR; metin de öyle okunmalı.
  USER_CREDENTIAL_READ: "Kullanıcı giriş bilgileri görüntülendi (PIN/kart)",
  SHORT_CREDENTIAL_CONVERTED: "Hızlı PIN / kartlar özetli saklamaya çevrildi",
  SHORT_CREDENTIAL_ESCROW_SEALED: "Kısa kimlik anahtarı yedek anahtarlarına mühürlendi",
  SHORT_CREDENTIAL_KEY_RESTORED: "Kısa kimlik anahtarı yedekten geri kondu",
  SHORT_CREDENTIAL_RING_LOST: "Kısa kimlik anahtar halkası kayıp — yeniden üretildi",
  SHORT_CREDENTIAL_BULK_RESET: "Toplu hızlı PIN sıfırlama",
  TOTP_SECRET_WRAPPED: "İki adımlı doğrulama sırları şifreli saklamaya çevrildi",
  MACHINE_RUN_BULK: "Tezgah Salonu toplu koşum işlemi",
  MACHINE_STOP_BULK: "Tezgah Salonu toplu duruş işlemi",
  PERIPHERAL_TEST: "Cihaz testi",

  // ── SYSTEM · yedekleme ──
  BACKUP_TRIGGER: "Yedekleme başlatıldı",
  BACKUP_COMPLETED: "Yedekleme tamamlandı",
  BACKUP_FAILED: "Yedekleme başarısız",
  BACKUP_DOWNLOAD: "Yedek indirildi",
  BACKUP_RESTORE_PREVIEW: "Geri yükleme önizlemesi",
  BACKUP_PASSWORD_FAILED: "Hatalı yedek parolası",
  OFFSITE_REMOTE_AUTHORIZED: "Dış kopya yetkilendirildi",
  BACKUP_ROTATED: "Süresi dolan geri dönüş yedekleri silindi",

  // ── SYSTEM · kopyaya geri yükleme ──
  DB_COPY_STARTED: "Kopya oluşturma başladı",
  DB_COPY_VERIFIED: "Kopya doğrulandı",
  DB_COPY_COMPLETED: "Kopya tamamlandı",
  DB_COPY_FAILED: "Kopya oluşturulamadı",
  DB_COPY_DROPPED: "Kopya silindi",
  READ_ONLY_DB_PASSWORD_ROTATED: "Okuma DB parolası yenilendi ve gösterildi",
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
  NUMBER_SERIES_SEEDED: "Numara serileri eşitlendi",
  NUMBER_SOURCE_MIGRATED: "Numara kaynağı ayarı eski bayraktan taşındı (tek seferlik)",
  NUMBER_SERIES_LINES_MIGRATED: "Numara biçimi zaman çizgisine taşındı (tek seferlik)",
  NUMBER_SERIES_LINE_ACTIVATED: "İleri tarihli numara biçimi yürürlüğe girdi",

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
  SWATCH_STATUS_ANOMALY_FIX: "Kartela durum anomalisi düzeltildi (betik)",
  CASH_LEDGER_PAYMENT_BACKFILL: "Kasa defteri geçmiş satırları dolduruldu (betik)",
  ORDER_DESTINATION_BACKFILL: "Sipariş yönü geriye dönük dolduruldu (betik)",
  ROLL_STATUS_EVENTS_BACKFILL: "Top durum defterine eski iptaller dolduruldu (betik)",
  WORK_ORDER_EVENTS_BACKFILL: "Terbiye iş emri hareket defterine geçmiş dolduruldu (betik)",
  TERM_CATALOG_TEXT_MIGRATED: "Görünen ad değişikliği katalog satırlarına işlendi (betik)",

  // ── SYSTEM · servis keşfi (kurulum kimliği) ──
  INSTALLATION_ID_CREATED: "Kurulum kimliği oluşturuldu",
  // ⚠️ Bu satırı görmek NORMAL DEĞİLDİR: kimlik yalnız kayıt bozulduğunda
  // yenilenir ve yenilenince sahadaki her cihaz "farklı sunucu" uyarısı alır.
  INSTALLATION_ID_REGENERATED: "Kurulum kimliği YENİLENDİ",

  // ── SYSTEM · lisans motoru ──
  LICENSE_STATE_CHANGED: "Lisans durumu değişti",
  LICENSE_LEASE_ACCEPTED: "Lisans kirası yenilendi",
  LICENSE_SANCTION_CHANGED: "Lisans yaptırımı değişti",
  LICENSE_REVOCATION_ADOPTED: "Lisans iptal belgesi güncellendi",
  LICENSE_OBSERVATION_SUMMARY: "Lisans gözlem özeti",
  LICENSE_ADMIN_ACTION: "Lisans işlemi",

  // ── SYSTEM · patron bulutu ──
  PATRON_CLOUD_ACCOUNT_LOCKED: "Bulut hesabı kilitlendi",
};

/** Sistem olayının Türkçe adı; bilinmeyen → ham değer (fail-open). */
export function eventActionLabel(action: string): string {
  return EVENT_ACTION_LABELS[action] ?? action;
}
