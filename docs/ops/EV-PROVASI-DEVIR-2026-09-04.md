# Ev Provası — Devir Notu (2026-09-04)

> **Bu belge Windows makinede çalışacak oturum içindir.** Yazan oturum macOS'taydı
> ve bu konuşmayı görmüyorsun; ihtiyacın olan her şey burada.
>
> **Amaç:** fabrikaya çıkmadan önce, evde bir Windows makinede sıfırdan kurulum
> provası. Sunucu + panel + tablet. Fabrikaya HİÇBİR ŞEY yapılmayacak.
>
> ---
>
> ### ⚠️ BU PROVANIN İKİNCİ KOŞUMU (2026-09-04, akşam)
>
> Birinci koşum **geçmedi** — `kur.ps1` `[7/9]`'da düştü ve sebep kurulum
> mekaniği değil **paketin kendisiydi**. Sonuçlar: `EV-PROVASI-SONUC-2026-09-04.md`.
> Beş bulgunun hepsi düzeltildi ve yeni paket üretildi:
>
> | Bulgu | Neydi | Durum |
> |---|---|---|
> | 1 | Paket nokta ile başlayan her girdiyi kaybediyordu (140 dosya) | düzeltildi + **kapı** kondu |
> | 2 | Satıcı hesabı bu paketten kurulamıyordu | araç pakete derleniyor |
> | 3 | `ecosystem.config.js` yolları sabit `C:/Etkili-Yazilim` | kök **türetiliyor** |
> | 4 | Windows'ta `PM2_HOME` süreçleri ayırmıyor | yazıya geçti (§5) |
> | 5 | `[module-profile]` yanıltıcı mesaj | satırları sayıyor |
> | 6 | Node sürümü belirsiz | `engines >=22` + `kur.ps1` ölçüyor |
>
> Yeni paket macOS'ta ölçüldü: 13643 dosya = beyan · 124 nokta girdisi ·
> `.prisma/client/default` **çözülüyor ve yükleniyor** (Windows'ta bulunamayan
> tam modül) · prisma CLI `.bin` olmadan koşuyor · satıcı aracı çalışıyor ve
> TTY kapısı donmadan hata veriyor.
>
> **Bu koşumun sorusu tek:** `kur.ps1` dokuz adımı **hiç elle müdahale
> olmadan** bitiriyor mu?

---

## 0. Neden bu prova var

`main` dalında iki gündür büyük bir iş birikti: modül/bayrak sistemi (Dilim 1),
davranış bayrakları (Dilim 2) ve satıcı hesabı. Ölçülenler:

- 231 migration, fabrika yedeğinin kopyasında hatasız uygulandı
- 70 uç noktasının statü kodu eski sürümle **birebir aynı**
- `test_consistency` aynı 4 bilinen kırmızı (fabrika verisinin olgusu)
- Bekçiler yeşil

**Ölçülmemiş olan tek şey kurulum mekaniğidir:** `paketle.ps1` / `kur.ps1` /
pm2 / Windows'ta PostgreSQL / macOS'ta derlenen panelin native modülleri. Bu
provanın konusu tam olarak o.

---

## 1. Elindeki dosyalar

Kullanıcı bunları Windows'a taşıdı (Mac'te `~/Desktop/tekserp-kurulum`'daydı):

