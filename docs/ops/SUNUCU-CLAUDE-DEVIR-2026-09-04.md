# OKU-ÖNCE — fabrika sunucusundaki Claude oturumu için devir notu

> Bu dosyayı okuyan sen, **fabrika sunucusunda** açılmış yeni bir Claude
> oturumusun. Bu işi planlayan oturumun bağlamı sende YOK. İhtiyacın olan her
> şey bu dosyada ve `FABRIKA-KURULUM-2026-09-04.md`'de.

## 0. Neredesin

**BURASI CANLI ÜRETİM.** Gerçek bir tekstil fabrikasının ERP sunucusu; gerçek
siparişler, gerçek stok, gerçek sevkiyat. Yanlış bir komut vardiyayı durdurur.

| | |
|---|---|
| Çalışan sistem | Eski API, **`:4000`** — fabrikanın bağlandığı yer |
| PostgreSQL | **Eski API'nin klasörünün İÇİNDE** (`C:\Program Files\PostgreSQL` DEĞİL), `:5432` |
| Kuracağın şey | Yeni sürüm — **ayrı kök** `C:\TeksERP`, **ayrı port 5000**, **ayrı veritabanı** |
| Yeni veritabanı | `tekserp_yeni` — canlının bu akşamki kopyası, **kullanıcı zaten oluşturdu** |
| Amaç | İki backend bir saat **yan yana** koşacak; geçiş kararı insanın |

Yapacağın şey bir **yükseltme değil**. Çalışan kuruluma dokunmadan, yanına
ikinci bir kurulum koyuyorsun.

---

## 1. Yasaklar — istisnasız

1. **`C:\Etkili-Yazilim` altında hiçbir şeyi değiştirme, silme, taşıma.**
   Orası çalışan sistem. Yalnız *okuyabilirsin*.
2. **Eski API'yi DURDURMA.** `pm2 stop/delete/restart tekserp-backend`,
   `Stop-Service`, süreç öldürme — hiçbiri. Durdurma kararı bu gece testten
   sonra **insanın** vereceği ayrı bir karar.
3. **Toplu süreç öldürme YASAK**: `taskkill /F /IM node.exe`,
   `Get-Process node | Stop-Process`, `pkill` benzeri hiçbir şey. Bu komutlar
   çalışan backend'i de öldürür ve hangisini öldürdüğünü söylemez.
4. **`prisma migrate reset` · reseed · toplu `DELETE`/`TRUNCATE` YASAK.**
   Migration'lar geri alınamaz kabul edilir.
5. **`kur.ps1 -Zorla` KULLANMA.** Script'in sorduğu onaylar insan içindir;
   çıktıyı kullanıcıya göster, cevabı ondan al.
6. **Parolayı hiçbir yere yazma** — ekrana basma, dosyaya kaydetme, komut
   satırına düz yazma. `(Read-Host "DB parolasi")` kalıbını kullan; düz yazılan
   parola PowerShell geçmişine kalıcı düşer.
7. **Panel/tablet yayını yapma** (`electron-yayinla`, `mobil-yayinla`). Bu
   makinede işin yok; yayın geliştirme makinesinden yapıldı.

---

## 2. Başlamadan önce doğrula

**a) Kabuk YÖNETİCİ mi?** `kur.ps1` yönetici olmayan kabukta durur ve sen
kendini yükseltemezsin. Değilse kullanıcıdan terminali **"Yönetici olarak
çalıştır"** ile yeniden açmasını iste.

```powershell
(New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

**b) Node 22+ var mı?** `node -v` — paket Node 22 tabanı bekliyor.

**c) İnternet var mı?** `ilk-kurulum.ps1 [7/8]` yeni kök için **pm2'yi npm ile
indirir**. İnternet yoksa orada durur (paketin geri kalanı internetsiz kurulur,
yalnız bu adım ister). Önce dene: `npm ping`.

**d) Eski API gerçekten `:4000`'de mi ve NASIL koşuyor?** Ölç, varsayma:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess } | Format-List Name,Id,Path
Get-Service | Where-Object { $_.Name -match "teks|erp" } | Format-Table Name,Status
```

