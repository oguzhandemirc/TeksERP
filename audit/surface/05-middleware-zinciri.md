# 05 — Middleware Zinciri ve SIRASI

**Kapsam:** `src/app.ts` (462 satır, tam okundu), `src/server.ts` (188 satır, tam okundu),
`src/middlewares/` (7 dosya, 1.067 satır, tümü okundu), `src/config/swagger.ts`.
**Amaç:** Denetimin nereye bakacağını belirlemek. Bu bir bulgu raporu DEĞİL, bir keşif haritasıdır.

**Ölçüm ortamı:** `/Users/oad/Documents/projeler/AdnanSahin/Teks-Erp`, branch `main`, commit `ef49bbc3`.
Aşağıdaki sürümler `node_modules/*/package.json`'dan okundu (package.json aralığından değil):

| Paket | Kurulu sürüm |
|---|---|
| express | 5.2.1 |
| helmet | 8.1.0 |
| cors | 2.8.6 |
| compression | 1.8.1 |
| morgan | 1.10.1 |
| zod | 4.3.6 |
| @prisma/client | 7.7.0 |
| pg | 8.20.0 |

---

## 1. `app.use(...)` — SIRALI LİSTE

`grep -c "^app\.use(" src/app.ts` → **56**. Bunun dağılımı: 8 çekirdek + 46 API router mount +
1 JSON 404 + 1 error handler. Ek olarak 1 adet `app.get` (`/health`) ve `setupSwagger` içinde
**koşullu** 1 adet `app.use('/api-docs', ...)`.

Aşağıdaki sıra dosyadaki fiziksel sıradır ve Express'te çalıştırma sırasıdır.

