# 08 — Deploy Topolojisi (yüzey haritası)

> Bu bir **planlama** belgesidir: bulgu raporlamaz, denetimin nereye bakacağını belirler.
> Salt-okuma keşif. Her sayısal iddianın altında onu üreten komut vardır (bkz. §12).
> Kod tabanı: `/Users/oad/Documents/projeler/AdnanSahin/Teks-Erp`
> Tarih: 2026-08-09 · Repo: `git@github.com:oguzhandemirc/TeksERP.git`, branch `main`

---

## 1) Özet — üç ayrı dağıtım yolu var, biri canlı

| Yol | Durum | Kanıt |
|---|---|---|
| **pm2 (Windows sunucu)** | **CANLI** — sahadaki gerçek kurulum | `ecosystem.config.js` + `docs/ops/DEPLOY-RUNBOOK.md` "SAHADAKİ KURULUM" tablosu (SAHINSRV, 192.168.1.250) |
| **Docker Compose** | Repo'da tam ve çalışır durumda; alternatif olarak konumlanmış | `Dockerfile`, `docker-compose.yml`, `docker/entrypoint.sh`, `installer/docker/yonet.ps1`, `baslat.sh` |
| **Native Windows installer (setup.exe + NSSM)** | **KALDIRILDI** (2026-07-30) | `installer/windows/` dizini yok; `installer/` altında yalnız `docker/` var (`ls installer/`) |

