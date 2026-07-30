# NSSM → pm2 Geçişi — Devir ve Sunucu Denetim Notu

**Tarih:** 2026-07-30 · **Yapan:** Claude (geliştirme makinesi) · **Durum:** kod tarafı bitti, **sunucu tarafı doğrulanmadı**

---

## 0) Bu dosya kime, ne için

Bu not **fabrika sunucusundaki (ya da başka bir makinedeki) Claude oturumu için**
yazıldı. Amaç: `git pull` ile bu değişiklikleri çektikten sonra **repodaki
beklenen durum ile makinedeki gerçek durumu karşılaştırmak** ve farkları kapatmak.

Geliştirme makinesinde yapılanlar kod ve dokümana yazıldı. **Sunucuda hiçbir şey
çalıştırılmadı** — aşağıdaki §4 denetimi henüz kimse koşmadı. Sunucudaki Claude'un
işi: denetimi koşmak, farkları raporlamak, gerekli düzeltmeleri yapmak ve §8'i
doldurmak.

> **ÖNEMLİ — bu değişiklikler push edilmiş olmalı.** Geliştirme makinesinde
> commit **atılmadı**; `git pull` ile bu notu görüyorsan commit+push yapılmış
> demektir. Göremiyorsan geliştirme makinesinde henüz commit edilmemiştir.

---

## 1) Ne değişti — tek paragraf

