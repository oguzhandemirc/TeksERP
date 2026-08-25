# Yedekleme & Geri Yükleme — Sunucu Deploy ve Denetim Notu

> ⚠️ **TARİHSEL — deploy yolu 2026-08-24'te değişti.** Aşağıdaki `git pull → build →
> migrate` akışı fabrikada **artık uygulanmıyor**: çalışan kurulum `C:\Etkili-Yazilim\app\`
> altındaki hazır pakettir ve `kur.ps1` ile kurulur (yedek + migrate + pm2 sırasını script
> yapar). Güncel akış **`docs/ops/DEPLOY-RUNBOOK.md §3`** + `deploy/README.md`. Bu dosyanın
> geri kalanı (gerekçeler, sıra teyidi, kontrol maddeleri) bilgi olarak duruyor.

**Son güncelleme:** 2026-07-31 · **Hedef sunucu:** SAHINSRV (192.168.1.250)
**Durum:** kod tarafı bitti ve geliştirme makinesinde test edildi; **sunucuda henüz deploy edilmedi**

---

## 0) Bu dosya kime

Fabrika sunucusunda `git pull` yapıp **Claude Code CLI ile deploy edecek** oturum için.
Sırasıyla: §1 (neyin değiştiği) → §2 (sunucunun gerçek durumu) → §3 (deploy öncesi
ZORUNLU env) → §4 (deploy adımları) → §5 (deploy sonrası doğrulama) → §6 (açık işler).

> **⚠ ÖNCE BUNU OKU — 2026-07-30 tarihli önceki sürümdeki teşhis YANLIŞTI.**
> O sürüm "pm2'ye geçişte gece yedeği zinciri koptu, fabrika yedeksiz olabilir"
> diyordu. **Bu sunucu için doğru değil.** Yedekleme 2026-07-16'da installer'dan
> bağımsız olarak sıfırdan kurulmuş ve **çalışıyor** (§2). Eski teşhise dayanıp
> `TeksERP-DB-Backup` görevini bozmayın.

---

## 1) Ne değişti (kodda)

Kaynak kurulumda yedekleme mantığı silinen Inno Setup/NSSM installer'ının
`manage.ps1`'ine bağlıydı; o installer repodan kaldırıldı ve mantık backend'e
taşındı. **Bu sunucuda o zincir zaten kullanılmıyordu** — dolayısıyla buradaki
etki "kayıp bir özelliğin geri gelmesi" değil, **yeni özelliklerin eklenmesi**:

| Yeni | Ne işe yarıyor |
|---|---|
| Yedek bütünlük doğrulaması | Her dump sonrası `pg_restore --list`; bozuksa dosya silinir, rotasyona inmez |
| Kayıp önizlemesi | "Bu yedeğe dönersem ne kaybederim" — model model sayım + audit izinden UPDATE hacmi |
| Yazarak onaylama | Geri yükleme komutu, DB adı elle yazılmadan kopyalanamaz |
| Güvenlik yedeği | Geri yükleme bloğu, `pg_restore --clean`'den ÖNCE doğrulanmış bir yedek alır |
| **Kopyaya geri yükleme** | Yedeği CANLI DB'ye değil yeni bir DB'ye yükler, doğrular, sonra takas → **geri alınabilir** |
| Yedek saati paneli | `SystemSetting backup.hour` — restart gerekmez |
| `/health` | `restoreCopyCount` / `restoreCopyBytes` eklendi (unutulmuş kopyalar görünür) |

**Panelde artık geri yükleme AKIŞI var** (komut üretimi + kopya-restore). Eski
notunuzdaki *"GERİ YÜKLEME panelde YOKTUR (güvenlik)"* satırı bu sürümle
güncelliğini yitirdi — ama geri yüklemeyi hâlâ **backend çalıştırmıyor**; panel
yalnız doğrular, onaylatır ve komutu hazırlar.

---

## 2) Sunucunun gerçek durumu (2026-07-16 kurulum notlarından)

| Ne | Değer |
|---|---|
| PostgreSQL | **16.9**, native Windows servisi `postgresql-tekserp`, port **5432** |
| PG programları / veri | `C:\Etkili-Yazilim\pgsql\bin` · `C:\Etkili-Yazilim\pgdata` |
| initdb | UTF8, **C locale**, scram |
| Veritabanı / kullanıcı | **`tekserp`** / `tekserp` (superuser: `postgres`) |
| Backend projesi | `C:\Etkili-Yazilim\tekserp\Teks-Erp` (repo kökü `...\tekserp`) |
| pm2 uygulama adı | **`tekserp-backend`** |
| pm2 daemon | **SYSTEM** hesabıyla koşar → **pm2 komutları YÖNETİCİ shell ister** (yoksa `EPERM \\.\pipe\rpc.sock`) |
| Boot kalıcılığı | Görev Zamanlayıcı **`TeksERP-Backend-Boot`** → `C:\Etkili-Yazilim\pm2-boot.cmd` → `pm2 resurrect` (SYSTEM, **sistem açılışında**) |
| Gece yedeği | Görev **`TeksERP-DB-Backup`**, her gece **02:00**, SYSTEM → `C:\Etkili-Yazilim\yedekle.ps1` |
| Yedek klasörü / saklama | `C:\Etkili-Yazilim\backups` · **30 gün** · log `backup.log` |
| Güncelleme script'i | `C:\Etkili-Yazilim\guncelle.ps1` |
| Firewall | "TeksERP Backend 4000" |

**Boot mekanizması oturum açılışına değil sistem açılışına bağlı** — kimse giriş
yapmasa da backend kalkar. NSSM işin içinde yok.

---

## 3) Deploy ÖNCESİ zorunlu env değişiklikleri

`C:\Etkili-Yazilim\tekserp\Teks-Erp\ecosystem.config.js` (ya da `.env`) içine:

```js
BACKUP_SCHEDULE_ENABLED: "false",   // ← EN KRİTİK, aşağıdaki gerekçe
BACKUP_RETENTION_DAYS: "30",        // sizin yedekle.ps1 politikanızla aynı
PG_BIN_DIR: "C:/Etkili-Yazilim/pgsql/bin",
PGDATA_DIR: "C:/Etkili-Yazilim/pgdata",
BACKUP_PG_USER: "postgres",         // kopya oluşturma CREATEDB ister
BACKUP_PG_PASSWORD: "<postgres sifresi>",   // ⚠ sır → .env'e koyun, ecosystem git'te
```

Ardından **`pm2 restart tekserp-backend --update-env`** (yönetici shell).

> **`BACKUP_SCHEDULE_ENABLED=false` NEDEN ZORUNLU:** backend artık kendi gece
> yedeğini alabiliyor. Açık bırakılırsa `TeksERP-DB-Backup` **ve** backend her
> gece ayrı ayrı yedek alır (çift dump, çift disk, çift I/O). Sizin görevinizi
> birincil tutma kararı bilinçli: **backend çökmüşken bile yedek alınır** —
> backend'e bağlı bir zamanlayıcının sağlayamayacağı garanti.

> **Saklama çakışması (kodda çözüldü, yine de bilin):** rotasyon eskiden "en yeni
> 14 dosya"ydı ve aynı klasöre/aynı `tekserp_*` desenine yazdığı için sizin 30
> günlük geçmişinizi 14 dosyaya indirip ~16 günü **sessizce silerdi**. Artık gün
> bazlı (`BACKUP_RETENTION_DAYS`, varsayılan 30) ve "en yeni 3 dosya yaşına
> bakılmaksızın korunur" tabanı var (saat kayması sigortası).

**Elle yedek davranışı değişti:** panelin "Şimdi yedek al" düğmesi artık
`schtasks /run` ile sizin görevinizi tetiklemiyor; backend kendi `pg_dump`'ını
koşuyor (bütünlük doğrulaması + offsite desteğiyle). `BACKUP_TASK_NAME` env'i
artık **kullanılmıyor**, zararsız şekilde durabilir.

---

## 4) Deploy adımları

```powershell
# YÖNETİCİ PowerShell
cd C:\Etkili-Yazilim\tekserp
git pull
cd Teks-Erp
npm ci
npx prisma generate
npm run build            # ← DB'ye DOKUNMAZ; patlarsa temiz abort
npx prisma migrate deploy
pm2 restart tekserp-backend --update-env
pm2 save
```

> **⚠ `guncelle.ps1` bu sırada DEĞİL.** Mevcut script `migrate deploy → build`
> yapıyor. Doğrusu **`build → migrate`**: `build` (tsc) DB'ye dokunmaz ve tip
> hatasıyla patlaması normaldir — o sırada DB'ye hiç dokunulmamış olur, temiz
> abort edersiniz. Ters sırada tsc patlarsa **DB göç etmiş ama deploy edilebilir
> kod yok**; ileri gitmek için sahada tsc düzeltmek, geri gitmek için yedekten
> dönmek gerekir. Script'i düzeltmek ayrı bir iş (§6).

**Bu sürümde migration YOK** — şema değişmiyor, `migrate deploy` "no pending"
demeli. Geri dönüş kolay.

> **⚠ API kırılması — backend ve Electron BİRLİKTE gitmeli.**
> `GET /api/admin/backups` yanıtından `manageScriptPath` **çıktı**; yerine
> `restoreTarget` / `pm2AppName` / `running` / `lastResult` / `kind` girdi.
> Eski bir Electron paneli yeni backend'le geri yükleme komutunu yanlış kurar.
> (2026-07-16 notunda Electron kurulumu "henüz yapılmadı" görünüyor — fabrikada
> panel kurulu değilse bu risk yok; **kurulu mu, önce teyit edin**.)

---

## 5) Deploy sonrası doğrulama

```powershell
# 1) Servis ayakta ve DB bağlı
curl http://localhost:4000/health          # status UP, db UP