| Dosya | Ne | Not |
|---|---|---|
| `tekserp-backend-20260904_032424-6d7f1209.zip` | Sunucu paketi, 121 MB | 231 migration + `node_modules` + satıcı aracı → sunucuda internet GEREKMEZ. ⚠️ Klasörde TEK zip olmalı; bozuk olanlar silindi. |
| `TeksERP-1.2.0-Setup.exe` | Panel, 141 MB | macOS'ta derlendi; Windows native ikilileri (`PE32+`) pakete girdiği DOĞRULANDI |
| `TeksERP-1.0.1-vc58.apk` | Tablet, 50 MB | İmzası doğrulandı; gömülü adres `http://192.168.1.250:4000/api` |
| `ilk-kurulum.ps1` | Veritabanı + iskelet kurar | ADIM 3.2'de koşar. Repo kaynağı `deploy/ilk-kurulum.ps1` |
| `kur.ps1` | Sürümü kurar (yükseltme aracı) | ADIM 3.3'te koşar. Repo kaynağı `deploy/kur.ps1` |
| `OKU-ONCE.md` | Bu belge | Repo kaynağı `docs/ops/EV-PROVASI-DEVIR-2026-09-04.md` |
| `KURULUM.md` | Tam kurulum reçetesi | Bu notta olmayan ayrıntı (yedek, pm2, sorun giderme) oradadır |

Klasördeki her şey elinin altında — git'e, internete, başka bir makineye
ihtiyacın yok.

⚠️ Script'ler **bulundukları yeri kullanmaz** (sıfır konum referansı). Nereye
kuracaklarını yalnız `-Kok` belirler; zip'i tam yolla verirsin. Yani klasörü
nereye açtığın önemsizdir.

---

## 2. Kurulum modeli — YAN YANA (üzerine yazma YOK)

Kullanıcının kararı: eski kurulum **yerinde kalır**, yeni sürüm **ayrı köke**
kurulur ve **veritabanının kopyasına** bağlanır. Geçiş pm2 düzeyinde olur.

```
C:\Etkili-Yazilim\   ← ESKİ (fabrikada; evde YOK). DOKUNMA.
C:\TeksERP\          ← YENİ kök. Provada burayı kur.
```

Geri dönüş simetrik: yeniyi durdur, eskiyi başlat. Veritabanları da ayrı.

⚠️ **İkisi aynı anda çalışamaz** — aynı port, aynı DB adı riski. Provada eski
kurulum zaten yok, sorun çıkmaz.

---

## 3. Adımlar

Her adımın **beklenen çıktısı** yazılı. Görmediğin bir şey varsa DURMA ve sebebini
ölç; tahminle ilerleme.

### 3.0 ÖNCE SIFIRLA (makinede birinci provadan kalıntı var)

Birinci koşumda kurulum **dört elle müdahaleyle** tamamlanmıştı (migration elle,
`ecosystem.config.js` elle düzeltildi, prisma client elle üretildi, pm2 elle
başlatıldı). O kurulumun üzerine kurmak hiçbir şey kanıtlamaz — düzeltmelerin
kendisi kalıntıyla karışır.

```powershell
# 1) pm2'yi durdur (YÖNETİCİ kabuk — daemon yönetici olarak koşuyor, §5/BULGU-4)
$env:PM2_HOME = "C:\TeksERP\pm2-home"
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd delete all
C:\TeksERP\pm2\node_modules\.bin\pm2.cmd kill

# 2) Veritabanını düşür
$pg = "C:\Program Files\PostgreSQL\16\bin"
& "$pg\dropdb.exe" -h localhost -p 5432 -U postgres tekserp

# 3) YALNIZ KURULUM ÇIKTILARINI kaldır — KÖKÜ SİLME
#    ⚠️ `Remove-Item C:\TeksERP -Recurse -Force` YAZMA. İkinci koşumda ölçüldü:
#    paket, dump, script'ler ve bu not kurulum kökünün İÇİNDE duruyordu; kökü
#    silmek provanın kendi girdilerini yok ederdi.
Move-Item C:\TeksERP\backups\premigrate_*.dump C:\  -ErrorAction SilentlyContinue
foreach ($d in "app","backups","logs","pg-setup","pgsql","pm2","pm2-home") {
  Remove-Item "C:\TeksERP\$d" -Recurse -Force -ErrorAction SilentlyContinue
}
Get-ChildItem C:\TeksERP -Directory -Filter "app.*" | Remove-Item -Recurse -Force
```

