# OKU-ÖNCE — fabrika sunucusundaki Claude oturumu için devir notu

> Bu dosyayı okuyan sen, **fabrika sunucusunda** açılmış yeni bir Claude
> oturumusun. Bu işi planlayan oturumun bağlamı sende YOK. İhtiyacın olan her şey
> bu dosyada ve `FABRIKA-KURULUM-2026-09-04.md`'de.

## 0. Neredesin

**BURASI CANLI ÜRETİM.** Gerçek bir tekstil fabrikasının ERP sunucusu. Yanlış bir
komut vardiyayı durdurur.

| | |
|---|---|
| Eski API | `:4000`, **pm2** ile koşuyor — planlı olarak **durdurulacak** |
| PostgreSQL | **eski API'nin klasörünün İÇİNDE** (Program Files DEĞİL), `:5432` |
| Kuracağın şey | Yeni sürüm — **ayrı kök** `C:\TeksERP`, **AYNI port 4000**, **ayrı veritabanı** `tekserp_yeni` |
| Yeni veritabanı | Canlının bu akşamki kopyası, **kullanıcı zaten oluşturdu** |

Yeni sürüm eskisinin **yerine** geçiyor. Eski kurulumun **dosyalarına ve
veritabanına dokunulmuyor** — orası geri dönüş yolu.

---

## 1. Yasaklar — istisnasız

1. **`C:\Etkili-Yazilim` altında hiçbir dosyayı değiştirme, silme, taşıma.**
   Yalnız *okuyabilirsin*. Tek istisna: notun söylediği pm2 `stop`/`delete`
   komutları (uygulama kaydı, dosya değil).
2. **Eski veritabanına yazma.** Yeni kurulum `tekserp_yeni`'yi kullanır; eskisi
   dokunulmadan durur, geri dönüşün tamamı ona dayanıyor.
3. **Toplu süreç öldürme YASAK**: `taskkill /F /IM node.exe`,
   `Get-Process node | Stop-Process`, `pkill` benzeri hiçbir şey. Hangi süreci
   öldürdüğünü söylemez.
4. **`prisma migrate reset` · reseed · toplu `DELETE`/`TRUNCATE` YASAK.**
5. **`kur.ps1 -Zorla` KULLANMA.** Onaylar insan içindir; çıktıyı kullanıcıya
   göster, cevabı ondan al.
6. **Parolayı hiçbir yere yazma** — ekrana basma, dosyaya kaydetme, komut
   satırına düz yazma. `(Read-Host "DB parolasi")` kalıbını kullan.
7. **Panel/tablet yayını yapma** (`electron-yayinla`, `mobil-yayinla`).

---

## 2. Başlamadan doğrula

**a) Kabuk YÖNETİCİ mi?** `kur.ps1` yönetici olmayan kabukta durur ve sen kendini
yükseltemezsin. Değilse kullanıcıdan terminali "Yönetici olarak çalıştır" ile
yeniden açmasını iste.

```powershell
(New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
```

**b) Node 22+ var mı?** `node -v`

**c) İnternet var mı?** `ilk-kurulum.ps1 [7/8]` yeni kök için **pm2'yi npm ile
indirir**. `npm ping` ile önce dene.

**d) 4000'i kim dinliyor?** Ölç, varsayma — durdurma adımında lazım olacak:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess } | Format-List Name,Id,Path
Get-Service | Where-Object { $_.Name -match "teks|erp" } | Format-Table Name,Status
```

---

## 3. Kurulum

`FABRIKA-KURULUM-2026-09-04.md`'deki **yedi adımı sırayla** uygula.

### Kullanıcıdan almak zorunda olduğun iki bilgi

1. **`tekserp_yeni` parolası** — sende yok.
2. **`-PgBin` yolu** — bul, sonra kullanıcıya doğrulat.

### En kritik iki nokta

**① 3. adım (yapılandırmayı kurulumdan ÖNCE kopyalama) atlanamaz.** pm2 adının
farklı olmasını sağlıyor; aynı ad `kur.ps1 [4/9]`'un `pm2 delete`'i ile **eski
kurulumun pm2 kaydını siler** ve hazır geri dönüş yolu kaybolur.

**② 4. adım (eskiyi durdurma) 5'ten ÖNCE gelmek zorunda.** Port doluyken kurulum
`EADDRINUSE` ile düşer, `[9/9]` 4000'i sorgular, cevabı **ESKİ API** verir ve
script **"KURULUM TAMAM — surum \<eski\>"** der (sürüm karşılaştırması yok).
Sessiz yalancı yeşil. Durdurduktan sonra `curl http://localhost:4000/health`
**cevapsız kalmalı**; kalmıyorsa DUR ve kullanıcıya söyle.

