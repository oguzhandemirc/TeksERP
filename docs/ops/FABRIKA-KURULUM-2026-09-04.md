# Fabrika sunucusu — yeni sürüme geçiş (2026-09-04 akşamı)

> Yeni sürüm eskisinin **yerine** geçer. Eski pm2 uygulaması durdurulur; yenisi
> **aynı portta (4000)** ama **ayrı kökte** (`C:\TeksERP`) ve **ayrı
> veritabanında** (`tekserp_yeni`) koşar.
>
> Eski kurulum `C:\Etkili-Yazilim`de **olduğu gibi durur** — silinmez, dosyaları
> değişmez, veritabanına dokunulmaz. Geri dönüş bir komut.

## Sahadaki durum

| | |
|---|---|
| Eski API | `:4000`, **pm2 ile** koşuyor — durdurulacak |
| PostgreSQL | **eski API'nin klasörünün içinde** (Program Files'ta DEĞİL), `:5432` |
| Yeni veritabanı | `tekserp_yeni` — canlının bu akşamki kopyası, **zaten oluşturuldu** |
| Yeni kök | `C:\TeksERP` |
| Yeni port | **4000** (aynı) |
| pm2 adı | `tekserp-backend-yeni` (eskininki `tekserp-backend`) |

**Neden aynı port:** hiçbir istemcide ayar değişikliği gerekmiyor. Paneller,
tabletler, gömülü adresler, ağa ilan — hepsi olduğu gibi çalışmaya devam eder.

---

## Gönderilecek dosyalar

| Dosya | Ne için |
|---|---|
| `tekserp-backend-<damga>.zip` | Sürüm paketi |
| `kur.ps1` | Kurulum aracı. ⚠️ **Pakette GELMEZ**, elden taşınır |
| `ilk-kurulum.ps1` | Yeni kök için iskelet (klasör + pm2 + `.env`) |
| `ecosystem.fabrika.js` | **Hazır yapılandırma** — port 4000 + ayrı pm2 adı |
| `istemciler/` | **Panel setup + tablet APK — bu turda ZORUNLU**, `istemciler/OKU.md` |
| `FABRIKA-KURULUM-2026-09-04.md` | Bu dosya |
| `SUNUCU-CLAUDE-DEVIR-2026-09-04.md` | Sunucuda Claude oturumu açılacaksa **ona ilk okutulacak** |

Bu klasörde başka doküman **bilerek yok**: sıfırdan-fabrika-kurma runbook'u ve
yan-yana modelin genel referansı bu işle çelişen adımlar içeriyordu (farklı port,
farklı kök, farklı iş) ve kaldırıldı.

---

## Kurulum — yedi adım

Hepsi **YÖNETİCİ PowerShell**'de.

### 1) PostgreSQL araçlarının yerini bul

⚠️ **Atlanamaz.** `ilk-kurulum.ps1` otomatik aramayı yalnız
`C:\Program Files\PostgreSQL` altında yapar; sahadaki PostgreSQL **eski API'nin
klasörünün içinde** olduğu için **bulunamayacak**.

```powershell
Get-ChildItem C:\ -Recurse -Filter pg_dump.exe -ErrorAction SilentlyContinue |
  Select-Object -First 5 FullName
```

Çıkan yolun **`\bin` kısmı** `-PgBin` değeridir.

### 2) Yeni kök için iskelet

```powershell
.\ilk-kurulum.ps1 -Kok C:\TeksERP `
                  -DbAdi tekserp_yeni `
                  -DbKullanici tekserp `
                  -DbParola (Read-Host "DB parolasi") `
                  -PgBin "<1. adimda bulunan bin yolu>"
```

- ⚠️ **Parolayı düz yazmayın** — komut satırına yazılan parola PowerShell
  geçmişine (`ConsoleHost_history.txt`) düşer ve orada kalır. `(Read-Host ...)`
  bunu kapatır.
- **`-PostgresParola` GEREKMİYOR:** `[3/8]` önce bağlanmayı dener; veritabanı
  zaten var ve parola doğruysa hiçbir şey yaratmaz.
- **`-Dump` GEREKMİYOR:** veriyi siz zaten kopyaladınız.
- `[8/8]`'de **"uygulanmis migration: \<sayı\>"** görmelisiniz. **"veritabani BOS"
  yazıyorsa yanlış veritabanına bağlandınız — DURUN.**

