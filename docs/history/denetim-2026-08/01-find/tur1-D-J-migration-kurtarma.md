# D-J — Migration & Kurtarma [P5] · ② BULMA · TUR 1

**Denetçi:** D-J (migration / deploy / DDL / yedek / geri yükleme)
**Tarih:** 2026-08-28 · dal `adnansahin` · **HEAD `0ed93d4b`** (⚠️ KUNYE.md `ce8681d1` diyor — ağaç denetim sırasında iki commit ilerledi; `0ed93d4b` = "sürümler 1.0.0'dan başlıyor", D-J-10'un konusu)
**Mercek:** kod merkezli (alan denetçisi) + kritik yazma yolu 8-soru (deploy zinciri bir "yazma yolu" olarak ele alındı)
**Kaynaklar:** `Teks-Erp/prisma/migrations/**` (195 dizin) · `Teks-Erp/MIGRATION-DEPLOY.md` · `docs/ops/DEPLOY-RUNBOOK.md` · `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md` · `docs/ops/KURULUM.md` · `deploy/kur.ps1` · `deploy/paketle.ps1` · `deploy/README.md` · `Teks-Erp/ecosystem.config.js` · `Teks-Erp/src/services/backup.service.ts` · `db-copy.service.ts` · `db-copy-verify.service.ts` · `src/jobs/backup-scheduler.ts` · `src/config/client-version-policy.ts` · `scripts/{test_db_invariants,test_schema_drift,test_migration_hygiene,run-all-tests,reset-operational,clean_test_residue,backfill_*,fix_*,repair_*}.ts` · `scripts/check-migrations.mjs` · `.github/workflows/ci.yml` · haritalar K2b · K9 · K4 §3 · K8 · K12 §3 · SINIR-OTESI §J
**DB ölçümü:** yalnız `audit/tools/sql-saha.sh` (prod'un 2026-08-25 kopyası `tekserp_saha_0825`) ve `sql-dev.sh`; ikisi de `default_transaction_read_only=on`. Repo altında hiçbir dosya değiştirilmedi; koşulan tek script salt-okunur `node scripts/check-migrations.mjs` (git durumu okur, çıkış 0).

---

## 0. Bir bakışta

| # | Bulgu | Şiddet | Öncelik | Kanıt |
|---|---|---|---|---|
| D-J-01 | Fabrikaya çıkan `adnansahin` dalı CI'dan HİÇ geçmiyor — 33 migration + 140 commit "boş DB'ye `migrate deploy` + `npm test`" görmedi | S2 | P1 | K1 |
| D-J-02 | `kur.ps1` her kurulumda `ecosystem.config.js`'i paketinkiyle EZER → sunucudaki yedek/offsite/scheduler ayarları sessizce repo değerlerine döner | S1 | P0 | K2 |
| D-J-03 | Gece yedeğini fiilen alan `yedekle.ps1` **repoda yok** — sürüm kontrolü, bekçi, bütünlük doğrulaması, min-keep koruması ve offsite kopyanın hiçbiri o yolda koşmuyor | S1 | P0 | K2 |
| D-J-04 | Offsite + PITR yok; RPO/RTO on-prem için yazılı değil (F-OPS-VER-003 / Y-4 taze kanıtla AÇIK) | S1 | P1 | K2 |
| D-J-05 | Geri yükleme TATBİKATI hiç yapılmamış — prod'da 0 `DB_COPY_*` audit kaydı (O-17 açık) | S1 | P1 | K2 |
| D-J-06 | Başarısız `migrate deploy` sonrası kurtarma reçetesi YOK (P3009 / `migrate resolve --rolled-back` hiçbir ops belgesinde geçmiyor) | S2 | P1 | K1 |
| D-J-07 | `ALTER TYPE … ADD VALUE` 10 migration'da `IF NOT EXISTS`siz + prod'da **defter dışı enum değeri** kanıtı → gelecekteki bir defter-dışı DDL deploy'u geri-alınamaz eşikte kilitler | S2 | P2 | K2 |
| D-J-08 | Yumuşak kapı enforce adımının sahibi/tarihi/tetiği yok; `items_nameFold_key` sahada HÂLÂ eksik; tek sinyal kalıcı kırmızı bekçi (kırmızı körlüğü) + iki bekçi aynı duruma zıt karar veriyor | S2 | P2 | K2 |
| D-J-09 | `test_migration_hygiene` "dizinde var / DB'de yok"u **UYARI** basar (exit 0) → `migrate deploy`ün hiç koşmadığı durum deploy-sonrası doğrulamada YEŞİL görünür | S2 | P2 | K2 |
| D-J-10 | Sürüm sıfırlaması (2.9.x → 1.0.0) mobil sürüm kapısını sahadaki tabletler için kalıcı etkisizleştirdi; ikinci eksen (`minPaketTarihi`) de tanımsız; bekçi yalnız Electron'u ölçüyor | S2 | P2 | K1 |
| D-J-11 | `reset-operational.ts` 30+ tabloyu `TRUNCATE … CASCADE` ediyor: dry-run yok, `--apply` yok, DB-adı/prod kapısı yok, onay yok, audit yok — kök `CLAUDE.md` kuralının doğrudan ihlali | S2 | P2 | K1 |
| D-J-12 | `auditGuard` alanı üretiliyor ama **hiçbir istemci okumuyor**; bekçi yalnız `app.ts` içinde metin arıyor → "kalıcı görünürlük yüzeyi" fiilen yok; tam-kayıp restore'unda per-DB GUC'lar sessizce kaybolur | S2 | P2 | K1 |
| D-J-13 | `CREATE INDEX CONCURRENTLY` 0/621 · `lock_timeout` 0 · `SET statement_timeout=0` 34/195 → büyümede tek koruma yazılı "vardiya dışı" kuralı; Prisma tek-tx semantiği CONCURRENTLY'yi zaten imkânsız kılıyor ve bu yazılı değil | S3 | P3 | K1 |
| D-J-14 | `Teks-Erp/CLAUDE.md:64` `npx prisma migrate dev`i normal komut olarak listeliyor; `MIGRATION-DEPLOY.md:93` onu YASAK ilan ediyor — dev DB fabrika kopyası taşıyor | S3 | P4 | K1 |
| D-J-15 | İki backfill scripti parçalı DEĞİL (tek dev `UPDATE` / tam-tablo korelasyonlu `UPDATE`); `backfill-record-provenance` dry-run'ı yalnız SAYI basıyor (kural "her kaydı listeler" diyor) | S3 | P4 | K1 |
| D-J-16 | `20260611084953_native_uuid_pk_fk` dolu DB'de veri kaybı üretir (`DROP COLUMN id`); yeni müşteri kurulumunda "önce içe aktar, sonra migrate" sırası bunu tetikler; kapı yok | S3 | P4 | K1 |
| D-J-17 | Ölü `Teks-Erp/yedekle.sh` (Docker dönemi, 7 gün saklama, panelin göremeyeceği `.sql.gz`) repoda duruyor — sahadaki `yedekle.ps1` ile karıştırılmaya açık | S4 | P6 | K1 |

**Şiddet dağılımı:** S1 ×4 · S2 ×7 · S3 ×5 · S4 ×1. **S0 YOK** — S0 için K2/K3 zorunlu ve hiçbir bulguda "veri şu an bozuk" ölçümü yok; en ağır olanlar (yedek zinciri) *potansiyel* kayıp taşıyor, fiili kayıp değil.

---

## 1. BULGULAR

### [D-J-01] Fabrikaya çıkan dal (`adnansahin`) CI'dan hiç geçmiyor — 33 migration "boş DB'ye uygulanır mı" testini hiç görmedi

| Şiddet | S2 | Kategori | J (migration sürümleme / prova) | Öncelik | P1 | Modül | deploy/CI | Kanıt seviyesi | K1 |

**Özet.** `.github/workflows/ci.yml` yalnız `main`'e push ve `main`'e PR ile tetikleniyor. Fabrikanın sürümü `adnansahin` dalından paketleniyor (`deploy/README.md`, `docs/ops/DEPLOY-RUNBOOK.md §3`: paket `D:\tekserp-build\tekserp` klonunun ucundan üretilir) ve o dal `main`'in **140 commit önünde**; aradaki **33 migration** CI'nın "temiz PostgreSQL 16 + `prisma migrate deploy` + `seed` + 366 bekçi" adımını hiç görmedi. CI'nın en değerli tek işi tam da budur: migration zincirinin **sıfırdan boş bir DB'ye** hatasız uygulandığını her PR'da kanıtlar — bu, yeni bir müşteri kurulumunun (ve `20260611084953`'ün, D-J-16) tek mekanik provası.

**Kanıt.**
```
.github/workflows/ci.yml:9-13
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```
```
$ git rev-list --count main..adnansahin      → 140
$ git log --oneline -1 main                  → d816b32d (2026-08-06 civarı)
$ git diff --name-only main...adnansahin -- Teks-Erp/prisma/migrations | wc -l → 33
$ git ls-tree -d --name-only main Teks-Erp/prisma/migrations/ | wc -l         → 162
$ ls Teks-Erp/prisma/migrations | grep -c '^2'                                → 195
```
CI'nın backend job'ı gerçekten değerli adımları koşuyor (`ci.yml`: `migrate deploy` → `seed` → `seed:fixtures` → lint → `tsc` → `typecheck:scripts` → `npm test`) — sorun kapsam değil, **tetikleyici**.
Koruma teyidi: `main` dışı bir dal için başka tetikleyici yok (`workflow_dispatch` elle); repo kökünde `.husky` yok, `.git/hooks` altında örnek dışı hook yok (ölçüldü); `deploy/paketle.ps1` test/bekçi koşmuyor (yalnız `npm ci` → `prisma generate` → `tsc`); `deploy/kur.ps1` de koşmuyor.

**failure_mode.** `adnansahin`'e yazılan bir migration, daha önce uygulanmış bir migration'ın ürettiği bir nesneyi varsayarsa (ör. sırası bozuk iki dosya, ya da `IF NOT EXISTS`siz bir `ADD CONSTRAINT`) mevcut fabrikada sorunsuz koşar (o nesne zaten var) ama **boş bir DB'de zincirin ortasında düşer**. Bu, ancak ikinci bir müşteri kurulumunda ya da bir felaket sonrası sıfırdan kurulumda ortaya çıkar — yani tam olarak en kötü anda. Bugün fark edilmemesinin sebebi hata olmaması değil, kimsenin bakmıyor olması.

**Veride fiili ihlal (K2).** Aranmadı — bu bir süreç bulgusu; `_prisma_migrations` sağlıklı (saha 190/190 `finished_at` dolu, 0 `rolled_back`, 0 `applied_steps_count=0` — ölçüldü).

**İş etkisi.** İkinci müşteri kurulumu / felaket sonrası sıfırdan kurulum yolu mekanik olarak doğrulanmıyor. Ayrıca `test_db_invariants`, `test_schema_drift`, `test_consistency` gibi kritik bekçilerin sahaya giden koda karşı koştuğuna dair **otomatik** kanıt yok (sürüm notlarında elle koşum kayıtları var — `docs/history/SURUM-2026-08-25-DEPLOY.md:10`).

**Öneri (2. tur).** `ci.yml`'ye `branches: [main, adnansahin]` ekle (push + PR). Tek satır, davranış değişikliği yok. [PROD'DA ÇALIŞTIRMA gerekmez — repo değişikliği.] Geri alma: satırı geri al. Ek olarak `paketle.ps1`'e "paketlenen commit CI'da yeşil mi" sorgusu (opsiyonel, `gh run list`).
**Kabul kriteri.** `adnansahin`'e yapılan bir push CI'da yeşil koşar ve `Migrate deploy (tüm migration'ları uygula)` adımı 195 migration'ı boş DB'ye uygular.
**Efor.** 0,25 gün.
**Önceki defter.** Doğrudan eşleşme yok. K12 D-23 (`applied_steps_count`) ve H8 aynı aileden.

---

### [D-J-02] `kur.ps1` her kurulumda `ecosystem.config.js`'i paketinkiyle EZER — sunucudaki yedek/offsite/zamanlayıcı ayarları sessizce repo değerlerine döner

| Şiddet | S1 | Kategori | J (zero-downtime / deploy sözleşmesi) | Öncelik | P0 | Modül | deploy + yedek | Kanıt seviyesi | K2 |

**Özet.** Deploy sırasında çalışan kurulumdan **yalnız `.env` korunur**; `ecosystem.config.js` paketten gelir ve üzerine yazılır. Bu dosya sırları değil **operasyonel** ayarları taşır: `BACKUP_SCHEDULE_ENABLED`, `BACKUP_OFFSITE_DIR`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `PG_BIN_DIR`, `BACKUP_RCLONE_*`. Repo'daki değerler saha gerçeğiyle **ölçülebilir biçimde ayrışmış**: prod kopyasının audit defteri, repo'nun "kapalı" dediği backend zamanlayıcısının 2026-08-25'te gece yedeğini aldığını ve repo'nun `""` dediği offsite dizininin o gün **dolu** olduğunu gösteriyor. Yani bir sonraki `kur.ps1` koşumu bu iki ayarı geri alacak ve gece yedeği ya hiç alınmayacak ya da makine dışına kopyalanmayacak — **hiçbir hata üretmeden**.

**Kanıt — kod (üzerine yazma).**
```
deploy/kur.ps1:259-268
try {
  Move-Item $mevcut $eskiAd -Force -ErrorAction Stop
  New-Item -ItemType Directory -Path $appDir | Out-Null
  Copy-Item "$temp\*" $appDir -Recurse -Force        # ← ecosystem.config.js DAHİL
  Copy-Item $envYedek (Join-Path $appDir ".env") -Force   # ← korunan TEK dosya
} catch { GeriAlOtomatik "Dosya yerlestirme basarisiz: ..." }
```
`deploy/paketle.ps1:129` → `Copy-Item "$proj\ecosystem.config.js" "$stage\"` (paket repo kopyasını taşır).
`deploy/kur.ps1:190` → `& $pm2 delete $uygulama` yorumu: *"delete: ecosystem env blogu degismis olabilir"* — script env bloğunun değiştiğini biliyor, ama **operatörün sunucuda yaptığı düzenlemenin kaybolduğunu hiçbir yerde söylemiyor**.

