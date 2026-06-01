# TeksERP — Windows Sunucu Kurulum Paketi

Bu klasör, TeksERP backend'ini (Express API) **PostgreSQL ile birlikte** fabrika
Windows sunucusuna tek bir `setup.exe` ile kuran paketi üretir.

- **Docker yok.** PostgreSQL ve backend birer **Windows servisi** olur, sunucu her
  açıldığında (elektrik kesintisi sonrası dahil) otomatik başlar.
- **Tek kurulum, bir daha uğraşma.** Kurulum DB'yi oluşturur, migration'ları
  uygular, seed'i (admin/admin123) yükler, firewall'da 4000 portunu açar.
- **Güncelleme = aynı setup'ı tekrar çalıştır.** Veriler korunur, sadece yeni
  migration'lar uygulanır, servis yeniden başlar.

---

## Mimari özet

| Bileşen | Servis adı | Detay |
|---|---|---|
| PostgreSQL 16 | `TeksErpDB` | Yalnız `127.0.0.1:5433` dinler (dışarı kapalı) |
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
- Swagger: `http://<sunucu-ip>:4000/api-docs`
- Giriş: `admin / admin123`

> **Yönetim panelini (Electron) bağlama:** Panelin API adresini
> `http://<sunucu-ip>:4000` yapman yeterli.

---

## C) Yeni sürüm kurma (güncelleme)

1. Yeni `TeksERP-Setup-x.y.z.exe`'yi sunucuya kopyala.
2. **Yönetici olarak çalıştır.**
3. Hepsi bu. Kurulum:
   - mevcut şifreleri ve veritabanını **korur**,
   - kodu yeni sürümle değiştirir,
   - yalnızca **yeni migration'ları** uygular,
   - **seed'i atlar** (veriler korunur),
   - backend servisini yeniden başlatır.

> İpucu: Büyük indeks içeren migration'lar büyük tablolarda yazma kilidi alabilir.
> Bu tür güncellemeleri **vardiya dışında** (gece/hafta sonu) çalıştır.

---

## D) Günlük yönetim komutları

Yönetici PowerShell'de (`C:\Program Files\TeksERP\scripts\`):

```powershell
.\manage.ps1 -Action status     # servis durumu + sağlık kontrolü
.\manage.ps1 -Action restart    # her iki servisi yeniden başlat
.\manage.ps1 -Action stop
.\manage.ps1 -Action start
.\manage.ps1 -Action backup     # C:\ProgramData\TeksERP\backups\ içine .dump al
.\manage.ps1 -Action backup -BackupPath D:\Yedekler
.\manage.ps1 -Action restore -BackupFile C:\...\tekserp_20260601_0300.dump
```

Servisleri Windows "Hizmetler" (services.msc) ekranından da yönetebilirsin:
`TeksErpDB`, `TeksErpBackend`.

**Otomatik yedek (önerilen):** Görev Zamanlayıcı'da her gece çalışan bir görev:
```
Program:   powershell.exe
Argüman:   -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\TeksERP\scripts\manage.ps1" -Action backup
```

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