⚠️ 4. adımdan sonra **fabrika kapalıdır**; kalan adımlar kesintisiz ilerlemeli.
Buraya gelmeden kullanıcıya haber ver.

### Nerede DURUP soracaksın

| Nokta | Neden |
|---|---|
| 4. adım öncesi | Fabrikayı kapatıyorsun. Onay al. |
| `[3/9]` yedek alınamazsa | Kurulum kendini iptal eder. **Zorlama.** |
| `[7/9]` öncesi | **Geri alınamaz eşik.** Onay al. |
| `[7/9]` sonrası hata | Script komutları yazar, uygulamaz. **Sen de uygulama.** |
| 6. adımda sürüm eskisiyle AYNI çıkarsa | 4. adım tam olmamış. **Devam etme.** |

---

## 4. Kurulumdan sonra

**Satıcı hesabı** (kopya veritabanında büyük ihtimalle yok):

```powershell
cd C:\TeksERP\app
npm run superadmin:kur
```
⚠️ **GERÇEK TTY ister** — boru/otomasyon içinde gürültülü hata verip çıkar.
**Sen koşturmaya çalışma**; kullanıcıya "sunucunun kendi konsolunda çalıştırın"
de. Parola/PIN/TOTP bir kez gösterilir; **kaydetme, tekrarlama, loglama.**

**İstemciler:** sahadaki panel ve tabletlerde kendini güncelleme yeteneği YOK —
bu turda **elden kurulum zorunlu** (`istemciler/` klasörü). Bu bir insan işi;
sen cihazlara dokunma, kullanıcıya `istemciler/OKU.md`'yi göster.

Adres ayarı **gerekmiyor**: sunucu yine `:4000`'de, ağa ilan açık.

---

## 5. Bilmen gereken bir sessizlik

Yeni veritabanı canlının kopyası olduğu için **aynı `installationId`'yi taşıyor**.
Tek sunucu koşacağı için bu bugün sorun değil (keşifte tek aday çıkar), ama
şunu bil: bir istemci "bu senin sunucun değil" uyarısı **vermez** — kimlik
değişmedi. Yani bir cihazın hangi veritabanına baktığını kimlik üzerinden
anlayamazsın; ölçüt **`/health` sürümü**.

---

## 6. Ters giderse

Eski kod ve eski veritabanı hiç değişmedi:

```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd stop tekserp-backend-yeni

$env:PM2_HOME = "C:\Etkili-Yazilim\pm2-home"
cd C:\Etkili-Yazilim\app
C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd start ecosystem.config.js
C:\Etkili-Yazilim\pm2\node_modules\.bin\pm2.cmd save
curl http://localhost:4000/health
```

⚠️ **Ne kadar geç dönülürse o kadar pahalı** — yeni sürümde `tekserp_yeni`'ye
yazılan işler eski veritabanında YOKTUR. Dönüş bir **iş kararıdır**; sen kendi
başına verme, kullanıcıya durumu söyle.

Loglar:
```powershell
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd logs tekserp-backend-yeni --lines 80
```

⚠️ pm2 komutlarını **hep aynı yükseltme seviyesinden** ver; yönetici daemon +
yetkisiz istemci `EPERM` verir ve bu "uygulama yok" gibi okunur.
⚠️ Windows'ta `PM2_HOME` süreçleri **ayırmaz** (tek pipe) — `pm2 list` iki kaydı
birden gösterebilir. Ayıran şey **isim**: `tekserp-backend` (eski) ↔
`tekserp-backend-yeni` (senin kurduğun).

**`kur.ps1 -GeriAl`'ı kendi başına çalıştırma** — ilk kurulumda geri dönülecek
bir sürüm zaten yok.

---

## 7. Kullanıcıya hatırlatman gereken iki şey

1. **Gece yedeği hâlâ ESKİ veritabanını alıyor.** Bağımsız bir Görev Zamanlayıcı
   görevi (`TeksERP-DB-Backup` → `C:\Etkili-Yazilim\yedekle.ps1`, 02:00) DB adını
   kendi içinde taşıyor ve `tekserp_yeni`'yi bilmiyor → güncellenmezse canlının
   gece yedeği **sessizce alınmaz**.
2. **7. adım (eski pm2 kaydını silme) atlanmamalı.** İki kayıt da 4000'i istiyor;
   sunucu yeniden başlarsa ikisi birden ayağa kalkmaya çalışır ve hangisinin
   kazandığı belli olmaz.

---

## 8. Bu sürümde ne var (kullanıcı sorarsa)

Backend **2.9.3**, 232 migration. Sevk belgesinde **müşterideki ürün adı**
(bayrağa bağlı, **varsayılan "bizdeki" = bugünkü çıktı**) · belge kolon başlıkları
düzenlenebilir · çuval izleri · `Sistem → Bağlı İstemciler` ekranı · panel 1.2.6 ·
tablet 1.0.5.
