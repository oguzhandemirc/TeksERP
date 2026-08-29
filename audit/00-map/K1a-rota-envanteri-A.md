# K1a — Rota & Yüzey Envanteri (A: admin … label) — 2026-08-28

**Aşama:** ① KEŞİF (harita — yargı/bulgu YOK; ② için HOTSPOT işaretleri var).
**Dal/HEAD:** `adnansahin` @ `ce8681d1` (2026-08-28 01:08). **Yöntem:** salt-okuma (`cat -n`/grep; Swagger yorum blokları süzüldü, satır numaraları korundu), iki izole ölçüm (§0.2), prod kopyasında 3 salt-okunur sorgu (`audit/tools/sql-saha.sh`). Hiçbir kaynak dosya değiştirilmedi.
**Kapsam:** `Teks-Erp/src/routes/` altındaki 30 dosya (admin → label, alfabetik) + `src/app.ts` doğrudan rotaları + global middleware zinciri. Yollar repo köküne göredir; `T=Teks-Erp/src` kısaltması kullanılır.

---

## 0. Yöntem, kısaltmalar, ölçümler

### 0.1 Kapı zinciri çözüm kaynakları (beceri §7.8 — altı kaynak)

| # | Kaynak | Bu kapsamda nerede görüldü |
|---|---|---|
| 1 | Route satırında doğrudan | Dosyaların çoğu (`verifyToken, requirePermission(...)`) |
| 2 | Dosya içi DİZİ sabiti + spread | `inventory.routes.ts:13-45` (`MOBILE_ROLL_READ/WRITE_KK1/WRITE_KURSUN/CANCEL`), `label.routes.ts:20` (`MOBILE_LABEL_PRINTERS`), `defect-type.routes.ts:14`, `customer.routes.ts:11`, `constants/document-design.ts:37-44` (`DOCUMENT_DESIGN_READ/WRITE` — dosya DIŞI sabit, `...` ile yayılır), `config-bundle.routes.ts:35-36` (`ANY_BUNDLE_READ/WRITE` — `BUNDLE_PERMISSIONS`'tan TÜRETİLİR) |
| 3 | Dosya içi TEKİL sabit (hazır middleware) | `kursun-bypass.routes.ts:16-19,35-41` (`canDistribute`, `canSeeVisibility`), `label.routes.ts:463` (`SACK_LABEL_READ`), `customer-branch-list.routes.ts:30-37` (`READ`) |
| 4 | `router.use(guard)` toplu | **HİÇ YOK** (30 dosyada 0; `test_route_auth_coverage.ts:5-6` de bunu doğruluyor). Tek `router.use` kullanımı iç içe mount içindir: `customer.routes.ts:39-45` |
| 5 | Mount / global zincir | `app.ts:102-175` global zincir (kimlik guard'ı YOK — global `verifyToken` yok); `app.ts:562-569` `/api/admin/health` mount noktasında guard taşıyan TEK uç |
| 6 | Handler İÇİNDE dinamik çözüm | `feature-flag.routes.ts:38-46` (`flagWriteGuard`), `config-bundle.routes.ts:45-59` (`assertKindPermissions`), `import.routes.ts:31-64` (`requireEntityWrite/Read`), `inventory.controller.ts:274-292` (`semiFinished` → `mobile:kk1-yari-mamul` ∨ `roll:write`), `inventory.controller.ts:350-354` (`production-flow` kolon süzgeci), `inventory.controller.ts:676,715` → serviste `opts.permissions` (`roll:manual-adjust` FREE_STOCK dışı), `auth.controller.ts:377-386` (`mobile-users` cihaz kapısı bayrağa bağlı). Tam liste §8 |

Router değişken adları: 28 dosyada `router`; `device.routes.ts` iki router export eder (`devicePublicRouter:14`, `deviceAdminRouter:52`). Kapsamdaki hiçbir dosyada küçük-harf `guard` dizisi yok (o desen `reports/*` — K1c kapsamı).

### 0.2 İki izole ölçüm (repro)

| Ölçüm | Sonuç | Kanıt |
|---|---|---|
| **Route-katmanı `express.json({limit:"10mb"})` global `express.json({limit:"1mb"})`in ARKASINDA çalışıyor mu?** (`import.routes.ts:28,242,279`, `config-bundle.routes.ts:27,133,158`; `app.ts:141` global parser ÖNCE) | **HAYIR.** İzole Express 5.2.1 sondası: 0.51 MB gövde → 200; **2.04 MB gövde → 413 `entity.too.large`** (global parser içerik-uzunluğunu okur okumaz reddediyor, route-level `jsonBig` HİÇ koşmuyor). `app.ts:546-549` ve `import.routes.ts:15-18` yorumları "10 MB / 10.000 satır" vaat ediyor — **etkin sınır 1 MB** | Sonda: `<scratchpad>/json-limit-probe.mjs` (Teks-Erp'in kendi `express` paketiyle) |
| **`scripts/test_route_auth_coverage.ts` (kimlik kapsaması bekçisi) HEAD'de yeşil mi?** | **KIRMIZI (13 geçti / 1 başarısız):** "muaf listesi dışında kimlik doğrulamasız uç — `GET /`". Kaynak: `client-policy.routes.ts:59` `GET /` (2026-08-28 01:08, `ce8681d1` ile eklendi; bekçinin `EXEMPT` listesi son olarak `b57c9c68` 2026-08-27'de güncellendi ve yalnız `GET /:istemci`'yi taşıyor). Bekçi 580 route layer taradı, 14'ü `verifyToken` taşımıyor (13 muaf + bu). Route satırında izin guard'ı olmayan uç sayısı 12 (taban 12, aşım yok) | `npx tsx scripts/test_route_auth_coverage.ts` çıktısı (SAF — DB'ye yazmaz) |

### 0.3 Sütun sözlüğü

- **Kapı zinciri:** sırayla; `VT` = `verifyToken`; `P(x)` = `requirePermission(x)`; `ANY(a,b)` = `requireAnyPermission(a,b)`; `P(a) → P(b)` = zincirleme **AND**; `YOK` = kimliksiz (public).
- **Doğrulama:** Zod şeması (dosya:satır) · `DMMF` = `BaseService.sanitizeWriteData` (model alan allowlist'i, `base.service.ts:659-676`) + `normalizeNameFields` (:690) + `assertNameNotDuplicate` (:729) — Zod DEĞİL · `uuid✓` = `assertValidUuid` ya da `z.string().uuid()` path-param doğrulaması var · `uuid✗` = `req.params.x as string` (geçersiz değer Prisma P2007/P2023 → `error.middleware.ts:447-463` → 400) · `gövde yok` = uç gövde okumaz.
- **Yazma:** R salt-okuma · W yazma · D yıkıcı (iptal/sil/statü düşürme) · X dış dünya (dosya sistemi, child process, RAW TCP) · `R(POST)` = POST ama salt-okunur.
- **Yanıt:** aksi yazılmadıkça `{success, data}` / servisin `ApiResponse`'u (servis gövdeleri OKUNMADI — §KAPSANMAYAN).

### 0.4 Özet sayılar (bu kapsam)

| Ölçüt | Değer | Kaynak |
|---|---|---|
| Rota (30 dosya) | **273** (dosya başına: admin 46 · auth 9 · batch 4 · client-policy 2 · color 6 · config-bundle 4 · currency 1 · customer-alias 7 · customer-branch-list 1 · customer-branch 4 · customer-standalone-label 2 · customer-template-route 2 · customer 7 · dashboard 2 · db-copy 5 · defect-type 7 · device 12 (3 public + 9 admin) · discovery 1 · document-profile 5 · fabric-property 6 · feature-flag 4 · free-document 6 · import 8 · inventory 28 · item 10 · kartela 13 · kursun-bypass 8 · kursun-qc 12 · label-template 24 · label 27) | `grep -cE '^\s*(router\|devicePublicRouter\|deviceAdminRouter)\.(get\|post\|put\|patch\|delete)\('` her dosyada |
| `app.ts` doğrudan | **2 rota + 1 catch-all** (`GET /health`:479, `GET /api/admin/health`:562, `app.use("/api", 404)`:598) | app.ts |
| **Toplam** | **275 rota + catch-all** | — |
| Yazma METODU taşıyan (POST/PUT/PATCH/DELETE) | **140** — bunların **8'i salt-okunur POST** (`rolls/stats-batch`, `config-bundle/preview`, `label-templates/preview-raw`, `label-templates/preview`, `labels/rolls/bulk-html`, `labels/rolls/bulk-native`, `labels/preview/html`, `labels/preview/native-text`) + `import/:entity/preview` [VARSAYIM: run kaydı yazabilir] → gerçek yazma ≈ **131** | §1-§5 tabloları |
| Kimlik doğrulamasız (public) | **12 rota** (+ `/api` 404, statik `public/`, `/api-docs` yalnız non-prod) — tamamı bilinçli/beyanlı; 1'i bekçide beyansız (§0.2) | §6 |
| `VT` var, route satırında RBAC YOK | **9** (auth ×4, currencies, document-profiles ×2, feature-flags ×2) — bekçi tabanı 12'nin geri kalan 3'ü K1b/K1c dosyalarında (`record-info`, `reason-presets`, `search`) | §6.2 |
| Zod'suz GÖVDELİ yazma | **12** — 10'u `BaseController.create/update` (DMMF allowlist), `DELETE /api/rolls/:id` (query sözleşmesi), `POST /api/labels/rolls/:id/print-native` (query) | §7 |
| Gövdesiz yazma (Zod gerekmez; yalnız path-param) | **30** | §7 |
| Handler içi dinamik izin çözümü | **8 nokta** | §8 |
| Path-param UUID doğrulaması OLAN uç | 27 (BaseController `findById/update/remove/hardRemove` ×5 dosya = 20, free-document 3, document-profile 3, kursun-bypass 3, kursun-qc 3, device detail 1, defect-type permanent 1) — geri kalan **~95 param'lı uç `uuid✗`** | §1-§5 |
| İki izni AND'leyen uç | **10** (admin 5: `backups`, `download`, `restore-impact`, `PATCH offsite`, `offsite/authorize` + db-copy 5) — prod kopyasında her ikisini taşıyan aktif kullanıcı **4** | `sql-saha` |
| Route-katmanı `express.json` (10 MB) | 4 uç (`import preview/apply`, `config-bundle preview/apply`) — **etkisiz** (§0.2) | ölçüm |

---

## 1. Global middleware zinciri ve `app.ts` doğrudan rotaları

### 1.1 Zincir (sırayla — `T/app.ts`)

| Sıra | Middleware | Satır | Davranış / not |
|---|---|---|---|
| 1 | `helmet` | 102-110 | CSP `useDefaults` + `upgradeInsecureRequests: null` (HTTP-only LAN), `strictTransportSecurity: false` |
| 2 | `cors` | 114 | Origin kısıtı YOK (varsayılan `*`); `exposedHeaders`: `X-Label-Language`, `X-Label-Kind`, `X-Label-Count`, `X-Label-Template-Id`, `X-Label-Variant-Match`, `Date` |
| 3 | `compression` | 117 | eşik 1 KB |
| 4 | `morgan` | 121 | `combined` (prod) / `dev`; prod kararı `APP_ENV ?? NODE_ENV` (:120) |
| 5 | `latencyMiddleware` | 128 → `middlewares/latency.middleware.ts:96-112` | finish/close; route anahtarı normalize (UUID/sayı/uzun opak → `:id`); 413/400'e düşen `/api/*` istekleri de anahtarlanır (:77-86); istemci abort 499 |
| 6 | `express.json({limit:"1mb"})` | 141 | **Tek gövde ayrıştırıcı — route-level 10 MB katmanı buna takılır (§0.2)**. Bozuk JSON → 400 (`error.middleware.ts:281`), aşım → 413 (:291). `Content-Type` JSON değilse `req.body` undefined (BaseService 400 :661-665; Zod `parse(undefined)` → 400) |
| 7 | `setupSwagger` | 146 → `config/swagger.ts:69-70` | `/api-docs` yalnız `NODE_ENV !== "production"` — dikkat: app.ts prod kararı `APP_ENV ?? NODE_ENV`, swagger yalnız `NODE_ENV` (ecosystem ikisini de `production` veriyor: `ecosystem.config.js:76-77`) |
| 8 | `express.static(public)` | 157-158 | `Teks-Erp/public/`: `index.html`, `status.js`, `logo.png` (durum sayfası) |
| 9 | `resolveDevice` | 169 → `middlewares/device.middleware.ts:33-105` | `x-device-id` yoksa geç; `EXEMPT_PATHS` 3 yol (:27-31, `req.path` normalize); `DeviceService.resolveDevice` DB hatası → `pairingRequired` ise 503 `DEVICE_CHECK_UNAVAILABLE`, değilse **fail-open geç** (:65-73, bilinçli); cihaz yok → `pairingRequired` ise 401 `DEVICE_INACTIVE`, değilse geç; onaylı → `req.device{id,deviceId,name,machineId,kind}` + `touchDevice`. Prod kopyası: `device.pairingRequired=false`, 28 APPROVED / 0 PENDING cihaz |
| 10 | `runWithRequestContext` | 175 → `lib/request-context.ts:39-41` | AsyncLocalStorage; `req` nesnesi saklanır (kopyalanmaz), `requestId` UUID; audit "nereden" buradan okur |
| 11 | `GET /health` | 479-495 | **PUBLIC**, `SELECT 1`; 6 alan (`status, message, api, db, version, time`) — sözleşme dondurulmuş (bekçi 5 alanı kilitler) |
| 12 | Mount'lar | 500-587 | Tablo §1.2 |
| 13 | `/api` JSON 404 | 598-603 | Tanımsız `/api/*` → `{success:false, message}` |
| 14 | `errorHandler` | 608 → `middlewares/error.middleware.ts:244-634` | AppError → kendi statüsü; SyntaxError 400; `entity.too.large` 413; pool timeout (çıplak Error) 503 + audit; CHECK 23514 → 409 + audit; P2002 409 · P2025 404 · P2003 400 · P2007 400 · P2023 400 · P2020 400 · `SERVER_FAULT` (P2021/22/10/15/17/18) 500 + audit · P2014 400 · P2034 409 · P2024/P2028 503 · `CLIENT_DATA` 400 · tanınmayan Prisma kodu 500 + audit; `PrismaClientValidationError` 400; `ZodError` 400 `{errors:[{field,message}]}`; diğer 500 + audit; `headersSent` ise soket kesilir |

**Kimlik/yetki middleware'leri (route satırlarından çağrılır):**

| Middleware | Dosya:satır | Davranış |
|---|---|---|
| `verifyToken` | `middlewares/auth.middleware.ts:55-110` | `Bearer` (case-insensitive) → `AuthService.verifyToken` (JWT) → `user.findUnique` (`isActive`, `tokenVersion` eşleşmeli) → `jti` zorunlu (eski token fail-closed) → `session.findUnique` (`revokedAt` null) → `req.user = payload` (izinler JWT payload'ında; `auth.service.ts:253-326` `issueToken`) + `touchUser` + `touchSessionLastSeen` (60 sn throttle, fire-and-forget, modül-seviye `Map` :16). **Her istekte 2 DB sorgusu** |
| `requirePermission(x)` | `middlewares/rbac.middleware.ts:53-69` | `req.user` yoksa 401; `matchesPermission` (:35-47: `*`, tam eşleşme, `domain:*` — domain = İLK iki noktaya kadar) değilse 403. Zincirleme = AND. `x === undefined` → `required.indexOf` TypeError → Express 5 `next(err)` → **500** (fail-closed ama 403 değil) — kapsamda böyle bir çağrı YOK |
| `requireAnyPermission(...xs)` | `rbac.middleware.ts:74-94` | OR |
| `assertValidUuid` | `middlewares/uuid-param.middleware.ts:18-25` | Helper (middleware DEĞİL); `BaseController.getParamId` (:14-18) ve bazı inline handler'lar çağırır |
| Login lockout | `middlewares/login-lockout.ts` | Route zincirinde DEĞİL — `auth.controller.ts:118-128,202-213,281-292` içinden; anahtar `req.ip` (`trust proxy` YOK → soket IP), modül-seviye `Map` (:24), `auth.pinLockoutEnabled` canlı okunur (prod kopyasında satır yok → varsayılan `true`, `system-setting.service.ts:399`) |
| `getStampContext(req, {enforceForMobile})` | `services/helpers/work-session.helper.ts:86-116+` | `req.device` yoksa null; aktif çalışma oturumu; `enforceForMobile` + cihaz `DESKTOP` değil + oturum yok → **409 `WORK_SESSION_REQUIRED`** (route satırında GÖRÜNMEZ — §8) |

### 1.2 Mount haritası (bu kapsam) — `T/app.ts`

| Önek | Router | app.ts satırı | Not |
|---|---|---|---|
| `/api/auth` | auth.routes | 500 | |
| `/api/items` | item.routes | 501 | |
| `/api/customers` | customer.routes (+4 iç mount) | 502 | `customer.routes.ts:39-45`: `/:customerId/branches` → customer-branch; `/:customerId` → customer-alias, customer-template-route, customer-standalone-label (üçü `mergeParams:true`) |
| `/api/customer-branches` | customer-branch-list.routes | 503 | |
| `/api/rolls` | inventory.routes | 509 | |
| `/api/kursun-qc` | kursun-qc.routes | 516 | |
| `/api/kursun-bypass` | kursun-bypass.routes | 517 | |
| `/api/batches` | batch.routes | 521 | |
| `/api/kartela` | kartela.routes | 524 | |
| `/api/defect-types` | defect-type.routes | 526 | |
| `/api/colors` | color.routes | 528 | |
| `/api/fabric-properties` | fabric-property.routes | 529 | |
| `/api/labels` | label.routes | 532 | |
| `/api/label-templates` | label-template.routes | 533 | |
| `/api/document-profiles` | document-profile.routes | 536 | |
| `/api/free-documents` | free-document.routes | 537 | |
| `/api/currencies` | currency.routes | 540 | |
| `/api/feature-flags` | feature-flag.routes | 541 | |
| `/api/discovery` | discovery.routes | 545 | PUBLIC |
| `/api/import` | import.routes | 550 | (10 MB parser vaadi — §0.2) |
| `/api/config-bundle` | config-bundle.routes | 554 | |
| `/api/admin/db-copies` | db-copy.routes | 557 | `/api/admin`'den ÖNCE (bilinçli) |
| `GET /api/admin/health` | inline | 562-569 | `VT → P(admin:settings)` → `buildRichHealth` (338-466) |
| `/api/admin` | admin.routes | 570 | |
| `/api/dashboard` | dashboard.routes | 571 | |
| `/api/devices` | device.routes `devicePublicRouter` | 573 | PUBLIC |
| `/api/admin/devices` | device.routes `deviceAdminRouter` | 574 | `/api/admin`'den SONRA — admin.routes'ta `/devices` ya da catch-all yok, bugün gölgelenme yok |
| `/api/client-policy` | client-policy.routes | 587 | PUBLIC |

Kapsam dışı mount'lar (K1b/K1c): `/api/stations`, `/api/machines`, `/api/peripherals`, `/api/routes`, `/api/product-recipes`, `/api/orders`, `/api/record-info`, `/api/work-orders`, `/api/production-balance`, `/api/tambur`, `/api/traveler-cards`, `/api/traveler-templates`, `/api/subcontractor(s|-categories)`, `/api/swatches`, `/api/quality-grades`, `/api/station-capabilities`, `/api/reason-presets`, `/api/shipping`, `/api/printed-documents`, `/api/returns`, `/api/return-reasons`, `/api/master-data`, `/api/reports`, `/api/work-sessions`, `/api/search`, `/api/mobile`.

### 1.3 `app.ts` doğrudan rotaları

| Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|
| GET | `/health` | **YOK (bilinçli public)** | inline `app.ts:479-495` → `prisma.$queryRaw SELECT 1` | — | R | `{status:"UP", message, api, db:"UP"\|"DOWN", version, time}` — 200 her zaman |
| GET | `/api/admin/health` | `VT → P(admin:settings)` | inline `app.ts:562-569` → `buildRichHealth()` (:338-466: pg_stat sorgusu, `AuditService.getHealth`, `getPoolHealth`, `getOffsiteHealth`, disk, presence, mDNS, CPU/RAM) | — | R | Zengin pano: dbSize, conns, cache hit, rolls dead %, en uzun sorgu, blocked, restore copy sayısı/bytes, `lastBackup`, havuz sayaçları, offsite, disk, online kullanıcı/cihaz, `auditWriteFailures`, **`lastAuditError` (ham metin)**, `auditGuard`, `discovery.installationId`, kaynak metrikleri |
| * | `/api/*` (tanımsız) | — | inline `app.ts:598-603` | — | — | 404 `{success:false, message:"Endpoint bulunamadı: METHOD url"}` |

---
## 2. Dosya başına rota tabloları — A (admin … currency)

### 2.1 `T/routes/admin.routes.ts` → `/api/admin` (46 rota) — controller YOK, 46/46 inline (Zod parse + servis)

Kısaltma: `A:u` = `admin:users`, `A:s` = `admin:settings`. Tüm uçlar `VT →` ile başlar.

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/admin/permissions` | `VT → P(A:u)` | :53 → `PermissionManagementService.listPermissions` | — | R | `{success,data}` |
| 2 | GET | `/api/admin/screens` | `VT → P(A:u)` | :82 → `SCREEN_CATALOG` + `permissionsWithoutScreen()` (statik, DB yok) | — | R | `{screens, withoutScreen}` |
| 3 | GET | `/api/admin/users` | `VT → P(A:u)` | :111 → `listUsers` | — | R | liste |
| 4 | POST | `/api/admin/users` | `VT → P(A:u)` | :158 → `createUser` | `createUserSchema` :125-142 (username `^[a-zA-Z0-9]+$` 3-40, password ≥6, `grantOperatorDefaults`, `generateMobileCredentials`) | W | 201 |
| 5 | GET | `/api/admin/users/:id` | `VT → P(A:u)` | :184 → `getUserById` | uuid✗ | R | |
| 6 | PATCH | `/api/admin/users/:id` | `VT → P(A:u)` | :207 → `updateUser` | `updateUserSchema` :144-148 (yalnız `fullName`) · uuid✗ | W | |
| 7 | POST | `/api/admin/users/:id/deactivate` | `VT → P(A:u)` | :235 → `deactivateUser` | gövde yok · uuid✗ | W (oturumları düşürür) | |
| 8 | POST | `/api/admin/users/:id/reactivate` | `VT → P(A:u)` | :260 → `reactivateUser` | gövde yok · uuid✗ | W | |
| 9 | DELETE | `/api/admin/users/:id` | `VT → P(A:u)` | :285 → `deleteUser` | gövde yok · uuid✗ | D (soft: `deletedAt`, oturum revoke) | |
| 10 | GET | `/api/admin/users/:id/permissions` | `VT → P(A:u)` | :315 → `getUserPermissions` | uuid✗ | R | |
| 11 | POST | `/api/admin/users/:id/permissions` | `VT → P(A:u)` | :352 → `grantPermission` | `grantSchema` :329-342 (validFrom/validUntil tutarlılık refine ×2) | W (upsert) | 201 |
| 12 | PUT | `/api/admin/users/:id/permissions` | `VT → P(A:u)` | :406 → `setUserPermissions` | `setSchema` :388-394 (`permissions[]` VEYA `permissionIds[]` — normalize :413-415) | W (hedef-durum; eksikleri KALDIRIR) | |
| 13 | DELETE | `/api/admin/users/:id/permissions/:permissionId` | `VT → P(A:u)` | :436 → `revokePermission` | gövde yok · uuid✗ (iki param) | D | 204 |
| 14 | POST | `/api/admin/users/:id/reset-password` | `VT → P(A:u)` | :467 → `resetUserPassword` | `resetPasswordSchema` :454-456 | W (tokenVersion++, oturum revoke) | 204 |
| 15 | POST | `/api/admin/users/:id/card-token` | `VT → P(A:u)` | :495 → `AuthService.rotateCardToken` | gövde yok · uuid✗ | W (sır rotasyonu — her çağrı yeni token) | `{data:{...}}` |
| 16 | GET | `/api/admin/users/:id/credentials` | `VT → P(A:u)` (**tek izin**) | :521 → `AuthService.getUserCredentials` | uuid✗ | R **hassas** (düz hızlı PIN + kart kodu) | |
| 17 | POST | `/api/admin/users/:id/quick-pin` | `VT → P(A:u)` | :550 → `AuthService.setQuickPin` | `quickPinSchema` :535-539 (`pin` 6 hane opsiyonel — verilmezse rastgele; `clear`) | W | |
| 18 | POST | `/api/admin/users/:id/apply-template` | `VT → P(A:u)` | :584 → `applyTemplate` | `applyTemplateSchema` :569-572 (`mode` merge\|replace) | W (`replace` mevcut yetkileri siler) | |
| 19 | GET | `/api/admin/permission-templates` | `VT → P(A:u)` | :615 → `listTemplates` | — | R | |
| 20 | GET | `/api/admin/permission-templates/:id` | `VT → P(A:u)` | :629 → `getTemplate` | uuid✗ | R | |
| 21 | POST | `/api/admin/permission-templates` | `VT → P(A:u)` | :649 → `createTemplate` | `createTemplateSchema` :643-647 | W | 201 |
| 22 | PATCH | `/api/admin/permission-templates/:id` | `VT → P(A:u)` | :673 → `updateTemplate` | `updateTemplateSchema` :664-671 (`isActive` dahil) | W | |
| 23 | DELETE | `/api/admin/permission-templates/:id` | `VT → P(A:u)` | :692 → `deleteTemplate` | gövde yok · uuid✗ | D (sistem rolü pasifleştirme) | 204 |
| 24 | GET | `/api/admin/perf` | `VT → P(A:s)` | :721 → `latencySnapshot()` + `getLatencyPersistHealth()` (bellek) | — | R | |
| 25 | GET | `/api/admin/perf/history` | `VT → P(A:s)` | :755 → `latencyHistory(days, route)` + `latencyHistoryRoutes` | `perfHistoryQuerySchema` :739-742 (**query**, days 1-90) | R | `{days, route, series, routes}` |
| 26 | POST | `/api/admin/perf/reset` | `VT → P(A:s)` | :782 → `resetLatencyStats()` + **route içinde `AuditService.log`** :790 | gövde yok | W (bellek sayaç) | `{reset:true}` |
| 27 | POST | `/api/admin/sessions/purge` | `VT → P(A:s)` | :825 → `SessionRegistryService.purgeDeadSessions` + audit :833 | `sessionPurgeSchema` :808-810 (7-365, default 90; `req.body ?? {}`) | **D fiziksel DELETE** | `{deleted}` |
| 28 | POST | `/api/admin/system-logs/archive` | `VT → P(A:s)` | :863 → `AuditService.archiveOlderThan` + `logEvent(AUDIT_ARCHIVE)` :873 | `archiveSchema` :851-853 (1-120 ay) | D (arşiv tablosuna taşır) | `{archived, cutoff}` |
| 29 | GET | `/api/admin/system-logs/stats` | `VT → P(A:s)` | :894 → `getLogStats` | — | R | |
| 30 | GET | `/api/admin/system-logs` | `VT → P(A:s)` | :951 → `SystemLogService.list` | `systemLogListQuerySchema` :914-941 (**query** allowlist: cursor, limit ≤100, userId uuid, tableName, recordId, requestId, category regex, action, dateFrom/To datetime) | R (cursor) | servis şekli |
| 31 | GET | `/api/admin/system-logs/users` | `VT → P(A:s)` | :974 → `listActiveUsers` | — | R | |
| 32 | GET | `/api/admin/system-logs/tables` | `VT → P(A:s)` | :996 → `listActiveTables` | — | R | |
| 33 | GET | `/api/admin/system-logs/archive` | `VT → P(A:s)` | :1018 → `listArchive` | aynı query şeması | R | |
| 34 | GET | `/api/admin/system-logs/archive/:id` | `VT → P(A:s)` | :1041 → `findArchiveById` | uuid✗ | R | 200/404 |
| 35 | GET | `/api/admin/system-logs/:id` | `VT → P(A:s)` | :1063 → `findById` — literal kardeşlerinden SONRA (sıra doğru) | uuid✗ | R | 200/404 |
| 36 | GET | `/api/admin/settings` | `VT → P(A:s)` | :1105 → `systemSettingService.list` | — | R (TÜM ayarlar) | |
| 37 | PUT | `/api/admin/settings/:key` | `VT → P(A:s)` | :1144 → `STRUCTURED_SETTING_KEYS` guard :1089-1093,1151 (yalnız 3 anahtar reddedilir) → `systemSettingService.set` (`system-setting.service.ts:1032-1050`: **herhangi bir key upsert** — allowlist YOK) | `settingUpsertSchema` :1081-1084 (`value` string ≤2000) · `:key` serbest | W | |
| 38 | POST | `/api/admin/backup` | `VT → P(A:s)` | :1190 → `triggerManualBackup()` (child `pg_dump`) + `logEvent(BACKUP_TRIGGER)` | gövde yok | W + X | 202 / 400 ("sürüyor") |
| 39 | GET | `/api/admin/backups` | `VT → P(A:s) → P(A:u)` **AND** | :1223 → `listBackups()` | — | R + X (fs) | `{success, ...list}` |
| 40 | GET | `/api/admin/backups/:name/download` | `VT → P(A:s) → P(A:u)` | :1256 → `resolveBackupPath(name)` (allowlist; yoksa 404) + `logEvent(BACKUP_DOWNLOAD)` → `res.download` | `:name` serbest (serviste basename/uzantı/ön ek kontrolü) | R + X (**hassas dump akışı**) | dosya |
| 41 | GET | `/api/admin/backups/:name/restore-impact` | `VT → P(A:s) → P(A:u)` | :1308 → `getRestoreImpact(name)` + `logEvent(BACKUP_RESTORE_PREVIEW)` | `:name` serbest | R (+audit) | 200/404 |
| 42 | GET | `/api/admin/backups/offsite` | `VT → P(A:s)` | :1361 → `getOffsiteHealth` + `readOffsiteRemote/Dir` + `rcloneConfigPath()` + `RCLONE_BIN()` | — | R (config **yolu** + rclone binary yolu döner) | `{...health, config:{remote, localDir, configPath, rcloneBin}}` |
| 43 | PATCH | `/api/admin/backups/offsite` | `VT → P(A:s) → P(A:u)` | :1403 → `systemSettingService.set` ×2 (`BACKUP_OFFSITE_REMOTE/DIR`) | `offsiteConfigSchema` :1391-1400 (boş string = kapat) | W | `{remote, localDir}` |
| 44 | POST | `/api/admin/backups/offsite/test` | `VT → P(A:s)` | :1437 → `testOffsiteRemote()` (rclone child) | gövde yok | X | |
| 45 | POST | `/api/admin/backups/offsite/sweep` | `VT → P(A:s)` | :1451 → `runOffsiteSweepNow()` → `getOffsiteHealth()` | gövde yok | X | |
| 46 | POST | `/api/admin/backups/offsite/authorize` | `VT → P(A:s) → P(A:u)` | :1477 → `writeRcloneDriveToken(name, token)` (**sırrı rclone config dosyasına yazar**) + `logEvent(OFFSITE_REMOTE_AUTHORIZED)` (token değil yol) | `offsiteTokenSchema` :1465-1468 (token 20-8000) | W + X | `{message}` |

Notlar: (a) 40 → 46 rota (2026-08-09'a göre +6: #2, #42-#46). (b) Route katmanından doğrudan `AuditService` çağrısı: :790, :833, :873, :1198, :1272, :1327, :1487 (7 yazma) — `logEvent` çağrıları `await`'li (audit hatası isteği düşürür mü? `AuditService` best-effort ise hayır — servis OKUNMADI, [VARSAYIM]). (c) Rota sırası: `/backups/offsite*` (2-3 segment literal) ile `/backups/:name/download|restore-impact` (3 segment, `:name` + literal) çakışmaz; `POST /backups/offsite/test` ↔ `GET /backups/:name/download` metot da farklı.

### 2.2 `T/routes/auth.routes.ts` → `/api/auth` (9 rota) — `AuthController` (static) + `UserPreferenceController`

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/auth/login` | **YOK (bilinçli public — token üreten uç)**; handler içi: lockout `reserveLoginAttempt` (`auth.controller.ts:118-128`, `AuthService.login`den ÖNCE) | `AuthController.login` :86 → `AuthService.login(username, password, ctx)`; başarı/başarısızlık `AuditService.logEvent` (AUTH) | `loginSchema` :27-32 (`clientType` electron\|mobile, `confirmKick`) | W (Session yaratır) | `{data:{token, user}, message}`; 401 kimlik · 429 `LOGIN_LOCKED` · 409 `SESSION_EXISTS` (lockout rezervasyonu 401 dışı hatada geri alınır :161-162) |
| 2 | POST | `/api/auth/login-card` | **YOK (bilinçli public)** + lockout :202-213 | `loginCard` :189 → `AuthService.loginWithCard` | `loginCardSchema` :34-38 (`cardCode` ≤120) | W | aynı |
| 3 | POST | `/api/auth/login-quick-pin` | **YOK (bilinçli public)** + lockout :281-292 | `loginQuickPin` :268 → `AuthService.loginWithQuickPin` | `loginQuickPinSchema` :40-44 (`pin` 6 hane) | W | aynı |
| 4 | GET | `/api/auth/login-methods` | **YOK (bilinçli public)** | `loginMethods` :342 → `readLoginMethods` + `readCompanyName` | — | R | `{enabled[], primary, companyName}` (prod kopyası: `["list","pin"]`, primary `pin`) |
| 5 | GET | `/api/auth/mobile-users` | **YOK** — cihaz kapısı YALNIZ `device.pairingRequired=true` iken (:377-386 → 401 `DEVICE_REQUIRED`); prod kopyasında bayrak **false** → tamamen public | `mobileUsers` :375 → `AuthService.listMobileUsers()` (`auth.service.ts:414-427`: aktif kullanıcılar, `select id, username, fullName`) | — | R (kullanıcı listesi ifşası) | `{data:[{id, username, fullName}]}` |
| 6 | GET | `/api/auth/me` | `VT` (RBAC yok — self-servis) | `me` :414 → `getActiveUserSummary` | — | R | `{userId, username, fullName, permissions}` |
| 7 | POST | `/api/auth/logout` | `VT` | `logout` :461 → `SessionRegistryService.revokeSession(jti,"LOGOUT")` (best-effort `.catch`) + audit | gövde yok | W (session revoke) | `{success, message}` |
| 8 | GET | `/api/auth/preferences` | `VT` | `UserPreferenceController.getMine` :38 → `UserPreferenceService.get(userId)` | — | R | |
| 9 | PUT | `/api/auth/preferences` | `VT` | `updateMine` :70 → `save` (upsert; audit MUAF) | `preferencesSchema` `user-preference.controller.ts:18-23` (`record`, serileştirilmiş ≤64 KB) | W | `{data, message}` |

### 2.3 `T/routes/batch.routes.ts` → `/api/batches` (4 rota) — `BatchController`

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/batches/number-state` | `VT → ANY(workorder:read, admin:settings, mobile:hizli-is-emri)` | `numberState` `batch.controller.ts:47` → `getBatchNumberState` | — | R (sıradaki no ÖNİZLEME) | `{data:{last, next}}` [VARSAYIM şekil] |
| 2 | POST | `/api/batches/move-rolls` | `VT → P(workorder:write)` | `moveRolls` :56 → `svcMoveRolls` | `moveSchema` :18-21 | W | `{data, message:"N top … taşındı"}` |
| 3 | POST | `/api/batches/merge` | `VT → P(workorder:write)` | `mergeBatches` :71 → `svcMergeBatches` | `mergeSchema` :22-24 (≥2 uuid) | W (atomik claim serviste) | `{data:{survivorNumber, mergedNumbers}}` |
| 4 | POST | `/api/batches/:batchId/split` | `VT → P(workorder:write)` | `splitBatch` :86 → `svcSplitBatch` (`pg_advisory_xact_lock(8022,1)` serviste) | `splitSchema` :25-27 · `:batchId` uuid✗ | W (yeni parti no) | 201 `{data:{newBatchNumber}}` |

### 2.4 `T/routes/client-policy.routes.ts` → `/api/client-policy` (2 rota) — **YENİ dosya (2026-08-27/28), tamamen public, DB'siz**

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/client-policy/` | **YOK** (dosya yorumu :8-11 "PUBLIC ve bilinçli"; **bekçi `EXEMPT` listesinde YOK → `test_route_auth_coverage` KIRMIZI**, §0.2) | inline :59-64 → `{apiVersion: APP_VERSION, clients: CLIENT_VERSION_POLICIES}` | — | R | electron `{minVersion 2.8.1, currentVersion 2.8.2}`, mobil `{2.9.8, 2.9.8}` (`config/client-version-policy.ts:90-91,125-126`) |
| 2 | GET | `/api/client-policy/:istemci` | **YOK** (bekçide beyanlı) | inline :83-92 → `CLIENT_VERSION_POLICIES[lower(istemci)]` | — | R | 200 `{apiVersion, ...policy}` / 404 |

### 2.5 `T/routes/color.routes.ts` → `/api/colors` (6 rota) — `BaseController(ColorService)`; autoCode `RNK+GGAAYY+NNNN`

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/colors` | `VT → ANY(property:read, mobile:hizli-is-emri, mobile:siparis, mobile:kumas, mobile:tambur, mobile:tarti-paket, mobile:kk1-yari-mamul)` | `BaseController.findAll` (`base.controller.ts:67`) → `BaseService.findAll(req)` (`base.service.ts:389`; `parseQueryParams` `utils/query-parser.ts:43` — `pageSize>500` → 400, `skip>10000` → 400, `sortBy` allowlist, `filter[...]`, cursor modu) | query parser | R | offset/cursor sayfalı |
| 2 | GET | `/api/colors/similar-names` | `VT → P(property:write)` | `similarNames` :49 → `findSimilarNames(name, {excludeId, scope})` (ham SQL `base.service.ts:838-919`, limit ≤20) | — | R | `{data:[...]}` |
| 3 | GET | `/api/colors/:id` | `VT → ANY(property:read, mobile:hizli-is-emri)` | `findById` :79 | uuid✓ (`getParamId`) | R | 200/404 |
| 4 | POST | `/api/colors` | `VT → P(property:write)` | `create` :95 → `ColorService.create` (DMMF + `assertNameAvailable` renk katlaması; kod backend) | **DMMF (Zod yok)** | W | 201 |
| 5 | PATCH | `/api/colors/:id` | `VT → P(property:write)` | `update` :107 | DMMF · uuid✓ | W | |
| 6 | DELETE | `/api/colors/:id` | `VT → P(property:write)` | `remove` :118 → `softDelete` | uuid✓ | D (soft) | |

### 2.6 `T/routes/config-bundle.routes.ts` → `/api/config-bundle` (4 rota) — **YENİ dosya**, controller yok, anahtar-kapsamlı yetki

`BUNDLE_PERMISSIONS` (`services/import/config-bundle.service.ts:43-50`): LABEL_TEMPLATE → `label-template:read/write`; TRAVELER_TEMPLATE, DOCUMENT_PROFILE, FREE_DOCUMENT → `document-template:read/write`; PERMISSION_TEMPLATE → `admin:users/admin:users`. `ANY_BUNDLE_READ` = {label-template:read, document-template:read, admin:users}; `ANY_BUNDLE_WRITE` = {label-template:write, document-template:write, admin:users} (:35-36, türetilmiş — ikinci liste yok).

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/config-bundle/kinds` | `VT → ANY(ANY_BUNDLE_READ)` | inline :80-91 | — | R | tür başına `{kind, label, canRead, canWrite}` (kullanıcıya göre hesaplanır) |
| 2 | GET | `/api/config-bundle/export` | `VT → ANY(ANY_BUNDLE_READ)` → **handler içi** `parseKinds(?kinds)` (:61-70, bilinmeyen → 400) → `assertKindPermissions(kinds,"read")` (:45-59, eksik → 403 türleri sayarak) | `exportBundle(kinds)` | query CSV | R | `{data: envelope}` |
| 3 | POST | `/api/config-bundle/preview` | `VT → ANY(ANY_BUNDLE_WRITE)` → `jsonBig` (:27, **etkisiz** §0.2) → handler içi `validateEnvelope` + `assertKindPermissions(kindsInBundle,"write")` | `planBundle(envelope, onConflict)` | `bodySchema` :39-42 (`onConflict` rename\|overwrite\|skip, default rename) + `validateEnvelope` (servis) | R(POST) | plan |
| 4 | POST | `/api/config-bundle/apply` | aynı zincir | `applyBundle(envelope, onConflict, userId)` | aynı | W (çoklu tablo) | sonuç |

### 2.7 `T/routes/currency.routes.ts` → `/api/currencies` (1 rota)

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/currencies` | `VT` (RBAC yok — sabit referans listesi, gerekçe :4-7) | inline :30-32 → `CURRENCIES` (`config/currencies.ts`) | — | R | `{data: CURRENCIES}` |

---

## 3. Dosya başına rota tabloları — B (customer-* … fabric-property)

### 3.1 `T/routes/customer-alias.routes.ts` → mount `/api/customers/:customerId` (`customer.routes.ts:41`, `mergeParams`) (7 rota) — `CustomerAliasController`

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/customers/:customerId/aliases/suggest` | `VT → P(customer-alias:read)` | `suggest` `customer-alias.controller.ts:90` → `lookupAlias(customerId, itemId, colorId)` | `suggestQuerySchema` :14-17 (**query** uuid) · `:customerId` uuid✗ | R | `{data}` |
| 2 | GET | `/api/customers/:customerId/item-aliases` | `VT → P(customer-alias:read)` | `listItemAliases` :24 | uuid✗ | R | |
| 3 | PUT | `/api/customers/:customerId/item-aliases/:itemId` | `VT → P(customer-alias:write)` | `upsertItemAlias` :31 | `aliasSchema` :10-12 (≤200) · uuid✗ ×2 | W (upsert) | |
| 4 | DELETE | `/api/customers/:customerId/item-aliases/:itemId` | `VT → P(customer-alias:write)` | `deleteItemAlias` :44 | gövde yok · uuid✗ ×2 | D | |
| 5 | GET | `/api/customers/:customerId/color-aliases` | `VT → P(customer-alias:read)` | `listColorAliases` :57 | uuid✗ | R | |
| 6 | PUT | `/api/customers/:customerId/color-aliases/:colorId` | `VT → P(customer-alias:write)` | `upsertColorAlias` :64 | `aliasSchema` · uuid✗ ×2 | W | |
| 7 | DELETE | `/api/customers/:customerId/color-aliases/:colorId` | `VT → P(customer-alias:write)` | `deleteColorAlias` :77 | gövde yok · uuid✗ ×2 | D | |

### 3.2 `T/routes/customer-branch-list.routes.ts` → `/api/customer-branches` (1 rota) — `BaseController(BaseService customerBranch)`

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/customer-branches` | `VT → READ` (sabit :30-37 = `ANY(customer:read, order:read, shipping:read, shipping:write, mobile:tarti-paket, mobile:sevkiyat)`) | `findAll` (include `customer{id,name,code}`) | query parser | R | sayfalı |

### 3.3 `T/routes/customer-branch.routes.ts` → mount `/api/customers/:customerId/branches` (`customer.routes.ts:39`) (4 rota) — inline + `CustomerBranchService`

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/customers/:customerId/branches` | `VT → ANY(customer:read, mobile:tarti-paket, mobile:sevkiyat, mobile:fason-sevk, mobile:fason-kabul, mobile:siparis)` | :51 → `service.findByCustomer(customerId, {includeInactive})` | uuid✗ | R | |
| 2 | POST | `/api/customers/:customerId/branches` | `VT → P(customer:write)` | :75 → `service.create` | `createSchema` :17-27 (DB kolon uzunluklarıyla birebir) · uuid✗ | W | 201 |
| 3 | PATCH | `/api/customers/:customerId/branches/:branchId` | `VT → P(customer:write)` | :99 → `service.update(customerId, branchId, …)` (müşteri-kapsamlı guard F204) | `updateSchema` :29 (partial) · uuid✗ ×2 | W | |
| 4 | DELETE | `/api/customers/:customerId/branches/:branchId` | `VT → P(customer:write)` | :127 → `service.deactivate` | gövde yok · uuid✗ ×2 | D (soft) | |

### 3.4 `T/routes/customer-standalone-label.routes.ts` → mount `/api/customers/:customerId` (`customer.routes.ts:45`) (2 rota)

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/customers/:customerId/standalone-labels` | `VT → P(label-template:read)` | :64 → `CustomerStandaloneLabelService.list` | uuid✗ | R | |
| 2 | PUT | `/api/customers/:customerId/standalone-labels` | `VT → P(label-template:write)` | :77 → `service.set(customerId, templateIds, userId)` (M:N replace) | `setSchema` :21-23 (≤200 uuid) · uuid✗ | W | |

### 3.5 `T/routes/customer-template-route.routes.ts` → mount `/api/customers/:customerId` (`customer.routes.ts:43`) (2 rota)

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/customers/:customerId/template-routes` | `VT → P(label-template:read)` | :53 → `CustomerTemplateRouteService.list` | uuid✗ | R | |
| 2 | PUT | `/api/customers/:customerId/template-routes` | `VT → P(label-template:write)` | :66 → `service.set(customerId, kind, templateId, userId)` | `setSchema` :25-28 (`kind: labelKindSchema` tek kaynak `config/label-kind.schema.ts:51`; `templateId` uuid\|null) · uuid✗ | W (kind başına atama) | |

### 3.6 `T/routes/customer.routes.ts` → `/api/customers` (7 rota + 4 iç mount) — `BaseController(CustomerService)`; `MOBILE_CUSTOMER_READ` :11 (7 mobil izin, `mobile:hizli-is-emri` yeni)

İç mount'lar (:39-45) `GET /:id`'den ÖNCE kayıtlı; yalnız kendi alt yollarını eşlediklerinden `GET /api/customers/<uuid>` ve `/similar-names` onlardan geçip düşer (gölgeleme yok — elle izlendi).

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/customers` | `VT → ANY(customer:read, …MOBILE_CUSTOMER_READ)` | `findAll` | query parser (search `name`; kod kovası `code, taxNumber, exportCode`) | R | |
| 2 | GET | `/api/customers/similar-names` | `VT → P(customer:write)` | `similarNames` | — | R | |
| 3 | GET | `/api/customers/:id` | `VT → ANY(customer:read, …MOBILE)` | `findById` | uuid✓ | R | 200/404 |
| 4 | POST | `/api/customers` | `VT → P(customer:write)` | `create` → `CustomerService.create` (DMMF + `nestedCreateFields: branches` + `validateName` — `lib/string-validators` kullanan 3 servisten biri) | DMMF (Zod yok) | W | 201 |
| 5 | PATCH | `/api/customers/:id` | `VT → P(customer:write)` | `update` | DMMF · uuid✓ | W | |
| 6 | DELETE | `/api/customers/:id` | `VT → P(customer:write)` | `remove` → soft | uuid✓ | D (soft) | |
| 7 | DELETE | `/api/customers/:id/permanent` | `VT → P(customer:write)` | `hardRemove` (`base.controller.ts:130`) → `BaseService.hardDelete` (`base.service.ts:1259`, bağımlılık guard'lı) | uuid✓ | **D fiziksel** | 200/404 |

### 3.7 `T/routes/dashboard.routes.ts` → `/api/dashboard` (2 rota) — inline → `DashboardService`

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/dashboard/defects/summary` | `VT → P(quality:read)` | :26 → `getDefectsSummary()` | — | R | `{data}` |
| 2 | GET | `/api/dashboard/stations/live-state` | `VT → P(station:read)` | :58 → `getStationsLiveState()` | — | R | `{data}` |

### 3.8 `T/routes/db-copy.routes.ts` → `/api/admin/db-copies` (5 rota) — inline; **beşi de `VT → P(admin:settings) → P(admin:users)` AND**

| # | Metod | Tam yol | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/admin/db-copies` | :48 → `listDbCopies()` (pg_database taraması + bellek iş uzlaştırması) | — | R (+X) | `{data}` |
| 2 | POST | `/api/admin/db-copies` | :77 → `startCopyJob(backupName)` (`db-copy.service.ts:369-437`: `resolveBackupPath` allowlist :383 → `CREATE DATABASE` `quoteIdent` :320 → `pg_restore` spawn; tek koruma bellek-içi `isCopyJobRunning` :138) | `z.object({backupName: min1})` :84 (traversal kontrolü serviste) | W + X (canlı DB boyutunda ikinci DB) | 202 `{copyName}` / 400 (meşgul — 409 değil) |
| 3 | POST | `/api/admin/db-copies/:name/verify` | :108 → `reverifyCopy(name)` | gövde yok · `:name` route'ta serbest (serviste `quoteIdent`) | R + X | `{data}` |
| 4 | DELETE | `/api/admin/db-copies/:name` | :142 → `dropCopy(name, force)` (`DROP DATABASE … WITH (FORCE)` :716) | `?force=1` · `:name` serbest | **D (DROP DATABASE)** | 200 / 409 `{blockedBy}` |
| 5 | GET | `/api/admin/db-copies/:name/swap-command` | :177 → `getSwapCommands(name)` → **`await AuditService.logEvent(DB_SWAP_COMMAND_ISSUED)`** :191 (tek iz) | `:name` serbest | R (komut bloğu üretir; DB'ye yazmaz) | 200 `{...commands, needsMigrateDeploy}` / 409 |

### 3.9 `T/routes/defect-type.routes.ts` → `/api/defect-types` (7 rota) — `BaseController(BaseService defectType)`; `MOBILE_DEFECT_READ` :14 = `mobile:kk2-kursun, mobile:tambur`; autoCode `HATA+GGAAYY+NNNN`

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/defect-types` | `VT → ANY(quality:read, …MOBILE_DEFECT_READ)` | `findAll` | query parser | R | |
| 2 | GET | `/api/defect-types/similar-names` | `VT → P(quality:write)` | `similarNames` | — | R | |
| 3 | GET | `/api/defect-types/:id` | `VT → ANY(quality:read, …MOBILE)` | `findById` | uuid✓ | R | |
| 4 | POST | `/api/defect-types` | `VT → P(quality:write)` | `create` | DMMF (`duplicateNameField: name`) | W | 201 |
| 5 | PATCH | `/api/defect-types/:id` | `VT → P(quality:write)` | `update` | DMMF · uuid✓ | W | |
| 6 | DELETE | `/api/defect-types/:id` | `VT → P(quality:write)` | `remove` | uuid✓ | D (soft) | |
| 7 | DELETE | `/api/defect-types/:id/permanent` | `VT → P(quality:write)` | `defectTypeHardRemove` (`services/helpers/guarded-hard-remove.ts:47-92` factory: `assertValidUuid` → 404 → bağımlılık guard'ları 409 `{[key]: n}` → tx delete → `AuditService.log(DELETE)`) | uuid✓ | **D fiziksel** (RollError'da geçen 409) | 200 `{data: record}` |

### 3.10 `T/routes/device.routes.ts` → iki router (12 rota) — `DeviceController` (static)

**`devicePublicRouter` → `/api/devices` (app.ts:573) — 3 rota, tamamı KİMLİKSİZ ve `resolveDevice` muafiyetli (`device.middleware.ts:27-31`)**

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/devices/announce` | **YOK (bilinçli public — eşleşme öncesi)** | `announce` `device.controller.ts:58` → `DeviceService.announce` (`device.service.ts:157`: bilinmeyen → PENDING kaydı; tavan `MAX_PENDING_DEVICES=200` :22,179-184 → 429? `PENDING_DEVICE_LIMIT`) | `announceSchema` :14-18 (`deviceId` 8-80, `name` ≤80, `kind`) | **W (kimliksiz yazma)** | `{data}` |
| 2 | GET | `/api/devices/status` | **YOK** | `status` :69 (header `x-device-id` veya `?deviceId`) → `getStatus` | boş → 400 | R | `{data:{status…}}` |
| 3 | GET | `/api/devices/pairing-required` | **YOK** | `assignmentRequired` :88 → `readDevicePairingRequired()` | — | R | `{data:{required}}` |

**`deviceAdminRouter` → `/api/admin/devices` (app.ts:574) — 9 rota, hepsi `VT → P(admin:settings)`**

| # | Metod | Tam yol | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|
| 4 | GET | `/api/admin/devices` | `list` :37 | — | R | |
| 5 | GET | `/api/admin/devices/:id` | `detail` :47 | uuid✓ (:49) | R | |
| 6 | POST | `/api/admin/devices/:id/approve` | `approve` :98 → `approveAndAssign` | `approveSchema` :20-25 · uuid✗ | W (onay + makine) | |
| 7 | POST | `/api/admin/devices/:id/assign-hardware` | `assignHardware` :114 | `assignHardwareSchema` :27-29 · uuid✗ | W | |
| 8 | POST | `/api/admin/devices/:id/revoke` | `revoke` :126 | gövde yok · uuid✗ | W (onay iptali) | |
| 9 | PATCH | `/api/admin/devices/:id` | `rename` :137 | `renameSchema` :31-33 · uuid✗ | W | |
| 10 | DELETE | `/api/admin/devices/:id` | `deactivate` :149 | gövde yok · uuid✗ | D (soft) | |
| 11 | POST | `/api/admin/devices/:id/reactivate` | `reactivate` :171 | gövde yok · uuid✗ | W | |
| 12 | DELETE | `/api/admin/devices/:id/permanent` | `hardDelete` :160 | gövde yok · uuid✗ | **D fiziksel** | |

### 3.11 `T/routes/discovery.routes.ts` → `/api/discovery` (1 rota) — **YENİ dosya, public, DB'siz**

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/discovery/identity` | **YOK (bilinçli public; bekçide beyanlı)** | inline :34-36 → `buildDiscoveryIdentity()` (`services/discovery.service.ts:65-78`, senkron, bellekten; bekçi `test_discovery_identity.ts` `prisma.` geçmediğini ölçer) | — | R | `{product, discoveryVersion, installationId, serverName (os.hostname), companyName, version, protocol:"http", apiPort, apiBasePath:"/api", time}` |

### 3.12 `T/routes/document-profile.routes.ts` → `/api/document-profiles` (5 rota) — inline → `documentProfileService`

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/document-profiles` | `VT` **(RBAC yok — gerekçe :4-5 "müşteri/fason formlarındaki profil seçici")** | :37 → `list(withInactive)` | — | R (profil `config` dahil) | |
| 2 | GET | `/api/document-profiles/:id` | `VT` **(RBAC yok)** | :53 → `get(id)` | uuid✓ | R | |
| 3 | POST | `/api/document-profiles` | `VT → ANY(DOCUMENT_DESIGN_WRITE = admin:settings, document-template:write)` | :73 → `create` | `upsertSchema` :21-27 (`config` gevşek record → serviste `sanitizeDocumentsConfig`) | W | 201 |
| 4 | PUT | `/api/document-profiles/:id` | aynı | :95 → `update` | `upsertSchema` · uuid✓ | W | |
| 5 | DELETE | `/api/document-profiles/:id` | aynı | :117 → `deactivate` | uuid✓ | D (soft) | |

### 3.13 `T/routes/fabric-property.routes.ts` → `/api/fabric-properties` (6 rota) — `BaseController(FabricPropertyService)`; `nestedCreateFields: stationCapabilities, values`; kod `OZL+GGAAYY+NNNN` (withBarcodeRetry P2002)

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/fabric-properties` | `VT → ANY(property:read, mobile:hizli-is-emri, mobile:kumas)` | `findAll` (include istasyon bağları + değerler) | query parser | R | |
| 2 | GET | `/api/fabric-properties/similar-names` | `VT → P(property:write)` | `similarNames` | — | R | |
| 3 | GET | `/api/fabric-properties/:id` | `VT → ANY(property:read, mobile:hizli-is-emri, mobile:kumas)` | `findById` | uuid✓ | R | |
| 4 | POST | `/api/fabric-properties` | `VT → P(property:write)` | `create` → `FabricPropertyService.create` (`stationIds` ZORUNLU, aynı insert) | DMMF (Zod yok) | W | 201 |
| 5 | PATCH | `/api/fabric-properties/:id` | `VT → P(property:write)` | `update` (stationIds verilirse replace) | DMMF · uuid✓ | W | |
| 6 | DELETE | `/api/fabric-properties/:id` | `VT → P(property:write)` | `remove` | uuid✓ | D (soft) | |

---
## 4. Dosya başına rota tabloları — C (feature-flag … item)

### 4.1 `T/routes/feature-flag.routes.ts` → `/api/feature-flags` (4 rota) — inline → `systemSettingService`

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/feature-flags` | `VT` **(RBAC yok — her kimlikli kullanıcı)** | :391 → `getFeatureFlags()` (`system-setting.service.ts:1152`, cache'li) | — | R | `updateSchema`'daki TÜM anahtarlar (firma adı, oturum politikası, `pinLockout*`, `backupHour`, `loginMethods`, `travelerCardConfig`, `companyLetterhead`, `documentsConfig`…) — [VARSAYIM: yanıt kümesi şemayla birebir; servis okunmadı] |
| 2 | PATCH | `/api/feature-flags` | `VT → flagWriteGuard` (:38-46 **DİNAMİK**: gövde anahtarları ⊆ `DOCUMENT_DESIGN_FLAG_KEYS`{documentsConfig, travelerCardConfig} → `ANY(admin:settings, document-template:write)`; aksi/boş gövde → `P(admin:settings)`; guard Zod'dan ÖNCE koşar) | :426 → `setFeatureFlags(body, userId)` | `updateSchema` **`z.strictObject`** :94-376 (bilinmeyen anahtar → 400 + anahtar adı; `documentsConfig: z.record(z.any())` → iç doğrulama serviste `sanitizeDocumentsConfig`; `travelerCardConfig` gevşek `z.object`) | W (SystemSetting satırları) | |
| 3 | GET | `/api/feature-flags/documents-logo` | `VT` **(RBAC yok)** | :462 → `getDocumentsLogo()` | — | R (≤200 KB data-url) | |
| 4 | PUT | `/api/feature-flags/documents-logo` | `VT → P(admin:settings)` (bilinçli — `document-template:write` YOK, :498-502) | :503 → `setDocumentsLogo(dataUrl)` | `logoSchema` :448-450 (`dataUrl` ≤200 000 \| null) | W (append-only kütüphane) | |

### 4.2 `T/routes/free-document.routes.ts` → `/api/free-documents` (6 rota) — inline → `freeDocumentService`

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/free-documents` | `VT → ANY(DOCUMENT_DESIGN_READ = admin:settings, document-template:read, document-template:write)` | :27 → `list(withInactive)` | — | R | |
| 2 | GET | `/api/free-documents/:id` | aynı | :35 → `get` | uuid✓ | R | |
| 3 | GET | `/api/free-documents/:id/html` | aynı | :44 → `renderHtml(id, {printedBy: username, printNote})` | `printNote` ≤300'e kırpılır · uuid✓ | R (render; yazma yok) | `text/html` |
| 4 | POST | `/api/free-documents` | `VT → ANY(DOCUMENT_DESIGN_WRITE)` | :57 → `create(body, userId)` | `upsertSchema` :19-25 (`body` ≤20 000, `config` record) | W (+audit serviste [VARSAYIM]) | 201 |
| 5 | PUT | `/api/free-documents/:id` | aynı | :65 → `update` | `upsertSchema` · uuid✓ | W | |
| 6 | DELETE | `/api/free-documents/:id` | aynı | :73 → `deactivate` | uuid✓ | D (soft) | |

### 4.3 `T/routes/import.routes.ts` → `/api/import` (8 rota) — **YENİ dosya**, inline → `ImportService`; iki katmanlı yetki (`data:import` **VE** hedef varlığın write izni; dışa aktarımda yalnız read)

Adaptör izinleri (`services/import/adapters/*.ts`): customer/customerBranch → `customer:*`; customerItemAlias/customerColorAlias → `customer-alias:*`; color/fabricProperty → `property:*`; defectType/qualityGrade → `quality:*`; item → `item:*`; order → `order:*`; station/machine/route/productRecipe → `station:*`; subcontractor/subcontractorCategory → `subcontractor:*`; returnReason → `return:*`. Bilinmeyen `:entity` → `getImportAdapter` 404 (`import-registry.ts:59-66`). Prod kopyasında `data:import` taşıyan aktif kullanıcı: **1**.

| # | Metod | Tam yol | Kapı zinciri | Handler | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/import/entities` | `VT → P(data:import)` | :97 → `ImportService.listEntities(perms)` (kullanıcının yazabildiği varlıklar) | — | R | |
| 2 | GET | `/api/import/runs` | `VT → P(data:import)` | :127 → `listRuns({entity, limit})` | `limit` `Number()` (tavan serviste?) | R | |
| 3 | GET | `/api/import/runs/:id` | `VT → P(data:import)` | :158 → `getRun(id)` | uuid✗ | R | |
| 4 | GET | `/api/import/runs/:id/records` | `VT → P(data:import)` | :185 → `getRunRecords(id)` | uuid✗ | R | |
| 5 | GET | `/api/import/:entity/template` | `VT → P(data:import) → requireEntityWrite` (:31-47 **DİNAMİK**: `adapter.writePermission`) | :213 → `template(entity)` | `:entity` adaptör kaydı | R (şablon için WRITE izni aranıyor) | |
| 6 | POST | `/api/import/:entity/preview` | `VT → P(data:import) → requireEntityWrite → jsonBig` (:28, **etkisiz** §0.2) | :237 → `preview(entity, rows, options, userId)` | `payloadSchema` :82-85 (`rows[]` ≥1, `cells` string map; `options.mode/onError/clientToken uuid/fileName`) | R(POST) [VARSAYIM: `ImportRun` yazabilir] | |
| 7 | POST | `/api/import/:entity/apply` | aynı zincir | :274 → `apply(...)` | aynı | W (toplu upsert; `clientToken` opsiyonel) | |
| 8 | GET | `/api/import/:entity/export` | `VT → requireEntityRead` (:50-64 **DİNAMİK**: `adapter.readPermission`; **`data:import` ARANMAZ** — karar D6, :22-23) | :309 → `exportRows(entity, {limit})` | `?limit` ≤200 (önizleme); limitsiz = tam indirme | R | |

### 4.4 `T/routes/inventory.routes.ts` → `/api/rolls` (28 rota) — `InventoryController`

Sabitler: `MOBILE_ROLL_READ` :13-27 = `mobile:kk1, mobile:kk2-kursun, mobile:tambur, mobile:depo, mobile:tarti-paket, mobile:sevkiyat, mobile:fason-sevk, mobile:fason-kabul, mobile:hizli-is-emri, mobile:kartela-sevk` (10) · `MOBILE_ROLL_WRITE_KK1` :28 = `mobile:kk1` · `MOBILE_ROLL_WRITE_KURSUN` :29 = `mobile:kk2-kursun` · `MOBILE_ROLL_CANCEL` :45 = `mobile:kk1, mobile:depo`. Kısaltma `RR` = `ANY(roll:read, …MOBILE_ROLL_READ)`. Controller: `T/controllers/inventory.controller.ts` (`IC`).

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/rolls` | `VT → RR` | `findAllRolls` IC:333 → `service.findAllRolls(req)` | query parser (serviste) | R | offset/cursor |
| 2 | GET | `/api/rolls/barcode/:barcode` | `VT → RR` | `findRollByBarcode` IC:478 (boş/whitespace → 400) | — | R | 200/404 |
| 3 | GET | `/api/rolls/barcode/:barcode/relabel-context` | `VT → ANY(roll:read, roll:write, label:read, label:edit, …MOBILE_ROLL_READ)` | `getRelabelContext` IC:509 | — | R | 200/404 |
| 4 | GET | `/api/rolls/:id/relabel-context` | aynı | `getRelabelContextById` IC:532 | uuid✗ | R | 200/404 |
| 5 | GET | `/api/rolls/barcode` | `VT → RR` | **inline** :249-254 (sabit 400 yönlendirme mesajı) | — | R | 400 |
| 6 | GET | `/api/rolls/stats` | `VT → RR` | `getRollStats` IC:365 → `getRollStats(req)` | — | R (aggregate) | |
| 7 | GET | `/api/rolls/duplicates` | `VT → P(roll:manual-adjust)` | `listDuplicateRolls` IC:397 → `DuplicateRollsService.scan({days, windowSec})` | `?days`, `?window` sayı | R | `{data}` |
| 8 | GET | `/api/rolls/entry-users` | `VT → RR` | `listEntryUsers` IC:375 | — | R | |
| 9 | GET | `/api/rolls/entry-stations` | `VT → RR` | `listEntryStations` IC:384 | — | R | |
| 10 | POST | `/api/rolls/stats-batch` | `VT → RR` | `getRollStatsBatch` IC:417 (paralel `roll.aggregate` ×N) | `statsBatchSchema` IC:80-98 `safeParse` (items 1-12; `filters` `z.record(z.any())`) → hatada inline 400 | R(POST) | |
| 11 | GET | `/api/rolls/production-flow` | `VT → RR` + **handler içi** kolon süzgeci IC:350-354 (`quality:read` → `includeQueues`; `shipping:read`∨`shipping:write` → `includeSevk`) | `getProductionFlow` IC:348 | — | R | |
| 12 | GET | `/api/rolls/warehouse-scope` | `VT → RR` | `getWarehouseScope` IC:431 | — | R | |
| 13 | GET | `/api/rolls/subcontractor-summary` | `VT → RR` | `getSubcontractorSummary` IC:444 (`filter[includeFire]`) | — | R | |
| 14 | GET | `/api/rolls/:id` | `VT → RR` | `findRollById` IC:460 | uuid✗ | R | 200/404 |
| 15 | GET | `/api/rolls/:id/history` | `VT → ANY(roll:read, roll:history, …MOBILE_ROLL_READ)` | `getRollHistory` IC:250 | uuid✗ | R | 200/404 |
| 16 | POST | `/api/rolls/initial-entry` | `VT → ANY(roll:write, mobile:kk1)` + **handler içi** `semiFinished` → `mobile:kk1-yari-mamul` ∨ `roll:write` (IC:274-292; ayrıca renk zorunlu) + `getStampContext(req,{enforceForMobile:true})` IC:294 (mobilde oturum yoksa 409 `WORK_SESSION_REQUIRED`) | `createInitialEntry` IC:268 → `service.createInitialEntry(body, userId, machineId, isDevice, {duplicateGuard:{confirmed}, entryStationId, forcedEntrySource/Status})` | `initialEntrySchema` IC:20-50 (**düz `z.object`, bilinçli — eski APK**; `clientToken` uuid opsiyonel, `confirmDuplicate`, `clientEnteredAt`, `semiFinished`) | W (yeni top + barkod) | 201; 409 `POSSIBLE_DUPLICATE` (bayrak `kk1.duplicateGuardEnabled` prod'da **true**) |
| 17 | GET | `/api/rolls/:id/cancel-preview` | `VT → ANY(roll:write, mobile:kk1, mobile:depo)` (önizleme, WRITE izniyle) | `cancelPreview` IC:553 | uuid✗ | R | |
| 18 | DELETE | `/api/rolls/:id` | `VT → ANY(roll:write, mobile:kk1, mobile:depo)` | `softDelete` IC:562 → `service.softDelete(id, userId, {confirmActive, confirmLabelPrinted (ÖLÜ, IC:566-570), reason, reasonCode})` | **Zod YOK — sözleşme QUERY STRING'de** (`?confirmActive=true&reason=…&reasonCode=…`); `reasonCode` 64'e, `reason` serviste 500'e kırpılır (`inventory.service.ts:3147`) · uuid✗ | D (`CANCELLED`) | |
| 19 | POST | `/api/rolls/:id/restore-cancel` | `VT → ANY(roll:write, mobile:kk1, mobile:depo)` | `restoreCancelled` IC:624 → `restoreCancelledRoll` | `restoreCancelSchema` IC:109-111 (`reason` opsiyonel; `req.body ?? {}`) · uuid✗ | W (storno'nun storno'su) | 409 `RESTORE_BLOCKED` olası |
| 20 | POST | `/api/rolls/:id/scrap` | `VT → P(roll:manual-adjust)` | `scrap` IC:600 → `service.softDelete(id, userId, {mode:"SCRAP", confirmActive, reason, reasonCode})` | `scrapRollSchema` IC:118-123 · uuid✗ | D (`SCRAP`, stok düşer, geri alınamaz) | |
| 21 | DELETE | `/api/rolls/:id/permanent` | `VT → P(roll:write)` | `hardDelete` IC:642 → `service.hardDelete` (arşiv — soft) | gövde yok · uuid✗ | D | |
| 22 | PATCH | `/api/rolls/:id/label` | `VT → ANY(roll:write, label:edit, mobile:tarti-paket, mobile:sevkiyat)` + **serviste** `opts.permissions` (IC:676; FREE_STOCK dışı → sebep zorunlu + `roll:manual-adjust`) | `relabel` IC:661 → `applyManualProperties` | `relabelSchema` IC:127-143 (`foldTypeSchema`, `currentQty` ≤999 999, `reason` opsiyonel) · uuid✗ | W (renk/en/kalite/kat/metraj) | |
| 23 | POST | `/api/rolls/:id/prepare-for-sale` | `VT → ANY(roll:write, mobile:tarti-paket, mobile:sevkiyat, mobile:hizli-is-emri)` | `prepareForSale` IC:688 → `prepareRawForSale` | gövde yok · uuid✗ | W (`STOCK`→`WAREHOUSE`) | |
| 24 | PATCH | `/api/rolls/:id/manual-attributes` | `VT → P(roll:manual-adjust)` + serviste `opts.permissions` (IC:715) | `manualAttributes` IC:701 → `applyManualProperties` | `manualAttributesSchema` IC:68-77 (`reason` ZORUNLU ≥3) · uuid✗ | W | |
| 25 | GET | `/api/rolls/:id/rescue-preview` | `VT → P(roll:manual-adjust)` | `rescuePreview` IC:726 | uuid✗ | R | |
| 26 | POST | `/api/rolls/:id/rescue-stuck` | `VT → P(roll:manual-adjust)` | `rescueStuck` IC:738 → `rescueStuckRoll` | `rescueSchema` IC:101-103 (`reason` zorunlu) · uuid✗ | W (movement kapatır, `WAREHOUSE`) | |
| 27 | POST | `/api/rolls/open-fabric` | `VT → ANY(roll:write, mobile:kk2-kursun)` — **oturum damgası HİÇ okunmuyor** (kardeş #16/#28'den farklı) | `createOpenFabric` IC:215 → `createOpenFabric(body, userId)` | `openFabricSchema` IC:57-64 (`receiptId`, `stepId` uuid, `clientToken` opsiyonel) | W (barkodsuz açık kumaş) | 201 |
| 28 | POST | `/api/rolls/:id/kursun-finish` | `VT → ANY(roll:write, mobile:kk2-kursun)` + `getStampContext(enforceForMobile:true)` IC:234 | `kursunFinish` IC:229 → `service.kursunFinish(id, body, userId, machineId)` | `kursunFinishSchema` IC:150-174 (`export` — bekçi okur) · uuid✗ | W (metraj + `RollError` + movement) | |

### 4.5 `T/routes/item.routes.ts` → `/api/items` (10 rota) — `BaseController(ItemService)` + 3 inline

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/items` | `VT → ANY(item:read, mobile:kk1, mobile:siparis, mobile:kumas, mobile:tambur, mobile:hizli-is-emri)` | `findAll` (include allowedColors/allowedProperties; arama `customerAliases.some.alias` dahil) | query parser | R | |
| 2 | GET | `/api/items/similar-names` | `VT → P(item:write)` | `similarNames` | — | R | |
| 3 | GET | `/api/items/:id` | `VT → ANY(item:read, mobile:kk1)` | `findById` | uuid✓ | R | |
| 4 | POST | `/api/items` | `VT → ANY(item:write, mobile:kumas)` | `create` → `ItemService.create` (DMMF + `validateName` + `assertNameNotDuplicate`; kod `STK-NNNNNN`) | DMMF (Zod yok) | W | 201 |
| 5 | POST | `/api/items/quick-create` | `VT → P(mobile:kk1-desen)` (**tekil mobil izin; `item:write` KABUL EDİLMEZ**; prod'da 1 kullanıcı) | inline :184-197 → `itemService.quickCreateFabric(name, userId)` | `quickCreateBody` :43-50 **`.strict()`** (yalnız `name` 1-100) | W (FABRIC, `pendingReview`) | 201 |
| 6 | PATCH | `/api/items/:id` | `VT → P(item:write)` | `update` | DMMF · uuid✓ | W | |
| 7 | DELETE | `/api/items/:id` | `VT → P(item:write)` | `remove` | uuid✓ | D (soft) | |
| 8 | DELETE | `/api/items/:id/permanent` | `VT → P(item:write)` | `hardRemove` → `BaseService.hardDelete` (guard'lı) | uuid✓ | **D fiziksel** | 200/404 |
| 9 | POST | `/api/items/:id/allowed-colors` | `VT → P(item:write)` | inline :295-312 → `addAllowedColor(String(id), colorId, userId)` | `addAllowedColorBody` :34-36 · uuid✗ (`String(req.params.id)`) | W (pivot; idempotent) | |
| 10 | POST | `/api/items/:id/allowed-properties` | `VT → P(item:write)` | inline :341-358 → `addAllowedProperty` | `addAllowedPropertyBody` :37-39 · uuid✗ | W (pivot) | |

---

## 5. Dosya başına rota tabloları — D (kartela … label)

### 5.1 `T/routes/kartela.routes.ts` → `/api/kartela` (13 rota) — `KartelaController` (`KC` = `T/controllers/kartela.controller.ts`)

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/kartela/dispatch` | `VT → ANY(kartela:write, mobile:kartela-sevk)` | `dispatch` KC:126 → `service.dispatch(body, userId)` | `dispatchSchema` KC:10-16 (`rollIds` uuid ≥1) — **`clientToken` YOK** | W (`KartelaDispatch` + Roll → `AT_KARTELA`) | 201 |
| 2 | POST | `/api/kartela/dispatches/:id/cancel` | aynı | `cancelDispatch` KC:137 | `cancelSchema` KC:18-20 (`reason` 3-500) · uuid✗ | D/W (top geri) | |
| 3 | GET | `/api/kartela/dispatches` | `VT → ANY(kartela:read, mobile:kartela-sevk, mobile:kartela-kabul)` | `listDispatches` KC:188 (`parseListQuery` KC:75-103: status enum, tarih, page/cursor) | elle query | R | |
| 4 | GET | `/api/kartela/dispatches/:id` | aynı | `getDispatch` KC:198 | uuid✗ | R | |
| 5 | GET | `/api/kartela/outstanding` | `VT → ANY(kartela:read, mobile:kartela-kabul)` | `outstandingRolls` KC:228 | `?subcontractorId` | R | |
| 6 | GET | `/api/kartela/stock` | `VT → ANY(kartela:read, shipping:read, shipping:write, mobile:tarti-paket, mobile:sevkiyat, mobile:depo)` | `getStock` KC:241 | `?search/itemId/colorId` | R | |
| 7 | POST | `/api/kartela/stock/reduce` | `VT → ANY(kartela:write, mobile:depo)` | `reduceStock` KC:255 → `service.reduceStock` (`SwatchStockReduction.clientToken @unique` replay) | `reduceStockSchema` KC:52-60 (`clientToken` uuid opsiyonel) | W (sayaç düşümü) | `{reduced}` |
| 8 | POST | `/api/kartela/receive` | `VT → ANY(kartela:write, mobile:kartela-kabul)` | `receive` KC:152 → `service.receive` | `receiveSchema` KC:27-46 (`returns[]` ≥1, `count` ≤1000, ölçü alanları) — **`clientToken` YOK** | W (`KartelaReceipt` + N `Swatch`) | 201 |
| 9 | GET | `/api/kartela/receipts` | `VT → ANY(kartela:read, mobile:kartela-sevk, mobile:kartela-kabul)` | `listReceipts` KC:208 | elle query | R | |
| 10 | GET | `/api/kartela/receipts/:id` | aynı | `getReceipt` KC:218 | uuid✗ | R | |
| 11 | GET | `/api/kartela/receipts/:id/cancel-preview` | `VT → ANY(kartela:write, mobile:kartela-kabul)` (önizleme, WRITE izniyle) | `getReceiptCancelPreview` KC:178 | uuid✗ | R | |
| 12 | POST | `/api/kartela/receipts/:id/cancel` | aynı | `cancelReceipt` KC:163 | `cancelSchema` · uuid✗ | D/W | |
| 13 | POST | `/api/kartela/rolls/:id/mark` | `VT → ANY(kartela:write, mobile:kartela-sevk, mobile:tambur, mobile:depo)` (`mobile:depo` 2026-08-19 eklendi, :284-288) | `setRollMarked` KC:266 → `setRollMarkedForKartela(id, value, userId)` | `markSchema` KC:48-50 · uuid✗ | W (bayrak set) | |

### 5.2 `T/routes/kursun-bypass.routes.ts` → `/api/kursun-bypass` (8 rota) — `KursunBypassController` (`KB`); sabitler `canDistribute` :16-19 = `ANY(workorder:distribute, mobile:kursun-dagitim)`, `canSeeVisibility` :35-41 = `ANY(quality:read, quality:write, workorder:distribute, mobile:kk2-kursun, mobile:kursun-dagitim)`

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/kursun-bypass/visibility` | `VT → canSeeVisibility` | `getVisibility` KB:83 | — | R (3 sayı) | |
| 2 | GET | `/api/kursun-bypass/distribution` | `VT → canDistribute` | `listDistribution` KB:93 | — | R (ağır) | |
| 3 | POST | `/api/kursun-bypass/assign` | `VT → canDistribute` | `assign` KB:103 → `service.assign` | `assignSchema` KB:20-27 (`workOrderId`, `machineId` uuid, `notes` ≤500 nullish) | W (`KursunBypassAssignment`) | 201 |
| 4 | POST | `/api/kursun-bypass/assign-bulk` | `VT → canDistribute` | `assignBulk` KB:128 (satır başına ayrı tx, `failed[]`) | `assignBulkSchema` KB:41-48 (≤100) | W (parçalı — bilinçli) | 200 |
| 5 | POST | `/api/kursun-bypass/cancel-bulk` | `VT → canDistribute` | `cancelBulk` KB:146 | `cancelBulkSchema` KB:50-56 (≤100) | D (parçalı) | |
| 6 | POST | `/api/kursun-bypass/:id/cancel` | `VT → canDistribute` | `cancelAssignment` KB:160 | uuid✓ (KB:162) + `cancelSchema` KB:29-32 (`req.body ?? {}`) | D (atomik claim serviste) | 409 olası |
| 7 | GET | `/api/kursun-bypass/:id/complete-preview` | `VT → canDistribute` (önizleme, dağıtım izniyle) | `getCompletePreview` KB:176 | uuid✓ | R | |
| 8 | POST | `/api/kursun-bypass/:id/complete` | `VT → canDistribute` | `complete` KB:187 → `completeFromDistribution(id, {rollIds}, userId)` | uuid✓ + `completeSchema` KB:58-62 | W (movement kapanışı + finalize; idempotent `alreadyDone`) | |

### 5.3 `T/routes/kursun-qc.routes.ts` → `/api/kursun-qc` (12 rota) — `KursunQcController` (`KQ`)

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/kursun-qc/by-card/:barcode` | `VT → ANY(quality:read, mobile:kk2-kursun)` | `getByCardBarcode` KQ:93 | — | R | |
| 2 | GET | `/api/kursun-qc/step/:stepId` | aynı | `getStep` KQ:103 | uuid✓ (`z.string().uuid()` KQ:105) | R | |
| 3 | GET | `/api/kursun-qc/open-cards` | aynı (tablet 5 sn'de bir yoklar) | `listOpenCards` KQ:114 | — | R | |
| 4 | POST | `/api/kursun-qc/complete-qc2` | `VT → ANY(quality:write, mobile:kk2-kursun)` + `getStampContext(enforceForMobile:true)` KQ:129 | `completeQc2` KQ:124 → `service.completeQc2({rollId, stepId, notes, properties}, userId, machineId)` | `completeQc2Schema` KQ:14-33 (`export`; `properties[]` ≤50, `valueCode` ≤32) | W (`RollOperation` + `RollProperty`; idempotent — op varsa) | 201 |
| 5 | POST | `/api/kursun-qc/report-error` | aynı (oturum zorunlu DEĞİL) | `reportError` KQ:147 → `service.reportError` | `reportErrorSchema` KQ:37-44 (`clientErrorId` uuid opsiyonel — **`clientToken` DEĞİL, PK olarak kullanılır**) | W (`RollError`) | 201 |
| 6 | DELETE | `/api/kursun-qc/error` | `VT → ANY(quality:write, mobile:kk2-kursun, mobile:tambur)` (`mobile:tambur` yeni, :201-203) | `deleteError` KQ:167 → `service.deleteError({errorId}, userId)` | `deleteErrorSchema` KQ:46-48 — **GÖVDELİ DELETE** | D (kayıt silme; "zaten yok → başarı") | |
| 7 | POST | `/api/kursun-qc/finish-step` | `VT → ANY(quality:write, mobile:kk2-kursun)` + `getStampContext(req)` **non-enforcing** KQ:183 (bilinçli, yorum :181-182) | `finishStep` KQ:178 | `finishStepSchema` KQ:50-52 | W (adım kapat + toplar ileri; idempotent) | |
| 8 | POST | `/api/kursun-qc/reopen-step` | aynı | `reopenStep` KQ:196 | `reopenStepSchema` KQ:54-56 | W (adım geri aç) | 400 "zaten kapalı değil" |
| 9 | GET | `/api/kursun-qc/reopen-preview/:stepId` | `VT → ANY(quality:read, mobile:kk2-kursun)` | `reopenPreview` KQ:207 | uuid✓ (KQ:209) | R | |
| 10 | GET | `/api/kursun-qc/queue` | `VT → ANY(quality:read, mobile:kk2-kursun, workorder:distribute, mobile:kursun-dagitim)` | `listQueue` KQ:218 | — | R | |
| 11 | PATCH | `/api/kursun-qc/queue/reorder` | `VT → ANY(quality:write, workorder:distribute, mobile:kursun-dagitim)` | `reorderQueue` KQ:228 → `service.reorderQueue(items, userId)` | `reorderQueueSchema` KQ:58-67 (`priority` 0-1 000 000) | W (`WorkOrderStep.priority` toplu) | |
| 12 | PATCH | `/api/kursun-qc/queue/:stepId/urgent` | aynı | `setQueueUrgent` KQ:239 | uuid✓ (KQ:241) + `setUrgentSchema` KQ:69-71 | W (`isUrgent`) | |

### 5.4 `T/routes/label-template.routes.ts` → `/api/label-templates` (24 rota) — `LabelTemplateController` (`LT`); **tüm uçlar tekil `P(label-template:read|write)`** (`read` ↔ `write` kapsama ilişkisi YOK; yalnız `write` taşıyan kullanıcı listeyi/`:id`'yi AÇAMAZ — bilinen hiza sorusu)

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/label-templates` | `VT → P(label-template:read)` | `list` LT:144 → `findAll({kind, includeInactive, standalone, assignable})` | query elle (`kind` enum kontrolü) | R | |
| 2 | GET | `/api/label-templates/catalog/:kind` | read | `catalog` LT:167 (enum dışı → inline 400) | enum | R (statik) | |
| 3 | GET | `/api/label-templates/catalog` | read | `unifiedCatalog` LT:352 | — | R | |
| 4 | GET | `/api/label-templates/context-defaults` | read | `listContextDefaults` LT:333 | — | R | |
| 5 | PUT | `/api/label-templates/context-defaults` | `VT → P(label-template:write)` | `setContextDefault` LT:339 | `contextDefaultSchema` LT:113-116 (`labelKindSchema`, `templateId` uuid\|null) | W (kind başına tek default) | |
| 6 | GET | `/api/label-templates/defaults/:kind` | read | `defaults` LT:180 (enum dışı → 400) | enum | R | |
| 7 | POST | `/api/label-templates/preview-raw` | **read** | `previewRaw` LT:208 → `buildRawCodePreview(kind, language, code)` (kullanıcı HAM KODU render) | `previewRawSchema` LT:66-70 (`code` ≤20 000) | R(POST) | `type(contentType).send` |
| 8 | GET | `/api/label-templates/default-code` | read | `defaultCode` LT:253 | `z.object({kind, language})` LT:255-257 (**query**) | R | |
| 9 | POST | `/api/label-templates/preview` | **read** | `fieldsPreview` LT:220 → `elements` varsa `getCanvasPreview` (LT:222-236), yoksa `getFieldsPreview` | `canvasPreviewSchema` LT:79-93 (`elements: z.unknown()` → serviste `validateCanvasLayout`; `peripheralId`, `copies` ≤100) ya da alan şeması LT:238-246 | R(POST) | JSON |
| 10 | GET | `/api/label-templates/icons` | read | `iconCatalog` LT:359 | — | R (statik) | |
| 11 | GET | `/api/label-templates/:id` | read | `findById` LT:160 | uuid✗ | R | |
| 12 | GET | `/api/label-templates/:id/export` | read | `exportTemplate` LT:272 | uuid✗ | R (JSON zarf) | |
| 13 | POST | `/api/label-templates/import` | write | `importTemplate` LT:278 | `importSchema` LT:119-139 | W (yeni şablon + varyantlar) | 201 |
| 14 | POST | `/api/label-templates/:id/duplicate` | write | `duplicate` LT:286 | gövde yok · uuid✗ | W (kopya) | 201 |
| 15 | POST | `/api/label-templates` | write | `create` LT:191 | `createSchema` LT:38-52 (`export`; `kind: z.nativeEnum(LabelKind).nullish()`, `rawCode` dil→kod ≤20 000) | W | 201 |
| 16 | PATCH | `/api/label-templates/:id` | write | `update` LT:199 | `updateSchema` LT:54-64 (`fields` → complete-replace) · uuid✗ | W | |
| 17 | POST | `/api/label-templates/:id/set-default` | write | `setDefault` LT:263 | gövde yok · uuid✗ | W (atomik default devri) | |
| 18 | DELETE | `/api/label-templates/:id` | write | `deactivate` LT:365 | uuid✗ | D (soft) | |
| 19 | DELETE | `/api/label-templates/:id/permanent` | write | `hardDelete` LT:372 (`deletedAt` damgası — fiziksel değil) | uuid✗ | D | |
| 20 | GET | `/api/label-templates/:id/variants` | read | `listVariants` LT:295 | uuid✗ | R | |
| 21 | POST | `/api/label-templates/:id/variants` | write | `createVariant` LT:301 | `variantCreateSchema` LT:96-102 (`elements: z.unknown()`) · uuid✗ | W | 201 |
| 22 | PATCH | `/api/label-templates/variants/:variantId` | write | `updateVariant` LT:309 | `variantUpdateSchema` LT:104-109 · uuid✗ | W | |
| 23 | DELETE | `/api/label-templates/variants/:variantId` | write | `deleteVariant` LT:317 | uuid✗ | D | |
| 24 | POST | `/api/label-templates/variants/:variantId/set-primary` | write | `setPrimaryVariant` LT:324 | gövde yok · uuid✗ | W | |

Rota sırası: `/:id` (:180) kendinden önce kayıtlı 9 literal yola (`/catalog/:kind`, `/catalog`, `/context-defaults`, `/defaults/:kind`, `/preview-raw`, `/default-code`, `/preview`, `/icons`) bağımlı; dosya yorumla işaretli (:164), mekanik bekçi YOK.

### 5.5 `T/routes/label.routes.ts` → `/api/labels` (27 rota) — `LabelController` (`LC`); `MOBILE_LABEL_PRINTERS` :20 = `mobile:kk1, mobile:tambur, mobile:tarti-paket` (`PR`); `SACK_LABEL_READ` :463 = `ANY(label:read, mobile:tarti-paket, mobile:sevkiyat)`. Format seçenekleri `resolveFormatOpts` LC:103-122 → `getStampContext(req)` **non-enforcing** + `?peripheralId/?templateId/?machineId` + `req.device.id`.

| # | Metod | Tam yol | Kapı zinciri | Handler → servis | Doğrulama | Yazma | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/labels/rolls/:id` | `VT → ANY(label:read, …PR)` | `getRollLabel` LC:127 | query elle · uuid✗ | R | JSON payload |
| 2 | GET | `/api/labels/rolls/:id/html` | aynı | `getRollLabelHtml` LC:179 (`?kind` yalnız ROLL_RAW/ROLL_FINISHED, `?copies`, `?confirmScrap`) | uuid✗ | R | `text/html` + `X-Label-Kind` |
| 3 | GET | `/api/labels/rolls/:id/ppla` | aynı | `getRollLabelPpla` LC:212 | uuid✗ | R | `text/plain` |
| 4 | GET | `/api/labels/rolls/:id/native` | aynı | `getRollLabelNative` LC:240 (`?encoding=b64` → JSON base64; aksi ham komut) | uuid✗ | R | `X-Label-Language/Kind/Template-Id/Variant-Match` |
| 5 | GET | `/api/labels/rolls/:id/preview` | aynı | `getRollPreview` LC:288 | uuid✗ | R | JSON |
| 6 | POST | `/api/labels/rolls/:id/print-native` | `VT → ANY(label:print, …PR)` | `printRollNative` LC:310 → `service.printRollNative(id, userId, opts)` (RAW TCP 9100; `label.nativeSendEnabled` prod'da **false** → simüle) + audit | **Zod YOK — seçenekler query'de** · uuid✗ | X + W (audit) | |
| 7 | GET | `/api/labels/peripherals/:id/sample-html` | `VT → ANY(label:read, station:read, …PR)` | `getSampleLabelHtml` LC:324 (mock veri) | uuid✗ | R | html |
| 8 | POST | `/api/labels/test-native` | `VT → ANY(label:print, station:write)` | `testNativeSend` LC:336 → `service.testNativeSend(body)` (**gövdeden gelen `printerIp:port`'a TCP**) | `testNativeSchema` LC:78-84 (`printerIp` trim 3-64 — IP biçimi/allowlist YOK; `port` 1-65535) | X | |
| 9 | POST | `/api/labels/rolls/bulk-html` | `VT → ANY(label:read, …PR)` | `getBulkRollLabelsHtml` LC:345 | `bulkLabelsSchema` LC:40-53 (`rollIds` ≤2000, `copies` ≤5, `customerId`) | R(POST) | html |
| 10 | POST | `/api/labels/rolls/bulk-native` | aynı | `getBulkRollLabelsNative` LC:360 | aynı (`encoding`) | R(POST) | `X-Label-Count` |
| 11 | GET | `/api/labels/name-preview` | `VT → ANY(label:read, …PR)` | `previewCustomerNames` LC:149 | `namePreviewSchema` LC:31-38 (**query** uuid'ler) | R | |
| 12 | POST | `/api/labels/preview/html` | `VT → P(label-template:read)` | `getPreviewHtml` LC:161 | `previewSchema` LC:60-75 (`labelKindSchema`) | R(POST) | html |
| 13 | POST | `/api/labels/preview/native-text` | `VT → P(label-template:read)` | `getPreviewNativeText` LC:171 | `previewSchema` | R(POST) | JSON |
| 14 | GET | `/api/labels/swatches/:id` | `VT → ANY(label:read, mobile:tambur, mobile:tarti-paket)` | `getSwatchLabel` LC:392 | uuid✗ | R | |
| 15 | GET | `/api/labels/swatches/:id/html` | aynı | `getSwatchLabelHtml` LC:404 | uuid✗ | R | html |
| 16 | GET | `/api/labels/swatches/:id/native` | aynı | `getSwatchLabelNative` LC:423 | uuid✗ | R | |
| 17 | GET | `/api/labels/sacks/:id` | `VT → SACK_LABEL_READ` | `getSackLabel` LC:442 | uuid✗ | R | |
| 18 | GET | `/api/labels/sacks/:id/html` | aynı | `getSackLabelHtml` LC:450 (SACK şablonu yoksa **fail-closed 400**) | uuid✗ | R | html |
| 19 | GET | `/api/labels/sacks/:id/native` | aynı | `getSackLabelNative` LC:469 (`?encoding=b64`) | uuid✗ | R | |
| 20 | POST | `/api/labels/sacks/:id/print-event` | `VT → ANY(label:print, mobile:tarti-paket, mobile:sevkiyat)` | `recordSackPrintEvent` LC:502 | gövde yok · uuid✗ | W (audit izi) | |
| 21 | PATCH | `/api/labels/order-lines/:id` | `VT → P(label:edit)` | `updateOrderLineCustomerNames` LC:509 → **`OrderLine` yazar** (sipariş domain'i) | `updateNamesSchema` LC:55-58 · uuid✗ | W | |
| 22 | POST | `/api/labels/rolls/:id/print` | `VT → ANY(label:print, …PR)` + `getStampContext(req)` non-enforcing LC:533 | `recordPrintEvent` LC:521 | `printEventSchema` LC:88-95 (`req.body ?? {}`) · uuid✗ | W (audit izi; `Roll.lastLabelSnapshot`? serviste) | |
| 23 | POST | `/api/labels/rolls/:id/seed-snapshot` | aynı | `seedRollLabelSnapshot` LC:557 | `printEventSchema` · uuid✗ | W (`Roll.lastLabelSnapshot`) | |
| 24 | POST | `/api/labels/rolls/seed-snapshot-bulk` | aynı | `seedRollLabelSnapshotsBulk` LC:583 | `seedBulkSchema` LC:18-25 (`rollIds` ≤2000) | W (toplu) | |
| 25 | GET | `/api/labels/standalone-templates` | `VT → ANY(label:print, label-template:read, …PR)` | `listStandaloneTemplates` LC:606 (`?customerId` `safeParse` — geçersizse sessizce yok sayılır) | — | R | |
| 26 | GET | `/api/labels/templates/:id/native` | aynı | `getStandaloneTemplateNative` LC:640 | uuid✗ | R | |
| 27 | GET | `/api/labels/templates/:id/html` | aynı | `getStandaloneTemplateHtml` LC:616 | uuid✗ | R | html |

---
## 6. KAPISIZ ROTALAR (kimlik doğrulamasız — altı kaynak çözüldü)

Tümü için zincir: `helmet → cors → compression → morgan → latency → express.json(1mb) → static → resolveDevice → requestContext → [route]` — hiçbir halkada kimlik yok (global `verifyToken`/`router.use` YOK, §0.1). "Public" = `verifyToken` hiçbir kaynakta bağlı değil.

| # | Metod | Tam yol | Dosya:satır | Bilinçli mi | Bekçi beyanı (`test_route_auth_coverage.ts` `EXEMPT`) | Yazma | Not |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/health` | `app.ts:479` | **evet** (login öncesi sunucu testi; alan kümesi dondurulmuş) | beyanlı | R (`SELECT 1`) | 5 sn'de bir çok istemci; rate limit YOK |
| 2 | GET | `/api/discovery/identity` | `discovery.routes.ts:34` | **evet** (istemci sunucuyu tanımadan çağırır; DB'siz) | beyanlı | R | hostname, firma adı, sürüm, port ifşası (LAN'da zaten açık — dosya gerekçesi) |
| 3 | GET | `/api/client-policy/` | `client-policy.routes.ts:59` | **evet** (dosya yorumu :8-11) | **BEYANSIZ → bekçi KIRMIZI** (§0.2) | R | 2026-08-28 eklendi |
| 4 | GET | `/api/client-policy/:istemci` | `client-policy.routes.ts:83` | evet | beyanlı | R | |
| 5 | POST | `/api/auth/login` | `auth.routes.ts:13` | evet (token üreten uç) | beyanlı | W (Session) | lockout controller'da (`auth.controller.ts:118`), `req.ip` anahtarlı, bellek-içi |
| 6 | POST | `/api/auth/login-card` | `auth.routes.ts:14` | evet | beyanlı | W | kart kodu tek istekte kimlik |
| 7 | POST | `/api/auth/login-quick-pin` | `auth.routes.ts:15` | evet | beyanlı | W | 6 haneli PIN uzayı; lockout tek savunma |
| 8 | GET | `/api/auth/login-methods` | `auth.routes.ts:16` | evet | beyanlı | R | firma adı dahil |
| 9 | GET | `/api/auth/mobile-users` | `auth.routes.ts:17` | evet — cihaz kapısı YALNIZ `device.pairingRequired=true` iken (prod kopyası: **false**) | beyanlı | R | **kimliksiz kullanıcı listesi** (`id, username, fullName`; `auth.service.ts:414-427`) |
| 10 | POST | `/api/devices/announce` | `device.routes.ts:26` | evet (eşleşme öncesi) | beyanlı | **W (kimliksiz yazma — PENDING kaydı)** | tavan `MAX_PENDING_DEVICES=200` (`device.service.ts:22`); rate limit YOK; prod: 28 APPROVED / 0 PENDING |
| 11 | GET | `/api/devices/status` | `device.routes.ts:37` | evet | beyanlı | R | bilinmeyen id → `UNKNOWN` |
| 12 | GET | `/api/devices/pairing-required` | `device.routes.ts:49` | evet | beyanlı | R | tek boolean |
| — | * | `/api/*` tanımsız | `app.ts:598` | evet | — | — | JSON 404 |
| — | GET | `/`, `/status.js`, `/logo.png` | `app.ts:158` static | evet | — | R | durum sayfası |
| — | GET | `/api-docs/*` | `config/swagger.ts:69-70` | yalnız `NODE_ENV!=="production"` | — | R | OpenAPI spec (tüm rota belgeleri) |

### 6.2 `verifyToken` VAR, route satırında RBAC YOK (bu kapsam — 9)

| Metod | Tam yol | Dosya:satır | Gerekçe (kaynakta) |
|---|---|---|---|
| GET | `/api/auth/me` | `auth.routes.ts:22` | self-servis |
| POST | `/api/auth/logout` | `auth.routes.ts:23` | self-servis |
| GET/PUT | `/api/auth/preferences` | `auth.routes.ts:26-27` | self-servis (kendi kaydı; audit muaf) |
| GET | `/api/currencies` | `currency.routes.ts:30` | sabit referans listesi (yazılı :4-7) |
| GET | `/api/document-profiles` · `/:id` | `document-profile.routes.ts:37,53` | "müşteri/fason formlarındaki profil seçici" (:4-5) — kardeş `free-documents`/`traveler-templates` aynı okuma için `DOCUMENT_DESIGN_READ` istiyor (asimetri) |
| GET | `/api/feature-flags` · `/documents-logo` | `feature-flag.routes.ts:391,462` | "tüm kullanıcılara açık, UI rehberi" (:4-5) — yanıt sistem ayarlarının tamamını taşıyor (§4.1 #1) |

Bekçi tabanı 12'nin kalan 3'ü (`record-info`, `reason-presets`, `search`) kapsam dışı dosyalarda; ikisi handler-içi dinamik izinle korunuyor (bekçi yorumu).

---

## 7. DOĞRULAMASIZ YAZMA UÇLARI (POST/PUT/PATCH/DELETE — Zod şeması olmayan)

### 7.1 Gövde TAŞIYAN ama Zod'suz (12)

| Metod | Tam yol | Ne var yerine | Dosya:satır |
|---|---|---|---|
| POST/PATCH | `/api/colors`, `/api/colors/:id` | `DMMF` allowlist (`sanitizeWriteData`) + `normalizeNameFields` + `ColorService.assertNameAvailable`; string uzunluk/biçim sınırı Zod'daki gibi YOK (DB `P2000` → 400 generic) | `color.routes.ts:118,149` → `base.controller.ts:95,107` |
| POST/PATCH | `/api/defect-types`, `/:id` | DMMF + `duplicateNameField` | `defect-type.routes.ts:121,150` |
| POST/PATCH | `/api/fabric-properties`, `/:id` | DMMF + `FabricPropertyService.create` (`stationIds` zorunlu — servis kuralı) | `fabric-property.routes.ts:158,193` |
| POST/PATCH | `/api/customers`, `/:id` | DMMF + `CustomerService` (`validateName`, `branches[]` şekillendirme) | `customer.routes.ts:142,179` |
| POST/PATCH | `/api/items`, `/:id` | DMMF + `ItemService` (`validateName`) | `item.routes.ts:152,224` |
| DELETE | `/api/rolls/:id` | Sözleşme **query string** (`confirmActive`, `confirmLabelPrinted` ölü, `reason`, `reasonCode`); Zod yok; `reasonCode` 64, `reason` serviste 500 kırpma | `inventory.routes.ts:572` → `inventory.controller.ts:562-587` |
| POST | `/api/labels/rolls/:id/print-native` | Seçenekler query'de (`orderLineId`, `customerId`, `stock`, `confirmScrap`, `peripheralId`, `templateId`, `machineId`) — Zod yok, `typeof === "string"` süzgeci | `label.routes.ts:195` → `label.controller.ts:310-321` |

### 7.2 Gövdesiz yazma (Zod gerekmez; yalnız path-param — `uuid✗` olanlar işaretli) (30)

`POST /api/admin/users/:id/deactivate|reactivate|card-token` (uuid✗) · `DELETE /api/admin/users/:id` (uuid✗) · `DELETE /api/admin/users/:id/permissions/:permissionId` (uuid✗) · `DELETE /api/admin/permission-templates/:id` (uuid✗) · `POST /api/admin/perf/reset` · `POST /api/admin/backup` · `POST /api/admin/backups/offsite/test|sweep` · `POST /api/auth/logout` · `DELETE /api/colors/:id` · `DELETE /api/customers/:customerId/item-aliases/:itemId|color-aliases/:colorId` (uuid✗) · `DELETE /api/customers/:customerId/branches/:branchId` (uuid✗) · `DELETE /api/customers/:id`, `/:id/permanent` · `POST /api/admin/db-copies/:name/verify`, `DELETE /api/admin/db-copies/:name` (`:name` serbest; `quoteIdent` serviste) · `DELETE /api/defect-types/:id`, `/:id/permanent` · `POST /api/admin/devices/:id/revoke|reactivate`, `DELETE /api/admin/devices/:id`, `/:id/permanent` (uuid✗) · `DELETE /api/document-profiles/:id` · `DELETE /api/fabric-properties/:id` · `DELETE /api/free-documents/:id` · `DELETE /api/rolls/:id/permanent`, `POST /api/rolls/:id/prepare-for-sale` (uuid✗) · `DELETE /api/items/:id`, `/:id/permanent` · `POST /api/label-templates/:id/duplicate|set-default`, `DELETE /:id`, `/:id/permanent`, `DELETE /variants/:variantId`, `POST /variants/:variantId/set-primary` (uuid✗) · `POST /api/labels/sacks/:id/print-event` (uuid✗).

### 7.3 Zod VAR ama "gevşek" (② için işaret)

| Uç | Şema | Gevşek nokta |
|---|---|---|
| `POST /api/rolls/initial-entry` | `initialEntrySchema` IC:20-50 | düz `z.object` — bilinmeyen alan sessizce atılır (**bilinçli**, eski APK; :51-55) |
| `PATCH /api/feature-flags` | `updateSchema` :94-376 | `documentsConfig: z.record(z.any())`, `travelerCardConfig` iç nesne gevşek → doğrulama serviste (`sanitizeDocumentsConfig`, `sanitizeTravelerFields`) |
| `POST /api/rolls/stats-batch` | `statsBatchSchema` IC:80-98 | `filters: z.record(z.any())` → `buildRollForceFilters` (serviste) |
| `POST /api/label-templates/preview`, `/:id/variants`, `PATCH /variants/:variantId`, `POST /import` | LT:79-93, 96-109, 119-139 | `elements: z.unknown()` → `validateCanvasLayout` serviste |
| `POST /api/config-bundle/preview|apply` | `bodySchema` :39-42 | `envelope: z.unknown()` → `validateEnvelope` (servis) |
| `PUT /api/auth/preferences` | `preferencesSchema` | `z.record(z.unknown())` (≤64 KB) — içerik istemcinin |
| `POST /api/labels/test-native` | `testNativeSchema` LC:78-84 | `printerIp` biçimsiz (3-64 karakter) |
| `PUT /api/admin/settings/:key` | `settingUpsertSchema` :1081-1084 | `:key` allowlist YOK (yalnız 3 yapılandırılmış anahtar reddedilir); `value` düz string ≤2000 |

---

## 8. DİNAMİK İZİN ÇÖZÜMÜ (kaynak #6 — route satırında görünmeyen kapılar)

| # | Uç | Nerede | Kural | Bilinmeyen anahtar / eksik durumda |
|---|---|---|---|---|
| 1 | `PATCH /api/feature-flags` | `feature-flag.routes.ts:38-46` `flagWriteGuard` | gövde anahtarları ⊆ `{documentsConfig, travelerCardConfig}` → `ANY(admin:settings, document-template:write)`; aksi/boş → `P(admin:settings)` | **fail-closed** (geniş yol) |
| 2 | `GET /api/config-bundle/export` | `config-bundle.routes.ts:112-113` `parseKinds` + `assertKindPermissions(read)` | istenen her tür için `BUNDLE_PERMISSIONS[k].read` | bilinmeyen tür → 400; eksik izin → 403 (türleri sayar) |
| 3 | `POST /api/config-bundle/preview|apply` | `:137-138,162-163` `validateEnvelope` + `assertKindPermissions(write)` | pakette bulunan her tür için `.write` | zarf geçersiz → 400; `PERMISSION_TEMPLATE` için `admin:users` |
| 4 | `GET /api/import/:entity/template`, `POST …/preview|apply` | `import.routes.ts:31-47` `requireEntityWrite` | `data:import` **VE** `adapter.writePermission` | bilinmeyen `:entity` → 404 (`import-registry.ts:61`) |
| 5 | `GET /api/import/:entity/export` | `import.routes.ts:50-64` `requireEntityRead` | yalnız `adapter.readPermission` (`data:import` YOK — D6) | 404 |
| 6 | `POST /api/rolls/initial-entry` (`semiFinished:true`) | `inventory.controller.ts:274-292` | `mobile:kk1-yari-mamul` ∨ `roll:write`; renk zorunlu | 403 / 400 — prod kopyasında `mobile:kk1-yari-mamul` **0 kullanıcı** → kapı fiilen `roll:write` |
| 7 | `GET /api/rolls/production-flow` | `inventory.controller.ts:350-354` | `quality:read` → kuyruk kolonları; `shipping:read|write` → sevk kolonu | eksikse kolon çizilmez (sessiz daralma, hata yok) |
| 8 | `PATCH /api/rolls/:id/label`, `/:id/manual-attributes` | `inventory.controller.ts:676,715` → `InventoryService.applyManualProperties(opts.permissions)` | topun DURUMU: `FREE_STOCK` serbest; diğer → `reason` zorunlu + `roll:manual-adjust` (F221: `opts` verilmezse enforcement yok — dahili çağrı) | servis OKUNMADI — [VARSAYIM] CLAUDE.md 2026-07-30 notu |
| 9 | `GET /api/auth/mobile-users` | `auth.controller.ts:377-386` | `req.device` yok **ve** `device.pairingRequired` → 401 | bayrak false (prod) → kapı yok |
| — | `resolveDevice` (global) | `device.middleware.ts:59-90` | `pairingRequired` bayrağına göre 401/503 ya da fail-open geçiş | bayrak false → tüm cihaz kontrolü fiilen kapalı |

`requirePermission(undefined)` davranışı (`rbac.middleware.ts:41`): `required.indexOf` → TypeError → 500 (fail-closed, 403 değil). Bu kapsamda `requirePermission(<değişken>)` çağrısı YOK; tüm dinamik noktalar `matchesPermission` ile kendi 403'ünü üretiyor.

---

## 9. Önceki envanterle karşılaştırma (2026-08-09 `audit/surface/02,03,04` ↔ HEAD `ce8681d1`; git tabanı `ef49bbc3` 2026-08-06 — o tarih ile 08-09 arasında commit yok)

### 9.1 Yeni dosyalar / mount'lar (bu kapsam)

| Yeni | Rota | Not |
|---|---|---|
| `client-policy.routes.ts` → `/api/client-policy` | 2 (public) | `app.ts:587`; `GET /` bekçide beyansız |
| `config-bundle.routes.ts` → `/api/config-bundle` | 4 | anahtar-kapsamlı yetki; `jsonBig` etkisiz |
| `discovery.routes.ts` → `/api/discovery` | 1 (public) | DB'siz |
| `import.routes.ts` → `/api/import` | 8 | iki katmanlı yetki; `jsonBig` etkisiz |
| `GET /api/admin/health` (`app.ts:562`) | 1 | zengin sağlık `/health`ten ayrıldı (F-CORE-GUV-002) |
| `runWithRequestContext` (`app.ts:175`) | global | audit "nereden" |
| Global sıra değişti | — | eski: `helmet→cors→compression→json→morgan→latency→resolveDevice→swagger→static`; yeni: `helmet→cors→compression→morgan→latency→json→swagger→static→resolveDevice→ctx` (F-CORE-OPS-003 / F-CORE-VER-002) |

Kapsam dışı yeni mount'lar (K1b/K1c): `/api/record-info`, `/api/reason-presets`, `/api/master-data`, `/api/search`, `/api/mobile`.

### 9.2 Eklenen rotalar (mevcut dosyalarda) — `git diff ef49bbc3..HEAD`

| Dosya | Eklenen | Sayı 08-09 → şimdi |
|---|---|---|
| admin | `GET /screens`, `GET/PATCH /backups/offsite`, `POST /backups/offsite/test|sweep|authorize` | 40 → 46 |
| inventory | `GET /duplicates`, `GET /entry-users`, `GET /entry-stations`, `POST /:id/scrap` | 24 → 28 |
| label | `GET /name-preview`, `POST /rolls/seed-snapshot-bulk` | 25 → 27 |
| item | `GET /similar-names` | 9 → 10 |
| customer | `GET /similar-names` | 6 → 7 |
| color / defect-type / fabric-property | `GET /similar-names` (her biri) | 5→6 / 6→7 / 5→6 |

**Kalkan rota: YOK** (diff'te yalnız `+` satırları ve guard değişiklikleri).

### 9.3 Kapı zinciri değişen rotalar (izin GENİŞLEMESİ — hepsi OR listesine ekleme)

| Uç | Eski | Yeni | Dosya:satır |
|---|---|---|---|
| `GET /api/colors` | 4 izin | +`mobile:tambur`, +`mobile:tarti-paket`, +`mobile:kk1-yari-mamul` | `color.routes.ts:64` |
| `GET /api/items` | 4 izin | +`mobile:tambur`, +`mobile:hizli-is-emri` | `item.routes.ts:93` |
| `GET /api/customers`, `/:id` | 6 mobil | +`mobile:hizli-is-emri` (`MOBILE_CUSTOMER_READ`) | `customer.routes.ts:11` |
| `GET /api/batches/number-state` | 2 izin | +`mobile:hizli-is-emri` | `batch.routes.ts:39` |
| `POST /api/kartela/rolls/:id/mark` | 3 izin | +`mobile:depo` | `kartela.routes.ts:292` |
| `DELETE /api/kursun-qc/error` | 2 izin | +`mobile:tambur` | `kursun-qc.routes.ts:207` |
| `GET /api/rolls/*` (`MOBILE_ROLL_READ`) | 9 mobil | +`mobile:kartela-sevk` | `inventory.routes.ts:26` |
| `similar-names` ×5 | — | yeni uçlar WRITE izniyle (bilinçli, yorumlu) | ilgili dosyalar |

Daralan izin: **YOK**.

### 9.4 Önceki envanterin işaretleri — durum (bu kapsamda)

| Eski işaret | Durum |
|---|---|
| A-R1 admin 40/40 inline | **Sürüyor**, 46/46 inline; route'tan audit yazımı 6 → 7 |
| A-R2 `test-native` gövdeden IP'ye TCP | **Sürüyor** (`label.controller.ts:78-84`); prod'da `label.nativeSendEnabled=false` |
| A-R4 önizleme uçları WRITE izniyle | **Sürüyor**: `rolls/:id/cancel-preview` (roll:write…), `kartela/receipts/:id/cancel-preview` (kartela:write), `kursun-bypass/:id/complete-preview` (canDistribute) |
| A-R6 oturum zorunluluğu asimetrisi | **Sürüyor**: enforce — `initial-entry`, `kursun-finish`, `kursun-qc/complete-qc2`; non-enforcing — `finish-step` (yorumlu), label baskı yolları; hiç okunmuyor — `open-fabric` |
| A-R7 path-param UUID doğrulaması | **Kısmen**: kursun-bypass 3 uç ve kursun-qc 3 uç doğruluyor; inventory/label/label-template/kartela/admin/customer-alias hâlâ `uuid✗` |
| A-R9 `PATCH /labels/order-lines/:id` OrderLine yazıyor | **Sürüyor** |
| A-R11 `credentials` tek izin vs `backups*` AND | **Sürüyor**; AND zinciri offsite uçlarına da yayıldı (bilinçli, `admin.routes.ts:1349-1358`) |
| B-#3 feature-flags GET RBAC'siz | **Sürüyor** |
| C-§3 `document-profiles` GET RBAC'siz, gerekçesiz | **Sürüyor** (gerekçe :4-5'te var ama asimetri açık) |
| C-§4 db-copy `:name` route'ta doğrulanmıyor; `await logEvent` | **Sürüyor** |
| C-§3 `/health` zengin yük public | **Kapandı** (`/api/admin/health`, bekçi alan kümesini kilitliyor) |
| B-§9 label-template `read`↔`write` kapsama yok | **Sürüyor** |

---

## 10. Rota sırası / gölgeleme gözlemleri (bugün çakışma yok — kırılgan noktalar)

| Yer | Gözlem |
|---|---|
| `admin.routes.ts:1063` `GET /system-logs/:id` | 5 literal kardeş (`stats`, `users`, `tables`, `archive`, `archive/:id`) ÖNCE — doğru; yeni literal bu satırdan sonra eklenirse `:id`'ye düşer |
| `admin.routes.ts:1361-1498` `/backups/offsite*` | 2-3 segment literal; `/backups/:name/download|restore-impact` 3 segment `:name`+literal — `GET /backups/offsite/test` diye bir uç olsaydı `:name=offsite` ile çakışırdı (bugün `test`/`sweep`/`authorize` yalnız POST, `download`/`restore-impact` yalnız GET → metot ayrımıyla güvenli) |
| `label-template.routes.ts:180` `/:id` | 9 literal yola bağımlı (yorum :164), bekçi yok |
| `label.routes.ts:266,297` `POST /rolls/bulk-*` vs olası `POST /rolls/:id` | dosyada `POST /rolls/:id` YOK → güvenli; `POST /rolls/:id/print|seed-snapshot` 3 segment |
| `label.routes.ts:652` `POST /rolls/seed-snapshot-bulk` | 2 segment literal, `POST /rolls/:id/seed-snapshot` 3 segment — çakışmaz |
| `inventory.routes.ts:249,292-319` `GET /barcode`, `/duplicates`, `/entry-users`, `/entry-stations` | tek segment literal'ler `GET /:id` (:426) ÖNCE — doğru |
| `customer.routes.ts:39-45` iç mount'lar `GET /:id` ÖNCE | yalnız alt yolları eşler; `/similar-names` (:103) düşer — güvenli |
| `app.ts:557 → 570 → 574` | `/api/admin/db-copies` önce (bilinçli); `/api/admin/devices` `/api/admin`'den SONRA — admin.routes'ta `/devices*` ya da catch-all yok |
| `kursun-qc.routes.ts:204` `DELETE /error` gövdeli | proxy/istemci gövdeyi düşürürse Zod 400 (mobil kuyruk dahil) |

---

## HOTSPOTLAR (② denetçileri için — öncelik sırasıyla; yargı değil işaret)

| # | Yer | Neden bakılmalı | Öneri: hangi hücre |
|---|---|---|---|
| H1 | `app.ts:141` + `import.routes.ts:28,242,279` + `config-bundle.routes.ts:27,133,158` | **ÖLÇÜLDÜ:** route-level 10 MB `express.json` global 1 MB parser'ın arkasında HİÇ koşmuyor (2 MB → 413). Yorumlar ve tasarım (`docs/design/IMPORT-EXPORT-TASARIM.md`) 10 MB / 10.000 satır vaat ediyor; 413 mesajı "1MB sınırı" der (`error.middleware.ts:293`). HTTP-seviyeli bekçi yok (`test_import_permissions.ts` küçük gövde gönderir). Sahada büyük dosya içe aktarımı sessizce 413'e düşer | CORE/ICE `dogruluk` / `mimari` |
| H2 | `client-policy.routes.ts:59` ↔ `scripts/test_route_auth_coverage.ts` `EXEMPT` | Bekçi HEAD'de **KIRMIZI** (public `GET /` beyansız). Kimlik kapsaması invariant'ının tek mekanik koruması bu bekçi; kırmızı bırakılırsa "yeni public uç" sinyali gürültüye karışır | CORE `guvenlik` / bekçi |
| H3 | `admin.routes.ts:1144-1168` `PUT /settings/:key` → `system-setting.service.ts:1032-1050` | `:key` allowlist YOK; `PATCH /feature-flags`'in `strictObject` sınırları (örn. `sessionDurationMinutes` 1-43200, `pinLockoutAttempts` 1-20, `backupHour` 0-23) bu ikinci kapıdan düz string ile atlanabilir; okuyucuların (`readPinLockoutConfig`, `readDevicePairingRequired`…) biçimsiz değere davranışı (NaN/varsayılan?) doğrulanmalı. Aynı `admin:settings` izni | CORE `dogruluk` |
| H4 | `feature-flag.routes.ts:391,462` · `document-profile.routes.ts:37,53` | `VT`-only okuma: tüm sistem yapılandırması (oturum/lockout politikası, künye, logo) ve belge profil `config`'i en dar mobil izinli kullanıcıya açık; kardeş yüzeyler `DOCUMENT_DESIGN_READ` istiyor (asimetri) | KIM/BLG `guvenlik` |
| H5 | `inventory.routes.ts:572` → `inventory.controller.ts:562-587` `DELETE /api/rolls/:id` | Yıkıcı uçta sözleşme query-string'de, Zod yok; `confirmLabelPrinted` ölü parametre (kabul edilir, kapı açmaz); `reason` uzunluğu yalnız serviste kırpılır; kardeş `POST /:id/scrap` gövdeli+Zod'lu — iki iptal yolu iki farklı sözleşme | ENV `dogruluk` |
| H6 | `label.controller.ts:78-84` + `label.service.ts:976-1030` `POST /api/labels/test-native` | Gövdeden gelen `printerIp:port`'a RAW TCP (SSRF sınıfı); `label.nativeSendEnabled` prod'da false — bayrak açılınca yüzey canlanır; izin `label:print ∨ station:write` (7 kullanıcı) | BLG `guvenlik` |
| H7 | Path-param `uuid✗` kümesi (~95 uç; §7.2 + tüm `:id` okuma uçları: inventory, label, label-template, kartela, admin, customer-alias/branch, device admin, import runs, batch split) | Geçersiz değer Prisma'ya iner → P2007/P2023 → 400 (error.middleware) — davranış tutarlı ama çoklu-seçim/CSV notundaki "sessiz 0 satır" arıza modu `findFirst` tabanlı servislerde mümkün; kursun-bypass/kursun-qc doğruluyor, geri kalanı doğrulamıyor | CORE `tip-guvenligi` (düşük) |
| H8 | `inventory.controller.ts:274-292` `semiFinished` kapısı | `mobile:kk1-yari-mamul` prod kopyasında **0 kullanıcı**; `roll:write` alternatifi kapıyı büro kullanıcısına açıyor — sahada yarı mamul kabulünün hangi izinle yapıldığı ölçülmeli (K2) | ENV `guvenlik`/`dogruluk` |
| H9 | `admin.routes.ts:1477-1498` `offsite/authorize` + `:1361-1389` `GET /backups/offsite` | Sır (Drive token) rclone config dosyasına yazılır (`writeRcloneDriveToken`); GET ucu config yolu + rclone binary yolunu döner; AND zinciri 4 kullanıcıda | CORE `guvenlik` |
| H10 | `auth.routes.ts:17` + `auth.controller.ts:377-386` `GET /api/auth/mobile-users`; `device.routes.ts:26` `POST /announce`; `app.ts:479` `/health` | Prod'da `device.pairingRequired=false` → kullanıcı listesi kimliksiz; `announce` kimliksiz yazma (tavan 200); `/health` `SELECT 1` — üçünde de rate limit yok (`express-rate-limit` repo genelinde 0 kullanım) | KIM `guvenlik` |
| H11 | `auth.controller.ts:118-128,202-213,281-292` lockout + `login-lockout.ts:24` | Kilit anahtarı `req.ip`; `trust proxy` YOK (bilinçli, LAN); bellek-içi `Map` (tek process invariant); `auth.pinLockoutEnabled` prod'da satır yok → varsayılan true; bekçi `test_p2_auth`/`test_session_registry` kapsamı ② tarafından ölçülmeli | KIM `eszamanlilik`/`guvenlik` |
| H12 | `db-copy.routes.ts:77-95,108-123,142-159,177-205` | `:name` route'ta serbest (serviste `quoteIdent` `pg-conn.helper`); `POST /` meşgul → 400 (409 değil); `swap-command` `await AuditService.logEvent` (audit hatası isteği düşürür mü — `AuditService` best-effort sözleşmesi ② doğrulamalı); tek koruma bellek-içi `isCopyJobRunning` (restart'ta sıfırlanır) | CORE `eszamanlilik`/`ops` |
| H13 | `import.routes.ts:213-225` `GET /:entity/template` WRITE izni; `:309-326` `GET /:entity/export` `data:import`'suz (D6) | Okuma ucu için yazma izni; dışa aktarım tam veri (limitsiz) yalnız varlık read izniyle — bilinçli karar ama `order`/`customer` tam dökümü 6 kullanıcıya açık | ICE `guvenlik` (düşük) |
| H14 | `label.routes.ts:576-581` `PATCH /api/labels/order-lines/:id` | Etiket domain'inden `OrderLine` yazımı (`label:edit`, 7 kullanıcı) — bounded context sınırı (beceri §7.2 üç koşul) | BLG/SIP `mimari` |
| H15 | Oturum damgası asimetrisi: `inventory.controller.ts:215-223` (`open-fabric` damgasız) · `kursun-qc.controller.ts:183` (`finish-step` non-enforcing) · `label.controller.ts:103-122` (baskı non-enforcing) | Aynı istasyonun iki yolu farklı makine atfı üretebilir; `open-fabric` `machineId` hiç geçmiyor | URT `dogruluk` |
| H16 | `admin.routes.ts:521-533` `credentials` (tek `admin:users`) vs `:1223-1344` `backups*` (AND) | Aynı sırların iki farklı eşiği (A-R11 sürüyor); prod'da `admin:users` 4 kullanıcı | KIM `guvenlik` |
| H17 | `config/swagger.ts:69` (`NODE_ENV`) vs `app.ts:120` (`APP_ENV ?? NODE_ENV`) | pm2 dışı başlatmada (yalnız `APP_ENV=production`) `/api-docs` kimliksiz açık kalır; ecosystem ikisini de veriyor | CORE `ops` (bilgi) |
| H18 | `kartela.controller.ts:10-16,27-46` `dispatch`/`receive` `clientToken` YOK | Kayıt yaratan iki uç idempotency taşımıyor (kardeş `stock/reduce` taşıyor); mobil retry'da mükerrer sevk/makbuz | KRT `eszamanlilik` |
| H19 | `label-template.routes.ts:126,148` `POST /preview-raw`, `/preview` READ izniyle render | Kullanıcı ham kodu/eleman ağacı sunucuda render ediliyor (`buildRawCodePreview`, `validateCanvasLayout`) — `label-template:read` 7 kullanıcı; DoS/enjeksiyon yüzeyi servis tarafında | BLG `guvenlik` (düşük) |
| H20 | `rbac.middleware.ts:35-47` `matchesPermission` domain wildcard | `mobile:*` prod'da 1 kullanıcı — tüm `mobile:` uçlarını (depo iptal, tambur düzelt, kartela…) kapsar; `admin:*` 3 kullanıcı | KIM `guvenlik` (bilgi) |

## SINIR ÖTESİ NOTLAR

| Gözlem | Yönlendirme |
|---|---|
| `test_route_auth_coverage.ts` HEAD'de kırmızı; `EXEMPT` listesi `/api/mobile/updates/*` uçlarını da taşıyor — o dosya bu kapsamda değil | K1b (mobile-update) + bekçi denetçisi |
| Route-level `jsonBig` etkisizliği (§0.2) `master-data-merge`/`order`/`shipping` gibi başka dosyalarda da `express.json` kullanılıyorsa aynı sınıf | K1b/K1c: `grep -rn 'express.json' src/routes` |
| Bare-chain bekçi tabanı 12'nin 3'ü (`record-info`, `reason-presets`, `search`) — handler-içi dinamik izin (`TABLE_PERMISSIONS`, kova bazlı) | K1b/K1c |
| Prod kopyası izin dağılımı: `mobile:kk1-yari-mamul` 0, `data:import` 1, `master-data:merge` 1, `mobile:kk1-desen` 1, `mobile:*` 1, `admin:*` 3; AND zinciri (settings+users) 4 aktif kullanıcı; `device.pairingRequired=false`, `label.nativeSendEnabled=false`, `kk1.duplicateGuardEnabled=true`, `auth.loginMethods {list,pin}/pin`, 28 APPROVED cihaz | K2 (veri) — "izin var, kullanıcı yok" sınıfı |
| Bellek-içi durum taşıyıcıları bu kapsamdaki uçların arkasında: `lastSeenWrites` (`auth.middleware.ts:16`), `failCounts` lockout (`login-lockout.ts:24`), `featureFlagsCache` (`system-setting.service.ts:1154`), `isCopyJobRunning`/`isBackupRunning`, latency sayaçları, `presence` — tek-process invariant `ecosystem.config.js:42-48` | K3 (eşzamanlılık/durum) |
| `AuditService.logEvent` route katmanından `await` ile çağrılıyor (admin ×7, db-copy ×1) — best-effort sözleşmesi servis içinde mi? | K3/K-audit |
| `POST /api/admin/backup`, `db-copies`, `offsite/*` child process (`pg_dump`, `pg_restore`, `rclone`) — `timeout:` seçeneği, damga yeri, hata kaydı | K3 scheduler/child-process |
| `GET /api/rolls/stats-batch` paralel `roll.aggregate` ×≤12 (havuz 30) — fan-out tavanı yorumlu | K3 havuz |
| Electron import istemcisinin gövdeyi parçalayıp parçalamadığı doğrulanamadı (`Electron/src/lib/import/*`de chunk izi yok) — H1 sahada ısırır mı? | Electron turu |
| `customer-branch-list.routes.ts:15-23` ve `defect-type.routes.ts:16-27`: route dosyasında `new BaseService(...)` — servis örneği route katmanında kuruluyor (katman gözlemi; iş kuralı taşımıyor) | K-mimari |
| `label.routes.ts` 27 uç / `label.controller.ts` — `resolveFormatOpts` `req.device.id` ile cihaz-yönlendirme; `x-device-id` sahte başlıkla `req.device` çözümü `resolveDevice`'a bağlı (pairing kapalıyken bilinmeyen cihaz geçer ama `req.device` boş kalır) | KIM/BLG |

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Servis gövdeleri okunmadı** (`inventory.service`, `label.service`, `kartela.service`, `kursun-*`, `permission-management`, `backup`, `db-copy` (yalnız grep), `system-setting` (yalnız `set`/`getFeatureFlags` başlıkları)). "Yanıtta ne döner" sütunu handler'daki `res.*` çağrısına dayanır; veri şekli servisin `ApiResponse`'udur — `[VARSAYIM]` işaretli yerler buna dahil. Servis-içi guard/claim/tx yapısı ② hücrelerine bırakıldı.
- **Swagger YAML blokları süzüldü** — belge ↔ kod sözleşmesi (örn. "fiziksel siler" vs arşivler) bu haritada karşılaştırılmadı (önceki A-R3 örneği kapsam dışı dosyada).
- `ImportService.preview`in `ImportRun` yazıp yazmadığı; `FreeDocumentService.create`in audit yazıp yazmadığı; `getBatchNumberState` yanıt şekli — doğrulanmadı (`[VARSAYIM]`).
- `AuthService.verifyToken` JWT algoritması/sır kaynağı/süre; `issueToken` payload alan kümesi (yalnız satır referansı) — KIM alanı.
- Electron/mobil istemcilerin hangi uçları fiilen çağırdığı (ölü uç analizi) — tur/istemci taraması yapılmadı.
- Prod kopyası 2026-08-25 tarihli ve 190/195 migration; canlı prod'a erişim yok. Sorgular yalnız izin/ayar/cihaz sayımıydı (3 sorgu).
- `test_route_auth_coverage` dışında bekçi koşulmadı (`test_permission_catalog`, `test_mobile_screen_permissions`, `test_import_permissions` vb. yalnız başlıkları/grep'i okundu).
- Kapsam dışı 26 route dosyası (§1.2 listesi) ve `reports/*` alt router'ları — K1b/K1c.
- `resolveDevice`nin `EXEMPT_PATHS` dışındaki public uçlara (`/health`, `/api/discovery/identity`, `/api/client-policy/*`, `/api/auth/login*`) etkisi: `x-device-id` gönderen PENDING cihaz `pairingRequired=true` iken bu uçlarda da 401 alır — davranış okundu (`device.middleware.ts:76-90`) ama istemci akışına etkisi ölçülmedi.
