# Süperadmin · Ayar şifresi
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/superadmin.md`.

Sınıf: [ÇEKİRDEK] her kurulumda aynı · [PROFİL] bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- [ÇEKİRDEK] Süperadmin = `User.isSystemAccount`; kimlik JWT'ye GİRMEZ: `verifyToken` taze okur → `req.isSystemAccount`, sahte claim 403. Tam yetki `getEffectivePermissions`ın İLK ifadesi `["*"]`: grant satırı doğmaz, süperadmin ROL değil, katalogda `code:"*"` yok.
- [ÇEKİRDEK] En yetkili hesap GİZLENMEZ: kullanıcı listesi, audit (canlı+arşiv), karneler, cihaz detayı DB'deki adıyla basar; VISIBLE_*/visibleUserWhere/maskSystemActor/SQL_ACTOR_*/blockSystemAccountTarget geri getirilmez; `isSystemAccount` yanıtta kalır ('Tüm yetkiler' rozeti).
- [ÇEKİRDEK] Görünürlük ≠ kimlik teslimi: `GET /users/:id/credentials` (düz PIN) en yetkili hesap için başkasına 403; `/users/:id*` altındaki HER YAZMA ucu `protectSystemAccountTarget` ile 403 + audit `SYSTEM_ACCOUNT_WRITE_BLOCKED`; GET serbest, hesabın kendisi muaf.
- [ÇEKİRDEK] `flagWriteGuard`: modül dalı EN ÖNDE ve `.some` (belge dalı `.every`), SENKRON, hata `MODULE_FLAG_SUPERADMIN_ONLY`. Supap: sistem hesabı YOKSA `admin:settings` yazar + audit `SUPERADMIN_ABSENT_MODULE_WRITE`; bilinmiyor=VAR (fail-closed); supap dalı tembel DB tazeler (tek async yol).
- [ÇEKİRDEK] Süperadmin iki yoldan doğar, ikisi de 8038 kilidinin arkasında: (1) sunucuda `npm run superadmin:kur` / `dist\tools\superadmin-olustur.cjs` (`--rotate`: parola+PIN, açık 2FA kapanır, tokenVersion++; setup.exe aynı betiği kurulum kipiyle çağırır) · (2) boot varsayılan doğuşu.
- [ÇEKİRDEK] `.env` tohumlaması geri gelmez; boot `SUPERADMIN_*` OKUMAZ, var olan hesaba DOKUNMAZ.
- [ÇEKİRDEK] Süperadmin = `isSystemAccount` ∧ kurulum anahtarıyla atılmış geçerli mühür `systemAccountSeal` (parola/PIN/kart özetleri + TOTP durumunu kapsar; `tokenVersion`, `totpLastStep`, kod `usedAt` dışarıda).
- [ÇEKİRDEK] Mandallı kurulumda DB kurcalaması `["*"]` vermez: giriş 403 `SYSTEM_ACCOUNT_SEAL_INVALID`, supapta "hesap VAR".
- [ÇEKİRDEK] İstek kapısı, izin kümesi, giriş, hedef koruması ve PIN/kart okuma kapısı TEK yüklem `isSystemAccountAuthorized`ı okur; sahte işaretli hesap korunmaz, pasife alınabilir.
- [ÇEKİRDEK] Mührü yalnız `superadmin-olustur` (doğuş · `--rotate` · kurulum kipi · `--muhurle`) ve varsayılan doğuş atar; kimlik değişimi önceki mühür geçerliyse aynı yazımda yeniler, geçersizi aklamaz.
- [ÇEKİRDEK] Mandal DB'de değil `LICENSE_DIR/sistem-hesabi-mandali.json`da (yoksa bugünkü davranış + uyarı bandı, okunamıyorsa zorunlu).
- [ÇEKİRDEK] Mühür TOTP özetini `openStoredTotpSecret` açık değerinden alır; v1 mühür yalnız `LICENSE_DIR/sistem-hesabi-muhru-v2.json` yokken geçer, açılış bir kez v2'ye yeniler.
- [ÇEKİRDEK] Varsayılan süperadmin: HİÇ sistem hesabı yoksa boot gömülü ortak malzemeyle (`{kullaniciAdi, ozet}`, bcrypt ≥12, `__TEKSERP_VARSAYILAN_SA__`) bir kez doğurur; `mustChangePassword` + `defaultPasswordIssuedAt`.
- [ÇEKİRDEK] Varsayılan süperadmin: ad başka kullanıcıdaysa DOĞMAZ; malzemesiz derlemede doğmaz, boot tek satır uyarır.
- [ÇEKİRDEK] Varsayılan malzeme çalışma zamanı ortamından OKUNMAZ; kaynak derleme (`TEKSERP_VARSAYILAN_SA` > `TEKSERP_VARSAYILAN_SA_DOSYA` > `~/.tekserp/sirlar/varsayilan-superadmin.json`; üretim `scripts/varsayilan-superadmin-ozet.ts`, ≥16 kr, maliyet 13, 0600); düz parola/özet repoya girmez.
- [ÇEKİRDEK] Hesap ortak parolayla duruyorsa (`defaultPasswordChangedAt` NULL) kurulum aracı DEVRALIR (sonuç `DEVRALINDI`); yeni parola ortak varsayılan OLAMAZ (`PASSWORD_IS_DEFAULT`, üç yazma yolunda).
- [ÇEKİRDEK] Fabrika yöneticisi süperadminden AYRI hesaptır (yükseltme/devir yok); "yönetici var mı" TEK yüklem `factoryAdminExists` (`services/helpers/factory-admin.helper.ts`); `/auth/me` ve `POST /api/admin/factory-admin` onu okur.
- [ÇEKİRDEK] `POST /api/admin/factory-admin` yalnız yönetici YOKKEN açar (kilit 8025, varsa 409 `FACTORY_ADMIN_EXISTS`); parola ve "Admin (Tam Yetki)" şablonunu SUNUCU belirler (gövde yalnız kullanıcı adı + ad soyad, fazlası 400).
- [ÇEKİRDEK] Fabrika yöneticisinin geçici parolası yalnız 201 cevabında, audit'e girmez; `mustChangePassword`; panel kartı uyarır, engellemez; destek oturumunda rozet sürekli.
- [ÇEKİRDEK] Dev/test girişi `admin` / `123123`; seed YALNIZ admin üretir; yeni kullanıcı panelden (`POST /api/admin/users`); 0-izinli testler geçici kullanıcı üretir; bölüme yalnız seed/dev kimlikleri yazılır.
- [ÇEKİRDEK] Barındırılan sınıfta `auth.autoLogoutOnExpiry` kilitli açık (false → 409 `HOSTED_CLASS_FORCED`), masaüstü/tarayıcı oturumu ≤24 sa (`hostedDesktopSessionMinutes`), bilinen/zayıf `JWT_SECRET` açılışı durdurur (`jwtSecretHostedRefusal`); LAN'da bugünkü davranış.

### Yasaklar

- [ÇEKİRDEK] `isSystemAccount` panelden/API'den ATANAMAZ, mevcut kullanıcı YÜKSELTİLMEZ; hiçbir Zod şemasına/yazma yoluna girmez.
- [ÇEKİRDEK] `isSystemAccount` yazarları: `scripts/superadmin-olustur.ts` ve `src/` altında TEK `services/helpers/varsayilan-superadmin.helper.ts` (yalnız `create`/`true`, yalnız `jobs/superadmin.job.ts` çağırır).
- [ÇEKİRDEK] `systemAccountSeal` hiçbir şemaya/route'a girmez; yalnız `system-account-seal.helper.ts` (`writeSeal` · `credentialReseal`) yazar.
- [ÇEKİRDEK] SIR HİJYENİ: süperadmin parolası/PIN/TOTP ve ayar şifresi repoya, log'a, sürüm notuna, audit yüküne GİRMEZ; log'da kullanıcı adı da yok; `.env`deki `SUPERADMIN_*` uyarısı yalnız ANAHTAR ADI basar; job tam anahtar literali taşımaz (`Object.keys(process.env)` + ön ek).
- [ÇEKİRDEK] TOTP sırrı DB'de SARILI (`enc1:<kid>:…`, AES-256-GCM, anahtar LICENSE_DIR halkasından HKDF); tek okuyucu/yazıcı `totp-state.helper` (`openStoredTotpSecret` · `storeTotpSecret`).
- [ÇEKİRDEK] TOTP: halka yok 503 `TOTP_KEY_UNAVAILABLE`, açılamıyor 503 `TOTP_SECRET_UNREADABLE` (2FA sessizce kapanmaz); açılış düz sırları bir kez sarar (idempotent, mührü değiştirmez).
- [ÇEKİRDEK] Halka kaybında TOTP/PIN/kart etkisini sessiz bırakma: sağlıkta `shortCredentials.halkaKaybi.etkilenen` göster, çare önce emanetten geri yükleme (`kesif-cihaz.md`).
- [ÇEKİRDEK] İkinci faktör TEK boğaz `AuthService.assertSecondFactor` (`issueToken`den ÖNCE, parola/PIN/kart): süperadmin PIN/kart girişinde kod HER ZAMAN sorulur, 2FA yoksa 403 `TOTP_ENROLLMENT_REQUIRED`.
- [ÇEKİRDEK] İkinci faktör: diğer hesaplarda PIN/kart kodu yalnız TOTP açık ∧ `auth.shortCredentialTotpRequired` (varsayılan false); `totpCapable` kapıya girmez.
- [ÇEKİRDEK] Tüketilmeden dolan 2FA kurulum penceresi gece bakımında 30 gün sonra SİLİNİR (`TOTP_ENROLLMENT_PURGE`); tüketilmiş pencere kurulum kanıtıdır — budanmaz.
- [ÇEKİRDEK] Modül profili uygulama için YAZMA UCU YOK: `PATCH /feature-flags` tek kapı (süperadmin guard + ayar şifresi zinciri ikinci kez KURULMAZ); `GET /api/admin/module-profile` salt okuma, fark SUNUCUDA.

### Kararlar

- [ÇEKİRDEK] Süperadmin kurtarma kodu BİLİNÇLİ YOK (cihaz kaybı → `--rotate`); giriş kilidi süperadmini de kapsar. Yeni 'kurtarma' yüzeyi açmadan önce P2 arşiv Q2 gerekçesini çürüt.

## Backend

### Değişmezler

- [ÇEKİRDEK] Supap defteri `SystemAccountRegistry` DB'den beslenir, boot job tazeler; `/auth/me` `systemAccountExists`i guard ile ortak `resolveSystemAccountLock`tan okur; defter TEK YÖNDE tazelenir — hesabı kaldırmak restart ister.
- [ÇEKİRDEK] Ayar şifresi YALNIZ `X-Settings-Password` başlığında; gövde/query/cookie fallback YASAK. Küme ASCII `^[\x21-\x7E]+$`, 8–72; `.trim()` yerine RED; backend↔Electron sabitleri ayna bekçili.
- [ÇEKİRDEK] `requireSettingsPassword` ASYNC ve `flagWriteGuard`dan SONRA. Muaf: süperadmin · belge-only gövde (`.every`) · hash yok → uyur. Kilit `bcrypt.compare`den ÖNCE (429); başlık yok 403 REQUIRED; yanlış 403 INVALID+audit; doğru USED audit.
- [ÇEKİRDEK] USED audit yolu `${req.baseUrl}${req.path}` (originalUrl YASAK); LOCKED olayı kilit başına tek satır (`justLocked`); `Retry-After` tek noktadan (error middleware); oturum jti ↔ userId uymazsa 401 SESSION_INVALID.
- [ÇEKİRDEK] Kurulum script'i İDEMPOTENT (hesap varsa dokunmaz); saf `provisionSuperadmin(input, deps)` HİÇBİR ŞEY YAZDIRMAZ, sırlar yalnız dönüşte; `SUPERADMIN_PROVISIONED/ROTATED` audit çağrısı `src/` altında kalır.
- [ÇEKİRDEK] G5 okuma rolü (`<sahip>_okuma`) yalnız SELECT; yeni sır tablo/kolonu `src/lib/okuma-rolu.ts` listesine girer (kolon düzeyi GRANT).
- [ÇEKİRDEK] G5 okuma rolünün parolası saklanmaz, yalnız sistem hesabı yenile-ve-göster ile üretir, audit parolasız; definer fonksiyonlar ve advisory kilitleri PUBLIC'e kapalı; ihlalde rol NOLOGIN.

### Yasaklar

- [ÇEKİRDEK] Ayar şifresi hash'i `security.settingsPasswordHash` `systemSettingService.set()` ile YAZILMAZ (maske görmez) — doğrudan upsert + ayrı olay.
- [ÇEKİRDEK] `security.*` ayar listesi ve `config-bundle`dan dışlanır, `PUT /admin/settings/:key` reddeder (`SETTING_KEY_RESERVED`); `settingsPasswordRequired` bayrak değil.

### Tuzaklar

- [ÇEKİRDEK] Ayar şifresi kilit kovası giriş kovasından AYRI, ayrım KEY'de (`sp:`, `resolveSettingsLockoutKeys`); `resolveLoginLockoutKeys` kullanma. Aynı şalter `auth.pinLockoutEnabled`, ayrı SAYAÇ.
- [ÇEKİRDEK] TTY kapısı FAIL-LOUD: `interaktif()` `--help` dalından hemen sonra `process.stdin.isTTY` yoksa `TTY_GEREKLI_MESAJI` + exit 1 (readline TTY'siz sessizce donar).
- [ÇEKİRDEK] Kurulum kipi `superadmin-olustur --kurulum-stdin` YALNIZ setup.exe: `{kullaniciAdi, parola, pin}` tek JSON STDIN'den (argv/ortam/günlük YOK); readline yok; bayt tavanı + zaman aşımı + katı şema, sapma gürültülü hata; PIN zorunlu, rotasyon YOK; çıktı tek JSON satırı, SIR TAŞIMAZ.
- [ÇEKİRDEK] Kurulum kipi `--help`ten SONRA, TTY kapısından ÖNCE ayrılır; etkileşimli kip ve TTY kapısı değişmez.

### Kararlar

- [ÇEKİRDEK] Süperadmine özel uçlarda 404 değil 403; `requireSystemAccountOr404` adı bayat, forbidden döner.

## Panel (Electron)

### Değişmezler

- [ÇEKİRDEK] Hesap ortak varsayılan parolayla dururken panel üstte KIRMIZI, kapatılamaz bant; ölçüt sunucuda (`/auth/me` `defaultSuperadminPasswordPending`, yalnız hesabın kendisine ve `admin:users`/`admin:settings` sahibine dolu); alanı bilmeyen eski backend bant çizdirmez.
- [ÇEKİRDEK] Satıcı kapısı TEK YÜKLEM `isSuperadminGateOpen` = isSystemAccount || !systemAccountExists (`lib/superadmin-gate.ts`); karo, route (`requireSystemAccount`), palet, FeatureFlagSection, ModuleProfilePage ondan ithal eder; `isSystemAccountIdentity` geri gelmez.
- [ÇEKİRDEK] Ayar kategorisinde modül bağı = `moduleKey` (KİLİT, `superadminOnly` ikizi); `regime` modül anahtarlarına açılmaz. Bant 'dondu' der, 'etkisiz' DEMEZ. Fabrika görünümünde kapalı modülün satırı çizilmez; satıcıda satır + bant.

### Reçeteler

- [ÇEKİRDEK] Karo döngüsü dışındaki palet girdileri (`ops:work-order-new`, `def:station-capabilities`) modül/süperadmin kapısını ELLE taşır; 'Kapatırsan gizlenir' önizlemesi masaüstü/tableti AYRI sayar; manifesto okunamazsa liste ÇİZİLMEZ.
- [ÇEKİRDEK] `withSettingsPassword`: istek önce şifresiz; 403 REQUIRED/INVALID → `SettingsPasswordDialog` → başlıkla tekrar; LOCKED kalan süre.
- [ÇEKİRDEK] Ayar şifresi: bir eylem en çok BİR KEZ sorar (`SettingsPasswordScope`), eylemler arasında HATIRLANMAZ; şifre log/toast/localStorage'a girmez; kapılı uca her çağrı sarmalayıcıdan geçer.

### Kararlar

- [PROFİL] Sistem → Modüller (`/system/module-profile`) satıcı ekranı: hesap doğmuşsa fabrika yöneticisi HİÇ açamaz, yoksa açar ve yazar. Demo kartı `superadminOnly` ALMAZ (guard yalnız MODULE_FLAG_KEYS).

## Geçersiz kılınan kurallar — bunlara UYMA

- Süperadmin GİZLEME (süzgeçler, 'Sistem Bakımı' maskesi, `/users/:id` 404) → GEÇERSİZ; yetki yarısı yürürlükte.
- `.env` tohumlaması (readSuperadminEnv, SUPERADMIN_FORCE_SYNC, TOTP .env'den) → GEÇERSİZ.
- 'Modüller fabrika adminine salt-okunur görünür' → GEÇERSİZ.
- Supapsız `isSystemAccountIdentity` → GEÇERSİZ.
- Ayar şifresi uçlarında 404 → GEÇERSİZ (403).
- 'Modül = kilit, gizleme değil' → fabrika görünümünde satır gizlenir.
- 'Sır dağıtımı `.env` + parola yöneticisi' → GEÇERSİZ.
- 'Dar 403 yalnız credentials' → GEÇERSİZ: `protectSystemAccountTarget`.

## Çözülmüş çelişkiler

- Maske silindi ama doğuşta `fullName` hâlâ 'Sistem Bakımı' (açık soruya bak); fabrika görünümünde satır gizleme geçerli; `.env` sır taşımaz.

## Açık sorular

- Provisioning `fullName = "Sistem Bakımı"` yazıyor; gerçek ad sorulmalı mı (kullanıcı kararı).
- `686c7212` ve 2026-09-04 en-yetkili notunun arşiv metni eksik; P8 mükerrer satırları birleşmeli.
- Bayat kod yorumları (system-account.middleware.ts, superadmin.job.ts, `requireSystemAccountOr404` adı).
- P2 açık maddeleri ölçülmedi; P6/P5 palet kuralları için adlı bekçi yok.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_vds_cihaz_oturum`, `test_jwt_sir_kapisi`, `test_db_invariants`, `test_fabrika_yoneticisi`, `test_okuma_rolu`, `test_kurulum_girdisi`, `test_parola_degisimi_zorunlu`, `test_settings_password`, `test_settings_password_callers`, `test_superadmin`⚠️, `test_superadmin_provision`, `test_superadmin_visible`, `test_sistem_hesabi_muhru`, `test_sistem_hesabi_muhru_uctan_uca`, `test_kimlik_totp_sifreleme`, `test_kimlik_oturum_tavani`, `test_user_credentials_guard`, `test_varsayilan_superadmin`, `test_docker_hijyeni`, `test_lisans_kilit_kacaklari`, `test_lisans_native_kahin`, `test_kimlik_kisa_yol_totp`, `test_telemetri_defter_degil`, `test_audit_labels`

İstemci: `DefaultSuperadminBanner.test.tsx`, `FactoryAdminCard.test.tsx`, `SettingsPasswordDialog.test.tsx`⚠️, `superadmin-gate.test.ts`⚠️, `FeatureFlagSection.superadmin.test.tsx`, `SettingsPasswordCard.test.tsx`⚠️, `settings-surface.test.ts`, `ModuleProfilePage.test.tsx`⚠️, `SystemHubPage.superadmin.test.tsx`, `login-totp.test.ts`, `auth.test.ts`, `usePermission.test.ts`, `flag-modules.test.ts`, `SettingsSurfacePage.modules.test.tsx`, `production-regime.test.ts`, `tile-route-permission.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- Ayrıntı dosyasında; `arsiv/2026-09.md`, `arsiv/2026-10.md`.