| # | Satır | Ne | Paket / Dosya | Sıra kritik mi |
|---|---|---|---|---|
| 1 | `app.ts:86-94` | Güvenlik başlıkları (CSP + diğer) | `helmet` | **EVET** — cors'tan önce olmalı; preflight yanıtına da başlık basılsın |
| 2 | `app.ts:98` | CORS (`exposedHeaders` ile) | `cors` | **EVET** — body parser'dan ÖNCE (preflight gövde beklemez) |
| 3 | `app.ts:101` | Yanıt sıkıştırma, `threshold: 1024` | `compression` | Hayır (yanıt tarafı) |
| 4 | `app.ts:104` | JSON body parse, `limit: "1mb"` | `express.json` | **EVET** — bkz. §7.5 (morgan/latency'den ÖNCE olması bir KÖR NOKTA üretiyor) |
| 5 | `app.ts:107-108` | Erişim log'u; prod `combined`, dev `dev` | `morgan` | **EVET** — 4'ün ARDINDA; parse hatası morgan'a hiç ulaşmıyor |
| 6 | `app.ts:115` | Uç bazlı gecikme ölçümü | `middlewares/latency.middleware.ts` | **EVET** — kendi yorumu "her şey ölçülür" diyor, gerçekte 4'ün hatası ölçülmüyor |
| 7 | `app.ts:118` | `x-device-id` → `req.device` çözümü | `middlewares/device.middleware.ts` | **EVET** — auth'tan ÖNCE (login akışı cihaz kapısından geçer); istek başına 1 DB sorgusu |
| 8 | `app.ts:123` | Swagger UI mount | `config/swagger.ts` → `swagger-ui-express` | **KOŞULLU** — `NODE_ENV === "production"` ise HİÇ mount edilmez (bkz. §7.4) |
| 9 | `app.ts:135` | Statik durum sayfası (`public/`) | `express.static` | Kısmen — API mount'larından ÖNCE; `public/` yalnız `index.html`, `logo.png`, `status.js` içeriyor, çakışma yok |
| 10 | `app.ts:285` | `GET /health` (DB + havuz + disk + CPU/RAM + presence + audit sağlığı) | `app.ts` içinde | Hayır |
| 11 | `app.ts:392-439` | **46 adet** `app.use("/api/...", router)` | `routes/*` | Kısmen — bkz. §2 |
| 12 | `app.ts:450` | `/api` altındaki tanımsız yollar için JSON 404 | `app.ts` içinde | **EVET** — tüm API mount'larından SONRA, error handler'dan ÖNCE |
| 13 | `app.ts:460` | Global error handler (4 argümanlı) | `middlewares/error.middleware.ts` | **EVET** — zincirin EN SONU. Doğru konumda. |

### Sıranın kritik olduğu yerler — özet

- **helmet → cors:** doğru sırada (1 → 2).
- **body parser → rate limit:** projede rate limit **YOK** (§6), dolayısıyla bu klasik sıra sorusu doğmuyor.
  Ancak `express.json` **morgan ve latency'den ÖNCE** olduğu için gövde hatası üreten istekler
  (bozuk JSON → 400, 1MB aşımı → 413) **ne erişim log'una ne gecikme metriğine** düşüyor (§7.5).
- **auth → audit:** `verifyToken` global DEĞİL, route başına takılıyor (§3.1). Audit yazımı
  middleware'de değil servis katmanında; error handler ise `req.user?.userId`'yi okuyor —
  yani auth'tan sonra çalıştığı için kullanıcı kimliği hata log'una girebiliyor. Bu sıra doğru.
- **error handler en sonda:** evet, `app.ts:460`, son `app.use`.
- **404 handler'ın konumu:** `app.ts:450`, tüm API router'larından sonra, error handler'dan önce.
  Doğru. Ama kapsamı yalnız `/api` — `/api-docs` bu ağa TAKILMIYOR (§7.6, ölçüldü).

---

## 2. API mount sırası — prefix çakışmaları

`app.ts` içinde 46 `app.use("/api/...")` var. Üç yer prefix örtüşmesi taşıyor:

| Mount | Satır | Durum |
|---|---|---|
| `/api/admin/db-copies` | 433 | Genel `/api/admin`'den **ÖNCE**; kodda gerekçeli yorum var |
| `/api/admin` | 434 | — |
| `/api/admin/devices` | 438 | Genel `/api/admin`'den **SONRA** — db-copies emsalinin TERSİ |
| `/api/subcontractor` | 410 | — |
| `/api/subcontractors` | 412 | — |

**Ölçüm (Express 5.2.1 ile canlı sonda çalıştırıldı):**
`app.use("/api/subcontractor")` isteği `/api/subcontractors/x`'i **YAKALAMIYOR** (segment sınırı
korunuyor) → bu çift güvenli. `/api/admin/devices` de bugün **çalışıyor**, çünkü `admin.routes.ts`
o yolu eşleyen bir route taşımıyor ve eşleşmeyince `next()` ile devam ediyor
(`admin.routes.ts` 40 route kaydının hiçbiri `/devices` ya da kök `/:param` değil).

**Denetimde bakılacak:** `/api/admin/devices`'in sırası bir **kırılganlık**tır, bugünkü bir hata değil.
`admin.routes.ts`'e kök seviyesinde parametreli bir route (`router.get("/:x")`) eklenirse
`deviceAdminRouter` sessizce gölgelenir. db-copies için yazılmış "spesifik olan önce gelmeli"
gerekçesi burada uygulanmamış.

---

## 3. `src/middlewares/` — sözleşme tablosu

7 dosya, 1.067 satır (`wc -l` ile ölçüldü).