**Deployment CD DEĞİL, elle yapılıyor.** `.github/workflows/ci.yml` içinde deploy/release job'ı yok
(6 job'ın hiçbiri artefakt yayınlamıyor veya sunucuya bağlanmıyor). Sunucuda `git pull` →
`npm install` → `prisma generate` → `npm run build` → `prisma migrate deploy` → `pm2 restart`
sırası **elle** koşuluyor (`docs/ops/DEPLOY-RUNBOOK.md §3`).

**En önemli iki yapısal gerçek:**
1. **Tek process** (`exec_mode: "fork"`, `instances: 1`) — bu bir performans tercihi değil,
   kodun bağlı olduğu bir **invariant**. Bellek-içi durum tutan en az 9 modül var (§9).
2. `Teks-Erp/.env` **git'te izleniyor** (`git ls-files` doğruladı) — runbook §1 "git'e GİRMEZ"
   diyor, gerçek bunun tersi (§7.4). Denetimin ilk bakacağı yer burası.

---

## 2) PM2 — `Teks-Erp/ecosystem.config.js` (7.763 byte, 141 satır)

### 2.1 Kesin değerler

| Alan | Değer | Not |
|---|---|---|
| **Uygulama sayısı** | **1** (`apps` dizisinde tek nesne) | `name: "tekserp-backend"` |
| `script` | `dist/server.js` | `dist/src/server.js` DEĞİL (dosyada yorumla vurgulanmış) |
| `cwd` | `__dirname` | `public/`, `assets/fonts/`, `package.json`, `.env` bu dizine göre çözülüyor |
| **`exec_mode`** | **`"fork"`** | cluster DEĞİL |
| **`instances`** | **`1`** | |
| `shutdown_with_message` | `true` | Windows'ta SIGTERM olmadığı için IPC "shutdown" mesajı; `server.ts:149` dinliyor |
| `kill_timeout` | `8000` (ms) | `server.ts` kendi içinde 5.000 ms'de zorla çıkıyor (`server.ts:114-117`) |
| `restart_delay` | `4000` (ms) | |
| `autorestart` | `true` | |
| `max_restarts` | `10` | |
| **`max_memory_restart`** | **`"1G"`** | |
| `out_file` | `C:/Etkili-Yazilim/logs/backend-out.log` | |
| `error_file` | `C:/Etkili-Yazilim/logs/backend-err.log` | |
| `time` | `true` | pm2 satır başına zaman damgası |
| **`watch`** | **anahtar YOK** | pm2 varsayılanı `false` — üretimde watch kapalı (doğru), ama dosyada açıkça yazılmamış |
| **`cron_restart`** | **anahtar YOK** | periyodik zorunlu restart yok |
| `instance_var`, `env_production`, `merge_logs`, `min_uptime`, `listen_timeout` | YOK | `--env production` ile başlatılırsa `env_production` bulunamaz; `env` bloğu taban olarak kalır |

### 2.2 `env` bloğu — aktif 10 anahtar

| Anahtar | Değer |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ENV` | `production` |
| `PORT` | `4000` |
| `HOST` | `0.0.0.0` (fabrika ağındaki tabletler erişsin diye) |
| `BACKUP_SCHEDULE_ENABLED` | `false` (gece yedeğini bağımsız Windows Görev Zamanlayıcı alıyor) |
| `BACKUP_DIR` | `C:/Etkili-Yazilim/backups` |
| `BACKUP_RETENTION_DAYS` | `30` |
| `BACKUP_OFFSITE_DIR` | `""` (BOŞ — tüm yedekler DB ile aynı diskte) |
| `BACKUP_HOUR` | `3` (yalnız fallback; yetkili kaynak `SystemSetting backup.hour`) |
| `PG_BIN_DIR` | `C:/Etkili-Yazilim/pgsql/bin` |

**Yorum satırında bırakılmış 5 anahtar** (aktif değil): `PGDATA_DIR`, `PG_MAINTENANCE_DB`,
`PG_RESTORE_JOBS`, `BACKUP_PG_USER`, `BACKUP_PG_PASSWORD`.

**Sır yok:** dosya git'te tutuluyor ve `DATABASE_URL` / `JWT_SECRET` bilinçli olarak `.env`'de
bırakılmış (dosya başındaki uyarı bloğu). Bu ayrım tasarım olarak doğru — ama `.env`'in de
git'te olması ayrımı fiilen çürütüyor (§7.4).

### 2.3 Dosyanın kendi içinde yazdığı iki operasyonel ön koşul

- `C:\Etkili-Yazilim\logs` klasörü **önceden var olmalı** — pm2 log dizinini oluşturmaz.
- `PG_BIN_DIR` sunucudaki PostgreSQL'in **major sürümüyle** eşleşmeli; eskiyse `pg_dump`
  çalışmayı reddeder.

---

## 3) Docker — 2 servis, healthcheck yalnız birinde

### `docker-compose.yml` (55 satır)

| Servis | İmaj | Port | Healthcheck |
|---|---|---|---|
| `postgres` (`tekserp-postgres`) | **`postgres:16-alpine`** | dışarı **açılmıyor** (yorum satırında) | **VAR** — `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`, `interval 5s`, `timeout 5s`, `retries 20` |
| `backend` (`tekserp-backend`) | yerel build (`Dockerfile`) | **`4000:4000`** (host'a açık) | **YOK** |

- `restart: unless-stopped` (ikisinde de), `depends_on: postgres: condition: service_healthy`.
- Postgres `command` ile: `statement_timeout=50s`, `idle_in_transaction_session_timeout=300000`.
- Volume: `pg_data`, `app_data`, ayrıca `./backups:/backups` bind mount.
- Backend env: `NODE_ENV=production`, `PORT`, `TZ=Europe/Istanbul`, `DATABASE_URL` (compose
  değişkenlerinden kuruluyor), `JWT_SECRET`. **`APP_ENV` YOK** (bkz. §7.3 Swagger asimetrisi).

### `Dockerfile` (34 satır) — 3 stage

1. `deps` (`node:22-alpine`): `npm ci` + `npx prisma generate`. **`--omit=dev` yok** → devDependencies
   de imaja giriyor.
2. `build`: `npx tsc`.
3. `runtime` (`node:22-alpine`): `tini`, `openssl`, `libc6-compat`, `tzdata`, **`postgresql16-client`**;
   `TZ=Europe/Istanbul`; `EXPOSE 4000`; `ENTRYPOINT ["/sbin/tini","--","/usr/local/bin/entrypoint.sh"]`.
   **`USER` direktifi YOK** → container root olarak koşuyor.

### `docker/entrypoint.sh`

Üç adım: (1) `prisma migrate deploy` — başarısız olursa `_prisma_migrations`'tan yarım kalan
migration'ı bulup `CONCURRENTLY` içeriyorsa `psql` ile elle uygulayıp `migrate resolve --applied`
çağıran **20 denemelik döngü**; (2) `/app/data/.seeded` işaretçisi yoksa `npm run seed` +
`scripts/seed-label-templates.sql`; (3) `exec node dist/server.js` (pm2 yok — burada da tek process).

---

## 4) `deploy/` ve `installer/`

- **`deploy/`** — tek dosya: `prisma.config.prod.js` (1.331 byte). Sunucuda `npm ci --omit=dev`
  yapıldıysa kökteki TypeScript `prisma.config.ts` yüklenemez (ts-node devDependency) → bu düz JS
  kopya `prisma.config.js` olarak kopyalanır. `migrations.seed` **bilinçli olarak yok** (üretimde seed koşmaz).
- **`installer/`** — yalnız `docker/` alt dizini: `README-DOCKER.md` (5.962 byte) + `yonet.ps1`
  (8.061 byte; `up|down|restart|status|logs|backup|restore|update` eylemleri).
  ⚠️ `README-DOCKER.md` hâlâ `installer/windows/` (setup.exe) yolunu **önerilen** olarak anlatıyor;
  o dizin artık yok → **doküman bayat**.
- Kök `Teks-Erp/baslat.sh` (4.144 byte): Mac/Linux için tek-tuş Docker başlatıcı; ilk çalıştırmada
  `.env.docker`'ı rastgele şifre/secret ile üretiyor.

---

## 5) CI — `.github/workflows/ci.yml` (10.592 byte, 257 satır)

Tetikleyici: `push` → `main`, `pull_request` → `main`, `workflow_dispatch`.
İzinler: `contents: read`, `pull-requests: write`.

**6 job:**

| Job | Ne koşuyor | Bloklar mı |
|---|---|---|
| `docs` | `node scripts/check-docs.mjs`, `node scripts/check-migrations.mjs` | Evet |
| `backend` | `npm ci` → `prisma generate` → `prisma migrate deploy` → `npm run seed` → `npm run seed:fixtures` → `npm run lint` → `npx tsc --noEmit` → `npm run typecheck:scripts` → **`npm test`** (postgres:16 service container, `teks_ci` DB) | Evet |
| `load-test` | `npm run test:load` (ayrı postgres service) | **Hayır** (`continue-on-error: true`) |
| `electron` | lint + `tsc --noEmit` + Vitest | Evet |
| `mobile` | expo lint + `tsc --noEmit` + jest-expo | Evet |
| `e2e` | `xvfb-run npm run e2e` (Playwright + Electron) | **Hayır** (`continue-on-error: true`) |

- Backend job'ında `JWT_SECRET: ci-test-secret-not-for-production` ve `DATABASE_URL` düz metin —
  CI'ya özel, sorun değil.
- Hata durumunda backend logunun son 150 satırını PR'a yorum olarak yazan teşhis adımı var.
- **CI deploy YAPMAZ.** Artefakt (dist, APK, Electron kurulumu) üretilmiyor, sürüm etiketlenmiyor.

---

## 6) Deploy prosedürü — dokümanlar

`docs/ops/` altında **12 dosya** var. Deploy açısından yetkili olanlar:

| Dosya | İçerik |
|---|---|
| **`docs/ops/DEPLOY-RUNBOOK.md`** (552 satır) | **Kanonik runbook.** Sahadaki yetkili değerler tablosu; ön koşullar; env ayrımı; ilk kurulum; **§3 güncelleme**; §4 sağlık; §5 yedek/geri yükleme; §6 postgresql.conf; §7 reboot kalıcılığı; §8 log konumları; §9 rollback; §10 güvenlik duruşu; §11 deploy provası |
| `Teks-Erp/MIGRATION-DEPLOY.md` (168 satır) | Migration'a özgü: standart sıra (runbook §3 ile birebir olduğu iddia ediliyor), elle yazılan migration'ın `db execute` + `migrate resolve` yolu, index-ağırlıklı migration'ların vardiya dışında koşturulması |
| `docs/ops/KURULUM.md` (193 satır) | Sıfırdan fabrika kurulumu (sunucu + Electron PC + Android tablet + donanım) |
| `docs/history/PM2-GECIS-DEVIR-NOTU.md` | pm2'ye geçişin devir notu — runbook onu "deploy talimatı ve doğrulama listesi" olarak işaret ediyor |
| `docs/ops/URETIM-KONTROL-LISTESI.md` | Deploy öncesi madde-madde kontrol |
| `SURUM-2026-07-30/07-31/08-03/08-05/08-06-*.md` (5 dosya) | Sürüme özel deploy notları |
| `docs/ops/KURSUN-BYPASS-DEPLOY.md`, `PLAY-STORE-YAYIN.md`, `RASTER-F6-FIZIKSEL-CHECKLIST.md` | Özellik/platform bazlı |

### Güncelleme sırası (runbook §3, birebir)

```
(0) Migration ÖNCESİ yedek al — ELLE (otomatik premigrate_* artık üretilmiyor)
git pull
npm install
npm run prisma:generate
npm run build
npm run prisma:migrate        # = prisma migrate deploy
pm2 restart tekserp-backend
# seed YOK
```

### Sahadaki yetkili değerler (runbook tablosu)

PostgreSQL **16.9**, servis `postgresql-tekserp`, port **5432**, UTF8 / **C locale**;
DB/kullanıcı **`tekserp`**; backend `C:\Etkili-Yazilim\tekserp\Teks-Erp`, pm2 adı **`tekserp-backend`**;
pm2 daemon **SYSTEM** hesabında (pm2 komutları yönetici shell ister); boot `TeksERP-Backend-Boot`
görevi → `pm2 resurrect`; gece yedeği `TeksERP-DB-Backup` görevi 02:00, 30 gün saklama.

### Rollback

Runbook §9: **`prisma migrate deploy` geri alınmaz** (Prisma down-migration üretmez).
Tek yol migration öncesi yedekten restore + gerekirse kodu eski commit'e almak.
Migration öncesi yedek **elle** alınacak; panelden alınan yedek `tekserp_*` adıyla doğar ve
**rotasyona dahildir** → kalıcı olması için `premigrate_*` adına elle yeniden adlandırılmalı.

---

## 7) Ortam değişkenleri

### 7.1 Merkezî config modülü YOK, zod şeması YOK

`src/config/` altında env okuyan tek dosya `swagger.ts` (`NODE_ENV`); diğerleri
(`currencies`, `label-*`, `traveler-card-fields`) statik katalog. Yani **merkezî bir
env/config modülü yok** — env doğrudan tüketildiği yerde okunuyor: `src/` içinde
**32 `process.env` erişimi** (31'i adlandırılmış `process.env.X`, 1'i `{...process.env}`
yayılımı), **11 dosyaya** dağılmış:
`app.ts` · `server.ts` · `config/swagger.ts` · `lib/prisma.ts` · `jobs/backup-scheduler.ts` ·
`services/backup.service.ts` · `services/auth.service.ts` · `services/system-setting.service.ts` ·
`services/helpers/pg-tool.helper.ts` · `services/helpers/pg-admin-client.ts` · `services/db-copy.service.ts`.
Zod ile env şeması **yok**.

### 7.2 Eksik env'de ne olur — üç davranış sınıfı

| Sınıf | Değişken | Davranış |
|---|---|---|
| **AÇILIŞTA PATLAR (fail-closed)** | `DATABASE_URL` | `src/lib/prisma.ts:18` — `throw new Error("DATABASE_URL environment variable is not set.")`, modül yükleme anında |
| **AÇILIŞTA PATLAR (fail-closed)** | `JWT_SECRET` | `src/services/auth.service.ts:35-45` — yok **veya < 32 karakter** ise throw; `const JWT_SECRET = loadJwtSecret()` modül seviyesinde çağrılıyor → import zinciri boot'ta patlar |
| **SESSİZCE undefined ile devam** | `PORT`(→4000), `HOST`(→0.0.0.0), `NODE_ENV`, `APP_ENV`, `BACKUP_DIR`, `BACKUP_OFFSITE_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_HOUR`, `BACKUP_SCHEDULE_ENABLED`, `PG_BIN_DIR`, `PGDATA_DIR`, `PG_MAINTENANCE_DB`, `PG_RESTORE_JOBS`, `BACKUP_PG_USER`, `BACKUP_PG_PASSWORD` | Varsayılana düşer veya özellik sessizce devre dışı kalır |

`BACKUP_DIR` boşluğu kısmen görünür kılınmış: `jobs/backup-scheduler.ts:124` uyarı log'luyor,
`app.ts:152` durum sayfası için `lastBackup: null` döndürüyor, panelde kırmızı kutu var.
Diğerlerinde böyle bir yüzey **yok** (örn. `PG_BIN_DIR` yanlışsa yalnız yedek anında patlar).

### 7.3 `NODE_ENV` vs `APP_ENV` asimetrisi — denetim hedefi

- `src/app.ts:107` → `isProd = (APP_ENV ?? NODE_ENV) === "production"` (morgan formatı).
- `src/config/swagger.ts:64` → `if (process.env.NODE_ENV === "production") return;` — **yalnız NODE_ENV**.

pm2 ortamında ikisi de `production` (sorun yok). Docker compose'ta yalnız `NODE_ENV=production`
var (yine sorun yok). Ama `APP_ENV=production` + `NODE_ENV` boş bir kurulumda **morgan üretim
formatına geçer, Swagger UI açık kalır**. Bugün böyle bir kurulum olduğuna dair kanıt yok →
bu bir **kırılganlık işareti**, bulgu değil.

### 7.4 `.env` git'te izleniyor — KESİN

```
git ls-files --error-unmatch .env      → .env          (izleniyor)
git check-ignore -v .env               → çıktı yok     (index'te olduğu için .gitignore uygulanmıyor)
git log --oneline -- .env              → 3 commit (en yenisi: "chore(env): ... JWT secret rotasyonu")
```

Dosyanın taşıdığı anahtarlar: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `BACKUP_DIR`, `BACKUP_OFFSITE_DIR`.
(Değerler bu belgede basılmadı.) Metadata: `DATABASE_URL` localhost/127.0.0.1 içeriyor (yani
**geliştirme** bağlantısı), `JWT_SECRET` 45 karakter (32 eşiğini geçiyor).

`.gitignore` `.env`, `.env.local`, `.env.docker`, `.env.*.local`, `.env.bak*`, `.env.backup*`,
`.env.save`, `.env.orig` kalıplarını içeriyor — ama **`.env` zaten index'te olduğu için kalıp
etkisiz**. Bir sonraki `git add -A` dosyanın o anki içeriğini commit'ler.

**Denetimin sorması gerekenler:** (a) sahadaki `tekserp` sunucusundaki `JWT_SECRET` ile repo'daki
aynı mı (repo'dan cevaplanamaz → **ŞÜPHELİ**); (b) aynıysa repo'ya erişimi olan herkes canlı JWT
üretebilir; (c) `git rm --cached .env` + secret rotasyonu gerekiyor mu.

---

## 8) `/health` — ne ölçüyor

`src/app.ts:285-387`, **kimlik doğrulaması YOK** (rate-limit/auth `/api` altında; `/health` kök seviyede).
**Her zaman HTTP 200** döner — DB düşse bile (`db: "DOWN"` alanıyla söyler).

Tek `$queryRaw` round-trip ile (tablo taraması yok, in-memory stat view'ler):

| Alan | Kaynak |
|---|---|
| `dbSizeBytes` | `pg_database_size(current_database())` |
| `dbConnections` | `pg_stat_activity` sayımı (sunucu tarafı; psql/pgAdmin/pg_dump dahil) |
| `cacheHitPct` | `pg_stat_database` blks_hit oranı |
| `rollsDeadPct` | `pg_stat_user_tables` (`relname='rolls'`) ölü satır oranı |
| `longestQuerySec` | en uzun aktif client backend sorgusunun yaşı |
| `dbBlockedCount` | `wait_event_type='Lock'` oturum sayısı |
| `restoreCopyCount` / `restoreCopyBytes` | `<db>_restore_%` adlı unutulmuş kopyalar |

Ek olarak: `version` (package.json), `uptimeSec`, `lastBackup` (BACKUP_DIR taraması, 30 sn cache),
`auditWriteFailures` + `lastAuditError` + `lastAuditFailureAt`, disk metrikleri
(`readAppDiskMetrics`), presence (`activeUsers`/`activeDevices`), kaynak metrikleri
(CPU/RAM/event loop lag).

### Pool metrikleri — VAR (`src/lib/pool-health.ts`, `getPoolHealth()`)

`poolMax` (30), `poolTotalCount`, `poolIdleCount`, `poolWaitingCount`, **`poolWaitingMax`**
(yüksek-su işareti, okumada sıfırlanmaz), **`poolConnectsTotal`** (soğuk connect sayacı),
**`poolAcquireTimeouts`**, `lastPoolTimeoutError`, `lastPoolTimeoutAt`.
Senkron getter'lar — sorgu yok, DB DOWN iken de doğru.

**Kapsam boşluğu (dosyanın kendi yazdığı):** `poolAcquireTimeouts` sayacı **yalnız HTTP hata
yolundan** (error.middleware) artar; zamanlayıcı işlerindeki (backup/archive scheduler) havuz
zaman aşımı sayaçta **görünmez**. Ayrıca sayaçlar process-local, restart'ta sıfırlanır.

---

## 9) KRİTİK SORU: kaç instance? — **KESİN CEVAP: 1**

`ecosystem.config.js:47-48`:
```js
exec_mode: "fork",
instances: 1,
```
Docker yolunda da tek process (`entrypoint.sh` sonunda `exec node dist/server.js`, pm2 yok).
`server.ts:37-49`'da bu bir **"TEK-PROCESS INVARIANT — pazarlık dışı"** bloğuyla dokümante edilmiş.

**Cluster mode KULLANILMIYOR** → "cluster'da şüpheli" sorusu bugün için kapalı. Ama denetimin
asıl sorusu tersidir: **bu invariant kırılırsa ne sessizce bozulur?** Süreç-yerel durum tutan
modüller (grep ile bulundu, dosya adı + satır):

| Modül | Durum | Kırılma biçimi |
|---|---|---|
| `src/lib/presence.ts:16-17` | `users`, `devices` Map'leri | online sayımı parçalanır |
| `src/services/system-setting.service.ts:831-835` | feature-flag agregat cache + `cacheGeneration` | invalidate process-local → 2. process bayat bayrakla çalışır |
| `src/jobs/archive-scheduler.ts:102` | `setInterval` + `lastRun` check-then-act | çift arşivleme |
| `src/jobs/backup-scheduler.ts:131` | `setInterval` + in-process `running` bayrağı | aynı gece iki `pg_dump` |
| `src/middlewares/login-lockout.ts:24` | `failCounts` Map (MAX_ENTRIES 5000) | kilit N katına kadar delinir |
| `src/lib/pool-health.ts` | `waitingMax`, `connectsTotal`, `timeoutState` | metrikler parçalanır |
| `src/middlewares/latency.middleware.ts` | endpoint gecikme sayaçları | ölçüm parçalanır |
| `src/services/audit.service.ts` | `getHealth()` failure sayaçları | `/health` eksik rapor |
| `src/middlewares/auth.middleware.ts` | `lastSeenWrites` Map (yorumda referans veriliyor) | doğrulanmalı — **ŞÜPHELİ**, bu keşifte dosya açılmadı |

Ayrıca: KK1 mükerrer koruması ve parti numarası üretimi **PostgreSQL advisory lock** kullanıyor
(`pg_advisory_xact_lock(8021,…)` / `(8022,1)`, kök CLAUDE.md) — yani eşzamanlılık koruması bazı
yerlerde DB seviyesinde, bazı yerlerde bellekte. Denetim bu **karışık modeli** haritalamalı.

---

## 10) Loglama

### Nereye yazılıyor

| Katman | Hedef |
|---|---|
| HTTP erişim log'u | `morgan` — üretimde `"combined"`, dev'de `"dev"` (`app.ts:107-108`) → **stdout** |
| Uygulama log'u | `console.log/error/warn/info` — `src/` içinde **78 çağrı** → stdout/stderr |
| pm2 yönlendirmesi | `C:/Etkili-Yazilim/logs/backend-out.log` + `backend-err.log`, `time: true` |
| PostgreSQL | `<pgdata>\log\`; üretimde `log_min_duration_statement=500` (slow query) |
| Uygulama-içi denetim | `SystemLog` tablosu (`AuditService`), 6 ayda bir `system_log_archives`'e taşınır |

### Rotasyon — **YOK (varsayılan)**

`ecosystem.config.js:70` ve runbook §8 açıkça yazıyor: **pm2 log rotasyonu yapmaz**,
`pm2-logrotate` modülü ayrıca kurulmalı (`max_size 10M`, `retain 14`). Modülün sahadaki sunucuda
gerçekten kurulu olup olmadığı **repodan doğrulanamaz → ŞÜPHELİ**; denetim `pm2 ls` çıktısını istemeli.
Docker yolunda ise log Docker'ın json-file driver'ına gider ve compose'ta `logging:` bloğu **yok**
→ orada da varsayılan sınırsız büyüme.

### Hassas veri sızıntısı taraması

- `console.*` içinde `password|passwordHash|jwt_secret|token|DATABASE_URL|PGPASSWORD|secret`
  geçen **0 eşleşme** (grep, `src/**/*.ts`).
- `pg-tool.helper.ts:46` şifreyi **`PGPASSWORD` env'i ile** geçiriyor, komut satırına yazmıyor
  (dosyada gerekçesi de yazılı: `ps` çıktısında görünmesin).
- `error.middleware.ts:265, 505` — stack'in ilk 8 satırı **audit'e** yazılıyor; HTTP yanıtına
  değil (yanıtlar sabit Türkçe mesaj). Doğrulanmalı: 500 gövdesinde `err.message` dönüyor mu
  (satır 504 bir `newData` alanı gibi görünüyor ama tam bağlam okunmadı) → **ŞÜPHELİ**.
- `AuditService.log()` `oldData`/`newData` alıyor ve **hiçbir maskeleme/redaction yok**
  (`audit.service.ts` içinde `redact|mask|sanitize|password` geçmiyor). `passwordHash` yalnız
  `auth.service.ts` ve `permission-management.service.ts`'te geçiyor ve ikincisi "passwordHash asla
  sızmaz" diye yorum düşmüş — **doğrulanmalı**: şifre değiştirme/kullanıcı oluşturma yollarında
  `newData` payload'ına hash düşüyor mu.
- **Docker yoluna özgü:** `entrypoint.sh` `psql "$DATABASE_URL"` çağırıyor → şifre **argv'de**,
  container içinde `ps` ile görünür; ayrıca `cat /tmp/migrate.out` migration çıktısını stdout'a basıyor.
- **morgan `combined`** tam URL'yi (query string dahil) log'lar. Query string'de token/şifre taşıyan
  bir uç var mı — bu keşifte taranmadı → **ŞÜPHELİ**, denetim listesine.

---

## 11) Denetimin bakacağı yerler (öncelik sırasıyla)

1. **`.env` git'te** (§7.4) — canlı `JWT_SECRET` ile repo'daki aynı mı? Rotasyon + `git rm --cached` gerekiyor mu? Geçmişten temizleme kararı.
2. **Tek-process invariant'ın gerçek yüzeyi** (§9) — 9 modülün tam listesi doğrulansın; hangisi advisory lock ile, hangisi yalnız bellekle korunuyor. `instances` yanlışlıkla artırılırsa hangi bozulma sessiz kalır?
3. **Log rotasyonu** (§10) — `pm2-logrotate` sahada kurulu mu? Değilse `C:\Etkili-Yazilim\logs` sınırsız büyüyor ve disk dolunca hem backend hem PostgreSQL etkilenir (aynı sunucu).
4. **Backend healthcheck yok** (§3) — Docker'da backend container'ı için healthcheck tanımlı değil; `/health` her koşulda 200 döndüğü için dış izleme DB kaybını **HTTP durum koduyla** göremez. İzleme gövdeyi parse ediyor mu?
5. **Migration + deploy sırası elle** (§6) — `git pull` ile `migrate deploy` arasında adım atlanırsa (örn. `prisma generate` unutulursa) davranış; ayrıca `build` başarısızken `pm2 restart` edilirse eski `dist/` çalışmaya devam eder mi ("deploy başarılı göründü ama kod eski").
6. **Rollback yolu** (§6) — migration öncesi yedek **elle** alınıyor ve panelden alınan yedek rotasyona dahil. Son N deploy'da gerçekten `premigrate_*` üretilmiş mi?
7. **`BACKUP_OFFSITE_DIR` boş** (§2.2) — tüm yedekler DB ile aynı diskte. Tek disk arızası = veri + yedek. Gece yedeğinin sahibi harici Görev Zamanlayıcı olduğu için backend bunu göremez.
8. **`NODE_ENV`/`APP_ENV` asimetrisi** (§7.3) — Swagger UI'nın üretimde kapalı kaldığının tek garantisi `NODE_ENV`'in tam `"production"` olması.
9. **Docker imajının üretim sertliği** (§3) — root user, devDependencies imajda, entrypoint'te `DATABASE_URL` argv'de, ilk açılışta otomatik `seed`. Docker yolu üretimde kullanılacaksa bunlar denetlenmeli; kullanılmayacaksa **repo'dan emekliye ayrılması** ayrı bir karar (bayat `README-DOCKER.md` hâlâ silinmiş `installer/windows/`'u öneriyor).
10. **`/health` kimlik doğrulamasız** (§8) — DB boyutu, bağlantı sayısı, disk, sürüm, son yedek **dosya adı**, online kullanıcı sayısı herkese açık. LAN-only duruşta kabul (runbook §10) ama dışa açılırsa doğrudan bilgi sızıntısı.
11. **Audit payload maskelemesi yok** (§10) — `oldData`/`newData` serbest JSON; hangi servisler tam entity yazıyor?
12. **CI ile üretim arasında sürüm farkı** — CI PostgreSQL **16** ile koşuyor, saha **16.9**, dev **18.4** (runbook §0). Yalnız 18'de test edilen raw SQL/index migration'ları için runbook "PG16 kopyasında deneyin" diyor; bu adım pratikte koşuyor mu?

---

## 12) Sayımların dayanağı (komut kaydı)

| İddia | Komut / kaynak |
|---|---|
| PM2 uygulama sayısı 1, exec_mode fork, instances 1, max_memory_restart 1G, watch/cron_restart yok | `ecosystem.config.js` **tam okundu** (141 satır) |
| Docker 2 servis, healthcheck yalnız postgres'te | `docker-compose.yml` tam okundu (55 satır) |
| Dockerfile 3 stage, USER yok, `--omit=dev` yok | `Dockerfile` tam okundu (34 satır) |
| `deploy/` 1 dosya, `installer/` yalnız `docker/` | `ls -laR deploy installer` |
| CI 6 job | `grep -nE "^  [a-z0-9-]+:$" .github/workflows/ci.yml` (7 eşleşmenin biri `push:`) |
| `docs/ops` 12 dosya | `ls -1 docs/ops \| wc -l` |
| DEPLOY-RUNBOOK 552 satır, MIGRATION-DEPLOY 168, KURULUM 193 | `wc -l` |
| Migration sayısı 154 dizin (+`migration_lock.toml` = 155 girdi) | `ls -1d prisma/migrations/*/ \| wc -l` = 154; `ls -1 prisma/migrations \| wc -l` = 155 |
| `src/` içinde 32 `process.env` erişimi, 11 dosya | `grep -rho "process\.env" src/ --include="*.ts" \| wc -l` = 32; `grep -rl "process\.env" src/ --include="*.ts" \| wc -l` = 11 |
| `src/` içinde 78 `console.*` çağrısı | `grep -rn "console\.\(log\|error\|warn\|info\)" src/ --include="*.ts" \| wc -l` |
| Hassas veri log grep'i 0 eşleşme | `grep -rniE "console\.(log\|error\|warn\|info)\(.*(password\|passwordHash\|jwt_?secret\|token\|DATABASE_URL\|PGPASSWORD\|secret)" src/` |
| `.env` izleniyor | `git ls-files --error-unmatch .env` → `.env`; `git check-ignore -v .env` → çıktı yok; `git log --oneline -- .env` → 3 commit |
| `.env` metadata (localhost, 45 karakter secret) | `grep -c`, `sed`+`wc -c` (değerler basılmadı) |
| DATABASE_URL/JWT_SECRET boot'ta patlatıyor | `src/lib/prisma.ts:16-20`, `src/services/auth.service.ts:35-46` |
| `/health` alanları + pool metrikleri | `src/app.ts:285-387`, `src/lib/pool-health.ts` (`PoolHealth` arayüzü 9 alan) |
| Tek-process invariant + bellek-içi modüller | `src/server.ts:37-49` + `grep` (presence, login-lockout, system-setting cache, schedulers) |

---

## 13) Bu keşifte AÇILMAYAN, denetimin açması gereken dosyalar

- `docs/history/PM2-GECIS-DEVIR-NOTU.md` ve `URETIM-KONTROL-LISTESI.md` (tam metin) — deploy doğrulama listesi.
- `src/middlewares/error.middleware.ts` tam metin — 500 yanıt gövdesinde ne dönüyor.
- `src/middlewares/auth.middleware.ts` — `lastSeenWrites` bellek-içi durumu.
- `src/services/backup.service.ts` tam metin — retention/offsite/verify akışı ve hata yolları.
- `src/lib/disk-health` (`readAppDiskMetrics` kaynağı) — `/health` disk alanlarının maliyeti.
- `scripts/run-all-tests.ts` — `npm test`'in gerçek kapsamı ve 180 sn timeout davranışı.
