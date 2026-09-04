# Fabrika sunucusu — yeni sürümü YAN YANA kur (2026-09-04 akşamı)

> **Bu bir yerinde yükseltme DEĞİL.** `C:\Etkili-Yazilim` altındaki çalışan
> kuruluma **hiç dokunulmaz**. Yeni sürüm ayrı bir köke, ayrı bir porta ve ayrı
> bir veritabanına kurulur; iki backend bir saat yan yana koşar.

## Sahadaki durum (bu notun dayandığı gerçek)

| | |
|---|---|
| Eski API | `:4000`, çalışıyor — **dokunulmayacak** |
| PostgreSQL | **eski API'nin klasörünün içinde** (Program Files'ta DEĞİL), `:5432` |
| Yeni veritabanı | `tekserp_yeni` — canlının bu akşamki kopyası, **zaten oluşturuldu** |
| Yeni kök | `C:\TeksERP` |
| Yeni port | **5000** |
| pm2 adı | `tekserp-backend-yeni` |

**Yarınki karar (verildi):** eski API kapatılıp **`tekserp_yeni` canlı olarak**
devam edecek. Bunun iki sonucu var, ikisi de aşağıda "Yarın" bölümünde.

---

## Gönderilecek dosyalar

| Dosya | Ne için |
|---|---|
| `tekserp-backend-<damga>.zip` | Sürüm paketi |
| `kur.ps1` | Kurulum aracı. ⚠️ **Pakette GELMEZ**, elden taşınır |
| `ilk-kurulum.ps1` | Yeni kök için iskelet (klasör + pm2 + `.env`) |
| `ecosystem.yan-yana.js` | **Hazır yapılandırma** — port 5000 + ilan kapalı + ayrı pm2 adı |
| `FABRIKA-KURULUM-2026-09-04.md` | Bu dosya |

Yalnız bir şey ters giderse: `KURULUM.md` (tam referans) ·
`YAN-YANA-KURULUM.md` (yan yana modelin gerekçeleri).

---

## Kurulum — beş adım

Hepsi **YÖNETİCİ PowerShell**'de.

### 1) PostgreSQL araçlarının yerini bul

⚠️ **Bu adım atlanamaz.** `ilk-kurulum.ps1` otomatik aramayı yalnız
`C:\Program Files\PostgreSQL` altında yapar. Sahadaki PostgreSQL **eski API'nin
klasörünün içinde** olduğu için **bulunamayacak** ve script "PostgreSQL
bulunamadi" diyip duracak. Yolu elle vereceğiz:

```powershell
# pg_dump.exe'yi bul (birkaç saniye sürebilir)
Get-ChildItem C:\ -Recurse -Filter pg_dump.exe -ErrorAction SilentlyContinue |
  Select-Object -First 5 FullName
```

Çıkan yolun **`\bin` kısmı** `-PgBin` değeridir, örn.
`C:\Etkili-Yazilim\pgsql\bin` ya da `C:\<eski-api>\pgsql\bin`.

### 2) Yeni kök için iskelet

```powershell
.\ilk-kurulum.ps1 -Kok C:\TeksERP `
                  -DbAdi tekserp_yeni `
                  -DbKullanici tekserp `
                  -DbParola (Read-Host "DB parolasi") `
                  -PgBin "<1. adimda bulunan bin yolu>"
```

- ⚠️ **`-DbParola` düz yazılmaz** — komut satırına yazılan parola PowerShell
  geçmişine (`ConsoleHost_history.txt`) düşer ve orada kalıcı durur.
  `(Read-Host ...)` kalıbı bunu kapatır.
- **`-PostgresParola` GEREKMİYOR.** `[3/8]` önce bağlanmayı dener; `tekserp_yeni`
  zaten var ve parola doğruysa hiçbir şey yaratmaz, sadece "olusturmaya gerek
  yok" der. Yönetici parolası yalnız *yaratması* gerekseydi istenirdi.
- **`-Dump` GEREKMİYOR.** Veriyi siz zaten kopyaladınız.
- `[8/8]`'de **"uygulanmis migration: <sayı>"** görmelisiniz. "veritabani BOS"
  yazıyorsa yanlış veritabanına bağlanmışsınızdır — durun.

### 3) ⚠️ Yapılandırmayı kurulumdan ÖNCE koy

```powershell
Copy-Item .\ecosystem.yan-yana.js C:\TeksERP\app\ecosystem.config.js
```

**Bu adım load-bearing.** `kur.ps1 [5/9]` "sunucunun `ecosystem.config.js`'i
KORUNUR" kuralını uygular — dosyayı önceden koyarsak port/ilan/pm2-adı baştan
doğru olur. Koymazsak paketinki gelir (**PORT 4000**) ve şu zincir işler:

