# K9 — Entegrasyon & Dış Dünya HARİTASI (aşama ① KEŞİF)

Tarih 2026-08-28 · dal `adnansahin` · HEAD `ce8681d1` · Backend `Teks-Erp/src` (yollar repo köküne göre; `Teks-Erp/` ön eki kısaltma için `src/…` olarak yazıldı) · SALT-OKUNUR keşif; **yargı yok, bulgu yok** — yalnız harita + ② denetçileri için HOTSPOT işaretleri.

Kapsam: (a) etiket baskı · (b) kantar/COM · (c) yedek & DB kopyası · (d) mobil güncelleme + Electron feed · (e) keşif (mDNS) · (f) içe aktarım · (g) dışa aktarım · (h) swagger/static · (i) request-context.

## 0. Yöntem, kaynaklar, sondalar

| Ne | Nasıl |
|---|---|
| Kod okuma | Tam okunan dosyalar: `app.ts`, `server.ts`, `config/swagger.ts`, `lib/request-context.ts`, `lib/lan-addresses.ts`, `lib/discovery-txt.ts`, `lib/disk-metrics.ts`, `lib/app-version.ts`, `services/helpers/{device-transport,printer-transport,pg-tool,pg-admin-client,pg-conn,db-swap-command,backup-naming,offsite-backup,label-renderer.registry,label-routing.resolver,label-pplb,traveler-card-dirty}.ts`, `helpers/raster/{raster-render,raster-font,raster-canvas,raster-barcode}.ts` (+`raster-text`/`raster-bitmap` başları), `helpers/codec/meter.codec.ts`, `services/{backup,db-copy,db-copy-verify,backup-impact,mobile-update,discovery,peripheral,accounting-export}.service.ts`, `services/import/*.ts` + `adapters/{item,order,route}.adapter.ts`, `jobs/{backup-scheduler,offsite-sweeper,job-failure,mdns-advertiser,installation-identity}.ts`, `routes/{db-copy,mobile-update,discovery,import,config-bundle}.routes.ts`, `routes/admin.routes.ts:1170-1500`, `controllers/label.controller.ts`, `label.service.ts`'in baskı/print-event/bulk bölgeleri, `traveler-card.service.ts:340-470`, `printed-document.service.ts:437-470,641-722`, `shipping.service.ts:886-967`, `ecosystem.config.js`, `public/{index.html,status.js}`, Electron `shared/update-feed.ts`, `electron/ipc/printer.ipc.ts:55-100`, mobil `scripts/lib/feed.cjs`, `offline/printQueue.ts` başı, `deploy/guncelleme-sunucusu/nginx/default.conf`. |
| grep disiplini | `--include='*.ts'` tırnaklı; sayılar aşağıda verildi ("temiz" denmedi). |
| DB | `audit/tools/sql-saha.sh` (prod kopyası `tekserp_saha_0825`, 190 migration) ve `audit/tools/sql-dev.sh` — yalnız SELECT. |
| Sonda | Scratchpad'de `json-limit-probe.cjs`: Teks-Erp'in kendi `express` paketiyle app.ts sırası birebir (global `express.json({limit:"1mb"})` → router'da `express.json({limit:"10mb"})`), 1.976.688 baytlık gövde → **`413 entity.too.large`** (bkz. §8.4 ve HOTSPOT H-1). Kaynak koda dokunulmadı. |

**Topoloji hatırlatması (K9 kararlarını etkiler):** PM2 `fork`, `instances: 1` (`ecosystem.config.js`, `server.ts:22-34`) → tüm süreç-içi bayraklar (`running`, `currentJob`, `computing`, `checking`, `verifyCache`, mDNS state, discovery cache) tek process altında doğru çalışır; "cluster'da bozulur" bu haritada bulgu sayılmaz (beceri §5 YP-7).

## 1. Büyük resim — dış dünyaya çıkan / dışarıdan gelen kanallar

| Kanal | Var mı | Kanıt (grep sayısı / dosya:satır) |
|---|---|---|
| Dışa HTTP istemcisi (`fetch`/`axios`/`http.request`/`undici`) | **YOK** | `grep -rnE "https?\.request\(\|\bfetch\(\|axios\|undici" src --include='*.ts'` → 0 |
| Dışa TCP | Yalnız yazıcı RAW 9100 — `net.Socket` tek dosyada | `src/services/helpers/device-transport.ts:10,41,71` (`net` import'u tüm src'de tek: 1 vuruş) |
| UDP / multicast | mDNS ilanı (`bonjour-service` 1.4.4, port 5353) | `src/jobs/mdns-advertiser.job.ts:91,151-170` |
| `child_process` | **TEK kapı** `spawn` — `pg_dump`, `pg_restore`, `rclone`; `exec`/shell YOK | `src/services/helpers/pg-tool.helper.ts:8,105` (`spawn(` tüm src'de 1 vuruş; `exec(` vuruşları regex `.exec` — child_process değil) |
| `psql` | Backend ÇALIŞTIRMAZ; yalnız operatöre kopyalanacak PowerShell metni üretir | `src/services/helpers/db-swap-command.helper.ts:72-78,80-175` |
| Uygulama içinden DDL | `pg.Client` (havuzsuz) ile `CREATE DATABASE` / `ALTER DATABASE … SET` / `DROP DATABASE [WITH (FORCE)]` | `src/services/db-copy.service.ts:320,619,500,716`; istemci `src/services/helpers/pg-admin-client.ts:68-83` |
| `$queryRawUnsafe` (K9 alanı) | 2 yer, ikisi de sabit tablo listesinden isim alır | `src/services/db-copy-verify.service.ts:466` (`prismaCount`), `:328-346` (`countTables`, `to_regclass` + `"tablo"` tırnaklı) |
| Dosya sistemi | Yedek dizini, `rclone.conf`, `mobil-guncelleme/`, `public/`, `assets/fonts/`, `prisma/migrations/`, `package.json` | §12 listesi |
| Gelen dosya yükleme (multipart) | **YOK** — `multer` yok; import gövdesi JSON hücre matrisi, config-bundle JSON zarfı | `package.json` bağımlılıkları; `src/services/import/import.types.ts:12-14` ("Backend'de CSV/XLSX ayrıştırıcı YOKTUR") |
| Statik servis | `express.static(<cwd>/public)` — `index.html`, `logo.png` (436 KB), `status.js` | `src/app.ts:157-158`; `Teks-Erp/public/` |
| Swagger | Yalnız `NODE_ENV !== "production"` | `src/config/swagger.ts:66-71`; ecosystem `NODE_ENV: "production"` |
| Kuyruk / mesajlaşma / Redis | YOK | KUNYE; `grep bullmq\|agenda\|ioredis` → 0 |

## 2. ENTEGRASYON ENVANTERİ

Sütunlar: **Yön** (sunucudan dışa / dışarıdan sunucuya / yalnız FS-DB) · **Tetikleyen** (uç ya da iş) · **Timeout** · **Retry/backoff** · **Idempotency anahtarı** · **Tx ilişkisi** (yazımlar tx İÇİNDE / DIŞINDA / tx yok) · **Hata görünürlüğü** (kullanıcı / log / audit / sessiz) · **CPU / event-loop**.

### 2.a Etiket baskı

| # | Adaptör | Yön | Tetikleyen | Timeout | Retry | Idempotency | Tx ilişkisi | Hata görünürlüğü | CPU / event-loop | Kanıt |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Etiket **render** — HTML / PPLA / PPLB / ZPL komut üretimi | Sunucu içi (CPU) | `GET /api/labels/rolls/:id/{html,ppla,native,preview}`, `/sacks/:id/*`, `/swatches/:id/*`, `/templates/:id/*`, `POST /rolls/bulk-{html,native}` | HTTP zaman aşımı YOK (Express varsayılanı) | — | — (salt okuma) | tx yok | Hata → `next(e)` → JSON; raster düşerse `console.error` + komut moduna sessiz düşüş (`label-renderer.registry.ts:119-121`) | **Senkron** `bwipjs.toSVG` ×2 / etiket (`label.service.ts:817,820,1082-1083,1503-1506,1671-1672,1878-1881`); toplu yolda 25 etikette bir `setImmediate` (`:1136,:1194`); tavan `rollIds ≤ 2000`, `copies ≤ 5` (`label.controller.ts:44-56`) | `label-renderer.registry.ts:86-149` |
| A2 | Etiket **raster** (1bpp bitmap, opentype glif tarama + bwip `raw()`) | Sunucu içi (CPU) | A1 ile aynı uçlar, yalnız `PeripheralDevice.rasterMode=true` **ve** raster dil (PPLA/PPLB/ZPL) **ve** kanvas varyantı (`shouldRasterize`, `registry.ts:154-159`) | — | — | — | tx yok | Rasterize patlarsa `console.error` + komuta düşüş (`registry.ts:110-122`); önizlemede `catch {}` sessiz (`label.service.ts:934`, `label-template.service.ts:1213`) | Tamamen **senkron** piksel işi: `raster-canvas.ts:36-109`, `raster-text.ts:33-58,87`, `raster-barcode.ts:25-78` (`bwipjs.raw` sync); font `readFileSync` bir kez, modül önbelleği (`raster-font.ts:28-43`); `async` imza yalnız ikon için, içi sync (`raster-canvas.ts:34-35`) | saha: rasterMode=true cihaz **1** (USB PPLB) — §13 |
| A3 | **Yazıcıya RAW TCP gönderim** (sunucudan) | Sunucu → yazıcı `host:9100` | `POST /api/labels/rolls/:id/print-native` (`label:print` ∨ mobil izinleri, `label.routes.ts:195-198`); `POST /api/labels/test-native` (`label:print` ∨ `station:write`, `:239-242`); `POST /api/peripherals/:id/test` (`station:write`, `peripheral.routes.ts:153`) | Soket `setTimeout(5000)` (`device-transport.ts:13,50`); bağlan→yaz→`end` | **YOK** (tek deneme, sonuç nesnesi döner) | YOK — her çağrı yeniden basar | tx yok; audit `LABEL_NATIVE_PRINT` best-effort, tx dışı (`label.service.ts:1002-1015`) | Sonuç JSON'da `delivered/simulated/error` (`printer-transport.ts:20-32`); IP yoksa `error` metni (`:65-76`) | I/O, event-driven | **Kapı:** `label.nativeSendEnabled` (SystemSetting, `system-setting.service.ts:3435`) — saha değeri **false** (§13) → sahada hiç soket açılmıyor; saha cihazlarının hiçbiri `NETWORK_TCP` değil |
| A4 | Fiziksel baskı **istemcide** | İstemci → yazıcı | Electron `electron/ipc/printer.ipc.ts:67-75` (TCP 9100) / `:98` (`SerialPort`); mobil `mobil/src/services/hal/btClassic.transport.ts` (BT SPP) | istemci tarafı | mobil `printQueue.ts`: `retryable` işlerde otomatik ≤ `PRINT_AUTO_RETRY_MAX` (3) | mobil kuyruk **at-least-once** (`activeId` persist edilmez → aynı barkodlu ikinci kâğıt kabul edilen bedel) | — | istemci UI | — | `mobil/src/offline/printQueue.ts:1-30` — **sunucuda yazıcı kuyruğu YOK** (KUNYE ile uyumlu) |
| A5 | **print-event (top)** — baskı izi + bayraklar | Dışarıdan sunucuya | `POST /api/labels/rolls/:id/print` (`label.routes.ts:602-606`) | — | — | YOK — her çağrı `labelPrintedAt=now()` yeniden yazar (bilinçli, `label.service.ts:2106-2110`) | **Üç ayrı yazım, tx YOK**: ① `seedRollLabelSnapshot` → `roll.update(lastLabelSnapshot,labelCustomerId)` (`:1989-2000`), ② `roll.update(labelDirty:false, labelPrintedAt)` (`:2112-2115`), ③ audit `LABEL_PRINT_EVENT` (`:2145-2156`); arada `getRollLabel` + `resolveLabelRouting` okumaları (best-effort, `:2120-2140`) | 404 top yoksa; diğer hatalar `next(e)`; audit best-effort | okuma ağırlıklı | `label.service.ts:2075-2160` |
| A6 | **print-event (çuval)** | Dışarıdan sunucuya | `POST /api/labels/sacks/:id/print-event` (`label.routes.ts:536-540`) | — | — | `updateMany WHERE labelDirty:true` (idempotent temizlik) | tx yok; `sack.updateMany` + audit | JSON | — | `label.service.ts:1737-1745` |
| A7 | **print-event (refakat kartı)** | Dışarıdan sunucuya | `POST /api/traveler-cards/:id/print-event` (`traveler-card.routes.ts:294`) | — | — | `printed_documents` **upsert** `(docType,sourceId,version)` — aynı sürüm ikinci kopyada satır çoğalmaz (`traveler-card.service.ts:443-460`) | **tx İÇİNDE**: kart `update` + defter `upsert` + eski sürümleri `updateMany` (`:367-386`); audit tx **dışında** (`:388-399`) | JSON; saha 2026-08-05/06'da bu uçta 15× `TypeError` (audit `SYSTEM/ERROR`, §13) — `bind` eksikliği, düzeltildi (bellek notu `ef49bbc3`) | — | `traveler-card.service.ts:349-395` |
| A8 | `labelDirty` / `contentDirty` **kaynakları** (baskının tersi: veriyi değiştiren yollar bayrak koyar) | Sunucu içi | 11 yazım noktası: `shipping.service.ts:458,468-469,1069-1070,1723`; `kartela.service.ts:1227-1228`; `inventory.service.ts:3913`; `workorder-manual-move.service.ts:695`; `subcontractor.service.ts:1152,1189`; `sack-content-mismatch.helper.ts`; kart için tek nokta `traveler-card-dirty.helper.ts:34-60` (`updateMany … contentDirty:false`) | — | — | `where … labelDirty:false` guard'ı gereksiz yazmayı eler | Çoğu tx içinde (`tx.sack.updateMany`), bazıları havuz client'ıyla (`shipping.service.ts:1723` `prisma.sack.updateMany`) — ② eşzamanlılık ajanı "çift-mod çağrı yeri" listesi için hazır | — | — | `grep -rn labelDirty src --include='*.ts'` → 30 vuruş |
| A9 | Belge HTML üretimi (irsaliye/kart) + QR | Sunucu içi | `printed-document` `getHtml`/`reissue`; `traveler-card` html | — | — | `reissue`: atomik claim `updateMany WHERE status ACTIVE` + `version+1` tx içinde (`printed-document.service.ts:670-693`) | tx içinde belge, audit dışında (`:695-707`) | JSON | `bwipjs.toBuffer` (PNG, promise ama JS-CPU) (`printed-document.service.ts:295`); şablon string birleştirme | K7/K8 alanı; burada yalnız CPU notu |

**Baskı akışı (saha gerçeği):** tablet/panel → `GET …/native` (sunucu **baytları üretir**, `latin1` metin ya da `b64` raster) → istemci yazıcıya kendi kanalıyla yazar (BT SPP / USB / seri / TCP) → istemci `POST …/print` (A5) → sunucu snapshot + bayrak + audit. Sunucunun kendi TCP gönderimi (A3) yalnız `label.nativeSendEnabled=true` **ve** `NETWORK_TCP` cihazda anlamlı; sahada ikisi de yok (§13).

### 2.b Kantar / metre / COM

| # | Adaptör | Yön | Tetikleyen | Timeout | Retry | Idempotency | Tx | Görünürlük | CPU | Kanıt |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | Backend'de seri/COM/BT kodu | **YOK** | — | — | — | — | — | — | — | `grep -rnEi "serialport\|\bCOM[0-9]" src --include='*.ts'` → 0 anlamlı vuruş (yalnız yorum `station.routes.ts:52`) |
| B2 | `DeviceTransport.read?()` (ağ-kantar/metre) | Tanımlı **ama uygulanmamış** — `tcpTransport` yalnız `test`/`write` döner | — | 5 s | — | — | — | — | — | `device-transport.ts:27-29,63-87` |
| B3 | `parseMeterReading` codec | Saf fonksiyon (mobil ikizi ile aynı) | — | — | — | — | — | — | — | `helpers/codec/meter.codec.ts:14-26`; **çağıranı yok** (`grep parseMeterReading src` → yalnız tanım) [VARSAYIM: ileride ağ-kantar için] |
| B4 | **Simülasyon sınırı — tartı kaydı** | Dışarıdan sunucuya | `weighSack` (`shipping.controller.ts:141-153` → `shipping.service.ts:886-967`) | — | — | Atomik claim `touchWarehouseSackTx WHERE shipmentId IS NULL` (`:951-956`) | tx içinde sack.update; audit dışında | `400` Türkçe mesaj (`:941-946`) | — | Üç sinyal: istemci beyanı `source: SCALE\|MANUAL\|SIMULATED` (`:35` zod) · sunucu `PeripheralDevice.simulate` çapraz kontrolü (oturumun makine/istasyon kantarı, `:926-940`) · bayrak `shipping.simulatedWeightEnabled` (`system-setting.service.ts:2253`); `MANUAL` muaf (bilinçli, `:912-917`); kolona **çözülmüş** kaynak yazılır (`:960-962`) |
| B5 | Cihaz kaydı `simulate` bayrağı | DB alanı | `PeripheralDevice.simulate` (`schema.prisma`); saha eşleme `setFieldAddress` gerçek MAC atanınca `simulate=false` yazar (`peripheral.service.ts:398-401`) | — | — | — | — | — | — | saha: 6 aktif cihazın **hiçbirinde** `simulate=true` (§13) |
| B6 | Fiziksel okuma istemcide | İstemci → cihaz | Electron `scale.ipc.ts:69` (`SerialPort`), `scanner.ipc.ts:125`; mobil HAL `btClassic.transport.ts` | istemci | istemci | — | — | — | — | Simülasyonun kalan yüzeyi: Electron'da kantar "yerel tercih" olabilir (DB kaydı yok) → backend yalnız beyana bakar (`shipping.service.ts:905-909`) |

### 2.c Yedek & DB kopyası

| # | Adaptör | Yön | Tetikleyen | Timeout | Retry | Idempotency | Tx | Görünürlük | CPU | Kanıt |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | **`pg_dump -Fc`** (gece/manuel yedek) | `spawn` child | `POST /api/admin/backup` (`admin:settings`, 202 fire-and-forget, `admin.routes.ts:1190-1208`, `backup.service.ts:393-413`) · `jobs/backup-scheduler.ts:104` | `runTool` varsayılan **3 saat**, `killSignal SIGKILL` (`pg-tool.helper.ts:53,105-110`) | YOK; scheduler kaçırılan günü telafi eder ama damga **işten önce** yazıldığı için başarısız gece **tekrar denenmez** (`backup-scheduler.ts:21-23,101-104`) | Süreç-içi `running` bayrağı (`backup.service.ts:162,178-366`) — ikinci istek "Zaten bir yedek işlemi sürüyor" (400) | tx yok (DB'ye dokunmaz); damga `SystemSetting backup.lastNightlyAt` upsert (`backup-scheduler.ts:52-62`) | Audit `BACKUP_COMPLETED/FAILED` (`backup.service.ts:190-196`), `lastResult` panelde, `/api/admin/health` `lastBackup` (yalnız `.dump` mtime) | Event-driven; stdout tüketilmez, stderr 64 KB kap (`pg-tool.helper.ts:113-115`) | Zincir: `.dump.part` → `pg_restore --list` doğrula → `rename` (atomik) → gün bazlı rotasyon (30 g, min 3) → `BACKUP_OFFSITE_DIR` `copyFile` (`backup.service.ts:227-338`) |
| C2 | **`pg_restore --list`** bütünlük doğrulama | `spawn` child | C1 içinden; `restore-impact` (`backup-impact.service.ts:495`); DB kopyası başı (`db-copy.service.ts:531`) | `Promise.race` **30 s** (`backup.service.ts:107,121-124`) — ama child'ın kendi üst sınırı 3 saat: yarış dolunca promise "unknown" döner, **child öldürülmez** | YOK; `"unknown"` önbelleğe alınmaz → her açılışta yeniden spawn (`:145-147`) | Önbellek anahtarı `yol\|boyut\|mtime` (`:106,110-116`) | tx yok | `verdict` panelde; timeout/PATH hatası "unknown" (bloklamaz, uyarır) | I/O | HOTSPOT H-4 |
| C3 | Saklama rotasyonu + bayat `.part` budama | FS | C1 içinde | — | — | — | — | Rotasyon hatası `warnings[]`e düşer, yedeği geçersiz kılmaz (`:317-321`) | `readdir`+`stat` async | `backup.service.ts:300-322,368-385` |
| C4 | **Offsite yerel kopya** (`copyFile`) | FS (UNC/NAS) | C1 içinde | FS çağrısı, süre sınırı YOK | — | — | — | Başarısızlık `warnings[]` (`:328-338`) | — | **Kaynak yalnız env** `process.env.BACKUP_OFFSITE_DIR` modül yükünde (`backup.service.ts:46,324`); panelin yazdığı `SystemSetting backup.offsiteDir` (`admin.routes.ts:1402-1432`, `system-setting.service.ts:3225`) **bu kopyayı ETKİLEMEZ** — `readOffsiteDir` yalnız GET/PATCH yanıtında okunuyor (`grep readOffsiteDir` → 4 vuruş, hepsi admin.routes/system-setting) → HOTSPOT H-5 |
| C5 | **`rclone copy`** offsite süpürme | `spawn` child → bulut | `jobs/offsite-sweeper.ts` saatlik (+90 s açılış) (`:31,37,98-101`); `POST /api/admin/backups/offsite/sweep` (`admin:settings`, `admin.routes.ts:1450-1462`) | copy **3 saat**, `lsf`/`lsd` **5 dk** (`offsite-backup.helper.ts:88-90`) | rclone'a `--retries 3` (`:207-208`); iş düzeyinde YOK | `--immutable --no-traverse --include <prefix>*.dump` (`:196-212`); yalnız EKLER, `sync/delete` yok (`:25-28`) | tx yok | `reportJobFailure` → `SystemLog SYSTEM/ERROR recordId JOB_FAILED:offsite-sweep` (`offsite-sweeper.ts:60-64`, `job-failure.ts:34-54`); `/api/admin/health` `offsite{…}` (`:269-288`); "hedef yok" yalnız `console.warn` (bilinçli, `offsite-sweeper.ts:53-59`) | — | Uzak ad `readOffsiteRemote()` → SystemSetting (panel, `z.string().trim().max(200)`, `admin.routes.ts:1391-1400`) → env; **allowlist/biçim doğrulaması YOK**, argüman olarak pozisyonel geçiyor (`:125,197-201`) → HOTSPOT H-6 |
| C6 | rclone Drive token yazımı | FS (`rclone.conf`) | `POST /api/admin/backups/offsite/authorize` (`admin:settings`+`admin:users`, `admin.routes.ts:1476-1497`) | — | — | Bölüm adı regex `^[A-Za-z0-9_-]{1,32}$` (`offsite-backup.helper.ts:339`); aynı bölüm **replace** | — | Token yanıtta/audit'te YOK (`:321-329`, route audit yalnız ad+yol) | — | Dosya `mode 0o600` (`:379`), konum `<BACKUP_DIR>/../rclone.conf` (`:70-75`) |
| C7 | rclone bağlantı testi (`lsd`) | `spawn` | `POST …/offsite/test` (`admin:settings`) | 5 dk | — | — | — | stderr 400 karaktere kırpılıp kullanıcıya (`:310-314`) | — | `:294-316` |
| C8 | **`CREATE DATABASE … TEMPLATE template0`** (geri yükleme kopyası) | `pg.Client` DDL (bakım DB'si `postgres`) | `POST /api/admin/db-copies` (`admin:settings`+`admin:users`, 202, `db-copy.routes.ts:77-95`) → `startCopyJob` (`db-copy.service.ts:368-432`) | Bağlantı 5 s; **`statement_timeout=0`** DDL için (`pg-admin-client.ts:31-32,77`; `db-copy.service.ts:543-575`) | YOK | **Atomik claim** `currentJob` senkron blokta (`:405-415`, "await yok" gerekçesi yazılı); ad `<canlı>_restore_<damga>` saniye çözünürlüklü (`backup-naming.helper.ts:152-154`) | tx yok (DDL) | Audit `DB_COPY_STARTED/COMPLETED/FAILED/VERIFIED` (`:509-655`); `SystemSetting dbRestore.copies` kaydı; `/api/admin/health` `restoreCopyCount/Bytes` | — | Guard'lar: `probeCapabilities` (superuser ∨ CREATEDB, fail-closed, `pg-admin-client.ts:100-132`) · disk guard `free < 1.2×canlı → blok` (`db-copy.service.ts:171-232,208`) · `MAX_IDENTIFIER_BYTES=63` (`:390-397`) · `isBackupRunning()` (`:379`) · dump `verifyBackupFile` "corrupt" → iş bitmez (`:531-535`) |
| C9 | **`pg_restore --exit-on-error`** kopyaya | `spawn` child | C8 zinciri (`:582-604`) | 3 saat | YOK; başarısızlıkta `DROP DATABASE IF EXISTS … WITH (FORCE)` temizliği (`:496-506,592-604`) | — | — | Audit + `message` (stderr 400 kar.) | — | `PG_RESTORE_JOBS` env ile `-j` (varsayılan 1, `:582`) |
| C10 | **`ALTER DATABASE <kopya> SET k=v`** GUC replay | `pg.Client` DDL | C8 zinciri (`:606-630`) | 0 | — | idempotent SET | — | Başarısızlık yalnız `console.error`, iş bloklanmaz (`:627-629`) — doğrulama `guc` kontrolü `fail` verir (`db-copy-verify.service.ts:161-180`) | — | Anahtar regex `^[A-Za-z_][A-Za-z0-9_.]*$` + `quoteLiteral` (`:617-620`) |
| C11 | Kopya **doğrulama** (locale/GUC/migration/satır sayıları/boyut) | `pg.Client` ×2 (bakım DB + kopyaya doğrudan) + Prisma havuzu | C8 zinciri (`:633`); `POST /api/admin/db-copies/:name/verify` (`db-copy.routes.ts:108-123` → `reverifyCopy`, `db-copy.service.ts:798-830`) | bakım 30 s; kopyada `SET statement_timeout=30000` (`db-copy-verify.service.ts:402`) | — | `reverifyCopy` yazımı süreç-içi kuyrukla serileşir (`:795-815`) | tx yok | Rapor JSON; audit `DB_COPY_VERIFIED` | 12 tabloda `count(*)` ×2 (kopya + canlı havuz) | **`reverifyCopy(name)` yol parametresini `isRestoreCopyName` allowlist'inden GEÇİRMİYOR** (drop/swap geçiriyor: `:665-676,739-746`) — yükseltilmiş kimlikle (`BACKUP_PG_USER`) verilen HERHANGİ bir DB adına bağlanıp sayar ve `dbRestore.copies` altına o adla kayıt yazar → HOTSPOT H-3. `readExpectedMigrations` istek yolunda **`readdirSync`** (`:311-320`) |
| C12 | **`DROP DATABASE`** (kopya silme) | `pg.Client` DDL | `DELETE /api/admin/db-copies/:name?force=1` (`db-copy.routes.ts:142-159`) | 0 | — | — | — | 409 + `blockedBy[]` (açık oturumlar) | — | Guard zinciri: allowlist `isRestoreCopyName` (damga şartı, `backup-naming.helper.ts:167-179`) → `name===live` ikinci savunma → koşan işin kopyası değil → ad **taze `pg_database`'den** (`$1` parametreli) → `force` yoksa açık bağlantı kontrolü → `WITH (FORCE)` (`db-copy.service.ts:665-736`) |
| C13 | **Takas komutu** üretimi | Yalnız metin (operatör PowerShell'de çalıştırır) | `GET /api/admin/db-copies/:name/swap-command` (`db-copy.routes.ts:177-205`) | — | — | Yalnız `state==="ready"` kopyaya (`db-copy.service.ts:752-767`) | — | Audit `DB_SWAP_COMMAND_ISSUED` (route, `:191-196`) | — | Blok: `pm2 stop` → ön kontrol → 2× `ALTER DATABASE … RENAME` (oto geri alma) → `prisma migrate deploy` → `pm2 start`; şifre yer tutucu `<veritabani-sifresi>` (`db-swap-command.helper.ts:80-175`) — **backend kendi DB'sini yeniden adlandırmaz** (gerekçe `:1-10`) |
| C14 | **Geri yükleme etki önizlemesi** | Prisma havuzu (18 `count`) | `GET /api/admin/backups/:name/restore-impact` (`admin:settings`+`admin:users`, `admin.routes.ts:1308-1345`) | Her sayım DB `statement_timeout`una tabi; `allSettled` benzeri (hata → `null`) | — | Süreç-içi `computing` bayrağı — ikinci eşzamanlı istek sayımları **atlar**, uyarı satırı döner (`backup-impact.service.ts:465,514-522`) | tx yok | Audit `BACKUP_RESTORE_PREVIEW`; `measuredAllRows=false` → "en az" dili | `MAX_CONCURRENCY=6` (`:352-370`); `auditRollup` `$queryRaw GROUP BY` (`:385-462`) | Guard'lar `restoreGuards` saf (`:105-152`); `pre-restore_` en-yeni karşılaştırmasından dışlanır (`:478-490`) |
| C15 | Yedek **indirme** | FS → HTTP akışı | `GET /api/admin/backups/:name/download` (`admin:settings`+`admin:users`) | — | — | — | — | Audit `BACKUP_DOWNLOAD`; aktarım ortasında hata → `headersSent` dalı soketi keser, sahte audit yok (`error.middleware.ts:250-265`) | `res.download` stream | Yol: `resolveBackupPath` — `basename` eşitliği + `.dump` + kök altı + `existsSync` (`backup.service.ts:491-500`) |
| C16 | Yedek listeleme / son yedek | FS | `GET /api/admin/backups`; `/api/admin/health.lastBackup` | — | — | — | — | — | `listBackups` async (`:452-489`); `latestBackupInfo` **sync `readdirSync`+`statSync`**, 30 s önbellek (`app.ts:197-222`) | Yalnız `.dump` uzantısı — `.part` her yüzeyde görünmez (bilinçli, `backup.service.ts:220-226`) |

**Scheduler beş sorusu (beceri §6) — K9 kapsamındaki iki iş:**

| İş | Dağıtık kilit | Damga yeri | Başarısızlık nereye | Saat dilimi | Child timeout |
|---|---|---|---|---|---|
| `backup-scheduler` | Süreç-içi `checking` + 3 s watchdog (`:37-43,64-78`); tek process varsayımı yazılı (`:8-11`) | **BAŞTA** (`:101-102`) — gerekçe "retry spam" yazılı; bedel: başarısız gece o gün tekrar denenmez (bilinçli) | `runBackupJob` kendi `BACKUP_FAILED` audit'i; dış hata `reportJobFailure` (`:110-114`) | `factoryDayStart` (`:95`) — süreç TZ'sine bağlı değil | 3 saat (`pg-tool`) |
| `offsite-sweeper` | Süreç-içi `running` (`:41-48`) | Damga YOK (idempotent `copy`) | `reportJobFailure` yalnız `configured && !ok` (`:60-64`); yapılandırma yoksa `console.warn` | saatlik `setInterval` (TZ'siz, sorun değil) | copy 3 saat / lsf 5 dk |

Sahada `BACKUP_SCHEDULE_ENABLED="false"` (ecosystem) → gece yedeğini Windows Görev Zamanlayıcı (`yedekle.ps1`) alır; **ama** prod kopyasında `backup.lastNightlyAt=2026-08-25T00:05Z` ve `BACKUP_COMPLETED trigger=nightly` 1 satır var (§13) → scheduler sahada en az bir kez koşmuş [VARSAYIM: env bir dönem açık kalmış ya da ecosystem repo kopyası ile saha kopyası ayrışık] → ② ops ajanına not.

### 2.d Mobil güncelleme + Electron feed

| # | Adaptör | Yön | Tetikleyen | Timeout | Retry | Idempotency | Tx | Görünürlük | CPU | Kanıt |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | **OTA manifest (LAN ikizi)** — donmuş, imzalı manifest servis | Dışarıdan sunucuya, **PUBLIC** (JWT yok) | `GET /api/mobile/updates/ota/:runtimeVersion/manifest` (`mobile-update.routes.ts:44-57`) | — | — | Salt okuma | — | 400/404 `AppError`; başlıklar sözleşme (`expo-protocol-version`, boundary `tekserpota`, `no-cache`) | **`fs.readFileSync`** (`:56`, KB'lık dosya) | `runtimeVersion` regex `^[A-Za-z0-9._-]+$` (`mobile-update.service.ts:102-108`); sunucu manifest **üretmez** (imza ham bayt üzerinden, `:8-12`) |
| D2 | OTA varlık / APK / `surum.json` | PUBLIC | `GET /api/mobile/updates/{*yol}` (`:69-83`) | — | — | — | — | 404; `cache-control` damgalıya 1 yıl immutable, künye/manifeste no-cache | `res.sendFile` stream | Yol traversal guard: `path.resolve` sonrası kök altı kontrolü (`mobile-update.service.ts:66-76`); dizin isteği 404, listeleme yok (`:93`) |
| D3 | Depo durumu (panel) | `admin:settings` | `GET /api/mobile/updates-state` (`:93-100`) | — | — | — | — | JSON | `existsSync`+`readdir` | Depo kökü `MOBILE_UPDATE_DIR` ∨ `<cwd>/../mobil-guncelleme` (`config/mobile-update.ts:32-34`) — `app\` dışında (deploy silmesin) |
| D4 | **Asıl kanal: VPS nginx** (`guncelleme.etkiliyazilim.com/<müşteri>/mobil/`) | İstemci → internet; **backend dahil değil** | tablet `expo-updates` | — | istemci | Manifest yayın anında dondurulur, imzalı | — | nginx `always` kuralları / 404 önbellek dersi (`deploy/guncelleme-sunucusu/nginx/default.conf`) | — | `mobil/scripts/lib/feed.cjs` tek kaynak; müşteri kodu `musteri.json` regex `^[a-z0-9-]{2,32}$` |
| D5 | **Electron otomatik güncelleme** (`electron-updater` generic) | İstemci → internet; backend dahil değil | Electron `updater.ipc.ts:112,127` (`setFeedURL`, `checkForUpdates`) | — | electron-updater | `latest.yml` sürüm karşılaştırması | — | Şerit + zorunlu güncelleme (bellek notu) | — | Adres `Electron/shared/update-feed.ts:24,56`; makineye özel ezme anahtarı `:67`; backend'de yalnız `client-policy` ucu (`/api/client-policy/:istemci`, KUNYE) |

### 2.e Keşif (mDNS + kimlik)

| # | Adaptör | Yön | Tetikleyen | Timeout | Retry | Idempotency | Tx | Görünürlük | CPU | Kanıt |
|---|---|---|---|---|---|---|---|---|---|---|
| E1 | **mDNS ilanı** `_teks-erp._tcp` + TXT | Sunucu → LAN multicast (UDP 5353) | `server.ts:124` boot; env `DISCOVERY_MDNS_ENABLED!=="false"` | Kimlik bekleme 10 s (`mdns-advertiser.job.ts:43`); durdurma tavanı 1 s (`:46,236-265`) | YOK; her arıza `active:false` (fail-open, `:8-23`) | Servis adı hostname(+port) (`:147-148`) | — | Durum yalnız `/api/admin/health.discovery.mdns` (`app.ts:456-462`) + `console.warn` | — | Tembel `require("bonjour-service")` (`:88-92`); bind hatası errorCallback ile yutulur (`:151-162`, load-bearing) |
| E2 | **Kimlik ucu** | PUBLIC, DB'siz, senkron | `GET /api/discovery/identity` (`discovery.routes.ts:34-36`) | — | — | — | — | — | Bellek | Firma adı önbelleği yalnız **boot'ta** `refreshDiscoveryCache` (`server.ts:121`; `discovery.service.ts:85-98`) — panelden ad değişince restart'a kadar bayat (bilinçli, `:82-83`); rate limiter YOK (`:9-11` yorumu) |
| E3 | **Kurulum kimliği** | DB (`SystemSetting system.installationId`) | boot job, 3 s + 4×15 s deneme (`installation-identity.job.ts:35-39,187-213`) | — | 5 deneme | `upsert` (`:141-149`) — yorum "create → P2002 yarışı" der ama kod **upsert** (`:78-81` ↔ `:141`) — tek process'te etkisiz | tx yok | Audit `INSTALLATION_ID_CREATED/REGENERATED` | — | Bozuk değer → yeniden üretim + audit (`:92-107`) |
| E4 | LAN adres listesi | `os.networkInterfaces()` | boot banner + mDNS | — | — | — | — | — | — | `lan-addresses.ts:28-41` |

### 2.f İçe aktarım (17 adaptör)

| # | Adaptör | Yön | Tetikleyen | Timeout | Retry | Idempotency | Tx | Görünürlük | CPU | Kanıt |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | **Önizleme** (kuru koşum) | Dışarıdan sunucuya (JSON hücreler) | `POST /api/import/:entity/preview` (`data:import` + varlık write, `import.routes.ts:237-257`) | HTTP zaman aşımı yok | — | — | Yazmaz | JSON satır raporu | `prepareRows`: satır başına `validateRow` (lookup'lar istek-içi önbellekli, `import-lookup.ts:77-84`), `findExisting` tek sorgu (`import.service.ts:239`) | Tavan `MAX_IMPORT_ROWS=10000` (`import-coerce.ts:127-135`) |
| F2 | **Uygulama** | Dışarıdan sunucuya | `POST /api/import/:entity/apply` (`:274-294`) | HTTP zaman aşımı yok; satır başına servis çağrısı (kendi tx'i + audit'i) **sıralı** | YOK | `options.clientToken` `@unique` (`ImportRun.clientToken`) — yalnız **tamamlanmış** koşum için (`import.service.ts:447-475`); koşum satırı **döngüden SONRA** yazılır (`:552-575`) → uçuştaki tekrar korunmaz (HOTSPOT H-2) | **Tek tx YOK** (bilinçli, `:12-24` gerekçe: servisler global `prisma` ile çalışır) — satır satır `adapter.createOne/updateOne` → mevcut servis (`item.adapter.ts:143-158`) | Kısmi sonuç **sessiz değil**: `status PARTIAL/FAILED` + `stoppedAtRowNo` (`:508-545`); `ImportRun` + `IMPORT_RUN` audit + `logMany` satır izi (`importRunId`) | Aynı | Kısmi-başarı tablosu §8.2 |
| F3 | Dışa aktarım (round-trip) | Sunucudan JSON | `GET /api/import/:entity/export?limit=` (yalnız READ izni, `:309-326`) | — | — | — | — | — | Adaptör **tümünü** üretir, kesme JS'te (`import.service.ts:685-710`; yorum: en büyük varlık 194 satır / 28 KB) | `order.adapter` export **boş döner** (bilinçli, `order.adapter.ts:320-325`) |
| F4 | **Yapılandırma paketi** (etiket/kart/belge/rol şablonları) | JSON zarf | `GET /api/config-bundle/export`, `POST …/preview`, `POST …/apply` (`config-bundle.routes.ts:106-169`) | — | — | Anahtar = ad; `onConflict rename\|overwrite\|skip`; `LABEL_TEMPLATE` overwrite desteklenmez → rename gibi davranır, mesajla (`config-bundle.service.ts:305-320`) | Satır satır servis çağrısı; hata `row.action=ERROR` + `failed++`, devam eder (`:272-303`) | Audit `CONFIG_BUNDLE_IMPORT`; plan yanıtta | — | Guard anahtar-kapsamlı + kaba `requireAnyPermission` (`config-bundle.routes.ts:29-59`); sanitize etiket/kart servislerinde (`:20-22`) |
| F5 | Gövde limiti | — | `jsonBig = express.json({limit:"10mb"})` router'da (`import.routes.ts:28`; `config-bundle.routes.ts:27`) | — | — | — | — | — | — | **Etkisiz**: global `express.json({limit:"1mb"})` `app.ts:141` route'lardan önce koşuyor; sonda 1,98 MB → 413 (§0) → HOTSPOT H-1 |

### 2.g Dışa aktarım (raporlar)

| # | Adaptör | Yön | Tetikleyen | Bellek sınırı | Kanıt |
|---|---|---|---|---|---|
| G1 | **Muhasebe "Sevk Edilenler"** veri seti (JSON; Excel istemcide `exceljs`) | Sunucudan JSON | reports/sales route (`buildDispatchAccountingExport(req)`) | Önce ucuz `count` ×2; `MAX_SHIPMENTS=2000`, `MAX_IDS=200`, aralık verilmezse son 90 gün, en fazla 366 gün (`accounting-export.service.ts:42-50,234-239`) | Tek nested `findMany` + `rollReturn` brüt geri-ekleme + JS toplama (`:241-575`); `Prisma.Decimal` `.plus()` |
| G2 | Mükerrer aday **CSV** | Sunucudan `text/csv` | `GET /api/master-data/duplicates/candidates.csv` (`master-data:merge`, `master-data-merge.routes.ts:262-281`) | Tam tarama sonucu string'e (`duplicate-detection.service.ts:533+`); sınır YOK (varlık boyutuna bağlı — canlıda ana veri küçük) | `;` + BOM, `Content-Disposition attachment` |
| G3 | Import round-trip export | JSON | F3 | tüm tablo bellekte | `import.service.ts:685-710` |

### 2.h Swagger / statik / sağlık

| # | Yüzey | Kim erişir | Kanıt |
|---|---|---|---|
| H1 | `/api-docs` (swagger-ui) | Yalnız `NODE_ENV !== "production"` — ecosystem prod'da `NODE_ENV: "production"` **ve** `APP_ENV: "production"` (morgan `APP_ENV ?? NODE_ENV` okur, swagger yalnız `NODE_ENV`) | `config/swagger.ts:66-71`; `app.ts:126-128`; spec boşsa `console.warn` (`swagger.ts:57-64`); bekçi `scripts/test_swagger_spec.ts` (`failOnErrors`) |
| H2 | `express.static(<cwd>/public)` — `index.html`, `logo.png`, `status.js` | Kimliksiz herkes; `resolveDevice`'tan **önce** (DB sorgusu bindirmesin, `app.ts:160-169`) | `app.ts:157-158`; `public/index.html:87` prod'da 404 verecek `/api-docs` bağlantısı taşır (kozmetik) |
| H3 | `GET /health` | PUBLIC, 5 alan dondurulmuş, `SELECT 1` | `app.ts:466-491` |
| H4 | `GET /api/admin/health` | `admin:settings` — DB boyutu, havuz, disk (`statfsSync` 30 s önbellek, `disk-metrics.ts:37`), presence, audit sağlığı, offsite, mDNS, kaynak metrikleri | `app.ts:340-466,561-569` |
| H5 | CORS | `cors()` **origin `*`** varsayılanı + `exposedHeaders` | `app.ts:114`; `helmet` CSP `upgradeInsecureRequests:null`, HSTS kapalı (HTTP-only LAN, `:96-110`) |

### 2.i request-context (AsyncLocalStorage)

| Konu | Durum | Kanıt |
|---|---|---|
| Ne taşır | `req` nesnesinin **kendisi** (kopya değil — `req.user`/`req.device` sonra dolar) + istek başına bir `requestId` (uuid) | `lib/request-context.ts:16-19,36-41` |
| Kim okur | Yalnız `AuditService.log/logMany/logEvent` → `currentOrigin()` (`ipAddress`, `deviceId`, `machineId`, `userId`, `requestId`) | `audit.service.ts:11,72,135,177`; `request-context.ts:55-69` |
| Nerede kurulur | `app.ts:175` — `resolveDevice`'tan **sonra**, tüm API route'larından **önce**; statik/health/swagger dışında | `app.ts:158-175` |
| Job / script / boot bağlamı | Bağlam **yok** → tüm alanlar `null`, kayıt yine yazılır (bilinçli, `:21-22,56-58`). Job'lar (`backup-scheduler`, `offsite-sweeper`, `installation-identity`, `archive`, catalog reconcilers) ve `server.ts` STARTUP/UNHANDLED audit'leri `ipAddress/deviceId/requestId` **null** yazar | `job-failure.ts:43-53`; `server.ts:127-137` |
| `req.ip` | `trust proxy` **ayarlı değil** (`grep "trust proxy" src/app.ts` → 0) → doğrudan soket adresi; LAN'da proxy yok, doğru | `app.ts` |
| Doluluk (ölçüm) | Prod kopyası son 30 gün DOMAIN: 8.997 satırın 121'inde `ipAddress`, 104'ünde `deviceId`, 121'inde `requestId` (özellik 2026-08-19'da geldi, saha deploy'u sonrası satırlar dolu); dev: 146.388 / 318 / 15 / 268 | §13 |
| Fire-and-forget yollar | `void runBackupJob(...)` (`backup.service.ts:408`), `void runCopyJob(...)` (`db-copy.service.ts:431`): iş HTTP isteğinin ALS bağlamında **başlar**; yanıt dönse de ALS zinciri korunur → o işin audit satırları tetikleyen isteğin `requestId/ip`'sini taşır [VARSAYIM — ALS `run` kapsamı promise zinciriyle devam eder; ölçülmedi] | — |

## 3. (a) Etiket baskı — ayrıntı ve kapı zinciri

1. **Dil/şablon/cihaz çözümü** tek kaynak `resolveLabelRouting` (`label-routing.resolver.ts:75-159`): cihaz seçimi explicit `peripheralId` > tablete bağlı `deviceId` > makine `machineId`; dil `languageOverride` > format; şablon explicit > müşteri rotası > cihaz rotası > bağlam varsayılanı; `rasterMode`, `peripheralAddress/Port` cihazdan.
2. **Render kayıt defteri** `RENDERERS: Partial<Record<PrinterLanguage, Renderer>>` (`label-renderer.registry.ts:59-72`) — bilinmeyen dil **`RASTER_HTML` failsafe'e düşer** (`:87`, fail-open sınıfı; OCP ölçümü ② mimari ajanına, bkz. SINIR ÖTESİ). Öncelik: rawCode > kanvas (raster deneme → komut) > akış-modeli.
3. **Bayt sözleşmesi**: `renderedBytes()` tek geçit (`:162-164`); metin `latin1`, raster ham `Buffer`; HTTP'de `?encoding=b64` → base64 JSON (`label.controller.ts:258-283`); eski istemciye ham text (ikon GW bloğu atlanır).
4. **Sunucu TCP gönderimi** yalnız A3 uçlarında; `dispatchOrGuard` HTML dilinde hiç göndermez (`label.service.ts:951-972`).
5. **Kopya sayısı** `clampRollCopies` (`:127`), `label.copies` ayarı (`system-setting.service.ts:3381`); önizleme her zaman 1 kopya (`:906-915`).
6. **Baskı izi** üç ayrı sözleşme (A5/A6/A7): top → 3 yazım tx'siz; çuval → `updateMany`; kart → tx + `printed_documents` upsert. Saha audit dağılımı: `LABEL_PRINT_EVENT` dil `RASTER_HTML` 2.517 / `PPLB` 37 / null 3 — 2026-08-19 öncesi "makinesiz → sistem varsayılanı" hatasının izi (`label.controller.ts:515-527` yorumu; düzeltme sahaya 2.9.0 ile gitti [VARSAYIM]).
7. **Fire kapısı**: `confirmScrap` sorgu/gövde parametresi baskı yolunda (`label.controller.ts:203,262,344`) — fire topa etiket basmak onay ister (K7 alanı).

## 4. (b) Kantar / COM — simülasyonun sınırı (özet)

- Backend **hiç seri/COM/BT konuşmaz**; tek donanım kanalı A3'teki RAW TCP ve o da yazıcı içindir. "Ağ kantar/metre" için `DeviceTransport.read?` arayüzü ve `parseMeterReading` codec'i hazır ama **uygulanmamış/çağrılmıyor** (`device-transport.ts:27-29`, `meter.codec.ts`).
- Simülasyon **istemcide** üretilir (Electron/mobil HAL); sunucunun gördüğü tek şey `PeripheralDevice.simulate` bayrağı + `weighSack` beyanı. Kayıt reddi yalnız `weighSack`'te ve yalnız `shipping.simulatedWeightEnabled=false` iken (`shipping.service.ts:924-946`). Metre (uzunluk) okumasında sunucu tarafı simülasyon guard'ı **yok** (`grep simulate` → yalnız peripheral/shipping) [VARSAYIM: KK1 metrajı istemcide ölçülüp düz sayı olarak gelir; K3/K4 alanı].
- Sahada `simulate=true` cihaz yok; kantar 1 (BT), metre 2 (BT).

## 5. (c) Yedek & DB kopyası — guard/eşzamanlılık matrisi

| Soru | Cevap | Kanıt |
|---|---|---|
| Kullanıcı girdisi shell'e gidiyor mu | HAYIR — `spawn(file, args[])`, shell yok; şifre yalnız `PGPASSWORD` env (`pg-tool.helper.ts:62-63,80,107`) | `:98-138` |
| Argüman kaynağı | `pg_dump/pg_restore`: `DATABASE_URL`'den `pgToolArgs` + üretilen yol; `rclone`: `BACKUP_DIR` + **SystemSetting `backup.offsiteRemote`** (admin girdisi, `max(200)`) + env `BACKUP_RCLONE_BIN/CONFIG` | `pg-conn.helper.ts:93-95`; `offsite-backup.helper.ts:125,197-212` |
| DDL identifier kaçırma | `quoteIdent` (`"` ikileme) + çağıranın allowlist'i; kopya adı **sunucu üretir** (`restoreDbName`), kullanıcıdan gelen ad yalnız drop/verify/swap'ta ve drop/swap allowlist'li | `pg-conn.helper.ts:97-105`; `db-copy.service.ts:386,665-676,739-746` |
| Prod DB adı koruması | Silme: allowlist `<canlı>_restore_<damga>` + `name===live` reddi; `_old_` DB'lerinin DELETE ucu **yok** (bilinçli geri dönüş noktası) | `backup-naming.helper.ts:136-139,176-183`; `db-copy.service.ts:677-680` |
| Disk guard | `free < 1.2 × canlı boyut` → blok; `< 2×` uyarı; ölçüm yolu `PGDATA_DIR` env > tablespace dizini > `SHOW data_directory` > cwd (`volumeKnown=false` uyarısı) | `db-copy.service.ts:171-262` |
| Eşzamanlı iki yedek | `running` bayrağı → ikinci 400 | `backup.service.ts:162,203-213` |
| Eşzamanlı iki kopya | `currentJob` senkron claim (await öncesi) → ikinci 400 | `db-copy.service.ts:405-415` (A2 denetim izi yorumda) |
| Yedek ↔ kopya çapraz | Kopya başlarken `isBackupRunning()` kontrol eder; **tersi bilinçli yok** (gece yedeği kopya yüzünden düşmesin) | `:376-383` |
| Verify eşzamanlılığı | `reverifyCopy` sınırsız paralel; yalnız kayıt yazımı kuyruklu | `:795-830` |
| restore-impact eşzamanlılığı | `computing` bayrağı: ikinci istek sayımsız (uyarılı) döner | `backup-impact.service.ts:465,514-522` |
| Havuz | Bakım bağlantısı **havuzsuz** kısa ömürlü `Client`, `finally end()` — takas rename'ini düşürmesin | `pg-admin-client.ts:9-12,59-83` |
| Yükseltilmiş kimlik | `BACKUP_PG_USER/PASSWORD` çifti (opsiyonel); override varsa URL şifresi kullanılmaz (load-bearing) | `pg-conn.helper.ts:27-55` |

## 6. (d) Mobil güncelleme + Electron feed — sunucu rolü

Backend'in rolü **LAN ikizi** (internetsiz kurulum) ile sınırlı; asıl kanal VPS nginx. Backend uçları PUBLIC (tablet giriş öncesi sorar); path traversal guard `mobile-update.service.ts:66-76`; `manifest` `readFileSync` (küçük dosya). Electron feed'i backend'den bağımsız (`update-feed.ts`). Sürüm politikası ayrı eksen: `GET /api/client-policy/:istemci` (`client-version-policy.ts`, bekçi `test_client_policy.ts`) — okunmadı, KUNYE'ye göre.

## 7. (e) Keşif — sunucu rolü

`server.ts:117-124`: kimlik job'u → keşif önbelleği → mDNS ilanı; hepsi best-effort. Kimlik ucu rate-limit'siz ve DB'siz (bilinçli); TXT kaydı 400 bayt bütçesine kırpılır (`discovery-txt.ts:33,71-77`). Graceful shutdown'da `stopMdnsAdvertiser` 1 s kapı + 2 s ortak tavan (`server.ts:161-164`).

## 8. (f) İçe aktarım — sözleşme, kısmi başarı, mükerrer yükleme

### 8.1 Parse & sınırlar

| Soru | Cevap | Kanıt |
|---|---|---|
| CSV/XLSX kütüphanesi | Backend'de **yok** (bilinçli); panel `Electron/src/lib/import/parse.ts` ayrıştırır, hücreler `Record<string,string>` gelir | `import.types.ts:12-14`; `import.routes.ts:66-71` |
| Satır tavanı | 10.000 (`assertRowLimit`, preview+apply) | `import-coerce.ts:127-135`; `import.service.ts:424,443` |
| Gövde tavanı | Niyet 10 MB (`jsonBig`), **fiili 1 MB** (global parser önce koşuyor; sonda 413) | `app.ts:141`; `import.routes.ts:28,242,279`; §0 sonda |
| İstemci parçalama | YOK — `importService.apply(entity, rows, options)` tek POST | `Electron/src/services/importService.ts:180-186` |
| Tip dönüşümü | Sunucuda tek yerde (`coerceCell`: TR/EN sayı, `NULL` literal = temizle, boş = dokunma, tarih fabrika günü) | `import.service.ts:56-104`; `import-coerce.ts:16-116` |
| Referans çözümü | KOD birincil (insensitive), AD ikincil tekil+uyarılı, pasif → hata, çoklu → hata; istek-içi önbellek | `import-lookup.ts:66-151` |
| Ad mükerrer ön kontrolü | Adaptör `nameGuard` beyan ederse önizlemede; beyan yoksa **koşmaz (fail-open)** | `import-name-guard.ts:16-25`; `import.service.ts:344-349` |
| "Kod değil ad" tuzağı | Anahtar sütun her adaptörde `code` (item/route/…), `order`'da `ref` (bizde saklanmaz → her grup CREATE) | `import.types.ts:238`; `order.adapter.ts:159-163` |

### 8.2 Kısmi-başarı semantiği tablosu

| Senaryo | Doğrulama | Yazma | HTTP | `ImportRun` satırı | Audit | Kanıt |
|---|---|---|---|---|---|---|
| Hatalı satır var, `onError=abort` (varsayılan) | ERROR satırları | **Hiçbir şey yazılmaz** | 400 `IMPORT_VALIDATION_FAILED` + satır raporu | **YAZILMAZ** (throw `importRun.create`'ten önce) | YOK | `import.service.ts:486-491` |
| Hatalı satır var, `onError=skip` | ERROR atlanır | Geçerliler yazılır | 200 | `status=PARTIAL` (`failed>0`) | `IMPORT_RUN` + satır `logMany` | `:485,508-511,548` |
| Yazma sırasında beklenmedik hata (satır k) | geçmişti | k'ya kadar **KALIR** (rollback yok), k'da **durur** | 200 | `PARTIAL` (öncesinde yazım varsa) / `FAILED`; `stoppedAtRowNo=k` | `IMPORT_RUN` + `logMany` (yalnız başarılılar) | `:532-545` |
| SKIP (diff boş) | — | yazılmaz | 200 | `skipped++` | — | `:512-515` |
| Gruplu adaptör (rota/sipariş) | Grup = tek birim; çocuklar REPLACE | `steps: { deleteMany, create }` | — | — | — | `route.adapter.ts:289-299`; `import.service.ts:156-201` |

### 8.3 "Aynı dosya iki kez yüklenirse"

| Durum | Sonuç | Kanıt |
|---|---|---|
| Aynı `clientToken`, ilk koşum **bitmiş** | Yeni yazım yok; önceki sonuç döner | `import.service.ts:447-475` (`ImportRun.clientToken @unique`) |
| Aynı `clientToken`, ilk koşum **sürüyor** (timeout-retry) | `findUnique` boş → **ikinci koşum da başlar**; kilit/bayrak yok; koşum satırı sonda yazılır → ikisi de yazar (ikincisi `importRun.create`'te P2002'ye çarpar, ama yazımlar o zamana kadar bitmiştir) | `:447-448,552-575` → HOTSPOT H-2 |
| Token yok, ana veri (`upsert` modu) | Doğal anahtar `code` → ikinci geçiş UPDATE/SKIP (idempotent) | `:242-300` |
| Token yok, `createOnly` | Eşleşen satırlar ERROR | `:250-256` |
| Token yok, **sipariş** | Referans saklanmadığı için **ikinci sipariş açılır**; yalnız 90 gün/aynı toplam metraj UYARISI (engellemez) | `order.adapter.ts:7-16,251-281` |
| Dosya hash'i | Tutulmuyor (`fileName` yalnız görüntü) | `ImportRun` şeması |

### 8.4 Gövde limiti sondası (kanıt)

```
scratchpad/json-limit-probe.cjs  (Teks-Erp/node_modules/express, app.ts sırası birebir)
body bytes: 1976688 status: 413 resp: {"err":"entity.too.large"}
```
`app.ts:546-549` yorumu ("Bu router KENDİ express.json({limit:"10mb"}) katmanını taşır … global 1 MB limiti DEĞİŞMEZ") niyeti anlatıyor; Express'te ilk kayıtlı `json()` gövdeyi okuyup 413 üretir, router parser'ına hiç sıra gelmez. Bekçiler (`test_import_framework.ts`, `test_import_permissions.ts`) gövde boyutunu ölçmüyor (grep `1mb|10mb|413` → 0). Aynı desen `config-bundle.routes.ts:27`.

## 9. (g) Dışa aktarım — bellek

G1 sınırlı (count-first, 2000 sevk); G2 ve G3 sınırsız ama küçük tablolar. `res.json` Decimal→number `installDecimalNumberSerializer` (`app.ts:25`). Akış (stream) kullanan tek uç yedek indirme (`res.download`).

## 10. (h) Swagger / statik — özet

Prod'da swagger kapalı (`NODE_ENV=production`), `public/` kimliksiz statik (tasarım), `/health` dondurulmuş 5 alan, zengin sağlık `admin:settings`. CORS `*`.

## 11. (i) request-context — özet

§2.i. Job'larda boş (bilinçli). Tek tüketici audit. ALS `req` referansı tutar; istek bittikten sonra devam eden `void` işler (yedek, kopya) bağlamı taşımaya devam eder [VARSAYIM].

## 12. Shell / DDL / dosya sistemi dokunan noktalar (G-güvenlik ve I-gözlemlenebilirlik için)

| # | Tür | Yer | Girdi kaynağı | Koruma |
|---|---|---|---|---|
| S1 | `spawn` (tek kapı) | `helpers/pg-tool.helper.ts:105-110` | `file`: `pgTool()` = `PG_BIN_DIR` env + sabit ad; `rclone`: `BACKUP_RCLONE_BIN` env | `windowsHide`, `timeout`+`SIGKILL`, stderr/stdout 64 KB, şifre env |
| S2 | `pg_dump` argümanları | `backup.service.ts:246-250` | `DATABASE_URL` (+`BACKUP_PG_USER`), üretilen `.part` yolu | sabit |
| S3 | `pg_restore --list` | `backup.service.ts:122`; dolaylı `backup-impact.service.ts:495`, `db-copy.service.ts:531` | `resolveBackupPath(name)` ile doğrulanmış yol | basename+uzantı+kök |
| S4 | `pg_restore -d <kopya>` | `db-copy.service.ts:583-591` | kopya adı sunucu üretir | — |
| S5 | `rclone copy/lsf/lsd` | `offsite-backup.helper.ts:125,197-212,297` | `BACKUP_DIR` env, **`backup.offsiteRemote` (admin, doğrulamasız)**, `--config` yolu | H-6 |
| S6 | `CREATE DATABASE` | `db-copy.service.ts:300-345` (çağrı `:566-572`) | ad sunucu; locale/owner canlıdan `quoteLiteral/quoteIdent` | `statement_timeout=0` |
| S7 | `ALTER DATABASE … SET` | `db-copy.service.ts:606-630` | GUC anahtar/değer canlı DB'den | regex + literal kaçırma |
| S8 | `DROP DATABASE [IF EXISTS] … [WITH (FORCE)]` | `db-copy.service.ts:500,716` | temizlik: sunucu adı; silme: **taze `pg_database`'den** | allowlist + damga |
| S9 | `SET statement_timeout` (bakım) | `pg-admin-client.ts:77` | `Number(timeout)` | — |
| S10 | Takas komut metni (`ALTER DATABASE … RENAME`, `pg_terminate_backend`, `pm2`, `npx prisma migrate deploy`) | `db-swap-command.helper.ts:80-175` | sunucu bilgisi; **backend çalıştırmaz** | PS tek tırnak + SQL ident kaçırma |
| S11 | `$queryRawUnsafe` count | `db-copy-verify.service.ts:328-346,462-470` | sabit `COUNTED_TABLES` | tırnaklı |
| S12 | FS yedek dizini (mkdir/readdir/stat/rm/rename/copyFile) | `backup.service.ts:227-338,368-385,452-500`; `app.ts:197-222` (sync, 30 s önbellek) | `BACKUP_DIR` env | `.dump` süzgeci |
| S13 | FS `rclone.conf` yazımı | `offsite-backup.helper.ts:331-384` | admin token JSON + ad | regex ad, `0o600`, JSON doğrulama, yedek dizini dışı |
| S14 | FS mobil depo okuma | `mobile-update.service.ts:66-99,121-152`; `routes:56` (`readFileSync`) | **kimliksiz** URL yolu | `path.resolve` kök altı; dizin 404 |
| S15 | FS `public/` statik | `app.ts:157-158` | kimliksiz | `express.static` varsayılanı (dotfiles ignore) |
| S16 | FS `assets/fonts` | `raster-font.ts:34-37` | sabit | bir kez, önbellek |
| S17 | FS `prisma/migrations` `readdirSync` | `db-copy-verify.service.ts:311-320` | sabit | istek yolunda sync (küçük dizin, ~196 giriş) |
| S18 | FS `package.json` | `app-version.ts:14-22` | modül yükü | — |
| S19 | `fs.statfsSync` | `disk-metrics.ts:37` | cwd / PGDATA | 30 s önbellek |
| S20 | `res.download` yedek | `admin.routes.ts:1278` | `resolveBackupPath` | audit |
| S21 | TCP soket (yazıcı) | `device-transport.ts:41-59,71-84` | `PeripheralDevice.address/port` (station:write) ya da `testNativeSchema.printerIp` (`label:print`∨`station:write`) | bayrak `label.nativeSendEnabled`, 5 s |
| S22 | UDP mDNS | `mdns-advertiser.job.ts:151-170` | hostname, firma adı (kırpılmış) | fail-open |

## 13. DB ölçümleri (salt-okunur)

Prod kopyası `tekserp_saha_0825` (2026-08-25):

| Sorgu | Sonuç |
|---|---|
| `system_settings` yedek/etiket anahtarları | `backup.lastNightlyAt = 2026-08-25T00:05:07Z`; `label.mobileRasterEnabled = false`; `label.nativeSendEnabled = false`; `backup.offsiteRemote`, `backup.offsiteDir`, `dbRestore.copies`, `system.installationId` **yok** (kopya 2026-08-26 özelliklerinden önce) |
| SYSTEM audit (entegrasyon) | `STARTUP` 59 (07-16→08-25) · `ERROR` 15 (08-05/06, hepsi `TypeError` `/api/traveler-cards/:id/print-event`) · `BACKUP_TRIGGER` 9 · `BACKUP_COMPLETED` 8 (**manual 7, nightly 1**) · `BACKUP_DOWNLOAD` 1 · `BACKUP_RESTORE_PREVIEW` 1 · `DB_COPY_*`/`DB_SWAP_*`/`OFFSITE_*`/`IMPORT_RUN`/`PERIPHERAL_TEST`/`CONFIG_BUNDLE_IMPORT` **0** · `JOB_FAILED:*` **0** |
| `peripheral_devices` (silinmemiş) | LABEL_PRINTER BT-SPP ×2 (PPLB, adresli) · LABEL_PRINTER USB ×1 (PPLB) · LABEL_PRINTER USB ×1 (PPLB, **rasterMode=true**) · SCALE BT ×1 · METER BT ×2; **NETWORK_TCP 0**; `simulate=true` 0 |
| Etiket baskı izi | `LABEL_PRINT_EVENT` dil: `RASTER_HTML` 2.517 · `PPLB` 37 · null 3; `LABEL_TEMPLATE` 94, `LABEL_TEMPLATE_VARIANT` 90 |
| `import_runs` | tablo var, **0 satır** (özellik sahada hiç kullanılmamış) |
| Audit origin doluluğu (son 30 g, DOMAIN) | 8.997 satır → `ipAddress` 121, `deviceId` 104, `requestId` 121 |

Dev `adnansahin_db`: `import_runs` → `color` APPLIED 233 / PARTIAL 50 / FAILED 14 (bekçi kalıntısı); audit origin 146.388 → 318 / 15 / 268.

## 14. Bekçi haritası (② için "neyi ölçüyor")

| Alan | Bekçi | Gerçek mi / sahte mi | Not |
|---|---|---|---|
| pg_dump zinciri | `scripts/test_backup.ts` (605 s.) | **Gerçek** `pg_dump` (yoksa atlar, `:35-43`) | kesim/ad çözümleme saf bölüm |
| DB kopyası | `test_db_copy.ts` (413) | Gerçek pg araçları, `TEST_DB_COPY=1` kapılı (`:392-396`) | varsayılan koşumda **atlanır** |
| Kopya çift başlatma | `test_db_copy_single_start.ts` (104) | `deps` kancasıyla **sahte** run/list (`:10`) | claim sırasını ölçer |
| rclone | `test_offsite_sweep.ts` (336) | **Sahte rclone** kabuk script'i (`:7-9`); `copy` var / `sync` yok metin kontrolü (`:73-76`) | argüman enjeksiyonu (H-6) ölçülmüyor |
| Yazıcı TCP | `test_printer_transport.ts`, `test_device_transport.ts` | Localhost `net.createServer` mock | timeout dalı? (okunmadı) |
| Mobil OTA | `test_mobile_update.ts` (321) | Gerçek Express `app.listen(0)` + geçici depo | manifest boundary §9 |
| mDNS | `test_discovery_advertiser.ts` (286) | `loader` DI ile sahte Bonjour | gerçek soket yok |
| Keşif kimliği | `test_discovery_identity.ts` | — | "prisma. geçmiyor" mekanik kontrolü |
| Import | `test_import_framework.ts`, `test_import_permissions.ts` (`app.listen`), `test_import_cycles.ts`, `test_import_fix_hints.ts`, `test_import_registry.ts` | Gerçek DB | **gövde limiti / uçuşta çift koşum ölçülmüyor** |
| Config bundle | `test_config_bundle.ts` | Gerçek DB | — |
| Swagger | `test_swagger_spec.ts` (56) | `failOnErrors` | — |
| Muhasebe export | `test_accounting_export.ts`, `test_accounting_direct_ship.ts` | Gerçek DB | — |
| Etiket | 30+ `test_label_*`, `test_raster_*`, `test_native_*`, `test_sack_label`, `test_bulk_label*` | Gerçek DB / saf | raster CPU süresi ölçülmüyor |

## HOTSPOTLAR

② denetçilerinin öncelikle bakacağı yerler. Sıra: en somut/en ölçülmüş önce. (Yargı değil; "buraya bak" işareti.)

- **H-1 — `Teks-Erp/src/app.ts:141` ↔ `src/routes/import.routes.ts:28,242,279` ↔ `src/routes/config-bundle.routes.ts:27`: import/paket gövde tavanı fiilen 1 MB.** Global `express.json({limit:"1mb"})` route'lardan önce; router'ın `10mb` parser'ı hiç koşmuyor. Sonda: 1,98 MB → `413 entity.too.large`. Vaat (`MAX_IMPORT_ROWS=10000`, `import-coerce.ts:127`; `app.ts:546-549` yorumu) ile gerçek ayrışık; Electron istemcisi parçalamıyor (`Electron/src/services/importService.ts:180-186`); bekçi yok. Sahada henüz görülmemiş (`import_runs` 0). → ② doğruluk/ops (kategori K9/CORE.api).
- **H-2 — `src/services/import/import.service.ts:447-475,508-545,552-575`: `clientToken` idempotency yalnız tamamlanmış koşumu korur.** Koşum satırı döngüden SONRA yazılır; uçuştaki tekrar (timeout-retry) ikinci koşumu da başlatır; süreç-içi bayrak/advisory lock yok. Ana veride doğal anahtar (`code`) çoğunu UPDATE/SKIP'e çevirir; **`order` adaptörü create-only + doğal anahtarsız** (`order.adapter.ts:7-16,159-163`) → çift sipariş. Ayrıca yazma yolu satır başına ayrı tx (bilinçli) + HTTP zaman aşımı yok → uzun istek. → ② eşzamanlılık (`concurrency-patterns §10` dört durum tablosu).
- **H-3 — `src/services/db-copy.service.ts:798-830` (`reverifyCopy`) → `db-copy-verify.service.ts:348-459`: yol parametresi allowlist'siz.** `dropCopy` (`:665-676`) ve `getSwapCommands` (`:739-746`) `isRestoreCopyName` uygular; `POST /api/admin/db-copies/:name/verify` uygulamaz → yükseltilmiş kimlikle (`BACKUP_PG_USER`, çoğu kurulumda superuser) cluster'daki **herhangi** bir DB'ye bağlanıp 12 tabloda `count(*)` koşar ve `dbRestore.copies[<ad>]` kaydı yazar (canlı DB adı dahil; `writeCopyRecords` yalnız `pg_database`'de olmayanı budar). Yalnız `admin:settings`+`admin:users` erişir; DDL yok. → ② güvenlik (düşük) + tutarlılık.
- **H-4 — `src/services/backup.service.ts:107,121-124` (`verifyBackupFile`): 30 s `Promise.race` child'ı öldürmüyor.** `runTool` kendi 3 saatlik `timeout`unu taşır; yarış dolunca "unknown" döner, `pg_restore --list` süreci yaşamaya devam eder; "unknown" önbelleklenmediği için her `restore-impact`/kopya başlatma yeni child spawn eder (ağ diskinde asılı dosya → süreç birikimi, hepsi 3 saat sonra SIGKILL). → ② ops/gözlemlenebilirlik.
- **H-5 — `src/services/backup.service.ts:46,324-338` ↔ `src/routes/admin.routes.ts:1402-1432` + `system-setting.service.ts:3225`: offsite YEREL dizin için iki gerçek.** Panel `SystemSetting backup.offsiteDir` yazar ve GET'te okur; yedek işi yalnız modül yükünde okunan `process.env.BACKUP_OFFSITE_DIR`'i kullanır. Panelde "ayarlandı" görünürken kopya alınmaz ve uyarı "OFFSITE YEDEK AYARLANMADI" env boşsa yine basılır (`:334-338`). `readOffsiteRemote` (rclone) için ikilik yok. → ② doğruluk (sessiz ayrışma sınıfı, 2026-08-21 taramasının "türetilmiş alan" akrabası).
- **H-6 — `src/services/helpers/offsite-backup.helper.ts:125,197-212,297` + `src/routes/admin.routes.ts:1391-1400`: rclone uzak adı doğrulamasız pozisyonel argüman.** `remote` `z.string().trim().max(200)`; `-`/`--` ile başlayan değer rclone tarafından **bayrak** olarak yorumlanır (argüman enjeksiyonu; shell yok, komut enjeksiyonu değil). Token yazımı için regex var (`:339`), hedef adı için yok. Erişim `admin:settings`+`admin:users` (bilinçli olarak yedeğin gideceği yeri belirleme yetkisi). → ② güvenlik (düşük/orta, tehdit modeli LAN admin).
- **H-7 — `src/services/label.service.ts:2075-2160` (`recordPrintEvent`): baskı izi üç ayrı yazım, tx yok.** `seedRollLabelSnapshot` `roll.update` (`:1989`) → `roll.update(labelDirty:false,labelPrintedAt)` (`:2112`) → audit (`:2145`). Arada `getRollLabel`/`resolveLabelRouting` okumaları. İkinci yazım düşerse snapshot güncel ama `labelPrintedAt` boş (iptal guard'ı kör) — kâğıt çıkmışken. Kart yolu (A7) tx kullanıyor, top yolu kullanmıyor: aynı sınıf iki farklı sözleşme. → ② eşzamanlılık/tutarlılık (`concurrency-patterns §6/§7` "kısmi durum").
- **H-8 — `src/services/label.service.ts:817,820,1097-1208`, `helpers/raster/*`, `helpers/label-renderer.registry.ts:110-122`: CPU-bound render event loop'ta.** Etiket başına 2 senkron `bwipjs.toSVG`; raster yolunda glif tarama + bwip `raw()` senkron; toplu uçlarda 2000 top × ≤5 kopya, 25'te bir `setImmediate`. Tek process invariant'ı altında severity **artar** (beceri §1). Ölçülmemiş: tek etiket süresi, 2000'lik toplu süresi. → ② performans/ops (ölçüm önerisi: 2000 raster etiket × zaman).
- **H-9 — `src/jobs/backup-scheduler.ts:101-104` + saha ölçümü:** damga işten önce (bilinçli) ve `BACKUP_SCHEDULE_ENABLED=false` beklenirken prod kopyasında `nightly` 1 koşum + `backup.lastNightlyAt` dolu. Ya env bir dönem açıktı ya da ecosystem repo↔saha ayrışık; iki mekanizma (harici görev + scheduler) aynı gece iki dump alabilir (`:129` yorumu bunu söylüyor). → ② ops: saha env'i doğrulanmalı (canlıya erişim yok).
- **H-10 — `src/services/helpers/label-renderer.registry.ts:59-72,87`: `RENDERERS` `Partial<Record>` + bilinmeyen dil → `RASTER_HTML`.** OCP fail-open sınıfı (beceri §7.6): yeni `PrinterLanguage` üyesi eklenirse derleme hatası vermez, HTML'e düşer; `CONTENT_TYPES` ise tam `Record` (derleme hatası verir) — iki tablo farklı disiplinde. → ② mimari (bulgu değil, ölçüm noktası).
- **H-11 — `src/routes/mobile-update.routes.ts:44-83` + `src/routes/discovery.routes.ts:34`: kimliksiz uçlar, rate-limit yok** (bilinçli tasarım). `readFileSync` (`:56`) kimliksiz yolda sync I/O; dosya küçük. → ② güvenlik notu (LAN-only; DoS yüzeyi küçük).
- **H-12 — `src/services/db-copy-verify.service.ts:311-320` `readdirSync` + `db-copy.service.ts:836-931` `listDbCopies`:** her `GET /api/admin/db-copies` `probeCapabilities` + bakım bağlantısı + `pg_database_size` tüm DB'ler + `statfs`; panel yoklarsa (kopya sürerken `job` alanı için) bakım DB'sine kısa ömürlü bağlantı açar/kapatır. Ölçülmedi. → ② performans (düşük).

## SINIR ÖTESİ NOTLAR

- **A (çekirdek/API)**: H-1'in kökü `app.ts:141` global parser sırası — çözüm yönü (path bazlı `type`/`skip` ya da router'ı parser'dan önce mount) A alanına dokunur. `cors()` origin `*` (`app.ts:114`) — G alanı.
- **B (eşzamanlılık)**: `labelDirty` yazan 11 noktanın çift-mod (tx / havuz) çağrı listesi §2.a-A8'de; `shipping.service.ts:1723` havuz client'ıyla `updateMany` (çevresindeki tx'in dışında mı, ② doğrulasın). H-2 ve H-7 eşzamanlılık hücresine.
- **C (durum makineleri / K7 belge)**: `printed_documents` `reissue` atomik claim (`printed-document.service.ts:670-693`) ve kart `upsert` (`traveler-card.service.ts:443-460`) — belge/kart ajanı sürüm semantiğini değerlendirsin; burada yalnız tx haritası.
- **D (zamanlanmış işler / H durum)**: `archive-scheduler`, `permission/reason/role catalog` reconciler'ları K9 dışı; `installation-identity.job.ts:78-81` yorumu (P2002 yarışı) ile kod (`upsert`, `:141`) ayrışık — tek process'te etkisiz, dokümantasyon tutarsızlığı.
- **G (güvenlik)**: §12 tablosu tümüyle; özellikle S5/H-6 (argüman enjeksiyonu), H-3 (verify allowlist), S14 (kimliksiz FS okuma, traversal guard var), S21 (`test-native` ucu `label:print` ile **keyfi IP:port'a** bayt gönderir — yalnız `label.nativeSendEnabled=true` iken; sahada kapalı), `/api/admin/health` içindeki `lastAuditError`/`lastPoolTimeoutError` ham metinleri (`app.ts:440-444`).
- **I (gözlemlenebilirlik)**: H-4 (yetim child), H-9 (scheduler env ayrışması), rclone "hedef yok" yalnız `console.warn` (`offsite-sweeper.ts:53-59`, bilinçli), GUC replay hatası yalnız `console.error` (`db-copy.service.ts:627-629`), raster düşüşü `console.error`/sessiz `catch` (`registry.ts:119-121`, `label.service.ts:934`), `seedRollLabelSnapshot` çözüm hatası `console.error` + `{seeded:false}` (`label.service.ts:1976-1981`), saha audit `LABEL_PRINT_EVENT.language` 2.517 `RASTER_HTML` (yanlış dil izi, düzeltme sonrası doğrulanmalı).
- **K3/K4 (KK1/Tambur)**: metre okumasında sunucu tarafı simülasyon guard'ı yok (§4) — kabul edilen tasarım mı, ölçülsün.
- **K8 (belge/etiket içerik)**: `LabelKind` enum tüketici sayımı (CLAUDE "4 yer elle") ve `RENDERERS` fail-open (H-10) mimari hücreye.
- **L (Electron/mobil)**: fiziksel gönderim, yazıcı kuyruğu (`mobil/src/offline/printQueue.ts`), import dosya ayrıştırma (`Electron/src/lib/import/parse.ts`) ve **gövde parçalama yokluğu** istemci alanında; H-1 kapanırken istemci de düşünülmeli.

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod** yok; ölçümler 2026-08-25 kopyasından (190/195 migration). `system.installationId`, `backup.offsiteRemote`, `dbRestore.copies` anahtarlarının canlıdaki değeri bilinmiyor; sahadaki gerçek `ecosystem.config.js` env'i (H-9) doğrulanamadı.
- **Süre ölçümü yapılmadı**: tek etiket render/raster süresi, 2000'lik toplu, `pg_restore --list` süresi, `listDbCopies` gecikmesi — kapsam dışı (② performans; gerçek pg araçları ve saha boyutlu DB gerekir).
- **Elektron/mobil istemci kodu** yalnız dokunma noktaları kadar okundu (`printer.ipc.ts:55-100`, `update-feed.ts`, `feed.cjs`, `printQueue.ts` başı, `importService.ts`); istemci timeout/retry politikaları haritalanmadı — L alanı.
- `label.service.ts` 2.208 satırın yalnız baskı/print-event/bulk/preview bölgeleri okundu; `getRollLabel` dal mantığı (①-④ müşteri çözümü, fire kapısı) K8/K7 alanı, burada değerlendirilmedi.
- `label-template.service.ts` `importTemplate`/`exportTemplate` (config-bundle'ın kullandığı) ve `sanitizeTemplateHtml` uygulaması okunmadı — "İÇE AKTARIMDA DA SANITIZE" iddiası `config-bundle.service.ts:20-22` yorumuna dayanır [VARSAYIM].
- `archive-scheduler.ts`, catalog reconciler job'ları, `latency-persist` — K9 dışı (D alanı).
- `client-version-policy.ts` / `client-policy.routes.ts` okunmadı (KUNYE'ye göre var; bekçi `test_client_policy.ts`).
- 17 adaptörün 14'ü yalnız grep ile tarandı (`$transaction` 0 vuruş adaptörlerde — hepsi servis üzerinden yazıyor); `customer-alias`, `customer-branch`, `fabric-property`, `machine`, `station`, `subcontractor*`, `product-recipe`, `color`, `quality-grade`, `defect-type`, `return-reason`, `customer` adaptörlerinin `nameGuard`/`scope` beyanları tek tek doğrulanmadı.
- `test_printer_transport.ts`/`test_device_transport.ts`'nin timeout dalını ölçüp ölçmediği okunmadı (yalnız mock varlığı görüldü).
- ALS bağlamının fire-and-forget işlere (`void runBackupJob`) taşınıp taşınmadığı ölçülmedi [VARSAYIM olarak işaretli].
- `master-data-merge` CSV'sinin boyut üst sınırı ölçülmedi (canlı ana veri küçük).
