// =============================================================================
// TeksERP — REZERVE AYAR ANAHTARLARI (ham ayar ucundan yazılamaz/okunamaz)
// =============================================================================
// `system_settings` tablosu bir KEY-VALUE deposudur ve `PUT /api/admin/settings/:key`
// ucu ona düz string yazar. Bu, ayarların çoğu için doğrudur; ama tablo artık
// AYAR OLMAYAN bir satır da taşıyor: ayar şifresinin bcrypt hash'i
// (`security.settingsPasswordHash`, 2026-09-03 / P3).
//
// ⚠️ İKİ AYRI TEHLİKE, İKİ AYRI KURAL — ikisi de burada:
//   ① YAZMA: hash ham ayar ucundan yazılabilseydi, `admin:settings` taşıyan
//      herkes kendi bildiği bir şifrenin hash'ini basıp kapıyı kendine açardı.
//      Yani ayar şifresi, korumaya çalıştığı iznin sahibi tarafından ele
//      geçirilebilirdi. Emsal: `MODULE_SETTING_KEYS` (K7) — orada da tek yazma
//      yüzeyi bırakılmıştı.
//   ② OKUMA: `GET /api/admin/settings` TÜM satırları döndürür. Hash orada
//      görünseydi kapı fiilen ölürdü — çevrimdışı kırma için bcrypt gövdesi
//      yeterli, üstelik yükü okuyan herkes şifrenin TANIMLI olduğunu da öğrenir.
//      Bu yüzden süzgeç TEK ANAHTAR değil ÖN EK bazlıdır: `security.` ile
//      başlayan HER satır listelerden düşer, yani yarın eklenecek ikinci bir sır
//      satırı da doğduğu an korunmuş olur ("unutulmuş altıncı enum" sınıfı).
//
// ⚠️ NEDEN AYRI DOSYA: `system-setting.service.ts` bu kümeyi import eder;
// `SETTING_KEYS`ten türetilmiş bir küme burada tanımlansaydı dairesel bağımlılık
// kurulur ve CommonJS'te modül init sırasına göre `undefined` bir Set üretirdi —
// yani kapı SESSİZCE açılırdı. `constants/module-flags.ts` ile birebir aynı
// gerekçe; ikilik bekçiyle kilitlenir.
// =============================================================================

/**
 * SIR taşıyan ayar satırlarının ön eki. Bu ön ekle başlayan hiçbir satır
 * `GET /api/admin/settings` yükünde DÖNMEZ ve ham ayar ucundan YAZILAMAZ.
 */
export const SECURITY_SETTING_PREFIX = "security.";

/** Ayar şifresinin bcrypt hash'i (cost 10). Tek yazıcısı: settings-password servisi. */
export const SETTINGS_PASSWORD_HASH_KEY = "security.settingsPasswordHash";

/**
 * `PUT /api/admin/settings/:key` ucunun REDDETTİĞİ anahtarlar.
 *
 * Kümeye ek olarak ön ek kuralı da uygulanır (`isReservedSettingKey`) — küme
 * yalnız "adı bilinen" satırları listeler, ön ek ise gelecekteki sır satırlarını
 * varsayılan olarak kapatır (FAIL-CLOSED).
 */
export const RESERVED_SETTING_KEYS: ReadonlySet<string> = new Set([
  SETTINGS_PASSWORD_HASH_KEY,
]);

/** `security.` ile başlıyor mu — liste/dışa-aktarım süzgeçlerinin yüklemi. */
export function isSecuritySettingKey(key: string): boolean {
  return key.startsWith(SECURITY_SETTING_PREFIX);
}

/** Ham ayar ucundan yazılması YASAK mı (küme ∪ ön ek). */
export function isReservedSettingKey(key: string): boolean {
  return RESERVED_SETTING_KEYS.has(key) || isSecuritySettingKey(key);
}