**Kanıt — repo değerleri.**
```
Teks-Erp/ecosystem.config.js:107  BACKUP_SCHEDULE_ENABLED: "false",
Teks-Erp/ecosystem.config.js:124  BACKUP_OFFSITE_DIR: "",
Teks-Erp/ecosystem.config.js:143  BACKUP_RCLONE_REMOTE: "",
```
Dosyanın kendi yorumu bunları "saha gerçeği" diye anlatıyor (`:99-107`: *"⚠ SAHADAKİ SUNUCUDA (SAHINSRV) GECE YEDEĞİNİ BACKEND ALMIYOR … orada scheduler KAPATILIR"*).

**Veride fiili ihlal (K2) — prod kopyası `tekserp_saha_0825`.**
```sql
SELECT "createdAt"::date, action, "newData" FROM system_logs
 WHERE action IN ('BACKUP_COMPLETED','BACKUP_FAILED','BACKUP_TRIGGER')
 ORDER BY "createdAt" DESC LIMIT 20;
```
| Tarih | Kayıt |
|---|---|
| 2026-08-25 | `BACKUP_COMPLETED {"file":"tekserp_20260825_030507.dump", "trigger":"nightly", "message":"Yedek alındı ve doğrulandı: …"}` — **`trigger:"nightly"` = backend zamanlayıcısı koştu**, oysa repo `BACKUP_SCHEDULE_ENABLED:"false"` diyor; **ve mesajda offsite uyarısı YOK** → o an `BACKUP_OFFSITE_DIR` doluydu |
| 2026-08-22 · 08-21 ×1 · 08-19 ×2 · 08-11 · 08-05 · 07-31 | 7 × `BACKUP_COMPLETED … "UYARI: OFFSITE YEDEK AYARLANMADI — tüm yedekler DB ile aynı diskte (felaket riski)"` |

Uyarı metninin tek kaynağı `backup.service.ts:333-337` ve koşulu `if (OFFSITE_DIR) … else warnings.push(...)`; `OFFSITE_DIR` **modül yükünde** `process.env.BACKUP_OFFSITE_DIR`'den okunur (`backup.service.ts:46`). Yani uyarının 08-22'de var, 08-25'te yok olması ancak env'in bu iki tarih arasında **doldurulmasıyla** açıklanır. `system_settings`'te `backup.offsiteDir`/`backup.offsiteRemote` satırı **yok** (ölçüldü: yalnız `backup.lastNightlyAt` var) → ayar panelden değil, **sunucudaki dosyadan/servis ortamından** geliyor.

**Çakışma senaryosu (deploy penceresi).**
- T1 — Operatör sunucuda `app\ecosystem.config.js`'i düzenler: `BACKUP_OFFSITE_DIR: "E:/yedek"`, `BACKUP_SCHEDULE_ENABLED` kaldırılır. Gece yedeği + offsite kopya çalışır (2026-08-25 kaydı bunu gösteriyor).
- T2 — Bir sonraki sürüm çıkar: `kur.ps1 -Paket …` → `Copy-Item "$temp\*" $appDir` repo kopyasını yazar → `pm2 delete` + `pm2 start ecosystem.config.js` yeni env'i yükler.
- SONUÇ — `BACKUP_SCHEDULE_ENABLED="false"` → backend zamanlayıcısı `startBackupScheduler` içinde erken döner (`backup-scheduler.ts:130-136`, yalnız `console.log`); `BACKUP_OFFSITE_DIR=""` → offsite kopya atlanır. Harici Görev Zamanlayıcı görevi de yoksa/bozuksa **gece yedeği tamamen durur** ve tek görünür iz `pm2` log'undaki tek satır ile 24 saat sonra panelin "Son yedek 24 saatten eski" uyarısıdır (yalnız biri `Sistem → Sunucu Durumu` ekranını açarsa, `Electron/src/pages/System/ServerStatus/serverHealth.ts:207-212`).

**failure_mode.** Deploy günü akşamı gece yedeği alınmaz; ertesi gün bir disk arızası olursa geri dönülecek en yeni yedek `premigrate_<damga>.dump` (deploy anı) olur → **bir günlük üretim verisi (toplar, sevkiyatlar, tartılar) kaybolur** ve kayıp deploy'un kendisinden değil, deploy'un sessizce sıfırladığı bir ayardan doğar.

**İş etkisi.** Yedek zincirinin en kritik iki anahtarı (zamanlayıcı açık mı, makine dışı kopya var mı) her sürümde sıfırlanabiliyor. Aynı mekanizma `PG_BIN_DIR`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` için de geçerli — `BACKUP_DIR` yanlışsa panel yedekleri hiç görmez (`DEPLOY-RUNBOOK.md:136-140` bu sınıfı "sessiz bozulma" diye zaten adlandırıyor).

**Öneri (2. tur).** Üç şıktan biri, kararı kullanıcı verir:
1. **`.env`'e taşı** — operasyonel yedek ayarları da `.env`'e (deploy'un koruduğu tek dosya) alınır; `ecosystem.config.js` yalnız `env_file`/varsayılan taşır. En küçük değişiklik, en net sözleşme.
2. **Repo'yu saha gerçeğiyle eşitle** — `ecosystem.config.js`'e gerçek saha değerleri yazılır (bu, dosyanın zaten iddia ettiği şey) ve `kur.ps1`'e **deploy öncesi kıyas** eklenir: mevcut `app\ecosystem.config.js` ile paketinki `env` bloğu bazında farklıysa farkı ekrana basıp onay ister.
3. **Koru ve birleştir** — `kur.ps1` `.env` gibi `ecosystem.config.js`'i de kenara alır, paketinkiyle farkı gösterip operatöre sorar.
Her şıkta ek olarak: `/api/admin/health`'e `backupScheduleEnabled` + `offsiteDirConfigured` alanları ve panelde görünür rozet (bugün yalnız audit mesajının içinde saklı).
[PROD'DA ÇALIŞTIRMA] — `kur.ps1` sunucuya **elle** kopyalanır (script kendini güncelleyemez, `deploy/kur.ps1:16-18`); değişiklik önce `deploy/test/kur-gerialma.harness.ps1` ile prova edilmeli. Geri alma: eski `kur.ps1`'i geri kopyala (dosya tek başına, durum tutmaz).
**Kabul kriteri.** Sahadaki `ecosystem.config.js` ile repo'daki `env` bloğu birebir aynı **ya da** `kur.ps1` farkı ekrana basıp onay istiyor; deploy sonrası ilk gece yedeği `trigger` ve offsite durumu aynı kalıyor (audit'ten doğrulanır).
**Efor.** 0,5-1 gün.
**Önceki defter.** K9 H-5 (offsite yerel dizin iki gerçek) ve H-9 (saha `nightly` ↔ `BACKUP_SCHEDULE_ENABLED=false` ayrışması) bu bulgunun iki yarısı; burada **sebebi** (deploy'un dosyayı ezmesi) eklendi. `F-OPS-VER-003` ile ilişkili.

---

### [D-J-03] Gece yedeğini fiilen alan `yedekle.ps1` repoda yok — repo'nun kurduğu yedek güvenlik ağının hiçbiri o yolda koşmuyor

| Şiddet | S1 | Kategori | J (yedek: sıklık/saklama/bütünlük) | Öncelik | P0 | Modül | yedek/ops | Kanıt seviyesi | K2 |

**Özet.** Repo, sahadaki gece yedeğinin `C:\Etkili-Yazilim\yedekle.ps1` (Windows Görev Zamanlayıcı, 02:00, 30 gün) tarafından alındığını yazıyor (`ecosystem.config.js:99-107`). O dosya **repoda yok** — `git ls-files | grep '\.ps1$'` altı script döndürüyor, hiçbiri yedek almıyor. Sonuç: backend'in yedek yolunda özenle kurulmuş beş korumanın hiçbiri sahadaki asıl yedekte geçerli değil: ① `.part` → doğrula → `rename` (yarım dosya nihai adı almaz, `backup.service.ts:222-243, 269-290`), ② `pg_restore --list` bütünlük doğrulaması ve bozuk dump'ın silinmesi (`:271-287`), ③ gün bazlı rotasyon **+ yaşına bakılmaksızın en yeni 3 dosyayı koruma** (`RETENTION_MIN_KEEP = 3`, `:66, 300-322`), ④ offsite kopya (`:324-338`), ⑤ `BACKUP_COMPLETED`/`BACKUP_FAILED` audit kaydı ve panelde "son yedek denemesi" kutusu (`:190-196`).

**Kanıt.**
```
$ git ls-files | grep '\.ps1$'
Teks-Erp/installer/docker/yonet.ps1
deploy/electron-yayinla.ps1
deploy/kur.ps1
deploy/paketle.ps1
deploy/test/kur-gerialma.harness.ps1
deploy/test/run-harness.ps1
$ find . -iname 'yedekle*' -not -path '*/node_modules/*'
./Teks-Erp/yedekle.sh          ← Docker dönemi, .sql.gz, 7 gün (bkz. D-J-17)
```
`Teks-Erp/ecosystem.config.js:99-107` (saha iddiası):
```
// ⚠ SAHADAKİ SUNUCUDA (SAHINSRV) GECE YEDEĞİNİ BACKEND ALMIYOR.
//   TeksERP-DB-Backup → C:\Etkili-Yazilim\yedekle.ps1, her gece 02:00,
//   C:\Etkili-Yazilim\backups, 30 gün saklama.
```
`ecosystem.config.js:116-117`: *"Saklama GÜN bazlı (varsayılan 30) — sahadaki `yedekle.ps1` politikasıyla AYNI olmalı"* → iki politikanın eşitliği **sözle** kuruluyor, hiçbir mekanizma doğrulamıyor.
Backend rotasyonu yalnız `runBackupJob` içinde koşar (`backup.service.ts:300-322`, C1 zincirinin 3. adımı) → zamanlayıcı kapalıyken **backend hiç rotasyon yapmaz**; `tekserp_*` dosyalarının budanması tamamen `yedekle.ps1`'e kalır.

**Veride fiili ihlal (K2).** Prod kopyasında 2026-07-31 → 2026-08-25 arasında `BACKUP_COMPLETED` **8 kayıt** (7'si elle `BACKUP_TRIGGER` ile, 1'i `nightly`), `BACKUP_FAILED` **0 kayıt**. Yani 25 günlük pencerede audit defteri yalnız 8 yedek görüyor; geri kalan gecelerin yedeği (varsa) **hiçbir iz bırakmıyor** — çünkü onları backend almıyor.

**failure_mode.** `yedekle.ps1` sessizce durur (görev devre dışı bırakılmış, `PG_BIN` PostgreSQL major yükseltmesinden sonra uyumsuz, şifre değişmiş, disk dolu). `pg_dump` yarım bir `.dump` bırakır ya da hiç dosya bırakmaz. Bütünlük doğrulaması olmadığı için **bozuk bir dosya "yedek" olarak durur**; rotasyon min-keep koruması olmadığı için gün hesabı sağlam yedekleri silebilir; `BACKUP_FAILED` audit'i doğmaz. Panelin 24sa/48sa bayatlık uyarısı yalnız *dosya yokluğunu* görür — **bozuk ama taze bir dosya "yedek var" der**. Felaket anında `pg_restore` "corrupt archive" verir ve o an geriye dönülecek başka bir şey yoktur.

**İş etkisi.** Felaket kurtarmanın tek dayanağı, repo'nun görmediği, test edilmemiş, sürüm kontrolsüz bir script. Denetlenebilir değil; bir sonraki devirde (personel değişimi) kaybolabilir.

**Öneri (2. tur).** İki şık:
1. **`yedekle.ps1`'i repoya al** (`deploy/yedekle.ps1`), `kur.ps1`'in `deploy/kur.ps1` ile aynı "kaynak repodadır, sunucuya elle kopyalanır" sözleşmesine bağla; içine backend'le **aynı** üç korumayı koy: `.part`→`pg_restore --list`→`rename`, gün bazlı rotasyon + min-keep 3, ve bitişte backend'in `POST /api/admin/backup` yerine bir "yedek alındı" işareti (basitçe `.ok` dosyası ya da `BACKUP_DIR`'e damga) bırak.
2. **Backend zamanlayıcısına dön** (`BACKUP_SCHEDULE_ENABLED` açık, harici görev kapatılır) — bedeli: backend kapalıyken yedek alınmaz (ecosystem yorumunun bilinçli gerekçesi). Bu bedeli kabul etmiyorsak şık 1.
Her iki şıkta: `/api/admin/health`'e "son yedek dosyasının `pg_restore --list` verdicti" alanı (bugün `verifyBackupFile` yalnız backend kendi aldığında koşuyor) ve panelde görünür kılınması.
[PROD'DA ÇALIŞTIRMA] — script değişikliği sunucuya elle kopyalanır; ilk koşum **elle** tetiklenip çıktısı gözle doğrulanır. Geri alma: eski `yedekle.ps1`'i geri koy (Görev Zamanlayıcı yolu değişmez).
**Kabul kriteri.** Gece yedeğinin (a) bütünlüğü doğrulanıyor, (b) yarım dosya nihai ad almıyor, (c) en yeni 3 dosya her koşulda korunuyor, (d) başarısızlık bir yerde **kayıt** bırakıyor.
**Efor.** 1 gün.
**Önceki defter.** `F-OPS-VER-003` (offsite) ve `O-17` (yedek bütünlüğü) ile komşu; `O-17`'nin backend ayağı KAPALI (`backup.service.ts:109, 277`), saha ayağı AÇIK.

---

### [D-J-04] Makine dışı kopya ve PITR yok; RPO/RTO on-prem kurulum için hiçbir yerde yazılı değil

| Şiddet | S1 | Kategori | J (yedek: RPO/RTO, offsite) | Öncelik | P1 | Modül | yedek/ops | Kanıt seviyesi | K2 |

**Özet.** Önceki denetimin `F-OPS-VER-003` / `Y-4` bulgusu **taze kanıtla hâlâ açık**: prod audit defterinde 7 yedek "OFFSITE YEDEK AYARLANMADI — tüm yedekler DB ile aynı diskte (felaket riski)" uyarısını taşıyor; rclone süpürücüsünün hedefi (`SystemSetting backup.offsiteRemote`) prod kopyasında **hiç yazılmamış**; WAL arşivi (`archive_mode`) yok. RPO/RTO rakamları yalnız **SaaS tasarım belgesinde** var (`docs/design/SAAS-TASARIM.md:97-98` — RPO 24 sa, RTO 4/8 saat) ve o belge "İLERİSİ İÇİN, uygulanmıyor" kapsamında; mevcut on-prem kurulum için taahhüt edilmiş bir kurtarma hedefi yok.

**Kanıt.**
```sql
-- prod kopyası
SELECT key, value FROM system_settings WHERE key ILIKE 'backup%' OR key ILIKE '%offsite%';
→ backup.lastNightlyAt = "2026-08-25T00:05:07.694Z"     (TEK satır)
   backup.offsiteDir / backup.offsiteRemote / dbRestore.copies → YOK
