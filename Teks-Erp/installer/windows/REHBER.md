# Backend'i Tek `setup.exe` + Tray Haline Getirme — Rehber

Bir **Node.js + PostgreSQL** backend'ini; üzerinde hiçbir şey kurulu olmayan bir Windows
sunucuya **çift tıkla** kuran, sunucu açıldığında kendi başlayan, "yeni exe'yi çalıştır =
güncelle" mantığıyla güncellenen ve saat yanında durum ikonu gösteren bir pakete dönüştürür.
Docker yok, internet bağımlılığı yok (sunucuda).

---

## Temel fikir — 3 ilke

Bütün tasarım bu üç karara dayanıyor. Gerisi detay:

**1. Hiçbir şey önceden kurulmaz.**
Node, PostgreSQL ve servis yöneticisini (NSSM) paketin içine **gömeriz**. Sunucuda "önce Node
kur, sonra PG kur" yok — tek exe, çift tık. Bunlar build sırasında internetten indirilip pakete
eklenir; sunucunun internete bağlanması gerek kalmaz.

**2. Kod ile veri ayrı klasörde durur.** ← Güncellemeyi güvenli kılan asıl nokta.
```
C:\Program Files\App\     → KOD     (her güncellemede komple silinip yenisi gelir)
C:\ProgramData\App\       → VERİ    (DB dosyaları, şifreler, yedekler — asla silinmez)
```
Kod ve veri iç içe olsaydı, güncelleme veriyi de ezerdi. Ayrı oldukları için
**güncelleme = yeni exe'yi tekrar çalıştır**; veri yerinde kalır.

**3. Bütün mantık tek bir PowerShell scriptinde** (`manage.ps1`).
`setup.exe` yalnızca ince bir kabuk görevi görür: dosyaları kopyalar, ardından `manage.ps1`'i
çağırır. Kurma, güncelleme, yedek alma, başlatma ve durdurma işlemlerinin tümü bu tek scriptte
toplanır. Böylece installer sade kalır, asıl mantık tek bir yerde yönetilir ve gerektiğinde elle
de çalıştırılabilir.

---

## Kullanılan araçlar (hiçbiri npm paketi değil)

| Araç | Neden |
|---|---|
| **Inno Setup 6** (`ISCC.exe`) | `.exe` installer'ı derler. Ücretsiz, klasik Windows kurulum sihirbazı. |
| **NSSM** | `node.exe`'yi Windows **servisi** yapar: reboot'ta otomatik başlar, çökerse yeniden kalkar, logları dosyaya yazar. |
| **Gömülü Node.js** | Sunucuda Node aranmaz. nodejs.org win-x64 **zip**'inden sadece `node.exe` alınır. |
| **Gömülü PostgreSQL** | EnterpriseDB **"binaries-zip"** sürümü (kurulum sihirbazı değil — taşınabilir olan). |
| **PowerShell** | Tüm kurulum/yönetim mantığı. Windows'ta hazır. |
| **VBScript + .NET WinForms** | Tray ikonunu pencere açmadan çalıştırmak için. İkisi de Windows'ta hazır. |

> Önemli: Backend'in `package.json`'ına **tek bir bağımlılık bile eklemezsin**. Backend normal
> Express/Prisma uygulaması olarak kalır; bütün bu araçlar onun *etrafında* çalışır.

---

## Dosyalar ve görevleri

| Dosya | Görev |
|---|---|
| `build.ps1` | **Build makinesinde** çalışır, `setup.exe`'yi üretir. |
| `setup.iss` | Inno Setup tanımı — dosyaları kopyalar, sonra `manage.ps1`'i çağırır. |
| `scripts/manage.ps1` | **Sunucuda** çalışır — asıl beyin (kur/güncelle/yedek/servis). |
| `tray/tray.ps1` + `tray-launch.vbs` | Saat yanında yeşil/sarı/kırmızı durum ikonu (opsiyonel). |
| `branding/` | Logo + ikon (kozmetik). |

---

## Arka planda ne oluyor?

İş iki evreye ayrılır:

### Evre 1 — Build (kendi makinende, sürüm başına bir kez)

