# İki backend'i YAN YANA koşturma (geçiş provası)

> ⚠️ **Bayatlık notu (anlama turu 2026-09-05):** Bu belge ile `docs/ops/FABRIKA-KURULUM-2026-09-04.md` aynı işi farklı portlarla anlatıyor; fabrikanın kanonik yolu FABRIKA-KURULUM'dur. Bu dosya yan-yana (eski+yeni birlikte) senaryosunun referansıdır.

> Amaç: yeni sürümü fabrikada **eskisini durdurmadan** ayağa kaldırıp denemek.
> Hata çıkarsa eski sürüm zaten çalışıyor; geri dönüş bir `pm2` komutu.

---

## Dört şey BİRDEN ayrılmalı

Birini atlarsanız arıza **sessizdir** — hata vermez, log'a düşmez.

| # | Ayrılacak | Atlanırsa ne olur |
|---|---|---|
| 1 | **Port** | İkinci kurulum başlamaz (`EADDRINUSE`) — bu gürültülü, en zararsızı |
| 2 | **pm2 uygulama adı** | `kur.ps1 [4/9]` `pm2 delete <ad>` yapıyor → ikinci kurulum **birincisini pm2'den siler**, eski sürüm sessizce durur |
| 3 | **Veritabanı** | Tek-process invariantı kırılır: arşiv/yedek zamanlayıcıları ve feature-flag önbelleği process-local durum tutar → **çift arşiv, çift gece yedeği**, parçalanmış presence |
| 4 | **Ağa ilan (mDNS)** | İkinci backend de kendini `_teks-erp._tcp` olarak ilan eder → **otomatik bulma yapan panel/tablet test veritabanına bağlanabilir.** Kimlik uyarısı da gelmez; aşağıdaki kutuya bak |

⚠️ 3. madde `ecosystem.config.js`'de yazılı ve pazarlık dışı. Aynı veritabanına
iki backend bağlamak istiyorsanız ikincisinin zamanlayıcılarını kapatmanız
gerekir; **ayrı veritabanı çok daha temizdir.**

---

## Kurulum

```powershell
# 1) Yeni kök için iskelet + veritabanı
#    ⚠ -PgBin: otomatik arama YALNIZ C:\Program Files\PostgreSQL altına bakar.
#      PostgreSQL başka yerdeyse (örn. eski API'nin klasörünün içinde) bulunamaz.
.\ilk-kurulum.ps1 -Kok C:\TeksERP `
                  -DbAdi tekserp_yeni `
                  -DbParola (Read-Host "DB parolasi") `
                  -PgBin "<pg_dump.exe'nin bulundugu bin klasoru>"
#    (Veritabanı zaten VARSA -PostgresParola ve -Dump gerekmez: [3/8] önce
#     bağlanmayı dener, başarırsa hiçbir şey yaratmaz.)

# 2) ⚠ ADIM KALKTI (2026-09-07) — elle yapılandırma kopyalamak GEREKMİYOR.
#    Eskiden ikinci kurulum için ayrı bir `ecosystem` dosyası kopyalanıyordu
#    (`ecosystem.yan-yana.js` hiç var olmadı, `ecosystem.fabrika.js` ise pakete
#    GİRMEYEN bir kopyaydı ve paketlenen dosyadan ayrışmıştı). pm2 uygulama adı
#    artık `-UygulamaAdi`dan geliyor; PORT ayrımı için `app\ecosystem.config.js`
#    içindeki `PORT` satırı kurulum SONRASI düzenlenir ve `pm2 restart` edilir.

# 3) Sürümü kur
.\kur.ps1 -Kok C:\TeksERP `
          -Paket "C:\...\tekserp-backend-....zip" `
          -UygulamaAdi tekserp-backend-yeni