```
```
Teks-Erp/ecosystem.config.js:124  BACKUP_OFFSITE_DIR: ""
Teks-Erp/ecosystem.config.js:143  BACKUP_RCLONE_REMOTE: ""
docs/history/PM2-GECIS-DEVIR-NOTU.md:189  "PITR / WAL arşivi yok — kurtarma noktası en iyi ihtimalle son gece yedeği."
Teks-Erp/DB-MIMARI-DENETIM.md:148-156  Y-4: offsite kod YAPILDI, "kalan iş" WAL arşivi + deploy kontrol listesinde offsite teyidi
```
`src/jobs/offsite-sweeper.ts:53-59` — hedef yapılandırılmamışsa yalnız `console.warn` (bilinçli, `reportJobFailure` çağrılmaz) → **rclone hiç kurulmamışsa hiçbir yerde iz yok**.

**Veride fiili ihlal (K2).** 7/8 `BACKUP_COMPLETED` kaydı offsite uyarısını taşıyor (2026-07-31 … 2026-08-22). 8.'si (2026-08-25) taşımıyor → yerel offsite dizini o tarihte doluydu; **ama** o dizinin makine dışında olup olmadığı (ikinci disk mi, NAS mi) bu kopyadan okunamaz ve rclone ayağı hâlâ boş.

**failure_mode.** Sunucunun diski arızalanır / fidye yazılımı `C:` sürücüsünü şifreler / yangın olur → veritabanı **ve** yedeklerin tamamı aynı anda gider. En iyi ihtimalle elde bir şey kalmaz; en iyi *tasarlanmış* durumda bile (offsite dolu) kayıp penceresi **son gece yedeğine kadar, 24 saate varan üretim verisidir** — bir vardiyanın tüm KK1 girişleri, tambur kararları, sevkiyatları.

**İş etkisi.** Fabrika 24 saatlik veri kaybını kâğıttan yeniden kuramaz (barkodlar, parti bağları, sevk irsaliyeleri). Kurtarma süresi (RTO) hiç ölçülmediği için "ne kadar sürede ayağa kalkarız" sorusunun cevabı yok.

**Öneri (2. tur).**
1. `BACKUP_OFFSITE_DIR`'in gerçek değerini ve **makine dışı olduğunu** yazılı teyit et; `docs/ops/URETIM-KONTROL-LISTESI.md`'ye "offsite hedefte dosya gerçekten oluştu mu" adımı zaten öneriliyor (`DB-MIMARI-DENETIM.md:156`) — kutuyu işaretlenebilir hale getir.
2. rclone'u kur ve `backup.offsiteRemote`'u panelden gir (kod + bekçi hazır: `offsite-backup.helper.ts`, `test_offsite_sweep.ts`). `copy` (`sync` değil) kararı doğru, korunmalı.
3. **RPO/RTO'yu on-prem için yaz** (`docs/ops/DEPLOY-RUNBOOK.md §5`'e iki satır): "RPO = son gece yedeği (≤24 sa) · RTO = ölçülmedi → ilk tatbikatta ölçülecek". Ölçülmemiş RTO taahhüt edilmez (SaaS belgesinin kendi kuralı).
4. PITR ayrı bir karar: LAN içi ikinci makineye `pg_receivewal` RPO'yu dakikalara indirir, dışa açılım gerekmez (`DB-MIMARI-DENETIM.md:156` önerisi).
[PROD'DA ÇALIŞTIRMA] — rclone kurulumu ve `ALTER SYSTEM`/`postgresql.conf` WAL ayarları sunucuda, **vardiya dışında**; WAL açmak PostgreSQL restart ister. Geri alma: `archive_mode=off` + restart; rclone için `backup.offsiteRemote`'u boşalt.
**Kabul kriteri.** Yeni bir gece yedeğinin `BACKUP_COMPLETED` mesajı offsite uyarısı **taşımıyor** ve `GET /api/admin/health`'in `offsite` bloğu `ok` diyor; runbook'ta RPO/RTO satırı var.
**Efor.** 1 gün (offsite) + 2 gün (PITR, ayrı karar).
**Önceki defter.** `F-OPS-VER-003` (yuksek, açık) · `Y-4` (açık) · `F-OPS-VER-006` (logrotate, repo ayağı kapandı) — yeniden AÇILMIYOR, taze kanıtla **referanslanıyor**.

---

### [D-J-05] Geri yükleme tatbikatı hiç yapılmamış — "kopyaya geri yükleme" yolu prod'da bir kez bile koşmadı

| Şiddet | S1 | Kategori | J (geri yükleme testi) | Öncelik | P1 | Modül | yedek/kurtarma | Kanıt seviyesi | K2 |

**Özet.** `docs/ops/DEPLOY-RUNBOOK.md:470` açıkça yazıyor: *"6 ayda bir test-restore tatbikatı yapın. Doğrulanmamış yedek yedek değildir."* Prod kopyasında bu tatbikatın **hiçbir izi yok**: `DB_COPY_STARTED / DB_COPY_COMPLETED / DB_COPY_VERIFIED / DB_SWAP_COMMAND_ISSUED` audit kayıtları **0**. Yani 2026-07-30'da yazılan, doğrulama katmanıyla birlikte 1000+ satır tutan "kopyaya geri yükleme" özelliği (`db-copy.service.ts` + `db-copy-verify.service.ts`) sahada bir kez bile kullanılmamış. Tek yakın kayıt: 2026-07-31 tarihli **1 adet** `BACKUP_RESTORE_PREVIEW`.

**Kanıt (K2).**
```sql
SELECT action, count(*), max("createdAt")::date FROM system_logs
 WHERE action ILIKE 'BACKUP%' OR action ILIKE 'DB_COPY%' OR action ILIKE '%RESTORE%'
 GROUP BY action;
→ BACKUP_COMPLETED       | 8 | 2026-08-25
   BACKUP_DOWNLOAD        | 1 | 2026-08-05
   BACKUP_RESTORE_PREVIEW | 1 | 2026-07-31
   BACKUP_TRIGGER         | 9 | 2026-08-22
   (DB_COPY_* → 0 satır)