### 3) Yapılandırmayı kurulumdan ÖNCE koy

```powershell
Copy-Item .\ecosystem.fabrika.js C:\TeksERP\app\ecosystem.config.js
# ⚠️ GEÇERSİZ → 2026-09-07: `ecosystem.fabrika.js` SİLİNDİ (pakete giren
#    `Teks-Erp/ecosystem.config.js` ile yorumlar hariç aynıydı, yalnız pm2 adı
#    ayrışmıştı). Ad artık `kur.ps1 -UygulamaAdi`dan geliyor; bu satır o günün
#    kaydıdır, bugün UYGULANMAZ.
```

`kur.ps1 [5/9]` "sunucunun `ecosystem.config.js`'i KORUNUR" kuralını uygular.
Şablondan tek farkı **pm2 adı** (`tekserp-backend-yeni`):

⚠️ `kur.ps1 [4/9]` `pm2 delete <ad>` yapıyor. Aynı adı kullansaydık **eski
kurulumun pm2 kaydını silerdi** ve geri dönüş için elimizde duran hazır tanım yok
olurdu. Ad farklı olunca eski kayıt `stopped` olarak durur.

⚠️ `pm2 delete` adı **`-UygulamaAdi`**'ndan, `pm2 start ecosystem.config.js` ise
**bu dosyadan** okur → 5. adımda aynı adı yazmak zorunlu.

### 4) ⚠️ ESKİ API'Yİ DURDUR — ve gerçekten sustuğunu doğrula

**Bu adım 5'ten ÖNCE gelmek zorunda.** Port doluyken kurulum `EADDRINUSE` ile
düşer ve `kur.ps1 [9/9]` 4000'i sorgulayıp **eski API'yi** bulur, sürüm
karşılaştırması olmadığı için **"KURULUM TAMAM — surum \<eski\>"** der.
Sessiz yalancı yeşil.

```powershell
$env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"
C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd list          # once GOR
C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd stop tekserp-backend
```

```powershell
curl http://localhost:4000/health      # CEVAP GELMEMELI
Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
```

⚠️ **Hâlâ cevap veriyorsa durun.** Servis pm2 dışında bir şeyle de ayakta olabilir
(eski kurulumlarda NSSM Windows servisi kullanılıyordu). Kimin dinlediğini bulun:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess } | Format-List Name,Id,Path
Get-Service | Where-Object { $_.Name -match "teks|erp" } | Format-Table Name,Status
```

⚠️ **Bu andan itibaren fabrika kapalıdır.** Kalan adımlar kesintisiz ilerlemeli.

### 5) Sürümü kur

```powershell
.\kur.ps1 -Kok C:\TeksERP `
          -Paket "C:\...\tekserp-backend-<damga>.zip" `
          -UygulamaAdi tekserp-backend-yeni
```

Beklenen kritik satırlar:

```
[1/9]  OK dosya sayisi beyanla uyusuyor
       OK paket saglam (<N> migration klasoru)