| Dosya | Satır | Tip | Girdi | Başarı çıktısı | Hata davranışı | `next(err)` disiplini |
|---|---|---|---|---|---|---|
| `auth.middleware.ts` (`verifyToken`) | 110 | async middleware | `Authorization: Bearer <jwt>` | `req.user = payload` + `touchUser` + throttled `Session.lastSeenAt` yazımı | Tüm hata yolları `AppError.unauthorized` (401) | **Doğru** — tek `try/catch`, `next(error)`; header yokken erken `return next(AppError...)` |
| `rbac.middleware.ts` (`requirePermission`, `requireAnyPermission`, `matchesPermission`) | 82 | senkron factory | `req.user.permissions[]` | `next()` | `req.user` yok → 401; izin yok → 403 (`AppError.forbidden`) | **Doğru** — hepsi `next(AppError...)` |
| `error.middleware.ts` (`errorHandler`) | 515 | 4-arg error handler | `err`, `req` | — | Zincirin sonu; 9 sınıflandırma dalı (§5) | **Terminal** — kendisi `next` çağırmıyor (`_next` kullanılmıyor) |
| `device.middleware.ts` (`resolveDevice`) | 105 | async middleware | `x-device-id` header | `req.device = {...}` + `touchDevice` | **`next(err)` KULLANMIYOR** — doğrudan `res.status(503/401).json()` yazıyor | **Sapma** — bilinçli; `code: DEVICE_CHECK_UNAVAILABLE` / `DEVICE_INACTIVE` ile |
| `latency.middleware.ts` (`latencyMiddleware`) | 101 | senkron middleware | her istek | `res.on("finish"/"close")` dinleyicileri | Hata üretmez; `recorded` guard'ı çift kaydı önler | Uygulanamaz (hata yolu yok) |
| `login-lockout.ts` | 129 | middleware DEĞİL — saf yardımcı | `req` (yalnız anahtar çözümü için) | `{blocked, retryAfterSec}` | Hata fırlatmaz | Uygulanamaz — `auth.controller.ts`'ten çağrılıyor (satır 161/163/180/199/240/242/259/276) |
| `uuid-param.middleware.ts` (`assertValidUuid`) | 25 | middleware DEĞİL — saf fonksiyon | `unknown` | `string` | `AppError.badRequest` **throw** eder | Çağıranın `try/catch`'ine bağlı (`base.controller.getParamId`) |

### 3.1 `verifyToken` route BAŞINA takılıyor — global değil

- `grep "router.use(verifyToken"` → **0 sonuç.** Hiçbir router'da toplu auth yok.
- Route kayıtları taranarak (`router.<method>(` deseni + dosya içi `const guard = [verifyToken, ...]`
  alias'ları çözülerek) **500 route kaydı** bulundu.
- **Auth guard'ı taşımayan 8 route** — hepsi bilinçli public:
  - `auth.routes.ts:13-17` → `/login`, `/login-card`, `/login-quick-pin`, `/login-methods`, `/mobile-users`
  - `device.routes.ts:26/37/49` → `/announce`, `/status`, `/pairing-required`
- **Statik izin guard'ı taşımayan 22 route:** yukarıdaki 8 + `auth.routes` self-servis 4'lüsü
  (`/me`, `/logout`, `/preferences` ×2) + `currency.routes.ts:30` + `document-profile.routes.ts:37,53`
  + `feature-flag.routes.ts:338,409` + `printed-document.routes.ts:142,184,201,219,246`.
  Son grup izin kontrolünü **handler içinde dinamik** yapıyor (`DOC_PERMISSIONS`, `flagWriteGuard`).
  Bu sayılar kök `CLAUDE.md`'deki "496 uçtan 473'ü guard'lı, guard'sız 23" ifadesiyle
  yakın ama birebir aynı değil — sayım yöntemi farkı olabilir (**ŞÜPHELİ**: iki sayımın
  hangi kayıtları saydığı karşılaştırılmadı).

**Denetimde bakılacak:** `verifyToken`'ın route başına takılması **fail-open** bir desendir —
yeni bir route eklenip `verifyToken` unutulursa uç **sessizce public** olur, hata da log da çıkmaz.
`scripts/test_permission_catalog.ts` (546 satır) `verifyToken` kelimesini **hiç geçirmiyor**
(grep → 0). `test_depo_roll_cancel_permission.ts` ve `test_document_template_permission.ts`
route stack'inin ilk elemanının `verifyToken` olduğunu doğruluyor ama **yalnız kendi ölçtükleri
route'lar için**. Yani "her route auth taşıyor" invariant'ının mekanik bir bekçisi YOK.

---

## 4. Express 5'e özgü davranış — async hata yakalama

**Ölçüldü (kurulu express 5.2.1 ile canlı sonda):** `async` handler'ın hem `throw`'u hem
`Promise.reject`'i error middleware'e **otomatik** ulaşıyor. Yani manuel sarmalayıcı gerekmiyor.

**Kodda ne var:**

| Ölçüm | Değer |
|---|---|
| `asyncHandler` / `catchAsync` / `express-async-errors` | **0 kullanım** (grep, `src/` geneli) |
| `routes/` + `controllers/` + `middlewares/` içindeki `catch (x) {` bloğu | **432** |
| Bu 432 bloktan `next(...)` ÇAĞIRMAYAN | **0** |
| Parametresiz `catch {` (yutma adayı) — HTTP katmanı | **1** (`device.middleware.ts:62`, gerekçesi yorumda yazılı) |
| Parametresiz `catch {` — `src/` geneli | 32 (çoğu servis katmanında) |
| `routes/` async handler ↔ `try {` blok dengesi | Her dosyada `try` sayısı ≥ async handler sayısı (fark hiçbir dosyada pozitif değil) |

**Sonuç:** desen **tutarlı** — asyncHandler yok, her yerde elle `try/catch` + `next(err)`,
ve hiçbir yerde hata yutulmuyor. Express 5 zaten yakalayacağı için bu **gereksiz** ama zararsız
ve açık. Karışık bir durum (bir kısmı sarmalayıcı, bir kısmı elle) YOK.

**Express 5'in `req.body` değişikliği:** Express 5'te body parse edilmediğinde `req.body`
`undefined`'dır (4'te `{}` idi). Kodda `req.body`'ye doğrudan alan erişimi **1 yerde** var
(`workorder.controller.ts:612`, ve o da `req.body?.notes` ile opsiyonel zincirle) —
diğer **140 nokta** `<şema>.parse(req.body)` kullanıyor, yani `undefined` gelirse ZodError → 400.
Bu değişiklik bu kod tabanında **iyi karşılanmış**.

