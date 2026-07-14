# TeksERP — Üretim Deploy Runbook

Bu doküman backend'i (`Teks-Erp/`, Express 5 + Prisma 7 + PostgreSQL) bir
üretim/fabrika sunucusuna kurma ve güncelleme adımlarını içerir. İki yol vardır:

- **Windows installer yolu** (önerilen, fabrika sunucusu) — tek `setup.exe`,
  Docker yok, PostgreSQL + backend Windows servisi.
- **Linux / manuel yol** — sistemde kurulu Node + PostgreSQL üzerinde elle.

> Migration ayrıntıları için `Teks-Erp/MIGRATION-DEPLOY.md`'ye, deploy öncesi
> madde-madde kontrol için `URETIM-KONTROL-LISTESI.md`'ye bakın.

---

## 0) Ön-koşullar

| Bileşen | Sürüm | Not |
|---|---|---|
| Node.js | **22.x** | Geliştirme/CI 22.19; Windows installer'a gömülü Node **22.13.1** |
| PostgreSQL | **16.x** | Windows installer'a gömülü 16.6; collation tipik `en_US.UTF-8` |
| Disk | yeterli boş alan | DB + yedekler büyür; otomatik yedek son 14 dosyayı tutar |
| RAM | makul | Node backend + PostgreSQL aynı makinede |

> **Not:** `package.json`'da `engines` alanı tanımlı değil — Node 22 bir
> operasyonel gerekliliktir, paket düzeyinde zorlanmaz. Installer yolunda Node
> zaten gömülü olduğundan sistemde Node kurulu olması gerekmez.

---

## 1) Zorunlu ortam değişkenleri (`.env`)