`build.ps1` şunları sırayla yapar:
1. Backend'i derler (`tsc`) ve **üretim** `node_modules`'unu hazırlar (`npm prune --omit=dev`).
2. Node, PostgreSQL ve NSSM zip'lerini indirir (ikinci seferde önbellekten gelir).
3. Hepsini iki klasöre dizer: `payload\` (senin kodun) ve `runtime\` (gömülü ikililer).
4. `ISCC.exe` ile bunları tek `setup.exe` içinde sıkıştırır.

Çıktı: `dist\App-Setup-1.0.0.exe`. Bu dosyayı sunucuya kopyalarsın.

### Evre 2 — Kurulum (sunucuda)

`setup.exe`'yi **Yönetici olarak** çalıştırırsın. Dosyaları `Program Files`'a açar, sonra
`manage.ps1 install`'ı tetikler. O da idempotent olarak (yani ikinci kez çalışınca bozmadan) şunları yapar:

1. **Şifreleri ayarla:** İlk kurulumsa rastgele DB şifresi + JWT secret üretir → `secret.json`
   (sadece SYSTEM+Admin okuyabilir). Zaten varsa **okur** → eski şifreler korunur.
2. **PostgreSQL'i hazırla:** `initdb` ile veri dizinini kurar, ayarlarını (port, sadece localhost
   dinle) yazar, `pg_ctl register` ile **DB servisini** kaydeder, rol + veritabanını oluşturur.
3. **Şemayı uygula:** `prisma migrate deploy` çalıştırır. **Seed (örnek veri / ilk admin) yalnız
   ilk kurulumda** yüklenir (`.seeded` adlı bir işaret dosyasıyla bir daha tekrarlanmaz).
4. **Backend'i servis yap:** NSSM ile `node dist\src\server.js`'i **backend servisi** olarak
   kaydeder; DB servisine bağımlı (önce DB kalksın), ortam değişkenlerini (DATABASE_URL, JWT...) ona verir.
5. **Firewall'u aç:** Fabrika ağındaki makineler bağlanabilsin diye API portunu açar.

Bittiğinde iki Windows servisi çalışır durumdadır ve sunucu her açıldığında otomatik kalkarlar.

### Evre 3 — Güncelleme (neden "sadece exe'yi çalıştır"?)

Yeni `setup.exe`'yi yönetici olarak çalıştırırsın — aynı `install` yolu işler ama bu sefer:
`secret.json` zaten var → şifreler korunur; `pgdata` zaten var → `initdb` atlanır; `.seeded` var
→ seed atlanır; `migrate deploy` yalnızca **yeni** migration'ları uygular; servis yeniden başlar.
`C:\ProgramData` (veri) hiç dokunulmadan kalır. İşte kod/veri ayrımının kazandırdığı budur.

---

## Kilit komutlar

Scriptin geri kalanı çoğunlukla hazırlık ve kontrol; işi asıl yapan komutlar bunlardır:

```powershell
# PostgreSQL'i Windows servisi yap
pg_ctl register -N AppDB -D <pgdata-yolu> -S auto
# (postgres LocalSystem'de çalışmaz → servis hesabını NetworkService'e çevir)