**Not:** `express.urlencoded`, `express.raw`, `express.text` **hiç mount edilmemiş** (grep → 0).
Yalnız `application/json` parse ediliyor.

---

## 5. Error middleware — Prisma/hata kodu → HTTP eşlemesi

`error.middleware.ts` içindeki dal SIRASI (sıra load-bearing, aşağıda işaretli):

| # | Dal | Koşul | HTTP | Yan etki |
|---|---|---|---|---|
| 1 | `AppError` | `instanceof` | `err.statusCode` | `details` varsa gövdeye eklenir |
| 2 | JSON parse hatası | `SyntaxError && status===400` | **400** | — |
| 3 | Gövde çok büyük | `err.type === "entity.too.large"` | **413** | — |
| 4 | **Havuz zaman aşımı** | `classifyPoolTimeout(err)` | **503** + `Retry-After: 3` | `recordPoolTimeout` + `SYSTEM/ERROR` audit, `recordId=POOL_TIMEOUT` |
| 5 | **CHECK ihlali (23514)** | `extractCheckConstraint(err) !== null` | **409** | `SYSTEM/ERROR` audit, `recordId=CHECK_VIOLATION` |
| 6 | `PrismaClientKnownRequestError` | `instanceof` **veya** `constructor.name` | ↓ alt tablo | — |
| 7 | `PrismaClientValidationError` | aynı çift kontrol | **400** | — |
| 8 | `ZodError` | aynı çift kontrol | **400** | `errors[]` = `{field, message}` listesi |
| 9 | Bilinmeyen | fallback | **500** | `SYSTEM/ERROR` audit, `recordId = err.name` |

**4 ve 5'in konumu bilinçli ve yorumda gerekçeli:** ikisi de Prisma dalından ÖNCE, çünkü
`@prisma/adapter-pg` kurulumunda bu hatalar **çıplak `Error` / `DriverAdapterError`** olarak gelir
ve `PrismaClientKnownRequestError` dalına hiç girmez.

### 5.1 Prisma kod eşlemesi (dal 6'nın içi, dosyadaki sırayla)

