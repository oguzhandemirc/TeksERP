# 07 — Async Yüzey Haritası: zamanlanmış iş, arka plan, dış dünya

**Kapsam:** `/Users/oad/Documents/projeler/AdnanSahin/Teks-Erp/src` (271 TS dosyası, 103.727 satır — `find src -name "*.ts" | wc -l` ve `cat | wc -l` ile sayıldı).
**Amaç:** Denetimin nereye bakacağını belirlemek. Bu dosya bulgu raporu DEĞİL; risk işaretleri ve doğrulama hedefleri listesidir.
**Tarih:** 2026-08-09.

---

## 0. Yönetici özeti (tek paragraf)

Bu backend'de **queue yok, Redis yok, WebSocket/SSE yok, giden HTTP çağrısı yok, webhook alıcısı yok**. Async yüzeyin tamamı üç kümeden ibaret: (a) `src/jobs/` altındaki **4 boot-time iş** (2 periyodik `setInterval`, 2 tek-seferlik uzlaştırma), (b) HTTP isteğinin ömrünü aşan **fire-and-forget arka plan işleri** (pg_dump yedeği, DB kopyası, latency flush, audit yazımı), (c) **dış dünyaya iki çıkış**: `child_process.spawn` ile PostgreSQL komut satırı araçları ve `net.Socket` ile RAW TCP yazıcı gönderimi (ikincisi varsayılan **kapalı/simüle**). Bunların hepsi **TEK-PROCESS INVARIANT**'ına bağlı: eşgüdüm dağıtık kilitle değil, "ikinci bir process yok" varsayımıyla sağlanıyor ve bu varsayım `ecosystem.config.js`'te (`exec_mode: "fork"`, `instances: 1`) ve `server.ts` başındaki blokta yazılı.

---

## 1. `src/jobs/` — dört dosya, 646 satır (tam inceleme)

`wc -l src/jobs/*` çıktısı: archive-scheduler 107, backup-scheduler 137, permission-catalog.job 184, role-template-catalog.job 218 = **646**.

Dördü de `server.ts`'in `app.listen` callback'inden tetikleniyor (`server.ts:81-90`): `startArchiveScheduler()`, `startBackupScheduler()`, `startPermissionCatalogReconciler()`. Dördüncü dosya (`role-template-catalog.job.ts`) **kendi başlatıcısına sahip değil** — üçüncünün zincirinden çağrılıyor.

### 1.1 `archive-scheduler.ts` — audit log arşivleme

| Soru | Cevap (dosyadan doğrulandı) |
|---|---|
| Ne yapıyor | `AuditService.archiveOlderThan(6)` ile 6 aydan eski `SystemLog` satırlarını `system_log_archives`'e taşır; `result.archived === 0` dönene kadar batch döngüsü, tavan `MAX_BATCHES_PER_RUN = 200` (satır 24, 76-81). |
| Tetikleme | `setTimeout(STARTUP_DELAY_MS = 60_000)` → ilk koşum, sonra `setInterval(CHECK_INTERVAL_MS = 24 saat)` (satır 100-103). **cron paketi yok** — dosya başındaki yorum bunu "node-cron allowed-packages dışında" diye gerekçelendiriyor (satır 4). |
| Gerçek sıklık | Kontrol 24 saatte bir; **iş** en fazla 30 günde bir (`INTERVAL_DAYS = 30`, `SystemSetting audit.lastArchiveAt` damgası ile, satır 68-71). |
| Hata olursa | `catch` → `console.error`, `finally` → `running = false`. Sunucu düşmez, retry yok — bir sonraki 24 saatlik turda tekrar denenir. **Audit kaydı YOK** (backup işinin aksine `BACKUP_FAILED` muadili bir olay yazılmıyor). |
| Çift çalışma koruması | Yalnız **process-içi** `running` bayrağı + `WATCHDOG_MS = 3 saat` zorla bırakma (satır 52-64). **Dağıtık kilit YOK.** |
| Damga sırası | `setLastRun` iş **BİTTİKTEN SONRA** yazılıyor (satır 83). |

### 1.2 `backup-scheduler.ts` — gece yedeği

