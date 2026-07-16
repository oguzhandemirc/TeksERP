# TeksERP — Windows Sunucu Kurulum Paketi

Bu klasör, TeksERP backend'ini (Express API) **PostgreSQL ile birlikte** fabrika
Windows sunucusuna tek bir `setup.exe` ile kuran paketi üretir.

- **Docker yok.** PostgreSQL ve backend birer **Windows servisi** olur, sunucu her
  açıldığında (elektrik kesintisi sonrası dahil) otomatik başlar.
- **Tek kurulum, bir daha uğraşma.** Kurulum DB'yi oluşturur, migration'ları
  uygular, seed'i (admin/123123) yükler, firewall'da 4000 portunu açar.
- **Güncelleme = aynı setup'ı tekrar çalıştır.** Veriler korunur, sadece yeni
  migration'lar uygulanır, servis yeniden başlar.

---

## Mimari özet

| Bileşen | Servis adı | Detay |
|---|---|---|
| PostgreSQL 18 | `TeksErpDB` | Yalnız `127.0.0.1:5433` dinler (dışarı kapalı) |
| Backend (Node) | `TeksErpBackend` | `0.0.0.0:4000` — fabrika ağına açık |

**Klasör ayrımı** (güncellemeyi temiz yapan kilit nokta):

```
C:\Program Files\TeksERP\        <- KOD (her güncellemede değişir)
  app\          dist\ + node_modules\ + prisma\ + prisma.config.js
  runtime\      node\node.exe + pgsql\ + nssm.exe
  scripts\      manage.ps1

C:\ProgramData\TeksERP\          <- VERİ (güncellemede KORUNUR)
  pgdata\       PostgreSQL veritabanı dosyaları
  secret.json   DB şifreleri + JWT secret (rastgele üretilir, gizli)
  .seeded       seed bir kez çalıştı işareti
  logs\         backend-out.log / backend-err.log
  backups\      yedekler
```

---

## A) Setup paketini oluşturma (Windows BUILD makinesinde, bir kez)

> Bu adımı, geliştirme/derleme yaptığın Windows makinede yaparsın. Üretilen
> `setup.exe`'yi sonra fabrika sunucusuna kopyalarsın.