# Backend'i Windows servisi yap (parametreye GÖRELİ yol ver — boşluklu yol node'u patlatır)
nssm install AppBackend <node.exe-yolu> dist\src\server.js
nssm set AppBackend AppDirectory <app-yolu>
nssm set AppBackend AppEnvironmentExtra "DATABASE_URL=..." "JWT_SECRET=..." "PORT=4000"
nssm set AppBackend DependOnService AppDB
```

---

## Sık karşılaşılan tuzaklar

1. **postgres LocalSystem hesabında ÇALIŞMAZ.** DB servisini `NT AUTHORITY\NetworkService`
   hesabına çevir ve `pgdata` klasörüne o hesaba yazma izni ver (`icacls`). En sık hata budur.
2. **PG'yi 5432'ye kurma.** Sunucuda zaten Postgres olabilir → çakışır. **5433** kullan ve sadece
   `127.0.0.1` dinlet (dışarı kapalı; yalnız backend bağlanır).
3. **NSSM'e mutlak yol verme.** `C:\Program Files\...` boşluk içerir; NSSM tırnaksız geçince node
   `C:\Program`'ı arar ve çöker. `AppDirectory`'yi ayarla, parametreye **göreli** yol ver.
4. **Prisma kullanıyorsan: `npm prune` sonrası `prisma generate`'i TEKRAR çalıştır.** Yoksa
   Windows query engine'i pruned ağaçta kalmaz, sunucuda "engine not found" alırsın.
5. **`secret.json`'ı yedekle.** DB şifresi orada — kaybolursa mevcut veritabanına bağlanılamaz.
   Yedek (`.dump`) ile `secret.json` birlikte saklanmalı.

---

## Kendi projene uyarlama (checklist)

- [ ] İsimleri değiştir: servis adları, DB adı/kullanıcı, `setup.iss`'teki **AppId** (yeni GUID üret, sabit tut)
- [ ] Yolları değiştir: `C:\ProgramData\App`, backend'in giriş dosyası (`dist\src\server.js`)
- [ ] Portları çakışmayacak şekilde ayarla (API + PG)
- [ ] Backend `DATABASE_URL` / `JWT_SECRET`'i **ortam değişkeninden** okumalı (NSSM'den geliyor)
- [ ] TypeScript yoksa `tsc` adımını çıkar; **Prisma yoksa** ilgili tüm satırları çıkar
- [ ] Logo / ikonları kendininkiyle değiştir

---

## Daha kolay alternatifler (bilmekte fayda var)

- **DB'yi ayrı kur:** PostgreSQL'i gömmek yerine sunucuya resmi installer'ıyla bir kez kurarsan,
  yukarıdaki 2. adımın tamamı (initdb, servis, NetworkService, şifre) kodundan **silinir**.
  Bedeli: kurulumda bir manuel adım. Tek sunucu / yarı-teknik kurulum için en az iş budur.
- **electron-builder:** Tek `npm run dist` ile setup.exe + tray + **oto-güncelleme** verir. Ama
  Electron bir **oturum uygulamasıdır, servis değildir** — kimse login olmadan ayakta kalmaz.
  Backend'in 7/24 headless çalışması gerekiyorsa (fabrika sunucusu → gerekir), backend'i yine
  gerçek servis yapman gerekir; Electron sadece tray+updater kabuğu olur.

---

## İnternet kaynakları

Birebir bu kombinasyonu (gömülü Node+PG + servis + Inno + tray) anlatan **tek bir hazır rehber
yok** — bu, parçaları birleştiren özel bir mimari. Kullanılan araçlar olgun ve stabil olduğundan
eski yazılar da teknik olarak hâlâ geçerli; aşağıda mümkün olan yerde güncel olanları topladım.

- **Inno Setup ile Node uygulaması paketleme:** https://prakhartripathi.hashnode.dev/create-windows-installer-for-nodejs-app-using-inno-setup · (klasik referans) https://coolaj86.com/articles/how-to-create-an-innosetup-installer.html
- **Node'u Windows servisi yapma (NSSM):** https://www.w3tutorials.net/blog/nssm-nodejs/ · https://briancaos.wordpress.com/2022/12/01/run-node-js-on-windows-server-using-nssm/
- **PostgreSQL'i `pg_ctl` ile servis yapma:** https://www.postgresql.org/docs/current/app-pg-ctl.html (her zaman en güncel sürüm) · https://www.cybertec-postgresql.com/en/registering-postgresql-as-a-service-on-windows/
- **PowerShell tray ikonu:** https://www.sapien.com/blog/2025/04/09/changing-icons-and-hover-text-in-powershell-tray-applications/
- **Hazır araç alternatifleri:** https://www.electron.build/ · https://www.npmjs.com/package/systray2 · https://www.npmjs.com/package/node-windows

> **Önemli güncel not — NSSM artık bakımda değil** (son sürüm 2017). Stabil olduğu için hâlâ
> yaygın kullanılıyor, ancak aktif bakımlı muadili **WinSW** (XML config, log rotasyonu): proje
> https://github.com/winsw/winsw · karşılaştırma https://dev.to/aelassas/servy-vs-nssm-vs-winsw-2k46
> Yeni kuruyorsan NSSM yerine WinSW'i değerlendir; ikisi de aynı işi yapar.

---

**Tek cümle:** Gömülü Node + PostgreSQL + NSSM'i Inno Setup ile tek exe'de paketle, bütün mantığı
bir PowerShell scriptine koy, kodu `Program Files`'a / veriyi `ProgramData`'ya ayır → "exe'yi
tekrar çalıştır = güncelle" elde edersin. Tray ise ayrı bir PowerShell + WinForms durum ikonu.