| Prisma kodu | HTTP | Mesaj (Türkçe) | Audit |
|---|---|---|---|
| `P2002` (unique) | **409** | `Bu '<kolon>' değeri zaten mevcut (unique constraint).` | Hayır (kolon çözülemezse `console.warn`) |
| `P2025` (kayıt yok) | **404** | `Kayıt bulunamadı.` | Hayır |
| `P2003` (FK) | **400** | `Geçersiz referans: '<alan>' için belirtilen kayıt bulunamadı veya silinmiş.` | Hayır |
| `P2007` (veri doğrulama, örn. hatalı uuid) | **400** | `Geçersiz veri formatı (örn. hatalı ID)...` | Hayır |
| `P2023` (tutarsız kolon verisi) | **400** | `Geçersiz ID formatı (beklenen: UUID)...` | Hayır |
| `P2020` (aralık dışı) | **400** | `Sayısal değer izin verilen aralık dışında...` | Hayır |
| `P2022` (kolon yok / şema drift) | **500** | `Sunucu yapılandırma hatası...` | **EVET** (`recordId=P2022`) |
| `P2014` (zorunlu ilişki) | **400** | `İlişki kuralı ihlali...` | Hayır |
| `P2034` (write conflict / deadlock) | **409** | `İşlem şu anda başka bir işlemle çakıştı...` | Hayır |
| `P2024` \| `P2028` (havuz / tx zaman aşımı) | **503** + `Retry-After: 3` | `SERVER_BUSY_MESSAGE` | **EVET** (`recordId = kod`) |
| **diğer tüm `P****`** | **400** | `İstek işlenemedi. Gönderilen veriyi kontrol edin.` | **HAYIR** — yalnız `console.error` |

**P2024 hakkında kodda yazılı olan:** `@prisma/adapter-pg` kullanıldığı için Rust havuzu yok →
Prisma P2024 **üretemez**; o dal savunma amaçlı bırakılmış. Gerçek havuz zaman aşımı dal 4'te
yakalanıyor.

**`classifyPoolTimeout` mesaj metnine bağlı** (`pool-health.ts:44-45`):
`"timeout exceeded when trying to connect"` ve `"Connection terminated due to connection timeout"`.
Bu iki metin `node_modules/pg-pool/index.js:224` ve `:276`'da **birebir doğrulandı**.
Ayrıca `scripts/test_pool_health.ts` bu hataları sahte üretmiyor, **gerçek pg-pool'dan**
(küçük tavanlı geçici havuzla) ürettiriyor — yani pg sürüm yükseltmesinde metin değişirse
bekçi kırmızı verir. Bu sağlam bir kurgu, denetimde riske yazmaya gerek yok.

---

## 6. Rate limiting

**YOK.** `express-rate-limit`, `express-slow-down` ya da eşdeğeri **kurulu değil**
(package.json dependencies 18 paket, hiçbiri rate limit değil) ve `src/` içinde
`rate-limit|rateLimit|slow-down` geçen tek satır bile yok (grep → 0).

Tek throttle mekanizması **`middlewares/login-lockout.ts`** ve o da:
- Bir middleware değil, `auth.controller.ts`'ten çağrılan saf yardımcı,
- Yalnız **hızlı-PIN** ve **kart** girişlerini kapsıyor (`loginQuickPin`, `loginCard`);
  klasik `POST /api/auth/login` bu yardımcıyı **çağırmıyor** (`grep reserveLoginAttempt` →
  yalnız satır 163 ve 242, ikisi de PIN/kart dalında),
- Bellek-içi `Map` (restart'ta sıfırlanır, tek-process invariant'ına bağlı),
- Anahtar `req.ip` (yoksa `dev:<deviceId>`, yoksa `"unknown"`),
- `SystemSetting`'ten canlı okunan ayarlarla (`pinLockoutEnabled` kapalıysa hiç çalışmaz).

Yani **API'nin geri kalanında (500 route) hiçbir istek hızı sınırı yok.**

---

## 7. Yapılandırma DEĞERLERİ (ölçülmüş, "var" değil)

### 7.1 helmet — `app.ts:86-94`

```js
helmet({
  contentSecurityPolicy: { useDefaults: true, directives: { upgradeInsecureRequests: null } },
  strictTransportSecurity: false,
})
```

Bu konfigürasyonun **gerçekten ürettiği başlıklar** (helmet 8.1.0 doğrudan çalıştırılıp ölçüldü):

| Başlık | Değer |
|---|---|
| `Content-Security-Policy` | `default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline'` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Origin-Agent-Cluster` | `?1` |
| `Referrer-Policy` | `no-referrer` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Download-Options` | `noopen` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `X-XSS-Protection` | `0` |