```
Audit yazımı kodda mevcut ve tx dışında best-effort değil, açık çağrı: `db-copy.service.ts:509-655` (`DB_COPY_STARTED/COMPLETED/FAILED/VERIFIED`), `db-copy.routes.ts:191-196` (`DB_SWAP_COMMAND_ISSUED`). Dolayısıyla 0 kayıt = **yol hiç çalışmadı**, "audit yazılmadı" değil.

**failure_mode.** Felaket günü, ilk kez kullanılacak bir geri yükleme yolu: `BACKUP_PG_USER`'ın `CREATEDB` yetkisi yok (özellik kapalı, `pg-admin-client.ts:100-132` fail-closed), ya da disk boş alanı canlı DB'nin 1,2 katından az (blok, `db-copy.service.ts:171-232`), ya da `PG_BIN_DIR` PostgreSQL major sürümüyle uyumsuz. Bunların hepsi **önceden ölçülebilir** ön koşullar; tatbikat yapılmadığı için felaket anında keşfedilecekler ve o an "yerine yazarak geri yükleme" (geri dönüşü olmayan `pg_restore --clean`) tek seçenek kalacak.

**İş etkisi.** RTO ölçülmemiş ve kurtarma yolunun ön koşulları doğrulanmamış. Fabrikanın durduğu bir sabahta ilk kez denenen bir yol, en pahalı öğrenme biçimi.

**Öneri (2. tur).** `docs/ops/URETIM-KONTROL-LISTESI.md`'ye çeyrek dönemlik bir tatbikat maddesi: panelden `POST /api/admin/db-copies` → doğrulama raporunu oku (locale/GUC/migration/satır sayıları) → kopyayı sil. **Canlıya dokunmaz** (`db-copy` yeni bir DB yaratır, backend ona bağlanmaz) ve `DB_COPY_VERIFIED` audit'i tatbikatın kaydı olur. Süre ölçülüp RTO'nun ilk rakamı yazılır (D-J-04 §3).
[PROD'DA ÇALIŞTIRMA] — tatbikat prod'da koşar ama **canlı veriye dokunmaz**; tek bedeli disk (kopya kadar; bugün ~20 MB, `pg_total_relation_size` toplamı ölçüldü). Geri alma: `DELETE /api/admin/db-copies/:name` (allowlist'li, `db-copy.service.ts:665-736`).
**Kabul kriteri.** `system_logs`'ta en az bir `DB_COPY_VERIFIED` kaydı ve doğrulama raporunda `locale/guc/migrations` üçü de `ok`.
**Efor.** 0,25 gün (tatbikat) + 0,25 gün (kontrol listesi maddesi).
**Önceki defter.** `O-17` restore tatbikatı — K12 §"O-17 restore tatbikatı: Runbook '6 ayda bir' diyor; yapıldığına dair iz yok" satırı burada **ölçümle** kapatıldı: iz yok, çünkü tatbikat yok.

---

### [D-J-06] Başarısız `migrate deploy` sonrası kurtarma reçetesi hiçbir belgede yok — operatörün elindeki iki seçenek de yanlış ağırlıkta

| Şiddet | S2 | Kategori | J (rollback politikası) | Öncelik | P1 | Modül | deploy | Kanıt seviyesi | K1 |

**Özet.** Prisma, PostgreSQL'de bir migration dosyasının SQL'ini **tek örtük transaction** içinde koşar (repo bunu iki yerde kendisi yazıyor: `20260702120000:4-7`, `20260730120500:5-7` — `ALTER TYPE ADD VALUE` + kullanım aynı dosyada 55P04 verdiği için). Bunun iki sonucu var: (a) yarıda düşen bir migration **tamamen geri alınır**, DB bozulmaz; (b) `_prisma_migrations`'ta `finished_at IS NULL` + `logs` dolu bir satır kalır ve **sonraki her `migrate deploy` P3009 ile reddedilir** (`migrate resolve --rolled-back <ad>` verilene kadar). Bu komut ve bu durum `deploy/kur.ps1`'in hata mesajında, `DEPLOY-RUNBOOK.md §3` ve **§9 ROLLBACK stratejisi**nde, `MIGRATION-DEPLOY.md`'de **hiç geçmiyor**. Repo genelinde tek geçtiği yer `scripts/test_migration_hygiene.ts:127` ve orası bambaşka bir senaryoyu (dosyası silinmiş migration) anlatıyor.

**Kanıt.**
```
deploy/kur.ps1:288-298
if ($LASTEXITCODE -ne 0) {
  Write-Host "  X MIGRATION BASARISIZ"
  Write-Host "    DB kismi degismis OLABILIR. Otomatik geri alinmiyor - karar senin."
  Write-Host "    Durumu gor :  cd $appDir ; npx prisma migrate status"
  Write-Host "    Kodu geri al:  $kok\kur.ps1 -GeriAl"
  Write-Host "    DB'yi geri al: pg_restore ... $dump   (KURULUM dokumanina bak)"
  exit 1
}
```
```
$ grep -rn "P3009\|rolled-back" docs/ deploy/ Teks-Erp/*.md
→ yalnız Teks-Erp/scripts/test_migration_hygiene.ts:127 (farklı senaryo)
```
`docs/ops/DEPLOY-RUNBOOK.md:567-582` (§9) — yalnız iki yol: `kur.ps1 -GeriAl` (kod) ve `premigrate_` dump'ından restore (veri). Başarısız migration'ın **defter satırını** kapatma adımı yok.

**failure_mode.** Bir migration `statement_timeout` (per-DB 50 sn, `CLAUDE.md:257`) ya da bir kısıt ihlali yüzünden düşer. DB'de **hiçbir şey değişmemiştir** (tx geri alındı) ama `_prisma_migrations`'ta yarım satır kalır. Operatör mesajı okuyup `migrate status` çalıştırır ("failed migration"), sonra ya (a) `kur.ps1 -GeriAl` ile kodu geri alır — DB zaten değişmemişti, bu doğru ama eksik: sonraki deploy yine P3009 verir ve kimse sebebini bilmez; ya da (b) mesajın ikinci şıkkını izleyip `pg_restore` ile **hiç değişmemiş bir veritabanının üzerine** deploy anındaki dump'ı yazar → o pencerede yapılmış gerçek üretim kayıtları (deploy vardiya içinde yapıldıysa) kaybolur. İki durumda da doğru cevap (`migrate resolve --rolled-back` + migration'ı düzelt + yeniden deploy) hiçbir yerde yazmıyor.

**Veride fiili ihlal (K2).** "Arandı, 0": saha kopyasında `finished_at IS NULL OR rolled_back_at IS NOT NULL` → **0 satır** (190/190 temiz). Dev'de de yarım migration yok. Yani bugüne kadar bu duruma düşülmedi — bulgu **latent**.

**İş etkisi.** Deploy penceresi uzar; en kötü durumda gereksiz bir restore ile veri kaybı.

**Öneri (2. tur).** `deploy/kur.ps1`'in [7/9] hata bloğuna üçüncü satır + `DEPLOY-RUNBOOK.md §9`'a "Başarısız migration" alt başlığı:
```
Migration YARIDA DUSTUYSE (Prisma tek tx -> DB DEGISMEDI):
  1) npx prisma migrate status            # "failed migration" adini ver
  2) npx prisma migrate resolve --rolled-back <migration_adi>
  3) Migration'i duzelt, paketi yeniden uret, kur.ps1'i tekrar kos
  pg_restore YALNIZ "DB gercekten degisti" kaniti varsa (ornek: dosyada
  ACIK BEGIN/COMMIT ya da CREATE INDEX CONCURRENTLY).
```
[PROD'DA ÇALIŞTIRMA] — yalnız metin/script değişikliği; `resolve --rolled-back` komutu prod'da **ancak gerçek bir başarısızlıkta** koşulur. Geri alma: metni geri al.
**Kabul kriteri.** `kur.ps1` hata çıktısında `migrate resolve --rolled-back` geçiyor; runbook §9'da başarısız-migration alt başlığı var.
**Efor.** 0,25 gün.
**Önceki defter.** K2b H-2 (Prisma tx semantiği çelişkisi) bu bulgunun ön koşulu; burada semantik **karara bağlandı** (tek tx) ve sonucu operasyonel reçeteye çevrildi.

---

### [D-J-07] `ADD VALUE` migration'larının 10'unda `IF NOT EXISTS` yok — ve prod şemasında defter dışı bir enum değeri ÖLÇÜLDÜ

| Şiddet | S2 | Kategori | J (elle SQL pratiği / şema drift) | Öncelik | P2 | Modül | migration | Kanıt seviyesi | K2 |

**Özet.** Prod veritabanında `ReasonPresetKind` enum'u `WORK_ORDER_REWORK` değerini **taşıyor**, ama o değeri açan migration `20260825140000_reason_preset_rework_kind`'in `_prisma_migrations`'ta **satırı yok**. Yani prod şeması migration defterinin dışında bir yoldan (elle `psql` / `prisma db execute`) değiştirilmiş ve `migrate resolve` yapılmamış. Bu **tek başına** zararsız kaldı çünkü o dosya `IF NOT EXISTS` kullanıyor; ama repo'daki 21 `ADD VALUE` ifadesinin **10'unda `IF NOT EXISTS` yok** (en yenisi 2026-08-17'de iki tane). Aynı davranış `IF NOT EXISTS`siz bir dosyada tekrarlanırsa, sonraki `migrate deploy` `42710 duplicate_object` ile düşer — ve düştüğü yer `kur.ps1`'in **geri alınamaz eşiği** [7/9]'dur (D-J-06 ile birleşir).

**Kanıt (K2).**
```sql
-- prod kopyası
SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'ReasonPresetKind';
→ ROLL_SCRAP,ROLL_RECORD_CORRECTION,ROLL_MANUAL_ENTRY,ROLL_CANCEL,WORK_ORDER_REWORK

SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260825140000_reason_preset_rework_kind';
→ 0 satır   (dizin ↔ defter farkı: 5 migration eksik, aşağıda)
```
Dizin ↔ saha defteri farkı (ölçüldü): `20260825140000_reason_preset_rework_kind`, `20260826120000_orders_active_created_at_idx`, `20260826130000_reason_preset_order_cancel_kind`, `20260826130100_order_cancel_reason`, `20260827100000_order_line_cancel`. Beşi de dizinde var, defterde yok — **dördü gerçekten uygulanmamış** (kolonlar ölçüldü: `orders.cancelledAt` / `order_lines.cancelledAt` **YOK**), biri (`…rework_kind`) **nesnesi var, kaydı yok**.
`IF NOT EXISTS`siz `ADD VALUE` ifadeleri (grep, yorum satırları elenerek 10 adet):
```
20260601030715  SackStatus     ADD VALUE 'CANCELLED'
20260601110343  ShipmentStatus ADD VALUE 'READY'
20260607175324  ShipmentStatus ADD VALUE 'AT_DOOR'
20260604141753  RollStatus     ADD VALUE 'AT_KARTELA' / 'KARTELA_CONSUMED'
20260531014923  RollStatus     ADD VALUE 'SHIPPED'
20260715154754  RollEntrySource ADD VALUE 'MANUAL_ENTRY'
20260716010000  WorkOrderStatus ADD VALUE 'SUPERSEDED'
20260817004721  RollEntrySource ADD VALUE 'SEMI_FINISHED'      ← 11 gün önce
20260817121448  PrintedDocType  ADD VALUE 'TRAVELER_CARD'      ← 11 gün önce
```
**Koruma kontrolü (hangi bekçi bu yönü görüyor):** `test_schema_drift.ts` — enum değeri hem DB'de hem `schema.prisma`'da olduğu için **fark üretmez, yeşil**. `test_migration_hygiene.ts` — "dizinde var, DB'de yok"u **UYARI** basar (D-J-09), `_prisma_migrations`'ı DB nesneleriyle karşılaştırmaz. `check-migrations.mjs` — git tarafı, DB'yi hiç görmez (koşuldu: yeşil, 195/195). `test_db_invariants.ts` — enum değerlerini envanterlemiyor. Yani **hiçbir kapı "şema nesnesi var ama migration kaydı yok" yönünü ölçmüyor**.

**failure_mode.** Bir sonraki acil düzeltmede yine elle `ALTER TYPE "RollStatus" ADD VALUE 'X'` koşulur (bu evde olmuş bir şey, kanıt yukarıda), `migrate resolve` unutulur; ilgili migration `IF NOT EXISTS` taşımıyorsa bir sonraki `kur.ps1` koşumu [7/9]'da `ERROR: enum label "X" already exists` ile düşer → fabrika, kodu yeni `app\`'da ama pm2 durmuş, migration yarım işaretli halde bekler; operatörün elindeki reçete (D-J-06) bu durumu tanımıyor.

**İş etkisi.** Deploy penceresinde beklenmedik duruş; en kötü durumda gereksiz restore.

**Öneri (2. tur).**
1. Tüm `ALTER TYPE … ADD VALUE` ifadelerini `IF NOT EXISTS`li hale getir (geçmiş dosyaları düzenlemek **YASAK** — uygulanmış migration immutable, `check-migrations.mjs` GATE 2; kural yalnız **yeni** dosyalar için yazılır: `Teks-Erp/CLAUDE.md`'ye tek satır + bir lint/bekçi).
2. `scripts/test_migration_hygiene.ts`'e üçüncü yön: **"şemada var, defterde yok"** sondası — pending migration'ların ürettiği nesnelerden ucuz olan birkaçını (enum değerleri) canlıda ara; bulursan KIRMIZI, çünkü bu "elle uygulandı, resolve edilmedi" demektir.
3. `docs/ops/*`'da elle SQL koşumunun sırasını (git add → db execute → **resolve** → doğrula) prod için de tekrarla; bugün `MIGRATION-DEPLOY.md:91` bu akışı "YALNIZ DEV" diye işaretliyor ama sahada fiilen kullanılmış.
[PROD'DA ÇALIŞTIRMA] — düzeltme repo tarafında; prod'da tek gereken, bir sonraki deploy'da `20260825140000`'in `IF NOT EXISTS` sayesinde sorunsuz geçip defter satırını yazması (ek işlem yok). Geri alma: bekçi eklemesi geri alınabilir; migration dosyalarına dokunulmuyor.
**Kabul kriteri.** Yeni bir bekçi, canlıda "defter dışı enum değeri" durumunu kırmızı gösteriyor; `CLAUDE.md`'de yeni `ADD VALUE`ler için `IF NOT EXISTS` kuralı yazılı.
**Efor.** 0,5 gün.
**Önceki defter.** K2b H-13 / H-14 (aynı gözlemin haritası). Yeni: **hangi bekçinin bu yönü görmediği** çözüldü ve `IF NOT EXISTS`siz 10 dosya sayıldı.

---

### [D-J-08] Yumuşak kapı enforce adımının sahibi/tarihi/tetiği yok; `items_nameFold_key` sahada hâlâ eksik ve tek sinyal kalıcı kırmızı bir bekçi

| Şiddet | S2 | Kategori | J (migration yumuşak kapı) + B (mükerrer seddi) | Öncelik | P2 | Modül | migration / ana veri | Kanıt seviyesi | K2 |

**Özet.** `20260821150000_name_fold_unique_live` 2026-08-22'de "yumuşak kapı"ya çevrildi: mükerrer taşıyan tabloda partial UNIQUE'i `RAISE NOTICE` ile **atlar**, deploy geçer. Tasarım doğru (expand → backfill → contract). Eksik olan **contract adımının sahipliği**: enforce tamamen elle (`npx prisma db execute --file …`), tetikleyeni yok, son tarihi yok, kimin sorumlu olduğu yazılı değil, ve tek görünürlük sinyali **kalıcı olarak kırmızı kalan bir bekçi**. Ölçüldü: 2.9.0 deploy belgesi temizlik sonrası "3 satır" bekliyordu (`SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:329`), sahada bugün **2 satır var** — `items_nameFold_key` hâlâ yok ve tabloda hâlâ 1 mükerrer grup duruyor.

**Kanıt (K2).**
```sql
-- SAHA (prod kopyası 2026-08-25)
SELECT indexname FROM pg_indexes WHERE indexname IN
 ('customers_nameFold_key','items_nameFold_key','subcontractors_nameFold_key','colors_nameFoldColor_key');
→ colors_nameFoldColor_key · customers_nameFold_key · subcontractors_nameFold_key   (items YOK)

SELECT count(*) FROM (SELECT "nameFold" FROM items WHERE "mergedIntoId" IS NULL
                       GROUP BY 1 HAVING count(*)>1) t;                → 1 grup
SELECT id FROM items WHERE "mergedIntoId" IS NULL AND "nameFold" IN (…);
→ b5b11cfa-81bb-4392-a4a7-d3a72794fd37 · 6a189333-a2c0-4dda-8282-13c1110b2ff6

-- DEV
→ customers · items · subcontractors VAR; colors_nameFoldColor_key YOK (dev'de 1 renk mükerreri)
```
Migration `20260821150000_name_fold_unique_live/migration.sql:16-19` — enforce reçetesi yalnız yorumda:
```
-- prod'da temizlik (Sistem → Mükerrer Kayıtlar paneli) bitince AYNI DOSYA tekrar
-- koşulur ve eksik index'i kurar (idempotent — IF NOT EXISTS):
--     npx prisma db execute --file prisma/migrations/20260821150000_name_fold_unique_live/migration.sql
```
**İki bekçi aynı duruma zıt karar veriyor:**
- `scripts/test_schema_drift.ts:84-103` → `TOLERATED_DRIFT` listesi: eksik `<t>_nameFold_key` **⚠️ ile listelenir, sayılmaz** → guard YEŞİL.
- `scripts/test_db_invariants.ts:157-163, 273-275` → aynı index eksikse **KIRMIZI** ve dosyada **beklenen-başarısızlık mekanizması yok** (grep: `TOLERATED_EXTENSIONS` var, tolerated-index yok; `process.exit(fail > 0 ? 1 : 0)`, `:792`).
Yani prod'da `test_db_invariants` **sürekli** çıkış kodu 1 veriyor; "beklenen 2 kırmızı" ile "yeni bir regresyon" aynı özet satırında (`=== Sonuç: N geçti, M başarısız ===`) toplanıyor.

**failure_mode.** Deploy sonrası doğrulama adımı olarak `test_db_invariants` koşulur ve "2 başarısız — biliyorum, sed bekliyor" diye geçilir. Aynı koşumda **gerçek** bir kayıp (ör. `rolls_stamp_production_timestamps` trigger'ının bir `migrate dev` kazasıyla düşmesi → `finalizedAt` hiç yazılmaz → tüm dönem karneleri sessizce boşalır, dosyanın kendi §6 yorumunun anlattığı senaryo) **3. bir kırmızı satır** olarak aynı yığına düşer ve "yine o iki tanesi" diye okunur. İkinci arıza: enforce yapılmadığı sürece `items` üzerinde ad mükerreri **yarış/içe-aktarım/elle SQL** yollarından yazılabilir (uygulama bekçisi `assertNameNotDuplicate` check-then-act'tir — migration dosyasının kendi `:26-33` listesi bunu sayıyor).

**Veride fiili ihlal (K2).** `items` 1 mükerrer grup (2 satır, id'ler yukarıda) — sed yokken doğmuş ya da sed hiç kurulamamış. `customers` 0 · `subcontractors` 0 · `colors` 0 (saha).

**İş etkisi.** Aynı kumaş iki kartla yaşamaya devam eder (stok/sipariş karşılama iki kayda bölünür); ve daha genel olarak, mutabakat kapısının kırmızısı anlamını yitirir ("kırmızı körlüğü").

**Öneri (2. tur).**
1. **Enforce'u bitir:** paneldeki Mükerrer Kayıtlar ekranından `items`'taki tek grubu birleştir, sonra migration dosyasını yeniden koş. [PROD'DA ÇALIŞTIRMA] — birleştirme motoru (`MasterDataMergeService.merge`) prod'da koşar ve **geri alınamaz**; önce `find_fold_duplicates.ts` ile grubu listele, birleştirmeden önce `premigrate_`-tarzı bir yedek al. Index kurulumu (`prisma db execute`) küçük tabloda metadata-only; geri alma `DROP INDEX "items_nameFold_key"`.
2. **Kırmızı körlüğünü kapat:** `test_db_invariants.ts`'e — `test_schema_drift`'in `TOLERATED_DRIFT` deseniyle simetrik — bir `PENDING_ENFORCEMENT` listesi ekle: satır `{index, sebep, sonTarih}` taşısın, çıktıda **ayrı bir bölümde ⚠️** olarak bassın, çıkış kodunu bozmasın; **son tarih geçmişse KIRMIZI** olsun. Böylece "bilerek kırmızı" bir tarihe bağlanır ve normal kırmızı yeniden anlamlı olur.
3. Enforce durumunu `/api/admin/health`'e taşımak da bir şık (D-J-12 ile aynı sınıf) — kullanıcı kararı.
**Kabul kriteri.** Sahada 4 sed index'i de mevcut **ya da** `test_db_invariants` prod'da çıkış kodu 0 verip eksik sed'leri son tarihli bir ⚠️ bölümünde listeliyor.
**Efor.** 0,5 gün (bekçi) + birleştirme kararı iş tarafında.
**Önceki defter.** K2b H-1/H-7/H-11 ve K12'nin `test_db_invariants` "bilerek kırmızı" notu. Reddedilmiş bir bulgu yeniden açılmıyor.

---

### [D-J-09] `test_migration_hygiene` "dizinde var / DB'de yok"u UYARI basıyor — deploy'un hiç koşmadığı durum, deploy-sonrası doğrulamada YEŞİL görünür

| Şiddet | S2 | Kategori | J (migration sürümleme/bekçi) | Öncelik | P2 | Modül | migration/bekçi | Kanıt seviyesi | K2 |

**Özet.** Bekçinin dört kontrolünden ikisi FAIL, ikisi WARN üretiyor. WARN olanlardan biri **"dizindeki migration DB'de yok" (pending)**. Bu, dev'de meşru bir ara durumdur; ama bu bekçi sürüm belgelerinde **canlı DB'ye karşı** koşuluyor (`docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:106`, `SURUM-2026-07-31-DEPLOY.md:42`) ve orada "pending" tam olarak **"`migrate deploy` çalışmadı / eksik çalıştı"** demektir — yani deploy'un doğrulanması gereken tek şey. Bekçi o durumda `exit 0` verir.

**Kanıt.**
```
scripts/test_migration_hygiene.ts:83-91
const pending = onDisk.filter((d) => !dbSet.has(d));
if (pending.length) {
  warnLine(`Dev DB ${pending.length} migration geride (pending): …`);   // ← UYARI
} else {
  check("Dizindeki her migration dev DB'ye uygulanmış (pending yok)", true);
}
…
:139  process.exit(fail > 0 ? 1 : 0)     // warn çıkış kodunu etkilemez
```
Mesaj metni de dev varsayıyor ("**Dev DB** … geride").

**Veride fiili ihlal (K2).** Saha kopyasında bugün **5 pending** migration var (liste D-J-07'de) ve dördü gerçekten uygulanmamış (`orders.cancelledAt` / `order_lines.cancelledAt` kolonları YOK — ölçüldü). HEAD kodu bu kolonları her sipariş sorgusunda okuyor: `src/services/helpers/order-line-scope.helper.ts:26` (`ACTIVE_LINE = { cancelledAt: null }`). Bu bir "deploy henüz yapılmadı" durumu, kusur değil — **kusur, bekçinin bu duruma yeşil demesi**.

**failure_mode.** `kur.ps1` [7/9] `npx prisma migrate deploy` yanlış çalışma dizininde ya da yanlış `prisma.config.js` ile koşar ve "All migrations have been successfully applied" der (dizini boş görüyorsa hiçbir şey uygulamadan başarılı çıkar). Operatör doğrulama adımında `test_migration_hygiene`'i koşar → "5 uyarı, 0 başarısız, exit 0" → **deploy başarılı sayılır**. Ardından ilk sipariş listesi isteği `P2022 — column order_lines.cancelledAt does not exist` ile 500 döner ve teşhis, sürüm belgesindeki yeşil doğrulamaya rağmen sıfırdan yapılır.

**İş etkisi.** Deploy doğrulamasının en pahalı hata sınıfı ("migration koşmadı") mekanik olarak yakalanmıyor.

**Öneri (2. tur).** Bekçiye bir bayrak: `--strict-pending` (ya da `NODE_ENV`/hedef-DB adı üzerinden otomatik) — pending varsa **FAIL**. Sürüm belgelerindeki doğrulama komutunu bu bayrakla güncelle. Dev'deki günlük kullanım değişmez.
[PROD'DA ÇALIŞTIRMA] — bekçi salt-okunur, prod'a karşı güvenle koşar (belgeler zaten öyle diyor). Geri alma: bayrağı kullanma.
**Kabul kriteri.** Canlı DB'ye karşı `test_migration_hygiene --strict-pending` pending varken çıkış kodu 1 veriyor.
**Efor.** 0,25 gün.
**Önceki defter.** K2b "SINIR ÖTESİ → K-bekçi: `test_migration_hygiene` `applied_steps_count=0` satırlarını UYARI basıyor" ile aynı aile; burada **pending** yönü ele alındı.

---

### [D-J-10] Sürüm sıfırlaması sahadaki tabletler için sürüm kapısını kalıcı olarak etkisizleştirdi — ve bekçi yalnız Electron'u ölçüyor

| Şiddet | S2 | Kategori | J (zero-downtime: eski istemci ↔ yeni backend) | Öncelik | P2 | Modül | sürüm politikası | Kanıt seviyesi | K1 |

**Özet.** `client-version-policy.ts`, "backend ÖNCE gider, sahada bir süre ESKİ istemciler çalışır" gerçeğinin **tek** kapısı (dosyanın kendi `:4-10` gerekçesi). HEAD commit `0ed93d4b` panel ve tablet sürümlerini `2.8.3` / `2.9.9` → **`1.0.0`**'a çekti ve politikayı da `minVersion: "1.0.0"` yaptı. Panel için gerekçe sağlam ve yazılı ("panel henüz HİÇBİR makineye kurulmamıştı"). **Tablet için aynı şey doğru değil**: sahadaki APK'lar `2.9.x` `versionName` taşıyor ve mobil karşılaştırma tam olarak o değeri kullanıyor. `2.9.7 > 1.x.y` olduğu için `minVersion` ekseni bu cihazlar için **bir daha asla kilit koyamaz**; ikinci eksen `minPaketTarihi` ise tanımsız — ve tanımlansa bile hiç OTA almamış bir cihazda `paketTarihi === null` olduğu için bilinçli olarak kilitlemiyor.

**Kanıt.**
```
Teks-Erp/src/config/client-version-policy.ts:126-129
export const MOBIL_VERSION_POLICY: ClientVersionPolicy = {
  minVersion: "1.0.0",
  currentVersion: "1.0.0",
};      // ← dosyanın kendi yorumu (:120) hâlâ "Bugünkü değer: 2.9.8" diyor
```
```
mobil/src/services/clientPolicy.service.ts:87-101
if (surumKarsilastir(apkSurumu, politika.minVersion) < 0) return { eski: true, sebep: 'apk' };
if (politika.minPaketTarihi) { … if (paketTarihi && paketTarihi.getTime() < esik) … }
// paketTarihi === null (hiç OTA almamış cihaz) → BİLİNÇLİ olarak kilitlenmez
```
Sıfırlama commit'inin kendi notu mobil tarafta yalnız `versionCode`'u ele alıyor: *"`versionCode` GERİYE GİTMEZ … tablette görünen sürüm 1.0.0 ama sayaç 56 → 57"* — **sürüm politikası ekseninden hiç söz etmiyor**.
**Koruma kontrolü — bekçi:** `scripts/test_client_policy.ts` (98 satır) `minVersion ≤ currentVersion`i her iki istemci için kontrol ediyor (`:91-94`) ama "kurtarılamaz kilit yok" kontrolünü **yalnız Electron** için, yalnız `Electron/package.json`'a karşı yapıyor (`:55-63`). `mobil/app.json` hiç okunmuyor; "sahadaki fleet'in sürüm serisi politikanınkinden yüksek" durumu hiçbir yerde ölçülmüyor.

**failure_mode.** Yarın gerçek bir sözleşme kırılması olur (bir uç kaldırılır, bir alan zorunlu olur). Ekip kuralı uygular ve `MOBIL_VERSION_POLICY.minVersion`'ı `1.1.0` yapar. Sahadaki `2.9.7` APK'lı tablet politikayı çeker, `surumKarsilastir("2.9.7", "1.1.0") > 0` → **kapı açılmaz**, tablet eski sözleşmeyle yazmaya devam eder. Kırılma "400 döner" tipindeyse operatör hata görür; **"alan sessizce düşer" tipindeyse** (dosyanın `:6-7`'de en tehlikeli diye adlandırdığı sınıf) kimse fark etmez — ör. `dispatchWithoutColor`'ın yedi katmanda sessizce düştüğü 2026-08-25 vakasının bir tekrarı.

**Veride fiili ihlal (K2).** Aranmadı — saha kopyasında istemci sürümü tutan tablo yok (`Device`/`WorkSession` sürüm taşımıyor); tablet sürümleri yalnız kurulum kayıtlarından bilinir (proje belleği: 2.9.6/vc53, 2.9.7/vc54 sahada).

**İş etkisi.** Deploy sırası ("backend ÖNCE") güvenliğinin mobil ayağı, tüm tabletler 1.x APK'ya geçene kadar kapalı.

**Öneri (2. tur).**
1. **Kısa vade:** `minPaketTarihi`'ni doldur — o eksen APK sürüm serisinden bağımsız çalışır ve OTA almış tabletleri gerçekten kapsar. Hiç OTA almamış 2.9.x cihazlar için tek çözüm APK turudur; bunu bir kez planla ve `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`'ye "1.x'e geçiş turu tamamlanana kadar `minVersion` ekseni tabletlerde ETKİSİZDİR" uyarısını yaz.
2. **Bekçi:** `test_client_policy.ts`'e mobil ayağı ekle — `mobil/app.json` sürümüyle kıyas + **"politika serisi sahadaki seriden düşükse UYAR"** kontrolü (sahadaki seri repo'da bilinmiyorsa, en azından `minVersion`'ın major'ı `mobil/app.json` major'ından küçükse uyarı).
[PROD'DA ÇALIŞTIRMA] — `minPaketTarihi` **sahadaki en eski paket tarihinden büyük yapılmamalı**, yoksa tablet kilitlenir ve çıkışı yoksa üretim durur (`CLAUDE.md`'nin kendi kuralı). Geri alma: alanı kaldır (istemci fail-open, `clientPolicy.service.ts:85`).
**Kabul kriteri.** Bekçi mobil ayağı ölçüyor; belgede geçiş uyarısı var; APK turu sonrası `minVersion` yeniden anlamlı.
**Efor.** 0,5 gün.
**Önceki defter.** Yok (HEAD'in son commit'i).

---

### [D-J-11] `reset-operational.ts` 30+ tabloyu koşulsuz `TRUNCATE … CASCADE` ediyor — dry-run yok, `--apply` yok, prod kapısı yok, onay yok, audit yok

| Şiddet | S2 | Kategori | J (elle SQL / yıkıcı script) | Öncelik | P2 | Modül | scripts | Kanıt seviyesi | K1 |

**Özet.** Kök `CLAUDE.md` kuralı net: *"`migrate reset` / reseed / toplu `DELETE` yasak … Toplu veri düzeltmesi yapan script **dry-run varsayılan** olur ve `--apply` öncesi etkilenecek her kaydı somut listeler."* Repo'daki 10 backfill/fix/repair scriptinin **hepsi** bu kurala uyuyor (ölçüldü). Tek istisna en yıkıcı olan: `reset-operational.ts` tek bir `$executeRaw` ile 30+ operasyon tablosunu (siparişler, iş emirleri, toplar, hareketler, sevkiyatlar, çuvallar, refakat kartları, basılı belgeler ve `system_logs` + `system_log_archives` dahil) `TRUNCATE … CASCADE` ediyor. Argüman yok, onay yok, DB adı kontrolü yok, `productionDbGate` çağrısı yok — yalnız dosya başındaki bir yorum satırı.

**Kanıt.**
```
Teks-Erp/scripts/reset-operational.ts:8-10
// Çalıştır: npx ts-node scripts/reset-operational.ts
// !! GERİ ALINAMAZ — önce yedek al veya sadece test ortamında çalıştır.
:20-57
await prisma.$executeRaw`TRUNCATE system_logs, system_log_archives, roll_properties,
  roll_errors, traveler_card_scans, roll_movements, roll_operations, …, rolls, batches,
  order_lines, work_orders, orders CASCADE`;
```
`prisma` importu `../src/lib/prisma` → `DATABASE_URL`'i `.env`'den okur; hangi DB olduğuna **bakmaz**.
**Koruma kontrolü.** `productionDbGate()` tanımı **yalnız** `scripts/run-all-tests.ts:102`'de; hiçbir script onu import etmiyor (`grep -rn productionDbGate scripts` → tek dosya). Audit tamper trigger (`system_logs_block_tamper`, TRUNCATE'i de kapsıyor) yalnız `teks.audit_guard='on'` iken devreye girer — prod'da açık olduğu **doğrulanamıyor** (D-J-12). Sunucuda risk düşük: `deploy/paketle.ps1` pakete `src/` ve `scripts/` **koymuyor** (`:107-135`) ve `deploy/kur.ps1:138` pakette `src\` görürse uyarıyor. Yani tehdit yolu "geliştirici makinesinde `.env`'i prod/prod-kopyası DB'ye çevirip koşmak" — bu evde dev DB zaten **fabrikanın canlı yedeği** (proje belleği).
`clean_test_residue.ts` karşılaştırması (doğru yapılmış ikizi): dry-run varsayılan + `--apply` + silme kararı **yalnız test kod öneklerine** bakar, ada göre asla (`:14-31`).

**failure_mode.** Yanlış terminalde, yanlış `.env` ile tek komut: fabrikanın tüm operasyon geçmişi (2.431 top, 213 iş emri, 278 sipariş, 40 sevkiyat) ve **audit defteri** (10.485 satır) geri dönüşsüz silinir. `TRUNCATE` `DELETE` değildir: tetikleyici satır-bazlı çalışmaz, `RETURNING` yoktur, geri alınabilir tek şey aynı transaction'dır — ve script tx kullanmıyor. Kurtarma = son yedekten restore (bkz. D-J-03/04: o yedeğin bütünlüğü doğrulanmamış).

**İş etkisi.** Tek yanlış komutla toplam operasyonel veri kaybı.

**Öneri (2. tur).** Üç şık:
1. **Sil** — script'in bugünkü bir işlevi yok (sıfırlama rafa kalktı, `docs/history/CLAUDE-NOT-ARSIVI.md` 2026-08-22 notu). En temiz.
2. **Kurala uydur** — `productionDbGate()`'i ortak bir yardımcıya çıkar (`scripts/_lib/prod-gate.ts`) ve `reset-operational.ts` + `clean_test_residue.ts` + tüm `seed-*`/`demo-*`/`fixture-*` scriptlerinin ilk satırı yap; ayrıca `--apply` + DB adını **elle yazdırma** (runbook'un restore akışındaki "yazarak onaylama" deseni) + etkilenecek satır sayılarının tablo tablo dökümü.
3. Şık 2 + audit kaydı (`SystemLog` `RESET_OPERATIONAL`).
[PROD'DA ÇALIŞTIRMA] — script prod'da **asla** koşturulmaz; bu bulgunun düzeltmesi de yalnız repo tarafındadır. Geri alma: değişikliği geri al.
**Kabul kriteri.** `grep -L productionDbGate scripts/*.ts` yıkıcı script döndürmüyor; `reset-operational.ts` argümansız koşumda hiçbir şey yazmıyor.
**Efor.** 0,5 gün.
**Önceki defter.** K4 H8 (aynı envanter). K12'de karşılığı yok.

---

### [D-J-12] `auditGuard` alanının hiçbir tüketicisi yok; bekçi yalnız `app.ts` içinde metin arıyor — restore sonrası koruma sessizce kapalı kalabilir

| Şiddet | S2 | Kategori | J (kurtarma sonrası konfigürasyon) + I (gözlemlenebilirlik) | Öncelik | P2 | Modül | audit / ops | Kanıt seviyesi | K1 |

**Özet.** Audit değiştirilemezlik koruması (`system_logs_block_tamper` / `system_log_archives_block_tamper`) **varsayılan KAPALIDIR** ve yalnız per-DB GUC `teks.audit_guard='on'` ile açılır (`20260819161000_audit_tamper_guard/migration.sql:46-59`). Bu GUC `pg_db_role_setting.setdatabase` **OID**'ine bağlıdır; `pg_dump`/`pg_restore` onu taşımaz. Kod bunun unutulabilir bir ops adımı olduğunu biliyor ve iki görünürlük yüzeyi kurmuş: boot uyarısı (`server.ts:59-76`, yalnız `NODE_ENV=production`, yalnız `console.warn`) ve `/api/admin/health` → `auditGuard` (`app.ts:350, 409, 453`). Ölçüldü: **ikinci yüzeyin hiçbir tüketicisi yok** — `grep -rn auditGuard Electron/src mobil/src` → **0 vuruş**. Bekçi de bunu ölçmüyor: `scripts/test_audit_depth.ts:529-530` yalnız `app.ts` kaynağında `auditGuard` ve `teks.audit_guard` **metinlerini** arıyor.

**Kanıt.**
```
$ grep -rn "auditGuard" Electron/src mobil/src        → (boş)
Teks-Erp/scripts/test_audit_depth.ts:529-530
  check("/health auditGuard alanını döndürüyor",
        /auditGuard/.test(appSrc) && /teks\.audit_guard/.test(appSrc));
docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:1080
  audit_guard AÇILDI       : ☐  ALTER DATABASE + restart (§7b)      ← işaretsiz
```
Prod kopyasında `pg_db_role_setting` **boş** (restore taşımaz) → koruma durumunun canlıdaki gerçek değeri bu denetimden **doğrulanamıyor**.
`statement_timeout` / `idle_in_transaction_session_timeout` için **hiçbir** görünürlük yüzeyi yok (ne boot uyarısı ne health alanı) — yalnız `db-copy-verify.service.ts:157-180` kopya takasında kıyaslıyor.

**failure_mode.** Felaket sonrası kurtarma: `createdb tekserp` + `pg_restore` (tam kayıp senaryosu; runbook §5'in "kopyaya geri yükleme" yolu bu durumda kullanılamaz çünkü canlı DB yok). Yeni veritabanı **hiçbir per-DB ayarı taşımaz**: `statement_timeout=50s` yok (tek kötü sorgu DB'yi kilitleyebilir — `ARCHITECTURE.md:843`'ün gerekçesi), `idle_in_transaction_session_timeout` yok, `teks.audit_guard` yok (audit satırları yeniden silinebilir/değiştirilebilir). Fabrika normal çalışır, hiçbir ekranda hiçbir işaret yoktur; tek iz, kimsenin okumadığı bir `pm2` log satırıdır. Aynı sessizlik `kur.ps1`'in yeniden kurulum yolunda da geçerli (GUC'lara hiç dokunmaz).

**İş etkisi.** ISO 27001 A.8.15 gerekçesiyle kurulmuş audit değiştirilemezliği kâğıt üstünde kalır; runaway-sorgu koruması kaybolur ve etkisi (fabrikanın donması) tanı konana kadar sürer.

**Öneri (2. tur).**
1. **Görünürlük:** `Electron` Sunucu Durumu ekranına `auditGuard` satırı + `serverHealth.ts` issue listesine `auditGuard !== "on"` → `warn` (yedek bayatlığı deseninin birebir ikizi, `:207-212`).
2. `/api/admin/health`'e `statementTimeout` ve `idleInTransactionTimeout` (canlı `current_setting`) ekle, ikisi de boşsa `warn`.
3. Bekçiyi metin aramasından çıkar: `test_audit_depth`'e "Electron `serverHealth` `auditGuard`'ı tüketiyor mu" AST/metin kontrolü (Electron tarafında ayrıca bir `serverHealth.test.ts` sondası).
4. `docs/ops/DEPLOY-RUNBOOK.md §5`'in **"yerine yazarak / sıfırdan kurulum"** akışına "per-DB GUC'ları yeniden uygula (§6 + `teks.audit_guard`)" adımını ekle.
[PROD'DA ÇALIŞTIRMA] — `ALTER DATABASE tekserp SET teks.audit_guard='on'` **feature-flag değil** ama davranış değiştirir (audit silme yolları 42501 verir); denetim kuralı gereği burada yalnız öneriliyor, uygulanmıyor. Geri alma: `ALTER DATABASE tekserp RESET teks.audit_guard;` + restart (belgede zaten yazılı, `SURUM-2.9.0…:675`).
**Kabul kriteri.** Panelde audit koruması ve `statement_timeout` durumu görünüyor; kapalıysa uyarı çıkıyor; bekçi tüketiciyi ölçüyor.
**Efor.** 0,5 gün.
**Önceki defter.** K2b HOTSPOT-2 ve H-15 (aynı gözlemin haritası). Yeni: **tüketicinin hiç olmadığı** ve **bekçinin metin araması olduğu** ölçüldü.

---

### [D-J-13] `CREATE INDEX CONCURRENTLY` hiç kullanılmıyor, `lock_timeout` hiçbir yerde yok, `SET statement_timeout=0` 34/195 dosyada — büyümede tek koruma yazılı bir vardiya kuralı

| Şiddet | S3 | Kategori | J (büyük tabloda kilit) | Öncelik | P3 | Modül | migration | Kanıt seviyesi | K1 |

**Özet.** Ölçümler: `grep -rn CONCURRENTLY prisma/migrations` → **0** (621 `CREATE INDEX` ifadesine karşı); `grep -rn lock_timeout prisma/migrations src scripts` → **0**; `SET statement_timeout = 0` taşıyan dosya **34/195**. Bugünkü hacimde risk yok — prod'un en büyük tablosu `system_logs` 10.485 satır / 6,6 MB, `rolls` 2.431 satır / 2,7 MB, tüm DB ~20 MB (ölçüldü). Risk **büyümeyle** doğar ve repo bunu biliyor (`Teks-Erp/CLAUDE.md:252` kural 14: "index-ağırlıklı migration vardiya dışında"). Eksik olan iki şey: (a) `CONCURRENTLY`'nin bu mimaride **neden kullanılamadığının** yazılı olmaması, (b) `lock_timeout`'un hiç düşünülmemiş olması.

**Kanıt.**
```
$ grep -rn "CONCURRENTLY" Teks-Erp/prisma/migrations | wc -l   → 0
$ grep -rn "lock_timeout"  Teks-Erp/prisma/migrations src scripts | wc -l → 0
$ grep -rl "SET statement_timeout" Teks-Erp/prisma/migrations | wc -l → 34   (195 dizin)
```
`Teks-Erp/CLAUDE.md:252` — CONCURRENTLY için "şu an ihtiyaç yok" notu var, ama **teknik engel** yazılı değil: Prisma migration dosyasını tek örtük transaction'da koşar (D-J-06'daki kanıt), `CREATE INDEX CONCURRENTLY` transaction içinde **çalışamaz** (`25001`). Yani CONCURRENTLY bir tercih değil, bu deploy yolunda **imkânsız**; kullanılması için ayrı bir `psql` adımı gerekir ve bu hiçbir belgede tarif edilmemiş.
`MIGRATION-DEPLOY.md:126-140` "Index-ağırlıklı migration'lar — VARDİYA DIŞINDA" bölümü mevcut ama listelediği üç migration'ın ikisi artık geçersiz (biri kolon düştüğü için, `:138-140` kendisi söylüyor).
**Hafifletici (doğru yapılmış):** `kur.ps1` [4/9] `pm2 delete` ile backend'i **migration'dan önce durduruyor** (`:189-191`) → DDL koşarken uygulama bağlantısı yok, kilit kuyruğu oluşmaz. Bu, `statement_timeout=0` + `lock_timeout` yokluğunun bugünkü zararını sıfırlıyor.

**failure_mode.** İki yıl sonra `roll_movements` milyon satıra çıkar. Yeni bir rapor için `CREATE INDEX` içeren bir migration yazılır ve `SET statement_timeout = 0` **konmaz** (34/195 oranı bu ihtimalin küçük olmadığını gösteriyor). Deploy vardiya içinde yapılır (kur.ps1 pm2'yi durdurduğu için "kısa keserim" diye). Index inşası 50 sn'yi aşar → per-DB `statement_timeout` DDL'i **iptal eder** → migration düşer → tek tx geri alınır → `_prisma_migrations`'ta yarım satır kalır → sonraki deploy P3009 ile reddedilir (D-J-06). Fabrika, backend kapalı halde, sebebi belgelenmemiş bir çıkmazda bekler.
İkinci yol (uygulamanın açık olduğu tek DDL yüzeyi): yumuşak kapı enforce'u `npx prisma db execute --file …` ile **backend koşarken** yapılır (D-J-08) — orada `statement_timeout=0` da yok, `lock_timeout` da; büyük bir tabloda aynı desen kullanılırsa `ACCESS EXCLUSIVE` kuyruğu tüm okumaları da bekletir.

**Veride fiili ihlal (K2).** "Arandı, 0" — bugünkü hacimde ölçüm anlamsız (tablo boyutları yukarıda).

**Öneri (2. tur).**
1. `Teks-Erp/CLAUDE.md` kural 14'e iki cümle: (a) *"Prisma migration'ı tek tx'te koşar → `CREATE INDEX CONCURRENTLY` migration dosyasında KULLANILAMAZ; gerekirse ayrı `psql` adımı + `migrate resolve --applied`"*, (b) *"index/ALTER içeren her migration'a `SET statement_timeout = 0;` **ve** `SET lock_timeout = '5s';` — timeout kilidi beklemeyi sınırlar, DDL'in arkasında kuyruk birikmesini önler."*
2. Mekanik bekçi (Y-5'in kapanışı): `CREATE INDEX|ALTER TABLE|SET NOT NULL` içeren ama `SET statement_timeout` içermeyen **yeni** migration dosyası → kırmızı (geçmiş dosyalar allowlist).
[PROD'DA ÇALIŞTIRMA] — kural değişikliği; prod'a dokunmaz. Geri alma: bekçiyi kaldır.
**Kabul kriteri.** Yeni bir index migration'ı timeout satırı olmadan bekçiyi geçemiyor; CLAUDE.md'de CONCURRENTLY'nin neden kullanılamadığı yazılı.
**Efor.** 0,5 gün.
**Önceki defter.** `Y-5` (açık, latent) — K12: *"`SET statement_timeout` taşıyan migration 42/195; lint yok"*. Ölçüm bugün 34/195 (K12'nin 42'si farklı bir grep'ten; kanonik sayı dosya bazında 34).

---

### [D-J-14] `Teks-Erp/CLAUDE.md` `prisma migrate dev`i normal komut olarak listeliyor; `MIGRATION-DEPLOY.md` onu bu şemada YASAK ilan ediyor

| Şiddet | S3 | Kategori | J (elle SQL pratiği / `migrate reset` izi) | Öncelik | P4 | Modül | dokümantasyon/migration | Kanıt seviyesi | K1 |

**Özet.** İki yetkili belge zıt şey söylüyor. Komut listesi (`Teks-Erp/CLAUDE.md:64`) `npx prisma migrate dev # Yeni migration oluştur (development)` diyor; `Teks-Erp/MIGRATION-DEPLOY.md:93-95` ise *"`prisma migrate dev` bu şemada YASAK: `sacks` tablosundaki 2 DEFERRABLE composite FK datamodel'de temsil edilemediği için her diff'te DROP edilmek istenir"*. `schema.prisma` da aynı uyarıyı taşıyor. Yeni bir geliştirici komut listesini okur.

**Kanıt.**
```
Teks-Erp/CLAUDE.md:64          npx prisma migrate dev       # Yeni migration oluştur (development)
Teks-Erp/MIGRATION-DEPLOY.md:93  `prisma migrate dev` bu şemada YASAK: …
Teks-Erp/scripts/test_schema_drift.ts:62  "ASLA uygulama — `migrate dev --create-only` kullan, üretilen DropForeignKey satırlarını SİL."
docs/history/DB-KALAN-WORKLIST.md:21  "paylaşılan DB'de `migrate dev` RESET ister"
```

**failure_mode.** Geliştirici `migrate dev` koşar. İki sonuç: (a) Prisma iki `DEFERRABLE INITIALLY DEFERRED` composite FK'yı (`rolls_sackId_shipmentId_consistency_fkey`, `swatches_…`) düşürecek bir migration üretir — bu FK'lar K-18 değişmezini (top/kartelanın sevkiyatı çuvalınkiyle aynı olmalı) koruyan **tek** mekanizma; (b) paylaşımlı dev DB drift'li olduğu için Prisma **reset** teklif eder ve dev DB **fabrikanın canlı yedeğidir** (proje belleği: "Dev DB prod veriye çekildi"). İkisini de bekçiler yakalar (`test_db_invariants.ts:502, 520`; `test_schema_drift.ts` EXPECTED_DRIFT) — **koşulurlarsa**.

**Veride fiili ihlal (K2).** "Arandı, 0": dev ve saha kopyalarında iki composite FK de yerinde (`condeferrable=t, condeferred=t`, K2b §2.1 ölçümü).

**Öneri (2. tur).** `Teks-Erp/CLAUDE.md:64` satırını değiştir: `npx prisma migrate dev --create-only # ⚠️ DropForeignKey satırlarını SİL — MIGRATION-DEPLOY.md §"Elle yazılan migration"`. Tek satır.
[PROD'DA ÇALIŞTIRMA] gerekmez.
**Kabul kriteri.** İki belge aynı şeyi söylüyor.
**Efor.** 0,1 gün.
**Önceki defter.** Yok.

---

### [D-J-15] İki backfill scripti parçalı değil; `backfill-record-provenance` dry-run'ı kayıtları listelemiyor, yalnız sayı basıyor

| Şiddet | S3 | Kategori | J (backfill: parçalı / tekrar çalıştırılabilir / listeleme) | Öncelik | P4 | Modül | scripts | Kanıt seviyesi | K1 |

**Özet.** Kontrol listesinin üç sorusu ayrı ayrı: **dry-run varsayılan mı** → 10/10 evet (güçlü yön, aşağıda). **Tekrar çalıştırılabilir mi** → evet, hepsi `IS NULL`/atomik claim guard'lı. **Parçalı mı** → **hayır**; ve bir script "her kaydı listeler" kuralını da yalnız yarısıyla karşılıyor.

**Kanıt.**
```
scripts/backfill_roll_production_timestamps.ts:172-192
const values = finalizePlan.map((p) => `('${p.rollId}'::uuid, '${p.at.toISOString()}'::timestamptz)`).join(",");
await prisma.$executeRawUnsafe(
  `UPDATE rolls r SET "finalizedAt" = v.at FROM (VALUES ${values}) AS v(id, at)
    WHERE r.id = v.id AND r."finalizedAt" IS NULL`);
// ← TÜM plan tek ifade, tek VALUES listesi; parça/limit yok
```
```
scripts/backfill-record-provenance.ts:83-92, 102-103
UPDATE "<tablo>" x SET "createdById" = ( SELECT … FROM system_logs
   WHERE "tableName"=$1 AND "recordId"=x.id::text … ) WHERE x."createdById" IS NULL
// ← 29 tabloda tam-tablo korelasyonlu UPDATE; dry-run YALNIZ count(*) basar (:96-100, 128-139)
```
Kural (`kök CLAUDE.md`): *"`--apply` öncesi etkilenecek her kaydı somut listeler … 'X kayıt etkilenecek' gibi soyut sayı yetmez."* Diğer scriptler bunu yapıyor (`backfill_roll_entry_station.ts`, `fix_fire_rolls_to_scrap.ts`, `repair_sack_ghost_rolls.ts` tek tek satır basıyor); `backfill-record-provenance.ts` yalnız tablo başına iki sayı basıyor.
İdempotens: `IS NULL` guard'ları sayesinde her iki script de yeniden koşulabilir (yarıda kalırsa tekrar koş, yazılmışları atlar) — bu **doğru** yapılmış.
Hafifletici: `system_logs("tableName","recordId")` index'i mevcut (ölçüldü, saha + arşiv tablosunda da var) → korelasyonlu alt sorgu index seek yapar.

**failure_mode.** Bu scriptler ileride büyük bir tabloda koşturulursa (`rolls` yüz binlerce satır): tek `UPDATE` per-DB `statement_timeout=50s`'e takılır → hiçbir şey yazılmaz (idempotens sayesinde zararsız ama iş **hiç ilerlemez** ve sebebi "timeout" olarak görünür, "çok büyük" olarak değil); ayrıca eşlenen tüm satırlar tek tx boyunca kilitli kalır → o sırada üretim o topları yazamaz. `provenance` scripti için ikinci arıza: `--apply` öncesi hangi kayıtların hangi kullanıcıya atanacağı görülemez; yanlış bir audit eşleşmesi (aynı `recordId`'yi taşıyan iki farklı tablo satırı) sessizce yazılır ve künye alanları **geri alınamaz** biçimde bozulur (script tersleme yolu sunmuyor).

**Veride fiili ihlal (K2).** Bugünkü hacimde etkisiz: saha `rolls` 2.431 satır; `finalizedAt IS NULL` final statüde **4 top** (K2b A-24 ölçümü).

**Öneri (2. tur).** (a) Her iki scriptte parça boyu ekle (`--chunk 500`, döngü + ilerleme çıktısı); yeniden koşulabilirlik zaten var, parçalama onu tamamlar. (b) `backfill-record-provenance` dry-run'ında **id + eşleşen kullanıcı** listesi (ya da en azından `--verbose` ile). (c) İkisine de `productionDbGate` (D-J-11 §2 ile aynı ortak yardımcı).
[PROD'DA ÇALIŞTIRMA] — bu scriptler prod'da koşabilir (backfill amaçları bu); parçalama **öncesi** koşulmamalı. Geri alma: `finalizedAt`/`statusChangedAt` için yok (trigger de yazıyor); künye alanları için de yok → bu, listeleme gereğinin asıl gerekçesi.
**Kabul kriteri.** `--chunk` ile koşulduğunda ilerleme basıyor, yarıda kesilirse kaldığı yerden devam ediyor; provenance dry-run'ı kayıt listesi basıyor.
**Efor.** 0,5 gün.
**Önceki defter.** K4 §3c tablosu (aynı envanter, yargısız).

---

### [D-J-16] `20260611084953_native_uuid_pk_fk` dolu bir veritabanında veri kaybı üretir; yeni müşteri kurulumunda "önce içe aktar, sonra migrate" sırası bunu tetikler

| Şiddet | S3 | Kategori | J (zero-downtime / geri alınamaz DDL) | Öncelik | P4 | Modül | migration | Kanıt seviyesi | K1 |

**Özet.** Zincirdeki en büyük migration (2.254 satır) 60+ tabloda `DROP COLUMN id` + `ADD COLUMN id UUID NOT NULL` yapıyor; Prisma'nın kendi uyarısı dosyanın başında (`:1-80`). Boş bir DB'de zararsız (2026-06-11'de fabrika henüz açık değildi, ilk kurulum 2026-07-31). Ama **yeni bir müşteri kurulumu** artık standart bir iş (`CLAUDE.md` "Yeni müşteri" bölümü, 17 varlıklı içe aktarım paketi mevcut). Sıra ters kurulursa — önce veri içe aktarılır, sonra kalan migration'lar koşulursa — bu dosya sessizce veri siler.

**Kanıt.** `Teks-Erp/prisma/migrations/20260611084953_native_uuid_pk_fk/migration.sql:1-80` (Prisma'nın "You are about to drop the column…" uyarı bloğu), `:721-1391` (`DROP CONSTRAINT` ×211, `ADD … FOREIGN KEY` ×147). `Teks-Erp/ARCHITECTURE.md:800` aynı notu taşıyor.
**Koruma kontrolü.** `migrate deploy` idempotenttir ve bu dosyayı yalnız `_prisma_migrations`'ta yoksa koşar — yani gerçek tetikleyici "yarım migrate edilmiş bir DB'ye veri yüklemek". Kurulum belgeleri (`docs/ops/KURULUM.md:181`) doğru sırayı yazıyor (`migrate deploy` → seed → içe aktarım) ama **mekanik bir kapı yok**: içe aktarım uçları (`routes/import.routes.ts`) "şema tam mı" diye sormuyor.

**failure_mode.** Yeni müşteri kurulumu, deneyimsiz bir elde: DB yaratılır, `migrate deploy` bir hata yüzünden yarıda kesilir (ör. D-J-13'ün timeout'u), operatör "şema kuruldu galiba" deyip içe aktarımı yapar, sonra `migrate deploy`'u tekrar koşar → `native_uuid` dosyası bu kez **dolu** tablolara uygulanır ve yeni içe aktarılan tüm kayıtların id kolonu düşürülüp yeniden yaratılır → içe aktarılan veri (ve ona bağlı her şey) kaybolur.

**Veride fiili ihlal (K2).** "Aranmadı" — tarihsel dosya, mevcut iki DB'de de uygulanmış.

**Öneri (2. tur).** İçe aktarım servisine (ya da `server.ts` boot'una) tek bir ön koşul: `prisma migrate status` eşdeğeri — **pending migration varsa içe aktarım uçları 503 döner** ("şema güncel değil"). Bu aynı zamanda D-J-09'un sahadaki karşılığını da kapatır. Alternatif (daha ucuz): `docs/ops/KURULUM.md`'ye kalın bir uyarı + kontrol listesi kutusu.
[PROD'DA ÇALIŞTIRMA] — boot kontrolü davranış değiştirir (pending migration varsa uçlar kapanır); mevcut fabrikada bugün 5 pending var, yani **önce deploy, sonra bu kontrol** sırası zorunlu. Geri alma: kontrolü bir env bayrağıyla kapat.
**Kabul kriteri.** Pending migration varken içe aktarım ucu 503 + Türkçe mesaj.
**Efor.** 0,5 gün.
**Önceki defter.** K2b H-10.

---

### [D-J-17] Ölü `Teks-Erp/yedekle.sh` repoda duruyor — sahadaki `yedekle.ps1` ile karıştırılmaya açık, farklı saklama ve panelin göremeyeceği bir biçim

| Şiddet | S4 | Kategori | J (yedek: saklama tutarlılığı) | Öncelik | P6 | Modül | yedek | Kanıt seviyesi | K1 |

**Özet.** `Teks-Erp/yedekle.sh` Docker döneminden kalma: `docker compose exec` ile `pg_dump | gzip` alır, çıktı `backups/tekserp_<ts>.sql.gz`, saklama **7 gün**. Bugünkü kurulumda docker yok (`docker-compose.yml` prod'da kullanılmıyor, KUNYE), ürettiği `.sql.gz` panelin hiçbir yüzeyinde görünmez (dört yol da `.dump` şart koşar, `backup.service.ts:220-226` ve `app.ts:206`), `pg_restore --list` ile doğrulanamaz (düz SQL) ve saklama politikası ekosistemin 30 günüyle çelişir.

**Kanıt.** `Teks-Erp/yedekle.sh:16,23-27` (`.sql.gz`, `find … -mtime +7 -delete`). Adı sahadaki `yedekle.ps1` ile bir harf farklı.

**failure_mode.** Bir devir/onarım anında "yedek script'i repoda var" diye bu dosya bulunur ve koşturulur/örnek alınır; ürettiği yedek panelde görünmez, bütünlüğü doğrulanmaz ve 7 günde silinir → "yedeğim var" sanısı.

**Öneri (2. tur).** Sil, ya da `Teks-Erp/installer/docker/` altına taşı (o dizin zaten tarihsel) ve başına "TARİHSEL — docker dönemi, sahada kullanılmaz, `deploy/`ye bak" satırı ekle. D-J-03 §1 uygulanırsa yerine gerçek `deploy/yedekle.ps1` gelir.
**Kabul kriteri.** Repo kökünde yedek alan tek script sahadakiyle aynı olan.
**Efor.** 0,1 gün.
**Önceki defter.** Yok.

---

## 2. Uygulanan kontrol listesi (Prompt Bölüm 3-J, satır 650-659) + göreve eklenen 8 madde

| # | Madde | Durum |
|---|---|---|
| J.1 | Migration'lar sürümlü mü? | **Uygulandı** — 195 dizin, `migration_lock.toml` `provider=postgresql` (git'te), `_prisma_migrations` saha 190/190 `finished_at` dolu · 0 `rolled_back` · **0 `applied_steps_count=0`** (temiz `migrate deploy`). Dev'de 40 elle `resolve` (K2b H-5, dev hijyeni). Git tarafı bekçi `scripts/check-migrations.mjs` **koşuldu: yeşil, 195 izleniyor, 0 untracked/modified**. |
| J.1b | Elle SQL çalıştırma pratiği var mı? | **Uygulandı** — VAR ve belgeli (`MIGRATION-DEPLOY.md:89-124`, "YALNIZ DEV" işaretli). Prod'da fiilen kullanıldığı ÖLÇÜLDÜ (defter dışı enum değeri) → **D-J-07**. |
| J.2 | `prisma db push` üretimde kullanılıyor mu? | **Uygulandı — HAYIR.** `grep -rn "db push\|db:push"` repo genelinde **0** vuruş (package.json, scripts, docs, deploy). `migrate reset` yalnız tarihsel/yasak bağlamında geçiyor. Üretim paketinde `prisma.config.js` **seed kancası taşımıyor** (`paketle.ps1:132-135`) ve `src/`+`scripts/`+`prisma/seed*.ts` pakete girmiyor → prod'da `db push`/`seed`/`reset` **fiziksel olarak imkânsız**. Doğru yapılanlar listesine alındı. |
| J.3 | Büyük tabloda kilit: `CONCURRENTLY`, `ALTER TABLE`, `SET NOT NULL` | **Uygulandı** → **D-J-13**. Ölçüm: CONCURRENTLY 0/621, `lock_timeout` 0, `SET statement_timeout=0` 34/195; saha en büyük tablo 10.485 satır → bugün risk yok; `kur.ps1`'in pm2'yi durdurması gerçek hafifletici. |
| J.4 | Zero-downtime: kolon silme/rename tek adımda | **Uygulandı** — `DROP COLUMN` 248 satır (≈215'i `native_uuid`), `RENAME COLUMN` 1 (`20260627120000:7`). Deploy sırası bunu **kapatıyor**: `kur.ps1` [4/9] `pm2 delete` → [5/9] kod → [7/9] migrate → [8/9] `pm2 start`, yani "eski kod ↔ yeni şema" penceresi **yok** (tarihsel `git pull` akışında vardı ve `MIGRATION-DEPLOY.md:42-55` bunu açıkça uyarıyor). İstemci ekseni ayrı: **D-J-10**. |
| J.5 | Backfill scriptleri parçalı / tekrar çalıştırılabilir / yarıda kalırsa | **Uygulandı** → **D-J-15**. Dry-run 10/10 ✔ · tekrar çalıştırılabilir 10/10 ✔ · parçalı **0/10** ✘ · "her kaydı listeler" 9/10. |
| J.6 | Yedek: sıklık, saklama, geri yükleme testi, RPO/RTO | **Uygulandı** → **D-J-03, D-J-04, D-J-05**. Sıklık: gece 02:00 harici görev (repo dışı) + backend 03:00 (repoda kapalı ama sahada koşmuş). Saklama: 30 gün + en yeni 3 (backend); harici görev politikası doğrulanamaz. Geri yükleme testi: **0 kayıt**. RPO/RTO: on-prem için yazılı **değil**. |
| J.7 | Seed verisi mükerrer üretiyor mu? | **Uygulandı — HAYIR (prod'da koşamaz).** `prisma/seed.ts:4-6` kendisi söylüyor: *"Her şey `create` ile yazılır; ikinci kez çalıştırılırsa unique constraint hatası verir — bu beklenen"*; tek idempotent adım izinler (`createMany skipDuplicates`, gerekçesi `:62-67`). `seed-fixtures.ts` `code` üzerinden **upsert** (idempotent, `:13`) ve tombstone'u diriltmiyor (`:30-33`). Üretim paketinde seed kancası ve seed dosyaları **yok** → prod'da mükerrer üretme yolu kapalı. Kalan risk: dev makinesinden prod `DATABASE_URL` ile koşum (D-J-11 §2'nin kapsadığı sınıf). |
| J.8 | Rollback politikası: "geri alınamaz, restore" — reçete güncel mi? | **Uygulandı** → **D-J-06**. Politika doğru ve tutarlı üç belgede yazılı; **eksik olan başarısız-migration (P3009) dalı**. `kur.ps1 -GeriAl` harness ile test edilmiş (`deploy/test/kur-gerialma.harness.ps1`) — doğru yapılanlar listesinde. |
| Görev-1 | Yumuşak kapı index'lerini saha'da ÖLÇ | **Uygulandı** → **D-J-08**. Saha: `items_nameFold_key` YOK (1 mükerrer grup, id'ler verildi); `customers`/`subcontractors`/`colors` VAR. Dev: `colors_nameFoldColor_key` YOK. Ayrıca saha'da `orders_active_createdAt_idx` yok (henüz deploy edilmemiş migration). |
| Görev-2 | Hangi bekçi kırmızı gösteriyor / kırmızı körlüğü | **Uygulandı** → **D-J-08**. `test_db_invariants` KIRMIZI (beklenen-başarısızlık mekanizması **yok**), `test_schema_drift` aynı duruma **TOLERE** diyor (`:84-103`). Asimetri belgelendi. |
| Görev-3 | `client-version-policy.ts` eski istemciyi kapatıyor mu | **Uygulandı** → **D-J-10**. Electron için evet (ama sahada kurulum yok); mobil için **hayır** (sürüm serisi geriye alındı). |
| Görev-4 | Migration içi `UPDATE` idempotent mi / yarıda kalırsa | **Uygulandı.** 33 `UPDATE` · 7 `INSERT` · 5 `DELETE` satırı (K2b §1.9). Yarıda kalma: Prisma tek tx → **tam geri alma** (kanıt D-J-06); tekrar koşum yalnız elle `db execute` yolunda anlamlı ve orada dosyalar `IF EXISTS/NOT EXISTS` ile korunmuş (örnek `20260714120000:4-5` — premisi yanlış ama sonucu doğru). Kalıcı risk: `db execute --file <migration>` **genel** bir talimat olarak yazılı (`20260821150000:19`) ama yalnız iki yumuşak-kapı dosyası için güvenli; `20260714120000:31` (`DELETE FROM traveler_cards`) ve `20260612121000:4-22` (`DELETE FROM shipment_allocations`) gibi dosyalar için değil → D-J-06 önerisine "yalnız yumuşak-kapı dosyaları yeniden koşulur" notu eklendi. |
| Görev-5 | `reset-operational.ts` TRUNCATE kapısı | **Uygulandı** → **D-J-11**. |
| Görev-6 | `migration_lock` / şema drift riski | **Uygulandı.** `migration_lock.toml` git'te, sağlıklı. Drift kapısı `test_schema_drift.ts` mevcut ve **iki bilinen composite FK dışında her farkı kırmızı** yapıyor (allowlist gerekçeli). Dev↔saha katalog farkı 6 kalemde (K2b §2.2) ve hepsi açıklanabilir (5 deploy edilmemiş migration + 2 yumuşak kapı). Ek drift riski: **D-J-07** (nesne var, defter yok — bu yönü hiçbir kapı ölçmüyor). |
| Görev-7 | Per-DB GUC'lar restore'da taşınmaz | **Uygulandı** → **D-J-12**. Kopya yolunda replay + `fail` ölçütü **var** (`db-copy.service.ts:606-630`, `db-copy-verify.service.ts:157-180`) — örnek gösterilecek bir çözüm. Tam-kayıp restore yolunda **yok**; `statement_timeout` için hiçbir görünürlük yüzeyi yok; `auditGuard` alanının tüketicisi yok. |
| Görev-8 | Yedek dosyası bütünlük kontrolü | **Uygulandı.** Backend yolunda **var ve örnek**: `.part` → `pg_restore --list` → `rename` (atomik), bozuk dump silinir ve rotasyona inmez (`backup.service.ts:269-290`); `kur.ps1` [3/9] `premigrate_` dump'ını da `pg_restore --list` ile doğruluyor (`:183-184`). Sahadaki gece yedeğinde **yok** (D-J-03). |
| — | `prisma migrate reset` izi | **Uygulandı — prod'da yok**; yalnız yasak/tarihsel bağlamda geçiyor (`KURSUN-BYPASS-DEPLOY.md:5`, `SURUM-2.9.0…:119`, `KURULUM.md:39`). |
| — | Repro (K3) | **Kapsam dışı** — D-J bulguları eşzamanlılık yarışı değil; sözleşme gereği repro yalnız D-A/D-B'den isteniyor. Deploy zinciri için repro, prod benzeri bir Windows/pm2 ortamı isterdi (yok). |

---

## 3. Doğru yapılanlar (korunması gereken kalıplar)

1. **Geri alınamaz eşiğin doğru yere konması.** `kur.ps1` sırası: doğrulanmış `premigrate_` yedeği [3/9] → pm2 durdur [4/9] → dosyaları yerleştir [5/9] → **`migrate deploy` [7/9]** → pm2 başlat [8/9] → `/health` [9/9]. Migration'dan önceki her hata **otomatik geri alınıyor**, sonrası insana bırakılıyor ve bu ayrım dosyanın başında (`:20-32`) açıkça yazılı. `build → migrate` sırasının gerekçesi tablo halinde (`MIGRATION-DEPLOY.md:42-55`) — "hangi adım DB'ye dokunmaz" sorusunun doğru cevabı.
2. **Geri alma yolunun kendi tuzağının öğrenilmiş olması.** `GeriAlOtomatik` ön koşulu (`kur.ps1:206-224`): *"geri koyacak bir şey YOKSA hiçbir şeyi silme"* — eski kod "sil"i hedefe, "geri koy"u kaynağa bakarak karar veriyordu ve tam hata anında çalışan kurulumu yedeksiz siliyordu. Düzeltme ayrıca `-ErrorAction Stop` (hedef doluysa `Move-Item` **içine** taşır) ve `KokeDon`'u ilk satıra almayı içeriyor. Bir kurtarma yolunun kendisi için yazılmış harness da var: `deploy/test/kur-gerialma.harness.ps1`.
3. **Yedek yayınlama protokolü (`.part` → doğrula → atomik `rename`).** `backup.service.ts:222-290`: yarım bir dump **hiçbir yüzeyde görünmez**, çünkü dört liste yolu da `.dump` şart koşuyor ve bu şart yorumda "yeni yüzey eklerken aynı şartı koru" diye kayıt altına alınmış. Rotasyonun `RETENTION_MIN_KEEP=3` tabanı (sistem saati ileri kayarsa hepsini silmesin) tam olarak bu sınıf düşüncenin örneği.
4. **Kopyaya geri yükleme + doğrulama katmanı.** Canlıya hiç dokunmadan geri yükleme, ardından **locale/collation birebir**, **per-DB GUC replay ve eşitlik `fail` ölçütü**, migration kümesi, tablo sayıları ve boyut karşılaştırması (`db-copy-verify.service.ts:117-200`). "`applied_steps_count` BİLEREK kullanılmıyor" notu (`:181-183`) bir yanlış-alarm kaynağının önceden elenmesi. Bu, sektörde nadiren bu kadar iyi yapılır — kullanılmıyor olması (D-J-05) bulgunun kendisi.
5. **Üretim paketinin "kaza yapamaz" kurulumu.** `paketle.ps1` pakete `src/`, `scripts/`, `prisma/seed*.ts` koymuyor ve `prisma.config.js`'i **seed kancası olmayan** üretim sürümüyle değiştiriyor (`:132-135`, yorumu: *"canli DB'de seed kazasi imkansiz"*). `kur.ps1:132-138` paketi açtıktan sonra zorunlu dosyaları doğruluyor, `src\` görürse uyarıyor, hem `.ts` hem `.js` prisma config'i varsa **durduruyor**.
6. **Üç ayrı soru soran üç ayrı migration bekçisi.** `check-migrations.mjs` (*commit edildi mi* — 5 gate, yerelde değerli), `test_migration_hygiene.ts` (*defter tutarlı mı*), `test_schema_drift.ts` (*DB gerçekten şema gibi mi*, allowlist beyan zorunluluğuyla). Üçünün de "neden var" bölümü, kaçırdıkları gerçek vakayı anlatıyor (2026-07-30'da üç migration git'e hiç girmemiş).
7. **Dry-run kültürü.** 10 backfill/fix/repair scriptinin **hepsi** dry-run varsayılan + `--apply`; dokuzu etkilenecek kayıtları tek tek listeliyor; `repair_sack_ghost_rolls.ts` ayrıca "tartısını kaybedecek çuvallar" için **ayrı** bir onay bayrağı istiyor (`--apply --planned`). `clean_test_residue.ts` silme kararını yalnız test kod öneklerine bağlıyor, **ada göre asla** (`:14-17`).
8. **CI'nın kapsamı (tetikleyicisi hariç, D-J-01).** Her PR'da boş PostgreSQL 16'ya `migrate deploy` + `seed` + `seed:fixtures` + lint + iki ayrı `tsc` + 366 bekçi. `typecheck:scripts` adımının ayrı olması bilinçli bir teşhis kararı; `seed:fixtures`'ın neden ayrı olduğu yorumda ölçülmüş sonuçla anlatılıyor (73 test "Seed fixture eksik: PATOS" ile düşüyordu ve 2 hafta görülmedi).

---

## 4. Sınır ötesi notlar

- **→ D-I (gözlemlenebilirlik):** `auditGuard` alanının **hiçbir istemcisi yok** ve bekçisi metin araması (D-J-12) — audit sağlığı ekseninin sizde de karşılığı olabilir. Ayrıca gece yedeği bayatlığı yalnız **pull** (biri Sunucu Durumu ekranını açarsa) görünüyor; sunucu tarafında hiçbir kayıt/alarm yok, `job-failure.ts` yalnız backend job'larını kapsıyor ve saha gece yedeğini backend almıyor.
- **→ D-I / D-K:** `test_db_invariants` prod'da kalıcı olarak çıkış kodu 1 veriyor (D-J-08) — "beklenen kırmızı" mekanizmasının eksikliği bekçi kültürünün geneline dokunuyor; `test_schema_drift`'in `TOLERATED_DRIFT` deseni hazır bir çözüm.
- **→ D-K (test/bekçi):** `test_client_policy.ts` mobil ayağı hiç ölçmüyor (D-J-10); `test_migration_hygiene` pending'i uyarı basıyor (D-J-09); `test_audit_depth:529` metin araması. Üçü de "bekçi kendi ölçtüğü şeyin dışında kalıyor" sınıfı.
- **→ D-G (güvenlik):** `.env` git'te (`F-OPS-VER-001`, hâlâ açık — yeniden açılmadı, yalnız referans). Deploy zinciri `.env`'i `Copy-Item` ile geçici dizine (`$env:TEMP\tekserp-env-<damga>.bak`, `kur.ps1:163-164`) alıp orada **bırakıyor** — sır taşıyan dosya TEMP'te kalıcı; sizin alanınız.
- **→ D-C / D-E:** Saha'da `orders.cancelledAt` / `order_lines.cancelledAt` **yok** ama HEAD kodu okuyor (`order-line-scope.helper.ts:26`) — bir sonraki deploy'a kadar bu kolonları kullanan hiçbir davranış sahada mevcut değil; "aktif kalem" değişmezinin saha ölçümü bu yüzden **bugünkü** koda göre yapılamaz.
- **→ D-C:** `20260708120000_faz4:79-85` composite FK'ları `ON UPDATE CASCADE` — çuval başka sevkiyata taşınınca `rolls.shipmentId`/`swatches.shipmentId` **DB tarafından** yazılır (uygulama, audit ve `preShipStatus` mantığı devre dışı). Migration açısından yerinde ve doğrulanmış; davranış tarafını sevkiyat denetçisi ölçmeli.
- **→ D-B (mükerrer/idempotency):** `items` tablosunda 1 fiili mükerrer grup (id'ler D-J-08'de) ve sed'in eksikliği; ad seddinin uygulama ayağı check-then-act.
- **→ ops (denetim dışı, kullanıcıya):** Prod'un gerçek `ecosystem.config.js` içeriği, Görev Zamanlayıcı `TeksERP-DB-Backup` görevinin durumu, `BACKUP_OFFSITE_DIR`'in gerçekten makine dışı olup olmadığı ve `teks.audit_guard`'ın açık olup olmadığı **bu denetimden doğrulanamaz** (canlıya erişim yok, per-DB ayarlar restore ile taşınmaz). Dört sorunun cevabı D-J-02/03/04/12'nin şiddetini yukarı ya da aşağı çeker; ikinci turdan önce sunucuda okunmalı: `pm2 env 0 | findstr BACKUP`, `schtasks /query /tn TeksERP-DB-Backup /v`, `psql -c "SELECT setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase WHERE d.datname='tekserp'"`.

---

## 5. KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod sunucusu.** `ecosystem.config.js`'in gerçek içeriği, `yedekle.ps1`'in varlığı/içeriği, Görev Zamanlayıcı görevinin durumu, `BACKUP_DIR`'deki dosya listesi ve yaşları, rclone kurulumu, per-DB GUC'lar (`statement_timeout`, `idle_in_transaction_session_timeout`, `teks.audit_guard`), disk doluluğu, pm2 log rotasyonu. Prod kopyası bunların **hiçbirini** taşımaz (restore per-DB ayarları ve dosya sistemini taşımaz). D-J-02/03/04/12'nin saha ayağı bu yüzden audit defterinden **dolaylı** kanıtlandı.
- **Prisma migration transaction semantiğinin çalıştırılarak doğrulanması.** Karar, repo'nun kendi 55P04 gerekçelerinden ve PostgreSQL simple-query protokolünden türetildi (D-J-06); salt-okunur kural gereği kasıtlı bozuk bir migration ile deneme DB'sinde ölçülmedi. 2. turda ölçülebilir: boş bir `teks_probe` DB'sinde ortasında hata olan bir dosya + `_prisma_migrations` satırının hâli.
- **Migration checksum bütünlüğü.** `_prisma_migrations.checksum` ↔ dosya hash'i karşılaştırması yapılamadı (Prisma'nın algoritması `sha256(dosya)` ile eşleşmiyor; K2b de aynı duvara çarptı). "Uygulandıktan sonra düzenlenmiş dosya" sorusu **git tarafından** kapatıldı (`check-migrations.mjs` GATE 2 koşuldu: yeşil) ama DB tarafı açık kaldı.
- **DDL sürelerinin ölçümü.** Bugünkü hacimde (toplam ~20 MB) anlamsız; büyüme senaryosu repo'nun kendi ölçümlerinden alıntı (`CLAUDE.md:270`).
- **`deploy/kur.ps1` ve `paketle.ps1`'in çalıştırılarak doğrulanması.** Windows/pm2/PostgreSQL ortamı yok; `deploy/test/*.harness.ps1` de koşulmadı (pwsh yok — proje belleğindeki not). Bulgular statik okumadan.
- **Electron/mobil güncelleme kanallarının (`guncelleme.etkiliyazilim.com`) durumu.** Ağ erişimi kapsam dışı; D-J-10 yalnız **politika** eksenini ele alıyor, yayın kanalını değil.
- **`20260611084953_native_uuid_pk_fk` (2.254 satır) ve `20260525174522_init` (1.678 satır)** satır satır okunmadı — başlık, kilit noktaları ve grep sayımları kullanıldı.
- **`system_logs` arşivleme yolunun (`audit.service.ts:233` `SET LOCAL teks.audit_purge`) kurtarma etkileşimi** — D-I/D-audit alanı; burada yalnız `reset-operational.ts`'in TRUNCATE'inin bu trigger'a takılıp takılmayacağı (audit_guard'a bağlı) not edildi.