Bu bilgi bu gece geçiş anında lazım olacak (pm2 mi, Windows servisi mi).
**Öğren ve kullanıcıya söyle** — ama durdurma.

**e) `:5000` boş mu?**

```powershell
Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
```
Doluysa dur ve kullanıcıya sor; portu kendi başına değiştirme.

---

## 3. Kurulum

`FABRIKA-KURULUM-2026-09-04.md`'deki **beş adımı sırayla** uygula. Sırayı
değiştirme; özellikle **3. adım (yapılandırmayı kurulumdan ÖNCE kopyalama)**
atlanamaz.

### Kullanıcıdan almak zorunda olduğun iki bilgi

1. **`tekserp_yeni` veritabanının parolası** — sende yok, sorman gerek.
2. **`-PgBin` yolu.** Otomatik arama yalnız `C:\Program Files\PostgreSQL`
   altına bakar; buradaki PostgreSQL orada değil. Bul, sonra **kullanıcıya
   doğrulat** (yanlış `bin` yanlış major sürüm demek olabilir; `pg_dump`
   sunucudan eski bir majorse çalışmayı reddeder):

```powershell
Get-ChildItem C:\ -Recurse -Filter pg_dump.exe -ErrorAction SilentlyContinue |
  Select-Object -First 5 FullName
```

### Nerede DURUP soracaksın

| Nokta | Neden |
|---|---|
| `[3/9]` yedek alınamazsa | Kurulum kendini iptal eder. **Zorlama.** Sebebini bildir. |
| `[7/9]` öncesi | **Geri alınamaz eşik.** Buraya gelmeden kullanıcıya "migration'lar uygulanacak" de ve onay al. |
| `[7/9]` sonrası herhangi bir hata | Script otomatik geri almaz, komutları yazar. **Sen de uygulama** — çıktıyı göster, kararı kullanıcı versin. |
| `[9/9]` portu **4000** yazıyorsa | 3. adım atlanmış. **Devam etme**, aşağıya bak. |

---

## 4. "Başarılı" nasıl görünür — ve yalancı yeşil nasıl görünür

**Doğru:**
```
[9/9] Saglik kontrolu (port 5000)        <- 5000 YAZMALI
      API UP / DB UP / surum 2.9.3
```
```powershell
curl http://localhost:4000/health    # ESKI - surum ESKI olmali
curl http://localhost:5000/health    # YENI - surum 2.9.3 olmali
```
⚠️ **İki sürüm FARKLI olmalı.** Aynıysa aynı backend'i iki kez sorguluyorsun.

**Yalancı yeşil (bunu tanı):** 3. adım atlanırsa paketin `ecosystem.config.js`'i
gelir (`PORT: "4000"`) → yeni kurulum `EADDRINUSE` ile düşer → `[9/9]` 4000'i
sorgular → cevabı **ESKİ API** verir → script **"KURULUM TAMAM — surum \<eski\>"**
der. Sürüm karşılaştırması yapılmıyor. Bu yüzden `[9/9]` satırındaki **port
yazısı** okunması gereken tek satırdır.

---

## 5. Kuruluma özgü iki sessizlik (bunları bil)

**a) İki sunucu istemciye BİREBİR AYNI görünür.** Kurulum kimliği
(`installationId`) veritabanında durur ve `tekserp_yeni` canlının kopyası olduğu
için **aynı kimliği taşır** → panelin "bu senin sunucun değil" uyarısı hiç
tetiklenmez. Ayırt edici yalnız **port ve sürüm numarası**.

**b) Ağ ilanı AÇIK — ve öyle kalmalı** (kullanıcı kararı). Test cihazı yeni
sürümü otomatik bulabilsin diye. mDNS portu ilanın içinde taşır, o yüzden
`:5000` bulunur; alt ağ taraması ise portu sabit 4000 dener, yani `:5000`'i
yalnız mDNS bulur.

⚠️ (a) ile birleşince sonuç şu: **keşif listesinde iki aday çıkar ve kimlik
uyarısı gelmez.** Ayırt edici port + sürüm (`:4000 · v<eski>` ↔
`:5000 · v2.9.3`) ve panel ikisini de basar. Kullanıcıya bunu söyle;
**cihaz ayarını sen değiştirme.**

