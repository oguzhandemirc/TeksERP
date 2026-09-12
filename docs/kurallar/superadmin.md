# Süperadmin · Ayar şifresi

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 14 üye; 4'ü küme dışı (M2 print-merge, M3 timestamptz, M4 sebep adımı, M5 yarı mamul — başka hakem). Konu çekirdeği 8 not (P2·P3·P5·P8×2·hub·en-yetkili·P6-arşiv). P2 dört yönden ezildi (gizleme→görünür, .env→script, 404→403, Modüller salt-okunur→hiç görünmez); P8 iki dizin satırı + iki arşiv girdisiyle MÜKERRER. En riskli boşluk: kod notun ÖNÜNDE — 686c7212 (2026-09-04 ikinci tur) `/users/:id` altındaki 13 YAZMA ucunu `protectSystemAccountTarget` ile 403'e kapattı, hiçbir notta yok; 2026-09-04 en-yetkili notunun arşivde TAM metni de yok. Çelişki: 'gerçek adıyla görünür' kararı ile provisioning'in hâlâ `fullName="Sistem Bakımı"` yazması (superadmin-olustur.ts:309). Yetki kuralları (`["*"]`, flagWriteGuard supabı, ayar şifresi) kodla birebir ve bekçili.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Süperadmin = `User.isSystemAccount` (additive kolon). Kimlik JWT'ye GİRMEZ: `verifyToken` taze okur → `req.isSystemAccount`; sahte claim 403. Tam yetki `getEffectivePermissions`ın İLK ifadesi `["*"]` — grant satırı doğmaz, süperadmin ROL değil, katalogda `code:"*"` yok. · bekçi: `test_superadmin (§: ["*"] + grant 0 · katalogda * yok · sahte JWT 403) + test_db` <sub>(CLAUDE.md:97, CLAUDE.md:104)</sub>
- **[ÇEKİRDEK]** En yetkili hesap GİZLENMEZ (2026-09-04): kullanıcı listesi (masaüstü+tablet), audit (canlı+arşiv), karneler, cihaz detayı DB'deki adıyla basar; VISIBLE_*/visibleUserWhere/maskSystemActor/SQL_ACTOR_*/blockSystemAccountTarget geri getirilmez; `isSystemAccount` yanıtta kalır → 'Tüm yetkiler' rozeti. · bekçi: `test_superadmin_visible (30 — gizleme geri gelmedi) + test_superadmin §J/HTTP te` <sub>(CLAUDE.md:104)</sub>
- **[ÇEKİRDEK]** GÖRÜNÜRLÜK ≠ KİMLİK TESLİMİ: `GET /users/:id/credentials` (düz PIN) en yetkili hesap için başkasına 403; ayrıca (686c7212) `/users/:id*` altındaki HER YAZMA ucu `protectSystemAccountTarget` ile 403 + audit `SYSTEM_ACCOUNT_WRITE_BLOCKED` — GET serbest, hesabın kendisi muaf. · bekçi: `test_superadmin_visible §5 + :180-200 (tanım · GET serbest · kendisi muaf · 403 ` <sub>(CLAUDE.md:104)</sub>
- **[ÇEKİRDEK]** `flagWriteGuard`: modül dalı EN ÖNDE ve `.some` (belge dalı `.every`, yönler ters), SENKRON, hata `MODULE_FLAG_SUPERADMIN_ONLY`. Supap: sistem hesabı YOKSA `admin:settings` yazar + audit `SUPERADMIN_ABSENT_MODULE_WRITE`; bilinmiyor=VAR (fail-closed); supap dalı tembel DB tazeler (tek async yol). · bekçi: `test_superadmin §A-§D (7 anahtar × 4 senaryo, karma gövde, senkronluk + dal sıra` <sub>(CLAUDE.md:97)</sub>
- **[ÇEKİRDEK]** Süperadmin hesabının TEK doğuş/rotasyon yolu sunucuda elle koşulan `npm run superadmin:kur` (`--rotate`: parola+PIN+TOTP, tokenVersion++). `.env` tohumlaması KALDIRILDI (iki yol = iki sır yüzeyi). Boot job hesap YARATMAZ, `SUPERADMIN_*` OKUMAZ: supap defterini tazeler + yaşam döngüsü audit'i. · bekçi: `test_superadmin_provision (§6 job'da .env yolu geri gelmedi; rotasyon/idempotenc` <sub>(CLAUDE.md:105, CLAUDE.md:107)</sub>
- **[ÇEKİRDEK]** Dev/test girişi `admin` / `123123` — seed YALNIZ admin üretir; 'admin dışı tüm kullanıcılar test123' cümlesi 2026-07-03'te kalkan eski kullanıcılara aittir (sil). Yeni kullanıcı panelden (`POST /api/admin/users`); 0-izinli testler geçici kullanıcı üretir. Bölüme yalnız seed/dev kimlikleri yazılır. <sub>(CLAUDE.md:301)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `isSystemAccount` panelden/API'den ATANAMAZ ve mevcut kullanıcı YÜKSELTİLMEZ: hiçbir Zod şemasına/yazma yoluna girmez; tek yazar `scripts/superadmin-olustur.ts` (`src/` DIŞINDA, sunucu paketine girmez). · bekçi: `test_superadmin_visible ('Alan panelden ATANAMAZ' kolu) + test_superadmin_provis` <sub>(CLAUDE.md:104, CLAUDE.md:105)</sub>
- **[ÇEKİRDEK]** SIR HİJYENİ: süperadmin parolası/PIN/TOTP ve ayar şifresi repoya, log'a, sürüm notuna, audit yüküne GİRMEZ; log satırında sır da kullanıcı adı da yok. `.env`de kalan `SUPERADMIN_*` uyarısı YALNIZ ANAHTAR ADI basar; job tam anahtar literali taşımaz (`Object.keys(process.env)` + ön ek). · bekçi: `test_superadmin_provision §6 (literal/process.env.X deseni yok) + §8 (sentinel u` <sub>(CLAUDE.md:301, CLAUDE.md:97, CLAUDE.md:105)</sub>
- **[ÇEKİRDEK]** Modül profili uygulama için YAZMA UCU YOK: `PATCH /feature-flags` tek kapı (süperadmin guard + ayar şifresi zinciri ikinci kez KURULMAZ — §12.5 kapı çoğaltma yasağı); `GET /api/admin/module-profile` salt okuma, fark SUNUCUDA hesaplanır. · bekçi: `BELİRSİZ — notta adlı bekçi yok` <sub>(arşiv:2134)</sub>

### Kararlar

- **[ÇEKİRDEK]** Süperadmin için kurtarma kodu BİLİNÇLİ YOK (az yüzey > konfor; cihaz kaybı → `--rotate`); giriş kilidi süperadmini de kapsar (muafiyet = parolaya sınırsız deneme). Yeni bir 'kurtarma' yüzeyi açmadan önce P2 arşiv Q2 gerekçesini çürüt. <sub>(CLAUDE.md:97)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Supap defteri `SystemAccountRegistry` (system-account.registry.ts) DB'den beslenir, boot job tazeler; `/auth/me` `systemAccountExists`i guard ile ORTAK yüklem `resolveSystemAccountLock`tan okur (panel↔kapı ayrışmasın); defter TEK YÖNDE tazelenir — hesabı kaldırmak restart ister. · bekçi: `test_superadmin (supap 4 durum, /auth/me tembel doğrulama 138/0)` <sub>(CLAUDE.md:97)</sub>
- **[ÇEKİRDEK]** Ayar şifresi YALNIZ `X-Settings-Password` başlığında; gövde/query/cookie fallback YASAK (ölçülmüş sızıntı: morgan URL'i, USED audit yolu). Karakter kümesi ASCII `^[\x21-\x7E]+$`, 8–72 (başlık non-ASCII taşımaz; bcrypt 72 bayt kırpar); `.trim()` yerine RED; backend↔Electron sabitleri ayna bekçili. · bekçi: `test_settings_password §C (davranış: gövde/query/cookie/benzer başlık → 403) + b` <sub>(CLAUDE.md:98)</sub>
- **[ÇEKİRDEK]** `requireSettingsPassword` ASYNC ve `flagWriteGuard`dan SONRA (izin önce — yetkisiz kilit sayacını dolduramasın; guard senkron). Muaf: süperadmin · belge-only gövde (`.every`) · hash yok → UYUR. Kilit `bcrypt.compare`den ÖNCE (429); başlık yok 403 REQUIRED; yanlış 403 INVALID+audit; doğru USED audit. · bekçi: `test_settings_password (§A-§L)` <sub>(CLAUDE.md:98)</sub>
- **[ÇEKİRDEK]** Kapı audit/hata desenleri: USED audit yolu `${req.baseUrl}${req.path}` (originalUrl query sızdırır, salt path mount'a göreli '/'); LOCKED olayı kilit BAŞINA tek satır (`justLocked`, login hizalı); `Retry-After` tek noktadan (error middleware); oturum jti ↔ userId bağı, uymazsa 401 SESSION_INVALID. · bekçi: `test_settings_password (harness Express mount'unu modelliyor; 'ne YAZILMALI' kon` <sub>(CLAUDE.md:98)</sub>
- **[ÇEKİRDEK]** Kurulum script'i İDEMPOTENT: hesap varsa DOKUNMAZ. Saf `provisionSuperadmin(input, deps)` HİÇBİR ŞEY YAZDIRMAZ — sırlar yalnız DÖNÜŞ değerinde, basma interaktif katmanın işi. `SUPERADMIN_PROVISIONED/ROTATED` audit çağrısı BİLEREK `src/` altında (`test_audit_labels` §3 yalnız src tarar). · bekçi: `test_superadmin_provision (stdout 0 bayt · rotasyonYok) + test_audit_labels §3` <sub>(CLAUDE.md:105, CLAUDE.md:107)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Ayar şifresi hash'i `security.settingsPasswordHash`; `systemSettingService.set()` ile YAZILMAZ (audit oldData/newData HAM) — doğrudan upsert + ayrı olay. `security.*` ön eki ayar listesi ve `config-bundle`dan dışlanır, `PUT /admin/settings/:key` reddeder; `settingsPasswordRequired` bayrak değil. · bekçi: `test_settings_password (§A-§L; system_logs+arşiv+erişim logu+config-bundle'da şi` <sub>(CLAUDE.md:98)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Ayar şifresi kilit kovası GİRİŞ kovasından AYRI ve ayrım KEY'de (`sp:` ön eki, `resolveSettingsLockoutKeys`): `resolveLoginLockoutKeys` varsayılan `ip` kapsamında kimliği DÜŞÜRÜR — 5 yanlış ayar şifresi tüm IP'nin LOGIN'ini kilitliyordu. Aynı şalter `auth.pinLockoutEnabled`, ayrı SAYAÇ. · bekçi: `test_settings_password (ayar 429 iken login 200 ölçümü)` <sub>(CLAUDE.md:98)</sub>
- **[ÇEKİRDEK]** TTY KAPISI FAIL-LOUD: `interaktif()` `--help` dalından hemen SONRA `process.stdin.isTTY` yoksa `TTY_GEREKLI_MESAJI` + exit 1. `readline` TTY'siz girdide ilk sorudan sonra SESSİZCE SONSUZA KADAR bekler (ölçüldü 120 sn, DB'ye satır yok) — `ssh` (-t'siz)/`docker exec`/pm2/CI kurulumu hesapsız kalırdı. · bekçi: `test_superadmin_provision §7 (zaman aşımlı non-TTY sondası — kapı düşerse DONMAZ` <sub>(CLAUDE.md:105, CLAUDE.md:107)</sub>

### Kararlar

- **[ÇEKİRDEK]** Süperadmine özel uçlarda 404 değil 403 (varlık açık; 404 yanlış bilgi). `requireSystemAccountOr404` gövdesi forbidden döner — adı bayat, davranışa değil ada güvenme. · bekçi: `test_settings_password (:428 'fabrika admini → 403')` <sub>(CLAUDE.md:104, CLAUDE.md:98)</sub>

## Panel (Electron)


### Değişmezler

- **[ÇEKİRDEK]** Electron satıcı kapısı TEK YÜKLEM `isSuperadminGateOpen` = isSystemAccount || !systemAccountExists (`lib/superadmin-gate.ts`); karo (`superadminOnly`), route (`requireSystemAccount`), palet, FeatureFlagSection, ModuleProfilePage ondan İTHAL eder. Supapsız `isSystemAccountIdentity` geri gelmez. · bekçi: `superadmin-gate.test.ts (tüketiciler bu dosyadan ithal) + SystemHubPage.superadm` <sub>(CLAUDE.md:99, CLAUDE.md:102)</sub>
- **[ÇEKİRDEK]** Ayar kategorisinde modül bağı = `moduleKey` (KİLİT, `superadminOnly` ikizi); `regime` modül anahtarlarına açılmaz (§14). Kilit İSTEMCİ-TARAFLI: bant 'dondu' der, 'etkisiz' DEMEZ (§3.6 resolver yok). Fabrika görünümünde kapalı modülün satırı çizilmez; satıcıda satır + bant. · bekçi: `flag-modules.test.ts (12) + SettingsSurfacePage.modules.test.tsx (3) + regime §1` <sub>(CLAUDE.md:102)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Karo döngüsü DIŞINDAKİ palet girdileri (`ops:work-order-new`, `def:station-capabilities`) modül/süperadmin kapısını ELLE taşır (karosuz ekranda palet tek keşif yolu). 'Kapatırsan gizlenir' önizlemesi masaüstü/tableti AYRI sayar; manifesto okunamazsa liste ÇİZİLMEZ. · bekçi: `BELİRSİZ — notta bu üç kural için adlı bekçi yok (karo↔route için tile-route-per` <sub>(CLAUDE.md:102)</sub>
- **[ÇEKİRDEK]** Electron `withSettingsPassword` sarmalayıcısı: istek önce şifresiz gider; 403 REQUIRED/INVALID → `SettingsPasswordDialog` (App'te bir kez mount) → başlıkla tekrar; LOCKED kalan süre. Her kayıtta sorulur, oturumda HATIRLANMAZ; şifre state'te yalnız diyalog açıkken, log/toast/localStorage'a girmez. · bekçi: `yok (backend↔Electron ayna bekçisi yalnız sabitleri kıyaslar)` <sub>(CLAUDE.md:98)</sub>

### Kararlar

- **[PROFİL]** Sistem → Modüller (`/system/module-profile`, path değişmez) satıcı ekranı: hesap DOĞMUŞSA fabrika yöneticisi sayfayı HİÇ açamaz, hesap yoksa açar ve yazar; salt-okunur bant teorik dal, bilerek duruyor. Demo kartı `superadminOnly` ALMAZ (guard yalnız MODULE_FLAG_KEYS). · bekçi: `SystemHubPage.superadmin.test.tsx + settings-surface.test.ts (19)` <sub>(CLAUDE.md:99)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-09-03__2026-09-03-superadmin-p2-satici` → `R:2026-09-04__2026-09-04-en-yetkili-hesap`: P2'nin GİZLEME yarısı geri alındı: kullanıcı listesi/audit/karne/cihaz süzgeçleri (VISIBLE_*, visibleUserWhere, maskSystemActor, SQL_ACTOR_*), 'Sistem Bakımı' maskesi ve `/users/:id` 404 önek kapısı silindi; yerine yalnız `credentials` ucunda dar 403. Yetki yarısı (`["*"]`, modül kilidi, ayar şifresi muafiyeti) yürürlükte. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-superadmin-p2-satici` → `R:2026-09-03__2026-09-03-superadmin-dogusu-p8`: Hesabın doğuşu `.env` tohumlaması (readSuperadminEnv, SUPERADMIN_FORCE_SYNC rotasyonu, Q2 'TOTP .env'den') kaldırıldı; tek yol `npm run superadmin:kur` (`--rotate`). Boot job hesap yaratmaz/rotasyonlamaz. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-superadmin-p2-satici` → `R:2026-09-04__2026-09-04-profil-sistem-hub`: P2 Q5 'Modüller sekmesi fabrika adminine GÖRÜNÜR ama SALT-OKUNUR + bant' öldü: a25ec234 (2026-09-03) satıcı ekranını hesap doğmuşsa fabrikaya kapattı; hub notu görünürlüğü de supaplı tek yükleme (`isSuperadminGateOpen`) indirdi. Hesap varsa fabrika sayfayı HİÇ açamaz; salt-okunur bant teorik dal. ✅ çürütmeden geçti
- **TAM** `commit a25ec234 (2026-09-03, dizin notu YOK: 'Sistem Profili HER ZAMAN satıcıya özel', supapsız isSystemAccountIdentity)` → `R:2026-09-04__2026-09-04-profil-sistem-hub`: Supapsız görünürlük yüklemi `isSystemAccountIdentity` kaldırıldı; karo·route·palet·FeatureFlagSection supaplı `isSuperadminGateOpen`'dan beslenir (ikinci yazma yolu kalkınca kilitlenme üretiyordu). ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-ayar-sifresi-p3` → `R:2026-09-04__2026-09-04-en-yetkili-hesap`: Ayar şifresi yönetim uçları (`PUT/DELETE /admin/settings-password`) süperadmin dışına 404 değil 403 döner; fonksiyon adı `requireSystemAccountOr404` bayat kaldı. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-03__2026-09-03-panel-modul-kapilari` → `R:2026-09-04__2026-09-04-cekirdek-kapali-modulun (küme: modul-bayraklari-profiller)`: P5 'modül = KİLİT, gizleme DEĞİL' kısmen ters çevrildi: fabrika görünümünde kapalı modülün satırları HİÇ çizilmez (satırdan türer, `isCategoryModuleVisible`); kilit bandı KALDI, izleyicisi satıcı (supap dahil). ✅ çürütmeden geçti
- **KISMI** `R:undated__test-kullanicilari` → `R:2026-09-03__2026-09-03-superadmin-dogusu-p8`: 'Süperadmin parolası/PIN'i … dağıtım yalnız `.env` + parola yöneticisiyle olur' cümlesi bayat: `.env` yolu kaldırıldı, sır yalnız script'in süreç belleğinde ve terminalde bir kez basılır; `.env`de kalan `SUPERADMIN_*` için boot uyarısı. ✅ çürütmeden geçti
- **KISMI** `R:2026-09-04__2026-09-04-en-yetkili-hesap` → `commit 686c7212 (2026-09-04 ikinci tur, NOT YOK: 'en yetkili hesap YAZMAYA KAPALI')`: Not 'önek yalnız verifyToken+requireAnyPermission, dar 403 yalnız credentials' der; kod öneke `protectSystemAccountTarget` ekledi: sistem hesabını hedefleyen `/users/:id*` YAZMA istekleri (parola/PIN/kart/TOTP sıfırlama, pasifleştirme, silme) 403 + audit `SYSTEM_ACCOUNT_WRITE_BLOCKED`; GET serbest, kendisi muaf. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:2026-09-04__2026-09-04-en-yetkili-hesap` ↔ `R:2026-09-03__2026-09-03-superadmin-p2-satici`: Kod: MASKE silindi (yüzeyler DB'deki fullName'i basar), ama doğuşta yazılan fullName hâlâ takma ad 'Sistem Bakımı'. Yani 'gerçek adıyla görünür' ancak ad panelden düzenlenirse doğru. Script'in gerçek adı sorması/kaydetmesi kullanıcı kararı → unresolved.
- `R:2026-09-03__2026-09-03-panel-modul-kapilari` ↔ `R:2026-09-04__2026-09-04-cekirdek-kapali-modulun (küme dışı üye)`: Kod bugünkü kararı uyguluyor: fabrika görünümünde satır bazlı gizleme, satıcı görünümünde (supap dahil) satır + kilit bandı. P5 dizin satırının 'gizleme DEĞİL' yarısı bayat; `regime` alanını modül anahtarlarına açmama kuralı (§14) ve 'bant etkisiz DEMEZ' yürürlükte.
- `R:undated__test-kullanicilari` ↔ `R:2026-09-03__2026-09-03-superadmin-dogusu-p8__2`: Kod P8'i uyguluyor: `.env` sır taşımaz; CLAUDE.md:307'deki '.env + parola yöneticisi' ifadesi 'sunucuda `npm run superadmin:kur` + parola yöneticisi' olmalı.

## Açık sorular

- Provisioning hâlâ `fullName = "Sistem Bakımı"` yazar (superadmin-olustur.ts:307-309, yorum 'gerçek ad hiçbir zaman DB'ye girmez') — 2026-09-04 'gerçek adıyla görünür' kararıyla çelişir; script gerçek adı sormalı mı? Kullanıcı kararı.
- commit 686c7212 (2026-09-04, 'en yetkili hesap YAZMAYA KAPALI', `protectSystemAccountTarget`) hiçbir CLAUDE.md/arşiv notunda yok; 2026-09-04 en-yetkili notunun arşivde TAM metni de yok (kural: yeni not arşive) — ikisi de yazılmalı.
- P8 mükerrer: iki dizin satırı (CLAUDE.md:105 ve :107) + iki arşiv girdisi (CLAUDE-NOT-ARSIVI.md:2159 ve :2204) — tek satır + tek arşiv girdisine indirilmeli.
- Bayat kod yorumları: system-account.middleware.ts:1-30 başlığı hâlâ '404, 403 DEĞİL / hiçbir yüzeyde görünmemeli'; superadmin.job.ts:4-8 'fabrikanın hiçbir yüzeyinde görünmemeli'; `requireSystemAccountOr404` adı 403 dönen gövdeyle uyumsuz — temizlik/yeniden adlandırma önerisi.
- P2 AÇIK maddeleri ölçülmedi: 'giriş yöntemlerinde PIN kapalıysa satıcı tablete giremez' bandı (P5'e ertelenmişti) ve audit dropdown önbellek gecikmesi — kod durumu bu turda doğrulanmadı.
- P6 (M11) 'profil uygulama yazma ucu yok' kuralı ve P5'in palet/manifesto kuralları için adlı mekanik bekçi bulunamadı (BELİRSİZ).
- Küme dışı üyeler — bu hakem karar vermedi: E:undated__tek-belge-verilirse-html-aynen-doner (print-merge), B:2026-08-01__sema-tip-konvansiyonu-o-11-2026 (timestamptz), R:2026-08-26__2026-08-26-aksam-sebep-adimi, R:2026-08-26__2026-08-26-yari-mamul-kendi.
- E:undated__rbac'ın süperadmin dışı kuralları (canEnterApp, document-template izinleri, visibleSettingsCategories) C2-yetki-izin-rol kümesine aittir; burada yalnız `*` körlüğü/hasAdminAccess alındı.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_db_invariants`, `test_settings_password`, `test_superadmin`⚠️, `test_superadmin_provision`, `test_superadmin_visible`, `test_user_credentials_guard`

İstemci: `SettingsPasswordDialog.test.tsx`⚠️, `superadmin-gate.test.ts`⚠️, `FeatureFlagSection.superadmin.test.tsx`, `SettingsPasswordCard.test.tsx`⚠️, `settings-surface.test.ts`, `ModuleProfilePage.test.tsx`⚠️, `SystemHubPage.superadmin.test.tsx`, `login-totp.test.ts`, `auth.test.ts`, `usePermission.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-09-03 · 2026-09-03 — Süperadmin P2: gizli GERÇEK satır, `["*"]` tam yetki, tek-kaynak gizleme süzgeci, kilitlenme supa — `CLAUDE-NOT-ARSIVI.md:2057-2095`
- 2026-09-03 · 2026-09-03 — Ayar şifresi P3: ikinci kapı BAŞLIKTA, hash `set()` dışında, kilit kovası girişten AYRI, kapsam " — `CLAUDE-NOT-ARSIVI.md:2096-2115`
- 2026-09-03 · 2026-09-03 — Panel modül kapıları + Sistem Profili (P5): kilit GİZLEME DEĞİLDİR — `CLAUDE-NOT-ARSIVI.md:2145-2158`
- 2026-09-03 · 2026-09-03 — Tamlık bekçisi + kurulum profilleri (P6): profil dosyası pakete HİÇ GİRMİYORDU — `CLAUDE-NOT-ARSIVI.md:2134-2144`