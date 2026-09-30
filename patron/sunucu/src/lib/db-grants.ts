// ROL YETKİLERİ — tek kaynak (`scripts/db-rolleri.ts` uygular, bekçi `test_rls_sizinti` ölçer).
// İki çalışma rolü, ikisi de NOSUPERUSER NOBYPASSRLS ve tablo sahibi DEĞİL (RLS ikisine de uygulanır):
//   · uygulama (hesap API'si): projeksiyonu ve eşitleme tablolarını YALNIZ OKUR — API katmanındaki bir
//     hata fabrikanın verisini yazamaz ya da taklit edemez.
//   · eşitleme (fabrika kanalı + bakım): hesap tablolarına dokunamaz — kanal katmanındaki bir hata
//     hesap/oturum/parola satırına ulaşamaz.
// Migration yeni tablo eklerse buraya satırı AYNI dilimde girer (girmezse iki rol de erişemez: fail-closed).
export type Privilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
/** Kolon düzeyi yetki: tablo düzeyindekine EK, yalnız adı geçen kolonlarda (aynı yetki iki düzeyde birden verilmez). */
export type ColumnGrants = Readonly<Record<string, Readonly<Partial<Record<"UPDATE", readonly string[]>>>>>;

export const APP_GRANTS: Readonly<Record<string, readonly Privilege[]>> = {
  facilities: ["SELECT"],
  installations: ["SELECT"],
  accounts: ["SELECT", "INSERT", "UPDATE"],
  sessions: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  // UPDATE tablo düzeyinde YOK: yalnız `summary` kolonunda (APP_COLUMN_GRANTS) — bakımın IP alanı silmesi.
  account_audit: ["SELECT", "INSERT", "DELETE"],
  operation_receipts: ["SELECT", "INSERT", "DELETE"],
  inbox_messages: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  report_requests: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  report_results: ["SELECT"],
  push_devices: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  notification_defaults: ["SELECT", "INSERT", "UPDATE"],
  notification_preferences: ["SELECT", "INSERT", "UPDATE"],
  notifications: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  projection_rows: ["SELECT"],
  sync_state: ["SELECT"],
  support_access: ["SELECT"],
};

export const APP_COLUMN_GRANTS: ColumnGrants = {
  // Yaşa göre silinen alan (`maintenance.ts` `AGED_FIELDS`: giriş olayının IP'si); olay, aktör, zaman yazılamaz.
  account_audit: { UPDATE: ["summary"] },
  // Kimlik silmesi makbuz yanıtındaki ad/e-postayı tombstone'a çevirir (`maintenance.ts` `purgeClosedIdentities`);
  // makbuzun kimliği, eylemi ve gövde özeti yazılamaz (tekrar kapısı onlara dayanır).
  operation_receipts: { UPDATE: ["response"] },
};

export const SYNC_COLUMN_GRANTS: ColumnGrants = {};

export const SYNC_GRANTS: Readonly<Record<string, readonly Privilege[]>> = {
  facilities: ["SELECT", "INSERT", "UPDATE"],
  installations: ["SELECT", "INSERT", "UPDATE"],
  inbox_messages: ["SELECT", "UPDATE"],
  report_requests: ["SELECT", "UPDATE"],
  report_results: ["SELECT", "INSERT", "DELETE"],
  projection_rows: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  sync_watermarks: ["SELECT", "INSERT", "UPDATE"],
  package_receipts: ["SELECT", "INSERT", "DELETE"],
  sync_state: ["SELECT", "INSERT", "UPDATE"],
  full_sync_runs: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  request_nonces: ["SELECT", "INSERT", "DELETE"],
};

/**
 * Şemadaki bütün uygulama tabloları (bekçi: şema ↔ bu liste birebir). Çalışma rollerinin hiçbirinde
 * yetkisi olmayan tablo yalnız göç rolünün (satıcı CLI'si) tablosudur: `facility_destructions`.
 */
export const CLOUD_TABLES: readonly string[] = [
  "facilities",
  "installations",
  "accounts",
  "sessions",
  "account_audit",
  "operation_receipts",
  "inbox_messages",
  "report_requests",
  "report_results",
  "push_devices",
  "notification_defaults",
  "notification_preferences",
  "notifications",
  "projection_rows",
  "sync_watermarks",
  "package_receipts",
  "sync_state",
  "full_sync_runs",
  "request_nonces",
  "facility_destructions",
  "support_access",
];

/**
 * DESTEK ROLÜ (Ek-6/B §3.2) — `<veritabanı>_destek` (üretimde `patron_destek`): NOLOGIN doğar (göç), NOSUPERUSER
 * NOBYPASSRLS; yalnız SELECT, yalnız burada adı geçen tablolarda. Kolon listesi verilen tabloda yalnız o kolonlar
 * (sır kolonları — parola özeti, TOTP sırrı, davet/oturum belirteç özeti, push belirteci — HARİÇ); `"*"` bütün tablo.
 * Her tablo göçte RESTRICTIVE `destek_kapisi` politikası taşır (izin `destek_ac` kaydından; bekçi iki yönlü).
 * Destek rolü `support_access` (kendi erişim kaydı) ve `facility_destructions`ı OKUYAMAZ.
 */
export const SUPPORT_GRANTS: Readonly<Record<string, "*" | readonly string[]>> = {
  facilities: "*",
  installations: "*",
  accounts: ["id", "tesis_id", "email", "name", "permissions", "status", "invite_expires_at", "failed_logins", "locked_until", "last_login_at", "closed_at", "identity_purged_at", "created_by_id", "created_at", "updated_at"],
  sessions: ["id", "tesis_id", "account_id", "client", "last_used_at", "expires_at", "closed_at", "close_reason", "created_at", "updated_at"],
  account_audit: "*",
  operation_receipts: "*",
  inbox_messages: "*",
  report_requests: "*",
  report_results: "*",
  push_devices: ["id", "tesis_id", "account_id", "platform", "name", "active", "last_seen_at", "created_at", "updated_at"],
  notification_defaults: "*",
  notification_preferences: "*",
  notifications: "*",
  projection_rows: "*",
  sync_watermarks: "*",
  package_receipts: "*",
  sync_state: "*",
  full_sync_runs: "*",
  request_nonces: "*",
};

/**
 * Destek rolünün ÇALIŞTIRABİLDİĞİ fonksiyonlar — beyan (`şema.ad(arg tipleri)`, `oidvectortypes` biçimi). PUBLIC'ten
 * gelen EXECUTE dahil başka her fonksiyon bekçide kırmızıdır; her SECURITY DEFINER fonksiyonun `search_path`i sabit
 * ve `pg_temp` sonda olmalıdır (çağıranın yolu ad çeviremez). Destek rolü görünüm/başka ilişki OKUYAMAZ (yalnız
 * `SUPPORT_GRANTS` tabloları).
 */
export const SUPPORT_FUNCTIONS: readonly string[] = ["public.destek_ac(uuid, text, text, text, integer)", "public.destek_kapat()", "public.destek_tesisi()"];

/** Destek rolünün adı (göç SQL'i `current_database() || '_destek'` ile AYNI kural). */
export function supportRoleName(database: string): string {
  return `${database}_destek`;
}