## 6. Kurulumdan sonra

**Satıcı (süperadmin) hesabı** — kopya veritabanında büyük ihtimalle yok:

```powershell
cd C:\TeksERP\app
npm run superadmin:kur
```
⚠️ **GERÇEK TTY ister.** Senin çalıştırdığın boru/otomasyon içinde koşarsa
gürültülü hata verip çıkar (bilerek — eskiden sessizce sonsuza kadar donuyordu).
**Bunu sen koşturmaya çalışma**; kullanıcıya "sunucunun kendi konsolunda şu
komutu çalıştırın" de. Parola/PIN/TOTP bir kez gösterilir; **sen o çıktıyı
kaydetme, tekrarlama, loglamaya alma.**

**Bir saatlik test:** paneller/tabletler `:4000`'i arar, yani kendiliğinden eski
sürüme bağlanır. Yeni sürümü denemek için **tek bir cihazın** adresi elle
`http://<sunucu-ip>:5000` yapılır (Panel: Sistem → Bu Bilgisayar → Sunucu
Adresi). Bu bir insan işi — sen cihaz ayarı değiştirme.

⚠️ **Testte girilen her kayıt yarın canlı veri olacak** (karar `tekserp_yeni`'yi
üretime almak yönünde). Kullanıcıya hatırlat.

---

## 7. Ters giderse

Yan yana kurulumun güvenliği şu: **eski kurulum çalışmaya devam ediyor.**
Yenisi bozulursa fabrika etkilenmez. Yapılacak tek şey yeniyi durdurmak:

```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd stop tekserp-backend-yeni
```

Loglar:
```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd logs tekserp-backend-yeni --lines 80
```

⚠️ pm2 komutlarını **hep aynı yükseltme seviyesinden** ver; yönetici daemon +
yetkisiz istemci `EPERM` verir ve bu "uygulama yok" gibi okunur.

⚠️ Windows'ta `PM2_HOME` süreçleri **ayırmaz** (tek pipe) — `pm2 list` iki
kurulumu birden gösterebilir. Ayıran şey **isim**: `tekserp-backend` (eski,
DOKUNMA) ↔ `tekserp-backend-yeni` (senin kurduğun).

**`kur.ps1 -GeriAl`'ı kendi başına çalıştırma.** İlk kurulumda geri dönülecek
bir sürüm zaten yok; gerçekten gerekirse kullanıcıyla konuş.

---

## 8. Geçiş SENİN İŞİN DEĞİL

Eski API'yi kapatıp yeniyi 4000'e almak bu gece/yarın **insanın vereceği bir
karardır** ve geri dönüşü pahalıdır (iki ayrı veritabanı; kopya alındıktan sonra
eski API'de yapılan iş yeni veritabanında yoktur). Adımlar
`FABRIKA-KURULUM-2026-09-04.md` → "Yarın — geçiş" bölümünde. **Kullanıcı açıkça
söylemeden o bölüme geçme.**

Geçiş yapılırsa unutulmaması gereken iki şey (kullanıcıya hatırlat):
- Gece yedeğini alan bağımsız Görev Zamanlayıcı görevi (`yedekle.ps1`)
  **veritabanı adını kendi içinde taşıyor** ve `tekserp_yeni`'yi bilmez →
  güncellenmezse canlının gece yedeği **sessizce alınmaz**.

---

## 9. Bu sürümde ne var (kullanıcı sorarsa)

Backend **2.9.3**, 232 migration. Sevk belgesinde **müşterideki ürün adı**
(bayrağa bağlı: bizdeki / müşterideki / ikisi — **varsayılan "bizdeki" = bugünkü
çıktı**, açmak Sistem → Özellik Anahtarları → Sevkiyat & İade'den bilinçli bir
hamle) · kolon başlıkları düzenlenebilir · çuval izleri · Sistem → Bağlı
İstemciler ekranı · panel 1.2.6 / tablet 1.0.5 (ikisi de yayında, internetten
kendiliğinden gelir, elden kurulum yok).
