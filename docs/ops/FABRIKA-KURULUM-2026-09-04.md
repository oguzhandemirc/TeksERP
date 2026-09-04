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
| `SUNUCU-CLAUDE-DEVIR-2026-09-04.md` | Sunucuda Claude oturumu açılacaksa **ona ilk okutulacak** dosya |

| `istemciler/` | **Yalnız sıfırdan kurulum için** — panel setup + tablet APK. Sahadakiler bunlara ihtiyaç duymaz, kendileri güncellenir. `istemciler/OKU.md`'ye bakın |
| `olcum-musteri-adi.sql` | İsteğe bağlı — "müşterideki ürün adı" kapsam ölçümü (**salt okunur**): `psql -U tekserp -d tekserp_yeni -f olcum-musteri-adi.sql` |

Bu klasörde başka doküman **bilerek yok**: sıfırdan-fabrika-kurma runbook'u ve
yan-yana modelin genel referansı bu işle çelişen adımlar içeriyordu (farklı port,
farklı kök, farklı iş) ve kaldırıldı. İhtiyacınız olan her şey bu dosyada.

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
| ağa ilan | **açık** (varsayılan) | test cihazı yeni sürümü otomatik bulamaz, adres elle girilir |
| `name` | `tekserp-backend-yeni` | `kur.ps1 [4/9]` `pm2 delete <ad>` ile **eski kurulumu pm2'den siler** — fabrika sessizce kapanır |

> ### ⚠️ Test sırasında keşifte İKİ sunucu çıkacak — ayırt edici PORT ve SÜRÜM
>
> Ağa ilan (`_teks-erp._tcp`) **açık bırakıldı**, bilinçli: test cihazı yeni
> sürümü otomatik bulsun, kimse elle adres girmek zorunda kalmasın. mDNS portu
> **ilanın içinde** taşır, o yüzden `:5000` otomatik bulunur.
>
> ⚠️ **Bedeli:** yeni veritabanı canlının kopyası olduğu için **aynı
> `installationId`'yi taşıyor** → panelin "bu senin sunucun değil" uyarısı
> **tetiklenmez.** Yani iki sunucu birbirinden yalnız şuradan ayrılır:
>
> ```
> 192.168.1.250:4000 · v<eski>     <- ESKI, fabrika buna bagli
> 192.168.1.250:5000 · v2.9.3      <- YENI, test
> ```
>
> Panel adayları zaten `host:port · vSürüm` diye basıyor. **Test edeceğiniz
> cihazda 5000/2.9.3 olanı seçin; diğer cihazlara dokunmayın.**
>
> ⚠️ Alt ağ taraması (mDNS çalışmazsa devreye giren yedek yol) portu **sabit
> 4000** dener → `:5000`'i YALNIZ mDNS bulur. Test cihazı yeni sürümü
> göremiyorsa önce mDNS'in çalıştığını doğrulayın:
> `GET /api/admin/health` → `discovery.mdns.reason === "ok"`.
> (UDP 5353 gelen kuralı yoksa ya da portu Bonjour/Adobe tutuyorsa ilan sessizce
> kapanır.) Çare olarak adres elle girilebilir: `192.168.1.250:5000`.

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

⚠️ Keşifte **iki aday** çıkar (`:4000 · v<eski>` ve `:5000 · v2.9.3`) — sürüme
bakıp 5000 olanı seçin. Kimlik uyarısı çıkmaz, ikisi aynı kurulum kimliğini
taşıyor.

> ### ⚠️ Bu testte girdiğiniz her kayıt YARIN CANLI VERİ OLACAK
> Karar `tekserp_yeni`'yi üretime almak yönünde. Deneme amaçlı açtığınız
> sipariş / iş emri / çuval **silinmezse canlıda kalır.** Ya okuma ağırlıklı
> test edin, ya da açtığınız kayıtları test bitince iptal edin.

---

## Yarın — geçiş

> ### ⚠️ ÖNCE ÖLÇ: eski API NASIL koşuyor?
> Bu notun `pm2 stop tekserp-backend` satırı bir **varsayımdır**. Backend eskiden
> NSSM ile Windows servisi olarak koşuyordu; sahadaki kurulum o dönemden kalma
> olabilir. Yanlış aracı kullanmak "durdurdum" sanıp fabrikayı ayakta bırakır
> (iki backend, iki veritabanı, sessiz veri bölünmesi).
>
> ```powershell
> # 4000'i kim dinliyor, hangi süreç?
> Get-NetTCPConnection -LocalPort 4000 -State Listen |
>   ForEach-Object { Get-Process -Id $_.OwningProcess } | Format-List Name,Id,Path
>
> # pm2 mi?
> $env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"
> C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd list
>
> # Windows servisi mi (NSSM)?
> Get-Service | Where-Object { $_.Name -match "teks|erp" } | Format-Table Name,Status
> ```
>
> Çıkan sonuca göre durdurma komutu değişir: pm2 ise aşağıdaki satır, servis ise
> `Stop-Service <ad>`. **Durdurduktan sonra `curl http://localhost:4000/health`
> ile GERÇEKTEN sustuğunu doğrulayın.**

```powershell
$env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"
pm2 stop tekserp-backend                       # ESKIYI DURDUR (pm2 ise)

notepad C:\TeksERP\app\ecosystem.config.js     # PORT: "5000" -> "4000"

$env:PM2_HOME = "C:\TeksERP\pm2-home"
cd C:\TeksERP\app
pm2 delete tekserp-backend-yeni
pm2 start ecosystem.config.js
pm2 save                                       # reboot'ta geri gelsin
curl http://localhost:4000/health              # surum YENI olmali
```

Geçişte ilanla ilgili yapılacak bir şey yok — zaten açık. Değişen tek şey port:
yeni kurulum artık tek sunucu ve `:4000`'i ilan ediyor, yani keşif listesinde tek
aday kalıyor.

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

**Sıfırdan kurulum gerekiyorsa** (yeni bilgisayar / yeni tablet): `istemciler/`
klasöründe doğrulanmış setup ve APK var — ayrıntı `istemciler/OKU.md`.

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