`upgrade-insecure-requests` gerçekten **yok** (HTTP-only LAN gerekçesi kodda yazılı) ve
`Strict-Transport-Security` **basılmıyor**.

**Denetimde bakılacak (ŞÜPHELİ):** `Cross-Origin-Resource-Policy: same-origin` **açık**.
Bu başlık `fetch`/XHR'ı (CORS modunda) engellemez ama tarayıcı/Chromium'un `no-cors`
alt-kaynak yüklemelerini (ör. `<img src="http://sunucu:4000/...">`) **cross-origin'de bloklar**.
Electron renderer ve mobil istemci bu sunucuya farklı origin'den bakıyor. Etiket/belge/logo
gibi bir varlık doğrudan URL ile `<img>`/iframe'e veriliyorsa bu başlık ısırır. Bu ölçülmedi —
istemci tarafında doğrudan URL ile yüklenen varlık var mı, kontrol edilmeli.

### 7.2 CORS — `app.ts:98`

```js
cors({ exposedHeaders: ["X-Label-Language","X-Label-Kind","X-Label-Count",
                        "X-Label-Template-Id","X-Label-Variant-Match","Date"] })
```

`origin`, `credentials`, `methods`, `allowedHeaders` **verilmemiş** → cors 2.8.6 varsayılanları
geçerli. Ölçülen çıktı:

| İstek | Üretilen başlıklar |
|---|---|
| `GET`, `Origin: http://evil.example` | `Access-Control-Allow-Origin: *` · `Access-Control-Expose-Headers: X-Label-Language,X-Label-Kind,X-Label-Count,X-Label-Template-Id,X-Label-Variant-Match,Date` |
| Preflight `OPTIONS` | `Access-Control-Allow-Origin: *` · `Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE` · `Access-Control-Allow-Headers: <istenen başlıklar aynen yansıtılır>` · `Vary: Access-Control-Request-Headers` · **204 ile sonlanır** |

`Access-Control-Allow-Credentials` **basılmıyor** (kimlik `Authorization` header'ında,
cookie yok) — yani klasik tarayıcı CSRF'i doğrudan uygulanmıyor.

**Denetimde bakılacak:** origin allowlist'i yok. LAN'daki herhangi bir tarayıcı sayfası
API'ye istek atabilir; public uçlar (`/api/auth/mobile-users`, `/api/auth/login-methods`,
`/api/auth/login-quick-pin`) bu yüzden **herhangi bir web sayfasından** çağrılabilir durumda.

**Ayrıca:** preflight `OPTIONS` cors middleware'inde (sıra #2) **sonlanıyor**, yani
latency middleware'e (#6) hiç ulaşmıyor → preflight istekleri gecikme istatistiğinde **yok**.

### 7.3 compression / morgan / express.json

| Ayar | Değer | Yer |
|---|---|---|
| `compression` | `{ threshold: 1024 }` — 1KB altı yanıt sıkıştırılmaz | `app.ts:101` |
| `express.json` | `{ limit: "1mb" }` | `app.ts:104` |
| `morgan` | prod `"combined"`, dev `"dev"` | `app.ts:107-108` |
| prod tespiti (morgan için) | `(process.env.APP_ENV ?? process.env.NODE_ENV) === "production"` | `app.ts:107` |

### 7.4 Swagger — iki farklı "production" tanımı

- `app.ts:107` → `APP_ENV ?? NODE_ENV`
- `config/swagger.ts:64` → **yalnız** `NODE_ENV === "production"`

`ecosystem.config.js:76-77` bugün **ikisini de** `"production"` yazıyor, yani sahada
`/api-docs` kapalı. Ama iki farklı konvansiyon aynı soruyu soruyor; yalnız `APP_ENV`
tanımlanmış bir başlatma biçiminde morgan doğru davranır, **Swagger UI ise mount edilir**
ve iç API şeması dışarı açılır.

