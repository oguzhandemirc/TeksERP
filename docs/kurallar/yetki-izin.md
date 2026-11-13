# Yetki · İzin · Rol
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/yetki-izin.md`.

> Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** İzin doğrudan kullanıcıya bağlanır (`UserPermission`), rol modeli YOK (`PermissionTemplate` yalnız paket; `hasRole` yok). Eşleşme TEK yüklem `matchesPermission` (global `*` + `<domain>:*`; backend/Electron/mobil ikiz); düz `includes("admin:*")` YASAK.
- **[ÇEKİRDEK]** Yeni izin TEK adım: `permission-catalog.ts` → `PERMISSION_CATALOG`'a bir satır (`category` Prisma enum'u); boot uzlaştırması eksik satırı yazar; sayı dokümana sabitlenmez.
- **[ÇEKİRDEK]** Katalog/uzlaştırma ATAMA İÇERMEZ: izin/rol DB'ye gelir, kimseye verilmez (atama panelden ya da `scripts/sync-*-permissions.ts`); yeni izinde Yetki Kataloğu'ndaki "N yetki hiçbir kullanıcıda yok" bandını (`userCount`/`templateCount`) kontrol et.
- **[ÇEKİRDEK]** Rol şablonları tek kaynak `constants/role-template-catalog.ts` + boot uzlaştırma (izinlerden SONRA, aynı zincir); izni kullanıcıya götüren PAKET (şablon) de kodda gelir.
- **[ÇEKİRDEK]** `SAHA_OPERATORU` şablonu ekran kataloğundan türer (`mobileScreenPermissionCodes()` = mobil ekranların `requires` birleşimi; elle sayılmaz); YETENEK izinleri (`capabilities`: `mobile:tambur-duzelt`, `dokuma-geri-al`, `devere-iptal`, `kk1-desen`, `kk1-yari-mamul`…) ve `mobile:*` GİRMEZ (`MOBILE_ALL` ayrı).
- **[ÇEKİRDEK]** Mobil ekranın dokunduğu her uç `requireAnyPermission('<web-izni>', ...MOBILE_X)`; yalnız `requirePermission` saha kullanıcısını 403'ler. Yeni saha özelliğinde yeni izin kodu açma, mevcut çift yeter (`roll:manual-adjust` ∨ `mobile:tambur-duzelt`; rework `workorder:write`).
- **[ÇEKİRDEK]** Kart ile route AYNI izin listesini taşır (`tile-config.permissionAny` ↔ `content-routes.requireAnyPermission`).
- **[ÇEKİRDEK]** Dar izin çiftinde READ kümesi WRITE kodunu DA içerir (`label-template:read/write` dahil); kümeler saf string literal dizi kalır (AST bekçisi okur).
- **[ÇEKİRDEK]** `PATCH /api/feature-flags` guard'ı anahtar-kapsamlı üç dal, FAIL-CLOSED: ① modül anahtarı varsa (`.some`, en önde, senkron) sistem hesabı (supaplı) ② yalnız belge anahtarları (`.every`) `document-template:write` ③ gerisi ANAHTAR BAŞINA ekran izni.
- **[ÇEKİRDEK]** ③ dalında her anahtar `admin:settings` ∨ kendi `settings:<kategori>` (`constants/settings-scopes.ts`); tabloda olmayan ve boş gövde yalnız `admin:settings`. Düz OR YASAK; ayar şifresi bundan SONRA.
- **[ÇEKİRDEK]** `settings:workstation` ve `document-template:read/write` kategorisi WEB: `hasAdminAccess` saymaz, `admin:*` VERMEZ. `/system/update` (`admin:settings` ∨ `settings:workstation`) ve `/system/workstation` aynı çifti ister.
- **[ÇEKİRDEK]** Ayarlar EKRAN BAŞINA izinli: kategori `permissionAny: [admin:settings, settings:<kategori>]`, Sistem karosu kendi `system:<ekran>` izni; `admin:settings` şemsiye, çıkarılmaz. Tek kaynak `constants/settings-scopes.ts`, panel aynası; `SETTINGS_*_ACCESS` sekme birleşimi; Sistem hub'ı `SYSTEM_HUB_ACCESS`.
- **[ÇEKİRDEK]** Süperadmin ekranları (Modüller · Veritabanı Geri Yükleme · Endpoint Performansı · Aktivite Arşivi) backend'de `requireSystemAccountWhenPresent`, panelde `superadminOnly`/`requireSystemAccount` ile kapılı; sistem hesabı yoksa supap izin kapısına bırakır.
- **[ÇEKİRDEK]** Masaüstüne kabul `canEnterApp`: en az bir MOBİL-OLMAYAN izin; yalnız `mobile:*` izinli hesaba backend `login` `isDesktopClient` (electron VE web) iken 403, token yok; `!== "mobile"` YAZILMAZ.
- **[ÇEKİRDEK]** 403 yetki reddi `details.code` taşır: `PERMISSION_DENIED` + `details.required`/`details.requiredAny`; kanal reddi ayrı `CHANNEL_DENIED` + `channel: desktop`; modül kapalı `MODULE_DISABLED` ayrı sınıf. Kod `body.code`a yazılmaz; mesaj metni değişmez.
- **[ÇEKİRDEK]** Panel 403'te koda yalnız kurulum kapısı için bakar (`MODULE_DISABLED` · `LICENSE_*`, `handleInstallationGate`); Swagger `components.schemas.ForbiddenError` + `responses.Forbidden`.
- **[ÇEKİRDEK]** Süperadmin ROL DEĞİL: `getEffectivePermissions` ilk ifadesi `isSystemAccount → ["*"]` (grant satırı yok; katalogda `code:"*"` yok); `isSystemAccount` panelden ATANAMAZ (tek yazar `superadmin-olustur.ts`); kimlik JWT'ye GİRMEZ, `req.isSystemAccount` istek başına taze.
- **[ÇEKİRDEK]** En yetkili hesap GÖRÜNÜR: liste/audit/tablet gerçek ad + "Tüm yetkiler" rozeti; gizleme süzgeci, takma ad ve `/users/:id*` 404 kapısı geri GELMEZ.
- **[ÇEKİRDEK]** Görünürlük ≠ kimlik teslimi: `/users/:id/credentials` düz değeri yalnız basım penceresinde ya da dönüştürülmemiş eski kayıttan döner; o uçtaki dar 403 kapısı ve okuma izi KALIR.
- **[ÇEKİRDEK]** `/users/:id` öneki KALIR (`protectSystemAccountTarget`: GET serbest, yazma 403 + audit, kendisi muaf); önek izni alt rotaların BİRLEŞİMİ.
- **[ÇEKİRDEK]** Modül anahtarı kilidi: sistem hesabı VARSA modül anahtarlarını yalnız o yazar (403 `details.code=MODULE_FLAG_SUPERADMIN_ONLY`); hiç yoksa `admin:settings` + audit `SUPERADMIN_ABSENT_MODULE_WRITE`; bilinmiyor = VAR (fail-closed); defter tek yönde tazelenir.
- **[ÇEKİRDEK]** Ayar şifresi NİYET kapısıdır (izin zincirinin ardında, asenkron): süperadmin ve belge-only gövde (`.every`) MUAF; hash yoksa kapı uyur; kilit `bcrypt.compare`den ÖNCE; başlık yok 403 REQUIRED (audit yok), yanlış 403 INVALID + audit, doğru USED audit.
- **[ÇEKİRDEK]** Süperadmin TEK doğuş/rotasyon yolu `npm run superadmin:kur` (`--rotate`, sunucuda interaktif): idempotent, mevcut kullanıcı YÜKSELTİLMEZ, TTY yoksa FAIL-LOUD, `provisionSuperadmin` yazdırmaz. `.env` tohumlaması YASAK; kalan `SUPERADMIN_*` için yalnız anahtar adı basılır.
- **[ÇEKİRDEK]** Dev/test kimliği yalnız geliştirme seed'i `admin / 123123` (`--gelistirme`; kurulum seed'i sabit parola yazmaz); "test123" kullanıcıları ÖLÜ; HTTP testleri kullanıcısını `ensureTestAdmin()` ile üretip temizler.

### Yasaklar

- **[ÇEKİRDEK]** `admin:settings` DOCUMENT_DESIGN_READ/WRITE kümelerinden DÜŞÜRÜLMEZ (kilitlenmeye karşı tek emniyet supabı).
- **[ÇEKİRDEK]** Ayar şifresi YALNIZ `X-Settings-Password` başlığında (gövde/query/cookie YASAK); ASCII `^[\x21-\x7E]+$`, 8–72; `.trim()` yerine RED; backend↔Electron ayna bekçili.
- **[ÇEKİRDEK]** Güncellemeler sayfası (`/system/updates`) KAPISIZ; izinsiz kullanıcının "Sunucu" satırı yalnız `GET /api/guncelleme/ozet`ten (yalnız `verifyToken`, izin kapısından ÖNCE; OPT-IN `updateSummaryOf`: belirteç/politika/onaylayan yok).
- **[ÇEKİRDEK]** Güncelleme tam durumu `license:view ∨ license:manage`, onay düğmeleri `license:manage`; yeni izin kodu açılmaz.

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Şablon kimliği `permission_templates.code`, AD DEĞİL; `code=null` fabrikanın şablonu, dokunulmaz; sahiplenme YALNIZ `LEGACY_TEMPLATE_NAME_TO_CODE` (`entry.name`e açılmaz); ad çakışmasında oluşturma ATLANIR.
- **[ÇEKİRDEK]** `mode:"all"` YALNIZ "Admin (Tam Yetki)" şablonunda (her boot katalogla eşitlenir; tam bir tane); diğer rollerde eksik izin EKLENİR, fazlalar korunur, izin çıkarılmaz.
- **[ÇEKİRDEK]** Ayar şifresi kapsamı elle sayılmaz: `src/routes/**` içinde `systemSettingService.set(`/`setFeatureFlags(`/`systemSetting.upsert(` çağıran her zincir `requireSettingsPassword` taşır (AST tripwire, iki yönlü muaf).
- **[ÇEKİRDEK]** Hash `security.settingsPasswordHash` `systemSettingService.set()` ile YAZILMAZ: doğrudan upsert + ayrı olay (`SETTINGS_PASSWORD_SET/ROTATED/REVOKED`); `security.*` listeden/config-bundle'dan dışlanır, `PUT /admin/settings/:key` reddeder.
- **[ÇEKİRDEK]** Oturum jti'si kullanıcıya bağlı: `verifyToken` `session.userId !== payload.userId` → 401 `SESSION_INVALID` (aynı kod/mesaj, orakül yok).
- **[ÇEKİRDEK]** Yeni kullanıcı `POST /api/admin/users` (`admin:users`), varsayılan `grantOperatorDefaults=true` ile üç mobil izin (`mobile:kk1/kk2-kursun/tambur`) + PIN/QR alır; web kullanıcısı için panel `false` gönderir.
- **[ÇEKİRDEK]** Kimliksiz (PUBLIC) uç yalnız gerekçeyle `test_route_auth_coverage` muaf listesinde (login, cihaz el sıkışması, `/api/mobile/updates/*`, `/api/client-policy/*`); beyansız public uç kırmızı; koruma imza/salt-okunurluk.
- **[ÇEKİRDEK]** İstek yetkisi ve kullanıcı adı DB'den: `verifyToken` `AuthService.resolveRequestPermissions` (TTL 30 sn tazelik; anahtar userId + tokenVersion + isSystemAccount); token `permissions` claim'i karar kaynağı DEĞİL; her izin yazıcısı tokenVersion'ı artırır.
- **[ÇEKİRDEK]** Web 2FA iki katman, karar TEK boğaz (`assertSecondFactor` → `webTotpWaived`): `auth.webTotpPolicy` (REQUIRED varsayılan | USER_CHOICE) yalnız süperadmin yazar (`SUPERADMIN_ONLY_FLAG_KEYS`, ham uçta rezerve).
- **[ÇEKİRDEK]** `User.webTotpOptOut` yalnız kendi ucundan (`PUT /api/auth/web-totp`; kapatmak parola + kuruluysa kod); REQUIRED'da tercih etkisiz; USER_CHOICE'ta kod yalnız TOTP kurulu ∧ opt-out yoksa; sistem hesabı HER ZAMAN kod (CHECK + 403); `web:access` LAN'da değişmez.
- **[ÇEKİRDEK]** "Bu cihazı hatırla" TEK boğaz (`assertSecondFactor` → `consumeTrustedDevice`, `readTrustedDeviceToken`): yalnız parolalı + doğru kodlu girişte doğar; süre `auth.trustedDeviceDays` (0 kapalı, süperadmin yazar); DB'de yalnız HMAC özeti (`<kid>:<hex>`); belirteç gövde/log/audit'e girmez.
- **[ÇEKİRDEK]** Güvenilir cihaz satırı doğuştaki `tokenVersion`a bağlı; parola değişimi/sıfırlama, TOTP sıfırlama, pasifleştirme aynı tx'te iptal eder; sistem hesabı hep kod verir.
- **[ÇEKİRDEK]** Barındırılan kurulumda ikinci faktör KANALDAN BAĞIMSIZ (`assertSecondFactor` → `hosted-second-factor.ts#decideHostedBearer`): electron/mobile/boş `clientType` çerez kuralından geçer; kod gerekip TOTP yoksa 403 TOTP_ENROLLMENT_REQUIRED (USER_CHOICE'ta kurmamışa kod yok).
- **[ÇEKİRDEK]** Barındırmada onaylı TABLET/PHONE + bu istekte HMAC kanıtlı cihazdan mobil giriş ikinci faktör sayılır; süperadmin her kanalda kod; LAN'da kural yok; `web:access` masaüstüne genişletilmez.
- **[ÇEKİRDEK]** Patron telefon uygulaması `clientType:"patron"` → `Session.deviceType=PATRON` (kendi yuvası; tablet/panel/web oturumunu düşürmez); yalnız PAROLA yolu (PIN/kart 400); `patron-app:login` ister (yoksa 403 `PATRON_ACCESS_DENIED`), bu izin masaüstünü açmaz (`grantsDesktopPanel`) ve dar rollere atanmaz.
- **[ÇEKİRDEK]** Patron oturumu mutlak `PATRON_SESSION_DAYS` (30) gün, fabrika mutlak tavanı kısaysa o; otomatik çıkış ve barındırılan 24 sa tavanı uygulanmaz; yenileme belirteci YAZMA (süre bitince parola + açıksa kod).
- **[ÇEKİRDEK]** Patron türünde ikinci faktör yalnız kullanıcı TOTP'yi açtıysa (LAN ve barındırılan; Y1 kanal-bağımsız kuralı patron'u kapsamaz, `appliesHostedBearerRule`); sistem hesabı her zaman kod.
- **[ÇEKİRDEK]** Sistem hesabını girişte hatırlama: `auth.rememberLastUser` kaydı yalnız `/auth/me` `isSystemAccount === false` iken yazılır (yalnız kullanıcı adı + görünen ad), ayar kapalıyken silinir; sistem hesabı girişi kaydı değiştirmez.
- **[ÇEKİRDEK]** Web çerezindeki JWT'ye izin listesi koyma (`permissions: []`; 4096 bayt); yetki DB'den, panel listesi giriş gövdesi ve `/auth/me`den; Bearer claim'i aynen kalır.
- **[ÇEKİRDEK]** Yeni token DAİMA süreli (`exp`): mutlak tavan kapatılamaz (`UNSET_ABSOLUTE_SESSION_CAP_DAYS` = 30, tek çözücü `effectiveAbsoluteSessionCapDays`; 1–365 aynen); exp'siz eski token kabul, oturum başına TEK uyarı.
- **[ÇEKİRDEK]** Oturum bitişine SUNUCU karar verir: `verifyToken` oturum `expiresAt` geçmişse JWT `exp`ten bağımsız 401; `isSessionValid` aynı yüklem.
- **[ÇEKİRDEK]** Kullanıcı başına aktif oturum `MAX_ACTIVE_SESSIONS_PER_USER` (20), aynı-tip politikası `off` olsa da: yeni giriş en eskiyi `SESSION_LIMIT` ile düşürür; oturum kilidi (8024) KULLANICI anahtarlı.
- **[ÇEKİRDEK]** `User.mustChangePassword` bekleyen token yalnız `verifyTokenAllowPasswordChange` taşıyan üç uca geçer (`/auth/me` · `/auth/logout` · `/auth/change-password`), diğerleri 403 `PASSWORD_CHANGE_REQUIRED`; dördüncü uç kural değişikliğidir.
- **[ÇEKİRDEK]** Panel ve `passwordChangeCapable` tabletin parolalı girişi kısıtlı token alır; eski tablet parolalı ve her PIN/kart girişi token almaz (403; `details.username`). Parola politikası tek kaynak `src/constants/password-policy.ts` (≥10 karakter, ≤72 bayt; ayna `Electron/src/lib/password-policy.ts`).
- **[ÇEKİRDEK]** "Şifre Sıfırla" varsayılan GEÇİCİ parola; `requireChange:false` kalıcı; parola + `mustChangePassword` + `tokenVersion` tek atomik yazım, audit gerçek `requireChange`; kendi/satıcı hesabı muaf; iki kişilik onay hep geçici (`resetRequiresPasswordChange`).
- **[ÇEKİRDEK]** Sır hijyeni: bcrypt turu TEK kaynak `PASSWORD_BCRYPT_COST` (12; eski özet girişte atomik yükselir; `RECOVERY_CODE_BCRYPT_COST`=10); silinen kullanıcı sır taşımaz (`DELETED_USER_SECRET_CLEAR`); audit derin maskelenir (`maskAuditPayload` · `isSecretAuditKey`).
- **[ÇEKİRDEK]** bcrypt compare/hash YALNIZ `services/helpers/password-hasher.helper` (semafor + worker; kuyruk dolu 503 `AUTH_BUSY`, bilinmeyen kullanıcıda sahte doğrulama); istemci IP `resolveClientIp`ten (internete açıkta IPv6 /64).

### Yasaklar

- **[ÇEKİRDEK]** Uzlaştırma YALNIZ EKLER: silmez, `description`/`module` ezmez; katalogdan çıkarma DB'den kaldırmaz (bilinçli veri migration'ı ister); izin için ayrı veri migration'ı YAZMA; canlı DB'ye elle INSERT yok.
- **[ÇEKİRDEK]** Sistem rolü SİLİNMEZ, PASİFLEŞTİRİLİR (`deleteTemplate` → isActive=false); `applyTemplate` pasif şablonu 400 ile reddeder, panel gizler; geri açma `PATCH … {isActive:true}`.
- **[ÇEKİRDEK]** `DOCUMENT_DESIGN_FLAG_KEYS` bilerek DAR: `companyName`/`companyLetterhead`/belge logosu EKLENMEZ; yeni anahtar ölçütü "yanlış girilirse etkisi belge çıktısıyla SINIRLI mı".

### Tuzaklar

- **[ÇEKİRDEK]** "Her izin dar bir rolde mi" bekçisi "Admin (Tam Yetki)" DIŞINDA koşar; muaflar `ROLE_COVERAGE_EXEMPT`te gerekçeyle, iki yönlü denetlenir.
- **[ÇEKİRDEK]** Ayar şifresi yönetim uçları (`GET/PUT/DELETE /admin/settings-password`) yalnız süperadmin, aksi 403 (404 değil; middleware adı `requireSystemAccountOr404` yanıltıcı, gövde `AppError.forbidden`); `verifyToken`dan SONRA.

### Kararlar

- **[ÇEKİRDEK]** SoD kümesi `shipping:invoice` / `shipping:undo-dispatch` / `roll:manual-adjust` / `gelen-belge:approve` / `gelen-belge:cancel` / `finance:hold-release` / `finance:cari-merge` yalnız Muhasebe ve Üretim Süpervizörü şablonlarında; `shipping:invoice` `shipping:write` VERMEDEN atanır.
- **[ÇEKİRDEK]** Aktör yalnız KENDİ efektif kümesinin kapsadığı izni verir (grant · set · şablon; `admin:*`/`["*"]` hepsini kapsar), aksi 409 `GRANT_EXCEEDS_ACTOR`; tek beyanlı istisna `createUser`ın sabit tablet paketi.
- **[ÇEKİRDEK]** Hedef aktörü aşıyorsa parola/TOTP/PIN/kart sıfırlaması İKİ KİŞİLİK: doğrudan 403 `CREDENTIAL_RESET_NEEDS_APPROVAL`, talep `credential_reset_requests`e, hedefi kapsayan farklı ikinci yönetici onaylar ve uygular (sır ona döner, talepte sır yok).
- **[ÇEKİRDEK]** Hızlı PIN SEÇİLEMEZ: her uç çakışmayan rastgele 6 hane üretir; şemalarda `pin` alanı yok; "PIN başkasında var" cevabı verilmez.
- **[ÇEKİRDEK]** Giriş deneme kilidi KAPATILAMAZ: `pinLockoutEnabled:false` 400 `PIN_LOCKOUT_REQUIRED`, eski `false` satırı okunmaz; yalnız eşik ve ceza süreleri (≥1) değişir.
- **[ÇEKİRDEK]** Giriş kilidi kovası DAİMA istemci IP'sini taşır (`ip`; vekil arkasında `ip|kullanıcı` ×1 + `ip` ×5); IP'den bağımsız hesap kilidi KURMA, cezayı süresiz yapma.
- **[ÇEKİRDEK]** İnternete açık kurulumda (barındırılan ∨ `CLIENT_IP_HEADER`) kovayı ayır: kanıtlı cihaz (`req.device.proofVerified`) cihaz, imzalı oturum kullanıcı, kalan IP kovası; geniş kova yönteme göre (`ip` · `pin|ip` · `card|ip`), kanıtlı cihaz PIN/kartı genişe girmez.
- **[ÇEKİRDEK]** Başarıda yalnız DAR kovanın ceza merdivenini sıfırla; `RATE_LIMIT_FACTORY_IPS` eşik × çarpan alır; LAN'da hiçbiri devreye girmez.
- **[ÇEKİRDEK]** Hesap başına kova YUMUŞAK (kademeli bekleme `LOGIN_THROTTLED`; sert kilit yok, başarılı kaynak beklemez); yeni/değişen parola `newPasswordViolation`dan geçer (girişte uygulanmaz).
- **[ÇEKİRDEK]** Genel CRUD (BaseService) gövdesinden yazılamayacak kolon `src/constants/write-guard.ts`te kapatılır; yazılabilir küme beyan anlık görüntüsü, yeni kolon karar ister.
- **[PROFİL]** Dar izin kapsamı ayarla daralır (varsayılan geniş): `workOrderQuickOwnOnlyEnabled` (`mobile:hizli-is-emri` yalnız kendi İE'sine, aksi 403 `PERMISSION_DENIED`) · `supportOwnTicketsOnlyEnabled` (`admin:settings`siz yalnız kendi talebi, başkası 404).
- **[ÇEKİRDEK]** `admin:*` kısayolu KORUNUR: `tambur-undo`/`import`/`demo` kapıları `matchesPermission(p, X) || matchesPermission(p, "admin:*")`; düz `matchesPermission(p, X)`e çevirme, düz `includes("admin:*")` yasak.

## Panel (Electron)


### Değişmezler

- **[ÇEKİRDEK]** Panelde satıcı kapısı TEK yüklem `isSuperadminGateOpen` (`isSystemAccount || !systemAccountExists`); karo·route (`ProtectedRoute.requireSystemAccount`)·palet·FeatureFlagSection ondan; supapsız `isSystemAccountIdentity` geri getirilmez.

- **[ÇEKİRDEK]** 2FA sekmesi göreli kurulum bağlantısı GÖSTERMEZ: `buildTotpEnrollUrl` mutlak kök yoksa `null`, kurulum uygulama içinde (`buildTotpEnrollHash`); başka kullanıcı için açmak yöneticinin oturumunu onayla ÖNCE kapatır.

### Tuzaklar

- **[ÇEKİRDEK]** Yeni ayar kategorisinde varsayılan DAR (`permissionAny` yoksa `admin:settings`); dar izinli kullanıcının yolu "Bu Bilgisayar" kartı ya da palettir; karo dışı palet girdisi kapıyı ELLE taşır.

### Reçeteler

- **[ÇEKİRDEK]** Electron'da ayar YAZAN her istek `withSettingsPassword`ten geçer: önce şifresiz; 403 REQUIRED/INVALID → `SettingsPasswordDialog` (App'te tek mount) → başlıkla tekrar; LOCKED → kalan süre; her kayıtta sorulur, oturumda hatırlanmaz.
- **[ÇEKİRDEK]** UI yetki kontrolü `useRoleAccess` + `<PermissionGate>`; `isAdmin` yalnız adminOnly nav/tile görünürlüğü, yetki kısayolu DEĞİL; `DefinitionsHubPage` kısa devresi korunur; admin route'ları `admin:settings`/`admin:users` ister.
- **[ÇEKİRDEK]** Salt-okuma GERÇEK: ekran READ ile açılır (`PermissionGate anyOf={DOCUMENT_DESIGN_READ}`), önizleme çalışır, Kaydet `canWrite` ile kapanır, yazma aksiyonları `readOnly` ile ÇİZİLMEZ.

### Kararlar

- **[ÇEKİRDEK]** `superadminOnly`/kilit bandı yalnız backend'de karşılığı olan kapı için çizilir (`flagWriteGuard` süperadmin dalı yalnız `MODULE_FLAG_KEYS`); bant "dondu" der, "etkisiz" DEMEZ.

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Mobil `usePermissions().has()` üç jokeri tanır: `*`, `mobile:*`, `admin:*`; `allowedScreens` = `MOBILE_SCREENS.filter(has)`.

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `/credentials` düz PIN döner → G21-K: yalnız yeni verilen değer, basım penceresinde; dar 403 ve okuma izi kalır.
- **KISMI** P2 gizleme (VISIBLE_USER/visibleUserWhere/maskSystemActor/SQL_ACTOR_*, `blockSystemAccountTarget` 404) SİLİNDİ; yetki kısmı (`['*']`, modül kilidi, supap, sır hijyeni) yürürlükte.
- **KISMI** Ayar şifresi yönetim uçları 404 değil 403.
- **KISMI** `.env` süperadmin tohumlaması (readSuperadminEnv, SUPERADMIN_USERNAME/PASSWORD_HASH/PIN/TOTP_SECRET, FORCE_SYNC) kalktı; tek yol `npm run superadmin:kur`.
- **KISMI** "Stüdyo yalnız admin:settings" → `document-template:read/write` açıldı (web), `admin:settings` OR'da supap.
- **KISMI** Etiketler kartı `[station:read, label-template:read]` taşır (hiza sorunu bayat).
- **KISMI** `hasAdminAccess` `matchesPermission` ile ölçer, `*` admin sayılır.
- **KISMI** Admin route'ları `admin:*` değil `admin:settings`/`admin:users` ister.
- **KISMI** Rol kapsama muaf listesi dört kayıt (`mobile:kk1-yari-mamul` dahil).
- **KISMI** "test123" kullanıcıları ÖLÜ; testler `ensureTestAdmin()` kullanır.
- **KISMI** P5'in iki yüklemi tek `isSuperadminGateOpen`a indi.

## Çözülmüş çelişkiler

- Yeni kullanıcı "yetkisiz başlamaz": üç mobil izin + PIN/QR ile doğar; masaüstü izni olmadan panele giremez.
- 2026-09-04 "En yetkili hesap GÖRÜNÜR" yürürlükte; P2 gizlemesi kalktı.

## Açık sorular

- "Admin-only `<ProtectedRoute requirePermission="admin:*">`" cümlesinin geçmişi BELİRSİZ; bugünkü durum koddan kesin.
- `withSettingsPassword` kod yeri ve `canEnterApp` senaryosunun Electron `auth.test.ts`te ölçülüp ölçülmediği doğrulanmadı.

## Doğrulama turu ekleri — 2026-09-05 (ESLint turu)

- **[ÇEKİRDEK]** `/users/:id/credentials` kapısının hedef yüklemi SERVİSTE (`AuthService.isSystemAccountUser`), kapı route'ta; route/controller `lib/prisma`ya inmez. Kapı şeklini değiştirirsen `test_superadmin.ts` ve `test_superadmin_visible.ts` §5'i birlikte güncelle.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı ve ⚠️ bayatlık: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_yetki_denetimi`, `test_parola_kilidi_ip`, `test_giris_kova_ayrimi`, `test_parola_havuzu`, `test_kimlik_pin_rastgele`, `test_kimlik_oturum_tavani`, `test_kimlik_kisa_yol_totp`, `test_kimlik_sir_hijyeni`, `test_web_cerez_oturumu`, `test_guvenilir_cihaz`, `test_barindirma_ikinci_faktor`, `test_patron_giris`, `test_yazilabilir_alan_beyani`, `test_jwt_sir_kapisi`, `test_izin_db_kaynagi`, `test_parola_degisimi_zorunlu`, `test_kisa_kimlik_ozet`, `test_admin_guard_race`, `test_rbac_error_codes`, `test_audit_followups`, `test_card_login`, `test_config_bundle`, `test_data_integrity_gaps`, `test_demo_mode`, `test_denetim_s2_paketi`, `test_depo_roll_cancel_permission` ⚠️, `test_device_activity`, `test_direct_ship_api` ⚠️, `test_document_template_permission`, `test_field_address` ⚠️, `test_finance_documents`, `test_finance_flag_off`, `test_finance_regime_gate`, `test_finance_reports`, `test_global_search`, `test_http_api`, `test_import_framework`, `test_import_permissions`, `test_item_price`, `test_login_access`, `test_login_lockout`, `test_login_lockout_coverage`, `test_login_methods`, `test_master_data_merge`, `test_mobile_item_permission`, `test_mobile_order_permission`, `test_mobile_screen_permissions`, `test_p2_api`, `test_p2_auth`, `test_p2_infra`, `test_permission_catalog`, `test_permission_grant_source`, `test_permission_management`, `test_production_regime_gate`, `test_quickstart_dispatch_api`, `test_role_template_catalog`, `test_roll_edit_unified`, `test_route_auth_coverage`, `test_screen_catalog`, `test_session_duration_minutes`, `test_session_purge`, `test_session_registry`, `test_settings_password`, `test_settings_password_callers`, `test_settings_scopes`, `test_setup_ticaret`, `test_single_warehouse_parity`, `test_superadmin` ⚠️, `test_superadmin_visible`, `test_tambur_manual_produce`, `test_tambur_manual_roll`, `test_timed_permissions`, `test_totp`, `test_user_credentials_guard`, `test_user_default_perms`, `test_user_lifecycle`, `test_work_session`, `test_workorder_documents`, `test_workstation_permission`

İstemci: `PermissionGrid.scope.test.ts` ⚠️, `screen-view.test.ts` ⚠️, `CommandPalette.test.tsx` ⚠️, `command-entries.test.ts` ⚠️, `jwt.test.ts` ⚠️, `secure-token.test.ts` ⚠️, `session-auth.test.ts` ⚠️, `invoiceDetailPermission.test.tsx`, `SettingsPasswordCard.test.tsx` ⚠️, `workstation-rail.test.ts`, `templateRowActions.test.tsx`, `OrderShipmentsCard.test.tsx`, `SackStorePage.test.tsx`, `shipmentDetailError.test.tsx`, `StockCountDetailPage.test.tsx`, `WorkOrderCompleteDialog.test.tsx`, `tile-visibility.test.ts`, `SackTagsPage.test.tsx`, `SystemHubPage.superadmin.test.tsx`, `tile-route-permission.test.ts`, `settings-scope-mirror.test.ts`, `legacy-settings.test.ts`, `apiClient.test.ts`, `auth.logout.test.ts`, `tabs.session.test.tsx`, `login-totp.test.ts`, `TwoFactorTab.masaustu.test.tsx`, `auth.test.ts`, `stationScreens.test.ts`, `useIdleLock.test.ts`, `usePermission.test.ts`, `useVisibleScreens.test.ts`, `flushThenLogout.test.ts`, `sessionSwitch.test.ts`, `authActions.test.ts`, `lockStore.test.ts`, `idleLock.test.ts`, `jwtExpiry.test.ts`, `ResetPasswordTab.test.tsx`, `auth.service.test.ts`

Satır içi ek: `test_superadmin_provision`, `test_guncelleme_durumu`, `test_guncelleme_onay`, `updatesPage.test.tsx`, `rememberedLogin.test.tsx`, `superadmin-gate.test.ts`, `settings-surface.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- [ÇEKİRDEK] `arsiv/2026-11.md`: §2026-11-01 Şifre Sıfırla seçeneği · web 2FA iki katman · güvenilir cihaz · barındırma kanal-bağımsız 2FA · son kullanıcı · giriş kova ayrımı
- [ÇEKİRDEK] `arsiv/2026-10.md`: §2026-10-19 Onaysız tablet yalnız parolayla girer · §2026-10-16 · §2026-10-13 Y1 · §2026-10-12 (Güncellemeler; kimlik dilim 1b/2/3) · §2026-10-10 panel 2FA · §2026-10-06 · §2026-10-01 G20 · §2026-10-01 G21-K
- [ÇEKİRDEK] `arsiv/2026-09.md` (2026-09-03 ayar şifresi P3) · `arsiv/2026-08.md` · `CLAUDE-NOT-ARSIVI.md:287-295` (2026-08-06 yetki denetimi)
