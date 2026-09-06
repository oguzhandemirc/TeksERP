# TeksERP — Üretim Deploy Runbook

Bu doküman backend'i (`Teks-Erp/`, Express 5 + Prisma 7 + PostgreSQL) bir
üretim/fabrika sunucusuna kurma ve güncelleme adımlarını içerir.

> **2026-07-30 — dağıtım yolu değişti.** Eskiden tek `setup.exe` (Inno Setup +
> gömülü Node/PostgreSQL/NSSM) vardı; backend NSSM ile Windows servisi olarak
> koşuyordu. **Bu yol tamamen kaldırıldı** (`Teks-Erp/installer/windows/` silindi).
> Artık PostgreSQL sunucuya normal kurulur, backend **pm2** ile ayağa kaldırılır.
> Kurulumla birlikte gelen iki iş de backend'e taşındı: **gece yedeği** artık
> `jobs/backup-scheduler.ts` + `services/backup.service.ts` (Görev Zamanlayıcı ve
> `manage.ps1` YOK).

> Migration ayrıntıları için `Teks-Erp/MIGRATION-DEPLOY.md`'ye, deploy öncesi
> madde-madde kontrol için `URETIM-KONTROL-LISTESI.md`'ye bakın.

> ### ⚠️ ÖNCE SÜRÜME ÖZEL NOTU OKU
>
> Bu runbook **genel** sırayı anlatır. Bazı sürümler `migrate deploy`'un
> ARDINDAN koşulması gereken **tek seferlik** adımlar getirir (geriye doldurma
> script'i, izin ataması, veri onarımı). Bunlar `docs/ops/SURUM-*-DEPLOY.md`
> dosyalarında yaşar ve **runbook'ta tekrarlanmaz** — atlanırsa hata vermez,
> sessizce eksik veri bırakır.
>
> **Deploy etmeden önce `docs/ops/` içindeki en yeni `SURUM-*-DEPLOY.md`
> dosyalarını, en son deploy tarihinden bugüne kadar olanları oku.**
>
> | Sürüm | Ek adım |
> |---|---|
> | **`SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md`** | ✅ **SAHADA UYGULANDI 2026-08-24** (commit `935f180`, 24 migration) — artık geçmiş kaydı; rakamları canlı ölçümle güncellendi. Sonraki sürümün reçetesi ayrı dosyada açılır. |
> | `SURUM-2026-08-09-RAPORLAR-DEPLOY.md` | migration + **`backfill_roll_production_timestamps.ts --apply`** |
> | `SURUM-2026-08-06-YETKI-DEPLOY.md` | rol şablonları — izin ATAMASI elle |
> | `SURUM-2026-08-05-DEPLOY.md` · `SURUM-2026-08-03-DEPLOY.md` | kendi notlarına bak |

---

## SAHADAKİ KURULUM — yetkili değerler (SAHINSRV, 192.168.1.250)

> ⚠️ Çok müşteri notu — bu tablo **bir kurulumun** yetkili değerleridir (referans fabrika: SAHINSRV). Sütunların kendisi (PG sürümü/portu · PG yolları · DB/kullanıcı · çalışan paket dizini · pm2 adı · build klonu · deploy script'leri · pm2 daemon hesabı · boot görevi · gece yedeği · backend scheduler durumu) **her kurulumda sorulması gereken çekirdek listedir**; değerler müşteriye göre değişir. Yeni fabrika devreye alınırken bu tablo kopyalanıp o kurulumun ölçülmüş değerleriyle doldurulur — tahminle değil, sunucuda ölçülerek (2026-08-25 dersi: dokümanlar `C:`'yi anlatıyordu, paket `D:`'den üretiliyordu).

Bu belgedeki genel anlatım herhangi bir sunucu içindir; **fabrikadaki gerçek
kurulum** şudur. Çelişki görürseniz bu tablo geçerlidir.

| Ne | Değer |
|---|---|
| PostgreSQL | **16.9**, servis `postgresql-tekserp`, port **5432**, initdb UTF8 / **C locale** |
| PG yolları | `C:\Etkili-Yazilim\pgsql\bin` · veri `C:\Etkili-Yazilim\pgdata` |
| Veritabanı / kullanıcı | **`tekserp`** / `tekserp` · superuser `postgres` |
| Backend (ÇALIŞAN) | **`C:\Etkili-Yazilim\app`** — `kur.ps1` ile kurulan PAKET (git klonu DEĞİL) · pm2 adı **`tekserp-backend`** · önceki sürüm `app.eski-<damga>` |
| Build klonu (yalnız paket üretmek için) | **`D:\tekserp-build\tekserp`** — tam checkout, geniş refspec, `adnansahin` ucu. ⚠️ `C:\Etkili-Yazilim\tekserp` klonu sparse (`deploy/` yok) + dar refspec (`adnansahin`'i fetch etmez) → paket için KULLANMA (`deploy/README.md`). Çalışan kod klondan KOŞMAZ |
| Deploy script'leri | `C:\Etkili-Yazilim\kur.ps1` (repo kaynağı `deploy/kur.ps1` — **elle kopyalanır**) · `deploy/paketle.ps1` (klon kökünden `.\deploy\paketle.ps1`; kökteki eski untracked kopya aynı dosya) |
| pm2 daemon | **SYSTEM** hesabı → **pm2 komutları YÖNETİCİ shell ister** (`EPERM \\.\pipe\rpc.sock` alıyorsanız sebebi budur) |
| Boot | Görev **`TeksERP-Backend-Boot`** → `pm2-boot.cmd` → `pm2 resurrect` (sistem açılışında, SYSTEM) |
| Gece yedeği | Görev **`TeksERP-DB-Backup`**, **02:00**, `yedekle.ps1` → `C:\Etkili-Yazilim\backups`, **30 gün** |
| Backend scheduler | **KAPALI** (`BACKUP_SCHEDULE_ENABLED=false`) — gece yedeğini yukarıdaki görev alır |

> ⚠️ **2026-09-02 —** `adnansahin` dalı **EMEKLİ**; build klonu `main` ucundadır ve paket `main`'den üretilir (`docs/design/MODUL-BAYRAK-TASARIM.md` §0: müşteri dalı/forku yasak). Yukarıdaki "Build klonu" satırındaki `adnansahin` ucu ifadesi tarihseldir. Sunucuda tek seferlik geçiş adımı ve `git branch -D adnansahin` temizliği `deploy/README.md`'dedir. `C:\Etkili-Yazilim\tekserp` klonunun dar refspec'i (`+refs/heads/main`) artık YETERLİDİR; onu paket için kullanmama gerekçesi yalnız sparse checkout'ta `deploy/` dizininin olmamasıdır.

> **Neden gece yedeğini backend almıyor:** bağımsız görev, **backend çökmüş ya da
> kapalıyken bile** yedek alır — backend'e bağlı bir zamanlayıcının veremeyeceği
> garanti. İkisi birden açık kalırsa her gece iki dump alınır.

Deploy akışı: **§3 (paket tabanlı)** + `deploy/README.md`. Yedek/geri yükleme denetimi:
`docs/history/PM2-GECIS-DEVIR-NOTU.md` (deploy adımları orada tarihseldir).

---

## 0) Ön-koşullar

| Bileşen | Sürüm | Not |
|---|---|---|
| Node.js | **22.x** | Sunucuya kurulu olmalı (artık gömülü Node yok) |
| pm2 | güncel | `npm i -g pm2` |
| PostgreSQL | **15+** | Sahada **16.9** · dev 18.4. Kod her ikisini destekler (`datlocale`/`daticulocale` sürüm dalı). Yükseltme şu an gerekmiyor |
| Disk | yeterli boş alan | DB + yedekler büyür; saklama **30 gün** (`BACKUP_RETENTION_DAYS`) |
| RAM | makul | Node backend + PostgreSQL aynı makinede |

> **Not:** `package.json`'da `engines` alanı tanımlı değil — Node 22 bir
> operasyonel gerekliliktir, paket düzeyinde zorlanmaz.

> **⚠ PG major sürümü ve `PG_BIN_DIR` aynı majoru göstermeli.** Yedekleme
> `PG_BIN_DIR` altındaki `pg_dump`/`pg_restore`'u çalıştırır; bu ikili sunucudaki
> PostgreSQL'den **eski** bir majorsa dump alınamaz. Sahada ikisi de 16.9
> (`C:\Etkili-Yazilim\pgsql\bin`).

> **Dev (18.4) ↔ üretim (16.9) sürüm farkı — bilinçli olarak kabul edildi.**
> Riskli yön yalnızca "dev dump'ını üretimde açmak"; öyle bir akış yok (üretim
> kendi dump'ını kendi açar) ve ters yön (üretim dump'ı → dev'de aç) çalışır.
> Kalan risk: yeni SQL/migration'lar yalnız 18'de test ediliyor. Index/raw SQL
> içeren migration'ları üretim öncesi bir PG16 kopyasında deneyin.

---

## 1) Ortam değişkenleri — iki ayrı yer

Sırlar `.env`'de, operasyonel ayarlar `ecosystem.config.js`'de durur. Ayrımın
sebebi: `ecosystem.config.js` git'te tutulur, `.env` tutulmaz.

### `Teks-Erp/.env` (sırlar — git'e GİRMEZ)

```
DATABASE_URL="postgresql://<user>:<pass>@127.0.0.1:<port>/<db>?schema=public"
JWT_SECRET="<en az 32 karakter güçlü rastgele>"
```

- **`JWT_SECRET` ≥ 32 karakter ZORUNLU.** Backend açılışta **enforce eder**
  (`src/services/auth.service.ts`): kısa/eksik secret ile sunucu açılmaz.
- **`DATABASE_URL`** — ortam başına farklı DB adı: dev = `tekserp_demo`,
  üretim = `tekserp`. **Yedekleme bu URL'yi kullanır** — `backup.service.ts`
  host/port/user/db/şifreyi buradan çözer. Bozuksa yedek alınmaz.
  - ⚠️ **Bayat düzeltmesi (2026-09-03):** dev DB adı artık `tekserp_demo` (Docker `tekserp-local-db`, port 55433) — eski `adnansahin_db` düzeltildi; üretim `tekserp`. **Çok müşteride DB adı bir kurulum parametresidir** — dokümana müşteri adı gömmek yerine "ortam/müşteri başına farklı; yetkili değer o kurulumun `.env`indedir" demek doğru olanıdır. Yanlış ad geri yükleme tatbikatında hedefi ıskalatır.
- Eski `secret.json` **artık yok** (installer üretiyordu). Tek yetkili sır
  kaynağı `.env`'dir — **yedekleyin**; kaybolursa mevcut DB'ye bağlanılamaz.

### `Teks-Erp/ecosystem.config.js` (operasyonel — git'te)

`PORT`, `HOST`, `NODE_ENV`/`APP_ENV` ve yedekleme ayarları burada:

| Değişken | Anlamı |
|---|---|
| `BACKUP_DIR` | Yedek klasörü. **TANIMSIZSA GECE YEDEĞİ ÇALIŞMAZ** |
| `BACKUP_OFFSITE_DIR` | Makine dışı ikinci kopya (NAS/UNC). Boşsa yedekler DB ile aynı diskte |
| `BACKUP_HOUR` | Gece yedeğinin saati — **yalnız fallback**. Yetkili kaynak panel: Sistem → Yedekler → "Otomatik yedek saati" (`SystemSetting backup.hour`). Öncelik: DB → env → `3`. Saat değişikliği **restart gerektirmez** (zamanlayıcı her 15 dk'da okur) |
| `PG_BIN_DIR` | `pg_dump`/`pg_restore` konumu — Windows'ta PATH'te olmaz |
| `BACKUP_PG_USER` / `BACKUP_PG_PASSWORD` | **Opsiyonel.** Yedeği ayrı bir DB kullanıcısıyla al (aşağıya bakın). Şifre sır → `.env`'e |

> **⚠ `pg_dump` hangi kullanıcıyla koşuyor?** Varsayılan olarak `DATABASE_URL`'deki
> **uygulama kullanıcısı**. O kullanıcı tabloların sahibi ya da superuser değilse
> `pg_dump` ya `permission denied for table X` ile patlar ya da bazı nesneleri
> atlayıp **sessizce eksik** bir yedek üretir. Eski installer yedekleri `postgres`
> süper kullanıcısıyla alıyordu. Uygulama kullanıcısı DB sahibi değilse
> `BACKUP_PG_USER=postgres` + `BACKUP_PG_PASSWORD=...` verin. Teyit:
> ```sql
> SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = current_database();
> ```
> `owner` ile `DATABASE_URL`'deki kullanıcı aynıysa override gerekmez.

> ## ⚠️ BU DOSYA SUNUCUNUNDUR — deploy sonrası yine de KONTROL ET
>
> `kur.ps1` bu dosyayı **`.env` ile aynı muameleye tabi tutar**: kurulum öncesi
> kenara alır, yerleştirmeden sonra geri koyar (2026-08-29, commit `560f74f0`,
> BULGU-T1-020). Paketin kopyası yanına `ecosystem.config.js.paket` olarak
> bırakılır ve env anahtarlarının FARKI ekrana basılır ("pakette YENİ ayar" /
> "pakette ARTIK YOK") — değerler basılmaz, karar operatörde kalır.
>
> ⚠️ **ÖNCESİ (2026-08-29'dan önce) BÖYLE DEĞİLDİ** ve sahadaki ayar her
> kurulumda sessizce repo değerine dönüyordu. Ölçüm o dönemin izini taşıyor:
> repo dosyası `BACKUP_SCHEDULE_ENABLED:"false"` derken canlı sistem 2026-08-25
> 03:05'te `trigger=nightly` bir yedek üretmiş — yani çalışan env repo
> dosyasından ayrışmıştı.
>
> **Kontrol neden hâlâ gerekli — iki yol AÇIK kalıyor:**
> 1. Pakette YENİ bir anahtar geldiyse **elle eklenir** (script eklemez, yalnız
>    söyler). Eklenmezse o özellik sahada sessizce kapalı kalır.
> 2. Sunucuda `ecosystem.config.js` YOKSA (ilk kurulum / dosya silinmişse) script
>    paketinkini kullanır — repo varsayılanlarıyla, yani offsite hedefi BOŞ.
>
> **Deploy sonrası iki satırlık kontrol** (panel → Sistem → Sunucu Durumu ya da
> doğrudan uç):
>
> ```
> GET /api/admin/health  →  backupHealth.scheduler   : "backend" | "harici"
>                           backupHealth.verdict     : ok | uyari | kritik
>                           offsite.configured       : true | false
> ```
>
> - `scheduler:"harici"` **meşrudur** (yedeği Windows Görev Zamanlayıcı alır,
>   backend çökse bile çalışsın diye) — ama o zaman `verdict` de `ok` olmalı;
>   `harici` + `kritik` birlikte görünüyorsa **kimse yedek almıyor** demektir.
> - `offsite.configured:false` → yedekler DB ile aynı diskte.

> **⚠ Sessiz bozulma riski.** `BACKUP_DIR` NSSM servis kaydından geliyordu; pm2'ye
> geçişte taşınmadıysa yedek alınmamış olur ve hiçbir hata görünmez. Panelde
> **Sistem → Yedekler** ekranı artık bu durumu kırmızı kutuyla söyler; ayrıca
> backend açılışta `[backup] BACKUP_DIR tanımsız — otomatik gece yedeği DEVRE DIŞI`
> uyarısı log'lar. Deploy sonrası bu satırın **olmadığını** teyit edin.

---

## 2) İLK kurulum (yalnızca bir kez)

İlk kurulumda DB boştur; şemayı kurup admin/yetki/kalite verisini seed'leriz.

### 2.1 PostgreSQL

Sunucuya PostgreSQL kurun, sonra `postgresql.conf`'a TeksERP ayarlarını uygulayın
(aşağıdaki §6 — **bu değerler eski installer'dan taşındı, atlanmamalı**), DB ve
kullanıcıyı oluşturun:

```sql
CREATE DATABASE "tekserp" ENCODING 'UTF8';
```

> **Collation kararı:** eski installer `initdb ... -E UTF8 --locale=C` kullanıyordu.
> `--locale=C` altında `ILIKE` **yalnız ASCII'yi katlar** — `'ŞİŞLİ' ILIKE '%şişli%'`
> **false** döner (ICU/UTF-8 locale'de true). Kodda 34 yerde `mode:'insensitive'`
> var (`customer.name`, `item.name/code`, `color.name`, `batchNumber`, `shipmentNo`…).
> Sunucu locale'i dev'den farklıysa **arama davranışı sessizce değişir**. Ayrıntı:
> `Teks-Erp/DB-MIMARI-DENETIM.md`.

### 2.2 Backend

```powershell
cd C:\...\Teks-Erp
# .env hazır (yukarıdaki iki değişken)

# Log klasörü — pm2 out_file/error_file dizinini KENDİSİ OLUŞTURMAZ.
# Yoksa süreç kalkar ama log yazamaz (sessiz teşhis kaybı).
mkdir C:\Etkili-Yazilim\logs -Force

npm ci                          # tüm bağımlılıklar
npm run prisma:generate         # client üret
npm run prisma:migrate          # = prisma migrate deploy (şemayı kur)
npm run seed                    # SADECE ilk kurulumda — admin/yetkiler/kalite
npm run build                   # tsc → dist\  (çıktı: dist\server.js)
pm2 start ecosystem.config.js
pm2 save                        # reboot'ta geri yüklenecek listeyi kaydet

# Fabrika ağına aç (tabletler + Electron PC'ler 4000'e bağlanır).
# Eski installer bunu otomatik yapıyordu — pm2 yolunda ELLE yapılır.
New-NetFirewallRule -DisplayName "TeksERP API 4000" -Direction Inbound `
  -Protocol TCP -LocalPort 4000 -Action Allow

# Sunucu keşfi (2026-08-26): backend kendini ağa "_teks-erp._tcp" olarak ilan
# eder → yeni kurulan Electron paneli IP yazmadan bulur. Bu kural OLMADAN ilan
# fabrika ağında GÖRÜNMEZ ve keşif yalnız istemcinin alt ağ taramasıyla çalışır
# (yavaş ama çalışır — yani bu kural iyileştirmedir, ön koşul değil).
# `kur.ps1` bunu artık kendisi ekliyor; bu satır mevcut kurulumlar için.
New-NetFirewallRule -DisplayName "TeksERP mDNS 5353" -Direction Inbound `
  -Protocol UDP -LocalPort 5353 -Action Allow
```

> **Keşif gerçekten çalışıyor mu?** Tek ölçüm noktası:
> `GET /api/admin/health` → `discovery.mdns.reason`. `"ok"` değilse ilan
> kurulamamıştır — Windows'ta 5353 portunu **Apple Bonjour Service** (iTunes ile
> gelir) ya da Adobe tutuyor olabilir. Kontrol: `Get-NetUDPEndpoint -LocalPort 5353`.
> İlan kurulamasa bile panel sunucuyu ağ taramasıyla bulur; kapatmak için
> `ecosystem.config.js` → `DISCOVERY_MDNS_ENABLED: "false"`.

Erişim: `http://localhost:4000` / `http://<ip>:4000`, giriş `admin / 123123`.

> **`npm run build` çıktısı `dist\server.js`'tir** (`tsconfig.json`: `rootDir=./src`,
> `outDir=./dist`) — `dist\src\server.js` **değil**. `ecosystem.config.js` bu yolu
> kullanır; yanlış yol pm2'nin uygulamayı hiç başlatamamasına yol açar.

> **PostgreSQL servisi ile sıra derdi YOK.** Yerel PostgreSQL kurulumu kendini
> Windows servisi olarak kaydeder (`postgresql-x64-18` gibi) ve boot'ta kalkar.
> pm2 backend'i PostgreSQL hazır olmadan başlatsa bile sorun olmaz: Prisma/pg
> havuzu **tembel bağlanır** (açılışta `$connect()` yok), `/health` o arada
> `db: "DOWN"` der ve ilk sorguda kendini onarır. Bu yüzden NSSM'in
> `DependOnService` karşılığına ihtiyaç duyulmadı.

> **`seed` SADECE ilk kurulumda çalıştırılır.** Sonraki güncellemelerde ASLA —
> `npm run seed` (= `npx prisma db seed`) verileri sıfırlar. Eskiden installer
> bunu `.seeded` bayrağıyla otomatik garanti ediyordu; **pm2 yolunda böyle bir
> koruma YOK — operatör disiplini gerekir.**

> **`npm ci --omit=dev` kullanıyorsanız:** `prisma.config.ts` TypeScript'tir ve
> yüklenmesi `ts-node`'a (devDependency) bağlıdır → `prisma migrate deploy` patlar.
> Bu durumda `copy deploy\prisma.config.prod.js prisma.config.js` yapın.
> devDependencies kuruluysa bu dosyayı **kopyalamayın**.

---

## 3) GÜNCELLEME (yeni sürüm — seed YOK) — PAKET TABANLI

> **2026-08-24'ten beri fabrika böyle güncelleniyor.** Çalışan kurulum
> `C:\Etkili-Yazilim\app\` bir git klonu değil, `kur.ps1`'in yerleştirdiği hazır
> pakettir; klon yalnız paketi üretmek içindir. Bu bölümün eski hâli (`git pull →
> build → migrate → restart`) **sunucuda uygulanamaz** — o akış `MIGRATION-DEPLOY.md`,
> `URETIM-KONTROL-LISTESI.md` ve `PM2-GECIS-DEVIR-NOTU.md`'de tarihseldir. Script
> kaynağı ve onarım geçmişi: **`deploy/README.md`**.

Veriler korunur; sadece kod + bekleyen migration uygulanır. **Yönetici PowerShell**
(pm2 daemon SYSTEM'dir).

```powershell
# 1) Paketi üret — BUILD klonunun kökünde (D:, tam klon); ağaç TEMİZ olsun (kirliyse Read-Host'ta asılır)
cd D:\tekserp-build\tekserp
git pull
.\deploy\paketle.ps1 -Cikti C:\Etkili-Yazilim     # → tekserp-backend-<damga>-<commit>.zip

# 2) Kur — sırayı script yapar (aşağıda)
C:\Etkili-Yazilim\kur.ps1 -Paket C:\Etkili-Yazilim\tekserp-backend-<damga>-<commit>.zip -Zorla

# 3) Sürüme özel notta yazan tek seferlik adımlar (backfill, izin, ayar) — SURUM-*-DEPLOY.md
```

`kur.ps1` dokuz adımı sırayla yürütür ve **migration öncesi her hatada otomatik geri
alır**; migration sonrası hatada durur, komutları yazar, karar insanındır:

| Adım | Ne | Hata olursa |
|---|---|---|
| 1 | Paketi aç, zorunlu dosyaları ve `PAKET.json`'ı doğrula | durur, hiçbir şey değişmemiştir |
| 2 | Mevcut kurulumu ve `.env`'i bul, `.env`'i kenara al | durur |
| 3 | **`premigrate_<damga>.dump`** yedeği + `pg_restore --list` doğrulaması (rotasyon dışı) | durur — yedeksiz devam etmez |
| 4 | `pm2 delete tekserp-backend` | — |
| 5 | Çalışanı `app.eski-<damga>` olarak kenara al, paketi `app\`'a yerleştir, `.env`'i geri koy | **otomatik geri alma** (aşağıdaki not) |
| 6 | `npm ci --omit=dev` + `prisma generate` (paket `node_modules` taşımıyorsa) | otomatik geri alma |
| 7 | `prisma migrate deploy` — **GERİ ALINAMAZ EŞİK** | durur; kod `-GeriAl`, DB `premigrate_` dump |
| 8 | `pm2 start` + **`pm2 save`** (reboot'ta doğru klasör kalksın) | `-GeriAl` |
| 9 | `/health` 120 sn | `-GeriAl` |

> **Otomatik geri alma yalnız `app.eski-<damga>` gerçekten oluşmuşsa dokunur.** İlk
> taşıma takıldıysa (`app\`'a bakan açık Explorer/terminal/editor) hiçbir şey silinmez,
> mevcut kurulum pm2 ile yeniden başlatılır. 2026-08-25'ten önceki `kur.ps1` bu durumda
> çalışan kurulumu **yedeksiz siliyordu** — onarılmış sürüm `deploy/kur.ps1`, sunucuya
> **elle** kopyalanır (script kendini güncelleyemez). Üç saha kuralı: `-Zorla` şart
> (onay sorusu oturumda asılı kalır) · çalışma dizini `app\` içinde OLMASIN · `npm ci`
> internet ister (paket `node_modules` taşıyorsa atlanır).

`migrate deploy` idempotent — yalnız `_prisma_migrations`'da olmayanları, dosya
sırasıyla uygular; tekrar çalıştırmak güvenli.

> **Migration öncesi yedeği `kur.ps1` kendisi alır** (adım 3, `premigrate_<damga>.dump`,
> `pg_restore --list` ile doğrulanır, rotasyon dışı). Bu runbook'un önceki sürümündeki
> "otomatik yedek artık YOK, elle alın" notu paket yoluyla **geçersizleşti**. Panelden
> ayrıca alınan yedek `tekserp_*` adıyla kaydedilir ve **rotasyona dahildir**; kalıcı
> olması isteniyorsa `premigrate_*` olarak yeniden adlandırılır (`backup.service.ts`
> yalnız `tekserp_` ön ekini rotasyona sokar).

> **Graceful restart:** `pm2 restart` Windows'ta gerçek SIGTERM göndermez; bunun
> yerine `shutdown_with_message: true` ile IPC mesajı yollar ve `server.ts` bunu
> dinler. Bu çift olmadan restart uçuştaki istekleri TCP düzeyinde koparır.

---

## 4) Sağlık kontrolü

```bash
curl -s http://localhost:4000/health
```

> **Gerçek endpoint `GET /health`'tir** (`src/app.ts`), `/api/health` DEĞİL —
> bir `/api/health` alias'ı yoktur.

- HTTP **200** + JSON: `status`, `db: "UP"|"DOWN"`, `version`, `uptimeSec`,
  `dbSizeBytes`, `dbConnections`, `lastBackup` + ucuz metrikler (cache isabeti,
  rolls ölü-satır %, en uzun aktif sorgu sn, kilitli sorgu sayısı).
- API çalışıyorsa HTTP her zaman 200 döner; DB ayrı test edilir (`db: "DOWN"`
  ise DB bağlantısı yok). Deploy sonrası `db: "UP"` ve 200 beklenir.
- `pm2 status` / `pm2 logs tekserp-backend` süreç tarafını gösterir.
- **`lastBackup` null dönüyorsa** yedekleme yapılandırması bozuktur (§1 uyarısı).

---

## 5) Yedek ve geri yükleme

### Yedek — backend yönetir

`pg_dump` artık backend tarafından **ayrı bir child process** olarak koşturulur
(backend bloklanmaz), sonra dört adım işler:

1. `pg_dump -Fc` → `BACKUP_DIR\tekserp_<zaman>.dump`
2. **Bütünlük doğrulama** (`pg_restore --list`) — bozuk dump **silinir** ve
   rotasyona inmez. Gerekçe: bozuk bir dosya rotasyonla sağlam yedekleri
   evict ederse felakete kadar fark edilmez.
3. **Saklama rotasyonu (GÜN bazlı)** — `BACKUP_RETENTION_DAYS` (varsayılan **30**)
   gününden eski `tekserp_*` silinir; `premigrate_*` ve `pre-restore_*` **hariç**.
   Yaşına bakılmaksızın **en yeni 3 dosya her hâlükârda korunur** (sistem saati
   ileri kayarsa gün hesabı hepsini "eski" sayıp silerdi).
4. **Offsite kopya** — `BACKUP_OFFSITE_DIR`'e kopyalanır; ayarlı değilse uyarı üretir.

### Makine dışı kopya (Google Drive / NAS / uzak sunucu) — KURULUM

> **Kod tarafı HAZIR ve panelden yönetilir; eksik olan tek şey `rclone`
> programının sunucuya konması.** Bu adım hiçbir yerde yazılı değildi
> (BULGU-T1-022 doğrulaması, 2026-08-31).

**Neden gerekli:** bugün yedekler veritabanıyla **aynı diskte**. Disk giderse
geri dönülecek bir şey de gitmiş olur. Panelde "Bağlantıyı test et" düğmesi
`rclone` yoksa şunu der: *"rclone çalıştırılamadı … Sunucuda kurulu mu?"* —
yani arıza sessiz değil, ama kurulum yapılmadan hiçbir kopya çıkmaz.

**Kurulum (sunucuda, bir kez):**

1. `https://rclone.org/downloads/` → **Windows AMD64** zip'ini indirin.
2. İçindeki `rclone.exe` dosyasını **`C:\Etkili-Yazilim\rclone\rclone.exe`**
   yoluna koyun. (Başka bir yere koyacaksanız `ecosystem.config.js` →
   `BACKUP_RCLONE_BIN` değerini o yola çevirin ve `pm2 restart` yapın.)
3. Gerisi **panelden**: Sistem → **Yedekler** → *Makine dışı kopya* kartı.

**Panelden bağlanma (Google Drive):**

| Adım | Nerede |
|---|---|
| "Google Drive'a bağlan" sihirbazını aç | Yedekler ekranı, offsite kartı |
| Tarayıcısı olan HERHANGİ bir bilgisayarda `rclone authorize "drive"` çalıştır | O bilgisayarda (sunucuda tarayıcı olmasına gerek yok) |
| Google hesabıyla giriş yap, çıkan metni panele yapıştır | Panel, "Token" alanı |
| Hedef adı ver (ör. `gdrive`) ve kaydet | Panel |
| Uzak hedefi yaz: `gdrive:tekserp-yedek` | Panel, "Uzak hedef" alanı |
| **Bağlantıyı test et** → yeşil olmalı | Panel |
| İstersen **Şimdi kopyala** ile ilk kopyayı hemen çıkar | Panel |

⚠️ **Kendi Google OAuth istemcimiz BİLEREK gömülmedi** — depoya bir client secret
koymak, kapattığımız `.env` sızıntısının aynısını üretirdi. `rclone`un kendi
istemcisi kullanılıyor; bu onun belgelenmiş "tarayıcısız sunucu" akışıdır.

⚠️ **Yenileme anahtarı (`refresh_token`) zorunlu** — panel token'ı kabul etmeden
önce kontrol eder. Olmadan erişim ~1 saatte biter ve gece kopyası sessizce
durur; "çalışıyor sanıp korumasız kalmak" en kötü sonuçtur.

⚠️ **Yedek dosyası fabrikanın TÜM verisini içerir** (müşteriler, fiyatlar, giriş
bilgileri). Hedef Drive hesabının kime ait olduğu ve paylaşımı buna göre
seçilmelidir. NAS/uzak sunucu tercih edilirse aynı kart `BACKUP_OFFSITE_DIR`
(yerel/UNC yol) alanıyla da çalışır — rclone gerekmez.

**Kopyalama ne zaman koşar:** backend açılışından sonra **saatlik** (gece yedeği
02:00'de alınır; saatlik süpürme "sabaha kadar bir kez mutlaka" garantisi verir).
Durum `/api/admin/health` → `offsite` alanında ve panelde görünür.

> **⚠ Offsite bir ağ paylaşımıysa (`\\NAS\yedek`) hangi hesap yazıyor?** Kopyayı
> backend prosesi yapar, yani **pm2'nin koştuğu hesap**. pm2 bir Windows servisi
> olarak `LOCAL SYSTEM` altında koşuyorsa o hesabın ağ paylaşımlarında kimliği
> yoktur ve kopya **erişim hatası** verir (yedek yine alınır, yalnız offsite
> adımı uyarıya düşer). Çözüm: servisi paylaşıma erişebilen bir domain/yerel
> hesapla çalıştır, ya da offsite hedefini yerel olarak bağlı ikinci bir diske
> (örn. `E:\yedek`) ver. UNC verdiyseniz **ilk yedekten sonra hedefte dosyanın
> gerçekten oluştuğunu gözle teyit edin.**

- **Otomatik:** her gün `BACKUP_HOUR` (varsayılan 03:00). Sunucu o saatte kapalıysa
  açılışta **telafi eder** (eski Görev Zamanlayıcı `-StartWhenAvailable` davranışı).
  Son çalışma `SystemSetting` → `backup.lastNightlyAt`'te tutulur.
  > **İlk deploy uyarısı:** `backup.lastNightlyAt` henüz yoksa ve backend'i
  > `BACKUP_HOUR`'dan **sonra** başlatırsanız, telafi mantığı açılıştan ~60 saniye
  > sonra **hemen bir yedek alır**. Vardiya ortasında ilk kurulumda bu beklenen
  > davranıştır (günde bir kez; damga yazıldıktan sonra tekrarlamaz), ama büyük bir
  > DB'de o an disk/IO yükü oluşturur — yoğun saatte ilk başlatmayı biliyor olun.
- **Elle:** panel **Sistem → Yedekler → "Şimdi yedek al"** (`POST /api/admin/backup`).
  Sonuç aynı ekrandaki "son yedek denemesi" kutusunda; başarısızlık artık görünür
  (eskiden sessizdi) ve `SystemLog`'a `BACKUP_COMPLETED` / `BACKUP_FAILED` düşer.

### Kopyaya geri yükleme (ÖNERİLEN — geri alınabilir)

> **⚠️ Bu yol bir kez bile DENENMEDİ** (denetim 2026-08-29, T1-023). "Yedek
> alınıyor" ile "yedekten dönülebiliyor" ayrı iki iddiadır. Prova reçetesi:
> [`YEDEK-GERI-YUKLEME-TATBIKATI.md`](YEDEK-GERI-YUKLEME-TATBIKATI.md) —
> Faz A kesintisizdir, vardiya içinde de yapılabilir.

Panel **Sistem → Veritabanı Geri Yükleme**. Yedek canlı veritabanının üzerine
yazılmaz; **yeni bir veritabanına** geri yüklenir, doğrulanır, sonra takas edilir.

**Faz A — tam otomatik, kesinti YOK.** Backend `<canlı>_restore_<damga>` yaratır
(canlının encoding/collation/locale'i **birebir** kopyalanır), `pg_restore` ile
doldurur, canlının veritabanı ayarlarını replay eder ve doğrular. Backend o
veritabanına bağlı olmadığı için kilit çakışması yok — **canlı veriye hiç
dokunulmaz**. Beğenmezseniz kopyayı silersiniz, hiçbir şey kaybolmaz.

**Faz B — elle, saniyeler.** Panel iki komut bloğu üretir (önce **geri alma**,
sonra ileri): `pm2 stop` → ön kontrol → iki `ALTER DATABASE … RENAME` →
`prisma migrate deploy` → `pm2 start`. **`DATABASE_URL` DEĞİŞMEZ.** Geri alma =
ters rename; eski canlı `<canlı>_old_<damga>` olarak durur.

> **⚠ Veritabanı ayarları rename ile TAŞINMAZ.** `pg_db_role_setting.setdatabase`
> bir **OID** kolonudur; takastan sonra `statement_timeout=50s` ve
> `idle_in_transaction_session_timeout` **eski veritabanının OID'sinde kalır**.
> Faz A bunu kopyaya replay eder ve doğrulama eşitliği `fail` ölçütü sayar —
> replay olmasaydı runaway-sorgu koruması **sessizce** yok olurdu. Testle
> kanıtlı: `pg_restore` bu satırları taşımıyor (`scripts/test_db_copy.ts`).

> **⚠ İki rename atomik DEĞİL.** Birincisi olur ikincisi olmazsa ortada canlı
> veritabanı KALMAZ ve backend hiç açılmaz. Blok bunu ön kontrol + **otomatik
> geri alma** + son sayım kontrolüyle karşılar. `exit`/`throw` yerine `if ($ok)`
> kullanılmasının ve `$LASTEXITCODE = 1` sıfırlamalarının sebebi yerine-yazma
> bloğuyla aynıdır (aşağı bakın) — burada bedeli daha ağırdır.

**Kısıtlar ve guard'lar:**
- `BACKUP_PG_USER` **CREATEDB** ya da superuser olmalı; değilse özellik kapalı ve
  panel `ALTER ROLE "x" CREATEDB;` talimatını gösterir.
- **Disk:** boş alan veritabanı boyutunun **1,2 katından azsa BLOK** — PGDATA
  birimini doldurmak canlı veritabanını durdurur. Ölçüm `PGDATA_DIR` →
  tablespace dizini → `SHOW data_directory` sırasıyla çözülür.
- **Otomatik silme YOK.** Kopyalar ve `_old_` veritabanları elle silinir;
  `_old_` için panelde silme ucu bile yoktur (geri dönüş noktası). `/health`
  `restoreCopyCount`/`restoreCopyBytes` ile unutulanları görünür kılar.
- Yarıda kalmış (`interrupted`) ya da doğrulanmamış (`unverified`) kopyaya
  **geçiş sunulmaz** — yarım bir kopya tam olanından ayırt edilemez.

### Dışarıdan yedek getirme (upload ucu YOK — dosyayı klasöre koyun)

Panelde **yedek yükleme (upload) özelliği yoktur** — backend'in hiçbir dosya-yükleme
ucu yok. Dışarıdan bir `.dump` getirmenin yolu dosyayı doğrudan `BACKUP_DIR`'e
kopyalamaktır (RDP, ağ paylaşımı, USB). Panel o klasörü okuduğu için dosya **anında
listede belirir**; indirilebilir ve "Geri yükle" onun için doğru komutu üretir.

> **⚠ Adlandırma önemli.** Rotasyon **yalnız `tekserp_` ile başlayan** dosyaları
> siler. Dışarıdan getirdiğiniz dosyayı `tekserp_...` diye adlandırırsanız 14'lük
> rotasyona girer ve **otomatik silinebilir**. Başka bir ön ek kullanın —
> `premigrate_...`, `elden_2026...` gibi; bu dosyalara rotasyon hiç dokunmaz.

### Yerine yazarak geri yükleme — elle, backend durdurulmuş halde

> Bu akış **korunuyor** çünkü veritabanı tamamen bozuksa (kopya bile
> alınamıyorsa) çalışan tek yol odur. Rutin durumlarda yukarıdaki **kopyaya geri
> yükleme** tercih edilmeli: geri alınabilir ve canlıya dokunmaz.

Geri yükleme **bilinçli olarak backend'de değildir**: `pg_restore --clean` şemayı
düşürür, backend'in kendi havuzu ayaktayken bunu kendi kendine yapması güvenilir
olmaz. Sektör pratiği de bu yönde — restore bir uygulama düğmesi değil, DBA işidir.

Panel **Yedekler → "Geri yükle"** üç katmanlı bir onay akışı açar (2026-07-30):

1. **Kayıp önizlemesi** — yedeğin kesim anından sonra oluşan kayıtlar model model
   sayılır (`GET /api/admin/backups/:name/restore-impact`), üstüne audit izinden
   toplam değişiklik hacmi (CREATE/UPDATE/DELETE) eklenir.
2. **Yazarak onaylama** — veritabanı adı elle yazılmadan komut kopyalanamaz.
3. **Güvenlik yedeği** — komut bloğu geri yüklemeden ÖNCE mevcut veritabanının
   doğrulanmış bir yedeğini alır.

Kopyalanan blok:

```powershell
# 1) Backend'i durdur - pg_restore --clean acik baglantiyla semayi dusuremez
pm2 stop tekserp-backend
$env:PGPASSWORD = "<veritabani-sifresi>"      # .env icindeki DATABASE_URL'den

# 2) GUVENLIK YEDEGI - yanlis yedege donulurse geri donus noktasi
$safe = "C:\Etkili-Yazilim\backups\pre-restore_20260730_142312.dump"
$LASTEXITCODE = 1
pg_dump -h 127.0.0.1 -p 5432 -U postgres -d tekserp -Fc -f "$safe"
$ok = ($LASTEXITCODE -eq 0) -and (Test-Path "$safe")
if ($ok) { pg_restore --list "$safe" > $null; $ok = ($LASTEXITCODE -eq 0) }

# 3) YALNIZ guvenlik yedegi dogrulandiysa geri yukle
if (-not $ok) { Write-Host "GUVENLIK YEDEGI ALINAMADI - GERI YUKLEME YAPILMADI." -ForegroundColor Red }
if ($ok) { pg_restore -h 127.0.0.1 -p 5432 -U postgres -d tekserp --clean --if-exists "...\tekserp_....dump" }

# 4) Her durumda: sifreyi temizle, backend'i baslat
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
pm2 start tekserp-backend
```

> **⚠ Bloğu "sadeleştirmeyin".** Üç satır load-bearing ve sebepleri sezgiye aykırı:
> **(a)** `$LASTEXITCODE = 1` sıfırlaması — bu değişken yalnız *native* exe'lerce
> yazılır; `pg_dump` PATH'te yoksa PowerShell throw eder ve değişken `pm2 stop`'tan
> kalan `0`'ı korur, guard **sessizce geçer**. **(b)** Guard `if ($ok)` ile *koşullu
> çalıştırma*, `exit`/`throw` ile iptal DEĞİL: yapıştırılmış blokta üst-seviye
> `throw` yalnız o satırı düşürür, sonrakiler koşmaya devam eder. **(c)**
> `Remove-Item` + `pm2 start` koşulsuz ve sonda — güvenlik yedeği başarısızsa DB'ye
> dokunulmaz ama backend duruyordur, mutlaka kalkmalı.
> Regresyon testi: `Electron/src/pages/System/Backups/restoreCommand.test.ts`.

- **Güvenlik yedeği (`pre-restore_*`)** rotasyona **girmez** (otomatik silinmez) ve
  **offsite'a kopyalanmaz** — makine dışı kopya istiyorsanız elle taşıyın. Zamanla
  birikirler; disk baskısında elle temizlenir.
- **Acil durum:** veritabanı zaten bozuksa `pg_dump` da patlar ve blok geri yüklemeyi
  reddeder. Bu bilinçli. Gerçekten mecbursanız kırmızı hatayı gördükten sonra
  `$ok = $true` satırını elle çalıştırıp geri yükleme satırını tekrar koşturun —
  **geri dönüş noktanız olmayacağını** kabul ederek.
- Yedeği + **`.env`**'i birlikte saklayın (eski `secret.json` yerine geçti — geri
  yükleme için DB kimlik bilgileri gerekir). Ayrı disk/sunucuya kopyalamak önerilir.
- **6 ayda bir test-restore tatbikatı yapın.** Doğrulanmamış yedek yedek değildir.

> **Kayıp sayılarının dürüst okunuşu:** önizlemedeki model sayıları yalnız
> **INSERT**'leri yakalar — top statüsü, tartı, kalite, sipariş onayı gibi
> **UPDATE**'ler o listede görünmez ama geri alınır. Bu yüzden ekranda ikinci bir
> panel olarak audit izi (CREATE/UPDATE/DELETE) gösterilir. Audit kapsamı yedeğin
> tarihine ulaşmıyorsa (arşivleyici eski log'ları taşımışsa) panel **"ölçülemedi"**
> yazar — **0 yazmaz**; "değişiklik yok" ile "ölçemedik" karıştırılmamalı.

---

## 6) PostgreSQL yapılandırması (installer'dan taşındı)

> Bu blok eski `manage.ps1`'in `postgresql.conf`'a yazdığı ayarların **tek kalan
> kaydıdır**. Yeni bir sunucu kurulurken elle uygulanmalıdır.
>
> **⚠ `port` satırını OLDUĞU GİBİ KOPYALAMAYIN.** Eski installer PostgreSQL'i
> gömülü kurup **5433**'e alıyordu (makinede zaten bir Postgres varsa çakışmasın
> diye). **Yerel/normal kurulumda port varsayılan 5432'dir.** Çalışan bir kurulumda
> portu değiştirmek DB'yi erişilemez yapar. Kural: `postgresql.conf`'taki port ile
> `.env` → `DATABASE_URL`'deki port **aynı olsun**; hangisi olduğu önemli değil,
> mevcut kurulumunuzun portunu KORUYUN.

```conf
# --- TeksERP ayarlari ---
listen_addresses = '127.0.0.1'      # DB dışa kapalı; yalnız backend erişir
# port = <MEVCUT PORTU DEĞİŞTİRME>  # yerel kurulum: 5432 · eski installer: 5433
timezone = 'Europe/Istanbul'
log_timezone = 'Europe/Istanbul'
statement_timeout = '50s'
idle_in_transaction_session_timeout = '300000'
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_min_duration_statement = 500     # slow query log (>500ms)
```

Bellek/performans tuning (installer RAM'e göre ölçekliyordu):

| Parametre | Değer |
|---|---|
| `shared_buffers` | RAM %25 (min 128MB, tavan 8GB) |
| `effective_cache_size` | RAM %60 (min 512MB) |
| `work_mem` | `16MB` |
| `maintenance_work_mem` | RAM %5 (64–512MB) |

**Neden:** PostgreSQL default'ları (`shared_buffers=128MB`, `work_mem=4MB`) yüz
binlerce satırlık üretim DB'sinde rapor aggregate'lerini diske taşırır; `50s`
`statement_timeout` ile birleşince yıllık raporlar iptal olmaya başlar.

Ek olarak DB-level (conf değil) ayar:

```sql
ALTER DATABASE "tekserp" SET statement_timeout = '50s';
```

- **⚠️ Index-ağır migration tuzağı:** Büyük tabloda `CREATE INDEX`, 50s sınırını
  aşarsa iptal edilir. Yüz binlerce+ satıra index ekleyen migration'ın EN BAŞINA
  `SET statement_timeout = 0;` konmalı ve **vardiya dışı (gece/hafta sonu)**
  deploy edilmeli. Detay: `Teks-Erp/MIGRATION-DEPLOY.md`.

---

## 7) Reboot kalıcılığı (Windows)

`pm2 startup` **Windows'u desteklemez** — `pm2 save` tek başına yeterli değildir,
listeyi geri yükleyecek bir tetikleyici gerekir. Yaygın çözümler: `pm2-installer`
(pm2'yi Windows servisi yapar), Görev Zamanlayıcı'da "sistem açılışında
`pm2 resurrect`" görevi, veya bir servis sarmalayıcı.

> **Bu sunucuda hâlihazırda çalışan bir mekanizma var** (reboot sonrası backend
> kendiliğinden kalkıyor) ama hangisi olduğu kayıtlı değil. **Tespit edip buraya
> yazın:**
>
> ```powershell
> Get-CimInstance Win32_Service | Where-Object { $_.Name -match 'pm2|node|teks' } |
>   Select-Object Name,State,StartMode,PathName
> Get-ScheduledTask | Where-Object { $_.TaskName -match 'pm2|node|teks' } |
>   Select-Object TaskName,State
> ```
>
> Çıktıdaki `PathName` `nssm.exe` gösteriyorsa dikkat: `pm2-installer` pm2'yi NSSM
> ile servis yapar — o durumda NSSM runtime'da hâlâ kullanımdadır.

Deploy sonrası her seferinde `pm2 save` çalıştırın; aksi halde reboot **eski**
süreç listesini geri yükler.

---

## 8) Log konumları

| Ortam | Backend log | DB / slow query log |
|---|---|---|
| Windows (pm2) | `ecosystem.config.js` → `out_file` / `error_file` (`C:\Etkili-Yazilim\logs\`); ayrıca `pm2 logs` | `<pgdata>\log\` |
| Linux (pm2) | `~/.pm2/logs/` veya `out_file`/`error_file`; `pm2 logs` | PostgreSQL `log_directory` |

> **⚠ pm2 log rotasyonu YAPMAZ.** NSSM 10MB'da dosyayı döndürüyordu; pm2'de bu
> özellik **modül** olarak gelir ve kurulmadıkça log dosyası sınırsız büyür.
> `kur.ps1` [8/9] 2026-09-06'dan beri bunu otomatik kurar (idempotent, her
> sürümde tekrarlanır, internet yoksa uyarıp geçer). Elle kurmak gerekirse:
>
> ```bash
> pm2 install pm2-logrotate
> pm2 set pm2-logrotate:max_size 10M
> pm2 set pm2-logrotate:retain 14
> ```

---

## 9) ROLLBACK stratejisi

> **`prisma migrate deploy` GERİ ALINMAZ.** Prisma down-migration üretmez.
> Tek güvenli geri dönüş = **migration öncesi yedeğinden restore**.

**Kod:** `C:\Etkili-Yazilim\kur.ps1 -GeriAl` — en yeni `app.eski-<damga>`'yı `app\`'a
geri koyar (mevcut `app\` → `app.basarisiz-<damga>`), pm2'yi başlatır, `/health`'i bekler.
Taşıma takılırsa (açık kilit) mevcut kurulumu yeniden başlatıp durur. **DB'ye dokunmaz**
ve bunu ekrana yazar: eski kod yeni şemayla koşuyor olur.

**Veri:** `kur.ps1`'in adım 3'te aldığı `backups\premigrate_<damga>.dump` (rotasyon
dışı). Şema değişen bir sürümden dönüyorsan kodu geri aldıktan SONRA restore et — yeni
kod eski şemayla, eski kod yeni şemayla uyumsuz olabilir. Restore yolu §5 ("Kopyaya geri
yükleme" ÖNERİLİR — geri alınabilir).

Birkaç gün sorunsuz çalışınca `app.eski-*` silinebilir; `premigrate_*` dosyaları
rotasyona girmez, elle temizlenir.

---

## 10) Güvenlik duruşu — LAN-only (şu an)

Uygulama şu an **yalnız fabrika içi ağda** çalışır, **dışa kapalıdır**. Bu
nedenle perimeter sertleştirmeleri (CORS kısıtı, HTTPS/TLS terminasyonu,
rate-limit) **bilinçli olarak eklenmedi** — iç ağ güvenli kabul ediliyor.
PostgreSQL yalnız `127.0.0.1` dinler (§6 — dışarıdan doğrudan DB erişimi yok);
sadece backend (4000) fabrika ağına açıktır.

> **DIŞA AÇILIRSA (internet/uzak erişim) ZORUNLU olur:**
> - CORS allow-list daraltma + HTTPS (reverse proxy / TLS) + rate-limit.
> - `User.tokenVersion` ile token iptali (iç erişim kontrolü olarak hâlâ
>   anlamlı ama LAN-only'de acil değil) — uzak erişimde çalınan/sızan token'ı
>   geçersiz kılmak için aktif hale getirilmeli.
> - JWT secret rotasyonu + şifre politikası gözden geçirilmeli.

---

## 11) Deploy provası — doğrulandı (2026-06-13)

Boş bir `teks_deploy_probe` DB'sinde tam ilk-kurulum yolu koşuldu:
`createdb` → `prisma migrate deploy` → `prisma generate` → `dropdb`. Sonuç: o
tarihteki **tüm migration'lar hatasız uygulandı** (51/51; 0 rolled-back/yarım),
Prisma Client v7 (`prisma`/`@prisma/client` ^7.7.0) temiz üretildi. Migration
sayısı sürekli artar — kanonik kaynak `prisma/migrations/` (2026-07-14 itibarıyla
~114, en yeni `20260714151000_dispatch_item_unique_dispatch_roll`); prova her
deploy öncesi tekrarlanmalı (bkz. `URETIM-KONTROL-LISTESI.md §C`). Detay:
`Teks-Erp/MIGRATION-DEPLOY.md`.
