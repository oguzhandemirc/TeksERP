# BULGU-T1-020 — DOĞRULAMA (③ sonrası, TUR 1)

**Başlık:** `kur.ps1` her kurulumda `ecosystem.config.js`'i paketinkiyle ezer → sunucudaki yedek/offsite/zamanlayıcı ayarları sessizce repo değerlerine döner
**Kategori:** J (migration/kurtarma · deploy) · **Modül:** deploy + yedek
**Giriş kanıt seviyesi:** K2 → **ÇIKIŞ: K3** · **Şiddet: S1 (KORUNDU, yükseltilmedi — gerekçe §7)**
**Karar: `dogrulandi`**

---

## 1. Mekanizma — kod okuması (K1 zemini)

| # | Yer | Ne yapıyor |
|---|---|---|
| 1 | `deploy/paketle.ps1:129` | `Copy-Item "$proj\ecosystem.config.js" "$stage\"` → **repo kopyası pakete girer** |
| 2 | `deploy/kur.ps1:164` | `Copy-Item $envKaynak $envYedek` → kenara alınan TEK dosya `.env` |
| 3 | `deploy/kur.ps1:263` | `Move-Item $mevcut $eskiAd` → çalışan kurulum `app.eski-<damga>` olur |
| 4 | `deploy/kur.ps1:266` | `Copy-Item "$temp\*" $appDir -Recurse -Force` → **paketin TAMAMI**, `ecosystem.config.js` dahil |
| 5 | `deploy/kur.ps1:267` | `Copy-Item $envYedek (Join-Path $appDir ".env")` → geri konan TEK dosya `.env` |
| 6 | `deploy/kur.ps1:190` | `& $pm2 delete $uygulama`  — yorum: *"delete: ecosystem env blogu degismis olabilir"* |
| 7 | `deploy/kur.ps1:303` | `& $pm2 start ecosystem.config.js` → **yeni (repo) env bloğu sürece yüklenir** |

Ezilen değerler (`Teks-Erp/ecosystem.config.js`):

| Satır | Anahtar | Repo değeri | Tüketici |
|---|---|---|---|
| 107 | `BACKUP_SCHEDULE_ENABLED` | `"false"` | `src/jobs/backup-scheduler.ts:130` → **erken dönüş**, gece yedeği alınmaz |
| 124 | `BACKUP_OFFSITE_DIR` | `""` | `src/services/backup.service.ts:46` (modül yükünde `const`) → `:324` `if (OFFSITE_DIR)` yanlış → makine dışı kopya YOK |
| 143 | `BACKUP_RCLONE_REMOTE` | `""` | `offsite-backup.helper.ts:162` `readOffsiteRemote()` |

**Kurtarıcı var mı — altı kaynak da bakıldı:**