1. yeni kurulum 4000'i almaya çalışır, `EADDRINUSE` ile düşer
2. `kur.ps1 [9/9]` sağlık kontrolünü 4000'e sorar
3. cevabı **ESKİ API** verir
4. script **"KURULUM TAMAM — surum \<eski\>"** der

Sürüm karşılaştırması yapılmıyor, yani bu **sessiz yalancı yeşil**.

Hazır dosyanın şablondan üç farkı var, üçü de bilinçli:

| | Değer | Atlanırsa |
|---|---|---|
| `PORT` | `5000` | yukarıdaki yalancı yeşil |
| `DISCOVERY_MDNS_ENABLED` | `"false"` | aşağıdaki kutu |
| `name` | `tekserp-backend-yeni` | `kur.ps1 [4/9]` `pm2 delete <ad>` ile **eski kurulumu pm2'den siler** — fabrika sessizce kapanır |

> ### ⚠️ Ağa ilan neden kapatılıyor — ve "farklı sunucu" uyarısı neden gelmeyecek
>
> Servis ilanı (`_teks-erp._tcp`) **varsayılan olarak açık**. Açık kalırsa yeni
> backend de kendini ağa ilan eder ve **otomatik bulma yapan bir panel ya da
> tablet kopya veritabanına bağlanabilir.**
>
> Normalde bunu "bu senin sunucun değil" uyarısı yakalar. **Burada yakalamaz:**
> kurulum kimliği (`installationId`) veritabanında duruyor ve `tekserp_yeni`
> canlının kopyası olduğu için **aynı kimliği taşıyor**. İki sunucu istemciye
> birebir aynı görünür.
>
> **Yani iki kurulumu ayırt eden tek şey port ve sürüm numarasıdır.** Bir ekranda
> hangi veritabanına baktığınızdan emin değilseniz `/health`'in sürümüne bakın.

### 4) Sürümü kur

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
[9/9]  Saglik kontrolu (port 5000)          <-- 5000 YAZMALI
```

⚠️ `[9/9]` satırında **4000 yazıyorsa 3. adım atlanmıştır** — durun, kurulum
kendini doğrulayamaz.

⚠️ `[3/9]` yedeği alamazsa kurulum iptal olur — doğru davranış, zorlamayın.

⚠️ `[7/9]` geri alınamaz eşik. Sonrasındaki hatada script otomatik geri almaz;
komutları yazar, kararı insan verir.

⚠️ `app\` üzerinde **açık terminal / Explorer / editör bırakmayın** — dosya
kilidi taşımayı düşürür.

### 5) Doğrula

```powershell
curl http://localhost:4000/health    # ESKI  - calisiyor olmali, surum eski
curl http://localhost:5000/health    # YENI  - surum yeni olmali
```

⚠️ **Sürümler farklı olmalı.** Aynıysa aynı backend'i iki kez sorguluyorsunuz.

```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd list    # tekserp-backend-yeni: online
```

⚠️ Windows'ta `PM2_HOME` süreçleri **ayırmaz** (tek pipe) — liste ikisini de
gösterebilir. Ayıran şey isimdir. pm2 komutlarını hep **aynı yükseltme
seviyesinden** verin; yönetici daemon + yetkisiz istemci `EPERM` verir ve bu
"uygulama yok" gibi okunur.

---

## Satıcı (süperadmin) hesabı

Kopya veritabanında böyle bir hesap büyük ihtimalle **yok** (eski sürüm bu
kavramı taşımıyordu):

```powershell
cd C:\TeksERP\app
npm run superadmin:kur
```

⚠️ **Gerçek terminal ister** — sunucunun kendi konsolu ya da `ssh -t`. Boru /
otomasyon içinde gürültülü hata verip çıkar. Parola/PIN/TOTP **bir kez**
gösterilir; kaydedin.

---

## Bir saatlik test

Paneller ve tabletler `:4000`'i arar, yani **kendiliğinden eski sürüme bağlanır**.
Yeni sürümü denemek için **tek bir cihazın** adresini elle verin:

- **Panel:** Sistem → Bu Bilgisayar → Sunucu Adresi → `http://<sunucu-ip>:5000`
- **Tablet:** giriş ekranı → ayar düğmesi → `http://<sunucu-ip>:5000`

⚠️ Otomatik bulma 5000'i **bulmaz** (ilanı kapattık, bilerek) — adres elle girilir.