⚠️ **`app\` içinde açık terminal/pencere bırakma.** İkinci koşumda sıfırlama tam
bu yüzden düştü ("Device or resource busy" — koşan oturumun çalışma dizini o
klasörün içindeydi). `kur.ps1`'in bu uyarısı gerçektir, ölçüldü.

⚠️ `pgsql\bin` bir **junction**'dır; silinirken hedefi (`C:\Program Files\
PostgreSQL\16\bin`) takip ETMEZ — ikinci koşumda 74 dosyayla sağlam kaldığı
doğrulandı.

⚠️ `tekserp` **rolünü de** düşür (`DROP ROLE tekserp`) — kalırsa parolası
bilinmediği için `ilk-kurulum.ps1` `[3/8]`'de "bağlanılamıyor" ile durur.
Script mevcut bir rolün parolasına BİLEREK dokunmaz.

⚠️ Elinde fabrika dump'ı olduğundan emin ol; sıfırlama onu geri getirmez.

### 3.1 Ön koşullar

```powershell
node --version                                          # v22.x bekleniyor
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" --version
```

⚠️ **PostgreSQL 16 DOĞRU sürümdür.** `KURULUM.md` uzun süre "18.x" diyordu ve
YANLIŞTI: saha 16.9, geliştirme konteyneri 16.15. 2026-09-04'te düzeltildi.
18 kurma — 18'in dump'ı 16'ya yüklenmez (`pg_restore` geriye çalışmaz).

Node yoksa: Node.js 22 LTS kur. pm2'yi ELLE kurma — `ilk-kurulum.ps1` yerel
olarak kuracak.

### 3.2 Veritabanı + yedek + iskelet — TEK KOMUT

```powershell
.\ilk-kurulum.ps1 -Kok C:\TeksERP -DbParola 123123 -PostgresParola <postgres-parolasi> -Dump "<dump tam yolu>"
```

Bu tek komut şunları yapar: klasörler · `pgsql\bin` bağlantısı · **`tekserp` rolü
ve `tekserp` veritabanı** · fabrika yedeğini yükler · `db-credentials.json` ·
`app\.env` (JWT_SECRET makinede üretilir) · yerel pm2.

`-Dump` isteğe bağlı — vermezsen boş veritabanıyla devam eder ve `kur.ps1`
migration'ları sıfırdan uygular.

**Beklenen son satırlar:**
```
  + rol olusturuldu: tekserp  (superuser DEGIL ...)
  + veritabani olusturuldu: tekserp  (sahibi: tekserp)
  + yuklendi  |  migration: 191  |  top: <birkaç bin>
  + baglanti OK  |  uygulanmis migration: 191