Backend `Teks-Erp/.env` (veya Windows'ta NSSM env / `C:\ProgramData\TeksERP\.env`)
şu değişkenleri ister:

```
PORT=4000
DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/<db>?schema=public"
JWT_SECRET="<en az 32 karakter güçlü rastgele>"
```

- **`JWT_SECRET` ≥ 32 karakter ZORUNLU.** Backend açılışta bunu **enforce eder**:
  `src/services/auth.service.ts` içinde `if (!secret || secret.length < 32)`
  → process fırlatır ("JWT_SECRET environment variable zorunlu ve en az 32
  karakter olmalı"). Kısa/eksik secret ile sunucu açılmaz.
- **`DATABASE_URL`** — ortam başına farklı DB adı: dev = `adnansahin_db`,
  Windows production = `TeksErpDb` (installer rastgele DB şifresi üretir,
  `secret.json`'da saklar).
- **`PORT=4000`** — fabrika ağına açılan API portu; firewall'da açılır.
- Windows installer `JWT_SECRET` ve DB şifrelerini kurulumda **rastgele üretir**
  ve `C:\ProgramData\TeksERP\secret.json`'da (yalnız SYSTEM + Administrators)
  saklar — elle girmeye gerek yok. `secret.json` kaybolursa mevcut DB'ye
  bağlanılamaz; yedekle.

---

## 2) İLK kurulum (yalnızca bir kez)

İlk kurulumda DB boştur; şemayı kurup admin/yetki/kalite verisini seed'leriz.

### Windows installer (önerilen)

1. `TeksERP-Setup-x.y.z.exe`'yi sunucuya kopyala.
2. **Sağ tık → Yönetici olarak çalıştır.**
3. Kurulum otomatik: PostgreSQL'i `TeksErpDB` servisi yapar → `TeksErpDb`
   veritabanını + kullanıcıyı oluşturur → `prisma migrate deploy` → **ilk
   kurulum olduğu için seed** (`admin/123123`, yetkiler, kalite sınıfları) →
   backend'i `TeksErpBackend` servisi yapar → 4000 portunu firewall'da açar.
4. Erişim: `http://localhost:4000` / `http://<ip>:4000`, giriş `admin / 123123`.

### Linux / manuel

```bash
cd Teks-Erp
# .env hazır (yukarıdaki üç değişken)
npm ci                          # tüm bağımlılıklar
npm run prisma:generate         # = npx prisma generate (client üret)
npm run prisma:migrate          # = npx prisma migrate deploy (şemayı kur)
npm run seed                    # SADECE ilk kurulumda — admin/yetkiler/kalite
# sunucuyu kaldır (systemd / pm2 / nohup):
node dist/server.js             # önceden `npm run build` ile derlenmiş olmalı (rootDir=src → dist/server.js)
```

> **`seed` SADECE ilk kurulumda çalıştırılır.** Sonraki güncellemelerde ASLA —
> `npm run seed` (= `npx prisma db seed`) dev verisini sıfırlar. Windows
> installer bunu `.seeded` bayrak dosyasıyla otomatik garanti eder (bir kez
> çalışınca tekrar atlanır).

---

## 3) GÜNCELLEME (yeni sürüm — seed YOK)

Veriler korunur; sadece kod + bekleyen migration uygulanır.

### Windows installer

1. Yeni `TeksERP-Setup-x.y.z.exe`'yi **Yönetici olarak çalıştır**.
2. Kurulum: mevcut DB + `secret.json`'ı **korur** → migration'lardan ÖNCE
   otomatik yedek alır (`backups\premigrate_<eskiSürüm>_<zaman>.dump`) → yalnız
   **yeni migration'ları** uygular → **seed'i atlar** → `TeksErpBackend`
   servisini yeniden başlatır.

> Not: Windows installer'da Prisma client kurulum anında değil, `build.ps1`
> derlemesinde üretilip `node_modules`'a gömülür; bu yüzden `manage.ps1` install
> sırasında `generate` ÇAĞIRMAZ (gerek yok).

### Linux / manuel

```bash
cd Teks-Erp
git pull                        # yeni migration dosyaları gelir
npm install                     # package.json değiştiyse
npm run prisma:generate         # client yenilensin (manuel yolda her güncellemede)
npm run build                   # tsc derle (dist/ güncellensin)
npm run prisma:migrate          # = prisma migrate deploy — yalnız pending'leri uygular
# servisi yeniden başlat (systemd restart / pm2 restart)
# seed YOK
```

`migrate deploy` idempotent — yalnız `_prisma_migrations`'da olmayanları, dosya
sırasıyla uygular; tekrar çalıştırmak güvenli.

---

## 4) Sağlık kontrolü

```bash
curl -s http://localhost:4000/health
```

> **Gerçek endpoint `GET /health`'tir** (`src/app.ts`, `app.get("/health", ...)`), `/api/health` DEĞİL —
> bir `/api/health` alias'ı yoktur. Windows installer'ın durum kontrolü de
> (`manage.ps1 -Action status`) `http://localhost:4000/health`'i yoklar.

- HTTP **200** + JSON: `status`, `db: "UP"|"DOWN"`, `version`, `uptimeSec`,
  `dbSizeBytes`, `dbConnections`, `lastBackup` + ucuz metrikler (cache isabeti,
  rolls ölü-satır %, en uzun aktif sorgu sn, kilitli sorgu sayısı).
- API çalışıyorsa HTTP her zaman 200 döner; DB ayrı test edilir (`db: "DOWN"`
  ise DB bağlantısı yok). Deploy sonrası `db: "UP"` ve 200 beklenir.
- Windows: tepsi durum paneli yeşil/sarı/kırmızı rozetle aynı bilgiyi gösterir.

---

## 5) Yedek ve geri yükleme

PostgreSQL custom-format dump (`pg_dump -Fc` / `pg_restore`):

```bash
# Yedek al
pg_dump -h <host> -p 5432 -U <user> -d <db> -Fc -f tekserp_$(date +%Y%m%d_%H%M).dump

# Geri yükle (mevcut verinin üzerine — önce backend'i durdur)
pg_restore -h <host> -p 5432 -U <user> -d <db> --clean --if-exists tekserp_....dump
```

### Windows

```powershell
.\manage.ps1 -Action backup                          # ProgramData\backups\ içine .dump
.\manage.ps1 -Action restore -BackupFile C:\...\tekserp_....dump
```

- Installer **her gece 03:00** otomatik yedek alır (Görev Zamanlayıcı:
  `TeksERP Gece Yedek`), son **14** zamanlı dump'ı tutar; `premigrate_*`
  yedekleri bu temizliğe dahil değildir.
- Yedeği + `secret.json`'ı **birlikte** sakla (geri yükleme için ikisi de
  gerekir). Ayrı disk/sunucuya kopyalamak önerilir.

---

## 6) Operasyonel ayarlar (DB-level)

- **`statement_timeout = 50s`** her uygulama DB'sinde aktif (uzun sorgu otomatik
  iptal). Windows installer kurulumda `ALTER DATABASE "TeksErpDb" SET
  statement_timeout = '50s'` uygular; manuel yolda elle ayarlanır
  (`ALTER DATABASE <db> SET statement_timeout = '50s'`).
- **⚠️ Index-ağır migration tuzağı:** Büyük tabloda `CREATE INDEX`, 50s sınırını
  aşarsa iptal edilir. Yüz binlerce+ satıra index ekleyen migration'ın EN BAŞINA
  `SET statement_timeout = 0;` konmalı ve **vardiya dışı (gece/hafta sonu)**
  deploy edilmeli. Boş/yeni kurulumda risk yok. Detay:
  `Teks-Erp/MIGRATION-DEPLOY.md`.
- **Slow query log:** `>500ms` sorgular PostgreSQL log dosyasına düşer.

---

## 7) Log konumları

| Ortam | Backend log | DB / slow query log |
|---|---|---|
| Windows | `C:\ProgramData\TeksERP\logs\backend-out.log` / `backend-err.log` (NSSM rotasyonu, 10MB) | `C:\ProgramData\TeksERP\pgdata\log\` |
| Linux/manuel | servis yöneticisi (systemd journal / pm2 logs) | PostgreSQL `log_directory` (slow query `>500ms` burada) |

---

## 8) ROLLBACK stratejisi

> **`prisma migrate deploy` GERİ ALINMAZ.** Prisma down-migration üretmez.
> Tek güvenli geri dönüş = **migration öncesi yedeğinden restore**.

1. Backend servisini durdur.
2. Migration öncesi yedeği geri yükle (Windows installer otomatik aldı:
   `backups\premigrate_<eskiSürüm>_<zaman>.dump`; manuel yolda 5. adımda elle
   alınmış olmalı — bkz. `URETIM-KONTROL-LISTESI.md`).
3. Şema değişen bir sürümden dönüyorsan **kodu da eski sürüme al** (Windows:
   önce eski `setup.exe`'yi çalıştır; Linux: eski commit'e `git checkout` +
   `npm ci` + `npm run build`), SONRA restore et — yeni kod eski şemayla,
   eski kod yeni şemayla uyumsuz olabilir.
4. Servisi başlat, `/health` ile `db: "UP"` + 200 teyit et.

```powershell
# Windows tek komut:
.\manage.ps1 -Action restore -BackupFile "C:\ProgramData\TeksERP\backups\premigrate_1.0.0_20260601_0300.dump"
```

---

## 9) Güvenlik duruşu — LAN-only (şu an)

Uygulama şu an **yalnız fabrika içi ağda** çalışır, **dışa kapalıdır**. Bu
nedenle perimeter sertleştirmeleri (CORS kısıtı, HTTPS/TLS terminasyonu,
rate-limit) **bilinçli olarak eklenmedi** — iç ağ güvenli kabul ediliyor.
Windows installer DB'yi yalnız `127.0.0.1` dinletir (dışarıdan doğrudan DB
erişimi yok); sadece backend (4000) fabrika ağına açıktır.

> **DIŞA AÇILIRSA (internet/uzak erişim) ZORUNLU olur:**
> - CORS allow-list daraltma + HTTPS (reverse proxy / TLS) + rate-limit.
> - `User.tokenVersion` ile token iptali (iç erişim kontrolü olarak hâlâ
>   anlamlı ama LAN-only'de acil değil) — uzak erişimde çalınan/sızan token'ı
>   geçersiz kılmak için aktif hale getirilmeli.
> - JWT secret rotasyonu + şifre politikası gözden geçirilmeli.

---

## 10) Deploy provası — doğrulandı (2026-06-13)

Boş bir `teks_deploy_probe` DB'sinde tam ilk-kurulum yolu koşuldu:
`createdb` → `prisma migrate deploy` → `prisma generate` → `dropdb`. Sonuç: o
tarihteki **tüm migration'lar hatasız uygulandı** (51/51; 0 rolled-back/yarım),
Prisma Client v7 (`prisma`/`@prisma/client` ^7.7.0) temiz üretildi. Migration
sayısı sürekli artar — kanonik kaynak `prisma/migrations/` (2026-07-14 itibarıyla
~114, en yeni `20260714151000_dispatch_item_unique_dispatch_roll`); prova her
deploy öncesi tekrarlanmalı (bkz. `URETIM-KONTROL-LISTESI.md §C`). Detay:
`Teks-Erp/MIGRATION-DEPLOY.md`.
