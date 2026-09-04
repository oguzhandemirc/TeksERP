# Ev Provası — Sonuç Notu (2026-09-04)

> **Bu belge, `OKU-ONCE.md` ile Windows makineye devredilen ev provasının
> cevabıdır.** Provayı koşan oturum Windows'taydı; bu notu okuyan oturum (macOS)
> o konuşmayı görmüyor, ihtiyacı olan her şey burada.
>
> **Repo hedefi:** `docs/ops/EV-PROVASI-SONUC-2026-09-04.md`
> (devir notunun kaynağı: `docs/ops/EV-PROVASI-DEVIR-2026-09-04.md`)

---

## 0. Sonuç: PROVA GEÇMEDİ

`OKU-ONCE.md §6`'daki 8 maddenin ilki düştü: **`kur.ps1` dokuz adımı
tamamlayamadı.** `[7/9]` migration adımında durdu ve sebebi kurulum mekaniği
değil, **paketin kendisiydi**.

Sunucu şu an ayakta (`/health` → `UP` / `db UP` / `v2.9.0`) — ama oraya
**dört elle müdahaleyle** gelindi. Bu paket bugün fabrikaya götürülseydi
kurulum aynı yerde dururdu.

Provanın amacı buydu ve amacına ulaştı: **ölçülmemiş olan kurulum mekaniği
ölçüldü ve kırık çıktı.**

---

## 1. Ölçülen ortam

| | Değer | Runbook ne diyor |
|---|---|---|
| İşletim sistemi | Windows 11 Pro 10.0.26200 | — |
| Node | **v26.4.0** | `KURULUM.md A0`: **22.x** ❌ |
| npm | 11.17.0 | — |
| PostgreSQL | **16.14** (servis `postgresql-tekserp`, `NT AUTHORITY\NetworkService`, port 5432) | 16.x ✅ |
| `pg_hba.conf` | tüm satırlar `scram-sha-256` | — |
| Paketi üreten Node | **v26.8.1** (`PAKET.json`) | 22.x ❌ |

⚠ **Node sürümü, PostgreSQL 18 vakasının aynısı.** Runbook 22.x diyor; ne bu
makine ne paketi üreten makine 22'ydi. Kurulum çalıştı, yani 26 fiilen sorun
çıkarmadı — ama yazılı sürüm gerçeği göstermiyor. `package.json`'da `engines`
olmadığı için hiçbir kapı bunu yakalamaz. **Ya doküman 26'ya çekilmeli ya da
`engines` konup gerçekten 22'de kalınmalı; ikisinden biri seçilmeli.**

### Makine temiz DEĞİLDİ

Prova başlarken makinede önceki bir çalışmadan kalma veri vardı:

```
tekserp                92 tablo   195 migration   1752 top
tekserp_old_20260815   88 tablo   162 migration     40 top
tekserp_old_20260819   88 tablo   162 migration    815 top
rol: tekserp (parolası bilinmiyordu)
```

`C:\Etkili-Yazilim` yoktu (beklendiği gibi).

⚠ **Kullanıcının talimatıyla üçü de ve `tekserp` rolü SİLİNDİ; güvenlik
yedekleri de talimatla silindi — bu veri geri getirilemez.** Sıfırdan kurulum
yolunun gerçekten sınanması için gerekliydi (rol dursaydı `ilk-kurulum.ps1`
mevcut rolün parolasına bilinçli olarak dokunmadığı için `[3/8]` sonunda
"bağlanılamıyor" ile düşerdi).

---

## 2. Adım adım ne oldu

### 3.2 `ilk-kurulum.ps1` — ✅ KUSURSUZ

```powershell
.\ilk-kurulum.ps1 -Kok C:\TeksERP -DbParola 123123 -PostgresParola <p> `
                  -Dump "C:\TeksERP\tekserp_20260904_011108.dump"