```

Migration 191 doğru sayıdır — yeni sürüm henüz kurulmadı, `kur.ps1` onu 231'e
çıkaracak. 231 görüyorsan yanlış veritabanına bakıyorsun.

⚠️ **İDEMPOTENT.** İkinci kez koşmak güvenli: var olan rol, veritabanı ve
özellikle **`.env` ASLA ezilmez**. Var olan bir rolün parolası da değiştirilmez
(o rolü başka bir kurulum kullanıyor olabilir); script bu durumda uyarır ve
gereken `ALTER ROLE` komutunu yazar.

⚠️ **Dump yalnız BOŞ veritabanına yüklenir.** Doluysa script durur — dolu bir
şemanın üzerine restore, hangi satırın hangi sürümden geldiği bir daha
bilinemeyen yarım bir şema bırakır. Farklı bir ad ver (`-DbAdi tekserp_yeni`)
ya da o veritabanını elle sil.

⚠️ Parolayı **sen veriyorsun, script'te varsayılan yok.** Ev provasında
`123123` yeterli; fabrikada gerçek bir parola ver. Gömülü bir varsayılan
fabrikaya da giderdi.

**Elle yapmak istersen** (script'in yaptığının aynısı):
```powershell
$pg = "C:\Program Files\PostgreSQL\16\bin"
& "$pg\psql.exe" -U postgres -c "CREATE ROLE tekserp WITH LOGIN PASSWORD '123123'"
& "$pg\psql.exe" -U postgres -c "CREATE DATABASE tekserp OWNER tekserp"
& "$pg\pg_restore.exe" -U tekserp -d tekserp --no-owner --no-privileges "<dump>"
```
⚠️ Restore'u **`tekserp` rolüyle** yap. `postgres` ile yaparsan tablolar
`postgres`'e ait olur ve uygulama kendi veritabanında yazamaz.

⚠️ Dump hedef veritabanı adını **taşımaz** (`-Fc`, `-C` yok) — hangi ada
yüklediğin tamamen senin seçimin.


### 3.3 Sürümü kur

```powershell
.\kur.ps1 -Kok C:\TeksERP -Paket "<zip tam yolu>"
```

Dokuz adım: paketi aç · `.env`i kenara al · **migration öncesi yedek** ·
pm2 durdur · yerleştir · migration · pm2 başlat · sağlık.

**Beklenen:** `[3/9]` yedeği alıp doğrular (alamazsa kurulumu İPTAL eder — doğru
davranış), `[7/9]` migration'lar uygulanır, `[9/9]` sağlık `ok`.

Migration **geri alınamaz eşiktir**. Ondan sonraki hatada script otomatik geri
almaz, komutları yazar — kararı insan verir.

### 3.4 Satıcı (süperadmin) hesabı

```powershell
cd C:\TeksERP\app
npm run superadmin:kur
```

⚠️ **GERÇEK TERMİNAL ŞART.** Boru/dosya girdisinde script artık gürültülü hata
verip çıkar ("etkileşimli terminal ister"). Uzaktan koşuyorsan `ssh -t`.
Eskiden **sessizce sonsuza kadar donuyordu** ve kurulum tamamlanmamış kalıyordu;
2026-09-04'te fail-loud kapı eklendi.

Bu adım atlanırsa hesap **hiç doğmaz**. O durumda emniyet supabı devreye girer
(modül anahtarlarını `admin:settings` taşıyan yönetici değiştirebilir), yani
sistem kilitlenmez — ama satıcı ekranı da hiç açılmaz.

Script idempotenttir: hesap varsa DOKUNMAZ. Parola/PIN/TOTP bir kez gösterilir,
kaydet.

### 3.5 Panel

`TeksERP-1.2.0-Setup.exe` → kur → aç.

Sunucuyu **keşifle** bulmalı (mDNS + alt ağ taraması). Bulamazsa adresi elle gir.

⚠️ **KRİTİK KONTROL — macOS'ta derlendi:** Bu Bilgisayar → **Yazıcı** ve
**Kantar** sekmelerini aç. Cihaz yoksa bile **boş liste** görmelisin. Eğer
"serialport yüklü değil (electron:rebuild gerekli)" yazıyorsa macOS derlemesi
Windows'ta tutmamış demektir → paketi Windows'ta almak gerekir.

Bu ayrım bilinçli: modül yüklenemezse ayrı mesaj, cihaz yoksa boş liste. Test
düğmesine sahte bir COM adresiyle basarsan "yüklü değil" DIŞINDA her hata
(port açılamadı, zaman aşımı) modülün çalıştığı anlamına gelir.

### 3.6 Tablet

`TeksERP-1.0.1-vc58.apk` → kur → aç.

Gömülü adres `192.168.1.250` (fabrika). Evde bulunamayınca **alt ağ taraması**
devreye girer ve sunucuyu bulur. Bu yol daha önce hiç denenmedi — çalıştığını
görmek provanın kazancı.

Açılışta güncelleme kontrolü otomatik (`checkAutomatically: ON_LOAD`).

---

## 4. Yasaklar

- **Fabrikaya hiçbir şey yapma.** Bu prova evde. `C:\Etkili-Yazilim` (fabrikadaki
  eski kurulum) evde zaten yok; adı geçerse dokunma.
- **Canlı veritabanına bağlanma.** Yalnız kopya (`tekserp_yeni`).
- `pkill`/toplu `Stop-Process` **yok** — yalnız kendi başlattığın PID.
- Repoya commit **atma** (bu oturum kurulum yapıyor, geliştirme değil). Bir kod
  düzeltmesi gerekiyorsa önce kullanıcıya söyle.

---

## 5. Bugün öğrenilen tuzaklar (tekrarlama)

| Tuzak | Ne oldu |
|---|---|
| `$env:TEMP` | Yalnız Windows'ta tanımlı; `paketle.ps1` macOS'ta "Cannot bind argument to parameter 'Path'" ile düştü. Düzeltildi. |
| macOS'ta `java` | Komut JDK kurulu OLMASA DA vardır (sistem saplaması). `which java` YANILTICI; varlık dosya sisteminden ölçülür. |
| Gradle'a JDK vermek yetmez | İmza doğrulaması AYRI süreç, `keytool`u PATH'ten arar. Derleme geçer, doğrulama düşer ve hata "şifre yanlış" der — oysa Java eksiktir. |
| Sürüm otomatik değil | `build-apk.mjs` sürümü artırmaz, yalnız raporlar. Küçük/büyük hane elle verilir. |
| PostgreSQL sürümü | Doküman 18 diyordu, saha 16.9. Ortam sürümleri dokümanın en hızlı bayatlayan kısmı — ölç. |
| Restore'u yanlış rolle yapmak | `postgres` ile restore edilen tablolar `postgres`'e ait olur; uygulama kendi veritabanında yazamaz. `-U tekserp --no-owner` ile yükle (script bunu kendisi yapar). |
| Windows'ta `PM2_HOME` | Süreçleri AYIRMAZ — daemon `\\.\pipe\rpc.sock` kullanır, makinede tek pipe vardır. Ayrılan yalnız `dump.pm2` ve log konumu. Komutları AYNI yükseltme seviyesinden ver; yönetici daemon + yetkisiz istemci = `EPERM` ve bu "uygulama yok" gibi okunur. |
| `pm2 online` = çalışıyor sanmak | Backend restart döngüsündeyken de `online` görünür. Tek ölçüt `/health`. |
| Makinenin temiz olduğunu varsaymak | Birinci provada makinede 3 eski veritabanı ve parolası bilinmeyen bir rol vardı. Ölç, varsayma. |
| `kur.ps1` yükseltme aracıdır | Mevcut kurulum yoksa durur, `.env`i mevcut kurulumdan alır. Sıfırdan kurulum için `ilk-kurulum.ps1` yazıldı. |

---

## 6. "Prova geçti" ne demek

Hepsi doğrulanmadan geçti deme:

1. `kur.ps1` dokuz adımı da **elle müdahale olmadan** tamamladı, sağlık `ok`
2. Migration sayısı **231**
3. `GET /api/admin/health` yanıt veriyor
4. Panel açıldı, sunucuyu buldu, giriş yapıldı
5. **Yazıcı/Kantar sekmeleri "serialport yüklü değil" DEMİYOR**
6. Tablet açıldı, sunucuyu buldu, giriş yapıldı
7. Genel Ayarlar → **Modüller** bölümü görünüyor (bu turun ana yeniliği)
8. Fabrika verisi yerinde: top sayısı dump'takiyle aynı
9. `npm run superadmin:kur` **koştu** (birinci koşumda paket bu aracı taşımıyordu)
10. `C:\TeksERP\logs\` altında pm2 log dosyaları GERÇEKTEN oluştu (BULGU-3:
    yollar artık köke göre türetiliyor; boş klasör = kök türetimi bozuk)

Takılırsan: hata metnini olduğu gibi al, sebebini ölç, tahminle ilerleme.