**Gereksinimler:**
- Node.js + npm (backend'i derlemek için)
- [Inno Setup 6](https://jrsoftware.org/isdl.php) (`ISCC.exe`)
- İnternet (Node/PostgreSQL/NSSM ilk seferde indirilir, `.cache\`'e önbelleğe alınır)

**Çalıştır:**
```powershell
cd Teks-Erp\installer\windows
powershell -ExecutionPolicy Bypass -File build.ps1
```

Çıktı: `installer\windows\dist\TeksERP-Setup-1.0.0.exe`

Yeni sürüm çıkarırken:
```powershell
# package.json'daki "version"u yükselt, sonra:
powershell -ExecutionPolicy Bypass -File build.ps1 -Version 1.1.0
```

İndirilen runtime sürümleri `build.ps1` başındaki `$NodeVersion / $PgVersion /
$NssmVersion` değişkenlerinden ayarlanır.

---

## B) Fabrika sunucusuna kurulum (ilk kez)

1. `TeksERP-Setup-1.0.0.exe`'yi sunucuya kopyala.
2. **Sağ tık → Yönetici olarak çalıştır** (servis kurmak için şart).
3. Sihirbazı geç. Kurulum otomatik olarak:
   - PostgreSQL'i kurar ve `TeksErpDB` servisi yapar,
   - veritabanı + kullanıcı oluşturur (rastgele şifre),
   - migration'ları uygular, seed'i yükler,
   - backend'i `TeksErpBackend` servisi yapar,
   - 4000 portunu firewall'da açar.
4. Bittiğinde erişim adresleri ekrana yazılır.

**Erişim:**
- Sunucuda: `http://localhost:4000`
- Fabrika ağında: `http://<sunucu-ip>:4000`
- Giriş: `admin / 123123`

> Swagger API dokümanı (`/api-docs`) **üretimde kapalıdır** (yalnız geliştirme
> ortamında açık — iç API şemasını dışarıya açmamak için).

> **Yönetim panelini (Electron) bağlama:** Panelin API adresini
> `http://<sunucu-ip>:4000` yapman yeterli.

---

## C) Yeni sürüm kurma (güncelleme)

1. Yeni `TeksERP-Setup-x.y.z.exe`'yi sunucuya kopyala.
2. **Yönetici olarak çalıştır.**
3. Hepsi bu. Kurulum:
   - mevcut şifreleri ve veritabanını **korur**,
   - kodu yeni sürümle değiştirir,
   - **migration'lardan önce otomatik yedek alır** (`backups\premigrate_<eskiSürüm>_<zaman>.dump`),
   - yalnızca **yeni migration'ları** uygular,
   - **seed'i atlar** (veriler korunur),
   - backend servisini yeniden başlatır,
   - konsolda **sürüm geçişini** gösterir (örn. `1.0.0 -> 1.1.0 (yukseltme)`).

> İpucu: Büyük indeks içeren migration'lar büyük tablolarda yazma kilidi alabilir.
> Bu tür güncellemeleri **vardiya dışında** (gece/hafta sonu) çalıştır.

**Geri alma (rollback):** Güncelleme sonrası bir sorun çıkarsa, migration öncesi
otomatik alınan yedeğe dönebilirsin:
```powershell
.\manage.ps1 -Action restore -BackupFile "C:\ProgramData\TeksERP\backups\premigrate_1.0.0_20260601_030000.dump"
```
(Şema değişen bir sürümde, koddan da eski sürüme dönmen gerekebilir — önce eski `setup.exe`'yi çalıştır, sonra restore et.)

### PostgreSQL major sürüm yükseltme (ör. 18 → 19)

Yeni setup **daha yeni bir PostgreSQL major** sürümü içeriyorsa, gömülü binary mevcut
veri dizinini (eski major) **doğrudan açamaz**. Kurulum bunu algılar ve **net bir hatayla
güvenle durur** (cryptic bir "servis başlamadı" hatası vermez). Yükseltme adımları:

1. **Önce eski sürümle yedek al** (henüz eski `setup.exe` kuruluyken):
   ```powershell
   .\manage.ps1 -Action backup -OffsitePath \\NAS\teksyedek
   ```
2. **Temiz kur + geri yükle:** yeni `setup.exe`'yi kur; veri dizini yeni major'da
   `initdb` ile oluşur, sonra yedeği geri yükle:
   ```powershell
   .\manage.ps1 -Action restore -BackupFile \\NAS\teksyedek\tekserp_YYYYAAGG_SSDDSS.dump
   ```
   (Alternatif: PostgreSQL'in `pg_upgrade` aracıyla yerinde yükseltme — ileri düzey.)

> Bu senaryo yalnızca major sürüm (ör. 18→19) atlarken geçerlidir; aynı major içindeki
> normal güncellemeler (D bölümü) veriyi olduğu gibi korur.

---

## D) Günlük yönetim komutları

Yönetici PowerShell'de (`C:\Program Files\TeksERP\scripts\`):

```powershell
.\manage.ps1 -Action status     # servis durumu + sağlık kontrolü
.\manage.ps1 -Action restart    # her iki servisi yeniden başlat
.\manage.ps1 -Action stop
.\manage.ps1 -Action start
.\manage.ps1 -Action logs       # backend loglarını CANLI izle (pm2 logs gibi; Ctrl+C ile çık)
.\manage.ps1 -Action logs -Tail 200   # son 200 satırdan başlayarak izle
.\manage.ps1 -Action studio     # Prisma Studio — veritabanını tarayıcıda görüntüle
.\manage.ps1 -Action backup     # C:\ProgramData\TeksERP\backups\ içine .dump al
.\manage.ps1 -Action backup -BackupPath D:\Yedekler
.\manage.ps1 -Action backup -OffsitePath \\NAS\teksyedek   # ayrıca makine dışına kopyala (bir kez ayarla, kalıcı olur)
.\manage.ps1 -Action restore -BackupFile C:\...\tekserp_20260601_030000.dump
```

### Loglara bakma (log kayıtları) 📋

Bir sorun olduğunda **ilk buraya bak.** Üç yolu var:

**1. Canlı izleme — en pratik (`pm2 logs` karşılığı):**
```powershell
.\manage.ps1 -Action logs            # canlı akış; Ctrl+C ile çık
.\manage.ps1 -Action logs -Tail 200  # son 200 satırdan başlayarak izle
```
Başlat menüsünde **"TeksERP Logları (canlı)"** ve **masaüstünde** aynı kısayol var —
çift tıkla, canlı log penceresi açılır (sunucuya PowerShell yazmana gerek yok).

**2. Log dosyaları** (`C:\ProgramData\TeksERP\logs\`):
- `backend-out.log` — normal çıktı (açılış, istekler)
- `backend-err.log` — **hatalar / stack trace'ler** ← sorun olduğunda önce bu
```powershell
Get-Content C:\ProgramData\TeksERP\logs\backend-err.log -Tail 100 -Wait
```

**3. Yönetim panelinden (sunucuya hiç girmeden):** İş/veri hataları backend tarafından
**veritabanına** da yazılır ve panelde görünür:
- **Sistem → Sistem Kayıtları** — backend 5xx hataları (stack + hangi endpoint + kullanıcı)
- **Sistem → Aktivite Günlüğü** — kim hangi kaydı değiştirdi
- **Sistem → Endpoint Performansı** — hangi uç yavaş (p50/p95)

> PostgreSQL'in kendi logu ayrı: `C:\ProgramData\TeksERP\pgdata\log\`. DB servisi
> (`TeksErpDB`) hiç başlamıyorsa oraya bak.

---

Servisleri Windows "Hizmetler" (services.msc) ekranından da yönetebilirsin:
`TeksErpDB`, `TeksErpBackend`. Çoğu işlem için sistem tepsisindeki **durum paneli**
sağ-tık menüsü yeterlidir (başlat/durdur/yeniden başlat, yedek al, logları aç,
durum sayfası, Prisma Studio).

**Otomatik yedek:** Kurulum, Görev Zamanlayıcı'da **`TeksERP Gece Yedek`** adıyla
her gece **03:00**'te çalışan bir yedek görevi otomatik kurar — elle ayarlamana
gerek yok. Zamanlı yedeklerden (`tekserp_*.dump`) en yeni **14 tanesi** tutulur,
eskiler otomatik silinir (disk dolmaz). Migration öncesi yedekler (`premigrate_*`)
bu temizliğe dahil değildir. Saati/günü Görev Zamanlayıcı'dan değiştirebilirsin.
Her yedek alındıktan sonra **`pg_restore --list` ile bütünlüğü doğrulanır**; bozuk
çıkarsa o dosya silinir ve sağlam eski yedekler korunur. `secret.json` da her yedekle
birlikte `backups\` klasörüne kopyalanır (geri yükleme için ikisi de gerekir).

> ⚠️ **Makine dışı (offsite) yedek — önemli:** Yedekler varsayılan olarak veritabanıyla
> **aynı diskte** (`C:\ProgramData\TeksERP`). Tek disk arızası / fidye yazılımı / yangın
> hem veriyi hem yedekleri aynı anda yok eder. İkinci bir kopyayı **başka bir makineye/diske**
> almak için bir kez şunu çalıştır:
> ```powershell
> .\manage.ps1 -Action backup -OffsitePath \\NAS\teksyedek
> ```
> Verdiğin yol `C:\ProgramData\TeksERP\backup-offsite.txt`'e kaydedilir; bundan sonra
> **gece yedekleri de otomatik** o hedefe kopyalanır (`.dump` + `secret.json`). Hedef bir
> ağ paylaşımı (`\\NAS\...`), harici disk (`E:\yedek`) veya başka sunucu olabilir.
>
> **6 ayda bir tatbikat:** Bir yedeği boş/test bir DB'ye geri yükleyip açıldığını doğrula —
> "yedek var" demek "yedek çalışıyor" demek değildir.

---

## E) Kaldırma

Denetim Masası → Programlar → **TeksERP Backend** → Kaldır.

Kaldırırken sorulur:
- **HAYIR** (varsayılan): program kaldırılır, **veriler korunur**
  (`C:\ProgramData\TeksERP`). Tekrar kurarsan veriler yerli yerinde olur.
- **EVET** (iki kez onay): veritabanı dahil **her şey** silinir (geri alınamaz).

---

## F) Sorun giderme

| Belirti | Çözüm |
|---|---|
| Backend yanıt vermiyor | `logs\backend-err.log`'a bak. `manage.ps1 -Action status` çalıştır. |
| `TeksErpDB` servisi başlamıyor | `C:\ProgramData\TeksERP\pgdata\log\` altındaki PostgreSQL logu. Genelde dosya izni — kurulum NetworkService'e izin verir; `icacls` ile tekrar verilebilir. |
| 5433 / 4000 portu dolu | `build.ps1` öncesi gerek yok; portları `scripts\manage.ps1` başındaki `$PgPort` / `$ApiPort` değiştirip yeniden kur. |
| Ağdaki makineler bağlanamıyor | Firewall kuralı (`TeksERP API 4000`) ve sunucu IP'sini kontrol et. Aynı LAN'da olmalılar. |
| Seed çalışmadı | `manage.ps1` migration'lardan sonra seed'i atlamışsa `.seeded` dosyasını silip `-Action install` tekrar çalıştır. |

**Manuel DB erişimi** (gerekirse):
```powershell
$env:PGPASSWORD = (Get-Content C:\ProgramData\TeksERP\secret.json | ConvertFrom-Json).pgSuperPassword
& "C:\Program Files\TeksERP\runtime\pgsql\bin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d TeksErpDb
```

---

## G) Güvenlik notları

- DB yalnız `127.0.0.1` dinler — fabrika ağından **doğrudan DB erişimi yok**,
  sadece backend (4000) açık.
- Şifreler ve JWT secret kurulumda **rastgele** üretilir, `secret.json` içinde
  yalnız SYSTEM + Administrators erişimiyle saklanır.
- `secret.json`'ı yedekle — kaybolursa mevcut DB'ye uygulama bağlanamaz
  (şifre orada). Yedek (`.dump`) + `secret.json` birlikte saklanmalı.