```

Sekiz adımın hepsi geçti. Çıktı `OKU-ONCE §3.2`'deki beklenen satırlarla
**birebir** aynıydı:

```
+ rol olusturuldu: tekserp  (superuser DEGIL ...)
+ veritabani olusturuldu: tekserp  (sahibi: tekserp)
+ yuklendi  |  migration: 191  |  top: 4306
+ baglanti OK  |  uygulanmis migration: 191
```

Bu script hakkında düzeltilecek bir şey **yok** — beklendiği gibi çalıştı.
Tek eksiği §3'teki BULGU-3.

### 3.3 `kur.ps1` — ⚠ `[7/9]`'DA DÜŞTÜ

```powershell
.\kur.ps1 -Kok C:\TeksERP -Paket "...8ba92ca7.zip" -Zorla
```

| Adım | Sonuç |
|---|---|
| `[1/9]` paket doğrulama | ✅ "paket saglam (231 migration klasoru)" — **kapı kusuru gördü ama geçirdi**, bkz. BULGU-1 |
| `[2/9]` mevcut kurulum + `.env` | ✅ |
| `[3/9]` premigrate yedek | ✅ `premigrate_20260904_022106.dump` (4 MB), doğrulandı |
| `[4/9]` pm2 durdur | ✅ |
| `[5/9]` yerleştirme | ✅ |
| `[6/9]` bağımlılıklar | ✅ atlandı (pakette dahil) |
| `[7/9]` **migration** | ❌ `'prisma' is not recognized as an internal or external command` |
| `[8/9]` `[9/9]` | koşmadı |

⚠ **DB'ye hiç dokunulmadı** — `prisma` hiç başlamadığı için geri alınamaz eşik
fiilen geçilmedi. Script'in "DB kısmen değişmiş OLABİLİR" mesajı bu durumda
doğru ama gereğinden karamsar; ayırt edemiyor.

### Elle tamamlanan dört adım

Provayı ilerletmek için (hiçbiri normal kurulumun parçası değildir):

```powershell
# 1. migration - .bin olmadigi icin CLI'yi dogrudan giris noktasindan cagir
cd C:\TeksERP\app
node node_modules\prisma\build\index.js migrate deploy      # 191 + 40 = 231 ✅

# 2. ecosystem.config.js yollarini C:/TeksERP'e cevir (BULGU-3)

# 3. Prisma client'i yerinde uret (BULGU-1)
node node_modules\prisma\build\index.js generate