Backend eskiden Inno Setup + gömülü Node/PostgreSQL/**NSSM** installer'ıyla
kurulup NSSM ile Windows servisi olarak koşuyordu. Kullanıcı bunu bıraktı ve
**pm2** ile ayağa kaldırmaya geçti. Ancak installer yalnız süreci başlatmıyordu:
**gece yedeği** de ona bağlıydı (`manage.ps1 -Action backup` + "TeksERP Gece
Yedek" Görev Zamanlayıcı görevi + panelden `schtasks /run` tetiklemesi). pm2'ye
geçişle bu zincir **koptu**. Bu yüzden yedekleme mantığı **backend'e taşındı**,
installer silindi, ve NSSM'e atıfta bulunan tüm kod/doküman güncellendi.

### Neden bu bir "sessiz bozulma" riski taşıyor

Eski akışta `BACKUP_DIR` ortam değişkeni **NSSM servis kaydından** geliyordu.
pm2'ye geçerken bu env taşınmadıysa:

- `backup.service.ts` eski hâlinde `catch` ile **boş liste** dönüyordu → panelde
  "Henüz yedek yok" görünürdü, hata görünmezdi
- `/health` → `lastBackup` **null** dönerdi
- Gece yedeği görevi de `manage.ps1` gittiği için çalışmazdı

Yani **fabrika bir süredir yedeksiz kalmış olabilir.** §4'ün ilk maddesi bunu
ölçer ve denetimin en yüksek öncelikli parçasıdır.

---

## 2) Yeni yedekleme tasarımı (davranış sözleşmesi)

`Teks-Erp/src/services/backup.service.ts` + `Teks-Erp/src/jobs/backup-scheduler.ts`

| Konu | Davranış |
|---|---|
| Çalıştırma | `pg_dump -Fc` **ayrı child process**'te; backend yalnız `close` event'ini bekler → event loop bloklanmaz |
| Bütünlük | Her dump sonrası `pg_restore --list`; **başarısızsa dosya SİLİNİR** ve rotasyona inmez (sağlam yedekleri evict etmesin) |
| Rotasyon | En yeni **14** `tekserp_*.dump` tutulur; `premigrate_*` **hariç** (silinmez) |
| Offsite | `BACKUP_OFFSITE_DIR` doluysa kopyalanır; boşsa **açık uyarı** üretilir |
| Zamanlama | Her gün, saat **panelden ayarlanır** (Sistem → Yedekler → "Otomatik yedek saati" → `SystemSetting backup.hour`; öncelik DB → `BACKUP_HOUR` env → 3). Zamanlayıcı her turda okur → **restart gerekmez**. Sunucu o saatte kapalıysa **açılışta telafi eder** |
| Son çalışma | `SystemSetting` → `backup.lastNightlyAt` (damga işin **başında** yazılır → başarısızlıkta 15dk'da bir retry spam'i olmaz) |
| Eşzamanlılık | In-process `running` bayrağı (schtasks serileştirmesi gitti, backend engellemek zorunda) |
| Bağlantı | `DATABASE_URL`'den çözülür (host/port/user/şifre/db). Eski `secret.json` **yok** |
| Şifre | Child'a yalnız `PGPASSWORD` env'i ile geçer — komut satırına yazılmaz, log'a düşmez |
| İz | `SystemLog` → `BACKUP_COMPLETED` / `BACKUP_FAILED` (best-effort) |
| Geri yükleme | **Backend'de DEĞİL** — bilinçli. Panel üç katmanlı onaydan (kayıp önizlemesi → yazarak onaylama → doğrulanmış güvenlik yedeği) sonra komut bloğunu kopyalatır (şifre yer tutucu) |
| Geri yükleme güvenliği | `GET /backups/:name/restore-impact` kayıp sayımı + audit rollup · `TypeToConfirm` DB adı · blok `if ($ok)` guard'ıyla güvenlik yedeği doğrulanmadan `pg_restore` ÇALIŞTIRMAZ |

**Geri yükleme neden backend'de değil:** `pg_restore --clean` şemayı düşürür;
backend'in kendi bağlantı havuzu ayaktayken kendini durdurup bunu yapması
güvenilir değil.

---

## 3) Dosya manifestosu

### Eklendi

| Dosya | Amaç |
|---|---|
| `Teks-Erp/src/jobs/backup-scheduler.ts` | Gece yedeği zamanlayıcı (`archive-scheduler` kalıbı); saati `SystemSetting backup.hour`'dan her turda okur |
| `Teks-Erp/scripts/test_backup.ts` | Entegrasyon testi — gerçek `pg_dump` ile 31 doğrulama (`npm test backup`) |
| `Electron/src/pages/System/Backups/BackupScheduleCard.tsx` | "Otomatik yedek saati" seçici (Yedekler ekranı) |
| `Teks-Erp/ecosystem.config.js` | pm2 üretim başlatıcısı (fork modu, env, log yolları) |
| `Teks-Erp/deploy/prisma.config.prod.js` | `installer/windows/`'dan **taşındı** — ts-node'suz sunucuda `migrate deploy` için |
| `docs/ops/PM2-GECIS-DEVIR-NOTU.md` | bu dosya |

### Silindi — `Teks-Erp/installer/windows/` (tamamı, 11 dosya)

`build.ps1` · `setup.iss` · `scripts/manage.ps1` · `README-KURULUM.md` ·
`REHBER.md` · `tray/tray.ps1` · `tray/tray-launch.vbs` · `branding/*` ·
`tsconfig.bundle.json` · `.gitignore`

> Silmeden önce kurtarılan iki şey: **(a)** `prisma.config.prod.js` (yukarıda),
> **(b)** `postgresql.conf` ayarları → `docs/ops/DEPLOY-RUNBOOK.md §6`. Bu conf
> değerlerinin **tek kalan kaydı** artık o bölümdür.

### Değişti — kod

| Dosya | Değişiklik |
|---|---|
| `Teks-Erp/src/services/backup.service.ts` | **Yeniden yazıldı** (§2) |
| `Teks-Erp/src/server.ts` | `startBackupScheduler()` çağrısı · **`process.on("message")` → pm2 graceful shutdown** · tek-process invariant yorumuna backup-scheduler eklendi · NSSM→pm2 yorumları |
| `Teks-Erp/src/app.ts` | NSSM→pm2 yorumları · `BACKUP_DIR` yorumuna sessiz-boşluk uyarısı |
| `Teks-Erp/src/routes/admin.routes.ts` | `triggerManualBackup()` artık **senkron** (`await` kaldırıldı) · Swagger açıklaması güncellendi |
| `Teks-Erp/src/services/helpers/raster/raster-font.ts` | yorum: NSSM AppDirectory → pm2 `cwd` |
| `Electron/src/pages/System/Backups/service.ts` | `manageScriptPath` **kaldırıldı** → `restoreTarget` + `pm2AppName` + `running` + `lastResult`; `restoreCommand()` artık `pg_restore` bloğu üretir |
| `Electron/src/pages/System/Backups/BackupsPage.tsx` | `secret.json`/tepsi menüsü metni kaldırıldı · "Yedekleme kapalı" kırmızı kutusu · "son yedek denemesi" sonucu · "yedek alınıyor" göstergesi |
| `Electron/src/pages/System/ServerStatus/BackupButton.tsx` | açıklama metinleri yeni davranışa göre |

> **API kırılması:** `GET /api/admin/backups` yanıtından `manageScriptPath` **çıktı**,
> yerine `restoreTarget`/`pm2AppName`/`running`/`lastResult` **girdi**. Backend ve
> Electron birlikte deploy edilmeli — eski Electron yeni backend'le geri-yükleme
> komutunu yanlış kurar.

### Değişti — doküman

`docs/ops/DEPLOY-RUNBOOK.md` (**baştan yazıldı**) · `docs/ops/KURULUM.md` (§A
tamamen) · `docs/ops/URETIM-KONTROL-LISTESI.md` · `Teks-Erp/MIGRATION-DEPLOY.md` ·
`Teks-Erp/CLAUDE.md` · `Teks-Erp/ARCHITECTURE.md` (§10.3) ·
`Teks-Erp/DB-MIMARI-DENETIM.md` · `docs/history/SAHA-DAYANIKLILIK-FAZ3.md`

**Denetim belgesinde durum değişiklikleri:**
- **O-15** (bellek tuning yok) → **ÇÖZÜLDÜ**, değerler runbook §6'da, artık elle uygulanır
- **O-17** (yedek bütünlüğü doğrulanmıyor) → **ÇÖZÜLDÜ** kod tarafı; *test-restore tatbikatı hâlâ açık*
- **Y-4** (offsite kopya yok) → offsite **ÇÖZÜLDÜ**; *PITR/WAL arşivi hâlâ yok*
- **O-16** (dev PG 18.4 ↔ üretim 16.6) → **BULGU GEÇERSİZ.** Silinen `build.ps1:35`
  gerçekte `18.4-1` idi; tespit bayatmış. Yerine yeni risk yazıldı: PG artık elle
  kurulduğu için parite otomatik garanti değil.

---

## 4) SUNUCU DENETİMİ — koşulacak komutlar

> Hepsi **okuma**dır, hiçbir şeyi değiştirmez. Çıktıları §8 tablosuna yaz.

### 4.1 EN ÖNCELİKLİ — yedek gerçekten alınıyor mu?

```powershell
# En yeni yedek dosyası ne zamandan? (boş çıkarsa YEDEK YOK)
Get-ChildItem C:\ProgramData\TeksERP\backups\tekserp_*.dump -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,LastWriteTime,Length

# Eski Görev Zamanlayıcı görevi hâlâ duruyor mu, son ne zaman koştu, sonucu ne?
Get-ScheduledTaskInfo "TeksERP Gece Yedek" -ErrorAction SilentlyContinue |
  Select-Object TaskName,LastRunTime,LastTaskResult,NextRunTime

# Backend'in gördüğü yedek durumu
curl -s http://localhost:4000/health
```

**Yorum:** En yeni dump'ın tarihi pm2'ye geçiş tarihinden **eskiyse**, geçişten
beri yedek alınmamış. `LastTaskResult` 0 değilse görev hata veriyor.

### 4.2 pm2 ortamı — env taşındı mı?

```powershell
pm2 list
pm2 env 0 | Select-String 'BACKUP_DIR|BACKUP_OFFSITE_DIR|BACKUP_HOUR|PG_BIN_DIR|DATABASE_URL|PORT|NODE_ENV'
pm2 describe 0 | Select-String 'exec mode|instances|script path|exec cwd|name'
```

**Beklenen:** `exec mode: fork`, `instances: 1`, `name: teks-erp-backend`,
`BACKUP_DIR` **dolu**. `exec mode: cluster` görürsen **DUR** — tek-process
invariant'ı ihlal (§6).

### 4.3 Reboot kalıcılığı — hangi mekanizma?

Kullanıcı "reboot sonrası çalışıyor ama ne yaptığımızı hatırlamıyorum" dedi.
Tespit et:

```powershell
Get-CimInstance Win32_Service | Where-Object { $_.Name -match 'pm2|node|teks' } |
  Select-Object Name,State,StartMode,PathName
Get-ScheduledTask | Where-Object { $_.TaskName -match 'pm2|node|teks|resurrect' } |
  Select-Object TaskName,State
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue
Test-Path "$env:USERPROFILE\.pm2\dump.pm2"
```

**Dikkat:** `PathName` içinde `nssm.exe` görürsen — `pm2-installer` pm2'yi NSSM
ile servis yapar. O durumda **NSSM runtime'da hâlâ kullanımdadır**; "NSSM tamamen
kaldırıldı" ifadesi yalnızca *bizim installer'ımız* için doğrudur. Bunu §8'e yaz.

### 4.4 PostgreSQL — sürüm, port, locale, conf

```powershell
psql -c "select version()"
psql -c "show port"
psql -c "select datname, datcollate, datctype from pg_database where datname='TeksErpDb'"
psql -c "select name,setting from pg_settings where name in
  ('statement_timeout','shared_buffers','work_mem','effective_cache_size',
   'maintenance_work_mem','log_min_duration_statement','listen_addresses','archive_mode')"
```

**Beklenen (runbook §6):** `statement_timeout=50s` · `log_min_duration_statement=500`
· `listen_addresses=127.0.0.1` · `work_mem=16MB` · `shared_buffers` ≈ RAM %25 ·
`effective_cache_size` ≈ RAM %60. Major sürüm dev ile aynı (**18.x**).

### 4.5 `pg_dump` erişilebilir mi + hangi kullanıcıyla koşacak

```powershell
& "$($env:PG_BIN_DIR)\pg_dump.exe" --version    # ya da ecosystem.config.js'deki yol
```

**Beklenen:** çalışıyor **ve** sürümü sunucudaki PostgreSQL'den eski değil.
Bulunamazsa yedek alınamaz.

Ayrıca **DB sahipliği** kontrol edilmeli — `pg_dump` varsayılan olarak
`DATABASE_URL`'deki uygulama kullanıcısıyla koşar; o kullanıcı sahibi/superuser
değilse dump patlar **ya da sessizce eksik** çıkar:

```sql
SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'TeksErpDb';
```

`owner` ≠ `DATABASE_URL` kullanıcısı ise `BACKUP_PG_USER=postgres` +
`BACKUP_PG_PASSWORD=...` gerekir (şifre `.env`'e, `ecosystem.config.js`'e DEĞİL).

### 4.8 pm2 gerçekten doğru dosyayı mı çalıştırıyor + destekleyici ayarlar

```powershell
Test-Path Teks-Erp\dist\server.js         # True olmalı (dist\src\server.js DEĞİL)
Test-Path C:\ProgramData\TeksERP\logs     # True olmalı (pm2 dizini oluşturmaz)
Get-NetFirewallRule | Where-Object DisplayName -match 'TeksERP|4000' |
  Select-Object DisplayName,Enabled,Direction,Action
psql -c "show port"                        # .env DATABASE_URL portuyla AYNI olmalı
```

**Not:** Tabletler/Electron PC'ler şu an bağlanabiliyorsa firewall kuralı zaten
vardır (installer açıyordu). Yoksa `New-NetFirewallRule ... -LocalPort 4000` ile
açılır — runbook §2.2'de komut hazır.

### 4.6 pm2 log rotasyonu

```powershell
pm2 list | Select-String logrotate
Get-ChildItem C:\ProgramData\TeksERP\logs\*.log | Select-Object Name,Length
```

**Beklenen:** `pm2-logrotate` kurulu. Değilse log dosyaları sınırsız büyür
(NSSM 10MB'da döndürüyordu).

### 4.7 Makinedeki kod sürümü bu değişiklikleri içeriyor mu?

```powershell
Test-Path Teks-Erp\ecosystem.config.js        # True olmalı
Test-Path Teks-Erp\src\jobs\backup-scheduler.ts # True olmalı
Test-Path Teks-Erp\installer\windows            # FALSE olmalı
git log --oneline -5
```

`installer\windows` hâlâ varsa veya `ecosystem.config.js` yoksa **pull tam
gelmemiş** — geçiş öncesi koda bakıyorsun, §5'i uygulama.

---

## 5) Bulunabilecek farklar ve ne yapmalı

| Bulgu | Yapılacak |
|---|---|
| **Geçişten beri yedek yok** | Hemen elle yedek al (panel "Şimdi yedek al" veya `POST /api/admin/backup`). Sonra `BACKUP_DIR`'i düzelt ve tekrar dene. **Bu ilk iş.** |
| Eski "TeksERP Gece Yedek" görevi **hâlâ kayıtlı** | **Kaldır** — artık silinmiş `manage.ps1`'i çağırıyor, her gece sessizce hata veriyor: `Unregister-ScheduledTask -TaskName "TeksERP Gece Yedek" -Confirm:$false` |
| `BACKUP_DIR` pm2 env'inde yok | `ecosystem.config.js`'e yaz → `pm2 restart teks-erp-backend --update-env` → `pm2 save`. Açılış log'unda `[backup] BACKUP_DIR tanımsız` satırının **kalmadığını** teyit et |
| `BACKUP_OFFSITE_DIR` boş | Kullanıcıya sor: NAS/UNC/harici disk yolu var mı? Boş kalırsa tüm yedekler DB ile aynı diskte (tek arıza = veri + yedek birlikte gider) |
| `PG_BIN_DIR` yanlış/bulunamıyor | Gerçek yolu bul (`Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory`) ve düzelt |
| DB sahibi ≠ `DATABASE_URL` kullanıcısı | `.env`'e `BACKUP_PG_USER=postgres` + `BACKUP_PG_PASSWORD=...` ekle → `pm2 restart --update-env`. Sonra **elle bir yedek al ve boyutunu kontrol et** (sessiz eksik dump riski) |
| `dist\server.js` yok ama `dist\src\server.js` var | Eski/yanlış build. `npm run build` tekrar koş; `ecosystem.config.js` `dist/server.js` bekler |
| `C:\ProgramData\TeksERP\logs` yok | `mkdir` — pm2 dizini oluşturmaz, log sessizce yazılmaz |
| 4000 için firewall kuralı yok | Tabletler bağlanıyorsa vardır. Yoksa runbook §2.2'deki `New-NetFirewallRule` |
| `postgresql.conf` portu ≠ `DATABASE_URL` portu | **Portu DEĞİŞTİRME** — çalışan kurulumun portunu koru, tutarsız olanı `.env` tarafında düzelt. Runbook §6 uyarısı |
| `exec mode: cluster` veya `instances > 1` | **Kritik.** `fork`/`1`'e çevir. Sebep §6 |
| pm2 app adı `teks-erp-backend` değil | İki seçenek: pm2 tarafını yeniden adlandır, **veya** dokunma — backend `process.env.name`'i okuyup panele doğru adı bildirir. Sadece §8'e yaz |
| `pm2-logrotate` yok | `pm2 install pm2-logrotate` + `pm2 set pm2-logrotate:max_size 10M` + `pm2 set pm2-logrotate:retain 14` |
| PG conf değerleri eksik | Runbook §6'daki bloğu uygula, PostgreSQL'i yeniden başlat (vardiya dışında) |
| DB locale `C` | Bilinen açık bulgu (**Y-2**): `ILIKE` Türkçe katlamıyor, aramalar sessizce eksik sonuç veriyor. Kod tarafı düzeltmesi henüz yapılmadı — **bu geçişin kapsamı değil**, ayrı iş olarak raporla |
| `archive_mode=off` | Bilinen açık bulgu (**Y-4 kalanı**): PITR yok, kurtarma noktası son gece yedeği. Ayrı iş |

---

## 6) Kesinlikle YAPILMAYACAKLAR

- **`npm run seed` ÇALIŞTIRMA.** Verileri sıfırlar. Eski installer'ın `.seeded`
  bayrağı koruması **kaldırıldı** — artık hiçbir otomatik engel yok.
- **pm2 cluster modu / `instances > 1` / 2. replica EKLEME.** Şunlar process-local
  durum tutar ve **sessizce** bozulur: presence sayımı, feature-flag cache,
  `archive-scheduler` (çift arşiv), `backup-scheduler` (aynı gece iki `pg_dump`).
- **`prisma migrate dev` ÇALIŞTIRMA** (reset riski). Üretimde yalnız `migrate deploy`.
- **`deploy/prisma.config.prod.js`'i gereksiz kopyalama.** Yalnız
  `npm ci --omit=dev` ile kurulmuş sunucuda `prisma.config.js` olarak kopyalanır.
  devDependencies kuruluysa kopyalanırsa hangi config'in okunduğu belirsizleşir.
- **Migration öncesi yedeği atlama.** Otomatik `premigrate_*` **artık üretilmiyor**
  (installer alıyordu); rollback stratejisi elle alınan yedeğe dayanıyor.

---

## 7) Geliştirme makinesinde doğrulananlar / doğrulanmayanlar

**Doğrulandı:** backend `npx tsc --noEmit` temiz · Electron `npm run typecheck`
temiz · `npm run check:docs` düzenlenen dosyalarda ölü link bulmadı.

**Doğrulanmadı (sunucuda test edilmeli):**
- `pg_dump`/`pg_restore` child process'i Windows'ta gerçekten koşuyor mu
  (yol boşluk içeriyor: `C:\Program Files\...`; `spawn` argümanları ayrı geçtiği
  için doğru olması **beklenir** ama saha testi yapılmadı)
- Gece zamanlayıcının 03:00 tetiklemesi ve telafi davranışı
- `pm2 restart` sırasında `process.on("message")` graceful shutdown'ının fiilen
  çalışması (`shutdown_with_message: true` ile eşleşmesi gerekiyor)
- Offsite kopyanın UNC yoluna (`\\NAS\...`) yazabilmesi — pm2'nin koştuğu
  hesabın o paylaşıma erişimi olmalı
- **Önceden var olan ve bana ait olmayan iki sorun:**
  `Teks-Erp/src/services/subcontractor.service.ts:3582,3586` lint hatası ve
  `docs/fason-envanter-gorunurluk-spec.md:736` ölü linki. Dokunulmadı.

---

## 8) DENETİM SONUCU — sunucudaki Claude bunu doldursun

> Denetimi koştuktan sonra bu bölümü gerçek çıktılarla doldur, tarih at ve
> commit et. Sonraki oturum buradan devam edecek.

**Denetim tarihi:** _(doldur)_

| Kontrol | Beklenen | Gerçek | Sonuç |
|---|---|---|---|
| En yeni yedek tarihi | son 24 saat içinde | | |
| Eski "TeksERP Gece Yedek" görevi | kayıtlı DEĞİL | | |
| `BACKUP_DIR` (pm2 env) | dolu | | |
| `BACKUP_OFFSITE_DIR` | dolu (tercihen) | | |
| `PG_BIN_DIR` + `pg_dump --version` | çalışıyor, sürüm uyumlu | | |
| pm2 `exec mode` / `instances` | `fork` / `1` | | |
| pm2 app adı | `teks-erp-backend` | | |
| Reboot mekanizması | **tespit edilecek** | | |
| `pm2-logrotate` | kurulu | | |
| PostgreSQL major | 18.x | | |
| PostgreSQL port | `.env` ile tutarlı | | |
| DB locale | (C ise Y-2 açık) | | |
| `statement_timeout` | `50s` | | |
| Bellek parametreleri (§4.4) | runbook §6 ile uyumlu | | |
| `/health` → `lastBackup` | null DEĞİL | | |
| `dist\server.js` | var | | |
| Log klasörü | var | | |
| Firewall 4000 | açık | | |
| DB sahibi vs `DATABASE_URL` kullanıcısı | aynı (değilse override) | | |
| `postgresql.conf` port = `.env` port | aynı | | |

**Yapılan düzeltmeler:** _(doldur)_

**Açık kalanlar / kullanıcıya sorulacaklar:** _(doldur)_

---

## 9) İlgili dokümanlar

- `docs/ops/DEPLOY-RUNBOOK.md` — kurulum/güncelleme/yedek/rollback; **§6 = PG conf
  değerlerinin tek kaydı**, **§7 = reboot kalıcılığı**
- `docs/ops/KURULUM.md` §A — sıfırdan sunucu kurulumu (pm2)
- `docs/ops/URETIM-KONTROL-LISTESI.md` — deploy öncesi/sonrası kontrol listesi
- `Teks-Erp/DB-MIMARI-DENETIM.md` — Y-2 (locale/ILIKE), Y-4 (PITR) açık bulguları
- `Teks-Erp/CLAUDE.md` — "Yedekleme backend'e ait" maddesi
