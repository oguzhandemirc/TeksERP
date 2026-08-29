# K6 — Hata Yolu Haritası (Teks-Erp backend, aşama ① KEŞİF)

Tarih: 2026-08-28 · Dal `adnansahin` (HEAD ce8681d1) · Yazan: K6 haritalayıcı · **Salt-okunur keşif — yargı/bulgu YOK; yalnız harita + ② denetçileri için HOTSPOT işaretleri.**

Yollar repo köküne göredir (`Teks-Erp/src/...`, kısaltma: `src/...` = `Teks-Erp/src/...`). Satır numaraları 2026-08-28 ağacından alındı. `[VARSAYIM]` = koddan çıkarım, ölçülmedi. DB ölçümleri yalnız `audit/tools/sql-saha.sh` (prod kopyası `tekserp_saha_0825`, 2026-08-25) ve `audit/tools/sql-dev.sh` ile yapıldı.

Bu harita aynı gün yazılmış önceki bir K6 taslağının ÜZERİNE yazıldı; oradaki her iddia yeniden ölçüldü, üç yerde düzeltildi (`catch (` sayısı 649 → **582** — önceki sayı `catch {`'leri de içeriyordu; `withBarcodeRetry` çağrı yeri 28 → **25** gerçek + 3 yorum satırı; adapter/Prisma-client kind→kod eşlemesi bu kez `node_modules` kaynağından doğrulandı).

---

## 0. Ölçüm tabanı (grep, `--include='*.ts'`, `Teks-Erp/src`, 367 dosya)

| Desen | Sayı | Not |
|---|---|---|
| `catch (` | **582** | + `catch {` (bağsız) **49** = 631 catch bloğu. Sınıflandırma (brace-eşleyen tarayıcı `scratchpad/swallow-scan.mjs`): **NEXT 496** (controllers 330 · routes 162 · middlewares 2 · services 2) · **RETHROW 45** · **YUTAN 90** (devam 42 · return-değer 17 · null/[]/false/void 16 · boş 15) |
| `.catch(` | **67** | 66 hata yakalayıcı + 1 Zod varsayılanı (`routes/reports/production.routes.ts:95` `.catch(50)`) |
| `void <ifade>` | 60 (+10 `void _ignored`) | **46 promise fire-and-forget** (§4) · 15 promise-dışı (`void _` ×10 import adaptörleri, `void d` ×3 `document-render/*.fields.ts`, `inventory.service.ts:3173`, `db-copy-verify.service.ts:100`) · 9 yorum satırı |
| `.then(` | 7 | §4 |
| `setTimeout/setImmediate/setInterval` | 22 | §4 |
| `finally` | 13 | §4 |
| `console.error` / `console.warn` | 37 / 31 | §3 |
| `throw new Error(` | 17 | §2.2 |
| `AppError.*` fabrikaları | badRequest 803 · conflict 401 · notFound 303 · unauthorized 31 · forbidden 19 · internal **4** · tooManyRequests 4 | `new AppError(` 19 (7'si `utils/app-error.ts` içi; 12 dış: `reason-preset.service.ts` ×8, `traveler-card.service.ts:1016`, `tambur-manual.service.ts:568/807/1447` yeniden-sarma) |
| `withBarcodeRetry(` | **25** çağrı yeri | + 3 yorum (`batch.service.ts:16/103/213`) |
| `$transaction(` | 128 | 118 `async` · 2 batch `[` · 3 `(tx) =>`/çok-satır (`traveler-card.service.ts:213`, `shipping.service.ts:1905`, `reason-preset.service.ts:505`, `master-data-merge.service.ts:543`) · 3 yorum |
| Handler imzası (routes+controllers+app.ts) | **475** | **try'sız 8** (§1.2) |
| `express-async-errors` / `asyncHandler` / `catchAsync` | **0** | Express 5 yerli yol (§1.2) |
| Sürümler | Express **5.2.1** · router **2.2.0** · body-parser **2.2.2** · Prisma **7.7** + `@prisma/adapter-pg` | `node_modules/*/package.json` |

---

## 1. HATA YOLU HARİTASI (akış, metinle)

### 1.1 HTTP isteğinin katman zinciri (`src/app.ts`)

```
istek
 ├─ helmet (app.ts:102-109; CSP upgradeInsecureRequests=null, HSTS kapalı)
 ├─ cors exposedHeaders (app.ts:114) — liste: X-Label-* ×5 + Date  ⚠️ "Retry-After" LİSTEDE YOK
 ├─ compression (117) → morgan combined/dev (121) → latencyMiddleware (128; res 'finish'→status, 'close'→499 abort)
 ├─ express.json({limit:"1mb"}) (141)  ── bozuk JSON → SyntaxError{status:400,type:'entity.parse.failed'}
 │                                        1MB aşımı → HttpError{status:413,type:'entity.too.large'}
 │                                        (ikisi de next(err) ile hata zincirine çıkar; morgan+latency ARTIK görür — F-CORE-OPS-003)
 ├─ swagger (146) · express.static(public) (158; fallthrough varsayılan → 404'te next())
 ├─ resolveDevice (169; x-device-id → req.device; DB hatasında fail-open/503, bkz. §3.C)
 ├─ runWithRequestContext / AsyncLocalStorage (175; lib/request-context.ts:39-41 — requestId burada doğar)
 ├─ GET /health (479-495: `SELECT 1`, HER ZAMAN 200, db:"UP"|"DOWN")
 ├─ /api/* router'ları (500-587) → route handler → controller → service → Prisma/pg
 ├─ GET /api/admin/health (562-569: verifyToken + admin:settings → buildRichHealth 338-466; try'sız → Express 5 yolu)
 ├─ /api catch-all 404 JSON (598-603; mesaj req.originalUrl'i yansıtır)
 └─ errorHandler (608 — SON middleware; 4-arity)   ← her next(err) ve her reddedilen handler promise'i
```

Hata zincirine giren istek SONRAKİ normal middleware'leri atlar: `express.json` hataları (400/413) `resolveDevice`/`runWithRequestContext`'e uğramaz → o isteklerde `req.device` ve ALS bağlamı yoktur; errorHandler'ın audit'i `currentOrigin()` üzerinden `requestId: null` yazar (`lib/request-context.ts:55-59`). Bilinçli sıra: `app.ts:131-140` yorumu.

### 1.2 Express 5 doğrulaması — async handler hatası errorHandler'a DÜŞÜYOR

| Kanıt | Yer |
|---|---|
| Router, handler dönüşü Promise ise `ret.then(null, error => next(error \|\| new Error('Rejected promise')))` bağlar | `node_modules/router/lib/layer.js:142-166` (`handleRequest`: 155 `isPromise(ret)`, 160 `ret.then(null, …)`) ve `:106-136` (`handleError`: 119/124) |
| Senkron `throw` (await'ten önce) async fonksiyonda reddedilmiş promise'tir → aynı yol; senkron olmayan handler'da `try { fn() } catch (err) { next(err) }` (`layer.js:151-166`) | aynı dosya |
| `express-async-errors` / `asyncHandler` / `catchAsync` / `wrapAsync` | **0** kullanım — gerekmiyor |
| **Try'sız handler (yerli Express 5 yoluna dayananlar): 8/475** | `src/routes/mobile-update.routes.ts:44` (`await dosyaBilgi(...)` → `mobile-update.service.ts:90-93` `AppError.notFound` fırlar → promise reddi → router → errorHandler → 404 JSON) · `:69` (`res.sendFile`) · `:97` (`await depoDurumu()`) · `src/app.ts:479` (`/health`, içeride try var) · `:566` (`/api/admin/health`) · `src/controllers/auth.controller.ts:86/189/268` (Zod parse IIFE içinde `next(error)`; asıl iş 134'ten itibaren try'da — "parse try dışında" deseni) |
| Geleneksel sarmalayıcı (çoğunluk) | `src/controllers/base.controller.ts:67-74` vb. — her handler elle `try { … } catch (error) { next(error); }`; **BaseController'da genel sarmalayıcı YOK** |
| Controller disiplini | `src/controllers`: `catch (` **330** ↔ `next(err\|error\|e)` **330**; catch içinde `res.status/res.json` yazan **0** |
| Route disiplini | `src/routes`: `catch (` **162** ↔ `next(...)` **162**; catch içinde yanıt yazan **0** |
| Servise `res` sızması | yalnız `src/services/helpers/guarded-hard-remove.ts:47-91` (handler fabrikası): 404/409 ön-guard yanıtları (58, 65-70), `res.status(200).json` (87) tx'ten (74-76) ve audit'ten (78-85) **SONRA** |
| Bağsız metod tuzağı (`this` kaybı → TypeError → 500) | **prod'da yaşandı** (§1.7: 15 satır). Bekçi: `scripts/test_controller_binds.ts` (başlık: "route'a çıplak geçilen handler bind'lı olmalı") |

Sonuç: Express 5'te **iki yol da** errorHandler'a ulaşır — (a) `next(error)` (492 yer), (b) çıplak reddedilen promise (8 try'sız handler; router 2.2.0 yakalar). Uygulamada sarmalayıcı yok, disiplin elle tekrarlanıyor (492 kopya) — kopyalardan biri `next` yerine `console.error` yazsa hata sessizce yutulur; bugün ölçüm 0.

### 1.3 errorHandler karar ağacı — `src/middlewares/error.middleware.ts:243-634` (SIRA LOAD-BEARING)

| # | Satır | Koşul | HTTP | Gövde / mesaj (hepsi Türkçe) | Audit `SYSTEM/ERROR` | console | Sayaç |
|---|---|---|---|---|---|---|---|
| 0 | 259-267 | `res.headersSent` | — | yanıta dokunmaz; `_next(err)` → finalhandler soketi keser | YOK (bilinçli, F-CORE-OPS-005: sahte ERR_HTTP_HEADERS_SENT audit'i doğmasın) | error (asıl hata + yol) | — |
| 1 | 270-277 | `err instanceof AppError` | `err.statusCode` (4xx **ve 500**) | `{success:false, message, details?}` — `details` olduğu gibi istemciye gider | **YOK** — `AppError.internal` (500, `isOperational=false`) da buradan iz bırakmadan döner | YOK | — |
| 2 | 280-286 | `SyntaxError` + `status===400` (body-parser: `json.js:66-74` `createStrictSyntaxError/normalizeJsonSyntaxError`; http-errors `index.js:58,94-95` Error örneğine `status` yazar, sınıf SyntaxError kalır) | 400 | "Geçersiz JSON formatı…" | YOK | YOK | — |
| 3 | 290-296 | `err.type === "entity.too.large"` | 413 | "İstek gövdesi çok büyük (1MB…)" | YOK | YOK | — |
| 4 | 315-345 | `classifyPoolTimeout(err)` (`lib/pool-health.ts:66-72`: çıplak `Error`, `code` yok, mesaj TAM eşleşme 44-45) | **503** + `Retry-After: 3` (238-241) | `SERVER_BUSY_MESSAGE` (123) | recordId `POOL_TIMEOUT` (133) + havuz sayaçları + stack 8 satır | error | `recordPoolTimeout` → `/api/admin/health.poolAcquireTimeouts` |
| 5 | 355-381 | `extractCheckConstraint(err)` (SQLSTATE 23514; ORM yolunda çıplak `DriverAdapterError.cause.code`, ham yolda `P2010.meta.driverAdapterError.cause`) | **409** | constraint → Türkçe (218-226) ya da "Veri bütünlüğü kuralı engelledi (ad)"; `cause.detail` (satır değerleri) yanıta ve audit'e **ALINMAZ** (373-376) | recordId `CHECK_VIOLATION` (136) | error | — |
| 6 | 385 | `PrismaClientKnownRequestError` (instanceof ∨ `constructor.name`) | ↓ | ↓ | ↓ | ↓ | ↓ |
| 6a | 388-408 | P2002 | 409 | kolon `extractUniqueColumn` (89-117); `nameFold/nameFoldColor` → "Bu ad zaten kayıtlı…"; harita dışı → "Bu 'kolon' değeri zaten mevcut (unique constraint)" (İngilizce kırıntı) | YOK | warn (kolon çıkarılamazsa) | — |
| 6b | 410-416 | P2025 | 404 | "Kayıt bulunamadı." | YOK | YOK | — |
| 6c | 427-442 | P2003 | 400 | "Geçersiz referans: 'alan'…" (`extractFkColumn` 24-56) | YOK | warn | — |
| 6d/6e/6f | 447-473 | P2007 / P2023 / P2020 | 400 | biçim/UUID/aralık mesajları | YOK | YOK | — |
| 6g | 484-503 | `SERVER_FAULT_PRISMA_CODES` = {P2021, P2022, **P2010**, P2015, P2017, P2018} (150-157) | **500** | "Sunucu yapılandırma hatası…" | recordId = Prisma kodu | error (meta) | — |
| 6h | 506-512 | P2014 | 400 | "İlişki kuralı ihlali…" | YOK | YOK | — |
| 6i | 517-523 | P2034 | **409** | "İşlem … çakıştı. Lütfen tekrar deneyin." | YOK | YOK | — |
| 6j | 533-545 | P2024 ∨ P2028 | **503** + Retry-After | `SERVER_BUSY_MESSAGE`; P2024 bu kurulumda ÖLÜ (yorum 528-532: adapter'da Rust havuzu yok) | recordId = kod | error | — |
| 6k | 548-555 | `CLIENT_DATA_PRISMA_CODES` = {P2000, P2005, P2006, P2011, P2012, P2013, P2019, P2020, P2033} (160-170) | 400 | "İstek işlenemedi…" | YOK | error (meta) | — |
| 6l | 563-585 | **Tanınmayan** Prisma kodu | **500** (fail-loud) | "Sunucu hatası oluştu." | recordId = kod, `unclassified:true` | error | — |
| 7 | 589-595 | `PrismaClientValidationError` | 400 | "Geçersiz veri yapısı…" | **YOK** | YOK | — |
| 8 | 598-609 | `ZodError` | 400 | "Validasyon hatası" + `errors[{field,message}]` (tr locale `src/lib/zod-locale.ts`) | YOK | YOK | — |
| 9 | 614-633 | **Kalan her şey** (TypeError, düz `Error`, 23514-dışı `DriverAdapterError`, http-errors 415/403/404, `URIError`, `PrismaClientUnknownRequestError/InitializationError`…) | **500** | "Sunucu hatası oluştu." | recordId = `err.name` (`TypeError`/`Error`/`DriverAdapterError`…), message + stack 8 satır + method/path | error ("Unhandled Exception:") | — |

Harita düzeyi gözlemler:
- **Prod'da stack/SQL yanıta sızmıyor:** hiçbir dal yanıta `stack`/`meta`/`cause.detail` koymaz; 5xx mesajları sabit metin. Teknik ad yalnız kolon/FK/constraint **adı** düzeyinde sızar (6a/6c/5) — bilinçli (yorum 214-216). Ham hata metni yalnız: SystemLog (`admin:settings` ekranı), `/api/admin/health.lastAuditError/lastPoolTimeoutError` (`app.ts:449`, `pool-health.ts:116` — guard'lı), ve **200 gövdesindeki uyarı alanları** (§6, H-17).
- `AppError.isOperational` errorHandler'da **okunmuyor**; yalnız `tambur-manual.service.ts:568/807/1447` yeniden sararken kopyalıyor → ölü alan. 4xx/5xx ayrımını yalnız `statusCode` yapıyor.
- `err.status`/`err.statusCode` yalnız SyntaxError için okunuyor (280). Bu yüzden **statü taşıyan ama AppError olmayan** hatalar dal 9'a düşer: body-parser 415 `charset.unsupported`/`encoding.unsupported` (`node_modules/body-parser/lib/read.js:73-75,105-107,191-193,226-228`), router param decode hatası (`node_modules/router/lib/layer.js:219-229` → `err.status = 400`, "Failed to decode param"), `res.sendFile` hataları (`express/lib/response.js:411-417` callback → `next(err)`; `mobile-update.routes.ts:82`), `express.static` ≥500 ya da `forwardError` hataları (`serve-static/index.js:115-116`). Hepsi → **500 + sahte SYSTEM/ERROR audit satırı** [VARSAYIM: statü nesnelerinin dal 9'a düşmesi kaynak okumasıyla; canlıda tetiklenmedi].
- `PrismaClientKnownRequestError` dışındaki Prisma sınıfları (Unknown/Initialization/RustPanic) dal 9'a düşer → 500 + audit (doğru sınıf).

### 1.4 Prisma 7 + `@prisma/adapter-pg`: hangi DB hatası hangi sınıfa çevriliyor

`node_modules/@prisma/adapter-pg/dist/index.js:436-563` (`convertDriverError` 436-453 → `mapDriverError` 454-549; `isDriverError` 551: `code`+`message`+`severity` string ister) + `@prisma/client/runtime/client.js` (`"UniqueConstraintViolation":return"P2002"`, `"TransactionWriteConflict":return"P2034"` — grep ile doğrulandı):

| SQLSTATE | Adapter `kind` (satır) | Prisma kodu | errorHandler dalı |
|---|---|---|---|
| 23505 | UniqueConstraintViolation (472) | P2002 | 6a → 409 |
| 23503 | ForeignKeyConstraintViolation (486) | P2003 | 6c → 400 |
| 23502 | NullConstraintViolation (479) | P2011 | 6k → 400 |
| 22001 / 22003 / 22P02 | LengthMismatch / ValueOutOfRange / InvalidInputValue (456-470) | P2000 / P2020 / P2007-sınıfı [VARSAYIM: client haritası bu üçü için okunmadı] | 6k / 6f / 6d → 400 |
| **40001** serialization_failure | TransactionWriteConflict (513) | **P2034** | 6i → 409 |
| **40P01** deadlock_detected | **haritada YOK → `default` (541-549) `kind:"postgres"` + `code/severity/message/detail`** | ORM yolu: çıplak `DriverAdapterError` (aynı default dal 23514 için `test_check_violation_mapping.ts` ile ÖLÇÜLMÜŞ) · ham yolu: P2010 | **dal 9 → 500 "Sunucu hatası oluştu."** ya da 6g → 500 "yapılandırma hatası" |
| **57014** statement_timeout (DB'de 50 s; dev `pg_db_role_setting`: `adnansahin_db {statement_timeout=50s, idle_in_transaction_session_timeout=5min}`) | haritada YOK → default | aynı | **500 generic**, 503 DEĞİL, Retry-After YOK |
| 25P03 idle_in_transaction_session_timeout | haritada YOK → default | aynı | aynı |
| 23514 CHECK | default (cause.code taşır) | ORM: çıplak DriverAdapterError · ham: P2010 | dal 5 → 409 |
| 53300 too_many_connections | TooManyConnections (535) | [VARSAYIM] P1xxx sınıfı → tanınmıyor | dal 9/6l → 500 |
| 42P01 / 42703 | TableDoesNotExist / ColumnNotFound (518-530) | P2021 / P2022 | 6g → 500 + audit |
| ECONNREFUSED/ENOTFOUND/ECONNRESET/ETIMEDOUT (socket) | mapSocketError (553-568) | P1001/P1017 sınıfı [VARSAYIM] → tanınmıyor | 6l → 500 + audit (`unclassified:true`) |
| pg-pool acquire/handshake zaman aşımı | `isDriverError` GEÇEMEZ (`severity` yok) → `throw error` (452) → ham `Error` | — | dal 4 → 503 |

Not: P2028 (interaktif tx zaman aşımı; `lib/prisma.ts:87-93` `maxWait 5000 / timeout 20000`) JS tx yöneticisinden üretilir → 6j → 503 [VARSAYIM: adapter kurulumunda ölçülmedi; `test_pool_health.ts` yalnız acquire/handshake'i ölçüyor, P2028/P2034 orada yalnız metin olarak geçiyor].

### 1.5 Süreç düzeyi (`src/server.ts`, `src/lib/prisma.ts`, `Teks-Erp/ecosystem.config.js`)

| Mekanizma | Yer | Davranış |
|---|---|---|
| Boot fail-closed | `server.ts:38-43` | `assertBaseServiceGuards()` düşerse `console.error` + `process.exit(1)` |
| `DATABASE_URL` / `JWT_SECRET` yokluğu | `lib/prisma.ts:18-20`, `auth.service.ts:38` | modül yüklenirken `throw` → süreç hiç başlamaz |
| `pool.on("error")` | `lib/prisma.ts:79-81` | idle client hatası loglanır, süreç DÜŞMEZ |
| `app.listen` hatası (EADDRINUSE) | `server.ts:79` — `server.on("error")` **YOK** | `'error'` olayı dinleyicisiz → uncaughtException → audit (2 s tavan) → `gracefulShutdown(…,1)` → pm2 `restart_delay 4000`, `max_restarts 10` (`ecosystem.config.js:60-62`) [VARSAYIM] |
| `unhandledRejection` | `server.ts:202-212` | console.error + `void AuditService.logEvent(UNHANDLED_REJECTION)` — **süreç AYAKTA KALIR** (politika: 198-199) |
| `uncaughtException` | `server.ts:213-228` | console.error + audit `.catch(()=>{})` → `Promise.race([audit, 2000 ms unref])` → `.finally(() => gracefulShutdown("uncaughtException", 1))` |
| Graceful shutdown | `server.ts:144-181` | `shuttingDown` tek-atış (146-147; ikinci çağrının `exitCode`'u yok sayılır) · `forceTimer` **5000 ms → exit(1)**, unref (149-153) · `Promise.race([allSettled([flushLatencyNow().catch, stopMdnsAdvertiser()]), 2000 ms unref])` (161-164) → `.finally` → `server.close(cb)` (165) → cb: `prisma.$disconnect()` → `pool.end()` (try/catch 171-175, hata yalnız console) → `process.exit(exitCode)` (177) |
| Sinyaller | `server.ts:182-191` | SIGTERM/SIGINT + **pm2 IPC `"shutdown"`** (`process.on("message")`; Windows'ta tek kapı — `ecosystem.config.js:56` `shutdown_with_message: true`, `:58` `kill_timeout: 8000` > 5 s force) |
| Bellek | `ecosystem.config.js:64` | `max_memory_restart: "1G"`; `instances: 1`, `exec_mode: "fork"` (47-48) |

Kapanışta flush edilen tek bellek-içi kuyruk: latency delta'ları (`latency-persist.service.ts:113-184`; 2 s tavan aşılırsa 5 dk'lık pencere kaybedilir — kabul, yorum `server.ts:154-155`). Audit anlık yazılır (kuyruk yok); presence/feature-flag cache türetilebilir.

### 1.6 Best-effort katmanı (yutan ama SAYAN)

| Bileşen | Yer | Yutma | Görünürlük |
|---|---|---|---|
| `AuditService.log / logMany / logEvent` | `services/audit.service.ts:62-116 / 124-157 / 168-197` | catch → `recordAuditFailure` (39-43) + console.error; **fırlatmaz** | `getHealth()` (50-56) → `/api/admin/health.auditWriteFailures/lastAuditError/lastAuditFailureAt` (`app.ts:448-450`). Süreç-içi sayaç (yorum 25-26) |
| `archiveOlderThan` | `audit.service.ts:204-265` | fırlatır → `archive-scheduler.ts:91-93` yakalar | `reportJobFailure` |
| `reportJobFailure(job, err)` | `jobs/job-failure.ts:34-54` | console.error + `classifyPoolTimeout` → `recordPoolTimeout` + `void AuditService.logEvent(recordId "JOB_FAILED:<job>")` | SystemLog + `/api/admin/health` |
| Havuz sayaçları | `lib/pool-health.ts:75-107, 129-141` | `connect`/`acquire` olayları; `recordPoolTimeout`; okumada sıfırlanmaz | `/api/admin/health` (`app.ts:439`) |
| Latency persist | `services/latency-persist.service.ts:113-184` | satır bazlı try (123-163) → `flushFailures/lastFlushError`; retention try (169-179); `finally inFlush=false`; throttle → `setImmediate(() => void flushLatencyNow())` (104) | `getLatencyPersistHealth` (187-194) → `/api/admin/perf` |
| Zamanlayıcı watchdog'ları | `archive-scheduler.ts:55-64`, `backup-scheduler.ts:66-76` | 3 saat sonra bayrak zorla bırakılır | console.error |
| pg araç child-process | `helpers/pg-tool.helper.ts:98-115` | `spawn(..., {timeout, killSignal:"SIGKILL"})`; stderr/stdout 64 KB tavan | çağıranın sonucu |
| Yazıcı TCP | `helpers/device-transport.ts:33-60, 69-84` | `socket.once("error")` + `once("timeout")` + `settled` tek-atış → reddedilen Promise; dinleyicisiz soket YOK | `printer-transport.ts:79-99` catch → `{delivered:false, error}` (**HTTP 200** içinde) |
| DB kopyası / yedek işleri | `backup.service.ts:178-197` (`finish` → `BACKUP_COMPLETED/BACKUP_FAILED` audit, `lastResult`), `db-copy.service.ts:571-574` (`finishJob(false, …)`) | iş kendi içinde kapanır, fırlatmaz | audit + `lastResult`/kopya kaydı |

### 1.7 Prod/dev defter ölçümü (SYSTEM olayları, salt-okunur)

**Prod kopyası** (`tekserp_saha_0825`, `system_logs` 10.485 satır, aralık 2026-07-16 12:50 → 2026-08-25 13:54; `category='SYSTEM'`): STARTUP 59 · **ERROR 15** · BACKUP_TRIGGER 9 · BACKUP_COMPLETED 8 · PERMISSION_CATALOG_RECONCILED 6 · ROLE_TEMPLATE_CATALOG_RECONCILED 3 · BACKUP_RESTORE_PREVIEW 1 · BACKUP_DOWNLOAD 1. `system_log_archives`'ta SYSTEM satırı **0**.
- 15 ERROR'un **hepsi** `recordId='TypeError'`, `POST /api/traveler-cards/:id/print-event`, 2026-08-05 11:09 → 2026-08-06 18:37, mesaj `Cannot read properties of undefined (reading 'service')` → bağsız controller metodu (dal 9). Kapanış: bind + `scripts/test_controller_binds.ts`. **Prod'da dal 9'un tek gerçek örneği; harita çalıştı** (audit yazıldı, stack'ten teşhis).
- Prod'da `POOL_TIMEOUT`, `CHECK_VIOLATION`, `UNHANDLED_REJECTION`, `UNCAUGHT_EXCEPTION`, `JOB_FAILED:*`, `BACKUP_FAILED`, `PERMISSION_CATALOG_RECONCILE_FAILED` satırı **0**. 2026-07-23/28 havuz zaman aşımı olayları (`recordId='Error'`, `pool-health.ts:14-17`) aktif tabloda **0**, arşivde **0** — tablo 2026-07-16'dan başladığı hâlde yok (→ §SINIR ÖTESİ C/J).

**Dev** (`adnansahin_db`): ERROR 6 = `Error` 4 (2026-08-26 20:42, `POST /api/tambur/:id/finalize-open-fabric`, "Geçersiz sebep kodu: OLCUM_CIHAZI_ARIZALIYDI…" — düz `Error` dal 9 → 500; aynı gün `AppError 400 + REASON_CODE_INVALID`'e çevrildi, 2026-08-26 notu) · `POOL_TIMEOUT` 1 (2026-08-05, `POST /api/auth/login`) · `TypeError` 1 (2026-08-06). Ayrıca `PERMISSION_CATALOG_RECONCILE_FAILED` 6, `BACKUP_FAILED` 1 → bu audit yolları fiilen yazıyor.

---

## 2. HATA ÜRETİCİLERİ (kaynaklar)

### 2.1 `AppError` (`src/utils/app-error.ts:5-63`)
`statusCode` + `isOperational` + `details` (istemci `details.code` ile dallanır). `internal()` = 500 + `isOperational=false` (60-62) → dal 1'den **audit/console'suz** döner. 4 kullanım: `workorder.service.ts:596` (İE no 10 denemede üretilemedi), `auth.service.ts:200` (rastgele PIN 10 denemede benzersiz olmadı), `printed-document.service.ts:178` (builder kayıtlı değil — yapılandırma hatası), `:323` (belge dondurulamadı). `conflict()` 409'un en büyük tüketicisi: atomik claim `count===0`, P2002 çevirileri, `withBarcodeRetry` tükenmesi.

### 2.2 `throw new Error(` — 17 yer; çağıranı yoksa dal 9 (500 generic + audit)
- **Kontrol akışı sinyali** (dışarıda yakalanır, istemciye ulaşmaz): `inventory.service.ts:4776` `KURSUN_FINISH_RACE_LOST` → `:4806-4815` `raceLost` → idempotent 200; `tambur.service.ts:969` `TAMBUR_RACE_LOST` → `:1285-1291` `.catch(e => raceLost ? null : throw)` → `buildIdempotentResponse()`.
- Boot/yapılandırma: `lib/prisma.ts:19`, `auth.service.ts:38`, `base.service.ts:199/374/968`, `jobs/mdns-advertiser.job.ts:125` (kendi catch'i 127-135'te `setState({active:false, reason:"module-missing"})`).
- İş yolu (dal 9'a düşer): `db-copy.service.ts:554` (`finishJob` yakalar 571), `import/import.service.ts:164`, `import/config-bundle.service.ts:393/402` (satır işleyici catch'i `row.errors`'a çevirir 302-306), `import/adapters/order.adapter.ts:317`, `helpers/raster/raster-bitmap.ts:24`, `raster-font.ts:39`, `raster-icon.ts:25` (ikon: `raster-canvas.ts:103` bağsız catch yutar), `utils/cursor.ts:231`.

### 2.3 Prisma kodlarını SERVİSTE yakalayıp çevirenler (errorHandler'a ulaşmadan)
- **P2002 → anlamlı 409 / idempotent dönüş** (21 dosya): `auth.service.ts:171-176` (manuel PIN) + `:187-199` (rastgele PIN, 10 tur `continue`), `work-session.service.ts:58-60, 313-319` (`SESSION_RACE`), `document-profile.service.ts:95-97, 118-121`, `label-template.service.ts:62-71` `rethrowDefaultConflict` (349/452/511/1008) + `:682-686, 811-816, 858-863`, `traveler-template.service.ts:322-327` `rethrowNameConflict` (129/174), `printed-document.service.ts:413-425` (kazananı okuyup döner), `traveler-card.service.ts:212-227` (tx **BİR** kez yeniden koşulur → `{created:false}` 200; ikinci yarış → ham P2002 → dal 6a "Bu 'workOrderId' değeri zaten mevcut"), `kursun-qc.service.ts:648-660` (`clientErrorId` dedup), `user-preference.service.ts:45-55` (P2002∨P2003 → düz update), `installation-identity.job.ts:121-133` (yarışı kaybeden diğerinin kaydını okur), `subcontractor.service.ts:2348` (makbuz replay — iptal edilmişse geçersiz).
- **P2025 → 404/409**: `free-document.service.ts:115`, `document-profile.service.ts:120`, `tambur.service.ts:2249-2257` ve `:2942` (claim'li `update` WHERE eşleşmezse → 409 "Top bu sırada değişti…").
- **P2003 → 409**: `base.service.ts:1269-1278` (hard delete, bağımlı kayıt).
- **clientToken replay** (idempotency): `inventory.service.ts:4218-4262` (herhangi P2002 + token → `findUnique({clientToken})`; payload-özdeşlik `sameItem/sameColor/sameQty` → 200 "idempotent retry" · farklı → 409 `CLIENT_TOKEN_COLLISION` · kayıt yoksa orijinal hata), `workorder.service.ts:1084-1107, 1140-1195` (`resolveCreateTokenReplay`; arşivli WO → 409; `idempotentReplay:true`), `order.service.ts:1977-1994, 2025-2060`, `shipping.service.ts:274-296` (`readOpenSackReplay`) ve `:1430-1446` (`readCreateShipmentReplay`), `kartela.service.ts:1408-1430` — hepsi `utils/p2002.ts` (`p2002Mentions` 10-24: `meta.target` + `driverAdapterError.cause.constraint` + `originalMessage` birleşik regex; `isClientTokenP2002` 36-38). İptal edilmiş kaydın replay'i: `tambur-manual.service.ts:1049/1405` → 409 `ENTRY_CANCELLED`.

### 2.4 `withBarcodeRetry` — `src/utils/barcode-retry.ts:15-57`
- **Neyi:** verilen `fn`'in tamamı; **kaç kez:** `MAX_ATTEMPTS = 5` (13); **hangi hatada:** yalnız `PrismaClientKnownRequestError` + `code === "P2002"` (29-32); `isRetryable` predicate `false` derse propagate (33). Denemeler arası 5-30 ms jitter (48-51); son denemeden sonra bekleme yok. Tükenince `AppError.conflict("Barkod üretimi 5 denemede başarısız oldu…")` (54-56) → 409, **audit/console YOK** (dal 1).
- **25 çağrı yeri.** Predicate'li **4**: `workorder.service.ts:988→1084-1094` (clientToken → `false`; manuel `workOrderNumber` P2002 → doğrudan 409), `order.service.ts:1942→1977-1981` (`!isClientTokenP2002`), `shipping.service.ts:250→274-287` (clientToken `false`; manuel `sackNo` → 409), `shipping.service.ts:1401→1435-1439`. Kalan 21'de predicate yok → **her P2002 5 kez yeniden koşar** (grep `undefined, (err)` yalnız bu 4'te) [VARSAYIM: elle grep, AST değil].
- Closure'ı `async () => {…}` olup **tx DIŞINDA iş yapan** (retry'da tekrar koşan) sarmalar: `customer.service.ts:290-302` (`nextCustomerCode` + `applyStringFields/applyCardFields/validateTaxNumber/assertTaxNumberAvailable` + `super.create`), `item.service.ts:225-232` (`nextItemCode` tx dışı, sonra tx), `free-document.service.ts:91`, `fabric-property.service.ts:255`, `base.service.ts:1031` (autoCode), `workorder.service.ts:6537` (manifest), `order.service.ts:1942-1950` (manuel no ön-kontrolü `findUnique` tx dışı), `shipping.service.ts:830-831` (yalnız tx sarar — yorum 828-829 "tüm P2002 retry edilebilir"). Diğer 17 doğrudan `() => prisma.$transaction(...)`.

### 2.5 Parçalı sonuç (`failed[]`) üreten catch'ler — parçalılık YAZILI
`subcontractor.service.ts:2243-2251` (yalnız `AppError` toplanır, diğerleri fırlar — yorum 2245-2247), `kursun-bypass.service.ts:1093-1098` ve `:1137-1140` (aynı kural), `workorder-link.service.ts:801-806`, `label.service.ts:2053-2066` (`seeded/failed`; `seeded:false`'ı da `failed`'a taşır), `import/import.service.ts:532-545` (`stoppedAtRowNo`, DURUR), `import/config-bundle.service.ts:302-306`, `workorder.service.ts:1441-1446` (`dispatchWarning` metni yanıtta), `subcontractor.service.ts:3290-3309` (`postWarnings`).

---

## 3. YUTMA NOKTALARI TABLOSU

Sınıf: **A** `.catch(() => undefined|{}|null|"")` · **B** bağsız `catch {}` · **C** `catch (e)` + sentinel dönüş (null/[]/0/false/`success:true`) · **D** yalnız `console.*` · **E** kontrol akışı (çevrilir, yutulmaz). "Bilinçli?" = kaynakta gerekçe yorumu var mı. Tarayıcı çıktısı: 90 yutan `catch` + 66 `.catch` (tam liste `scratchpad/swallow-src.txt`, `catch-undef.mjs`).

### 3.A `.catch(() => undefined)` — audit sonrası ÇİFT KATMAN (27 yer, ölü koruma)
`catch-undef.mjs`: 27 `.catch(() => undefined)`'ın hemen üstünde `AuditService.log` (25) / `logEvent` (2) var; `AuditService.*` zaten kendi içinde yutar (§1.6). Yerler: `auth.service.ts:161/181/193/225`, `device.service.ts:244/271/286/299/311/346/358`, `peripheral.service.ts:225/275/409/436`, `work-session.service.ts:329/339/365/401/546`, `label-template.service.ts:593/695/982/1013`, `customer-standalone-label.service.ts:101`, `customer-template-route.service.ts:82`, `order.service.ts:528`, `label.service.ts:1013`, `server.ts:223`. Sonuç hipotezi: yok (zararsız); "audit fırlatabilir" yanılgısını taşır. Bilinçli: kısmen ("best-effort" yorumları).

### 3.B Yazma yolunda sessiz `.catch` — çağıran "başarılı" sanabilir mi?

| Yer | Desen | Ne yutuluyor | Sonuç hipotezi | Bilinçli? |
|---|---|---|---|---|
| `middlewares/auth.middleware.ts:35-37` | `void prisma.session.updateMany(...).catch(() => undefined)` (throttle 29-33) | `Session.lastSeenAt` | "son görülme" bayat; sayaç yok | evet (34) |
| `services/device.service.ts:381-391` | `void prisma.device.update / workSession.updateMany ... .catch` | `lastSeenAt`, `lastActivityAt` | tembel IDLE kapatma (`work-session.helper`) eskiliği yanlış okur; iz yok | evet (369, 384-385) |
| `controllers/auth.controller.ts:465-467` | `revokeSession(jti,"LOGOUT").catch(() => undefined)` | oturum iptali | logout 200 ama registry satırı canlı kalabilir (`tokenVersion` bump YOK bu yolda) | evet (464) |
| `permission-management.service.ts:431-433 / 696 / 763` | `revokeAllForUser(...).catch(() => undefined)` | şifre sıfırlama / pasifleştirme / silme sonrası iptal | `tokenVersion` ikinci katman (425-428) → 401 yine gelir; registry bayat | evet (429-430) |
| `permission-management.service.ts:529/532` | `setQuickPin/rotateCardToken(...).catch(() => undefined)` | yeni kullanıcının PIN/kart üretimi | kullanıcı 201/200 ama mobil kimliği YOK; yanıtta bayrak yok | kısmen (521-524) |
| `services/tambur.service.ts:436-438` | `explainTamburScanBlock(...).catch(() => null)` | hata zenginleştirme sorgusu | eski (doğru ama eksik) mesaj | evet (428-430) |
| `services/reason-preset.service.ts:138-146` | arka plan tazeleme `.catch → refreshBlockedUntil` `.finally → backgroundRefresh=null` | katalog yenileme | bayat liste sürer (tasarım: 2026-08-26 notu) | evet |
| `services/subcontractor.service.ts:5771-5776` | `.catch(e => { console.error; return [] })` | `otherOpenLines` önizleme sorgusu | önizleme eksik satırla döner (200); konsolda iz | evet (5772-5773) |
| `services/backup.service.ts:345/350/375-376` | `fs.rm(...).catch(() => {})`, `stat(...).catch(() => null)` | temizlik | `.part` kalıntısı disk yer | evet (343-349) |
| `helpers/pg-admin-client.ts:81`, `db-copy-verify.service.ts:425` | `client.end().catch(() => {})` | bağlantı kapama hatası | sızıntı yok | evet (80) |
| `db-copy-verify.service.ts:405-410` | `_prisma_migrations` sorgusu `.catch(() => ({rows: []}))` | migration listesi | rapor `applied=0`, `missing=hepsi` → görünür | kısmen |
| `helpers/offsite-backup.helper.ts:270-273` | `readOffsiteRemote().catch(() => "")` | ayar okuma (ilk süpürmeden önce) | health `configured:false` (yanlış "ayarlı değil") | hayır |
| `server.ts:162` | `flushLatencyNow().catch(() => {})` | kapanış flush'ı | 5 dk delta kaybı | evet (154-155) |

### 3.C Bağsız `catch {}` (B) — 49 yer, gruplanmış

| Grup | Yerler | Ne yutuluyor → sonuç | Bilinçli? |
|---|---|---|---|
| Sağlık/ölçüm | `app.ts:213-216` (yedek cache null, 30 s), `:411` (rich health `db="DOWN"`), `:484` (`/health`), `lib/disk-metrics.ts:46` (null) | metrik yerine null/DOWN | evet |
| Cursor çözme | `utils/cursor.ts:41/135/287` → `null`/`0` | bozuk cursor = "cursor yok" → **ilk sayfadan başlar** (`system-log.service.ts:130/215` çağırır) [VARSAYIM: sonsuz kaydırmada mükerrer satır] | kısmen (null = geçersiz) |
| Sürüm | `lib/app-version.ts:15-21` → `"1.0.0"` | `package.json` okunamazsa `/health.version`, keşif kimliği, istemci sürüm politikası **1.0.0** okur | evet (19) |
| Kimlik/cihaz | `middlewares/device.middleware.ts:52-74`: `resolveDevice` DB hatası → console.warn; bayrak okunursa ve `pairingRequired` → **503 `DEVICE_CHECK_UNAVAILABLE`**; bayrak da okunamazsa (`catch {}` 62-64) `pairingRequired=false` → `next()` **fail-open** | DB düşükken eşleştirme zorunluluğu atlanır | evet (48-50, 63, 73) |
| JWT | `auth.service.ts:389-391` → `AppError.unauthorized` | doğru çeviri | evet |
| Belge/etiket render | `traveler-card.service.ts:1033/1070` (`qrSvg=null`), `label.service.ts:934`, `label-template.service.ts:1213` (raster zarfı → komut SVG'sine düş), `helpers/raster/raster-barcode.ts:47/75` (null → `raster-canvas.ts:70/75` `if (!bc) break` → **eleman çizilmeden geçilir**), `raster-canvas.ts:103` (bilinmeyen ikon), `label-canvas-native.helper.ts:301/574` (`break`), `raster-font.ts:52` (varsayılan font), `helpers/native-preview.ts:48` | kart/etiket **eksik elemanla** basılabilir (QR/barkod/ikon yok), HTTP 200 | kısmen (ikon için yorum var; barkod/QR için gerekçe yok) |
| Yedek/kopya | `backup.service.ts:114` ("unknown"), `:378` (budama), `:485-487` (**`files:[]`** — klasör okunamazsa panel "yedek yok"), `db-copy.service.ts:247/273/490`, `db-copy-verify.service.ts:311-320` (**`[]` beklenen migration** → `expected:0`), `:340/422/434`, `mobile-update.service.ts:90 (→404)/147` | "veri yok" ile "okunamadı" **aynı görünür** (485, 318) | kısmen (485/318'de yorum yok) |
| Birleştirme önizlemesi | `master-data-merge.service.ts:971/1006/1015-1027` → `null` (yorum 1024-1026 "0 DÖNDÜRME"); **`:1055` → `count = 0`** | çakışma önizlemesi SQL hatasında "0 çakışma" der — kardeş dallarla tutarsız | 1055: **hayır** |
| Audit zenginleştirme / çeşitli | `helpers/audit-value-resolver.ts:116` (fail-open, ham UUID), `helpers/audit-diff.helper.ts:67`, `label.service.ts:2138`, `discovery.service.ts:95`, `offsite-backup.helper.ts:349/373`, `peripheral.service.ts:108` (→400), `mdns-advertiser.job.ts:218/256/260`, `reason-preset.service.ts:229` (bayat liste korunur) | etiket/ad eksik; ilan tazelenmez | evet |

### 3.D `catch (e)` + sentinel dönüş / yalnız console (C, D)

| Yer | Sınıf | Ne yutuluyor | Çağıran "veri yok / başarılı" sanır mı? | Bilinçli? |
|---|---|---|---|---|
| `services/label.service.ts:1976-1982` | C | `getRollLabel` hatası → **`{success:true, data:{seeded:false}}`** + console.error | evet: baskı akışı 200; snapshot yazılmaz; sayaç yok (toplu yolda `2053-2062` `failed`'a taşınıyor — tekil yolda taşınmıyor) | kısmen |
| `services/subcontractor.service.ts:3268-3282` | D | fason kabul sonrası `changeWidth` → console.warn | kabul 200, **en güncellenmedi**, yanıtta uyarı YOK (renk için `postWarnings` 3290-3309 dolduruluyor, en için yok) | kısmen (3264-3267) |
| `services/order.service.ts:712-733` | C+D | müşteri alias terfisi (3 ayrı try) | sipariş 200, alias yazılmadı | evet (713) |
| `services/duplicate-review.service.ts:198-200` | D | MERGED izi | mükerrer kuyruğunda çift bayat kalır | evet |
| `services/db-copy.service.ts:479-481 / 625-628` | D | kopya kayıt JSON'u / GUC replay | panel bayat; doğrulama `fail` yakalar (627) | evet |
| `services/backup-impact.service.ts:364-367 / 401-404 / 453-456` | C+D | sayım → `null`/`empty` | UI "ölçülemedi" vs 0 ayrımı var | evet |
| `services/helpers/label-renderer.registry.ts:110-122` | D | raster hatası → **komut moduna düşer** | istemci farklı `contentType`/dil alır, 200; fark yalnız `X-Label-*` başlıklarında | evet (107-109) |
| `services/helpers/printer-transport.ts:79-99` | C | TCP hatası → `{delivered:false, error}` | **HTTP 200** (`label.service.ts:999-1014`; audit `LABEL_NATIVE_PRINT.error`) — istemci `delivered`'ı okumalı | evet |
| `jobs/reason-preset-catalog.job.ts:85-87` | D | uzlaştırma (yalnız `runReasonPresetReconciliation` sarmalayıcısı; boot zinciri `permission-catalog.job.ts:159-166` doğrudan çağırır → zincir catch'i 167-195 + audit 186) | — | evet |
| `jobs/installation-identity.job.ts:192-209` | D | 3 deneme sonra console.error + `publish(null)`; **audit YOK** (permission-catalog'da var: 186) | keşif kimliksiz | evet (202-206) |
| `jobs/mdns-advertiser.job.ts:127-135 / 183-190` | C | modül/bind hatası → `setState({active:false, reason})` + console.warn | `/api/admin/health.discovery.mdns.reason` görür | evet |
| `services/workorder.service.ts:1362-1384` | D | quickStart telafi `hardDelete` hatası → console.error, asıl hata fırlar | kullanıcı "oluşturulmadı" görür; **yetim PLANNED WO + ACTIVE kart kalır**; audit yok (yorum "audit best-effort sayacı felsefesi" der ama audit çağrısı yok) | evet (1362-1365) |
| `services/backup.service.ts:318-320 / 328-333` | D→warnings | rotasyon / offsite kopya hatası → `warnings[]` (mesajda) | `BACKUP_COMPLETED` yazılır, uyarı metinde | evet |
| `services/import/config-bundle.service.ts:302-306` | C | satır hatası → `row.action="ERROR"`, `failed++` | rapor satırında görünür | evet |
| `services/helpers/offsite-backup.helper.ts:176-179` | C | yerel klasör okunamadı → `warnings` + `done({configured:true})` | `ok:false` → `reportJobFailure` (sweeper 60-65) | evet |

### 3.E Kontrol akışı olarak catch (E — çevrilir, yutulmaz)
`tambur.service.ts:1285-1291` / `inventory.service.ts:4806-4815` (`raceLost` → idempotent 200; diğer hatalar fırlar), `tambur.service.ts:445-453` (`assertAtTamburWithReason` → zenginleştirip yeniden fırlatır), `:3533-3545` (yalnız `AppError` → boş adım kararı; altyapı hatası MASKELENMEZ, yorum 3541-3543), `tambur-manual.service.ts:565-570/805-810/1443-1448` (`details.code` ekleyip yeniden fırlatır), `traveler-card.service.ts:212-227`, `workorder.service.ts:1378-1385`, `latency-persist.service.ts:159-163/176-179` (sayaç), `db-copy.service.ts:418-421` (`currentJob=null` + rethrow), `audit.service.ts:110-115` (sayaç, §1.6).

---

## 4. FIRE-AND-FORGET LİSTESİ

**46 promise `void`** (§0). Reddi kim yakalar?

| Grup | Yerler | Reddi kim yakalar? | Kaçak → `unhandledRejection` |
|---|---|---|---|
| `AuditService.logEvent/log` (25) | `error.middleware.ts:323/363/490/535/568/616`, `server.ts:127/204`, `controllers/auth.controller.ts:140/163/222/241/301/318/469`, `jobs/installation-identity.job.ts:100/113`, `jobs/job-failure.ts:43`, `jobs/permission-catalog.job.ts:186`, `services/backup.service.ts:191`, `services/db-copy.service.ts:455/515/635/721/818` | fonksiyonun kendi catch'i (§1.6) | yok |
| Zamanlayıcı tikleri (6) | `jobs/archive-scheduler.ts:103-104`, `backup-scheduler.ts:143-144`, `offsite-sweeper.ts:99-100` | `runIfDue/sweepOnce` try/catch/finally | yok |
| Açılış işleri (5) | `server.ts:121` `refreshDiscoveryCache` (catch `discovery.service.ts:95`), `:124` `startMdnsAdvertiser` (try/catch 127/183), `:125` `warnIfAuditGuardDisabled` (61-76), `jobs/permission-catalog.job.ts:153` (zincir `.catch` 167 + 3 deneme + audit), `jobs/installation-identity.job.ts:192` (`.catch` + deneme) | kendi catch'leri | yok |
| Kapanış yarışları (3) | `server.ts:161` (allSettled + finally), `:170` (IIFE try/catch), `:224` (audit `.catch`, race finally) | — | yok |
| DB `lastSeen` yazımları (3) | `auth.middleware.ts:35`, `device.service.ts:381/386` | `.catch(() => undefined)` | yok (ama sessiz — §3.B) |
| Arka plan iş, 202 semantiği (2) | `backup.service.ts:408` `void runBackupJob("manual")` (try/catch/finally 343-359), `db-copy.service.ts:437` `void runCopyJob(...)` (aşamalı `finishJob`) | işin kendi catch'i; öncesindeki senkron hata → `unhandledRejection` handler'ı (logla, ayakta kal) | düşük |
| mDNS TXT tazeleme (1) | `mdns-advertiser.job.ts:182` (try/catch 214-220) | — | yok |
| Latency flush (1) | `latency-persist.service.ts:104` `setImmediate(() => void flushLatencyNow())` | gövde satır bazlı try; dış try/finally'de **catch YOK** → `localDay()`/`dayKey()` fırlatırsa `unhandledRejection` (logla, ayakta kal) | düşük |

`setTimeout/setInterval` içinde await'siz async: `permission-catalog.job.ts:175/198` ve `installation-identity.job.ts:199/212` `attempt(n)` senkron sarmalayıcı → içinde `void promise…catch`; `label.service.ts:1136/1194` `await new Promise(setImmediate)` (event-loop yield, hata yolu değil); `backup.service.ts:123` doğrulama zaman aşımı `Promise.race` (unref); `mdns-advertiser.job.ts:251` / `installation-identity.job.ts:178` kapı zamanlayıcıları (unref, `finish` tek-atış).

`.then(` zincirleri (7): `permission-catalog.job.ts:154/159` (zincir sonunda `.catch` 167 → **yakalanıyor**); `system-setting.service.ts:1094-1099` ve `db-copy.service.ts:800-816` — süreç-içi yazma kuyruğu: `queue = task.then(() => undefined, () => undefined)` (hata kuyruğu **kırmaz**, çağırana `task` ile döner/`await task`); `reports/customer-scorecard.report.service.ts:193` `$queryRaw…then(map)` — çağıran `await` ediyor (fonksiyon dönüşü).

---

## 5. COMMIT-ÖNCESİ YANIT ADAYLARI

| Kontrol | Sonuç |
|---|---|
| `$transaction` route/controller katmanında | **0** |
| Servislerde `res.*` kullanımı | 5 satır, hepsi `helpers/guarded-hard-remove.ts:58/65/87` — `res.status(200).json` (87) tx'ten (74-76) ve audit'ten (78-85) **sonra** |
| tx callback gövdesinde `res.*` / `fetch` / `spawn` / `net.connect` / `fs.write*` (parantez-eşleyen tarayıcı `scratchpad/tx-res-scan.mjs`; `$transaction(async`, `$transaction((`, `$transaction([` biçimleri) | **122 tx bloğu, 0 aday** |
| "Yanıt gönder, sonra `await`/`void`" (controllers/routes/helpers, `scratchpad/after-res.mjs`) | **0 aday** — audit fire-and-forget'ler yanıttan ÖNCE `void` ile başlatılıyor |
| Kasıtlı 202 semantiği | `routes/admin.routes.ts:1190-1200` → `triggerManualBackup()` (`backup.service.ts:395-413`, `void runBackupJob`), `routes/db-copy.routes.ts:77-93` → `startCopyJob` (`db-copy.service.ts:437`); sonuç `lastResult`/`currentJob` uçlarından okunur |
| "200 gövdesinde başarısızlık" sözleşmeleri (istemci alanı okumak ZORUNDA) | `printRollNative` → `delivered:false` + `error` (`label.service.ts:999-1014`; bekçi `test_printer_transport.ts`); `seedRollLabelSnapshot` → `seeded:false` (1981); toplu uçlarda `failed[]` (§2.5); fason kabulde `postWarnings` (`subcontractor.service.ts:3290-3309`); `quickStart` `dispatchWarning` (`workorder.service.ts:1441-1446`); `ApiResponse.warnings` (rota kapsaması, `workorder.service.ts:1120-1123`); `idempotentReplay:true` (`:1099-1107`; bekçi `test_tambur_manual_produce.ts`) |
| `res.headersSent` sonrası hata (akış yanıtı) | `admin.routes.ts:1278` `res.download`, `mobile-update.routes.ts:82` `res.sendFile` — errorHandler dal 0 keser, audit yazmaz (bilinçli) |

Harita düzeyinde: **commit'ten önce yanıt yazan yol bulunamadı.**

---

## 6. 4xx/5xx SINIFLANDIRMA TUTARLILIĞI — CLAUDE.md sözleşmeleri koda yansımış mı?

| Sözleşme (CLAUDE.md / arşiv) | Kodda karşılığı | Gözlem |
|---|---|---|
| "timeout ≠ yazılmadı" (2026-08-12 kuyruk notu; istemci token'ı yalnız belirsiz sonuçta yapıştırır) | İstemci: `mobil/src/offline/entryAttempt.ts:252-255` `isAmbiguousFailure` = `status === undefined \|\| status >= 500`; `mutations.ts:125-131` `stationRetry`: 4xx → dur, diğer → 3 deneme. Backend ikizi: clientToken replay → 200 + `idempotentReplay`/"idempotent retry" (§2.3); 503'te `Retry-After:3` (238-241) | Tutarlı. Ama `Retry-After` CORS `exposedHeaders`'ta **yok** (`app.ts:114`; yorum 231-236 kabul ediyor) → renderer okuyamaz; Electron `App.tsx:22-27` 4xx'te retry yok, diğerinde 1 |
| İptal edilmiş token replay → 409 `ENTRY_CANCELLED` (2026-08-05) | `tambur-manual.service.ts:1049/1405`; fason makbuz `subcontractor.service.ts:2348` | var |
| 409 `POSSIBLE_DUPLICATE` (KK1 tuzağı, tx İÇİNDE throw → Prisma rollback edip hatayı DEĞİŞTİRMEDEN fırlatır — `inventory.service.ts:880-882` yorumu, `session-registry.service.ts:100` emsali) / `CLIENT_TOKEN_COLLISION` | `inventory.service.ts:884-902` / `:4243-4262`, `order.service.ts:2050-2060`, `workorder.service.ts:1184-1194`, `kartela.service.ts:1428` | var; bekçi `test_kk1_duplicate_guard.ts`, `test_client_token_idempotency.ts`, `test_shipping_client_token.ts` |
| `REASON_CODE_INVALID` = **AppError 400 + details.code** (2026-08-26: düz Error 500'e düşüyordu, mobil kuyruk 5xx'i geçici sanıp 3 kez deniyordu) | `inventory.service.ts:3137-3141`, `constants/variance-reasons.ts:259`, `reason-preset.service.ts:281`; dev defterinde 26.08 20:42 tarihli 4 `recordId='Error'` satırı bu hatanın ESKİ hâli (§1.7) | yansımış; bekçi `test_reason_presets §3b/c/d` |
| Havuz zaman aşımı → 503 (2026-07 olayları 500'dü) | dal 4 + `/api/admin/health` sayacı; bekçi `test_pool_health.ts` (gerçek pg-pool hatası üretir, 503 + Retry-After + sayaç) | yansımış. ⚠️ Havuz tükendiğinde `POOL_TIMEOUT` audit'i **aynı havuzu** kullanır (`audit.service.ts:179`) → o an audit de düşebilir (`auditWriteFailures` artar); güvenilir iz bellek sayacı (`recordPoolTimeout`) |
| "İstemci veriyi değiştirerek kurtulabilir mi?" ölçütü (F-CORE-OPS-002, 145-147) | iki küme (150-170) + tanınmayan kod → 500 fail-loud (557-585); bekçi `test_observability_contract.ts` [1] | yansımış; **istisnalar**: `PrismaClientValidationError` → 400 **audit yok** (589-595) — bu sınıf tipik olarak sunucu kodlama hatasıdır (yanlış `select/include/data` şekli); `AppError.internal` 500 → audit/console yok (dal 1); statü taşıyan http-errors (415/400 decode) → 500 (dal 9) — ters yönde yanlış |
| P2034 → 409 "tekrar deneyin" | 517-523 | yalnız SQLSTATE **40001**; **40P01 deadlock** adapter default dalı → dal 9 (500 generic, audit `DriverAdapterError`) [VARSAYIM: yüzeye çıkış sınıfı 23514 ölçümünden çıkarım] |
| DB `statement_timeout=50s` (ARCHITECTURE/CLAUDE.md; dev `pg_db_role_setting` ile doğrulandı) | **57014 hiçbir dalda yok** → ORM yolunda dal 9 → 500 "Sunucu hatası oluştu."; ham yolda P2010 → 6g → 500 "Sunucu **yapılandırma** hatası" (yanıltıcı) | uzun rapor/toplu işlem 50 s'de kesilirse 503/tekrar-dene sinyali yok; mobil `stationRetry` 5xx'i 3 kez dener → 3×50 s |
| 23514 CHECK → 409 + audit, satır değeri sızmaz | 355-381; bekçi `test_check_violation_mapping.ts` (ORM + ham yol, `detail` sızmıyor) | yansımış |
| Türkçe mesaj kuralı | tüm dallarda Türkçe; P2002 harita dışı kolonda "(unique constraint)" kırıntısı; P2003'te ham FK alanı; `traveler-card.service.ts:212-227` ikinci yarış → "Bu 'workOrderId' değeri zaten mevcut" | teknik ad sızıntısı bilinçli |
| Audit best-effort + tx dışında | §1.6 + §5 tarayıcı (0 tx-içi `res`/dış-dünya; audit `AuditService.*` tx callback'lerinde aranmadı — K3'ün alanı) | yansımış |
| `withBarcodeRetry` P2002 → 5 deneme → 409 | §2.4 | tükenme 409'u **audit'siz**; sistematik sıra hatası kullanıcıya 409, sunucuda iz yok |
| 401 çeşitleri (`SESSION_INVALID`/`SESSION_REVOKED`+reason) | `auth.middleware.ts:79-101` (throw → catch 107 → `next(error)`) | istemci sebebi ayırt eder |
| 429 login lockout | `auth.controller.ts:120-127` `AppError.tooManyRequests({code:"LOGIN_LOCKED", retryAfterSec})`; catch'te yalnız 401 deneme sayılır (`isCredentialError` 155-160, `releaseLoginAttempt`) | tutarlı |
| Gövdesiz istek (`req.body === undefined`, Express 5) | `.parse(req.body)` 189, `req.body ??` 31; doğrudan `req.body.x` destructure **0** | TypeError sınıfı kapalı (Zod 400) |

---

## 7. BEKÇİ KAPSAMI (hata yolunu kim ölçüyor)

| Bekçi | Ölçtüğü | Kör nokta (harita düzeyi) |
|---|---|---|
| `scripts/test_pool_health.ts` | gerçek pg-pool hatası → `classifyPoolTimeout`; 503 + Retry-After + sayaç; AppError/düz Error SAYILMAZ | P2028 dalı, 57014, 40P01 |
| `scripts/test_check_violation_mapping.ts` | 23514 ORM + ham yol; `detail` sızmaz; hata ŞEKLİ gerçek PG'den | diğer SQLSTATE'lerin varış dalı |
| `scripts/test_observability_contract.ts` | [1] Prisma kod kümeleri + tanınmayan → 500, [2] body-parser sırası (400/413 morgan+latency'de), [3] `reportJobFailure` → SystemLog; `PrismaClientValidationError` metin olarak geçiyor | dal 7'nin audit'sizliği ölçülmüyor [VARSAYIM: dosya gövdesi okunmadı] |
| `scripts/test_middleware_order.ts` | zincir sırası, HSTS kapalı, CORS `exposedHeaders` listesi (sözleşme olarak dondurulmuş) | `Retry-After` eksikliği kilitli |
| `scripts/test_http_api.ts` | gerçek sunucu: 401/403/400 Zod/201 eşlemesi | 5xx dalları |
| `scripts/test_controller_binds.ts` | route'a çıplak geçilen handler bind'lı mı (prod TypeError vakası) | arrow-property controller'lar kapsam dışı (gerekmez) |
| `scripts/test_printer_transport.ts` | sahte TCP dinleyiciyle `delivered`/baytlar | — |
| `scripts/test_client_token_idempotency.ts`, `test_shipping_client_token.ts`, `test_tambur_cut_idempotency.ts`, `test_qc2_idempotency.ts`, `test_tambur_manual_produce.ts` (`idempotentReplay`) | replay = cached kayıt, farklı payload = 409, `raceLost` yolu | — |
| `scripts/test_kk1_duplicate_guard.ts`, `test_reason_presets.ts` | `POSSIBLE_DUPLICATE`, `REASON_CODE_INVALID` 400 + bayat önbellek | — |
| `scripts/test_latency_persist.ts`, `test_latency_middleware.ts`, `test_latency_stats.ts` | flush hataları isteği düşürmez; 499; route anahtarı | — |
| `scripts/test_system_log.ts`, `test_observability_cache.ts` | `auditWriteFailures` sayacı | — |
| `scripts/test_p1b_barcode_collision.ts`, `test_race_conditions.ts`, `test_batch_number_format.ts`, `test_k14_lock_edges.ts` (+ `withBarcodeRetry` 9 dosyada geçiyor) | P2002 retry dalı gerçek DB paralel istekle | tükenme (5/5) → 409 dalı; predicate `false` yolu |
| `scripts/test_discovery_advertiser.ts` | `stopMdnsAdvertiser` asılı kalmaz (kapanış kapısı) | — |
| `scripts/test_audit_depth.ts §10` | arşivde `SET LOCAL teks.audit_purge` sırası | — |
| — | `process.on("unhandledRejection"/"uncaughtException")`, `gracefulShutdown` 5 s/2 s bütçeleri, pm2 `shutdown` mesajı, `forceTimer` | **bekçi YOK** (grep: `unhandledRejection` 0 dosya, `UNHANDLED_REJECTION`/`UNCAUGHT_EXCEPTION`/`forceTimer`/`JOB_FAILED` 0 dosya) |
| — | `res.sendFile`/`res.download`/body-parser 415/router decode 400 statülerinin dal 9'a düşmesi | bekçi yok |
| — | `AppError.internal` / `withBarcodeRetry` tükenmesinin audit'sizliği | bekçi yok |

---

## HOTSPOTLAR

② denetçileri için öncelik sırasıyla (yargı değil, "önce buraya bak"). Alan harfleri `audit/01-find/_FINDER-BRIEF.md`'deki A-L.

- **H-1 `Teks-Erp/src/middlewares/error.middleware.ts:614-633` + `node_modules/@prisma/adapter-pg/dist/index.js:541-549`** — SQLSTATE **57014 (statement_timeout 50 s)**, **40P01 (deadlock)**, 25P03, 53300 hiçbir dalda tanınmıyor; ORM yolunda çıplak `DriverAdapterError` → generic 500, ham yolda P2010 → 500 "yapılandırma hatası"; 503/Retry-After/"tekrar dene" sinyali yok (havuz zaman aşımı 503 iken). Mobil `stationRetry` (`mobil/src/offline/mutations.ts:125-131`) 5xx'i 3 kez dener → 50 s'lik sorgu 3 kez koşabilir. Bekçi yok. [yüzeye çıkış sınıfı: 23514 ölçümünden çıkarım, 57014 için ölçülmedi] → **I, F, H**
- **H-2 `error.middleware.ts:270-277` (dal 1) ↔ `utils/app-error.ts:60-62`, `utils/barcode-retry.ts:54-56`** — `AppError.internal` 500'leri (4 yer) ve `withBarcodeRetry` tükenme 409'u **audit/console iz bırakmaz**; sunucu kaynaklı arıza SystemLog'a ve `/api/admin/health`'e düşmez. → **I**
- **H-3 `error.middleware.ts:589-595`** — `PrismaClientValidationError` → 400, audit YOK; bu hata istemci girdisinden çok sunucu kod hatasından doğar (F-CORE-OPS-002 ölçütüne göre 500 + audit olmalı). → **I**
- **H-4 `error.middleware.ts:280-296` ↔ `node_modules/router/lib/layer.js:219-229`, `body-parser/lib/read.js:73-75/191-193/226-228`, `express/lib/response.js:411-417`** — statü taşıyan http-errors (415 charset/encoding, 400 param decode, sendFile 404/403/EISDIR, static ≥500) `err.status` okunmadığı için dal 9 → **500 + sahte SYSTEM/ERROR audit** (`recordId` = `UnsupportedMediaTypeError`/`URIError`/`Error`). Etkilenen uçlar: `routes/mobile-update.routes.ts:82`, `routes/admin.routes.ts:1278`, `app.ts:158`, tüm `/:id` yolları (bozuk `%` dizisi). [VARSAYIM: kaynak okuması, canlıda tetiklenmedi] → **F, I**
- **H-5 `services/label.service.ts:1976-1982`** — `seedRollLabelSnapshot` hata → `{success:true, seeded:false}` (200) + yalnız console.error; tekil baskı yolunda sayaç yok (toplu yol 2053-2062 `failed`'a taşıyor). İstemcinin `seeded`'ı okuduğu doğrulanmalı. → **I, F**
- **H-6 `services/subcontractor.service.ts:3268-3282`** — fason kabul sonrası `changeWidth` hatası console.warn'a düşer; kabul 200, `postWarnings` en için **doldurulmuyor** (renk için 3305-3309 dolduruluyor) → operatör "en güncellendi" sanır. → **I, E**
- **H-7 `services/helpers/raster/raster-barcode.ts:47/75` → `raster-canvas.ts:70/75` (`if (!bc) break`); `traveler-card.service.ts:1033/1070` (`qrSvg=null`)** — barkod/QR üretimi patlarsa eleman **çizilmeden** etiket/kart basılır (200); "barkod topun kimliğidir" kuralı altında barkodsuz kâğıt sahaya çıkabilir; ikon için yorum var, barkod/QR için gerekçe yok. → **I, E**
- **H-8 `services/master-data-merge.service.ts:1041-1057`** — çakışma önizlemesinde SQL hatası `count = 0` (kardeşler 971/1006/1023 `null` döner; yorum 1024-1026 tam bunu yasaklıyor) → merge onay ekranı "0 çakışma" gösterir. → **I, B**
- **H-9 `services/backup.service.ts:485-487` ve `db-copy-verify.service.ts:311-320`** — klasör/migration dizini okunamayınca `files:[]` / `expected:[]` → "yedek yok"/"eksik migration yok" ile "okunamadı" aynı görünür; ikisinde de yorum yok. → **J, I**
- **H-10 `middlewares/device.middleware.ts:52-74`** — DB hatasında bayrak okunursa `pairingRequired` → 503 fail-closed; bayrak da okunamazsa (`catch {}` 62-64) fail-open. Güvenlik kesişimi. → **G**
- **H-11 `services/workorder.service.ts:1362-1385`** — quickStart telafi `hardDelete` düşerse yetim PLANNED WO + ACTIVE refakat kartı kalır; yalnız console.error (yorum audit'ten söz ediyor, çağrı yok). → **I, E**
- **H-12 `services/permission-management.service.ts:518-533`** — yeni kullanıcı 201 döner, PIN/kart üretimi sessizce düşebilir (`.catch(() => undefined)`); yanıtta bayrak yok. → **G, I**
- **H-13 `app.ts:114` ↔ `error.middleware.ts:238-241`** — `Retry-After` gönderiliyor ama CORS `exposedHeaders`'ta yok; `test_middleware_order` listeyi kilitliyor → istemci uyacaksa iki yer + bekçi birlikte değişmeli. → **F**
- **H-14 `server.ts:79`** — `server.on("error")` yok; EADDRINUSE → uncaughtException → exit(1) → pm2 restart döngüsü (`max_restarts 10`); bekçi yok. [VARSAYIM] → **A (tek-process invariant), J**
- **H-15 `services/helpers/label-renderer.registry.ts:110-122`** — raster başarısızlığında komut moduna sessiz düşüş (200, farklı `contentType`); fark istemciye yalnız `X-Label-*` başlıklarıyla gider, audit'e düşmez. → **I**
- **H-16 `lib/app-version.ts:15-21`** — `package.json` okunamazsa `"1.0.0"`; `/health.version`, keşif kimliği ve istemci sürüm politikası bu değeri okur → yanlış cwd'de tüm istemciler "sunucu eski" görebilir. → **J**
- **H-17 Ham `err.message` 200 gövdesine:** `workorder.service.ts:1441-1446` (`dispatchWarning`), `subcontractor.service.ts:3305-3307` (`postWarnings`), `label.service.ts:2062-2064` (`failed[].reason`), `import/import.service.ts:539-541`, `backup.service.ts:318-333` (`warnings`) — Prisma/pg metni (şema/SQL ayrıntısı) operatör ekranına sızabilir. → **G, I**
- **H-18 `error.middleware.ts:315-345` ↔ `audit.service.ts:168-197`** — havuz tükendiğinde `POOL_TIMEOUT` audit'i aynı havuzdan bağlantı ister; olay anında audit de düşebilir (`auditWriteFailures` artar, SystemLog'da satır olmaz). Bellek sayacı (`recordPoolTimeout`) restart'ta sıfırlanır → kalıcı iz tamamen kaybolabilir. → **I**
- **H-19 `jobs/installation-identity.job.ts:192-209`** — 3 deneme sonrası console.error + `publish(null)`, **audit YOK**; `permission-catalog.job.ts:180-195` aynı sınıfta audit yazıyor — tutarsız. → **I, A**
- **H-20 `server.ts:202-212`** — `unhandledRejection` süreci ayakta tutar (politika); `void` ile başlatılan ve `.catch`siz her gelecek promise bu handler'a yaslanır; `latency-persist.service.ts:104/113-184` dış try'da catch yok. Bekçi yok. → **I, K**
- **H-21 `traveler-card.service.ts:212-227`** — P2002'de tx BİR kez yeniden koşulur; ikinci yarış → ham P2002 → dal 6a teknik mesaj ("Bu 'workOrderId' değeri zaten mevcut (unique constraint)"). → **A, F**
- **H-22 `utils/cursor.ts:32-44/135/287` → `system-log.service.ts:130/215`** — bozuk/tahrif cursor sessizce `null` → ilk sayfa; "geçersiz cursor" 400'ü yok. [VARSAYIM: mükerrer satır etkisi] → **F**

---

## SINIR ÖTESİ NOTLAR

- **→ A (Eşzamanlılık):** `withBarcodeRetry` closure'larında tx-dışı iş (§2.4: `customer.service.ts:290-302` her retry'da `assertTaxNumberAvailable` + `super.create`; `item.service.ts:225-232` `nextItemCode` tx dışı; `order.service.ts:1942-1950` manuel no `findUnique` tx dışı — check-then-act, 409'a düşer); `traveler-card.service.ts:212-227` tek retry (H-21); `printed-document.service.ts:413-425` kazananı okuma; `latency-persist.service.ts:50/113-116` `inFlush` ve `reason-preset.service.ts:135-147` `backgroundRefresh` tek-uçuş bayrakları tek-process invariant'ına bağlı; H-14.
- **→ B (Mükerrer/idempotency):** replay yolları §2.3 (inventory 4218-4262 herhangi P2002 + token → lookup; `existing` yoksa orijinal hata); iptal edilmiş kayıt replay'i 409 `ENTRY_CANCELLED` (tambur-manual 1049/1405) ve fason makbuz 2348 — KK1 ham girişte (`inventory.service.ts:4218-4262`) **iptal edilmiş `Roll` için replay dalı var mı** doğrulanmalı (`status` kontrolü görülmedi) [VARSAYIM]; H-8 merge önizlemesi.
- **→ C (Veri modeli) / J:** prod kopyasında `system_logs` 2026-07-16'dan başlıyor ama 2026-07-23/28 havuz zaman aşımı satırları (`recordId='Error'`) aktif ve arşiv tablolarında **0**; arşivde SYSTEM satırı 0 → nereye gittiği (deploy öncesi temizlik / yedek kesimi / arşiv süzgeci) bakılmalı.
- **→ D (Tx sınırları):** 122 tx bloğunda `res`/dış-dünya 0; `AuditService.*`'in tx callback'i içinde çağrılıp çağrılmadığı bu haritada taranmadı (K3'ün tarayıcısı); `AppError` tx içinde fırlatılınca Prisma hatayı değiştirmeden yeniden fırlatır (`inventory.service.ts:880-882` yorumu) — `withBarcodeRetry` bunu P2002 saymaz, doğru.
- **→ E (İş kuralı):** H-6 (en güncellemesi sessiz), H-7 (barkodsuz etiket), H-11 (yetim WO); `subcontractor.service.ts:2243-2251` ve `kursun-bypass.service.ts:1093-1098/1137-1140` yalnız `AppError` toplar (doğru desen — "Doğru yapılanlar" adayı).
- **→ F (API/Express):** Express 5 yolu doğrulandı (§1.2); try'sız 8 handler; H-4 statü nesneleri; H-13 `Retry-After`; H-22 cursor; 200-gövdesinde-başarısızlık sözleşmeleri (§5) — istemcinin `delivered/seeded/warnings/idempotentReplay/failed` alanlarını okuduğu Electron/mobil tarafında doğrulanmalı (kapsam dışı); `/api` 404 mesajı `req.originalUrl`'i yansıtır (`app.ts:598-603`, JSON).
- **→ G (Güvenlik):** H-10 fail-open; `auth.middleware.ts:35-37` `lastSeenAt` sessiz; `auth.controller.ts:465-467` logout'ta revoke düşerse registry satırı canlı (tokenVersion bump yok bu yolda); `permission-management.service.ts:431/696/763` revoke best-effort (tokenVersion ikinci katman var); H-12; H-17 ham hata metni; `/api/admin/health.lastAuditError/lastPoolTimeoutError` ham hata metni (guard'lı); errorHandler `details` nesnesini olduğu gibi istemciye verir (270-277) — `details` içine ne konduğu uç bazında bakılmalı.
- **→ H (Performans):** `label.service.ts:1136/1194` raster döngülerinde `setImmediate` yield (CPU-bound, tek process); H-1'in 3× retry etkisi; `auth.controller.ts:100-118` lockout bcrypt'ten ÖNCE (doğru).
- **→ I (Hata/gözlemlenebilirlik):** bu haritanın tamamı; öncelik H-1, H-2, H-3, H-4, H-18, H-19, H-20.
- **→ J (Migration/kurtarma):** H-9, H-16; `backup.service.ts:343-357` yayınlanmış yedeği koruma (doğru); `backup-scheduler.ts:101-102` damga İŞTEN ÖNCE (bilinçli: retry spam'i; patlayan gece yedeği o gece bir daha denenmez — `BACKUP_FAILED` audit'i var) ve `archive-scheduler.ts:84` damga SONDA (idempotent) — K8 ile örtüşür; `pg-tool.helper.ts:105-109` child timeout + SIGKILL (doğru).
- **→ K (Test):** bekçisiz yollar §7 son üç satır: process handler'ları/graceful shutdown, statü-taşıyan http-errors, `AppError.internal`/retry tükenmesi audit'sizliği, 57014/40P01 varış dalı, `PrismaClientValidationError` audit'sizliği; `test_observability_contract`'ın dal 7'yi ölçüp ölçmediği okunmadı.
- **→ L (Kod kalitesi):** `AppError.isOperational` ölü alan; 27 gereksiz `.catch(() => undefined)` (§3.A); `instanceof` + `constructor.name` çift kontrol (385/589/598); P2002 fallback mesajında İngilizce kırıntı; `catch (`/`next(err)` deseni 492 kez elle kopyalanmış (sarmalayıcı yok).

---

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod'a erişim yok**; ölçümler 2026-08-25 kopyası (190/195 migration; per-DB `statement_timeout` ayarı kopyaya taşınmamış — beklenen) ve dev DB üzerinden. Prod'da `POOL_TIMEOUT`/`CHECK_VIOLATION`/`UNHANDLED_*`/`JOB_FAILED` satırlarının 0 olması "hiç olmadı" DEĞİL, "kopya tarihine kadar deftere düşmedi" demektir.
- **`DriverAdapterError`'ın 57014/40P01/25P03 için yüzeye çıkış sınıfı ÖLÇÜLMEDİ**; adapter'ın `default` dalı 23514 ile aynı olduğu için aynı şekil varsayıldı (23514 ölçümü: `scripts/test_check_violation_mapping.ts`). Kesinleştirme: dev DB'de `SET statement_timeout` ile bir ORM sorgusu koşturup hata sınıfını/`name`'i yazdırmak (② repro).
- **P2028** (interaktif tx 20 s) adapter kurulumunda gerçekten üretiliyor mu — ölçülmedi.
- **Statü taşıyan http-errors'ın dal 9'a düşmesi** (H-4): router `decodeParam` (`layer.js:219-229`), http-errors (`index.js:58,94-95`), serve-static (`index.js:115-116`), express `sendfile` (`response.js:411-417`) kaynakları okundu; canlıda tetiklenmedi. `send` paketinin hata `name`/`status` değerleri okunmadı.
- **`withBarcodeRetry` predicate sayımı** (4/25) elle grep'le yapıldı; AST tabanlı argüman sayımı yorumlardaki dengesiz parantezler yüzünden başarısız oldu (`scratchpad/retry-args.mjs`), sonuçları kullanılmadı.
- **Process handler'ları** (`unhandledRejection`/`uncaughtException`/`gracefulShutdown`/`forceTimer`/pm2 mesajı) için bekçi aranmadı değil, **bulunamadı** (grep 0); davranışları kod okumasıyla haritalandı, koşturulmadı.
- **controllers/routes'taki 492 catch** yalnız tarayıcıyla sınıflandırıldı (hepsi NEXT; `next` öncesi ek iş — lockout/audit — yalnız `auth.controller` login'inde okundu); gövdeleri tek tek okunmadı.
- 3-6k satırlık servislerde (`label`, `shipping`, `inventory`, `subcontractor`, `workorder`, `tambur`) yalnız gösterilen aralıklar okundu; `catch`/`.catch` bağlamları tarayıcı çıktısından ve hedefli `sed` ile doğrulandı.
- `src/services/reports/*`: `catch` **0** (grep) — yutma yok, yalnız `customer-scorecard:193` `.then` okundu.
- `AuditService.*` çağrılarının tx callback'i **içinde** olup olmadığı (audit tx-dışı kuralı) bu haritanın tarayıcısında aranmadı — K3a/K3b'nin alanı.
- Electron/mobil istemcinin `delivered/seeded/warnings/idempotentReplay/failed` alanlarını okuyup okumadığı — kapsam dışı; yalnız retry/belirsizlik semantiği okundu (`mobil/src/offline/entryAttempt.ts:252-255`, `mutations.ts:125-131`, `Electron/src/App.tsx:22-27`).
- `scripts/` altındaki 366 bekçinin hata dallarını ölçüp ölçmediği ad/anahtar grep'i + 9 dosyanın başlık yorumlarıyla çıkarıldı (§7); gövdeleri okunmadı.
- `swallow-scan.mjs` tarayıcısı `catch` gövdesini brace-eşleyerek çıkarır; string/regex literal içindeki `{`/`}` karakterlerini saymaz (yanlış sınıf olasılığı düşük; 90 yutan satırın tamamı elle gözden geçirildi, 40'ı kaynaktan doğrulandı).