| Soru | Cevap |
|---|---|
| Ne yapıyor | `runBackupJob("nightly")` çağırır → `pg_dump -Fc` + `pg_restore --list` doğrulaması + gün bazlı rotasyon + offsite kopya. |
| Tetikleme | `setTimeout(60_000)` → sonra `setInterval(15 dakika)` (satır 129-132). |
| Hedef saat | `SystemSetting backup.hour` → `BACKUP_HOUR` env → 3. **Her turda DB'den taze okunur** (satır 82) — panelden saat değişince restart gerekmiyor. |
| Kaçırılan yedek | Telafi ediliyor: "bugünün hedef saati geçti mi ve o saatten sonra koşmuş mu" (satır 84-89). |
| Hata olursa | `console.error` + `runBackupJob` içinde `BACKUP_FAILED` audit olayı. **Damga işin BAŞINDA yazılıyor** (satır 92) — yani başarısız yedek o gün **tekrar denenmez** (bilinçli, retry spam'ini engellemek için; yorumda yazılı). |
| Kapatma anahtarı | `BACKUP_SCHEDULE_ENABLED=false` → hiç başlamaz (satır 117-123). `BACKUP_DIR` tanımsızsa da başlamaz (satır 124-128). **Sahadaki sunucuda bu bayrak `false`** (`ecosystem.config.js` env bloğu) — gece yedeğini bağımsız bir Windows Görev Zamanlayıcı görevi alıyor. |
| Çift çalışma koruması | Process-içi `checking` + 3 saatlik watchdog. **Dağıtık kilit YOK.** |

### 1.3 `permission-catalog.job.ts` — izin kataloğu uzlaştırması

| Soru | Cevap |
|---|---|
| Ne yapıyor | `PERMISSION_CATALOG` ile DB'yi karşılaştırıp **eksik** `Permission` satırlarını `createMany({ skipDuplicates: true })` ile yazar. Sözleşme: yalnız EKLE — silme/güncelleme yok (satır 14-22). |
| Tetikleme | **Periyodik değil.** `setTimeout(STARTUP_DELAY_MS = 3_000).unref()` → tek koşum (satır 183). |
| Retry | Hata → `RETRY_DELAY_MS = 15_000` ile `MAX_ATTEMPTS = 5` deneme (satır 43-45, 153-161). Tükenirse `console.error` + `PERMISSION_CATALOG_RECONCILE_FAILED` audit olayı. Sunucu düşmez. |
| Idempotency / yarış | `code @unique` + `skipDuplicates` → iki boot yarışsa bile güvenli (satır 100). Bu, **çift-instance'a karşı gerçekten güvenli tek job**. |
| Zincir | `reconcilePermissionCatalog()` **sonra** `reconcileRoleTemplates()` — aynı promise zincirinde, aynı retry politikasıyla (satır 150-151). Yorum sırayı "LOAD-BEARING" diye işaretliyor (FK bağı). |
| Tekrar-başlatma guard'ı | Modül-seviye `started` bayrağı (satır 47, 142). |

### 1.4 `role-template-catalog.job.ts` — rol şablonu uzlaştırması

| Soru | Cevap |
|---|---|
| Ne yapıyor | `ROLE_TEMPLATE_CATALOG`'daki rolleri DB ile uzlaştırır: kodsuz eski seed satırlarını `LEGACY_TEMPLATE_NAME_TO_CODE` ile **sahiplenir**, olmayanı yaratır, var olana **eksik izinleri ekler**. Hiçbir şey silmez, ad/açıklama/`isActive` ezilmez. |
| Tetikleme | Kendi timer'ı YOK — 1.3'ün zincirinden. |
| Hata olursa | `throw` → çağıranın retry/log politikasına düşer. |
| Idempotency | `permissionTemplateItem.createMany({ skipDuplicates: true })` (satır 172-175); `create` yolu ise **atomik değil** (`findMany` → `create`). Ad çakışmasında `console.warn` + `continue`. |
| Sıralı yazma | Döngü içinde `await`'li `update`/`create` — N rol için N+ round-trip. Katalog 26 rol (kök CLAUDE.md); ölçülmedi, boot maliyeti **tahmin** olarak küçük. |

### 1.5 Job'lara dair risk işaretleri (denetim hedefi)

1. **Hiçbir scheduler'da advisory lock yok.** Kod tabanında 6 `pg_advisory_xact_lock` kullanımı var (`inventory.service:796`, `session-registry.service:63`, `batch.service:125`, `permission-management.service:584`, + `duplicate-guard.helper` tanımı) — **hepsi istek yolunda, hiçbiri job'da**. Yani "advisory lock deseni biliniyor ama scheduler'a uygulanmamış".
2. **`archive-scheduler` ile `backup-scheduler` damga politikaları ters** (biri sonda, biri başta yazıyor). İkisi de gerekçeli ama asimetri denetimde açıkça doğrulanmalı: arşiv işi yarıda kesilirse (restart) damga yazılmaz → bir sonraki turda **baştan** koşar (idempotent olduğu için muhtemelen zararsız, ama 200 batch'lik döngü tekrarlanır).
3. **`backup-scheduler.ts:85` `dueAt.setHours(hour, 0, 0, 0)` — süreç saat dilimini kullanıyor.** `grep -rn "setHours(" src` çıktısında bu **tek üretim kullanımı**; diğer üç eşleşme yorum satırı (`constants/time.ts:77`, `dashboard.service.ts:40`, `reports/_shared.ts:87` — üçü de "eski `setHours` deseni kaldırıldı" diyor). `FACTORY_TIMEZONE`/`factoryDayStart` yardımcıları kod tabanında 35 yerde kullanılıyor ama **burada kullanılmıyor**. Sunucu TZ'si UTC olarak kurulursa yedek saati 3 saat kayar; `scripts/test_report_day_boundary.ts` bekçisi SQL'deki `DATE_TRUNC`/`CURRENT_DATE` arıyor, **JS `setHours`'u görmez**. Sahadaki etkisi bugün sıfır (orada scheduler kapalı) — ama bayrak açılırsa sessizce yanlış saatte koşar.
4. **`startArchiveScheduler` / `startBackupScheduler` yeniden-giriş guard'ı ilk 60 saniyede kör.** `if (timer) return` kontrolü var ama `timer` ancak `STARTUP_DELAY_MS` sonunda atanıyor (archive 99-103, backup 109-132). Bugün her ikisi de `server.ts`'ten tek kez çağrılıyor, yani **istismar edilebilir değil**; bir test/script bu fonksiyonları çağırırsa iki interval doğar. Düşük öncelik.
5. **Arşiv işinin başarısızlığı hiçbir kalıcı yere yazılmıyor** (yalnız `console.error`). Yedek işinin `BACKUP_FAILED` audit olayı var; arşivin muadili yok → "arşiv aylardır koşmuyor" sessizce fark edilmez.

---

## 2. Zamanlayıcı envanteri (grep tabanlı sayım)

`grep -rn "setInterval\|setTimeout\|node-cron\|node-schedule\|toad-scheduler\|agenda" src --include="*.ts"` sonucuna dayanır.

| Mekanizma | Sayı | Yer |
|---|---|---|
| `setInterval` (gerçek çağrı) | **2** | `jobs/archive-scheduler.ts:102` (24 sa), `jobs/backup-scheduler.ts:131` (15 dk) |
| `setTimeout` (kod, socket dışı) | **8** | `server.ts:114` (5 sn zorla-çıkış), `server.ts:123` + `:186` (2 sn flush tavanı), `permission-catalog.job.ts:160` + `:183` (retry + startup), `backup-scheduler.ts:129`, `archive-scheduler.ts:100`, `backup.service.ts:123` (30 sn verify tavanı) |
| `socket.setTimeout` | 2 | `services/helpers/device-transport.ts:50`, `:80` |
| `setImmediate` | 3 | `latency-persist.service.ts:104` (flush'ı istek yolundan ayır), `label.service.ts:985` + `:1043` (~25 topta bir event loop'a nefes) |
| cron paketi (`node-cron`, `node-schedule`, `agenda`, `toad-scheduler`) | **0** | `package.json` bağımlılıklarında yok; iki yorum satırı "allowed-packages dışında" diyor |
| `perf_hooks.monitorEventLoopDelay` | 1 | `app.ts:219` — sürekli aktif histogram (libuv seviyesinde, JS tick maliyeti yok) |

**Boot'ta başlayan periyodik iş toplamı: 2** (arşiv kontrolü + yedek kontrolü). Bunun dışında sürekli çalışan tek şey event loop delay monitörüdür.

---

## 3. Queue: **YOK** (bu bir bulgudur)

`grep -rniE "bullmq|ioredis|redis|rabbitmq|amqp|pg-boss|kafka|nats|bee-queue|sqs" src prisma package.json` → **kod eşleşmesi 0**. Yalnız iki yorum satırında "ölçeklenirse Redis'e taşı" tavsiyesi var (`server.ts:46`, `lib/presence.ts:11`).

`package.json` dependencies tam listesi (18 paket): `@prisma/adapter-pg`, `@prisma/client`, `bcryptjs`, `bwip-js`, `compression`, `cors`, `dotenv`, `express`, `helmet`, `jsonwebtoken`, `morgan`, `opentype.js`, `pg`, `prisma`, `swagger-jsdoc`, `swagger-ui-express`, `uuid`, `zod`. Kuyruk/broker/scheduler kütüphanesi **yok**.

**Kuyruğun yerini ne tutuyor:**
- **Uzun işler için:** fire-and-forget promise + process-içi "tek seferde bir tane" bayrağı + istemcinin durum yoklaması (202 sözleşmesi). Örnekler: `backup.service.triggerManualBackup` (`void runBackupJob("manual")`, satır 344), `db-copy.service.startCopyJob` (`void runCopyJob(...)`, satır ~438).
- **Sıralı yazma için:** promise zinciri kuyruğu — `db-copy.service.ts:795 copyRecordsWriteQueue`, `system-setting.service.ts:2122 documentsLogoWriteQueue`. İkisi de **process-içi**; read-modify-write yarışını yalnız tek process içinde serileştirir.
- **Gecikmeli/toplu yazma için:** `latency-persist.service` — timer'sız, **istek-güdümlü throttle** (`FLUSH_INTERVAL_MS = 5 dk`, `setImmediate` ile istek yolundan ayrılır). Dosya başlığı "TIMER YOK" ilkesini açıkça yazıyor.
- **İstemci tarafında:** mobil uygulamanın offline kuyruğu (repo dışı, `mobil/`). Backend bunu bilmez; sonucu KK1 mükerrer top koruması olarak backend'e yansımış (kök CLAUDE.md 2026-08-05 notu).

**Denetim hedefi:** kuyruk olmadığı için **"işi kim yeniden dener"** sorusunun cevabı her yerde farklı. Arşiv: bir sonraki 24 saat. Yedek: **hiç** (aynı gün). İzin uzlaştırması: 5 deneme. DB kopyası: hiç (restart → `interrupted` durumu, `db-copy.service.evaluateCopyState`). Latency flush: bir sonraki throttle penceresi (kayıp veri kabul edilmiş). Bu tutarsızlık bilinçli mi, kaza mı — dosya yorumları gerekçe veriyor ama tek bir yerde toplanmamış.

---

## 4. Redis: **YOK** — paylaşımlı durum nerede tutuluyor

Redis/memcached yok. Paylaşımlı durumun üç yeri var:

1. **PostgreSQL** — kalıcı olan her şey. Scheduler damgaları (`SystemSetting audit.lastArchiveAt`, `backup.lastNightlyAt`), oturum defteri (`Session` tablosu, jti bazlı), izin/rol katalogları, latency günlük özeti (`EndpointLatencyDaily`).
2. **Dosya sistemi** — yedek dosyaları (`BACKUP_DIR`), DB kopya kayıtları (`copyRecords`, JSON).
3. **Süreç belleği** — aşağıdaki §5'in tamamı.

---

## 5. MULTI-INSTANCE'TA BOZULACAK IN-MEMORY DURUM

> Bu başlık bilinçli olarak ayrı. Aşağıdaki her satır **tek process varsayımına** bağlıdır; ikinci bir worker/replica eklendiğinde **hata vermeden yanlış davranır**.
>
> Varsayım iki yerde yazılı ve şu an korunuyor: `src/server.ts:37-49` ("TEK-PROCESS INVARIANT" bloğu) ve `ecosystem.config.js` (`exec_mode: "fork"`, `instances: 1`, "pazarlık dışı" yorumuyla). **Doğrulandı:** `src` içinde `cluster`, `worker_threads` kullanımı yok; tek `app.listen` var (`server.ts:60`).

### 5.1 Kesin bozulanlar — sayım/eşgüdüm parçalanır

| Modül | Durum | 2. instance'ta ne olur |
|---|---|---|
| `lib/presence.ts:16-17` | `users` / `devices` Map (son görülme, 5 dk pencere) | "Aktif kullanıcı/cihaz" sayısı process başına parçalanır; `/health` yanlış düşük sayı verir. Yorumda zaten yazılı. |
| `jobs/archive-scheduler.ts:26-28` | `timer`, `running`, `runningSince` | İki process aynı gün arşivi başlatabilir. `getLastRun` → `if daysSince < 30 return` **check-then-act**'tir, kilitsizdir → çift arşivleme penceresi açıktır. |
| `jobs/backup-scheduler.ts:34-36` | `timer`, `checking`, `checkingSince` | Aynı gece **iki pg_dump**. Damga başta yazılsa da iki process arasında yarış var (`getLastRun` → `setLastRun` arası await'li). Aynı saniye çözünürlüklü dosya adına iki yazım + rotasyonla yarış. |
| `services/backup.service.ts:162` | `running` bayrağı | "Zaten bir yedek sürüyor" guard'ı yalnız kendi process'ini görür. |
| `services/db-copy.service.ts:129-130, 471` | `currentJob`, `lastJobResult`, `lastVerification` | `startCopyJob`'un "ATOMİK CLAIM" yorumu (satır ~403) **tek thread varsayımına** dayanır. 2. process paralel `pg_restore` başlatabilir. Ayrıca `evaluateCopyState`'in `interrupted` tespiti (satır ~148 yorumu) doğrudan tek-process invariant'ına dayandığı yazıyor. |
| `services/system-setting.service.ts:824, 831` | `featureFlagsCache` + `cacheGeneration` (TTL 30 sn) | `invalidateFeatureFlagsCache()` **process-local**. A process'inde çevrilen bayrak, B process'inde 30 saniyeye kadar eski görünür. Yorum bunu kabul ediyor ("tek-sunucu yerel kurulum"). |
| `middlewares/login-lockout.ts:24` | `failCounts` Map (brute-force throttle) | **Güvenlik etkisi:** N process = N× deneme hakkı. `reserveLoginAttempt`'in "atomik rezervasyon" garantisi (yorum: "Node tek-thread olduğundan…") yalnız tek process'te geçerli. |
| `middlewares/auth.middleware.ts:16` | `lastSeenWrites` Map (60 sn throttle) | Yalnız fazladan DB yazımı — davranışsal zarar düşük. |
| `services/latency-stats.service.ts:65-68` | `stats` Map, `slowRing`, `statsSince`, `totalCount` | `/api/admin/perf` her process'te farklı sayı gösterir. |
| `services/latency-persist.service.ts:48-54` | `pending`, `lastFlushAt`, `inFlush`, `lastRetentionDayKey`, `flushFailures` | `inFlush` process-local → iki process aynı `(day, routeKey)` satırına **findUnique → update** ile yarışır (`upsert` değil, satır 124-157): **son yazan kazanır** yerine **çift artım/kayıp** riski. Retention `deleteMany` de günde birden fazla koşar (zararsız). |
| `lib/pool-health.ts:81-82` | `waitingMax`, `connectsTotal` | Havuz telemetrisi parçalanır. |
| `app.ts:160-161, 211-213` | `backupCache`, `lastProcCpu`, `lastCpuSampleNs`, `lastSysCpu` | CPU delta'sı process başına; "makine CPU%" iki process'te iki kere sayılmaz ama proses CPU'su eksik raporlanır. |
| `lib/disk-metrics.ts:22` | yol başına 30 sn disk cache | Yalnız fazladan `statfs` — zararsız. |
| `services/backup.service.ts:106` | `verifyCache` (dosya anahtarlı doğrulama sonucu) | Yalnız fazladan `pg_restore --list` — zararsız. |
| `services/backup-impact.service.ts:465` | `computing` bayrağı | Ağır sayım işi iki kez koşabilir (performans, doğruluk değil). |
| `services/db-copy.service.ts:795`, `system-setting.service.ts:2122` | promise-zinciri yazma kuyrukları | **Read-modify-write serileştirmesi kaybolur** → JSON kayıt dosyası / logo kütüphanesi kayıp güncelleme (lost update) üretebilir. |
| `jobs/permission-catalog.job.ts:47` | `started` bayrağı | Zararsız (uzlaştırma `skipDuplicates` ile idempotent). |

### 5.2 Zararsız (türetilmiş / salt-okunur önbellekler)

`services/base.service.ts:39,79` (DMMF alan cache'leri), `services/printed-document.service.ts:140` (builder registry), `config/label-fields.ts:191` (`unifiedCache`), `config/label-icons.ts:31`, `document-render/*.fields.ts` BY_KEY map'leri, `utils/json-replacer.ts:19` (`patched`), `services/helpers/raster/raster-font.ts:28` (font metriği). Bunlar deterministik/immutable veriden türetilir; process başına kopya olması davranışı değiştirmez.

### 5.3 Denetim hedefleri

- **§5.1'in ilk beş satırı** (iki scheduler + iki uzun iş + feature-flag cache) yatay ölçekleme yasağının gerçek dayanağı. Denetim şunu doğrulamalı: `ecosystem.config.js`'teki `instances: 1` bir **bekçiyle korunuyor mu**? (`scripts/` altında ecosystem'i okuyan bir test bulunamadı — **ŞÜPHELİ**, tam tarama yapılmadı; yalnız `grep -rn "ecosystem" src` kapsandı ve `src` içinde referans yok.)
- **`login-lockout`** tek-process'e bağlı olması güvenlik sınıfı bir kabuldür; güvenlik denetiminde ayrıca ele alınmalı.
- **`latency-persist` findUnique→update** deseni tek process'te bile `inFlush` bayrağına güveniyor. `flushLatencyNow` **hem throttle'dan hem `gracefulShutdown`'dan** çağrılabiliyor (`server.ts:122`) — kapanışta throttle flush'ı hâlâ uçuştaysa `inFlush` yüzünden shutdown flush'ı **sessizce hiçbir şey yapmaz** (`if (inFlush) return`, satır 114). Kayıp veri "özet metrik" olduğu için kabul edilmiş olabilir; doğrulanmalı.

---

## 6. Dış API çağrıları: **giden HTTP yok**

`grep -rnE "axios|\bfetch\(|https?\.request|node-fetch|got\(|undici" src --include="*.ts"` → **0 eşleşme**. Backend hiçbir dış web servisine çıkmıyor: ödeme, e-fatura, SMS, e-posta, bulut depolama entegrasyonu yok.

Dış dünyaya **iki** çıkış var ve ikisi de HTTP değil:

### 6.1 `child_process.spawn` — PostgreSQL komut satırı araçları

Tek yer: `services/helpers/pg-tool.helper.ts:8,44` (`runTool`). Araçlar: `pg_dump`, `pg_restore`, `psql` (`PgToolName` union'ı). Yol `PG_BIN_DIR` env'inden **çağrı anında** çözülür.

| Özellik | Durum |
|---|---|
| Timeout | **`runTool`'un KENDİSİNDE YOK.** Child asılırsa promise hiç settle olmaz. |
| Telafi | Çağıran tarafta: `verifyBackupFile` `Promise.race` + 30 sn (`backup.service.ts:122-124`); scheduler'da 3 saatlik watchdog. **`pg_dump`'ın kendisinde tavan YOK** — asılı dump `running` bayrağını 3 saat tutar, sonra watchdog bayrağı bırakır ama **child hâlâ koşuyordur**. |
| Retry | Yok. Başarısız yedek o gün tekrar denenmez (damga başta). |
| stderr | 64 KB'de kırpılıyor (satır 48-51) — pipe dolup child'ı asmasın diye tüketiliyor. `stdout` **tüketilmiyor** (yorumda gerekçeli: `-f` ile dosyaya yazılıyor). |
| Sır sızıntısı | Şifre yalnız `PGPASSWORD` env'i ile geçiyor, argümanlara yazılmıyor (satır 38-40). |
| İkinci kullanıcı | `db-copy.service` — `CREATE DATABASE` + `pg_restore` + iki `ALTER DATABASE RENAME`. `withAdminClient(..., { statementTimeoutMs: 0 })` ile **statement timeout kapatılıyor** (satır ~569). |

**Denetim hedefi:** `runTool`'a timeout eklenmemesi bilinçli mi? Büyük DB'de `pg_dump` saatlerce sürebilir, o yüzden sabit tavan yanlış olurdu — ama o zaman **asılma ile uzun sürme birbirinden ayırt edilemiyor** demektir. `db-copy`'nin `interrupted` durumu da bu belirsizliği kabul ediyor.

### 6.2 `net.Socket` — RAW TCP yazıcı gönderimi (bkz. §8)

---

## 7. Webhook alıcısı: **YOK**

Gelen çağrı yüzeyi tamamen kendi istemcileri (Electron paneli + Expo tablet). Dış sistemin POST edebileceği bir uç bulunamadı.

**JWT'siz (public) uç envanteri** — `src/routes/*.ts` içinde `verifyToken` içermeyen router taraması + `app.ts` mount listesi (47 `app.use("/api...` satırı):

| Uç | Dosya | Not |
|---|---|---|
| `GET /health` | `app.ts:285` | Auth yok. DB boyutu, bağlantı sayısı, cache isabeti, disk, **son yedek dosya adı ve zamanı**, uptime, sürüm döner. LAN-only kurulum varsayımıyla açık. **Denetim hedefi (bilgi ifşası).** |
| `POST /api/devices/announce` | `routes/device.routes.ts:26` | Tablet boot'ta kendini bildirir; bilinmeyen cihaz `PENDING` satırı **yaratır**. Kimliksiz yazma yolu → **kayıt şişirme (DoS-lite) hedefi.** |
| `GET /api/devices/status` | `routes/device.routes.ts:37` | `x-device-id` ile atama durumu sorgular. |
| `GET /api/devices/pairing-required` | `routes/device.routes.ts:49` | Bayrak okuma. |
| `/api/auth/*` login uçları | `routes/auth.routes.ts` | Doğası gereği pre-auth; `login-lockout` middleware'i ile korunuyor (§5.1). |

`src/routes/reports.routes.ts` taramada "verifyToken içermiyor" diye çıktı ama **yanlış pozitif**: sadece 7 alt-router'ı mount eden bir kök (satır 21-27); guard'lar alt dosyalarda.

**Rate limiting:** `express-rate-limit` benzeri bir paket **yok** (dependencies listesinde geçmiyor). Tek throttle mekanizması `middlewares/login-lockout.ts` ve o da yalnız hızlı-PIN/kart girişini kapsıyor. `/health` ve `/api/devices/announce` **hiç sınırlanmıyor** — denetim hedefi.

---

## 8. Donanım / COM port entegrasyonları

| Cihaz | Nerede | Gerçek mi simüle mi |
|---|---|---|
| **Yazıcı (etiket)** | `services/helpers/device-transport.ts` (`net.Socket`, RAW TCP port 9100, 5 sn timeout) → `services/helpers/printer-transport.ts` (`dispatchNativeSend`) | **İKİ FAZLI.** `label.nativeSendEnabled` ayarı **varsayılan KAPALI** → hiç socket açılmaz, yalnız "ne, nereye, kaç bayt" özeti döner (Faz-1 simülasyon, kök CLAUDE.md "donanım sadece simüle" kuralı). Ayar AÇIK + yazıcı IP'si varsa **gerçek TCP gönderimi** yapılır (Faz-2). |
| **Kantar / metre (ağ)** | `device-transport.ts` `DeviceTransport.read?()` arayüzü tanımlı | **Arayüz var, uygulama YOK.** `tcpTransport()` yalnız `test` + `write` döndürüyor (satır 68-86); `read` implemente edilmemiş. Yorum "ileride ağ-kantar/metre" diyor. |
| **BT / USB / Serial cihazlar** | — | **Backend'de HİÇ YOK.** Dosya başlığı: "BT/USB/Serial cihazlar tablette okunur (mobil HAL)". `serialport` paketi bağımlılıklarda yok. |

**Çağrı noktaları (2 adet):** `services/label.service.ts:818` ve `services/peripheral.service.ts:426`. **Doğrulandı:** her iki dosyada da `prisma.$transaction` kullanımı **yok** (`grep -n "\$transaction"` → 0 eşleşme) → TCP I/O bir transaction içinde koşmuyor, perf kuralı 10 ihlali görünmüyor.

**Denetim hedefleri:**
- `sendOverTcp` hedef host'u **çağıran veriden** alıyor (`opts.printerIp`, DB'deki cihaz kaydı). Bu bir **SSRF-benzeri** yüzeydir: yazıcı IP'sini yazabilen kullanıcı backend'i LAN'daki herhangi bir host:port'a bağlanmaya zorlayabilir. Ayar kapalıyken risk sıfır; açıkken denetlenmeli.
- Faz-2'nin canlıda açık olup olmadığı bu repodan **anlaşılmıyor** (`SystemSetting` değeri DB'de). Denetim ölçmeli.

---

## 9. WebSocket / SSE / long-polling: **YOK**

`grep -rniE "websocket|socket\.io|EventSource|text/event-stream|res\.flushHeaders|long.?poll"` → gerçek eşleşme 0 (iki `ws.` eşleşmesi `inventory.service.ts:1824,1833`'te SQL tablo alias'ı: `work_order_steps ws`).

Gerçek zamanlılık **istemci-güdümlü kısa aralıklı yoklama** ile sağlanıyor:
- Durum sayfası `/health`'i ~5 saniyede bir yokluyor (`app.ts` yorumlarında birden çok yerde "/health 5sn'de bir, çok istemciyle yoklanıyor" gerekçesi geçiyor — `latestBackupInfo` ve `readDiskFor` cache'lerinin varlık sebebi bu).
- Kurşun tableti `listOpenCards`'ı 5 saniyede bir yokluyor (kök CLAUDE.md 2026-08-05 notu; backend tarafında özel bir mekanizma yok, düz GET).
- DB kopyası / manuel yedek 202 döndürüp istemciyi durum yoklamasına yönlendiriyor.

**Denetim hedefi:** yoklama yükünün ölçülmesi. `/health` her çağrıda bir `$queryRaw` yapıyor (tek round-trip, in-memory stat view'ler); N istemci × 5 sn → havuz üzerinde sabit taban yük. `app.ts` yorumları bunun farkında ve iki cache eklemiş, ama **DB sorgusu cache'lenmemiş**.

---

## 10. Graceful shutdown (`server.ts:105-188`)

**Var ve oldukça ayrıntılı.** Üç giriş noktası:
1. `process.on("SIGTERM")` → `gracefulShutdown("SIGTERM")`
2. `process.on("SIGINT")` → `gracefulShutdown("SIGINT")`
3. `process.on("message", msg => msg === "shutdown")` → pm2 IPC (Windows'ta POSIX sinyali gönderilemediği için; `ecosystem.config.js` `shutdown_with_message: true` ile eşleşiyor)

Ayrıca `unhandledRejection` (logla, **ayakta kal**) ve `uncaughtException` (logla, ~2 sn audit bekle, `exitCode=1` ile kapan) handler'ları var — politika farkı yorumda gerekçeli.

**Sıra:** `shuttingDown` guard → 5 sn `forceTimer` (`.unref()`) → `flushLatencyNow()` 2 sn tavanla → `server.close(cb)` → cb içinde `prisma.$disconnect()` → `pool.end()` → `process.exit(exitCode)`.

### Kapanışta ne oluyor / ne olmuyor

| Şey | Durum |
|---|---|
| Uçuştaki HTTP istekleri | `server.close()` yeni bağlantıyı reddeder, mevcutları bitirir. **5 saniyeden uzun sürerse `process.exit(1)` ile kesilir.** pm2 `kill_timeout: 8000` ile pay bırakıyor. |
| Açık interaktif transaction'lar | **Açıkça beklenmiyor.** Prisma global `transactionOptions.timeout = 20_000` (`lib/prisma.ts:91`) — yani bir transaction 20 saniyeye kadar sürebilirken kapanış 5 saniyede zorla çıkıyor. İstek `server.close`'un beklediği bir bağlantıya bağlıysa kısmen korunur; değilse (arka plan işi) kesilir. **Denetim hedefi: 5 sn tavan ile 20 sn tx tavanı arasındaki uyumsuzluk.** |
| Koşan `pg_dump` / `pg_restore` | **Beklenmiyor ve öldürülmüyor.** `spawn` edilen child `detached` değil; `process.exit()` sonrası child yetim kalır ve yazmaya devam eder. Yarım `.dump` dosyası kalabilir — `runBackupJob`'un `catch` bloğundaki `fs.rm(out)` temizliği **koşmaz** (parent öldü). Bir sonraki tur bunu bozuk sanıp silmez, çünkü doğrulama yalnız yeni dosyaya uygulanıyor. **Denetim hedefi.** |
| Koşan DB kopya işi | Aynı durum; `db-copy.service` bunu tasarımca kabul ediyor (`evaluateCopyState` → `interrupted`, "yarım kopya tam kopyadan ayırt edilemez, geçiş sunulmaz"). |
| Arşiv batch döngüsü | Beklenmiyor; damga sonda yazıldığı için bir sonraki turda baştan koşar. |
| Latency delta'ları | 2 sn tavanla flush ediliyor — ama `inFlush` yarışı varsa sessizce atlanabilir (§5.3). |
| Fire-and-forget audit yazımları | Beklenmiyor. `src` genelinde **36** satır `void ...` fire-and-forget çağrısı ve **38** satır `.catch(() => {})` tarzı yutulan hata var (grep sayımı) — kapanışta uçuştakiler kaybolur. Audit best-effort olduğu için tasarımca kabul. |
| Havuz | `pool.end()` çağrılıyor; ama `server.close` callback'i içinde, yani 5 sn dolarsa hiç koşmaz (`forceTimer` → `process.exit(1)`). |

---

## 11. Özet risk haritası (denetimin bakacağı yerler, öncelik sırasıyla)

1. **Tek-process invariant'ın mekanik koruması var mı** — `instances: 1` bir bekçiyle korunmuyorsa (ŞÜPHELİ, tam taranmadı) §5.1'in tamamı sessiz bozulmaya açık.
2. **`runTool` timeout'suz** — asılı `pg_dump` yedeği o gün sessizce yok eder (damga başta yazılıyor, retry yok).
3. **`backup-scheduler` süreç saat dilimi** — `setHours`, tüm kod tabanındaki tek istisna; hiçbir bekçi görmüyor.
4. **Yedek başarısızlığında retry yok + arşiv başarısızlığında audit yok** — "sessizce çalışmayan zamanlanmış iş" sınıfı.
5. **Graceful shutdown 5 sn ↔ transaction 20 sn uyumsuzluğu**; koşan child process'lerin sahipsiz kalması.
6. **Public uçlarda rate limit yok** — `/api/devices/announce` kimliksiz kayıt yaratıyor; `/health` kimliksiz operasyonel bilgi veriyor.
7. **`login-lockout` process-local** — güvenlik sınıfı kabul, ayrıca ele alınmalı.
8. **RAW TCP hedefinin veriden gelmesi** (yazıcı IP) — Faz-2 açıksa SSRF-benzeri yüzey.
9. **`latency-persist` findUnique→update yarışı** ve `inFlush`'ın kapanış flush'ını yutması.
10. **Promise-zinciri yazma kuyrukları** (`copyRecordsWriteQueue`, `documentsLogoWriteQueue`) — tek process dışında lost-update.