[3/9]  OK premigrate_<damga>.dump (... MB) - dogrulandi
[5/9]  OK .env + ecosystem.config.js (SUNUCUNUNKI) tasindi
[7/9]  Migration'lar uygulaniyor  (GERI ALINAMAZ ESIK)
[9/9]  Saglik kontrolu (port 4000)
```

⚠️ `[3/9]` yedeği alamazsa kurulum iptal olur — doğru davranış, zorlamayın.
⚠️ `[7/9]` geri alınamaz eşik; sonrasındaki hatada script otomatik geri almaz.
⚠️ `app\` üzerinde açık terminal / Explorer / editör bırakmayın — dosya kilidi
taşımayı düşürür.

### 6) Doğrula

```powershell
curl http://localhost:4000/health      # surum YENI olmali - eskiyle KARSILASTIRIN
```

⚠️ Sürüm eskisiyle aynı çıkıyorsa 4. adım tam olmamıştır (eski süreç hâlâ
ayakta) — **devam etmeyin.**

### 7) Eski pm2 kaydını temizle

```powershell
$env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"
C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd delete tekserp-backend
C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd save
```

⚠️ **Neden gerekli:** iki pm2 kaydı da 4000'i istiyor. Sunucu yeniden başlarsa
ikisi birden ayağa kalkmaya çalışır; biri portu alır, diğeri restart döngüsüne
girer ve **hangisinin kazandığı belli olmaz.** Kayıt silinse de geri dönüş
kaybolmaz — eski `ecosystem.config.js` yerinde duruyor (aşağıya bakın).

⚠️ pm2 komutlarını **hep aynı yükseltme seviyesinden** verin; yönetici daemon +
yetkisiz istemci `EPERM` verir ve bu "uygulama yok" gibi okunur.

---

## Satıcı (süperadmin) hesabı

Kopya veritabanında bu hesap büyük ihtimalle yok:

```powershell
cd C:\TeksERP\app
npm run superadmin:kur
```

⚠️ **Gerçek terminal ister** — sunucunun kendi konsolu ya da `ssh -t`. Boru /
otomasyon içinde gürültülü hata verip çıkar. Parola/PIN/TOTP **bir kez**
gösterilir; kaydedin.

---

## İstemciler — bu turda ELDEN kurulum ZORUNLU

⚠️ Sahadaki paneller ve tabletler **kendini güncelleme yeteneği taşımıyor**
(o özellik bu sürümlerle geliyor). Bu yüzden **bir kereye mahsus** elden
kurulum gerekiyor:

- **Panel:** `istemciler/TeksERP-1.2.7-Setup.exe`
- **Tablet:** `istemciler/TeksERP-1.0.0-vc57.apk`

Ayrıntı, doğrulama kayıtları ve sürüm numarası kafa karışıklığı:
**`istemciler/OKU.md`**.

Bundan **sonraki** turlarda elden dağıtım yok — ikisi de internetten kendi
indirir.

⚠️ **Sıra: backend ÖNCE.** Yeni panel yeni uçları çağırıyor; eski backend'de o
uçlar yok ve panel 404 alır.

Adres ayarı **gerekmiyor**: sunucu yine `:4000`'de, ağa ilan açık, gömülü
adresler doğru.

---

## Geri dönüş

Eski kod ve **eski veritabanı** hiç değişmedi — geri dönüş hızlı:

```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd stop tekserp-backend-yeni

$env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"
cd C:\Etkili-Yazilim\app
C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd start ecosystem.config.js
C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd save
curl http://localhost:4000/health
```

⚠️ **Ne kadar geç dönerseniz o kadar pahalı:** yeni sürümde `tekserp_yeni`'ye
yazılan işler eski veritabanında **yoktur**. Dönüş kararını erken verin.

⚠️ Elden kurduğunuz panel/tablet eski backend'e bağlanınca **yeni uçlarda 404**
alır. Kısa dönüşlerde sorun değil; kalıcı dönüşte istemcileri de geri almak
gerekir.

Kurulumun kendisi bozulduysa:
```powershell
C:\TeksERP\kur.ps1 -Kok C:\TeksERP -GeriAl
```
⚠️ Migration'lar geri ALINMAZ. Şema uyumsuzluğunda veritabanı `[3/9]`'daki
yedekten geri yüklenir: `C:\TeksERP\backups\premigrate_<damga>.dump`

---

## ⚠️ Geçiş günü unutulmayacak: gece yedeği hâlâ ESKİ veritabanını alıyor

Sahada gece yedeğini backend değil bağımsız bir Windows Görev Zamanlayıcı görevi
alıyor (`TeksERP-DB-Backup` → `C:\Etkili-Yazilim\yedekle.ps1`, 02:00). O script
**veritabanı adını kendi içinde taşır** ve `tekserp_yeni`'yi bilmez.
Güncellenmezse **canlı veritabanının gece yedeği alınmaz — ve bu sessizdir.**

---

## Bu sürümde ne var

Backend **2.9.3**, 232 migration. Sevk belgesinde **müşterideki ürün adı**
(bayrağa bağlı: bizdeki / müşterideki / ikisi — **varsayılan "bizdeki" = bugünkü
çıktı**; açmak `Sistem → Özellik Anahtarları → Sevkiyat & İade`'den bilinçli bir
hamle) · belge kolon başlıkları düzenlenebilir (`Tanımlar → Çıktılar → Belge
Şablonları → Belge Alanları`) · çuval izleri · `Sistem → Bağlı İstemciler`
ekranı · panel 1.2.7 · tablet 1.0.6.

Operatöre gösterilen tam liste güncelleme sonrası panelde açılır.