# 2) Scheduler KAPALI olmalı (çift yedek olmasın)
pm2 logs tekserp-backend --lines 50 | Select-String "backup"
#    beklenen: "[backup] scheduler KAPALI (BACKUP_SCHEDULE_ENABLED=false)"
#    GÖRÜLMEMESİ gereken: "[backup] scheduler aktif"

# 3) Sizin göreviniz bozulmadı
(Get-ScheduledTask -TaskName "TeksERP-DB-Backup" | Get-ScheduledTaskInfo).NextRunTime
dir C:\Etkili-Yazilim\backups\*.dump | Select-Object -Last 3

# 4) Yeni yetenekler görünüyor mu
curl http://localhost:4000/health          # restoreCopyCount / restoreCopyBytes alanları
```

**Panelden (Electron kuruluysa):** Sistem → Yedekler listelenmeli, `lastBackup`
dolu olmalı. Sistem → **Veritabanı Geri Yükleme** açılıp "yetkiler" kutusunda
`CREATEDB` yeşil görünmeli; değilse `ALTER ROLE "postgres" CREATEDB;` talimatı
çıkar (postgres zaten superuser olduğu için sorun beklenmiyor).

**İlk kopya denemesi — mesai dışında:** bir yedek seçip "Kopya oluştur".
Bu, **PG 16'ya özgü kod dalının ilk gerçek koşumudur** (`pg_database.datlocale`
PG17+'da var, 16'da `daticulocale` — sürüm dalı yazıldı ama gerçek PG16'da hiç
çalışmadı). Hata verirse doğrulama raporundaki mesajı buraya not edin.

---

## 6) Açık işler (öncelik sırasıyla)

1. **Offsite yedek** — yedekler DB ile aynı diskte; disk arızası/ransomware
   ikisini birden götürür. `BACKUP_OFFSITE_DIR` ile ikinci bir diske/paylaşıma
   otomatik kopya alınır. **Not:** pm2 SYSTEM olarak koştuğu için UNC
   paylaşımına erişemeyebilir (SYSTEM'in ağ kimliği yoktur) — ikinci bir yerel
   disk daha güvenli.
2. **Gerçek reboot testi** — boot görevi elle tetiklenip doğrulanmış ama makine
   hiç yeniden başlatılmamış. Boot'ta pm2, `postgresql-tekserp` servisinden önce
   kalkabilir; backend bunu tolere eder (Prisma havuzu tembel bağlanır, `/health`
   bir süre `db: DOWN` der ve kendini onarır) ama sahada doğrulanmadı.
3. **`guncelle.ps1` sırasını düzelt** — `build` → `migrate deploy` (§4 gerekçe).
4. **Y-2 / C locale** — initdb `--locale=C` yapıldığı için `ILIKE` Türkçe
   katlamıyor: `'ŞİŞLİ' ILIKE '%şişli%'` **false**. Müşteri/ürün/renk aramaları
   sessizce eksik sonuç veriyor olabilir. Kod tarafı düzeltmesi ayrı bir iş;
   ayrıntı `Teks-Erp/DB-MIMARI-DENETIM.md` (Y-2).
5. **PITR / WAL arşivi yok** — kurtarma noktası en iyi ihtimalle son gece yedeği.
6. **PostgreSQL 16 → 18 yükseltmesi ŞU AN GEREKMİYOR** — 16 destekli, kod 16'da
   çalışacak şekilde yazıldı. Yapılırsa ayrı bir proje olarak planlanmalı.

---

## 7) Denetim sonucu — sunucudaki oturum doldursun

**Deploy tarihi:** _(doldur)_

| Kontrol | Beklenen | Gerçek |
|---|---|---|
| `/health` status/db | UP / UP | |
| `[backup] scheduler KAPALI` log satırı | var | |
| `TeksERP-DB-Backup` NextRunTime | dolu | |
| En yeni dump tarihi | son 24 saat | |
| `restoreCopyCount` | 0 | |
| Electron paneli kurulu mu | ? | |
| İlk kopya denemesi (PG16 dalı) | başarılı | |
| `guncelle.ps1` sırası düzeltildi mi | ? | |

**Karşılaşılan sorunlar:** _(doldur)_