| Kaynak | Sonuç |
|---|---|
| SystemSetting geri düşüşü (`readOffsiteDir`) | **VAR ama BAĞLANMAMIŞ.** `system-setting.service.ts:3225` `readOffsiteDir()` yalnız `admin.routes.ts:1370,1428`'de okunur; `backup.service.ts` bu fonksiyonu **hiç çağırmaz** (grep 0) → panelden girilen offsite dizini yedek motoruna **ULAŞMAZ**. Ayrı bulgu adayı, bkz. §8. |
| SystemSetting geri düşüşü (`backup-scheduler`) | **YOK.** `backup-scheduler.ts:130` yalnız `process.env` okur. |
| `.env` (kur.ps1'in koruduğu dosya) | **KURTARMAZ.** `server.ts:1` `dotenv/config`; dotenv v17 varsayılanı **mevcut `process.env`'i EZMEZ**. Ölçüldü: `BACKUP_SCHEDULE_ENABLED=false node -e "dotenv.config()"` → `.env`'de `true` olmasına rağmen sonuç `false`. Yani pm2'nin (ezilmiş) ecosystem env'i, korunan `.env`'i **yener**. |
| Makine/kullanıcı düzeyi env | Anahtar ecosystem `env` bloğunda **açıkça** var → pm2 birleştirmesinde app env kazanır (pm2 belgelenmiş davranışı) `[VARSAYIM: pwsh/pm2 bu makinede yok, belgeye dayanıyor]`. |
| `kur.ps1` içinde karşılaştırma/uyarı adımı | **YOK** — repro §1'de mekanik olarak ölçüldü (0 satır). |
| Belge | `docs/ops/DEPLOY-RUNBOOK.md §3` yalnız *".env'i geri koy"* der; `ecosystem.config.js`'in ezildiğini **hiçbir belge söylemez**. |

---

## 2. K2 — veride fiili ihlal

**Sorgu:** `audit/data/BULGU-T1-020.sql` · **Çıktı:** `audit/data/BULGU-T1-020.txt`
(⚠️ `AuditService` payload'ı `newData`'nın **kökünde** durur — bulgu metnindeki `newData->'payload'->>'trigger'` yolu boş döner; sorgu düzeltildi.)

### §2 Ayrışma tablosu — SAHA (prod kopyası `tekserp_saha_0825`)

| trigger | offsite "kapalı" uyarısı | adet | ilk | son |
|---|---|---|---|---|
| `manual` | **VAR** (t) | 7 | 2026-07-31 21:10 | 2026-08-22 01:36 |
| `nightly` | **YOK** (f) | **1** | **2026-08-25 03:05** | 2026-08-25 03:05 |

Örnek kayıt id'leri: `75fd1826-f57d-4620-89a1-3b6d3f176e28` (nightly, uyarısız) · `84bfcba0-08ee-46e2-8abf-19f34ea38b37` (manual, uyarılı).

**İki bağımsız kanıt, aynı ana işaret ediyor:**
1. `trigger='nightly'` → `startBackupScheduler()` erken **dönmemiş** → çalışan process'te `BACKUP_SCHEDULE_ENABLED ≠ "false"` (repo: `"false"`).
2. Offsite uyarısının **kaybolması** → `backup.service.ts:46` `OFFSITE_DIR` **dolu** (repo: `""`).

Destek: `system_settings.backup.lastNightlyAt = "2026-08-25T00:05:07.694Z"` — bu anahtarı yazan **tek** yer `jobs/backup-scheduler.ts:32`. `backup.offsiteDir` / `backup.offsiteRemote` / `backup.hour` satırları **YOK** → DB tarafında hiçbir kurtarıcı kayıt yok, iki değer de yalnız env'de yaşıyordu.

### §5 Birleşik kronoloji (deploy izi = `_prisma_migrations.finished_at`, kur.ps1 [7/9])

```
2026-08-22 01:36  YEDEK manual   offsite_uyarisi=true    ← env repo değerlerinde
2026-08-24 18:21  DEPLOY (24 migration)                  ← kur.ps1 -Paket
   ... bu pencerede operatör sunucuda ecosystem.config.js'i düzenledi ...
2026-08-25 03:05  YEDEK nightly  offsite_uyarisi=false   ← İKİ ANAHTAR DA AYRIŞMIŞ
2026-08-25 13:21  DEPLOY (1 migration)                   ← kur.ps1 -Paket → §3 uyarınca EZER
```

Operatörün yapılandırması ölçülebilir biçimde **10 sa 16 dk** yaşadı ve tam olarak **bir** gece yedeği aldı; ardından bir kurulum koştu. Prod kopyası 2026-08-25 sınırında bittiği için 13:21 sonrasını **göremiyoruz** — ama mekanizma §3'te 10/10 deterministik.

### DEV (`adnansahin_db`) — kontrol grubu
21 `nightly` kayıt (dev'de ecosystem kullanılmaz, bayrak hiç set edilmez) + 1 `manual`. Dev, saha davranışını **taklit etmiyor**: sahadaki tek fark yaratan dosya dev'de hiç okunmuyor → bu sınıf hata dev'de **yapısal olarak görünmez**.

---

## 3. K3 — davranışsal repro (yarış değil: deterministik yeniden oynatma)

**Script:** `Teks-Erp/scripts/audit_repro_BULGU-T1-020.ts` · **Log:** `audit/repro/BULGU-T1-020.log`
**Koşum:** `cd Teks-Erp && npx tsx scripts/audit_repro_BULGU-T1-020.ts` → **11 geçti / 0 düştü**

`pwsh` bu makinede **kurulu değil** (`which pwsh` → not found; `deploy/test/run-harness.sh` `${PWSH:-pwsh}` bekliyor) → `kur.ps1` **birebir çalıştırılamadı**. Bunun yerine [5/9] adımının dosya sözleşmesi (`.env` yedekle → `Move-Item` → `mkdir` → paketi kopyala → yalnız `.env` geri koy) `os.tmpdir()` altında Node ile 1:1 oynatıldı ve sonuç, pm2'nin yaptığı gibi `require(ecosystem.config.js).apps[0].env` okunarak ölçüldü.

| Tekrar | Bozulma | Gözlenen |
|---|---|---|
| **10** | **10 / 10 (%100)** | `BACKUP_SCHEDULE_ENABLED: "true" → "false"` · `BACKUP_OFFSITE_DIR: "E:/tekserp-offsite" → ""` |

Kontrast (koruma mekanizmasının kapsamı dar, yok değil): `.env` damgası **10/10 turda korundu**.

Yan etki: yok — `pg_dump`/`rclone`/yazıcı çağrılmadı, DB'ye yazılmadı (yalnız salt-okunur `systemSetting.findMany`), geçici klasör `finally`de silindi, fixture damgası `AUDITREPRO-BULGU-T1-020-<rnd6>`.

---

## 4. Sessizlik zinciri — neden kimse fark etmez

1. `kur.ps1`'de ezme için **uyarı yok** (repro §1, ölçüldü).
2. Kurulumun kendi [9/9] özeti **YANLIŞ GÜVEN verir**: `kur.ps1:354` `Get-ChildItem $backupDir -Filter "tekserp_*.dump" | Sort LastWriteTime -Desc | Select -First 1` → *"Son gece yedegi: tekserp_20260825_030507.dump (2026-08-25 03:05)"*. Bu dosya, **aynı kurulumun az önce kapattığı** yapılandırmanın ürünüdür.
3. `/health` `lastBackup` alanı (`src/app.ts:432`) da **dosya tarar**, yapılandırmaya bakmaz → en erken 24 saat sonra bayatlar, o da yalnız biri ekranı açarsa.
4. `getOffsiteHealth()` (`offsite-backup.helper.ts:269`) yalnız **rclone** hedefini raporlar; `BACKUP_OFFSITE_DIR` kaybı **hiçbir sağlık yüzeyinde görünmez** — tek izi, ileride backend'in kendi aldığı bir yedeğin mesaj metnindeki *"UYARI: OFFSITE YEDEK AYARLANMADI"* satırıdır. Sahada gece yedeğini (tasarım gereği) harici görev aldığı için o satır da **hiç doğmaz**.
5. `backup-scheduler.ts:131` kapanışı yalnız `console.log` yazar — `SystemLog`'a düşmez, alarm üretmez.

**Kurtarma yolu vardır ama işaretsizdir:** operatörün dosyası `app.eski-<damga>\ecosystem.config.js` içinde durur — ta ki `kur.ps1:363` *"Birkac gun sorunsuz calistiktan sonra silinebilir"* önerisi uygulanana kadar.

---

## 5. Yarıçap — yalnız yedek değil

`Teks-Erp/ecosystem.config.js` env bloğunda **13 aktif anahtar** (`NODE_ENV, APP_ENV, PORT, HOST, BACKUP_SCHEDULE_ENABLED, BACKUP_DIR, BACKUP_RETENTION_DAYS, BACKUP_OFFSITE_DIR, BACKUP_RCLONE_REMOTE, BACKUP_RCLONE_BIN, BACKUP_RCLONE_CONFIG, BACKUP_HOUR, PG_BIN_DIR`) ve **sunucuda açılmak üzere yorum satırında bekleyen 6 anahtar** (`DISCOVERY_MDNS_ENABLED`, `PGDATA_DIR`, `PG_MAINTENANCE_DB`, `PG_RESTORE_JOBS`, `BACKUP_PG_USER`, `BACKUP_PG_PASSWORD`) var. Hepsi aynı kaderi paylaşır.

**En sivri ikinci vaka:** `src/services/helpers/pg-admin-client.ts:125` operatöre birebir şunu söyler — *"(ya da ecosystem.config.js'te `BACKUP_PG_USER=postgres` verin.)"*. Yani **kod, bir sonraki kurulumun sessizce geri alacağı bir düzenlemeyi talimat olarak veriyor**; üstelik aynı yorum bloğu şifreyi `.env`'e (korunan dosya) koymayı söylüyor → kurulumdan sonra **kullanıcı repo değerine döner, şifre kalır** = eşleşmeyen çift. `backup.service.ts:81-86` bu ikilinin "hem yedek hem geri yükleme akışında AYNI çift" olduğunu belgeliyor; ayrıştığında dump ya patlar ya da **eksik** üretilir (aynı dosyadaki uyarı).

---

## 6. Önceki defterle uzlaştırma

`audit/00-map/K12-onceki-denetim-uzlastirma.md:126` — **`F-OPS-VER-003` "HÂLÂ AÇIK"**: *"Kod tamam … Repo'daki sunucu yapılandırması BOŞ … Sunucuda rclone kurulu mu → DOĞRULANAMADI."*
Bu bulgu onu **yeniden açmıyor, açıklıyor**: yapılandırmanın sunucuda "bir türlü kalıcı olmaması"nın mekanik nedeni budur; ve 2026-08-25 ölçümü, defterin doğrulayamadığı şeyi (sunucuda değerin bir ara **DOLU** olduğunu) veriyle gösteriyor. Reddedilmiş hiçbir bulgu yeniden açılmadı.

---

## 7. Şiddet gerekçesi — neden S1, neden S0 DEĞİL

**S1 lehine:** düzeltici tamamen sessiz ve alarmsız (matris: bir kademe yükselt) · deterministik (%100) · her kurulumda tekrarlanır · veri kaybı riskine dokunuyor.
**S0'a çıkarmayan tek şey:** tasarım gereği **bağımsız bir yedek yolu** belgeli — `docs/ops/DEPLOY-RUNBOOK.md:52-53` + `PM2-GECIS-DEVIR-NOTU.md:64` → Windows Görev Zamanlayıcı `TeksERP-DB-Backup` (02:00, `yedekle.ps1`, 30 gün). O görev SAHINSRV'de gerçekten koşuyorsa backend zamanlayıcısının kapanması zararsızdır (iki zamanlayıcı zaten istenmiyor). **Canlı sunucuya erişimimiz yok → görevin varlığı DOĞRULANAMADI.**
⚠️ **Koşullu yükseltme:** `(Get-ScheduledTask -TaskName "TeksERP-DB-Backup" | Get-ScheduledTaskInfo).NextRunTime` boş/eksikse bu bulgu **S0**'dır — o durumda 2026-08-25 13:21 kurulumundan sonra fabrikanın gece yedeği hiç alınmıyor olabilir. Bu tek komut, ②'nin sunucuda ilk sorması gereken şeydir.
`BACKUP_OFFSITE_DIR` kaybı ise **koşulsuz** bir gerilemedir: operatörün açıkça kurduğu makine-dışı kopya kapanır ve hiçbir yüzeyde görünmez (§4.4).

---

## 8. SINIR ÖTESİ NOTLAR (② OPS'a)

1. **[YENİ BULGU ADAYI — panel↔motor ayrışması]** `PATCH /api/admin/backups/offsite` (`admin.routes.ts:1402-1433`) `backup.offsiteDir`'i `SystemSetting`e yazar; `readOffsiteDir()` (`system-setting.service.ts:3225`) doğru öncelikle okur — **ama yedek motoru bu fonksiyonu hiç çağırmaz** (`backup.service.ts:46` modül yükünde `process.env.BACKUP_OFFSITE_DIR`). Sonuç: panelde "Offsite yerel hedef" girilir, `200 OK` döner, panel değeri geri okur ve gösterir; **yedek yine offsite kopyalamaz**. Tam da `readOffsiteText` yorumunun (`:3191`) uyardığı *"panelde değiştirdim, değişmedi"* sınıfı. Kardeş anahtar `backup.offsiteRemote` DOĞRU bağlı (`offsite-backup.helper.ts:162`) — asimetri kod içinde. Saha ve dev'de bu ayarın satırı **yok**, yani bugün kimse denememiş; deneyen ilk kişi sessiz yanlış güvene düşer.
2. `BACKUP_OFFSITE_DIR` hiçbir sağlık yüzeyinde raporlanmıyor (`getOffsiteHealth` yalnız rclone). `/api/admin/health`'e `offsite.localDir` alanı eklemek, §4'teki sessizlik zincirinin en ucuz halkasıdır.
3. `deploy/test/run-harness.sh` bu makinede koşturulamıyor (`pwsh` yok). Deploy script'lerinin bekçisi CI'da da koşmuyorsa, `kur.ps1` regresyonları yalnız sahada görülür.

---

## 9. Öneri (2. tur için — ŞEKİL, uygulanmadı)

- `kur.ps1`e `.env` ile **aynı muameleyi** `ecosystem.config.js`e de uygula: kurulumdan önce kenara al, kurulumdan sonra **karşılaştır**; fark varsa (a) operatör kopyasını koru + farkı ekrana bas, ya da (b) paket kopyasını yaz ama **kaybolan anahtarları tek tek listele ve onay iste**. Sessiz ezme her iki hâlde de bitmeli.
- Uzun vade: operasyonel env'i sürüm kontrollü dosyadan **`.env`'e** (ya da ayrı bir `ops.env`'e) taşı; `ecosystem.config.js` yalnız süreç topolojisini (`fork`, `instances:1`, `kill_timeout`) tutsun. `.env` zaten korunuyor ve zaten sunucuya özel.
- `backup.service.ts` `OFFSITE_DIR`'i `readOffsiteDir()` üzerinden **çağrı anında** okusun (rclone kardeşiyle simetri) → hem §8.1 kapanır hem ayar DB'ye taşınıp deploy'dan sağ çıkar.
- `[PROD'DA ÇALIŞTIRMA değil, SORU]` ②'nin sunucudaki ilk üç ölçümü: `(Get-ScheduledTask -TaskName "TeksERP-DB-Backup" | Get-ScheduledTaskInfo).NextRunTime` · `Get-Content C:\Etkili-Yazilim\app\ecosystem.config.js | Select-String BACKUP_` · `Get-ChildItem C:\Etkili-Yazilim\backups\tekserp_*.dump | Select -Last 3`.
- **Kabul kriteri:** operatörün sunucuda değiştirdiği bir env anahtarı, bir `kur.ps1 -Paket` koşumundan sonra ya **korunur** ya da **ekrana yazılıp onaylanır**; `audit_repro_BULGU-T1-020.ts` §2 bozulma sayısı 10/10 → 0/10.
- **Efor:** 0,5 gün (kur.ps1 karşılaştırma adımı) + 0,5 gün (§8.1 offsiteDir bağlama + bekçi).

---

## 10. KAPSANMAYAN / ERİŞİLEMEYEN

| Konu | Sebep |
|---|---|
| Canlı SAHINSRV `app\ecosystem.config.js` içeriği | Prod'a erişim YOK; prod kopyası yalnız DB'yi taşır, dosya sistemini değil |
| `TeksERP-DB-Backup` görevinin varlığı/NextRunTime'ı | Aynı — §7'deki koşullu yükseltme bu yüzden açık bırakıldı |
| 2026-08-25 13:21 kurulumundan **sonraki** yedek davranışı | Prod kopyası 2026-08-25'te bitiyor (`tekserp_saha_0825`) |
| `kur.ps1`in PowerShell ile birebir koşumu | `pwsh` makinede kurulu değil → [5/9] adımı Node ile 1:1 taklit edildi (§3) |
| pm2'nin ecosystem-env ↔ makine-env birleştirme önceliği | Ölçülemedi (pm2 yok) → `[VARSAYIM]`, belgeye dayanıyor. Sonucu değiştirmez: `.env` yolu ölçümle elendi |
