// =============================================================================
// SATICI (SÜPERADMİN) KAPISI — TEK YÜKLEM
// =============================================================================
// Kural İKİ parçalıdır ve ikinci parça bir EMNİYET SUPABIDIR:
//
//   isSystemAccount        → bu oturum satıcı hesabı mı (`/api/auth/me`den)
//   !systemAccountExists   → kurulumda HİÇ sistem hesabı doğmamış mı
//
// Supap olmasaydı süperadminsiz her kurulum modül anahtarlarını bir daha
// AÇAMAYACAK şekilde kilitlenirdi; backend `flagWriteGuard`ın üçüncü dalı da
// tam olarak aynı supabı taşıyor. Ayrışırlarsa arıza SESSİZDİR: panel ekranı
// yazılabilir çizer, sunucu 403 verir.
//
// NEDEN AYRI DOSYA (2026-09-03): kural `FeatureFlagSection` içinde GÖMÜLÜYDÜ ve
// üçüncü bir tüketici doğdu (Sistem Profili ekranı + Sistem hub karosu). Üç
// yerde ayrı ayrı yazılsaydı supabın birinde unutulması an meselesiydi ve
// unutulduğu yer "modülleri bir daha açamama" ile sonuçlanırdı. Bekçi
// (`superadmin-gate.test.ts`) tüketicilerin bu dosyadan İTHAL ettiğini de ölçer
// — davranışı ikizlemek yetmez, kaynağın TEK olması gerekir.
// =============================================================================

/** Yüklemin okuduğu kimlik alanları — `useAuthStore`un ilgili iki alanı. */
export interface SuperadminGateState {
  /** Bu oturum satıcı (sistem) hesabı mı? */
  isSystemAccount: boolean;
  /** Kurulumda bir sistem hesabı DOĞMUŞ mu? (fail-closed varsayılan `true`) */
  systemAccountExists: boolean;
}

/**
 * Modül anahtarları bu oturumda YAZILABİLİR mi? (supap DAHİL)
 *
 * Backend `flagWriteGuard`ın üçüncü dalının aynası. Supap açıkken (kurulumda
 * hiç sistem hesabı yok) fabrika yöneticisi Genel Ayarlar → Modüller'den
 * anahtarları YÖNETEBİLİR — yoksa süperadminsiz kurulum modülleri bir daha
 * açamaz ve tek çıkış ham API kalırdı.
 */
export function isSuperadminGateOpen(state: SuperadminGateState): boolean {
  return state.isSystemAccount || !state.systemAccountExists;
}

/**
 * Bu oturum SATICI hesabı mı? — SATICI YÜZEYLERİNİN GÖRÜNÜRLÜK kapısı.
 *
 * ⚠️ `isSuperadminGateOpen`in İKİZİ DEĞİL, farklı bir soru sorar ve SUPAP
 * TAŞIMAZ (kullanıcı kararı 2026-09-03): "Sistem Profili satıcı ekranıdır,
 * süperadmin hesabı yokken de fabrikaya GÖRÜNMEZ."
 *   • YAZMA sorusu  → `isSuperadminGateOpen` (supaplı; kilitlenmeyi önler)
 *   • GÖRÜNÜRLÜK    → bu yüklem (supapsız; satıcı yüzeyi keşfe davet etmez)
 *
 * ⚠️ KİLİTLENME NEDEN İMKÂNSIZ: iki yüklem birlikte her durumda EN AZ BİR
 * yazıcı bırakır. Sistem hesabı YOKSA Sistem Profili ekranı gizlidir ama
 * Genel Ayarlar → Modüller fabrika yöneticisine AÇIKTIR (bant onu söyler);
 * hesap VARSA o sekme salt-okunur olur ve yazma satıcıya geçer. Bu ikisinden
 * birini supaplı/supapsız yaparken diğerini de gözden geçir.
 */
export function isSystemAccountIdentity(state: SuperadminGateState): boolean {
  return state.isSystemAccount;
}