```

### ⚠ 2. adım neden kurulumdan ÖNCE (eski "kur → düşsün → düzelt" tarifi YANLIŞTI)

`kur.ps1 [5/9]` sunucunun mevcut `ecosystem.config.js`'ini **KORUR** ve paketinkini
`.paket` uzantısıyla yanına bırakır. Dosyayı önceden koyarsak port, ilan ve pm2
adı **baştan doğru** olur.

Koymazsak paketinki gelir (`PORT: "4000"`) ve şu zincir işler:

1. yeni kurulum 4000'i almaya çalışır → `EADDRINUSE`, düşer
2. `[9/9]` sağlık kontrolü `ecosystem.config.js`ten portu okur → **4000**
3. 4000'e cevabı **ESKİ API** verir → `status: UP, db: UP`
4. script **"KURULUM TAMAM — surum \<eski\>"** der

Sürüm paketinkiyle karşılaştırılmıyor → **sessiz yalancı yeşil**: hiç başlamamış
bir kurulum başarılı raporlanır. `[9/9]` satırındaki port yazısı bu yüzden
okunması gereken tek satırdır.

### ⚠ Aynı veritabanının KOPYASI ile kuruyorsanız: kimlik uyarısı SESSİZ kalır

Kurulum kimliği (`installationId`) `SystemSetting` satırında, yani **veritabanında**
durur. Yeni veritabanı canlının kopyasıysa **aynı kimliği taşır** ve istemcinin
"bu senin sunucun değil" uyarısı hiç tetiklenmez — iki sunucu panele birebir aynı
görünür.

Bu yüzden **ilan (`DISCOVERY_MDNS_ENABLED: "false"`) kapatılır**: otomatik bulmayı
devre dışı bırakmak, kimlik korumasının çalışmadığı bu durumda tek gerçek settir.
Ayırt edici olarak geriye **port ve sürüm numarası** kalır.

## Doğrulama

```powershell
curl http://localhost:4000/health    # ESKİ  — çalışmaya devam ediyor
curl http://localhost:4100/health    # YENİ  — surum yeni olmalı
```

İkisi de `UP` dönmeli ve **sürümleri farklı** olmalı. Aynıysa aynı kurulumu iki
kez sorguluyorsunuzdur.

```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home"; pm2 list
$env:PM2_HOME = "C:\TeksERP\pm2-home";        pm2 list   # tekserp-backend-yeni
```

⚠️ **Windows'ta `PM2_HOME` süreçleri AYIRMAZ** — daemon tek pipe kullanır
(`\\.\pipe\rpc.sock`). Ayrılan yalnız `dump.pm2` ve log konumudur; `pm2 list`
ikisini de gösterebilir. Bu yüzden **isim ayrımı** (2. madde) daha da kritik.
Ayrıca iki kökün pm2 komutları **aynı yükseltme seviyesinden** verilmelidir;
yönetici daemon + yetkisiz istemci = `EPERM` ve bu "uygulama yok" gibi okunur.

---

## İstemciler

Paneller ve tabletler **`:4000`'i arar** — yani kendiliğinden eski sürüme bağlanır.
Yeni sürümü denemek için tek bir cihazın adresini elle verin:

- **Panel:** Sistem → Bu Bilgisayar → Sunucu Adresi → `http://<sunucu-ip>:4100`
- **Tablet:** giriş ekranı → ayar düğmesi → `http://<sunucu-ip>:4100`

⚠️ Keşif (otomatik bulma) yalnız 4000'i bulur — çünkü yeni kurulumda ilanı
BİLEREK kapattık (yukarıdaki 4. madde). 4100 için adres **elle** girilir ve
bu bir eksiklik değil, koruma: otomatik bulma açık olsaydı rastgele bir
cihaz test veritabanına bağlanabilirdi.

---

## Geçiş ve geri dönüş

```powershell
# GEÇİŞ: eskiyi durdur, yeniyi 4000'e al
pm2 stop tekserp-backend
notepad C:\TeksERP\app\ecosystem.config.js     # PORT: "4000"
pm2 delete tekserp-backend-yeni ; cd C:\TeksERP\app ; pm2 start ecosystem.config.js ; pm2 save

# GERİ DÖNÜŞ: simetrik
pm2 stop tekserp-backend-yeni
cd <ESKI-KOK>\app ; pm2 start ecosystem.config.js ; pm2 save
```

⚠️ **Veri geri gelmez.** İki kurulum AYRI veritabanı kullandığı için yeni sürümde
geçen sürede yapılan işler eski veritabanında YOKTUR. Geçiş kararını verirken
"hangi veritabanı gerçek" sorusunun tek bir cevabı olmalı; iki tarafta da iş
yapılmışsa birleştirme elle ve pahalıdır.

⚠️ Eski kurulum kendi kökünde **olduğu gibi durur** — silinmez.
