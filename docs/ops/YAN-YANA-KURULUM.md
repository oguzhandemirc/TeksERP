# İki backend'i YAN YANA koşturma (geçiş provası)

> Amaç: yeni sürümü fabrikada **eskisini durdurmadan** ayağa kaldırıp denemek.
> Hata çıkarsa eski sürüm zaten çalışıyor; geri dönüş bir `pm2` komutu.

---

## Üç şey BİRDEN ayrılmalı

Birini atlarsanız arıza **sessizdir** — hata vermez, log'a düşmez.

| # | Ayrılacak | Atlanırsa ne olur |
|---|---|---|
| 1 | **Port** | İkinci kurulum başlamaz (`EADDRINUSE`) — bu gürültülü, en zararsızı |
| 2 | **pm2 uygulama adı** | `kur.ps1 [4/9]` `pm2 delete <ad>` yapıyor → ikinci kurulum **birincisini pm2'den siler**, eski sürüm sessizce durur |
| 3 | **Veritabanı** | Tek-process invariantı kırılır: arşiv/yedek zamanlayıcıları ve feature-flag önbelleği process-local durum tutar → **çift arşiv, çift gece yedeği**, parçalanmış presence |

⚠️ 3. madde `ecosystem.config.js`'de yazılı ve pazarlık dışı. Aynı veritabanına
iki backend bağlamak istiyorsanız ikincisinin zamanlayıcılarını kapatmanız
gerekir; **ayrı veritabanı çok daha temizdir.**

---

## Kurulum

```powershell
# 1) Yeni kök için iskelet + veritabanı (fabrika yedeğinin KOPYASI)
.\ilk-kurulum.ps1 -Kok C:\TeksERP `
                  -DbAdi tekserp_yeni `
                  -DbParola <app-parolasi> `
                  -PostgresParola <postgres-parolasi> `
                  -Dump "C:\...\son-yedek.dump"

# 2) Portu değiştir — C:\TeksERP\app\ecosystem.config.js
#    (henüz yok; 3. adımdan sonra düzenlenecek. Sıra aşağıda.)

# 3) Sürümü kur — pm2 adı FARKLI olmak zorunda
.\kur.ps1 -Kok C:\TeksERP `
          -Paket "C:\...\tekserp-backend-....zip" `
          -UygulamaAdi tekserp-backend-yeni
```

⚠️ **Sıra tuzağı:** `ecosystem.config.js` ilk kurulumda paketten gelir, yani
`kur.ps1`ten SONRA düzenlenir. Adımlar:

```powershell
# kur.ps1 bitti, yeni kurulum :4000'i almaya çalışacak ve DÜŞECEK — normal.
# Portu düzelt:
notepad C:\TeksERP\app\ecosystem.config.js     # env.PORT: "4100"

# pm2'yi yeniden kaldır (YÖNETİCİ kabuk)
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd delete tekserp-backend-yeni
cd C:\TeksERP\app
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd start ecosystem.config.js
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd save
```

⚠️ `kur.ps1` sağlık kontrolünü artık `ecosystem.config.js`teki **gerçek porttan**
okur; port 4100 ise 4100'ü sorgular. (Eskiden 4000'e sabitti ve ikinci kurulumda
YANLIŞ backend'i sorgulayıp "başarılı" diyordu.)

---

## Doğrulama

```powershell
curl http://localhost:4000/health    # ESKİ  — çalışmaya devam ediyor
curl http://localhost:4100/health    # YENİ  — surum yeni olmalı
```

İkisi de `UP` dönmeli ve **sürümleri farklı** olmalı. Aynıysa aynı kurulumu iki
kez sorguluyorsunuzdur.

```powershell
$env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"; pm2 list   # tekserp-backend
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

⚠️ Keşif (otomatik bulma) 4000'i bulur; 4100 için adres **elle** girilir.

---

## Geçiş ve geri dönüş

```powershell
# GEÇİŞ: eskiyi durdur, yeniyi 4000'e al
pm2 stop tekserp-backend
notepad C:\TeksERP\app\ecosystem.config.js     # PORT: "4000"
pm2 delete tekserp-backend-yeni ; cd C:\TeksERP\app ; pm2 start ecosystem.config.js ; pm2 save

# GERİ DÖNÜŞ: simetrik
pm2 stop tekserp-backend-yeni
cd C:\Etkili-Yazilim\app ; pm2 start ecosystem.config.js ; pm2 save
```

⚠️ **Veri geri gelmez.** İki kurulum AYRI veritabanı kullandığı için yeni sürümde
geçen sürede yapılan işler eski veritabanında YOKTUR. Geçiş kararını verirken
"hangi veritabanı gerçek" sorusunun tek bir cevabı olmalı; iki tarafta da iş
yapılmışsa birleştirme elle ve pahalıdır.

⚠️ Eski kurulum `C:\Etkili-Yazilim`de **olduğu gibi durur** — silinmez.