> ### ⚠️ Bu testte girdiğiniz her kayıt YARIN CANLI VERİ OLACAK
> Karar `tekserp_yeni`'yi üretime almak yönünde. Deneme amaçlı açtığınız
> sipariş / iş emri / çuval **silinmezse canlıda kalır.** Ya okuma ağırlıklı
> test edin, ya da açtığınız kayıtları test bitince iptal edin.

---

## Yarın — geçiş

```powershell
$env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"
pm2 stop tekserp-backend                       # ESKIYI DURDUR

notepad C:\TeksERP\app\ecosystem.config.js     # PORT: "5000" -> "4000"
                                               # DISCOVERY_MDNS_ENABLED satirini SIL

$env:PM2_HOME = "C:\TeksERP\pm2-home"
cd C:\TeksERP\app
pm2 delete tekserp-backend-yeni
pm2 start ecosystem.config.js
pm2 save                                       # reboot'ta geri gelsin
curl http://localhost:4000/health              # surum YENI olmali
```

İlan satırının silinmesi gerekiyor: geçişten sonra **yeni kurulum artık tek
sunucu**, ağda görünmesi gerekiyor (yoksa yeni kurulan panel/tablet onu otomatik
bulamaz, adres elle girilir).

> ### ⚠️ KOPYA ALINDIKTAN SONRA ESKİ API'DE YAPILAN İŞ KAYBOLUR
> `tekserp_yeni`, **bu akşam mesai bitiminde** alınmış bir fotoğraftır. Eski API
> hâlâ ayakta ve hâlâ `:4000`'de, yani panellerin/tabletlerin bağlandığı yer.
> Bu gece ya da yarın sabah geçişten önce eski API üzerinde yapılan **her iş
> yeni veritabanında YOKTUR ve geri getirilemez** (iki ayrı veritabanı; elle
> birleştirme pahalı ve hataya açık).
>
> **Pencereyi kapatmanın iki yolu var:**
> 1. **Geçişi test biter bitmez bu akşam yap** (yukarıdaki blok) — pencere sıfır
>    olur. En temizi.
> 2. Yarına bırakacaksanız **eski API'yi test sonunda durdurun**
>    (`pm2 stop tekserp-backend`) ki kimse ona iş giremesin.

> ### ⚠️ Gece yedeği hâlâ ESKİ veritabanını alıyor
> Sahada gece yedeğini backend değil bağımsız bir Windows Görev Zamanlayıcı
> görevi alıyor (`TeksERP-DB-Backup` → `C:\Etkili-Yazilim\yedekle.ps1`, 02:00).
> O script **veritabanı adını kendi içinde taşır** ve `tekserp_yeni`'yi bilmez.
> Geçişten sonra içindeki DB adı güncellenmezse **canlı veritabanının gece
> yedeği alınmaz** — ve bu sessizdir. Geçiş günü yapılacaklar listesine yazın.

---

## İstemciler

Sunucudan sonra dağıtım gerekmez; ikisi de kendiliğinden gelir:

- **Panel 1.2.6** — yayında. Beklemeden: Sistem → Güncelleme → "Şimdi kontrol et"
- **Tablet 1.0.5 (OTA)** — yayında, açılışta ya da ~10 dk içinde. APK gerekmez.

⚠️ **Sıra: backend ÖNCE.** Yeni panel yeni uçları çağırıyor; eski backend'de o
uçlar yok ve panel 404 alır. Paneller güncellemeyi çoktan almış olabilir —
**geçişi geciktirmeyin.**

---

## Bir şey ters giderse

Yan yana kurulumun geri dönüşü zaten hazır: **eski kurulum `C:\Etkili-Yazilim`de
olduğu gibi duruyor ve çalışıyor.** Yeniyi durdurmak yeter:

```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home"; pm2 stop tekserp-backend-yeni
```

Geçişi yaptıktan sonra dönmek isterseniz simetrik:

```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home";        pm2 stop tekserp-backend-yeni
$env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"; cd C:\Etkili-Yazilim\app
pm2 start ecosystem.config.js ; pm2 save
```

⚠️ **Ama veri geri gelmez** — geçişten sonra yeni veritabanında yapılan işler
eskisinde yoktur. Dönüş kararı ne kadar geç verilirse o kadar pahalıdır.

Kurulumun kendisi bozulduysa (geçiş sonrası):

```powershell
C:\TeksERP\kur.ps1 -Kok C:\TeksERP -GeriAl
```

⚠️ Migration'lar geri ALINMAZ. Şema uyumsuzluğunda veritabanı `[3/9]`'daki
yedekten geri yüklenir: `C:\TeksERP\backups\premigrate_<damga>.dump`
