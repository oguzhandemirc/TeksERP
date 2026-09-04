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
 * ⚠️ `isSystemAccountIdentity` (supapsız GÖRÜNÜRLÜK yüklemi) 2026-09-04'te
 * KALDIRILDI — geri getirmeden önce aşağıdaki gerekçeyi çürüt.
 *
 * 2026-09-03'te İKİ yüklem vardı: yazma supaplı (`isSuperadminGateOpen`),
 * görünürlük supapsız. O ayrım MEŞRUYDU çünkü modül anahtarlarının İKİNCİ bir
 * yazma yolu vardı: Genel Ayarlar → Modüller sekmesi. Yani satıcı ekranını
 * tamamen gizlemek kimseyi kilitlemiyordu.
 *
 * 2026-09-04'te kullanıcı isteğiyle o sekme KALDIRILDI (modül anahtarları tek
 * bir ekrana taşındı: Sistem → Modüller). O anda supapsız görünürlük yüklemi
 * bir KİLİTLENME üretir hâle geldi: süperadmin hesabı doğmamış bir kurulumda
 * karo çizilmez + route 403 verir + geriye yazacak başka yüzey yoktur → modüller
 * bir daha AÇILAMAZ. Tek yazma yolu kalınca yüklem de tek kalmalı ve SUPAP
 * TAŞIMALIDIR.
 *
 * Bugünkü kural tek cümle: **satıcı yüzeyi satıcıya görünür; satıcı hesabı hiç
 * doğmamışsa (yalnız o zaman) fabrika yöneticisine de görünür ve yazılabilir.**
 * Backend `flagWriteGuard`ın üçüncü dalı da tam olarak budur.
 */
