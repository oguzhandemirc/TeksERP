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

/** Satıcıya ait yüzeyler bu oturumda YAZILABİLİR mi? */
export function isSuperadminGateOpen(state: SuperadminGateState): boolean {
  return state.isSystemAccount || !state.systemAccountExists;
}
