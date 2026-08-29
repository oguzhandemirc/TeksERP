# K8 — Zamanlanmış & Arka Plan İşleri (HARİTA, aşama ① KEŞİF)

> Ajan: K8 haritalayıcı · Salt-okunur · **Yargı YOK** — yalnız harita + ②'ye hotspot.
> Dal `adnansahin`, HEAD `ce8681d1`. DB kanıtı: dev `adnansahin_db` (152.892 log) + prod kopyası `tekserp_saha_0825` (10.485 log; 190/195 migration).
> Beceri paketi §6 (BEŞ SORU) + `state-and-scheduler.md` §2 uygulandı. Metrik toplayıcılar (scheduler DEĞİL) ayrıca işaretlendi.

## 0. Kapsam ve topoloji (soruların dayanağı)

| Olgu | Değer | Kanıt |
|---|---|---|
| Süreç modeli | **PM2 `fork` + `instances:1` = TEK PROCESS INVARIANT** | `ecosystem.config.js:42-48` (`exec_mode:"fork"` :47, `instances:1` :48), `server.ts:22-34`, `ARCHITECTURE.md:969-995 §10.3` |
| Cron kütüphanesi | **YOK** — node-cron allowed-packages dışında → çıplak `setInterval`/`setTimeout` | `archive-scheduler.ts:4`, `backup-scheduler.ts:8`, grep |
| Gerçek **periyodik** iş (setInterval) | **YALNIZ 3**: archive · backup · offsite-sweeper | grep `setInterval` = `offsite-sweeper.ts:100`, `archive-scheduler.ts:104`, `backup-scheduler.ts:144` |
| Boot-once iş (setTimeout + `started`) | permission/role/reason uzlaştırıcı zinciri · installation-identity · mdns-advertiser | `permission-catalog.job.ts:198`, `installation-identity.job.ts:212`, `mdns-advertiser.job.ts` |
| Metrik/durum toplayıcı (scheduler DEĞİL, §6 YP) | presence · latency-persist · pool-health · feature-flag cache · reason-preset cache · discovery cache · disk-metrics | aşağıda ayrı bölüm |
| `clearInterval` / `clearTimeout` | **HİÇ YOK** — intervallar kapanışta `process.exit` ile ölür (retry setTimeout'ları `.unref()`) | grep = 0 sonuç |
| child_process disiplini | TEK kapı `runProcess` (`src/services/helpers/pg-tool.helper.ts:98`) — `timeout` + `SIGKILL` + stderr tüketimi | `pg-tool.helper.ts:103-137` |
| Tek-süreç MEKANİK bekçisi | **YOK** (`test_single_process` yok) — invariant yalnız 3 yerde BELGELİ | `ls scripts` (yok), ARCHITECTURE §10.3, ecosystem yorumu, server.ts:22 |

---

## 1. İŞ ENVANTERİ (periyodik + boot-once schedulerlar)

Sütunlar: iş · tetik/sıklık · TZ · tekil garanti · damga yeri · hata kalıcılığı · child timeout · idempotent mi · yarıda kesilme · bekçi.

| İş (dosya:satır) | Tetik / sıklık | TZ | Tekil çalışma garantisi | Son-çalışma damgası nerede | Hata kalıcı mı | child timeout | İdempotent | Yarıda kesilme davranışı | Bekçi scripti |
|---|---|---|---|---|---|---|---|---|---|
| **archive-scheduler** (`archive-scheduler.ts:53-109`) | boot+60sn, sonra her **24sa** (`CHECK_INTERVAL_MS`); ayrıca **30 gün** iç eşik (`INTERVAL_DAYS`) | Yok (gün eşiği mutlak ms farkı, TZ'siz — doğru) | ① in-process `running` bayrağı + `runningSince` **3sa watchdog** (`:28-32,54-65`); ② tek-process invariant. 2. process olsaydı çift-arşiv | **SONDA** (`setLastRun(new Date())` batch döngüsünden SONRA, `:84`) | **EVET** — `reportJobFailure("audit-archive")` → SystemLog + console + havuz sayacı (`:93`) | dolaylı: yalnız DB (child yok) | **EVET** — her batch ayrı tx, `createMany skipDuplicates` + seçili id'leri `deleteMany`; kesilirse kalan batch bir sonraki turda | Kısmi arşiv tutarlı (batch=atomik tx); damga sonda → tam bitene dek "koştu" sayılmaz | `test_audit_depth §10` (SET LOCAL sırası + gerçek taşıma) · `test_system_log §6` · `test_observability_contract` (catch→reportJobFailure) |
| **backup-scheduler** (`backup-scheduler.ts:64-150`) | boot+60sn, sonra her **15dk**; hedef saat `backup.hour` (DB→env→3) HER turda | **Fabrika günü** `factoryDayStart` (`:95`, F-OPS-VER-005 sonrası; süreç TZ'sini ATLAR) | ① in-process `checking` + 3sa watchdog (`:37-43,65-76`); ② `running` bayrağı `backup.service.ts:162,199`; ③ tek-process invariant. **Sahada scheduler KAPALI** (`BACKUP_SCHEDULE_ENABLED=false`, harici görev alır) | **BAŞTA** (`setLastRun(now)` `runBackupJob`'tan ÖNCE, `:102` — bilinçli, retry-spam önler) | **EVET** — `reportJobFailure("backup")` scheduler dışı hatada (`:114`); `runBackupJob` KENDİ `BACKUP_FAILED` audit'ini yazar (`backup.service.ts:191-195`) | **VAR** — `runTool` default 3sa timeout + SIGKILL (`pg-tool.helper.ts:53,74-80`); asılı pg_dump öldürülür → close→hata yolu | pg_dump `.part`'a yazar, doğrulama geçince `rename` (atomik); yarım `.part` sonraki boot'ta `sweepStaleParts` (24sa) budar (`backup.service.ts:236,291,368`) | **damga BAŞTA + idempotent-DEĞİL**: başarısız yedek O GÜN retry EDİLMEZ (aşağıda hotspot; ama BACKUP_FAILED audit görünür) | `test_backup.ts` (605 satır: rename, timeout, retention, paralel red, saat önceliği) |
| **offsite-sweeper** (`offsite-sweeper.ts:43-106`) | boot+90sn, sonra her **60dk** | Yok (mutlak) | in-process `running` reentry bayrağı (`:41,44-47`) + tek-process; watchdog YOK ama `SWEEP_TIMEOUT_MS=3sa` child timeout kesin sınır koyar | **YOK** (durumsuz — her tur tam süpürme; `lastSweep` yalnız bellekte `offsite-backup.helper.ts:263`) | **KISMİ**: `!ok` → `reportJobFailure` (`:63`); `configured:false` → yalnız `console.warn` (KURULUM eksiği, iş hatası değil — bilinçli, `:53-59`) | **VAR** — `runProcess timeoutMs` copy=3sa, lsf=5dk (`offsite-backup.helper.ts:88-90,213`) | **EVET** — `rclone copy` (`sync` DEĞİL) + `--immutable` + `--no-traverse`; uzağa hiç silme YOK | kesilirse veri kaybı yok (copy salt-ekler); bir sonraki tur eksikleri tamamlar; `lsf` kapsam doğrulaması | `test_offsite_sweep.ts` (copy≠sync, kapsam, boş klasör, rclone-yok uyarısı) |
| **permission→role→reason uzlaştırıcı zinciri** (`permission-catalog.job.ts:144-199`) | **boot-once**, +3sn; DB gelmezse 4×15sn retry (`.unref()`) | Yok | `started` bayrağı (`:48,145`); yarışta `createMany skipDuplicates` (@unique) / P2002 | Yok (deploy'la değişir, timer yok) | **EVET** — tükenirse `console.error` + `PERMISSION_CATALOG_RECONCILE_FAILED` audit (`:186`) | child yok | **EVET** — yalnız EKLER, ezmez/silmez; `skipDuplicates` | boot'ta patlarsa yeni izin/rol DB'de yok → Admin dışı 403; sonraki boot tamamlar. **SIRA LOAD-BEARING** (rol izne FK, `:149`) | `test_permission_catalog.ts` (627), `test_role_template_catalog.ts` (216), `test_reason_presets.ts` |
| **reason-preset uzlaştırma** (zincirin 3. fazı, `reason-preset-catalog.job.ts:37-74`) | boot-once, zincirin sonunda (`permission-catalog.job.ts:159`) | Yok | zincirle aynı `started`; FK bağı YOK (bağımsız) | Yok | **KISMİ** — `runReasonPresetReconciliation` yalnız `console.error` (`:86`); ama zincirde çağrılınca üstteki catch audit yazar | child yok | **EVET** — kod DB'de yoksa create; var olanın etiket/sıra/görünürlüğü EZİLMEZ | boş DB'de create; `refreshReasonPresetCache()` sonda (`:72`) | `test_reason_presets.ts §3` |
| **installation-identity** (`installation-identity.job.ts:82-213`) | boot-once, +3sn; DB gelmezse 4×15sn retry (`.unref()`) | Yok | `started` (`:48,188`); yarışta `create` P2002→öncekini oku (`:124-131`) | Yok | **KISMİ** — tükenirse `console.error` + `publish(null)`; başarıda `INSTALLATION_ID_CREATED`/`_REGENERATED` audit | child yok | **EVET** — var olan kimliği ASLA yeniden üretmez; yalnız BOZUK değeri yeniler | tükenirse keşif kimliksiz kalır (özelliğin kaybı, sunucunun değil) | `test_discovery_identity.ts` (291) |
| **mdns-advertiser** (`mdns-advertiser.job.ts:105-193`) | boot-once (`server.ts:124`) + kimlik geç gelirse TXT bir kez tazele | Yok | `state.active` guard (`:111`) + tembel `require` | Yok | **HAYIR — bilinçli fail-open**: her arıza `console.warn` + `getMdnsState().reason` (`/health`'te görünür `app.ts:460`) | child yok (soket) | idempotent (ilan tek) | bind/modül hatası → `active:false`, HTTP'ye dokunmaz | `test_discovery_advertiser.ts` (286, fail-open + kapanış kablolaması) |

---

## 2. BEŞ SORU — iş bazında ayrıntı (beceri §6)

### (1) Tekil çalışma garantisi
- **Tek-process invariant** üç yerde BELGELİ (`ecosystem.config.js:47-48`, `server.ts:22-34`, `ARCHITECTURE.md §10.3`) ama **MEKANİK BEKÇİ YOK** (`test_single_process` yok). §5/§6 kuralı: in-memory durum + tek process = doğru; bulgu adayı invariant'ın **bekçisiz** olması.
- Her periyodik işin ek olarak in-process bayrağı var: `running`/`checking` — ama bu **process-local**, 2. process'i durdurmaz.
- **CANLI KANIT (dev DB, çift-dump yarışı ölçüldü):** `2026-08-24 03:27:18.034` **BACKUP_FAILED** (rename ENOENT) → `03:27:18.042` (8ms sonra) **BACKUP_COMPLETED** aynı dosya `tekserp_20260824_032716.dump`. Ve `2026-08-23 03:14:24.752`: **İKİ** BACKUP_COMPLETED (`_031422.dump` + `_031423.dump`), 1sn arayla. → İki eşzamanlı süreç aynı saniye-çözünürlüklü dosyada yarıştı; `running` bayrağı process-local olduğu için engellemedi. Dev'de nodemon/çoklu koşum artefaktı; **prod'da `instances:1` bunu kapatıyor** ama biri instances>1 yaparsa sessiz çift-dump + rename ENOENT.
- Boot-once işler yarışta güvenli: `createMany skipDuplicates` (permission/role) + `create` P2002→oku (identity/reason).

### (2) Damga BAŞTA mı SONDA mı — seçim ↔ idempotentlik uyumu
| İş | Damga | İdempotent? | Uyum |
|---|---|---|---|
| archive | **SONDA** (`:84`) | EVET | ✔ Uyumlu — kesilen iş sonraki turda kalanı arşivler |
| backup | **BAŞTA** (`:102`) | HAYIR (pg_dump) | ⚠ Bilinçli takas: damga başta = başarısız yedek O GÜN retry edilmez (retry-spam önler); ama `runBackupJob` `BACKUP_FAILED` audit'i yazdığı için "sessiz atlama" DEĞİL — görünür. `state-and-scheduler.md §2(2)` şablonu: damga başta+kritik iş → patlayan yedek o gün denenmez. Sahada scheduler KAPALI olduğu için etki yalnız dev + scheduler açan müşteri. **② doğrulasın: bu takas kabul edilebilir mi.** |
| offsite | damga yok (durumsuz) | EVET | ✔ Her tur tam süpürme |

### (3) Hata kalıcılığı (console.error mı, kalıcı yer mi)
- Merkezi yardımcı **`job-failure.ts:34`** → `console.error` + **`AuditService.logEvent(recordId="JOB_FAILED:<job>")`** (SystemLog) + havuz zaman aşımıysa `recordPoolTimeout` (`/health` sayacı). F-CORE-OPS-004 düzeltmesi. Guard AÇIKKEN bile çalışır: trigger yalnız UPDATE/DELETE/TRUNCATE'i engeller, **INSERT serbest** (`20260819161000_audit_tamper_guard/migration.sql:62`).
- archive + backup (scheduler-dışı hata) + offsite (`!ok`) → `reportJobFailure`. `test_observability_contract` catch bloklarının çıplak `console.error` ile yetinmediğini AST ile doğruluyor.
- **console.error-only kalanlar (bilinçli):** offsite `configured:false` (kurulum eksiği, `:53-59`); `runReasonPresetReconciliation` doğrudan çağrıda (`:86`, ama zincirde catch audit yazar); identity/mdns fail-open (`/health`'te durum var).
- **DB kanıtı:** `JOB_FAILED:%` kaydı dev'de **0**, saha'da **0** — job-failure yolu canlıda hiç tetiklenmemiş (`system_logs` sorgusu). Dev'deki tek BACKUP_FAILED `logEvent` üzerinden yazılmış (recordId JOB_FAILED değil, backup.service kendi kanalı).

### (4) Saat dilimi
- Süreç TZ: docker `TZ=Europe/Istanbul` (`Dockerfile:23`, `docker-compose.yml:10`); PM2/Windows sahada TZ açıkça sabitlenmemiş — **saha oturum TZ = `Europe/Istanbul`** ölçüldü (`current_setting('TimeZone')`), DB oturumu ayrıca UTC (`PG_SESSION_OPTIONS="-c timezone=UTC"`, `lib/prisma.ts:62`, LOAD-BEARING).
- Scheduler zamanlaması: archive/offsite mutlak-ms (TZ'den bağımsız, doğru). **backup**: hedef saat `factoryDayStart` ile fabrika gününe göre (`backup-scheduler.ts:95`), F-OPS-VER-005 sonrası süreç `setHours`'unu ATLAR — kod tabanındaki tek üretim `setHours` buydu, düzeltildi. `constants/time.ts` `Intl`+`Europe/Istanbul` ile süreç TZ'sinden bağımsız.
- `cron.schedule` YOK → `{timezone}` sorusu N/A.

### (5) Child process timeout (asılırsa sonraki tur atlanır mı)
- TEK kapı `runProcess` (`pg-tool.helper.ts:98-137`): `spawn(..., {timeout, killSignal:"SIGKILL"})`; close event'te `timedOut` ayrımı. Default **3sa** (`DEFAULT_TOOL_TIMEOUT_MS:53`). F-OPS-VER-004 düzeltmesi: eski üst-sınırsız spawn asılırsa promise HİÇ settle etmez, o gecenin yedeği sessizce kaybolurdu.
- pg_dump/pg_restore (`backup.service`, `db-copy.service`) ve rclone (`offsite-backup.helper`) HEPSİ buradan geçer.
- `verifyBackupFile` ayrı 30sn `Promise.race` timeout (`backup.service.ts:107,121-124`).
- **Asılma → sonraki tur:** backup `checking` bayrağı 3sa watchdog ile zorla bırakılır (`:65-76`); archive aynı (`:54-65`); offsite'ta watchdog YOK ama child 3sa timeout `running`'i finally'de bırakır. → Asılı child sonsuz "zaten koşuyor" kilidi YAPMAZ.

---

## 3. archive-scheduler — NE arşivliyor, DELETE nasıl geçiyor

`AuditService.archiveOlderThan(6)` (`audit.service.ts:204-265`):
1. `systemLog.findMany({where:{createdAt:{lt: 6ay}}, take:5000})` — `ARCHIVE_BATCH_SIZE=5000` (`:15`).
2. **Tek tx içinde**: `SET LOCAL teks.audit_purge='on'` (İLK ifade, `:233`) → `systemLogArchive.createMany(skipDuplicates)` → `systemLog.deleteMany({id:{in}})` (`:261`).
3. Scheduler döngüsü: en fazla **200 batch/tur** (`MAX_BATCHES_PER_RUN`, 1M satır tavanı), `archived===0`'da durur.
- **audit_guard AÇIKKEN DELETE nasıl geçiyor:** trigger `teks.audit_guard='on' AND teks.audit_purge<>'on'` iken RAISE (`migration.sql:48-49`). Arşivleyici tx'inde `SET LOCAL audit_purge='on'` açık → geçer. `SET LOCAL` COMMIT'te söner, havuza sızmaz (interactive tx adanmış client). **createMany INSERT** trigger kapsamı dışı (yalnız U/D/T).
- **SIRA LOAD-BEARING**: `SET LOCAL` `deleteMany`'den ÖNCE (`test_audit_depth §10.5` kaynak sırasını da ölçüyor).
- **Yarıda kesilme**: her batch ayrı `archiveOlderThan` çağrısı = ayrı tx; döngü ortasında patlarsa commit edilmiş batch'ler kalır, kalanlar sonraki turda (idempotent, silinmiş satır tekrar seçilmez).
- **CANLI DURUM**: saha'da 6 aydan eski **0** satır (en eski `2026-07-16`, ~6 hafta); dev'de de **0**. `system_log_archives` HER İKİSİNDE de **0 satır**. → Arşivleyici canlıda fiilen hiç satır TAŞIMAMIŞ (henüz gerek yok). `audit.lastArchiveAt` yine de damgalı (saha `2026-08-16`, dev `2026-08-15`) — kuru koşum çalışıyor.
- Boyutlandırma: saha `system_logs` 6.6MB/10.485 satır (ort. 275B JSON, p99 9.4KB); dev 103MB/152.892 (test kalıntısı). 5000'lik batch × p99 ≈ makul.

---

## 4. backup retention SİLME mantığı

`backup.service.ts:294-321`:
- `readdir` → `NIGHTLY_PREFIX` (`tekserp_`) + `.dump` süz.
- `newestFirst` (mtime desc) → `.slice(RETENTION_MIN_KEEP=3)` → `filter(mtime < cutoff)` sil (`:314-317`). Cutoff = `now - retentionDays()*gün`.
- **'en yeni 3 korunur' kodda VAR** (`RETENTION_MIN_KEEP=3`, `:66,314`) — saat kayması sigortası. `retentionDays()` env `BACKUP_RETENTION_DAYS` (default 30, 1-3650 clamp, `:64-71`).
- `premigrate_*` / `pre-restore_*` prefix'li yedekler **rotasyon DIŞI** (yalnız `NIGHTLY_PREFIX` süzülür).
- Sahada BU KOD KOŞMUYOR: `BACKUP_SCHEDULE_ENABLED=false` → gece yedeğini `yedekle.ps1` (Windows Görev Zamanlayıcı, 30 gün) alır; backend rotasyonu yalnız PANELDEN elle alınan yedeklere uygulanır. İki politika aynı klasöre/aynı prefix'e yazar, ikisi de 30 gün (`ecosystem.config.js:101-113` yorumu + `docs/ops/DEPLOY-RUNBOOK.md:52,319`).

---

## 5. offsite-sweeper copy semantiği

`offsite-backup.helper.ts:146-256`:
- `rclone copy` (**`sync` DEĞİL**) + `--immutable` (kopyalanmış dosya sonradan değişmişse HATA) + `--no-traverse` + `--retries 3` (`:196-214`). Uzaktan silme HİÇBİR satırda yok — fidye/yerel silme uzağa yansımaz.
- 2 adım ayrı: (1) copy, (2) `lsf` ile kapsam doğrula → `missing` (yerelde var uzakta yok). `remoteNames` liste hatası → `null` (boş dizi DEĞİL — "bakamadım" ≠ "boş").
- `COPY_PREFIXES` = nightly + premigrate + pre-restore (`:49`).
- rclone yolu env `BACKUP_RCLONE_BIN`; config `--config` ile açıkça (`rcloneConfigPath` `<BACKUP_DIR>/../rclone.conf`, `:70-75`).
- **CANLI DURUM**: saha `BACKUP_RCLONE_REMOTE` boş — süpürücü her saat `configured:false` → `console.warn`, audit'e YAZMAZ (gürültü önler). Kurulum F-OPS-VER-003 hâlâ AÇIK (kod hazır, sunucuda rclone + hedef bekliyor). Saha BACKUP_COMPLETED payload'ları "OFFSITE YEDEK AYARLANMADI" uyarısı taşıyor (`2026-07-31`…`2026-08-22` manuel yedekler).

---

## 6. Metrik/durum toplayıcılar (scheduler DEĞİL — §6 YP)

Bunlara (1)-(3) uygulanmaz; idempotent, atlanması/çift koşması zararsız. Hepsi process-local (tek-process invariant), restart'ta sıfırlanır.

| Toplayıcı (dosya) | Tetik | Durum yeri | Kalıcı yazım? | Not |
|---|---|---|---|---|
| **presence** (`lib/presence.ts`) | istek başına `touchUser`/`touchDevice` (middleware) | `Map<id,ts>` bellek | HAYIR | Lazy prune (`countFresh` okumada bayatı siler); timer YOK; restart="şu an online" sıfırlanır |
| **latency-persist** (`latency-persist.service.ts`) | istek-güdümlü throttle 5dk → `setImmediate(flushLatencyNow)`; **timer YOK** | `pending Map` + `EndpointLatencyDaily` tablo | EVET (günlük özet) | **SIGTERM flush**: `gracefulShutdown` `flushLatencyNow()` 2sn tavanla (`server.ts:162`); swap-map ile kayıp yok; retention `deleteMany` günde 1 (`lastRetentionDayKey`); TZ `factoryDayKeyUtcMidnight` (UTC-midnight, adapter için load-bearing) |
| **pool-health** (`lib/pool-health.ts`) | `pool.on('connect'/'acquire')` event | bellek sayaç | HAYIR | `waitingMax`/`poolAcquireTimeouts` okumada sıfırlanmaz ("başlangıçtan beri"); sayaç yalnız HTTP hata yolu + job-failure |
| **feature-flag cache** (`system-setting.service.ts:998`) | istek-güdümlü, 30sn TTL | bellek | HAYIR | `invalidate` her yazımda (`:1067`); `cacheGeneration` lost-invalidation guard (`:1004,1157,1235`); process-local |
| **reason-preset cache** (`reason-preset.service.ts:101`) | senkron okuma (tx içi validation) + 60sn TTL | `Map<kind,rows>` bellek | HAYIR | **Bayat-serve + arka plan tazeleme** (`scheduleBackgroundRefresh`, 2026-08-26 arıza düzeltmesi); yazımlar `refreshReasonPresetCache` doğrudan (kendini görmeli); `backgroundRefresh` dedup |
| **discovery cache** (`discovery.service.ts:57`) | boot `refreshDiscoveryCache` + istek-güdümsüz (senkron `buildDiscoveryIdentity`) | bellek firma adı/port | HAYIR | Firma adı değişince sonraki restart'ta tazelenir; uç DB'ye ASLA gitmez |
| **disk-metrics** (`lib/disk-metrics.ts:22`) | istek-güdümlü, 30sn/yol cache | `Map` bellek | HAYIR | `/health` `readAppDiskMetrics`; timer YOK |
| **app.ts latestBackupInfo** (`app.ts:197`) | istek-güdümlü, 30sn cache | bellek | HAYIR | `/health` `lastBackup`; `.dump` süzer |

Manuel bakım uçları (scheduler DEĞİL, admin tetikler): `SessionRegistryService.purgeDeadSessions` (`admin.routes.ts:832`), `archiveOlderThan` (`:870`), `triggerManualBackup` (`:1196`), `runOffsiteSweepNow` (`:1457`), `testOffsiteRemote` (`:1443`), `db-copy.startCopyJob` (atomik `currentJob` claim, `db-copy.service.ts:373-405`, bekçi `test_db_copy_single_start.ts`).

---

## 7. Kapanış (SIGTERM/shutdown) yolu

`server.ts:144-227`: `gracefulShutdown` — SIGTERM/SIGINT + **pm2 IPC `process.on("message"==="shutdown")`** (Windows gerçek sinyal göndermez). 5sn `forceTimer` (`.unref()`) → `process.exit`. Paralel (race, 2sn tavan): `flushLatencyNow()` + `stopMdnsAdvertiser()` (`:161-164`) → `server.close` → `prisma.$disconnect` + `pool.end`. `uncaughtException` → audit(2sn) + kapan(exit 1); `unhandledRejection` → audit + AYAKTA KAL.
- **Intervallar kapanışta clear EDİLMEZ** (grep `clearInterval`=0); `process.exit` hepsini öldürür. Retry setTimeout'ları `.unref()` — natural exit'i bloklamaz.
- **flushLatencyNow SIGTERM'de çağrılıyor** → RAM latency delta'ları kaybolmaz (kayıt-kuyruğu emsalinden farklı: burada flush VAR).

---

## HOTSPOTLAR (② denetçileri öncelikle buraya baksın)

1. **`backup-scheduler.ts:102` — damga İŞİN BAŞINDA + iş idempotent DEĞİL.** `setLastRun(now)` `runBackupJob`'tan önce. Beceri `state-and-scheduler.md §2(2)` şablonu: patlayan yedek o gün retry edilmez. Bilinçli takas (retry-spam) ve `BACKUP_FAILED` audit görünür → "sessiz atlama" DEĞİL. ② KARAR: takas kabul edilebilir mi, yoksa "başarısızlıkta damgayı geri al" gerekli mi? Sahada scheduler KAPALI (etki dev + scheduler açan müşteri). failure_mode adayı: *ayar okuma başarılı → damga yazıldı → pg_dump patladı → BACKUP_FAILED audit düştü ama o gün 15dk turları "bu gece koşmuş" deyip atlar; ertesi güne kadar yedeksiz.*

2. **`server.ts:22-34` + `ecosystem.config.js:47-48` — tek-process invariant MEKANİK BEKÇİSİZ.** 3 yerde belgeli, `test_single_process` yok. **CANLI KANIT**: dev DB'de çift-nightly yarışı ölçüldü (`2026-08-24 03:27:18` BACKUP_FAILED+COMPLETED aynı dosya 8ms; `2026-08-23 03:14:24` iki COMPLETED). §5 kuralı: bulgu = invariant bekçisiz. failure_mode adayı: *biri `instances:"max"` yaparsa presence parçalanır, feature-flag cache process-local bayatlar, gece yedeği çift pg_dump + rename ENOENT — hiçbir test kırmızı vermez.*

3. **`archive-scheduler.ts:78` + `audit.service.ts:233-261` — arşiv purge yolu.** `SET LOCAL teks.audit_purge` sırası load-bearing; audit_guard AÇIKKEN tek meşru silme kapısı. ② doğrulasın: (a) `SET LOCAL`'in interactive tx client'ında gerçekten aynı oturumda koştuğu (Prisma+adapter-pg), (b) 200-batch × 5000 tavanının 1M+ eski log senaryosunda tek turda bitmemesi durumunda davranış. **CANLI**: saha/dev'de 0 eski satır → yol prod'da hiç koşmadı, yalnız `test_audit_depth §10.4` fixture ile kanıtlı.

4. **`audit.service.ts:230-233` (arşiv tx) vs `20260819161000_audit_tamper_guard`** — SAHA'da `teks.audit_guard` **kapalı** ölçüldü (`current_setting`=`<null>`, `pg_db_role_setting`'de audit_guard SET yok). SURUM-2.9.0 §7b "ELLE AÇ" adımı (`ALTER DATABASE ... SET teks.audit_guard='on'`) prod'da HENÜZ uygulanmamış görünüyor. ② + K-diğer: audit değiştirilemezliği canlıda fiilen KAPALI (arşiv purge yolu bundan bağımsız çalışır; ama koruma yok). `MEMORY.md` "ZORUNLU ops §7b" ile örtüşür.

5. **`offsite-sweeper.ts` (watchdog yok) + F-OPS-VER-003 AÇIK.** Süpürücünün `running` reentry bayrağı var ama backup/archive'deki 3sa watchdog YOK; tek koruma child 3sa timeout. rclone `error` yerine asılırsa (soket) timeout SIGKILL'ler → finally `running=false`. ② teyit: `runProcess` timeout'u rclone'un tüm asılma modlarını (auth beklemesi, ağ) kapsıyor mu. Sahada rclone kurulu değil (offsite kapalı).

6. **`backup.service.ts:222` saniye-çözünürlüklü dosya adı (`stamp`).** Çift-process (hotspot 2) veya aynı saniyede iki manuel+nightly tetik aynı `.part` adına yazar → rename yarışı (dev'de ENOENT ölçüldü). `running` bayrağı tek-process'te korur; çok-process'te korumaz. ② için hotspot 2 ile birlikte.

7. **`installation-identity.job.ts:95-108` — BOZUK kimlik onarım döngüsü.** Dev'de **15 kez** `INSTALLATION_ID_REGENERATED` (`old:{"bozuk":"veri"}`) ölçüldü — bir test/fixture sürekli bozuk değer yazıp job her boot yeniliyor. Prod'da tehlike değil (yalnız dev gürültüsü) ama ② `parseStored` bozuk-değer dalının prod'da bir yazma yarışıyla tetiklenip tetiklenemeyeceğini doğrulayabilir (her yenileme istemcilere "farklı kurulum" onayı sordurur).

---

## SINIR ÖTESİ NOTLAR

- **K7/Gözlemlenebilirlik & audit:** `audit_guard` SAHA'da KAPALI (canlı ölçüm: `current_setting('teks.audit_guard')`=null, `pg_db_role_setting`'de SET yok). ISO 27001 A.8.15 koruması fiilen devre dışı; SURUM-2.9.0 §7b elle adımı beklemede. Arşiv tablosu (`system_log_archives`) saha+dev'de **0 satır**.
- **K-Havuz/DB (O3):** `runProcess` child'ları pg_dump/pg_restore/rclone `PG_SESSION_OPTIONS`/`transactionOptions`'tan bağımsız; ama `db-copy.service` `statementTimeoutMs:0` ile restore koşuyor (`:501,569,623,728`) — uzun DDL. K-DB denetçisi bakabilir.
- **K-İzin/Kimlik:** `permission-catalog.job` zinciri Admin dışı 403 sınıfını üretir (boot'ta patlarsa yeni izinler DB'de yok). `role-template` FK sırası. `session-registry.purgeDeadSessions` manuel bakım. `SESSION_REGISTRY_LOCK_NS=8024` advisory namespace envanteri (`session-registry.service.ts:28-32`).
- **K-Mimari/katman:** `job-failure.ts` → `AuditService` + `pool-health` (lib) çağırıyor — job katmanından servise+lib'e; temiz. `offsite-backup.helper.ts` adı "helper" ama child process spawn + rclone config yazımı yapıyor (§7.5 "helpers tuzağı"); ② mimari denetçisi bakabilir — ama tek çağıranı `offsite-sweeper` ve `admin.routes`, kilit almıyor.
- **K-Şema/veri:** `EndpointLatencyDaily.day` `@db.Date` (O-11 tek istisna, `constants/time.ts:154` notu). `system_log_archives` şeması sıcak tabloyla tip-paritesi tutmalı (deviceId TEXT — 22P02 regresyonu geçmişi).
- **Genel:** dev `system_logs` 152.892 satır/103MB = TEST KALINTISI (KUNYE ile uyumlu); saha 10.485/6.6MB gerçek. Rapor sorguları saha'da koşuldu.

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod erişimi YOK** — yalnız `tekserp_saha_0825` (2026-08-25 kopyası, 190 migration). Son 5 migration sonrası davranış (varsa) bu kopyada görünmez. `audit_guard`/backup damga durumu bu snapshot'ın anıdır; canlıda §7b uygulanmış olabilir (doğrulanamadı).
- **Sahada scheduler davranışının runtime kanıtı sınırlı**: `BACKUP_SCHEDULE_ENABLED=false` olduğu için backup-scheduler sahada HİÇ koşmuyor; gece yedeğini `yedekle.ps1` alıyor (o script repoda bulunamadı — `find yedekle.ps1`=0 sonuç; yalnız DEPLOY-RUNBOOK'ta referans). rclone offsite sahada kurulu değil → offsite-sweeper runtime yolu ölçülemedi.
- **Windows pm2 IPC shutdown / hard-kill** davranışı (goodbye paketi, .part temizliği) yalnız kod+yorumdan okundu; gerçek Windows kapanış davranışı test edilemez (darwin ortam).
- **`pg_db_role_setting` audit_guard yorumu [VARSAYIM]**: SET satırının olmaması "kapalı" demek; ama role-level (`pg_db_role_setting` role bazlı da olabilir) veya `postgresql.conf` üzerinden ayarlanmış olma ihtimali snapshot'ta tam elenmedi — `current_setting`=null bunu güçlü destekler ama canlı ≠ snapshot.
- **archive/backup gerçek büyük-veri davranışı** (1M+ eski log, 200-batch tavanı aşımı) canlıda 0 eski satır olduğu için hiç tetiklenmemiş — yalnız fixture bekçisiyle kanıtlı.