# 4. pm2'yi YUKSELTILMIS kabukta baslat (BULGU-4)
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd start ecosystem.config.js ; ... save
```

Sonuç: `/health` → `{"status":"UP","api":"UP","db":"UP","version":"2.9.0"}`

### 3.4 satıcı hesabı — ❌ YAPILAMADI (BULGU-2)
### 3.5 panel / 3.6 tablet — ❌ dosyalar makinede yok

`TeksERP-1.2.0-Setup.exe` ve `TeksERP-1.0.1-vc58.apk` klasöre hiç taşınmamış.
Yani provanın asıl kazancı sayılan iki şey **ölçülemedi**:
- panelin macOS'ta derlenen `serialport`/`node-hid` ikililerinin Windows'ta
  tutup tutmadığı (`OKU-ONCE §3.5` kritik kontrolü)
- tabletin alt ağ taramasıyla sunucuyu bulup bulmadığı (§3.6 — "bu yol daha
  önce hiç denenmedi")

---

## 3. BULGULAR

### BULGU-1 — Paket, `node_modules` içindeki nokta ile başlayan HER klasörü kaybediyor · **KRİTİK**

Ölçüm:

```
zip toplam girdi                     : 13568  (13518 dosya + 50 klasor)
nokta ile baslayan girdi sayisi      : 0
PAKET.json > dosyaSayisi (beyan)     : 13658
FARK                                 : 140 dosya
```

`paketle.ps1` 13658 dosya saydığını yazıyor, zip'e 13518 dosya koymuş.
**140 dosya sessizce düşmüş** ve hiçbir kapı bunu görmemiş.

Düşenler ve sonuçları:

| Düşen | Sonucu |
|---|---|
| `node_modules/.bin` | Hiçbir CLI shim yok → `npx prisma` bulunamaz → **`kur.ps1 [7/9]` her koşumda düşer** |
| `node_modules/.prisma` | Üretilmiş Prisma client yok → backend `Cannot find module '.prisma/client/default'` ile **restart döngüsüne girer** |

İkincisi birincisinden daha sinsi: `[7/9]` elle aşılsa bile backend açılmaz ve
pm2 `online` gösterir (süreç doğar, saniyeler içinde ölür, tekrar doğar).
`kur.ps1 [9/9]` bunu yakalar (120 sn `/health` beklemesi) — yani **son kapı
çalışıyor**, kaçak yok. Ama bu noktada migration çoktan uygulanmıştır.

**Nerede düzeltilir:** `deploy/paketle.ps1`. Muhtemel sebep: paketleyici gizli
öznitelikli / dot-prefix girdileri atlıyor (paket `unknownbe85e6a5338c\demirci`
üzerinde üretilmiş; kaynak makinede `.bin` girdileri sembolik bağ ise pek çok
zip yazıcısı bunları sessizce atlar).

⚠ **Düzeltmeye ek olarak bir KAPI gerekiyor.** Bu kusurun bedava yakalanacağı
iki yer var, ikisi de boştu:
1. `paketle.ps1` sonunda: `PAKET.json > dosyaSayisi` ile zip'in gerçek dosya
   girdisi sayısını kıyasla; eşit değilse **paketi üretme**.
2. `kur.ps1 [1/9]` `$zorunlu` listesine ekle:
   `node_modules\.prisma\client` ve `node_modules\.bin\prisma`
   (`$nmVar` doğruyken). Bugün `[1/9]` "paket saglam" dedi ve paket sağlam
   değildi — kapı doğru soruyu sormuyor.

### BULGU-2 — Satıcı (süperadmin) hesabı bu paketten kurulamıyor · **KRİTİK**

```
scripts\ klasoru       : YOK
scripts\superadmin-olustur.ts : YOK
node_modules\tsx       : YOK
package.json > superadmin:kur = "tsx scripts/superadmin-olustur.ts"
```

`OKU-ONCE §3.4` bu adımı kurulumun parçası sayıyor ve atlanırsa "hesap **hiç
doğmaz**" diyor. Paket ne script'i ne çalıştırıcısını taşıyor → **ADIM 3.4 bu
paketle hiç çalıştırılamaz.**

Emniyet supabı devrede (modül anahtarlarını `admin:settings` taşıyan yönetici
değiştirebilir), yani sistem kilitlenmiyor — ama satıcı ekranı hiç açılmıyor
ve "tek gövde, çok fabrika" hedefinin kilit mekanizması kurulamıyor.

**Karar gerekiyor:** ya `scripts/` + `tsx` pakete girecek, ya bu adım pakete
girmeyen ayrı bir yolla (derlenmiş `dist/` betiği?) koşacak. Bugünkü hâliyle
runbook, paketin sağlayamadığı bir adımı zorunlu tutuyor.

### BULGU-3 — `ilk-kurulum.ps1` `ecosystem.config.js` yazmıyor

Taze kurulumda korunacak bir `ecosystem.config.js` yok; `kur.ps1 [5/9]` doğru
davranıp paketinkini kullanıyor ("onceki ecosystem.config.js yoktu"). Ama
paketinki **repo varsayılanıdır** ve tüm yolları sabit `C:/Etkili-Yazilim`:

```
out_file   : C:/Etkili-Yazilim/logs/backend-out.log     ← klasor YOK
error_file : C:/Etkili-Yazilim/logs/backend-err.log     ← klasor YOK
BACKUP_DIR : C:/Etkili-Yazilim/backups
PG_BIN_DIR : C:/Etkili-Yazilim/pgsql/bin
```

Kök `C:\TeksERP` iken hepsi yanlış. `KURULUM.md` zaten "`BACKUP_DIR` tanımsızsa
gece yedeği sessizce çalışmaz" diyor; burada tanımlı ama **var olmayan bir yeri**
gösteriyor — daha kötüsü, çünkü hiçbir uyarı üretmez.

⚠ Bu, `-Kok`'un parametre olmasının yarım kalmış tarafı: `kur.ps1` köke göre
konumlanabiliyor, `ecosystem.config.js` konumlanamıyor.

**Nerede düzeltilir:** `ilk-kurulum.ps1`'e 9. adım — `-Kok`'a göre
`ecosystem.config.js` üret (veya paketinkini kopyalayıp yolları `-Kok` ile
yeniden yaz). İdempotentlik kuralı aynen geçerli: **varsa dokunma.**

Provada elle düzeltildi; paketin orijinali
`C:\TeksERP\app\ecosystem.config.js.paket-varsayilani` olarak duruyor.

### BULGU-4 — Windows'ta pm2 pipe'ı PM2_HOME'a göre ayrışmıyor · **yan yana modelini etkiler**

`kur.ps1` başlığı şunu vaat ediyor:

> ⚠ HER KOK KENDI PM2 DAEMON'INI TASIR ($kok\pm2-home). Ayni uygulama adi iki
> kokte CAKISMAZ - listeler ayridir.

**Windows'ta bu tutmuyor.** pm2 daemon'ı `\\.\pipe\rpc.sock` adını kullanıyor
ve bu ad `PM2_HOME`'a göre isimlendirilmiyor — makinede **tek** pipe var.
Ölçülen davranış:

- Yükseltilmiş `kur.ps1` koşumu `[4/9]`'da bir **yönetici** daemon spawn etti
- Sonraki yetkisiz `pm2 start` çağrıları `connect EPERM \\.\pipe\rpc.sock` aldı
- Daemon'ları öldürüp temiz denemek işe yaramadı — sahiplik sorunu, bayat pipe değil
- Çözüm: pm2'yi de yükseltilmiş koşmak (script zaten yönetici şartı koyuyor, tutarlı)

Fabrikada tek kök olduğu için bugün görünmüyor. **Yan yana geçiş (eski kökü
durdur / yeni kökü başlat) tam da bu mekanizmaya dayanıyor**, o yüzden geçiş
gününden önce yazılı olması lazım: iki kök aynı daemon'ı paylaşır, ayrı
`PM2_HOME` yalnız `dump.pm2`/log konumunu ayırır, süreç listesini AYIRMAZ.

Ayrıca: her iki kökün pm2 komutları **aynı yükseltme seviyesinden** verilmeli;
biri yönetici biri değilse ikincisi `EPERM` alır ve "uygulama yok" sanılır.

### BULGU-5 — `[module-profile]` mevcut satırlara bakmadan çıkıyor · küçük

Log:

```
[module-profile] TEKSERP_PROFIL tanımlı değil — modül anahtarları YAZILMADI
                 (kod varsayılanları geçerli: üretim açık, diğer altısı kapalı).