Swagger spec kaynağı: `routes/**/*.{ts,js}` + `controllers/**/*.{ts,js}` glob'u (`__dirname`
bazlı, Windows için `\` → `/` normalizasyonu var). Spec boş kalırsa `console.warn` basıyor.

### 7.5 Erişim log'u / gecikme metriği kör noktası

`express.json` (#4) **morgan (#5) ve latency (#6) middleware'lerinden ÖNCE** mount edilmiş.
Body parse hatası `next(err)` üretir → Express kalan **normal** middleware'leri atlar ve
doğrudan error handler'a gider. Sonuç:

- Bozuk JSON gövdesi (→ 400) ve 1MB aşımı (→ 413) istekleri **morgan erişim log'una yazılmaz**,
- `latencyMiddleware` çalışmadığı için `res.on("finish")` dinleyicisi hiç kurulmaz →
  bu istekler **gecikme/hata istatistiğinde de görünmez**,
- Hâlbuki error middleware bu iki durum için özel dal taşıyor (#2 ve #3) — yani sistem
  onlara özel muamele ediyor ama hiçbir yerde saymıyor.

`latency.middleware.ts`'in kendi başlık yorumu *"statik/health/swagger dahil tüm istekler
ölçülür"* diyor; bu ifade bu iki sınıf için **doğru değil**.

### 7.6 `/api-docs` üretimde JSON 404 sözleşmesinin dışında

Ölçüldü (Express 5.2.1 sondası): `app.use("/api", handler)` mount'u `/api-docs`'u
**yakalamıyor** (segment sınırı). Üretimde Swagger mount edilmediği için `/api-docs`
Express'in **varsayılan HTML 404**'ünü döner (`<pre>Cannot GET /api-docs</pre>`),
`{success:false, message:...}` JSON'unu değil. `app.ts:448-449`'daki yorum bu davranışı
zaten "Swagger etkilenmez" diye tarif ediyor ama üretimde Swagger yokken sonuç HTML 404.

---

## 8. `server.ts` — süreç seviyesi

Middleware değil ama zincirin dış kabuğu:

| Konu | Bulgu |
|---|---|
| Dinleme | `app.listen(PORT=4000, HOST=0.0.0.0)` — tek `listen`, **tek-process invariant** kodda gerekçeli (satır 37-49) |
| Boot fail-closed | `assertBaseServiceGuards()` — başarısızsa `process.exit(1)` (satır 53-58) |
| Boot işleri | `startArchiveScheduler`, `startBackupScheduler`, `startPermissionCatalogReconciler` + `STARTUP` audit |
| Graceful shutdown | `SIGTERM`/`SIGINT`/pm2 `message:"shutdown"` → latency flush (2sn tavan) → `server.close()` → `prisma.$disconnect()` → `pool.end()` → 5sn zorla çıkış |
| `unhandledRejection` | logla + **ayakta kal** (politika kodda yazılı) |
| `uncaughtException` | audit'i ~2sn bekle → `gracefulShutdown(exitCode=1)` |
| `app.set("trust proxy")` | **YOK** (grep → 0 `app.set`). `req.ip` soket IP'sidir. |

---

## 9. Denetimin bakması gereken noktalar (öncelikli)

Aşağıdakiler **bulgu değil, işaret**tir. Her biri için ölçüm yöntemi de yazılı.

1. **`errorHandler` `res.headersSent` kontrol etmiyor** (`grep headersSent src/` → **0 sonuç**).
   Somut yol: `admin.routes.ts:1225` `res.download(abs, name)` — callback'siz `res.download`,
   aktarım ortasında hata olursa Express hatayı `next(err)`'e verir; o noktada başlıklar
   gönderilmiştir ve `res.status(500).json(...)` `ERR_HTTP_HEADERS_SENT` fırlatır.
   Express dokümanı bu durumda `if (res.headersSent) return next(err)` öneriyor.
   **Ölçüm önerisi:** yedek indirme sırasında bağlantıyı kesip sunucu log'una bak.

2. **Route başına `verifyToken` (fail-open) + mekanik bekçi yok.** §3.1.
   **Ölçüm önerisi:** route stack'ini gezip her katmanın ilk handler'ının `verifyToken`
   olduğunu doğrulayan, muaf listesi gerekçeli bir bekçi yazılabilir mi? Emsal zaten var:
   `test_document_template_permission.ts:90`.

3. **CORS `*` + origin allowlist yok** (§7.2, ölçüldü). Public login uçlarıyla birlikte
   değerlendirilmeli.

4. **Rate limiting yok** (§6) ve mevcut lockout **klasik `/api/auth/login`'i kapsamıyor**.
   **Ölçüm önerisi:** `auth.controller.login` gövdesinde `reserveLoginAttempt` çağrısı
   gerçekten yok mu, doğrula (grep bulgusu: yok).

5. **Bozuk gövde / 413 istekleri hiçbir log ve metriğe düşmüyor** (§7.5).

6. **İstek başına 2-3 DB round-trip auth/device katmanında.**
   `verifyToken`: `user.findUnique` + `session.findUnique` (cache yok, her istekte).
   `resolveDevice`: `device.findUnique` (cache yok, `x-device-id` taşıyan her istekte —
   statik dosya ve `/health` dahil, çünkü #7 statik'ten önce).
   `DeviceService.resolveDevice`'ta yalnız `lastSeenAt` yazımı throttle'lı, **okuma değil**.

7. **`APP_ENV` ↔ `NODE_ENV` ikiliği** (§7.4). Bugün zararsız, yarın Swagger'ı açabilir.

8. **Bilinmeyen Prisma kodu → 400 + audit YOK** (§5.1 son satır). Sunucu kaynaklı bir
   arıza (ör. ham sorgu hatası `P2010`) istemci hatası gibi görünür ve `/health`'in
   hata sayaçlarına hiç düşmez.

9. **`AppError.details` denetimsiz biçimde yanıta konuyor** (`error.middleware.ts:196-201`).
   Servis katmanında `details` içine ne konduğu tek tek doğrulanmalı — sözleşme
   "istemci `code` ile karar versin" ama tip `Record<string, unknown>` ve filtre yok.

10. **`/api/admin/devices` mount sırası** (§2) — bugün doğru çalışıyor, kırılgan.

11. **Middleware SIRASININ kendisi hiçbir testte kilitli değil.**
    `grep -l "helmet\|exposedHeaders\|compression" scripts/` → **0 dosya**.
    `app.ts`'i import eden 9 test var ama hiçbiri sıra/başlık doğrulamıyor.
    Bir refactor helmet'i cors'un arkasına ya da error handler'ı 404'ün önüne alırsa
    hiçbir kırmızı çıkmaz.

---

## 10. Ölçüm dökümü (bu raporun sayıları nereden geldi)

| Sayı | Komut / yöntem |
|---|---|
| 271 TS dosyası / 103.727 satır | `find src -name "*.ts" \| wc -l`, `find src -name "*.ts" -exec cat {} + \| wc -l` |
| 56 `app.use` | `grep -c "^app\.use(" src/app.ts` |
| 46 API mount | `sed -n '390,440p' src/app.ts \| grep -c '^app.use("/api'` |
| 7 middleware dosyası / 1.067 satır | `wc -l src/middlewares/*` |
| 500 route kaydı, 8 auth'suz, 22 statik-izin'siz | `src/routes` ağacını gezen Node script'i (parantez dengeli ifade çıkarımı + dosya içi guard alias çözümü) |
| 432 catch, 0 yutan | Aynı ağaç üzerinde regex + süslü parantez dengeli gövde çıkarımı |
| 140 `.parse(req.body)` | `grep -rno "parse(req.body)" src/ \| wc -l` |
| helmet başlıkları | `helmet@8.1.0` doğrudan çağrılıp sahte `res.setHeader` ile toplandı |
| CORS başlıkları | `cors@2.8.6` doğrudan çağrılıp sahte `req/res` ile toplandı |
| Express 5 async auto-catch | Gerçek `express@5.2.1` sunucusu ayağa kaldırılıp `/boom`, `/boom2` istendi |
| Prefix eşleşme davranışı | Aynı yöntemle `/api/subcontractor(s)`, `/api/admin/devices`, `/api-docs` sondalandı |
| pg-pool mesaj metinleri | `grep node_modules/pg-pool/index.js` → satır 224 ve 276 |
| 154 migration dizini | `ls prisma/migrations \| grep -c "^2"` — görev tanımındaki 155 ile 1 fark var (**ŞÜPHELİ**, sayım kriteri farkı olabilir) |
