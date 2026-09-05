# K5 — Yetki Kapıları Haritası (kimlik · RBAC · cihaz · anahtar-kapsamlı guard'lar · servis-katmanı izinleri · raw SQL)

Aşama ① KEŞİF — **yargı yok, bulgu yok; yalnız mekanizma + istisna + hotspot.** Yollar repo köküne göre (`Teks-Erp/src/...`); satır numaraları HEAD `ce8681d1` (dal `adnansahin`, 2026-08-28) üzerinden **bu turda yeniden okundu**. Prod ölçümleri `audit/tools/sql-saha.sh` (2026-08-25 kopyası `tekserp_saha_0825`, 190/195 migration) ile salt-okunur alındı; kullanıcı adları maskeli (`xx***`), sır/kişisel veri kopyalanmadı. Rota-bazlı tam envanter **K1'in işidir**; burada mekanizma, istisna sınıfları ve sayımlar verilir. Sayımlar scratchpad tarayıcısı `route-scan.mjs` (parantez-dengeli `<router>.<get|post|…>(` blok tarayıcı; `src/routes/**` + `src/app.ts`) ile yapıldı: **580 route tanımı · 14 kimliksiz · 11 çıplak zincir** (bkz. §1.2-1.3).

Önceki koşumun (02:31) dosyası kontrol listesi olarak kullanıldı; her satırı güncel koddan yeniden türetildi, **üç boşluğu kapatıldı** (arama `resolveExact` okundu → §4 #8 ve H9; prod cihaz–makine atfı ölçüldü → §6; `INVOICE_WRITE` OR kümesi → §8.3).

---

## 0. Tek sayfa özet

| Katman | Mekanizma | Tek kaynak | Fail modu / not |
|---|---|---|---|
| Global zincir | `helmet → cors(*) → compression → morgan → latency → json(1mb) → [swagger yalnız dev] → static(public/) → resolveDevice → requestContext(ALS) → GET /health → 47 mount → JSON 404 → errorHandler` | `src/app.ts:102-608` | **Global `verifyToken` YOK** — kimlik route SATIRINA takılır; mount'larda guard yok (tek istisna `app.ts:562-569` `/api/admin/health`) |
| Kimlik | Bearer JWT (HS256 sabit) + her istekte DB'den `User.tokenVersion/isActive` + `Session(jti).revokedAt` | `middlewares/auth.middleware.ts:55-110` | Fail-closed: jti'siz token 401 (`:85-87`), oturum kaydı yok 401 (`:92-96`), iptal 401 (`:97-102`) |
| Yetki | `req.user.permissions` (**JWT payload'ından**, DB'den değil) ↔ `matchesPermission` (tam eşleşme · `<alan>:*` · `*`) | `middlewares/rbac.middleware.ts:35-47` | `requirePermission(undefined)` → `:41` **TypeError → 500** (403 değil); `requireAnyPermission()` boş → **403** (`:80-89`) |
| Cihaz | `x-device-id` → APPROVED+aktif `Device` → `req.device`; başlık yoksa hiç bakılmaz | `middlewares/device.middleware.ts:33-105` | `device.pairingRequired=false` (**prod değeri**) iken hiçbir istek bloklanmaz (`:73`, `:90`) |
| Servis katmanı (F221) | `permissions` verilirse enforce, verilmezse ATLANIR (5 servis) | §5 | HTTP'den ulaşan her yol geçiriyor; tek bilinçli muafiyet planlamacı dalı (`workorder-link.service.ts:774-780`) |
| Anahtar-kapsamlı | 8 dinamik kapı + 3 controller-içi dallanma | §4 | 7'si fail-closed; **`STATION_KIND_PERM` eksik anahtarda fail-OPEN** (`work-session.service.ts:205-206, 245-246`); **arama `exact` çözümü izin süzgeçsiz** (`search.service.ts:146-208`) |
| Katalog | 70 izin kodu koddan DB'ye boot'ta uzlaştırılır — yalnız EKLER, ATAMAZ | `constants/permission-catalog.ts:47-190`, `jobs/permission-catalog.job.ts:67-131` | Prod: DB 70 = katalog 70, katalog dışı 0, global `*` yok |
| Roller | 26 şablon koddan (`ADMIN_FULL` + 8 web + 17 mobil) | `constants/role-template-catalog.ts:366-376` | Prod: 26/26 kodlu ve aktif |
| Raw SQL | 19 `$queryRawUnsafe/$executeRawUnsafe` (3 dosya) + 5 `Prisma.raw` | §10 | Tanımlayıcılar DMMF/sabit harita; kullanıcı girdisi yalnız `$n` parametre |

---

## 1. Global zincir ve kimliksiz yüzeyler

### 1.1 `app.ts` middleware sırası

| Sıra | Middleware | Satır | Not |
|---|---|---|---|
| 1 | `helmet({ contentSecurityPolicy:{useDefaults, upgradeInsecureRequests:null}, strictTransportSecurity:false })` | `app.ts:102-110` | HTTP-only LAN (yorum `:96-101`); HSTS kapalı; CSP varsayılan |
| 2 | `cors({ exposedHeaders:[...] })` | `app.ts:114` | `origin` verilmemiş → `Access-Control-Allow-Origin: *`, credentials yok; kimlik bearer başlıkta (cookie yok) |
| 3-5 | `compression` · `morgan(isProd?"combined":"dev")` · `latencyMiddleware` | `app.ts:117, 121, 128` | `isProd = (APP_ENV ?? NODE_ENV)==="production"` (`:120`) |
| 6 | `express.json({limit:"1mb"})` | `app.ts:141` | `import.routes.ts:28` ve `config-bundle.routes.ts:27` kendi 10 MB `express.json`'ını route'ta taşır |
| 7 | `setupSwagger(app)` | `app.ts:146` → `config/swagger.ts:66-71` | **`NODE_ENV==="production"` ise `/api-docs` mount EDİLMEZ** (`swagger.ts:69`); prod pm2 env `NODE_ENV=production, APP_ENV=production` (`ecosystem.config.js:75-77`). ⚠️ Swagger yalnız `NODE_ENV`, morgan `APP_ENV ?? NODE_ENV` okur — iki bayrak (bugün ikisi de set) |
| 8 | `express.static(process.cwd()+"/public")` | `app.ts:157-158` | Dizin ölçüldü: **3 dosya** — `index.html` 4.4 KB · `logo.png` 436 KB · `status.js` 6.3 KB (kimliksiz durum sayfası; `status.js` `/health`'i çağırır) |
| 9 | `resolveDevice` | `app.ts:169` | §6 |
| 10 | `runWithRequestContext` (AsyncLocalStorage; audit "nereden") | `app.ts:175` → `lib/request-context.ts:58-75` | `req` NESNESİ saklanır; `currentOrigin()` `req.ip / req.device.deviceId / machineId / req.user.userId / requestId` |
| 11 | `GET /health` PUBLIC (5 alan, canlılık) | `app.ts:479-495` | Zengin sürüm `GET /api/admin/health` = `verifyToken + requirePermission("admin:settings")` (`app.ts:562-569`) |
| 12 | 47 router mount'u | `app.ts:500-587` | Hiçbirinde mount-seviyesi guard yok; `db-copies` (`:557`) ve `/api/admin/health` (`:562`) `adminRoutes`'tan ÖNCE (prefix eşleşme sırası) |
| 13 | JSON 404 (`/api/*`) + `errorHandler` | `app.ts:598-608` | `AppError` → `statusCode` + `details` istemciye (`error.middleware.ts:270-277`); bilinmeyen hata → `500 "Sunucu hatası oluştu."` (`:630-633`) |

`app.listen(PORT, HOST="0.0.0.0")` (`server.ts:17-20, 79`). **`trust proxy` ayarlanmamış** (grep 0; `auth.controller.ts:109` bilinçli — `req.ip` = soket IP). Boot sırası: `assertBaseServiceGuards()` (`server.ts:39`, mass-assignment süzgeci fail-closed) → `startPermissionCatalogReconciler()` (`server.ts:12`; §8).

### 1.2 Kimliksiz uçlar (bloğunda `verifyToken` / `...guard` yok) — tarama: 580 tanımın **14**'ü

Hepsi bekçi `scripts/test_route_auth_coverage.ts` `EXEMPT` tablosunda gerekçeli (`:34-75`; anahtar mount öneksiz `METOD /yol`).

| Uç | Dosya:satır | Gerekçe (koddan) | Ek kapı |
|---|---|---|---|
| `POST /api/auth/login` · `/login-card` · `/login-quick-pin` | `routes/auth.routes.ts:13-15` | token üreten uç | `reserveLoginAttempt` (§3.3) her üçünde (`auth.controller.ts:118-128, 202-213, 281-292`) |
| `GET /api/auth/login-methods` | `auth.routes.ts:16` → `auth.controller.ts:342-350` | login ekranı okur | `readLoginMethods()` + `companyName` döner |
| `GET /api/auth/mobile-users` | `auth.routes.ts:17` → `auth.controller.ts:375-397` | mobil login kullanıcı listesi | **yalnız `pairingRequired=true` iken** `req.device` ister (`:379-386`); prod'da bayrak `false` → kimliksiz istemci `mobile:*` izinli aktif kullanıcıların `id+username+fullName`'ini alır (`auth.service.ts:405-430`, `take:500`) |
| `GET /api/client-policy` · `/:istemci` | `routes/client-policy.routes.ts:59, 83` | panel giriş öncesi sürüm politikası | kod sabiti |
| `POST /api/devices/announce` · `GET /status` · `GET /pairing-required` | `routes/device.routes.ts:26, 37, 49` | cihaz el sıkışması | `announce` Zod `deviceId` 8-80 karakter (`device.controller.ts:14-18`), PENDING tavanı 200 (`device.service.ts:22, 179-185`); var olan cihazda yalnız `lastSeenAt` yazar, `kind`'ı yalnız PENDING'de günceller (`:191-203`); `status` **herhangi bir `deviceId` için** makine/istasyon atfını döner, bilinmiyorsa `UNKNOWN` (`device.service.ts:209-213`, `device.controller.ts:69-77`) |
| `GET /api/discovery/identity` | `routes/discovery.routes.ts:34` | servis keşfi, DB'siz | — |
| `GET /api/mobile/updates/ota/:runtimeVersion/manifest` · `GET /api/mobile/updates/{*yol}` | `routes/mobile-update.routes.ts:44, 69` | tablet giriş öncesi OTA | yol `dosyaBilgi()` ile depoya kilitli (bekçi `test_mobile_update.ts §6`); depo `MOBILE_UPDATE_ROOT` `app\` dışında (`config/mobile-update.ts:32-33`) |
| `GET /health` | `app.ts:479` | canlılık | — |

### 1.3 Kimlik VAR, route satırında izin guard'ı YOK ("çıplak zincir") — tarama: **11**

Bekçi tabanı `BARE_CHAIN_BASELINE = 12` (`test_route_auth_coverage.ts:114`) — bekçi `import.routes.ts:309` `GET /:entity/export`'u da sayar (özel `requireEntityRead` taşıdığı için burada çıplak sayılmadı, `:312`).

| Uç | Satır | Niyet | Ne döner / yazar |
|---|---|---|---|
| `GET /api/auth/me` · `POST /logout` | `auth.routes.ts:22-23` | self-servis | `me` → `permissions` **JWT'den** (`auth.controller.ts:437`); `logout` → kendi `jti`'sini iptal (`:465`) |
| `GET/PUT /api/auth/preferences` | `auth.routes.ts:26-27` | self-servis (§7.1) | yalnız `req.user.userId` (`user-preference.controller.ts:40, 72`) |
| `GET /api/currencies` | `currency.routes.ts:30` | sabit liste | — |
| `GET /api/document-profiles` · `/:id` | `document-profile.routes.ts:37, 53` | profil okuma | yazma tarafı `DOCUMENT_DESIGN_WRITE` (`:73-76, 95-98, 117-120`) |
| `GET /api/feature-flags` | `feature-flag.routes.ts:391-402` | "auth-only, tüm kullanıcılar" (`:4-5`) | `getFeatureFlags()` **54 anahtar** (`system-setting.service.ts:1170-1235`): `loginMethods`, `pinLockout*`, `sameTypeSessionPolicy`, `absoluteSessionCapDays`, `backupHour`, `devicePairingRequired`, `companyLetterhead` (`taxInfo` dahil, `:751`)… — mobil-only operatör dahil her kimlikli kullanıcıya |
| `GET /api/feature-flags/documents-logo` | `feature-flag.routes.ts:462` | logo okuma | base64; `PUT` tarafı `admin:settings` (`:503-506`) |
| `GET /api/reason-presets` | `reason-preset.routes.ts:73` | katalog okuma | yazma `canEdit` (`:33`) |
| `GET /api/search` | `search.routes.ts:46` | süzgeç serviste, kova bazında (`:4-8`) | §4 #8 — **`exact` çözümü süzgeçsiz** |

---

## 2. Kimlik doğrulama mekanizması

### 2.1 `verifyToken` — `middlewares/auth.middleware.ts:55-110`

| Adım | Satır | Davranış |
|---|---|---|
| Başlık | `:65-70` | `/^Bearer\s+(.+)$/i` (RFC 6750 case-insensitive); yoksa 401 |
| İmza/expiry | `:73` → `services/auth.service.ts:385-392` | `jwt.verify(token, JWT_SECRET, { algorithms:["HS256"] })`; `issuer/audience/clockTolerance` YOK; her hata → 401 "Geçersiz veya süresi dolmuş token" |
| Kullanıcı tazeliği | `:74-83` | `User{tokenVersion,isActive}` DB'den; pasif/yok → 401; `tokenVersion≠` → 401 |
| jti | `:85-87` | jti'siz token → 401 (fail-closed) |
| Oturum | `:88-102` | `Session(jti)` DB'den; yok → 401 `SESSION_INVALID`; `revokedAt≠null` → 401 `SESSION_REVOKED` + sebep mesajı (`:21-27`) |
| Bağlam | `:103-105` | `req.user = payload` (**izinler JWT'den**), `touchUser` (presence Map, `lib/presence.ts:16-23`), `touchSessionLastSeen` (60 sn throttle, fire-and-forget `updateMany`, `:16-43`) |

- Her kimlikli istek **2 DB okuması** (`user.findUnique` + `session.findUnique`).
- **`Session.expiresAt` middleware'de OKUNMAZ** — süre yalnız JWT `exp`'ine bağlı; `exp` yoksa token süresizdir (§2.2).
- `JwtPayload = { userId, username, permissions[], tokenVersion, jti }` (`types/api.types.ts:47-59`); `req.user`/`req.device` tipleri `types/express-augment.ts:12-30`.

### 2.2 Token üretimi — `AuthService.issueToken` (`services/auth.service.ts:253-380`)

| Konu | Satır | Davranış |
|---|---|---|
| Secret | `:35-45` | `process.env.JWT_SECRET`, <32 karakter → modül yüklenirken throw; `.env` `server.ts:1` `dotenv/config` ile (`ecosystem.config.js:22-23` "JWT_SECRET `.env`'de kalır") |
| Payload | `:361-367, 378` | `{userId, username, permissions, tokenVersion}` + `jwtid=jti` (`randomUUID`, `:291`) |
| İzinler | `:261` → `:450-465` | `UserPermission` `validFrom/validUntil` penceresiyle; **JWT'ye kopyalanır** → izin değişikliği ancak `tokenVersion` bump'ıyla yansır (§2.5) |
| Masaüstü kapısı | `:266-273` | `ctx.clientType==="electron"` ve hiç `mobile:` dışı izin yoksa 403, token üretilmez. `clientType` **gövdeden** (`auth.controller.ts:24-44`, yoksa `mobile`) — sunucu istemci türünü doğrulamaz |
| Süre | `:283-305` | `auth.autoLogoutOnExpiry=true` (kod varsayılanı `DEFAULT_AUTO_LOGOUT_ON_EXPIRY=true`, `system-setting.service.ts:385`) → `sessionDurationMinutes` (default 480, tavan 43200; `:366, 368`, okuyucu `:2961-2985`); `false` + `absoluteSessionCapDays>0` (default 30, tavan 365; `:396-397`, okuyucu `:3119-3131`) → cap gün; `false` + cap=0 → **`exp` claim YOK**, `Session.expiresAt=9999-12-31` |
| Süreli izin kırpması | `:317-339` | en yakın gelecek `validUntil` / henüz başlamamış `validFrom` → `exp` o tarihe çekilir |
| Oturum kaydı | `:344-357` | `SessionRegistryService.openLoginSession` — token imzalanmadan ÖNCE; politika `readSameTypeSessionPolicy` (default `"kick"`, `:383, 3031-3044`) |
| **Prod değerleri** | `system_settings` (kopya) | `auth.autoLogoutOnExpiry=false` · `auth.absoluteSessionCapDays=30` · `auth.sessionDurationMinutes=480` (etkisiz) · `auth.sameTypeSessionPolicy="off"` · `auth.idleTimeoutMinutes=0` · `auth.mobileIdleLockEnabled=false` · `auth.loginMethods={enabled:[list,pin], primary:pin}` → **her token 30 gün geçerli, aynı tipte sınırsız paralel oturum, idle kilit yok** |

### 2.3 Şifre / kart / PIN

| Yol | Satır | Kimlik kaynağı | Saklama |
|---|---|---|---|
| Şifre | `auth.service.ts:53-82` | `username` (`@unique`, `schema.prisma:355`) + `bcrypt.compare` (bcryptjs, maliyet 10 `:398`; admin reset `permission-management.service.ts:423`) | hash |
| QR kart | `:90-110` | `TEKSU:<userId>:<32-hex>` (`:33`); `User.cardToken` **düz** (`schema.prisma:362-366`); yalnız `loginMethods` "card" içerirken (`:94-99`) | düz |
| Hızlı PIN | `:117-137` | 6 hane, **sistem genelinde unique** (`schema.prisma:371`), kullanıcı adı YOK — PIN tek başına kimlik; yalnız "pin" etkinken (`:121-126`) | düz |
| Kimlik geri okuma | `:235-247` → `admin.routes.ts:521-524` | `GET /api/admin/users/:id/credentials` PIN + kart kodu düz döner; guard `admin:users` | — |
| Rotasyon | `:145-227` | `setQuickPin` / `rotateCardToken` — **`tokenVersion` bump YOK** (bilinçli, `:205-206`) | — |
| Prod | kopya | 9 kullanıcı (8 aktif), **8/9 `quickPin` dolu, `cardToken` 0**; `loginMethods.primary="pin"` → sahadaki birincil giriş 6 haneli PIN |

### 2.4 Oturum kaydı — `services/session-registry.service.ts`

| Konu | Satır |
|---|---|
| Advisory lock `(8024, hashtext(userId|deviceType))` — **tx İÇİNDE (`:72`) ve `findFirst`'ten (`:84`) ÖNCE (`:79`)** | `:32, 72-79` |
| `notify` + onaysız → 409 `SESSION_EXISTS` | `:83-105` |
| `kick` → aynı tip aktifler `updateMany` revoke | `:109-114` |
| `off` → hiçbir şey düşürülmez (**prod bu modda**) | `:107-108` |
| Tekil iptal / kullanıcı-geneli iptal (idempotent `updateMany`) | `:123-145` |
| `purgeDeadSessions` — fiziksel DELETE, yalnız `revokedAt<cutoff OR expiresAt<cutoff`; uç `POST /api/admin/sessions/purge` `admin:settings` | `:168-176`; `admin.routes.ts:825-828` |
| Prod ölçümü | `sessions` **214** satır (MOBILE 115 / ELECTRON 99), **121 aktif** (95 / 26), uzak-gelecek 0; `createdAt` 2026-07-16 … 2026-08-25 |

### 2.5 İptal noktaları (`tokenVersion++` / `Session.revoke`) — `services/permission-management.service.ts`

| Olay | Satır | tokenVersion | Session revoke |
|---|---|---|---|
| `grantPermission` (satır yeni ya da tarih değiştiyse) | `:190-221` | koşullu ++ (aynı tx, `:217-219`) | — |
| `setUserPermissions` (ekle/sil/tarih) | `:304-336` | koşullu ++ (aynı tx, `:333-335`) | — |
| `revokePermission` | `:377-395` | ++ (aynı tx, `:394`) | — |
| `applyTemplate` `replace` → `setUserPermissions`; `merge` → `createMany` + ++ (batch tx) | `:995-996, 1011-1021` | ++ | — |
| `resetUserPassword` | `:425-433` | ++ | `PASSWORD_RESET` (best-effort) |
| `deactivateUser` | `:686-698` | ++ (lock altı tx) | `DEACTIVATED` |
| `deleteUser` | `:747-765` | ++ | `DELETED`; `username → del_<hex>_…`, PIN/kart temizlenir (`:744, 756-757`) |
| `logout` | `auth.controller.ts:465` | — | `LOGOUT` (kendi jti) |
| Kart/PIN rotasyonu | `auth.service.ts:145-227` | **YOK** | — |

---

## 3. Yetki kararı (RBAC) ve giriş kilidi

### 3.1 `matchesPermission` — `middlewares/rbac.middleware.ts:35-47`

```
39: if (userPermissions.includes("*")) return true;          // global joker
40: if (userPermissions.includes(required)) return true;      // tam eşleşme
41: const colon = required.indexOf(":");                      // İLK iki nokta
43:   `${required.slice(0, colon)}:*`                         // alan jokeri
```
- Alan jokeri çok kolonlu kodları da kapsar (yorum `:19-33`); bugün 70 kodun tamamı tek kolonlu — bekçi `scripts/test_permission_catalog.ts:341-357` ölçer.
- `"*"` kodu **katalogda ve prod DB'de YOK** (DB'de joker yalnız `admin:*`, `mobile:*`) → `:39` fiilen ölü.
- `admin:*` kategorisi `admin` olan 3 kodu kapsar (`admin:users`, `admin:settings`, `admin:*` — `permission-catalog.ts:93-94, 141`). `settings:workstation` (`:105`), `document-template:*` (`:118-119`), `data:import` (`:131`), `master-data:merge` (`:140`) **`web` kategorisinde** → `admin:*` bunları VERMEZ.

### 3.2 `requirePermission` / `requireAnyPermission` — argüman sınır durumları (KOD OKUNDU)

| Çağrı | Davranış | Satır |
|---|---|---|
| `requirePermission("x:y")`, `req.user` yok | 401 | `:55-57` |
| `requirePermission("x:y")`, izin yok | 403 + mesajda izin adı | `:59-65` |
| **`requirePermission(undefined)`** (TS tipi `string` — yalnız `as string`/dinamik haritayla ulaşılır) | `:39` false (kimsede `*` yok) → `:40` `includes(undefined)` false → **`:41` `undefined.indexOf` TypeError** → senkron throw → Express hata zinciri → `errorHandler` → **500 "Sunucu hatası oluştu."** (`error.middleware.ts:630-633`). Fail-closed ama 403 DEĞİL 500; `"*"` taşıyan biri olsaydı `:39`'dan GEÇERDİ | `:39-41` |
| `requirePermission("")` | `colon=-1` → false → 403 | `:41-46` |
| **`requireAnyPermission()`** (boş liste / boş spread) | `[].some` → false → **403** (fail-closed) | `:80-89` |
| `requireAnyPermission(...[undefined])` | `some` içinde TypeError → 500 | `:80-82` |

Repo'da `undefined`/boş üretebilecek kaynaklar §4'te; hepsi eksik anahtarda guard'dan ÖNCE 400 ile kesiyor (`printed-document.routes.ts:100-104`, `record-info.routes.ts:82-85`, `config-bundle.routes.ts:67-68`, `import.routes.ts:33-37`, `master-data-merge.routes.ts:39-46`); spread'ler sabit dizilerden (`DOCUMENT_DESIGN_READ/WRITE` `constants/document-design.ts:37-44`, `ANY_BUNDLE_READ/WRITE` `config-bundle.routes.ts:35-36`, `MOBILE_SESSION_PERMS` `work-session.service.ts:46-51`, `MOBILE_LABEL_PRINTERS` `peripheral.routes.ts`). **Bekçisi yok** (`requirePermission(undefined)` davranışını ölçen sonda bulunamadı).

### 3.3 Giriş kilidi — `middlewares/login-lockout.ts`

| Konu | Satır | Değer |
|---|---|---|
| Depo | `:24-26` | modül Map, `MAX_ENTRIES=5000`; tek process (`ecosystem.config.js:47-48` fork/1); restart'ta sıfırlanır |
| Anahtar | `:33-41` | **`req.ip` öncelikli** (trust proxy yok → soket IP), yoksa `dev:<deviceId>`, yoksa `"unknown"`; kullanıcı adı anahtara GİRMEZ (password-spraying gerekçesi `auth.controller.ts:108-112`) |
| Rezervasyon | `:56-102` | `readPinLockoutConfig()` her denemede DB'den (`:64`, cache yok); sonrası senkron bölge (`:67-90`); "başarısız varsay, başarıda sıfırla" |
| Eşikler | `:82-88` | kod varsayılanları `enabled=true · attempts=5 · penaltySec=60 · escalateAfter=3 · longPenaltyMin=15` (`system-setting.service.ts:399-414`); **prod'da `auth.pinLockoutEnabled/Attempts/PenaltySec` satırı YOK → varsayılan**; `EscalateAfter=3`, `LongPenaltyMin=15` yazılı |
| Kapsam | `auth.controller.ts:118-128, 202-213, 281-292` | üç login yolu da; bcrypt'ten ÖNCE (`:104-106` yorum) |
| Geri alma | `:111-129` | başarı → `fails=0, blockedUntil=0` (`penaltyRounds` kalır); 409/403 → tek adım `fails--` (`auth.controller.ts:161-162, 239-240, 316-317`) |
| Diğer uçlarda rate limit | grep `rateLimit|express-rate-limit` → **0** | `announce` PENDING tavanı 200 tek sayısal kapı |
| Prod audit (30 gün) | `system_logs` | `LOGIN_SUCCESS 184 · LOGIN_FAILED 62 · LOGOUT 54` |

---

## 4. DİNAMİK / ANAHTAR-KAPSAMLI KAPI ÇÖZÜMLEME TABLOSU

**Guard zinciri altı kaynağının (SKILL §7.8) envanteri:** (1) route satırı — 268 `requirePermission(` + 235 `requireAnyPermission(` çağrısı; (2) **dizi sabiti** 7 rapor dosyasında `const guard = [verifyToken, requirePermission("report:*")]` (`routes/reports/{subcontract:18, sales:24, audit:19, production:23, quality:20, inventory:16, customer:20}.routes.ts`, 22 `...guard` spread — sabit adı **küçük harf**); (3) **tekil sabit** 10 adet (`shipping.routes.ts:10-23` READ/WRITE/ACCOUNTING_READ/INVOICE_WRITE/UNDO_DISPATCH · `kursun-bypass.routes.ts:16-19, 35-41` canDistribute/canSeeVisibility · `label.routes.ts:463` SACK_LABEL_READ · `customer-branch-list.routes.ts:30-37` READ · `reason-preset.routes.ts:33` canEdit); (4) **`router.use(guard)` HİÇ YOK** — `.use` yalnız alt-router mount'u (`workorder.routes.ts:15`, `reports.routes.ts:21-27`, `customer.routes.ts:39-45`); router değişkenleri `router`×59, `categoryRouter`, `machineRouter`, `subcontractorRouter`, `travelerCardRouter`, `devicePublicRouter/deviceAdminRouter`, `peripheralRouter`; (5) **mount-seviyesi** yalnız `app.ts:562-569`; (6) **dinamik** aşağıda.

| # | Kapı | Yer | Anahtar kaynağı | Çözüm | Eksik/yabancı anahtar | Fail modu |
|---|---|---|---|---|---|---|
| 1 | `PATCH /api/feature-flags` `flagWriteGuard` | `feature-flag.routes.ts:38-46` (route `:426-430`) | `Object.keys(req.body)` | `keys.length>0 && every ∈ {documentsConfig, travelerCardConfig}` (`constants/document-design.ts:62-65`) → `requireAnyPermission("admin:settings","document-template:write")`; aksi → `requirePermission("admin:settings")` | boş gövde / tek yabancı anahtar → geniş izin | **fail-closed**. Kapı yalnız anahtar ADINA bakar (değere değil); Zod `strictObject` kapıdan SONRA (`:74-78`). `travelerCardConfig` içi (ör. firma adı alanları, `:240`) dar izinle yazılabilir — tasarım "belge çıktısıyla sınırlı" diyor (`document-design.ts:55-60`). Bekçi `test_document_template_permission.ts` (üç negatif sonda) |
| 2 | `requireDocPermission(kind)` | `printed-document.routes.ts:98-107` | `req.params.docType` | `DOC_PERMISSIONS[docType][read\|write]` (`:20-95`, **8 tip**; her `read` listesinde mobil ekran kodları da var) → `requireAnyPermission(...)` | `entry` yok → **400** (`:101-104`) | fail-closed. Hiza bekçisi `scripts/test_workorder_documents.ts` (liste izni ↔ baskı izni; `:17-19`). `TRAVELER_CARD.write` listede ama uç 400 (`:81-83`) |
| 3 | `GET /api/record-info/:table/:id` | `record-info.routes.ts:74-94` | `req.params.table` (`^[A-Z_]{3,40}$`, `:45`) | `TABLE_PERMISSIONS[table]` (`:31-41`, 9 tablo) → `matchesPermission` | yok → **400** (`:83-85`); yetki yok → 403 (`:86-88`) | fail-closed; harita bilinçli route katmanında (`:21-29`) |
| 4 | `assertKindPermissions` | `config-bundle.routes.ts:45-59` | `?kinds=` (export) / zarf içindeki türler (`kindsInBundle`, preview/apply) | `BUNDLE_PERMISSIONS[k][mode]` (`services/import/config-bundle.service.ts:43-50`, 5 tür; `PERMISSION_TEMPLATE → admin:users`) — **her tür için ayrı**, `missing>0 → 403` | bilinmeyen tür → 400 (`:67-68`) | fail-closed; kaba kapı `requireAnyPermission(...ANY_BUNDLE_READ/WRITE)` route satırında (`:35-36, 80, 109`) |
| 5 | `requireEntityWrite` / `requireEntityRead` (import) | `import.routes.ts:31-47, 50-64` | `req.params.entity` → `getImportAdapter` (`services/import/import-registry.ts:59`) | `adapter.writePermission/readPermission` + route'ta ayrıca `requirePermission("data:import")` (`:100, 130, 161, 188, 216, 240, 277`); export yalnız READ (`:309-312`, karar D6) | adaptör yok → throw → 4xx | fail-closed; bekçi `test_import_permissions.ts` |
| 6 | `requireEntityWrite` (merge) | `master-data-merge.routes.ts:36-56` | `req.params.entity` ∈ `MERGE_ENTITIES` (`:39-41`) | `requirePermission("master-data:merge")` (`:90, 121, 162, 195, 232, 264, 309, 334, 372`) + adaptörün `writePermission` (ikinci liste tutulmaz, `:8-13`) | dışı → 400 | fail-closed |
| 7 | `STATION_KIND_PERM[kind]` | `work-session.service.ts:38-43` (harita) · `:204-208` (makine dalı) · `:244-248` (istasyon dalı) | makine/istasyonun `station.kind` (DB) | `needM && !matchesPermission(perms, needM)` → 403 | **haritada olmayan kind → `needM` undefined → `needM &&` kısa devre → kontrol ATLANIR** | **fail-OPEN**. Bugün `SESSIONABLE_STATION_KINDS` 4 üye (`:33`) ↔ harita 4 üye; bekçi `test_permission_catalog.ts:106-107` yalnız kodların katalogda olduğunu ölçer, **eşitliği değil** |
| 8 | Arama kova süzgeci + `exact` | `search.service.ts:73-75` (visible) · `:224-225` (exact) · `:228-230` (kova süzgeci) · route `search.routes.ts:46` yalnız `verifyToken` | `SEARCH_ENTITIES[i].permissions` (`constants/search-entities.ts:61-179`: müşteri `customer:read` · kumaş `item:read` · renk `property:read` · sipariş `order:read` · iş emri `workorder:read` · sevkiyat/çuval `shipping:read\|write` · fason `subcontractor:read` · parti `report:production`) | kova `visible` değilse sorgulanmaz | — | **`resolveExact` (`:146-208`) izin süzgecine tabi DEĞİL**: tam-format top barkodu / çuval no (`CV…`) / kartela / iş emri no gelirse `groups` boş, `exact` **her kimlikli kullanıcıya** döner — top: `barcode+status+item.name`; **çuval: `sackNo + customer.name`** (`:165-176`; kova kuralı `shipping:read` isterdi); iş emri: `workOrderNumber + targetItem.name`. Alan kümesi dar (id/başlık/alt başlık) |
| 9 | Controller-içi dallanma (gövdeye bağlı ek kapı) | `workorder.controller.ts:949-956` (cancel) · `:989-996` (dropBatch) · `:1034-1039` (complete) | `dispositions[].action ≠ STOCK` · `fasonAction==="SCRAP"` · `dispositions.length>0` | `matchesPermission(perms,"roll:manual-adjust")` → 403 | — | route guard `workorder:write` + gövdeye bağlı ek kapı ("RBAC middleware koşullu çalışmadığından kontrol burada", `:1027-1029`) |
| 10 | Controller-içi genişletme | `tambur.controller.ts:370-371` | — | `mobile:tambur-duzelt ∨ roll:manual-adjust` → `allowEmptyStep` | — | yetki ENGEL değil, davranış anahtarı |
| 11 | Controller-içi genişletme | `inventory.controller.ts:274-292` (yarı mamul: `mobile:kk1-yari-mamul ∨ roll:write`) · `:350-353` (Kanban kolon kapsamı: `quality:read`, `shipping:read\|write`) | — | 403 ya da yanıt kapsamı daraltma | — | aynı sınıf |

---

## 5. SERVİS KATMANI izin kontrolleri — F221 deseni (`opts.permissions` / `permissions?:`)

Grep: `permissions\?:|opts\.permissions|…` → 11 vuruş, 5 servis + `search.service` (zorunlu parametre). `matchesPermission`'ı servis içinden import eden dosyalar: `workorder-link.service.ts:40`, `inventory.service.ts:144`, `search.service.ts:26`, `work-session.service.ts:23` (tambur-undo `includes` ile elle bakar).

### 5.1 İzin listesi alan servis fonksiyonları

| Servis fonksiyonu | İmza (satır) | Enforce edilen | `permissions` verilmezse |
|---|---|---|---|
| `inventoryService.applyManualProperties(rollId, data, userId, opts?)` | `inventory.service.ts:3659-3684` | top `FREE_STOCK` (`STOCK/WAREHOUSE/A1_STOCK`, `:3737-3741`) dışındaysa `roll:manual-adjust` + sebep ≥3 (`:3742-3763`); `ALWAYS_BLOCKED` (`:3723-3736`) her yolda | `opts?.permissions !== undefined` (`:3747`) → kontrol ATLANIR; sebep kuralı + ALWAYS_BLOCKED + çuval/sevkiyat kilidi (`:3767-3770`) kalır |
| `TamburUndoService.getUndoPreview/applyUndo(rollId, [userId], opts?)` | `tambur-undo.service.ts:211-221, 238-271` | mod `FULL` → `roll:manual-adjust` **veya `admin:*` literal** (`:292-302`; `matchesPermission` KULLANMIYOR — `"*"`/alan jokeri yok sayılır; bugün fark yok) + sebep (`:304-310`) | `!opts?.permissions → null` (`:293`) → FULL serbest |
| `workOrderLinkService.applyAttributeToRolls(woId, data, userId?, permissions?)` | `workorder-link.service.ts:723-728` | **planlamacı muafiyeti** `:774-780`: `permissions` var VE `roll:manual-adjust` YOK VE `workorder:write` var → motora `undefined` geçer → `workorder:write` taşıyan kişi iş emrinin `IN_PRODUCTION` toplarının `colorId/width`'ini toplu düzeltir (2026-08-21 kullanıcı kararı; kapsam `whereRollsOfWorkOrder` `:742-765`, `assertPlanEditable` `:740`, sebep zorunlu `:729-732`) | motor kontrolsüz |
| `workOrderLinkService.linkOrderLineWithOverride(woId, lineId, reason, userId?, permissions?)` | `:863-868` | tekil motora aynen geçirilir (çift emniyet, `:859-861`) | — |
| `WorkSessionService.open({… permissions?})` | `work-session.service.ts:171-181, 204-208, 244-248` | istasyon türü izni (`STATION_KIND_PERM`) | `input.permissions !== undefined` → atlanır |
| `searchService.search(term, {permissions})` | `search.service.ts:215-218` | zorunlu parametre | — |

### 5.2 Çağrı yerleri — kim geçiriyor

| Çağıran | Satır | Geçirilen | Sınıf |
|---|---|---|---|
| `InventoryController.relabel` (`PATCH /api/rolls/:id/label`) | `inventory.controller.ts:661-682` (`:676`) | `{ permissions: req.user?.permissions ?? [] }` | HTTP → enforce |
| `InventoryController.manualAttributes` (`PATCH /api/rolls/:id/manual-attributes`) | `:701-720` (`:715`) | aynı | HTTP → enforce |
| `workOrderLinkService.applyAttributeToRolls` → `applyManualProperties` | `workorder-link.service.ts:786-799` | `engineOpts` (`:774-780`): süpervizör → `{permissions}`; **planlamacı → `undefined`** | HTTP kökenli, BİLİNÇLİ muafiyet |
| `TamburController.getUndoPreview` (`GET /api/tambur/rolls/:rollId/undo-preview`) | `tambur.controller.ts:241-255` (`:249`) | `permissions: req.user?.permissions` | HTTP → enforce |
| `TamburController.applyUndo` (`POST …/undo`) | `:258-271` (`:270`) | `req.user?.permissions ?? []` (yorum `:266-269`; bekçi `test_tambur_undo.ts §4`, `:211-227`) | HTTP → enforce |
| `WorkOrderController.linkOrderLineWithOverride` | `workorder.controller.ts:670-684` (`:678`) | `req.user?.permissions ?? []`; route AND çift kapı `workorder.routes.ts:600-601` | HTTP → enforce |
| `WorkOrderController.applyAttributeToRolls` | `:736-744` | `req.user?.permissions ?? []`; route `requireAnyPermission("roll:manual-adjust","workorder:write")` (`workorder.routes.ts:707`) | HTTP → enforce (muafiyet serviste) |
| `WorkSessionController.open` | `work-session.controller.ts:49-65` (`:59`) | `req.user!.permissions` | HTTP → enforce |
| `search.routes.ts` | `:46-63` | `req.user?.permissions ?? []` | HTTP → enforce (kova) |

### 5.3 İZİNSİZ GEÇEN DAHİLİ ÇAĞRILAR (`permissions` omit / enforce kapalı)

| Yol | Satır | Neden | Kapı başka yerde mi? |
|---|---|---|---|
| `applyAttributeToRolls` → `applyManualProperties(…, undefined)` planlamacı dalı | `workorder-link.service.ts:774-780, 798` | kullanıcı kararı 2026-08-21 | route any-perm (`workorder.routes.ts:702-708`) + sebep + `assertPlanEditable` + WO kapsamı |
| `linkOrderLines` / `unlinkOrderLine` (izin parametresi YOK) | `workorder.controller.ts:655-667, 687-698` | tasarım — plan yazımı | route `workorder:write` [VARSAYIM: K1 route satırını doğrulasın] |
| `createInitialEntry` dahili çağrıları (`tambur-manual.service` ×2) — `opts.duplicateGuard` omit | CLAUDE.md notu; `inventory.controller.ts:294-305` | mükerrer tuzağı yalnız HTTP yolunda | Tambur-manual route'ları kendi guard'ını taşır |
| `getStampContext(req)` **enforce'suz** çağrılar (oturum zorunlu değil, yalnız atıf) | `kursun-qc.controller.ts:183` · `tambur.controller.ts:287, 308, 328` · `label.controller.ts:109, 533` · `shipping.controller.ts:147` · `peripheral.routes.ts:102` · `station-capability.routes.ts:97` | atıf | `enforceForMobile:true` (oturum yoksa 409 `WORK_SESSION_REQUIRED`, `work-session.helper.ts:107-140`): `inventory.controller.ts:234, 294` · `kursun-qc.controller.ts:129` · `tambur.controller.ts:347, 386, 521` · `tambur-manual.controller.ts:167-256` (6) · `peripheral.routes.ts:185` |
| `scripts/test_*` servis çağrıları (`applyManualProperties` 30+, `WorkSessionService.open` 20+, `linkOrderLines`) | `scripts/` | test | HTTP dışı |

**Sonuç:** HTTP'den ulaşılabilen ve `permissions` geçirmeyen tek servis yolu, bilinçli planlamacı muafiyetidir (H6).

---

## 6. Cihaz katmanı — `middlewares/device.middleware.ts:33-105`

| Durum | `pairingRequired=false` (**prod**) | `pairingRequired=true` | Satır |
|---|---|---|---|
| `x-device-id` başlığı YOK (Electron hiç göndermez — `inventory.controller.ts:295-296`) | `next()`, `req.device` boş | **`next()`, `req.device` boş** — cihaz kapısı başlık göndermeyen istemciye HİÇ uygulanmaz | `:38-42` |
| EXEMPT (`/api/devices/announce\|status\|pairing-required`, trailing slash/case normalize) | `next()` | `next()` | `:27-31, 44-47` |
| DB hatası | `next()` (fail-open, yorum `:73`) | 503 `DEVICE_CHECK_UNAVAILABLE` (fail-closed); bayrak da okunamazsa **fail-open** (`:60-64`) | `:51-74` |
| Cihaz yok / PENDING / pasif | `next()`, `req.device` boş | 401 `DEVICE_INACTIVE` (login dahil) | `:76-91` |
| APPROVED + aktif (makineye atanmamış olsa da) | `req.device={id, deviceId, name, machineId, kind}` + presence | aynı | `:96-104`; `device.service.ts:371-376` |

- **Cihaz kimliği sırsızdır:** `Device` modelinde token/secret kolonu yok (`schema.prisma:800-824`); `deviceId` tablette `Math.random` tabanlı UUID v4 (`mobil/src/utils/deviceId.ts:17-34`, SecureStore'da), `announce` gövdesiyle public bildirilir, `GET /api/devices/status` herhangi bir `deviceId` için atfı döner (`device.service.ts:209-213`). Başka cihazın `deviceId`'sini başlıkta gönderen istemci onun `req.device`'ını alır (makine atfı, iş oturumu, yazıcı hedefi `label.controller.ts:108-121` `deviceId: req.device?.id`).
- **`req.device`'a bağlı kapılar** (prod'da fiilen tek cihaz kapısı): `work-session.controller.ts:37-46` `requireDevice` (open/close/current → 400 `DEVICE_REQUIRED`) · `auth.controller.ts:379-386` `mobile-users` (yalnız pairing zorunluysa) · `getStampContext` (`work-session.helper.ts:86-144`: `!req.device → null` `:90`; `enforceForMobile && kind!=="DESKTOP"` ve oturum yoksa 409 `:107-140`). **Onaysız/başlıksız tabletten** KK1 girişi/Tambur/etiket uçları izin taşıyan her kullanıcıya açık — yalnız `machineId=null` atıf düşer; `enforceForMobile` yalnız `req.device` VARSA devreye girer (`:90` önce `null` döner).
- **Prod ölçümü:** 28 cihaz — **28 APPROVED, 0 PENDING** (TABLET 16 · DESKTOP 11 · PHONE 1); **`machineId` dolu olan 0** → statik makine atfı yok, atıf yalnız `work_sessions`'tan (106 oturum, 3 açık, 13 farklı cihaz); `device.pairingRequired=false`.
- Admin cihaz uçları: `/api/admin/devices/*` 9 uç hepsi `admin:settings` (`device.routes.ts:59-115`).

---

## 7. Nesne sahipliği ve kapsam

### 7.1 Kullanıcı kendi kaydı

| Kaynak | Sahiplik | Satır | Başkasının kaydına yol |
|---|---|---|---|
| `UserPreference` | `userId = req.user.userId`; gövdede id yok | `user-preference.controller.ts:40-45, 72-78` | yok |
| `Session` (logout) | `req.user.jti` | `auth.controller.ts:465` | toplu purge `admin:settings` |
| `WorkSession` open | `userId=req.user.userId`, `deviceRowId=req.device.id` (gövdeden alınmaz) | `work-session.controller.ts:53-60` | — |
| `WorkSession` close | **cihaz bazlı**: `closeForDevice(device.id)` → o cihazdaki TÜM açık oturumlar (`updateMany where deviceId, endedAt:null`) — kullanıcı eşleşmesi aranmaz | `work-session.controller.ts:67-75`; `work-session.service.ts:349-368` | `MOBILE_SESSION_PERMS` + başka cihazın `x-device-id`'si (§6) |
| `WorkSession` current | `current(device.id, req.user.userId)` — başka kullanıcının kalıntısı `NEW_LOGIN` ile kapanır (öz-onarım) | `:77-86`; `work-session.helper.ts:98-105` | — |
| `history/activity/forceClose/listActive` | admin | `work-session.routes.ts:80, 92-95, 116-119, 134-137` (`admin:settings` (+`admin:users`)) | — |
| `Device` | kullanıcıya bağlı DEĞİL; sahiplik sırsız `deviceId` başlığı | §6 | H4 |
| `/api/auth/me` | `req.user.userId` | `auth.controller.ts:414-443` | — |
| Presence | modül Map, yalnız sayı (`getPresence`) | `lib/presence.ts:16-40` | — |

### 7.2 Şube (`Order.branchId`) kapsamı

- `Order.branchId` opsiyonel (`schema.prisma:1967`); `Shipment/Sack/DirectShipment.branchId` (`:3426, 4137, 4222`).
- Servislerde `branchId` 107 geçiş — **hepsi veri alanı / istemci filtresi / varlık doğrulaması** (`shipping.service.ts:110, 233-242`, `order.service.ts:913-917, 2142, 2305-2323`). **Kullanıcı↔şube bağı YOK**: `User` modelinde şube alanı yok (`schema.prisma:353-504`), JWT payload'ında yok (`types/api.types.ts:47-59`) → **satır düzeyi (row-level) kapsam mevcut değil; yetki tamamen fonksiyonel**. DB-per-müşteri (KUNYE) ile tutarlı.

### 7.3 Mobil `mobile:*` ↔ web izinleri

- Model: mobil kodlar **ekran** izinleridir; route guard'ları `requireAnyPermission("<web>", "mobile:<ekran>")` ile web iznine ALTERNATİF kabul eder (`permission-catalog.ts:151-152`). Ölçüm: `src/routes` içinde mobil kod geçen **49 farklı `requireAnyPermission` imzası**; en sık `mobile:hizli-is-emri` 44, `mobile:tambur` 32, `mobile:tarti-paket` 23, `mobile:fason-sevk` 22. Tek `requirePermission("mobile:…")` → `item.routes.ts:187` (`mobile:kk1-desen`).
- Ters yön: mobil kod web ucunu kapsamaz — `MOBILE_KURSUN_DAGITIM` `workorder:distribute` içermez (`role-template-catalog.ts:338-346`); `mobile:siparis` yalnız liste+yaratma (`permission-catalog.ts:165-169`; bekçi `test_mobile_order_permission.ts`).
- Masaüstü kapısı: yalnız `mobile:` izinli hesap `clientType=electron` ile token alamaz (`auth.service.ts:266-273`); Electron aynası `canEnterApp` = "herhangi bir `mobile:` dışı izin" (`Electron/src/types/auth.ts:85-88`). ⚠️ `MOBILE_PRODUCTION_OPERATOR`/`MOBILE_TAMBUR` şablonları `label:edit` + `customer-alias:write` (**`web` kategorisi**) taşır (`role-template-catalog.ts:296-297, 307`) → bu şablonla açılan tablet operatörü masaüstü kapısından GEÇER (prod: `Os***` 5 web izni — `label:*`).
- "Yönetim" görünürlüğü `hasAdminAccess` = `admin:users|admin:settings|admin:*` (`Electron/src/types/auth.ts:57, 81-83`); `settings:workstation`/`document-template:*` `web` olduğu için menüyü açmaz (tasarım).
- Mobil wildcard aynası `mobil/src/hooks/usePermission.ts:13-21`: `mobile:*` ve `admin:*` alan jokerlerini tanır, **global `*`'ı tanımaz** (backend `:39` tanır; fark yok — `*` kimsede yok). Ekran kataloğu `mobil/src/types/permissions.ts:2-35, 84+`.
- Electron aynası `matchesPermission` birebir kopya (`Electron/src/types/auth.ts:66-77`); belge tasarım kümesi aynası `Electron/src/lib/permissions.ts:25-32` ↔ `constants/document-design.ts:37-44` (bekçi `test_document_template_permission.ts:353-378` tile↔route hizası).

### 7.4 Prod ölçümü (kopya)

| Ölçüm | Değer |
|---|---|
| Kullanıcı | 9 (8 aktif, 0 silinmiş); `user_permissions` 353; **süreli (validFrom/validUntil) 0** |
| Yalnız `mobile:` izinli aktif kullanıcı | 1 (`Ha***`, 1 izin); `Ku***` pasif (3 mobil) |
| Hiçbir kullanıcıda olmayan izin | `mobile:kk1-yari-mamul` |
| `admin:*` | 3 (`ad***, Be***, Ah***`); `admin:users` 4; `admin:settings` 4; `mobile:*` 1 (`ad***`) |
| İzin sayısı dağılımı | `ad***` 69 (18 mobil/51 web) · `En***` 58 · `Be***` 55 · `Ed***` 55 · `Ah***` 54 · `Sa***` 50 · `Os***` 8 (3/5) · `Ha***` 1 |

---

## 8. İzin kataloğu · rol şablonları · boot uzlaştırma · SoD

### 8.1 Sözleşme (kod)

| Adım | Satır | Davranış |
|---|---|---|
| Katalog (70 kod) | `constants/permission-catalog.ts:47-190` | `as const satisfies readonly PermissionCatalogEntry[]`; kategori Prisma enum `web\|mobile\|admin` (`schema.prisma:320-324`) |
| Uzlaştırma | `jobs/permission-catalog.job.ts:67-131` | yalnız eksik `code` satırlarını `createMany({skipDuplicates:true})` (`:94-102`); silmez, güncellemez; `extra` yalnız log (`:115-119`); audit `PERMISSION_CATALOG_RECONCILED` (`:123-129`) |
| Zamanlama | `:144-199` | boot +3 sn, 5 deneme ×15 sn (`:44-46`); tükenirse `PERMISSION_CATALOG_RECONCILE_FAILED` + gürültülü log, **sunucu düşmez** (`:178-194`) → izin satırı yoksa Admin dışı 403 |
| Roller | `jobs/role-template-catalog.job.ts:57-218` | izinlerden SONRA zincirde (`permission-catalog.job.ts:153-154`); kodla bulur, eski adla BİR KEZ sahiplenir (`LEGACY_TEMPLATE_NAME_TO_CODE`, `role-template-catalog.ts:58-75`; `:109-128`), eksik izni EKLER (`:167-180`), ad/açıklama/isActive EZMEZ, ad çakışmasında atlar (`:130-146`) |
| Atama | — | **hiçbir uzlaştırma kullanıcıya izin ATAMAZ** ("katalog koda, atama panele" `permission-catalog.ts:25-27`); tarihsel `scripts/sync-kursun-bypass-permissions.ts`, `sync-quick-wo-permission.ts` (atama script'leri) |
| Sistem rolü silme | `permission-management.service.ts:942-962` | `code≠null` → pasifleştirme (`:946-949`); fabrika şablonu gerçek delete (`:951`) |
| Şablon uygulama | `:969-1035` | pasif şablon 400 (`:987`); `replace` → `setUserPermissions` (`:995-996`); `merge` → `createMany` + tokenVersion++ (`:1011-1021`) |
| Varsayılan operatör paketi | `:30-34, 475-481` | yeni kullanıcı `mobile:kk1/kk2-kursun/tambur` (opt-out) + etkin yöntemlere göre PIN/kart üretimi (`:525-534`) |
| Son-admin koruması | `:582-665` | `ADMIN_CODES=["admin:users","admin:*"]` (`:582`); advisory lock `(8025,1)` tx içinde (`:604-610`); efektif pencere (`:587-595`); `setUserPermissions/revoke/deactivate/delete` kapsar (`:305-308, 378-390, 686-688, 747-749`) |

### 8.2 Prod ölçümü

- `permissions` 70 = katalog 70 → katalog dışı 0; `"*"` yok (joker yalnız `admin:*`, `mobile:*`).
- `permission_templates` 26 = katalog 26, hepsi `code` dolu + aktif; `ADMIN_FULL` 70 izin; kodsuz (fabrikanın kendi) şablon 0.

### 8.3 SoD üçlüsü — tasarım (kod + prod şablon üyeliği) vs. atama

| Kod | Şablonlar (kod `role-template-catalog.ts` = prod DB) | Route kapısı | Prod'da taşıyan (aktif, maskeli) |
|---|---|---|---|
| `shipping:invoice` | `WEB_ACCOUNTING` (`:149-166`) + `ADMIN_FULL` | `INVOICE_WRITE = requireAnyPermission("shipping:invoice", "shipping:write")` (`shipping.routes.ts:18`; uçlar `:237, 255`) — **`shipping:write` de fatura işaretler** (yorum `:15-17` bilinçli: "sevkiyatçının mevcut yetkisi daralmasın") → SoD tek yönlü | 2 (`ad***`, `En***`) |
| `shipping:undo-dispatch` | `WEB_PRODUCTION_SUPERVISOR` (`:235-254`) + `ADMIN_FULL` | `UNDO_DISPATCH = requireAnyPermission("shipping:undo-dispatch")` (`:23`; uçlar `:326, 362`) — `shipping:write` KAPSAMAZ | **6/8** (`ad***, En***, Be***, Ed***, Ah***, Sa***`) |
| `roll:manual-adjust` | `WEB_PRODUCTION_SUPERVISOR` + `ADMIN_FULL` | çok yerde (§4 #9, §5) | **6/8** (aynı altı) |
| `mobile:tambur-duzelt` | hiçbir şablonda (`ROLE_COVERAGE_EXEMPT`, `:396-397`; DB'de yalnız `ADMIN_FULL`) | `reason-preset canEdit` (`:33`), Tambur `allowEmptyStep` | 2 (`ad***`, `Os***`) |
| `admin:*` | yalnız `ADMIN_FULL` | — | 3 |
| `data:import` / `master-data:merge` | `WEB_SYSTEM_ADMIN` / `WEB_SALES` + `ADMIN_FULL` | çift kapı (§4 #5-6) | 1 / 1 |

Tasarım notu (`role-template-catalog.ts:84-88, 237-238`): "üç tehlikeli yetki bilinçli olarak yalnız Muhasebe/Süpervizör rollerinde" — sahada 50-69 izinli altı masaüstü hesabın hepsinde (H7).

---

## 9. `/api/admin/*` uçları (guard haritası)

`admin.routes.ts` 46 route tanımı (tek `router`, hepsi route satırında `verifyToken` + `requirePermission`).

| Grup | Uçlar | Guard | Satır |
|---|---|---|---|
| Yetki/kullanıcı | `GET /permissions, /screens, /users, /users/:id, /users/:id/permissions, /permission-templates(/:id)`; `POST /users, /users/:id/{deactivate,reactivate,permissions,reset-password,card-token,quick-pin,apply-template}, /permission-templates`; `PATCH /users/:id, /permission-templates/:id`; `PUT /users/:id/permissions`; `DELETE /users/:id, /users/:id/permissions/:permissionId, /permission-templates/:id`; `GET /users/:id/credentials` (düz PIN+kart) | `admin:users` | `:53-695` |
| Perf/oturum/log/ayar | `GET /perf, /perf/history, /system-logs(+/stats,/users,/tables,/archive,/archive/:id,/:id), /settings` (34 satırın tamamı ham + `updatedBy`, `system-setting.service.ts:1012-1018`); `POST /perf/reset, /sessions/purge, /system-logs/archive, /backup`; `PUT /settings/:key` (STRUCTURED anahtarlar `travelerCardConfig/documentsConfig/auth.loginMethods` → 400, `:1089-1093, 1150-1155`) | `admin:settings` | `:721-1219` |
| Yedek | `GET /backups, /backups/:name/download, /backups/:name/restore-impact`; `PATCH /backups/offsite`, `POST /backups/offsite/authorize` | `admin:settings` **VE** `admin:users` (iki `requirePermission` zincirli — F287: dump düz PIN/kart taşır, yorum `:1226-1227`) | `:1223-1318, 1403-1407, 1477-1481`; yol doğrulaması `backup.service.ts:490-494` (`basename` + `.dump$`) |
| Yedek (tekil) | `GET /backups/offsite`, `POST /backups/offsite/test`, `/sweep` | `admin:settings` | `:1361-1365, 1437-1455` |
| DB kopyası | `GET/POST /api/admin/db-copies, POST /:name/verify, DELETE /:name, GET /:name/swap-command` | `admin:settings` VE `admin:users` | `db-copy.routes.ts:48-52, 77-81, 108-112, 142-146, 177-181` (`app.ts:557` adminRoutes'tan ÖNCE) |
| Zengin sağlık | `GET /api/admin/health` | `admin:settings` | `app.ts:562-569` |
| Cihaz | `/api/admin/devices/*` (9 uç) | `admin:settings` | `device.routes.ts:59-115` |
| Mobil OTA depo durumu | `GET /api/mobile/updates-state` | `admin:settings` | `mobile-update.routes.ts:93-96` |
| Çalışma oturumu yönetimi | `GET /api/work-sessions/active` · `/history` · `/activity` · `POST /:id/force-close` | `admin:settings` / `admin:settings\|admin:users` | `work-session.routes.ts:80-137` |

Not: audit kayıtları iki kodla açılır — `/api/admin/system-logs*` `admin:settings`, `/api/reports/audit` `report:audit` (`reports/audit.routes.ts:19`).

---

## 10. RAW SQL PARAMETRE KAYNAĞI TABLOSU

`$queryRawUnsafe/$executeRawUnsafe` **19** kullanım (grep), 3 dosya. Sütunlar: tanımlayıcı (tablo/kolon) nereden · değer `$n` parametre mi · kullanıcı girdisi konumu.

| # | Yer | SQL parçası | Tanımlayıcı kaynağı | Değer kaynağı | Kullanıcı girdisi? |
|---|---|---|---|---|---|
| 1 | `services/base.service.ts:923-932` (`findSimilarNames`) | `SELECT … FROM "<table>" t [JOIN] WHERE (t."<fold>" = $1 OR (t."<fold>" % $1 AND similarity(...) >= $thr)) … ORDER BY score DESC, t."<field>" LIMIT <limit>` | `table` ← Prisma DMMF `dbName` (`tableNameFor`, `:112-121`, `:856`); `field/scope` ← servis config sabitleri; `q()` ile `"…"` kaçırma; `limit` ← `Math.min(Math.max(opts.limit??5,1),20)` (`:858`) | `$1` katlanmış ad (kullanıcı metni → `foldNameForCompare`), eşik/scope/exclude/LIKE deseni parametre (`:903, 920`) | **Evet, yalnız `$n` olarak**; ORDER BY kolonu config'den |
| 2 | `services/db-copy-verify.service.ts:464-471` (`prismaCount`) | `SELECT count(*)::bigint FROM "<table>"` | `COUNTED_TABLES` sabit liste; `"` kaçırma `:467` | — | Hayır |
| 3 | `services/master-data-merge.service.ts:441-448` (`findDuplicates`) | `SELECT id, code, name, isActive, <''\|"nameFold"> AS fold FROM "<meta.table>" WHERE "mergedIntoId" IS NULL` | `entity` → `assertEntity` allowlist → `META[entity].table` sabit | — | `entity` route'ta `MERGE_ENTITIES` (`master-data-merge.routes.ts:39-41`) |
| 4 | `:629-634` (merge düz taşıma, tx) | `UPDATE "<rule.table>" SET "<rule.column>" = $1::uuid WHERE "<rule.column>" = ANY($2::uuid[])` | `MERGE_MAP[entity]` sabit kural listesi (`constants/merge-map.ts`) | `survivor.id`, `sourceIds` (Zod uuid, `routes:58-61`) | Hayır (tanımlayıcı) |
| 5 | `:795-803` (`describeConflictTx`) | `SELECT count(*) … s."<col>" = ANY($1) AND EXISTS(… t."<c>" = s."<c>")` | `rule.table/column/uniqueOn` sabit | `$1,$2` | Hayır |
| 6 | `:834-837` | `SELECT count(*) FROM "<table>" WHERE "<col>" = $1::uuid` | sabit | `$1` | Hayır |
| 7 | `:841-844` | `DELETE FROM "<table>" WHERE "<col>" = ANY($1::uuid[])` | sabit | `$1` | Hayır |
| 8 | `:848-852` | `DELETE FROM "<table>" s WHERE <conflictWhere>` | sabit (`matchOther` ← `uniqueOn`) | `$1,$2` | Hayır |
| 9 | `:866-870` | aynı DELETE (SKIP/UNION/UNION_COMPOSITE_PK) | sabit | `$1,$2` | Hayır |
| 10 | `:880-890` (MERGE_FIELDS) | `UPDATE "<table>" t SET "assigned"=…, "alias"=… FROM "<table>" s WHERE …` | sabit | `$1,$2` | Hayır |
| 11 | `:892-896` | DELETE (MERGE_FIELDS sonrası) | sabit | `$1,$2` | Hayır |
| 12 | `:921-927` (`markSideEffectsTx` customer) | `UPDATE "rolls" SET "labelDirty"=true WHERE "labelCustomerId" = ANY($1) AND "status" <> ALL($2::text[]::"RollStatus"[])` | literal | `sourceIds`, `DEAD` sabit dizi | Hayır |
| 13 | `:928-932` | `UPDATE "sacks" … = ANY($1)` | literal | `$1` | Hayır |
| 14 | `:938-944` | `UPDATE "rolls" … WHERE "<rollColumn>" = ANY($1) …` | `rollColumn` ∈ {itemId, colorId} koddan (`:936`) | `$1,$2` | Hayır |
| 15 | `:946-949` | `SELECT id FROM "work_orders" WHERE "<woCol>" = ANY($1)` | `woCol` ∈ {targetItemId, targetColorId} koddan (`:945`) | `$1` | Hayır |
| 16 | `:966-969` (`countReferences`) | `SELECT count(*) FROM "<table>" WHERE "<col>" = $1::uuid` | MERGE_MAP sabit | `id` | Hayır |
| 17 | `:999-1004` (`countReferencesBatch`) | `SELECT "<col>"::text, count(*) … = ANY($1) GROUP BY 1` | sabit | `$1` | Hayır |
| 18 | `:1018-1021` (`countRows`) | `SELECT count(*) … = ANY($1)` | sabit | `$1` | Hayır |
| 19 | `:1043-1052` (`describeConflict`) | `SELECT s.* … ORDER BY <otherCols>` | `otherCols` ← `rule.uniqueOn` sabit — **ORDER BY dinamik ama sabit listeden** | `$1,$2` | Hayır |

**Ek — `Prisma.raw` (tagged `$queryRaw` içinde ham parça), 5 nokta:** `constants/time.ts:71, 90` (`columnExpr` + `timeZone` — çağıranlar string literal/`FACTORY_TIMEZONE` [VARSAYIM: 9 çağıran bu turda tek tek okunmadı]); `services/subcontractor.service.ts:342` (`AWAITING_DISPATCH_STATUSES` enum sabitleri); `services/helpers/audit-value-resolver.ts:111-112` (`table/label` ← `FIELD_SOURCES` sabit haritası). Tagged `$queryRaw`/`$executeRaw` toplam **27** kullanım — değerler otomatik parametre.

**Dinamik ORDER BY / filtre (Prisma, raw değil):** `BaseService.safeSortBy` istemci `sortBy`'ını DMMF alan kümesi (`sortableFieldsFor`, `base.service.ts:171`) / `relationSortMap` (`:358`) ile süzer; boot bekçisi `assertBaseServiceGuards` (`:191-200`, `server.ts:39`). Tam doğruluğu K1/K3 alanı.

**Sonuç:** 19 raw kullanımın hiçbirinde kullanıcı girdisi tanımlayıcı konumuna girmiyor; tek kullanıcı-metni (#1 `$1`) parametre. Hotspot yalnız H10 (bekçi yokluğu).

---

## 11. Güvenlik ayarları — özet tablo

| Konu | Değer | Kanıt |
|---|---|---|
| JWT algoritma / secret | HS256 sabit; secret env, ≥32 zorunlu | `auth.service.ts:35-45, 388` |
| JWT süresi (prod) | `autoLogoutOnExpiry=false` → **30 gün** (`absoluteSessionCapDays=30`) | `auth.service.ts:296-305`; prod `system_settings` |
| Oturum iptali | `tokenVersion` + `Session.revokedAt` her istekte | `auth.middleware.ts:74-102` |
| Brute force | yalnız 3 login yolunda in-memory lockout (IP anahtarlı, 5/60 sn, 3 tur → 15 dk) | `login-lockout.ts`; prod satırları eksik → varsayılan |
| Genel rate limit | **yok** | grep 0 |
| helmet | CSP varsayılan (upgrade-insecure kapalı), HSTS kapalı | `app.ts:102-110` |
| CORS | `*`, credentials yok | `app.ts:114` |
| Taşıma | HTTP (LAN), bearer düz metin | `app.ts:96-101`, `server.ts:20` |
| Static | `public/` 3 dosya | `app.ts:157-158` |
| Swagger prod | kapalı (`NODE_ENV`) | `swagger.ts:69`; `ecosystem.config.js:76` |
| Hata sızıntısı | bilinmeyen hata → sabit mesaj; `AppError.details` istemciye | `error.middleware.ts:270-277, 630-633` |
| `.env` | git'te **izleniyor** (`git ls-files` → `Teks-Erp/.env`; commit'ler `7e2cf002` 2026-05-11 "include env", `998e9535`, `76f9967b` 2026-07-30 "JWT secret rotasyonu"); `.gitignore:3` `.env` satırı izlenen dosyaya etkisiz (`git check-ignore` exit 1); `docs/ops/KURULUM.md:16` "sırlar; git'e girmez" der; `.env.bak-*` çalışma dizininde, izlenmiyor | `git ls-files`, `git log` |
| Mass-assignment | `sanitizeWriteData` DMMF, boot fail-closed | `base.service.ts:191-200`, `server.ts:39` |
| UUID param | `assertValidUuid` yalnız `BaseController.getParamId` + elle çağıran handler'larda (39 çağrı; middleware DEĞİL — gerekçe `uuid-param.middleware.ts:4-10`) | `base.controller.ts:11-17` |
| Sır benzeri `system_settings` anahtarı | prod'da 34 satır; `token|secret|password|rclone` adlı satır **0** | sql-saha |

---

## 12. Bekçi haritası (K5 alanına dokunan `scripts/test_*`)

| Bekçi | Ölçtüğü şey |
|---|---|
| `test_route_auth_coverage.ts` | her ucun `verifyToken` taşıması; EXEMPT gerekçeli (`:34-75`); çıplak zincir ≤12 (`:114`) |
| `test_permission_catalog.ts` | route'lardaki her izin argümanı katalogda; dinamik kaynaklar beyanlı (`DINAMIK_IZIN_KAYNAKLARI` `:103-139`); tek-kolon kuralı (`:341-357`) |
| `test_role_template_catalog.ts` | rol kataloğu ↔ izin kataloğu (muaf listesi `ROLE_COVERAGE_EXEMPT`) |
| `test_permission_management.ts`, `test_p2_auth.ts`, `test_timed_permissions.ts`, `test_user_default_perms.ts` | grant/revoke/tokenVersion, son-admin yarışı, süreli izin → exp kırpması, varsayılan paket |
| `test_login_access.ts`, `test_login_methods.ts`, `test_card_login.ts`, `test_login_lockout.ts`, `test_login_lockout_coverage.ts` | login yolları, electron kapısı, kart/PIN, kilit + sıra |
| `test_session_registry.ts`, `test_session_duration_minutes.ts`, `test_session_purge.ts` | politika (kick/notify/off), middleware iptali, purge kapsamı |
| `test_device_assignment.ts`, `test_device_activity.ts`, `test_device_transport.ts`, `test_peripheral_for_device.ts`, `test_work_session*.ts` (3) | cihaz onayı/atama, oturum açma/devralma, damgalama |
| `test_document_template_permission.ts`, `test_workstation_permission.ts`, `test_feature_flag_contract.ts` | dar izin kümeleri + Electron aynası + tile↔route hizası; `flagWriteGuard` negatif sondaları |
| `test_mobile_screen_permissions.ts`, `test_mobile_order_permission.ts`, `test_mobile_item_permission.ts`, `test_depo_roll_cancel_permission.ts` | mobil ekran izni ↔ uç guard'ı |
| `test_import_permissions.ts`, `test_masterdata_guards.ts` | adaptör izni ↔ CRUD izni; merge guard'ları |
| `test_tambur_undo.ts §4`, `test_roll_edit_unified.ts` | F221 enforce (FULL yetki; süpervizör kapsamı) |
| `test_client_policy.ts`, `test_mobile_update.ts §6` | public uçların sözleşmesi / yol kaçışı |

**Bekçisi görünmeyen mekanizmalar (ölçüm):** `requirePermission(undefined)` davranışı · `STATION_KIND_PERM` ↔ `SESSIONABLE_STATION_KINDS` eşitliği · `resolveDevice` fail-open/closed dalları · `resolveExact` izin davranışı · raw SQL tanımlayıcı allowlist'leri · `.env` izlenmemesi.

---

## HOTSPOTLAR

② denetçilerinin (özellikle **G — güvenlik**) öncelikle bakması gereken yerler. **Hiçbiri bulgu değildir**; her biri "kodu oku, failure_mode üret ya da reddet" çağrısıdır. Sıra kabaca etki tahminine göre.

| # | Yer | Neden bakılmalı |
|---|---|---|
| H1 | `Teks-Erp/.env` git'te izleniyor (commit'ler `7e2cf002`, `998e9535`, `76f9967b` "JWT secret rotasyonu"); `.gitignore:3` etkisiz; `docs/ops/KURULUM.md:16` aksini söylüyor | Dev `JWT_SECRET` + `DATABASE_URL` repo geçmişinde. Prod'un kendi `.env`'i var mı / secret dev ile aynı mı **DOĞRULANAMADI** [VARSAYIM: farklı]. Aynıysa repo erişimi = prod token imzalama. İçerik rapora girmez; ops'a sorulsun |
| H2 | `middlewares/rbac.middleware.ts:39-41` | `requirePermission(undefined)` 403 değil **TypeError→500**; `"*"` taşıyan olsaydı `:39`'dan geçerdi. Bugün üretici yol yok (§3.2, tüm dinamik kaynaklar 400 ile önce kesiyor) — ama "haritada yok → undefined geç" kalıbıyla yeni kapı eklenirse 500'e düşer; bekçi yok |
| H3 | `services/work-session.service.ts:38-43, 205-206, 245-246` + `:33` | `STATION_KIND_PERM` eksik anahtarda `needM` undefined → **kontrol sessizce atlanır (fail-open)**. Bugün 4↔4; `SESSIONABLE_STATION_KINDS`'a yeni kind eklenip harita unutulursa yalnız `mobile:kk1` taşıyan operatör o istasyonda oturum açar/devralır. Bekçi eşitliği ölçmüyor |
| H4 | `middlewares/device.middleware.ts:38-42, 96-104`; `schema.prisma:800-824`; `device.service.ts:209-213`; `mobil/src/utils/deviceId.ts:17-34` | Cihaz kimliği **sırsız bearer** (Math.random UUID, public `GET /api/devices/status` ile makine atfı sorgulanır, LAN'da başlıkta düz gider): başka tabletin `deviceId`'sini gönderen kimlikli istemci onun `req.device`'ını alır → makine atfı, `closeForDevice` ile o cihazın oturumunu kapatma (`work-session.service.ts:354-357`), `getStampContext` `NEW_LOGIN` kapatması (`work-session.helper.ts:98-105`), yazıcı hedefi (`label.controller.ts:108-121`). Başlık göndermeyen istemci cihaz kapısını `pairingRequired=true` olsa bile atlar (`:38-42`) |
| H5 | `auth.controller.ts:375-397` + `auth.service.ts:405-430, 117-137` + `login-lockout.ts:33-41` | Prod'da (pairing kapalı) `GET /api/auth/mobile-users` **kimliksiz** `username+fullName` (8 kullanıcı); birincil giriş 6 haneli PIN (kullanıcı adı gerektirmez, `quickPin @unique`); lockout IP-anahtarlı in-memory (5/60 sn, 3 tur→15 dk; 28 cihazın her IP'si ayrı bütçe, restart'ta sıfır) → G: PIN uzayı (10⁶) / deneme bütçesi hesabı |
| H6 | `services/workorder-link.service.ts:774-780` + `workorder.routes.ts:702-708` | Planlamacı muafiyeti: `workorder:write` (roll:manual-adjust YOK) → `applyManualProperties` izinsiz → `IN_PRODUCTION` topun `colorId/width` toplu değişir. Kullanıcı kararı yazılı (2026-08-21); G yalnız kapsamı (`whereRollsOfWorkOrder`) ve `assertPlanEditable`'ı doğrulasın |
| H7 | prod `user_permissions` (§8.3) + `shipping.routes.ts:15-18` | SoD tasarımı (`role-template-catalog.ts:84-88, 237-238`) sahada uygulanmamış: `shipping:undo-dispatch` + `roll:manual-adjust` 8 aktif kullanıcının 6'sında, `admin:*` 3'ünde. Kod tarafında `INVOICE_WRITE` `shipping:write`i de kabul eder (tek yönlü SoD; yorum bilinçli). "Konfig/operasyon" hücresi |
| H8 | prod `system_settings` (`auth.autoLogoutOnExpiry=false`, `absoluteSessionCapDays=30`, `sameTypeSessionPolicy="off"`, `idleTimeoutMinutes=0`, `mobileIdleLockEnabled=false`); `sessions` 121 aktif | 30 günlük token + sınırsız paralel oturum + idle kilit yok; HTTP düz metin (`app.ts:96-101`). Kopyalanan token 30 gün geçerli; iptal yalnız admin (deactivate/reset) ya da logout. Kabul edilen risk mi, belgeli mi? |
| H9 | `services/search.service.ts:146-208, 224-225` (**KOD OKUNDU**) | `resolveExact` kova izin süzgecinden **muaf**: tam-format çuval no (`CV…`) ile **`sackNo + customer.name`** (`:165-176`), iş emri no ile `targetItem.name`, top barkodu ile `status + item.name` her kimlikli kullanıcıya (mobil-only dahil) döner; kova kuralı çuval için `shipping:read|write` isterdi (`search-entities.ts:141-144`). Alan kümesi dar — G failure_mode'u buna göre yazsın/reddetsin |
| H10 | `services/base.service.ts:856-932` | Tek raw SQL noktası ki tanımlayıcılar **konfigden** (`similarNameField/duplicateNameField/…`) ve `q()` ile kaçırılıyor; yedek yolda LIKE deseni parametre (`:920`). Enjeksiyon sondası yok; düşük öncelik |
| H11 | `auth.service.ts:266-273` + `auth.controller.ts:24-44` + `feature-flag.routes.ts:391-402` | Masaüstü kapısı `clientType` gövdeden; mobil-only hesap `clientType` göndermeden token alır → çıplak zincir uçları (`GET /api/feature-flags` **54 ayar**: `companyLetterhead.taxInfo`, `loginMethods`, `pinLockout*`, `backupHour`, `devicePairingRequired`) okunur. Yetki kaybı yok, bilgi yüzeyi |
| H12 | `middlewares/device.middleware.ts:60-73` | DB hatasında `pairingRequired` okunamazsa **fail-open** (yorum `:63`); pairing zorunlu kurulumda DB kesintisi cihaz kapısını açar (prod'da bayrak kapalı → bugün etkisiz) |
| H13 | `auth.service.ts:145-247`; `admin.routes.ts:521-524`; `schema.prisma:362-371` | PIN/kart **düz** saklanır ve `GET /users/:id/credentials` ile geri okunur; rotasyonda `tokenVersion` bump YOK (bilinçli). Yedek dump'ı (`admin:settings+admin:users`) tüm PIN'leri düz taşır — "veri sınıflandırma" |
| H14 | `role-template-catalog.ts:296-297, 307` + `auth.service.ts:266-273` + `Electron/src/types/auth.ts:85-88` | Tablet şablonları (`MOBILE_PRODUCTION_OPERATOR`, `MOBILE_TAMBUR`) `web` kategorili `label:edit`/`customer-alias:write` taşır → bu şablonla açılan operatör masaüstü kapısından geçer (Electron'a girer, `label:*` uçlarını kullanır). Tasarım sonucu; G "ekran izni ≠ masaüstü erişimi" varsayımını kontrol etsin |
| H15 | prod `devices` (28 APPROVED, `machineId` dolu **0**) + `getStampContext` enforce'suz 9 çağrı (§5.3) | Statik makine atfı hiç kurulmamış; atıf yalnız iş oturumundan. Enforce'suz uçlarda (`shipping.controller.ts:147`, `label.controller.ts:109, 533`, `tambur.controller.ts:287-328`, `kursun-qc.controller.ts:183`) oturum yoksa `machineId=null` sessizce yazılır — izlenebilirlik alanına (sınır ötesi), G için değil |
| H16 | `middlewares/auth.middleware.ts:74-102` | Her istekte 2 DB okuması + `lastSeenWrites` Map; 121 aktif oturum × yoklama → performans ajanına (sınır ötesi) |

---

## SINIR ÖTESİ NOTLAR

| Gözlem | Yer | Hangi alana |
|---|---|---|
| `verifyToken` her kimlikli istekte `user.findUnique` + `session.findUnique`; presence/lastSeen Map'leri tek-process | `auth.middleware.ts:16-43, 74-102` | Performans / havuz (K3-K7 veri-performans) |
| `bcrypt.compare` (bcryptjs saf JS, maliyet 10) event loop'ta; lockout bcrypt'ten ÖNCE | `auth.service.ts:73`; `auth.controller.ts:104-106` | Eşzamanlılık (CPU-bound, tek process) |
| `login-lockout` ve `presence` in-memory; `instances:1` invariant yazılı ama lockout için mekanik bekçi yok (SKILL §5) | `login-lockout.ts:24`, `presence.ts:10`, `ecosystem.config.js:42-48` | K8 / durum yerleşimi |
| `openLoginSession` advisory lock 8024 tx içinde okumadan önce (sıra doğru); `permission-management` 8025; namespace envanteri | `session-registry.service.ts:25-31, 72-79`; `permission-management.service.ts:604-610` | K3 kilit haritası |
| `sessions` 214 satır / 121 aktif; purge yalnız elle admin ucu; `sameTypeSessionPolicy=off` ile büyüme sınırsız | §2.4 | Veri hijyeni / ops |
| `GET /api/feature-flags` 54 anahtarı her kimlikli kullanıcıya döner; `documentsConfig`/`travelerCardConfig` dar izinle yazılır | `feature-flag.routes.ts:391-442` | K1 + G |
| `req.device.machineId` üretim atfı prod'da hep NULL (cihaz-makine ataması 0); atıf iş oturumundan | §6, H15 | İzlenebilirlik / audit (K4/K6) |
| `closeForDevice` cihazdaki tüm açık oturumları kapatır (kullanıcı eşleşmesi yok) | `work-session.service.ts:349-368` | K4 yazma yolları (WorkSession durum geçişi) |
| Mobil OTA public uçlarında dosya yolu doğrulaması (`dosyaBilgi`) | `mobile-update.routes.ts:44-83`, `config/mobile-update.ts:32-33` | Dosya erişimi (bekçi `test_mobile_update.ts §6`) |
| `backup download` yol doğrulaması `basename` + `.dump$` | `backup.service.ts:490-494` | Dosya erişimi |
| Swagger prod kapısı `NODE_ENV`, morgan `isProd` `APP_ENV??NODE_ENV` — iki bayrak | `swagger.ts:69`, `app.ts:120` | Konfig tutarlılığı |
| `Order.branchId` yalnız veri alanı; kullanıcı-şube bağı yok → şube bazlı raporlar izin süzgeci taşımaz | §7.2 | Rapor / K7 |
| `applyTemplate merge` `$transaction([...])` batch; `replace` interactive tx — iki farklı tx modeli aynı iş | `permission-management.service.ts:995-1021` | Mimari (bilgi) |
| `GET /api/admin/settings` 34 satırı ham döner (`updatedBy` dahil) | `admin.routes.ts:1105-1109`; `system-setting.service.ts:1012-1018` | K1 (yanıt kapsamı) |
| `DOC_PERMISSIONS.TRAVELER_CARD.write` listede ama uç 400 (`SELF_MANAGED_DOC_TYPES`) | `printed-document.routes.ts:76-94` | K1 / OCP kayıt defteri |

---

## KAPSANMAYAN / ERİŞİLEMEYEN

| Madde | Sebep |
|---|---|
| Prod `.env` içeriği / JWT secret'ın dev ile eşitliği | Canlı sunucuya erişim yok; sır rapora girmez. H1 [VARSAYIM] işaretli |
| 580 route'un tek tek izin eşlemesi; `label.routes.ts`/`peripheral.routes.ts`/`document-profile` tekil satırları | K1 (rota listesi) alanı; burada yalnız tarama sayıları (580 / 14 kimliksiz / 11 çıplak) ve mekanizma verildi |
| `linkOrderLines`/`unlinkOrderLine` route satırı guard'ı | Bu turda `workorder.routes.ts` yalnız `:594-604, 700-710` okundu; [VARSAYIM `workorder:write`] — K1 doğrulasın |
| `BaseService.safeSortBy` / `buildWhereClause` filtre allowlist'inin tam doğruluğu | Yalnız mekanizma satırı verildi (`base.service.ts:171, 191-200, 358`); K1/K3 alanı |
| `constants/time.ts` `Prisma.raw` çağıranlarının (9) tek tek `columnExpr` kaynağı | Bu turda okunmadı; [VARSAYIM: string literal] — raw tablosu ek notunda işaretli |
| `mobile-update` ve `backup` dosya yolu kaçış testleri | Dosya sistemi alanı; yalnız doğrulama kodunun yeri verildi |
| Electron/mobil istemci tarafı izin uygulamasının tam envanteri (karo/route/ekran) | Yalnız ayna mekanizmaları ve bekçileri haritalandı |
| `sync-*-permissions.ts` script'lerinin bugün koşup koşmadığı | Tarihsel; prod'da katalog dışı kod 0 olduğu için etkisi görünmüyor |
| Prod kopyasındaki son 5 migration'ın etkisi (190/195) | Yetki tablolarında (users/permissions/sessions/devices/work_sessions) kolon farkı gözlenmedi; tüm sorgular çalıştı |
| Canlı `system_logs` AUTH olaylarının IP dağılımı | Kişisel veri sınıfına yakın; sayım (184/62/54) ile yetinildi |
| `requirePermission(undefined)` davranışının çalıştırılarak doğrulanması | Salt-okunur kural; statik okuma (`rbac.middleware.ts:39-41`) + JS semantiğiyle çıkarıldı, sonda koşulmadı |
| `resolveExact` üzerinden dönen alanların istemcide nasıl kullanıldığı (Ctrl+K paletinde hangi ekrana götürdüğü) | Electron alanı; yalnız backend yanıt kümesi verildi (H9) |