```

Oysa 7/7 anahtar **veritabanında zaten var** (`20260902230000_modul_anahtarlari_grandfathering`
migration'ından geldi):

```
production.enabled = true      depo.multiEnabled      = false
ticaret.enabled    = false     kumasTeknik.enabled    = false
iplik.enabled      = false     tezgah.enabled         = false
                               finance.pricingEnabled = false
```

`KURULUM.md A4b` yükseltilen kurulumda `"7/7 satır zaten var — dokunulmadı"`
satırını bekliyor. Job, `TEKSERP_PROFIL` yokluğunda satırları hiç saymadan
çıkıyor → operatör "anahtarlar yazılmadı" okuyup gereksiz yere `.env`e profil
ekleyip restart ediyor (hiçbir şey değişmeyecek, çünkü satırlar zaten var).

Sonuç doğru, mesaj yanıltıcı. Env kontrolünden **önce** satır sayımı yapılmalı.

---

## 4. `OKU-ONCE §6` kontrol listesi

| # | Madde | Sonuç |
|---|---|---|
| 1 | `kur.ps1` dokuz adımı tamamladı, sağlık ok | ❌ `[7/9]` düştü |
| 2 | Migration sayısı 231 | ✅ (elle) |
| 3 | `GET /api/admin/health` yanıt veriyor | ✅ 401 döndü — uç mevcut, yetki isteniyor |
| 4 | Panel açıldı, sunucuyu buldu, giriş yapıldı | ❌ `.exe` yok |
| 5 | Yazıcı/Kantar sekmeleri "serialport yüklü değil" DEMİYOR | ❌ ölçülemedi |
| 6 | Tablet açıldı, sunucuyu buldu, giriş yapıldı | ❌ `.apk` yok |
| 7 | Genel Ayarlar → Modüller görünüyor | ⚠ DB'de 7/7 anahtar var, ekran ölçülemedi |
| 8 | Fabrika verisi yerinde | ✅ 4306 top, 40 `system_settings` |

---

## 5. Makinenin şu anki hâli

```
C:\TeksERP\
  app\                      calisan kurulum (v2.9.0, commit 8ba92ca7)
    .env                    JWT_SECRET bu makinede uretildi
    ecosystem.config.js     ELLE duzeltildi (yollar C:/TeksERP)
    ecosystem.config.js.paket-varsayilani   paketin orijinali
    node_modules\.prisma\   ELLE uretildi (pakette yoktu)
  backups\premigrate_20260904_022106.dump   4 MB, dogrulandi
  logs\ pg-setup\ pm2\ pm2-home\ pgsql\bin -> C:\Program Files\PostgreSQL\16\bin

veritabani : tekserp @ localhost:5432, rol tekserp, 231 migration, 4306 top
pm2        : tekserp-backend / fork / 1 instance / online
             PM2_HOME=C:\TeksERP\pm2-home, dump.pm2 kaydedildi
             ⚠ daemon YONETICI olarak kosuyor - komutlari yukseltilmis kabuktan ver
```

⚠ `postgres` rolünün parolası bu makinede ölçüldü; **bu nota bilerek
yazılmadı** (`ilk-kurulum.ps1`'in "parola varsayılanı yoktur" kuralıyla aynı
gerekçe — bu dosya repoya gidiyor).

⚠ `pm2 startup` Windows'u desteklemiyor; **reboot kalıcılığı bu makinede
kurulmadı.** Yeniden başlatmada backend kendiliğinden kalkmaz.

---

## 6. Sonraki oturum için — öncelik sırasıyla

1. **BULGU-1'i düzelt ve KAPI koy** (`paketle.ps1` dosya sayısı doğrulaması +
   `kur.ps1 [1/9]`'a `.prisma`/`.bin` kontrolü). Bu düzelmeden hiçbir paket
   fabrikaya gitmemeli.
2. **BULGU-2'yi karara bağla** — satıcı hesabı pakete mi girecek, başka yolla mı?
3. **BULGU-3** — `ilk-kurulum.ps1` `ecosystem.config.js` üretsin.
4. **BULGU-4 ve BULGU-5'i dokümana yaz** (`kur.ps1` başlık yorumu düzeltilmeli;
   bugünkü hâli Windows'ta yanlış bilgi veriyor).
5. **Node sürümü kararı** — doküman 26'ya mı çekilecek, `engines` mi konacak?
6. **Yeni paketle provayı BAŞTAN koş.** Bugünkü kurulum elle müdahalelerle
   ayakta; düzeltilmiş paketin `kur.ps1`'i **hiç dokunmadan** dokuz adımda
   bitirdiği görülmeden prova geçmiş sayılmaz.
7. `.exe` ve `.apk`'yı makineye taşı — provanın ölçemediği iki şey onlar.

---

## 7. Geri dönüş noktaları

```
kod  : C:\TeksERP\app.eski-*  YOK - bu ILK kurulumdu, geri donulecek surum yok
veri : C:\TeksERP\backups\premigrate_20260904_022106.dump
       (231 migration ONCESI = fabrika dump'inin yuklenmis hali, 191 migration)
```

`kur.ps1 -GeriAl` bu makinede **çalışmaz** (`app.eski-*` yok). Sıfırlamak
gerekirse: pm2'yi durdur, `tekserp` veritabanını düşür, `ilk-kurulum.ps1`'i
baştan koş.

---

## 8. Tekrarlanmaması gerekenler

| Tuzak | Bu provada ne oldu |
|---|---|
| Paketin "sağlam" demesine güvenmek | `[1/9]` "paket saglam" dedi, paket 140 dosya eksikti. Kapı yanlış soruyu soruyordu. |
| `pm2 online` = çalışıyor sanmak | Backend restart döngüsündeyken de `online` görünür. Tek ölçüt `/health`. |
| Windows'ta `PM2_HOME` süreçleri ayırır sanmak | Ayırmaz. Pipe tektir; ayrılan yalnız `dump.pm2` ve loglar. |
| Yükseltme seviyesini karıştırmak | Yönetici daemon + yetkisiz istemci = `EPERM`, "uygulama yok" gibi okunur. |
| Makinenin temiz olduğunu varsaymak | Makinede 3 eski veritabanı ve parolası bilinmeyen bir rol vardı. Ölç, varsayma. |
| Doküman sürümlerine güvenmek | PostgreSQL 16 doğruydu, Node 22 yanlıştı. Ortam sürümleri dokümanın en hızlı bayatlayan kısmı. |
