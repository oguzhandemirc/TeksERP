# Ev Provası — Sonuç Notu (2026-09-04, üç koşum)

> **Bu belge, `OKU-ONCE.md` ile Windows makineye devredilen ev provasının
> cevabıdır.** Provayı koşan oturum Windows'taydı; bu notu okuyan oturum
> (macOS) o konuşmayı görmüyor, ihtiyacı olan her şey burada.
>
> **Repo hedefi:** `docs/ops/EV-PROVASI-SONUC-2026-09-04.md`

---

## 0. Sonuç

| | 1. koşum (02:11–02:32) | 2. koşum (03:36–03:45) | 3. koşum (13:44–13:49) |
|---|---|---|---|
| Paket | `8ba92ca7` | `6d7f1209` | `ab4bf170` |
| Senaryo | sıfırdan kurulum | sıfırdan kurulum | **gerçek yükseltme** |
| `ilk-kurulum.ps1` | ✅ 8 adım | ✅ 8 adım | — (gerekmedi) |
| `kur.ps1` | ❌ **`[7/9]`'da düştü** | ✅ **dokuz adım da tamam** | ✅ **dokuz adım da tamam** |
| Elle müdahale | **4** | **0** | **0** |
| `/health` | UP (müdahalelerle) | UP (kendi başına) | UP (kendi başına) |

**Sunucu tarafı geçti.** İkinci koşumda `kur.ps1` hiç dokunulmadan
`KURULUM TAMAM` verdi — provanın asıl sorusu buydu ve cevabı evet. Üçüncü
koşum bunu **yükseltme yolunda da** doğruladı (çalışan bir kurulumun üzerine).

**Prova tamamı geçmedi:** panel ve tablet iki koşumda da ölçülemedi
(`.exe`/`.apk` makineye hiç gelmedi — kullanıcı bunları kendisi dağıtıyor,
prova kapsamı dışı sayıldı) ve satıcı hesabı hâlâ kurulmadı.

---

## 1. Ölçülen ortam

| | Değer | Runbook ne diyor |
|---|---|---|
| İşletim sistemi | Windows 11 Pro 10.0.26200 | — |
| Node | **v26.4.0** | `A0`: 22.x — artık `kur.ps1` ölçüyor: `zemin >=22` ✅ |
| npm | 11.17.0 | — |
| PostgreSQL | **16.14** (servis `postgresql-tekserp`, `NetworkService`, port 5432) | 16.x ✅ |
| `pg_hba.conf` | tüm satırlar `scram-sha-256` | — |
| Paketi üreten Node | v26.8.1 | — |

Node sürümü artık bir kapıya bağlandı (`>=22`), doküman/gerçek ayrışması kapandı.

### Makine temiz DEĞİLDİ (1. koşum başlangıcı)

```
tekserp                92 tablo   195 migration   1752 top
tekserp_old_20260815   88 tablo   162 migration     40 top
tekserp_old_20260819   88 tablo   162 migration    815 top
rol: tekserp (parolası bilinmiyordu)
```

⚠ Kullanıcının talimatıyla üçü de ve `tekserp` rolü **silindi**; güvenlik
yedekleri de talimatla silindi — **bu veri geri getirilemez.**

---

## 2. BİRİNCİ KOŞUM — neden düştü

`kur.ps1` `[7/9]`'da `'prisma' is not recognized` ile durdu. Sebep kurulum
mekaniği değil **paketin kendisiydi**: zip'in 13.568 girdisinin hiçbiri nokta
ile başlamıyordu, yani `node_modules/.bin` ve `node_modules/.prisma` komple
düşmüştü (beyan 13.658 dosya, zip'te 13.518 → **140 dosya eksik**).

Sistemi ayağa kaldırmak için gereken dört müdahale:

1. `node node_modules\prisma\build\index.js migrate deploy` (`.bin` yok)
2. `ecosystem.config.js` yollarını `C:/Etkili-Yazilim` → `C:/TeksERP`
3. `node node_modules\prisma\build\index.js generate` (`.prisma` yok)
4. pm2'yi yükseltilmiş kabuktan başlatmak

Ayrıntılı bulgular §4'te; hepsi ikinci koşumda tekrar ölçüldü.

---

## 3. İKİNCİ KOŞUM — ne yapıldı, ne çıktı

### 3.1 Sıfırlama (zorunluydu)

Birinci koşumun kurulumu dört müdahaleyle ayaktaydı; üzerine kurmak hiçbir şey
kanıtlamazdı. Yapılan: pm2 `delete all` + `kill` (yönetici) · `DROP DATABASE
tekserp` · `DROP ROLE tekserp` · kurulum klasörlerini kaldır.

⚠️ **`OKU-ONCE §3.0`'daki sıfırlama komutu bu makinede YIKICI:**
`Remove-Item C:\TeksERP -Recurse -Force`. Paket, dump, script'ler ve notlar
**kurulum kökünün içinde** duruyor — komut birebir uygulansaydı provanın
girdileri silinirdi. Yalnız kurulum çıktıları (`app` · `backups` · `logs` ·
`pg-setup` · `pgsql` · `pm2` · `pm2-home`) kaldırıldı. **Notun o adımı
düzeltilmeli** (kök ile dosya klasörünün ayrı olduğunu varsayıyor).

⚠️ Sıfırlama sırasında `app\dist` "Device or resource busy" ile silinemedi.
Sebep: **koşan oturumun kendi çalışma dizini o klasörün içindeydi.** Tam da
`kur.ps1`'in uyardığı "app\ üzerinde açık terminal/pencere" kilidi — uyarının
gerçek olduğu ölçülmüş oldu. Dizinden çıkınca sorun kalktı.

⚠️ `pgsql\bin` bir junction'dır; silinirken **hedefi takip edilmedi**
(`C:\Program Files\PostgreSQL\16\bin` 74 dosyayla sağlam kaldı). Doğrulandı.

### 3.2 `ilk-kurulum.ps1` — ✅ kusursuz, iki koşumda da

```
+ rol olusturuldu: tekserp  (superuser DEGIL ...)
+ veritabani olusturuldu: tekserp  (sahibi: tekserp)
+ yuklendi  |  migration: 191  |  top: 4306
+ baglanti OK  |  uygulanmis migration: 191
```

### 3.3 `kur.ps1` — ✅ DOKUZ ADIM, SIFIR MÜDAHALE

`[1/9]`'daki iki yeni kapı çalıştı:

```
OK dosya sayisi beyanla uyusuyor (13643)
OK node 26.4.0 (zemin: >=22)
OK paket saglam (231 migration klasoru)
```

Kapılar `kur.ps1`'e şu hâliyle girmiş (ölçüldü):
- satır ~195: `$zorunlu` listesine `node_modules\.prisma\client` ve
  `node_modules\prisma\build\index.js` eklendi
- satır 411/419/433: prisma artık `& node $prismaCli` ile çağrılıyor,
  `.bin`'e ve `npx`'e bağımlı değil

Son çıktı: `KURULUM TAMAM · API UP · DB UP · surum 2.9.0`.

> `-Zorla` verildi (onay sorusu yazılamayan bir pencerede koşuyordu). Bu
> script'in kendi desteklediği otomasyon bayrağıdır, müdahale sayılmaz.

---

## 3B. ÜÇÜNCÜ KOŞUM — ilk gerçek yükseltme

İlk iki koşum sıfırdan kurulumdu; `kur.ps1` bir **yükseltme** aracı olduğu
hâlde yükseltme yolu hiç ölçülmemişti. Üçüncü koşum onu ölçtü: çalışan
`6d7f1209` üzerine `ab4bf170` kuruldu.

```
[1/9]  OK dosya sayisi beyanla uyusuyor (13643)
       OK node 26.4.0 (zemin: >=22)
       OK paket saglam (231 migration klasoru)
[3/9]  OK premigrate_20260904_134416.dump (4.17 MB) - dogrulandi
[5/9]  OK app\ olusturuldu, .env + ecosystem.config.js (SUNUCUNUNKI) tasindi
[7/9]  No pending migrations to apply.
[9/9]  API UP / DB UP / surum 2.9.0
```

**Sıfır elle müdahale.** Yükseltmeye özgü üç davranış da doğru çalıştı:

| Davranış | Sonuç |
|---|---|
| `.env` korundu | ✅ |
| **Sunucunun `ecosystem.config.js`'i korundu**, paketinki `.paket` olarak bırakıldı | ✅ (ama özet bozuk → BULGU-7) |
| Migration idempotent — "No pending" | ✅ |
| `app.eski-20260904_134416` **gerçek bir kurulum** (`ecosystem.config.js` + `dist/server.js` var) | ✅ |

Son satır BULGU-6 açısından önemli: bu koşumdan sonra `-GeriAl` **geçerli bir
adaya** bakıyor. Tuzak kapanmadı, yalnız şu an en yeni aday gerçek olduğu için
maskelendi — `app.eski-20260904_033846` (boş iskelet) hâlâ duruyor ve en yeni
aday silinirse yeniden en öne geçer.

`sysadmin` hesabı yükseltmeden **etkilenmedi** (veritabanına dokunulmuyor).

### Yanlış alarm — kayda geçsin
`PAKET.json` 13642 dosya beyan ediyor, zip'te 13643 dosya var. Bu **kusur
değil**: kapı bilerek `dosyaSayisi + 1` bekliyor, çünkü `PAKET.json` kendi
sayımına dahil edilmiyor (`kur.ps1` satır 204). Ölçen oturum önce bunu şüpheli
saydı, kodu okuyunca çürüttü.

### Yeni kapı görüldü
`[1/9]` artık satıcı aracını da kontrol ediyor:
`dist\tools\superadmin-olustur.cjs YOK - ... satici hesabi kurulamaz.`
Bu bir `Uyar` (kurulumu kesmiyor) — BULGU-2'nin tekrarını yakalar.

---

## 4. BULGULAR — durum tablosu

| # | Bulgu | Durum |
|---|---|---|
| 1 | Paket nokta ile başlayan girdileri kaybediyor | ✅ **düzeldi** (`.prisma` 16 girdi geldi) + dosya sayısı kapısı kondu |
| 2 | Satıcı hesabı paketten kurulamıyor | ✅ **düzeldi** — araç derlendi |
| 3 | `ecosystem.config.js` yolları sabit | ✅ **düzeldi** — `${KOK}` ile türetiliyor |
| 4 | Windows'ta `PM2_HOME` süreçleri ayırmıyor | ✅ yazıya geçti (`OKU-ONCE §5`) |
| 5 | `[module-profile]` yanıltıcı mesaj | ✅ **düzeldi** — satırları sayıyor |
| 6 | `kur.ps1 -GeriAl` adayı doğrulamıyor | ❌ **DÜZELMEDİ** (3. koşumdan sonra maskelendi, kapanmadı) |
| 7 | `[5/9]` ecosystem fark özeti kalıcı olarak kör | ❌ **YENİ — 3. koşumda bulundu** |

### BULGU-1 · düzeldi, bir kalıntıyla

Yeni pakette 124 nokta girdisi var ve `node_modules/.prisma` (16 girdi) geldi
— ölümcül olan yarısı kapandı. Ama **`node_modules/.bin` hâlâ 0 girdi.**

Artık zararsız: prisma `node <tam yol>` ile, satıcı aracı `node
dist/tools/...` ile çağrılıyor; kimse `.bin`'e bakmıyor. **Kalan risk
gelecekte:** `.bin` shim'ine dayanan yeni bir `npm run` script'i eklenirse
sessizce kırılır. Ya `.bin` pakete alınmalı ya da "paketlenmiş kurulumda
`npm run` kullanma, `node <yol>` kullan" kuralı yazıya geçmeli.

### BULGU-2 · düzeldi

`superadmin:kur` artık `node dist/tools/superadmin-olustur.cjs` — `tsx` ve
`.bin` gerekmiyor. Ölçüldü: boru girdisiyle çağrıldığında **donmadan**,
saniyeler içinde `❌ Bu script etkileşimli terminal ister` deyip `exit 1`
veriyor. Fail-loud kapısı çalışıyor.

⚠️ **Hesap hâlâ KURULMADI** — kurulması gerçek bir terminal ister ve
parola/PIN/TOTP bir kez gösterilir; otomatik koşturmak sırları log'a dökerdi.
Bu adım insan eliyle yapılacak:
`cd C:\TeksERP\app ; npm run superadmin:kur`

### BULGU-3 · düzeldi

```
out_file:   `${KOK}/logs/backend-out.log`
error_file: `${KOK}/logs/backend-err.log`
BACKUP_DIR: `${KOK}/backups`
PG_BIN_DIR: `${KOK}/pgsql/bin`
```

Doğrulama kapısı: `C:\TeksERP\logs\` **gerçekten doldu**
(`backend-out-0.log` 3.8 KB, `backend-err-0.log` 731 B). Boş klasör kök
türetiminin bozuk olduğunu gösterirdi; öyle değil.

### BULGU-5 · düzeldi

```
[module-profile] TEKSERP_PROFIL tanımlı değil; kurulumda 6/7 modül anahtarı
ZATEN VAR — yapılacak bir şey yok.
```

**"6/7" doğrudur, eksik olan bir kusur değil.** `MODULE_SETTING_KEYS` yedi
anahtar sayıyor; grandfathering migration'ı altısını yazıyor.
Yazılmayan `finance.enabled`'ı migration'ın kendi başlığı **olumsuz emsal**
olarak anıyor: o satır ne migration ne seed ile doğmuş, davranış yalnız
`asBoolean(undefined) → false` kod sigortasından geliyor. Bilinen boşluk.

DB'deki değerler: `production.enabled=true`, diğer altısı `false`.

### BULGU-6 · DÜZELMEDİ — **şu an canlı tuzak**

`-GeriAl` bloğu yeni `kur.ps1`'de **bayt bayt eskisiyle aynı**; aday
doğrulaması yok. Muhtemelen sırayla kaçtı: bu bulgu 03:27'de yazıldı, paket
03:24'te üretilmişti.

Makinenin bugünkü hâli: `C:\TeksERP\app.eski-20260904_033846\` **içinde yalnız
`.env` var** — `ilk-kurulum.ps1`'in bıraktığı boş iskeletin `kur.ps1 [5/9]`
tarafından kenara alınmış hâli. Yani "geri dönülecek sürüm" değil.

Bugün `kur.ps1 -GeriAl` çalıştırılırsa:

```powershell
& $pm2 delete $uygulama
Move-Item $appDir "$kok\app.basarisiz-$damga"   # CALISAN kurulum buraya gider
Move-Item $hedef $appDir                        # bos iskelet app\ olur
& $pm2 start ecosystem.config.js                # dosya YOK -> baslamaz
```

→ **çalışan sistem kapanır** ve sağlam kurulum `app.basarisiz-<damga>` adlı,
operatörün son bakacağı klasörde kalır.

⚠️ Asimetri load-bearing: **otomatik** geri alma kolu (`GeriAlOtomatik`) bu
kontrolü yapıyor (`if (-not (Test-Path ... "ecosystem.config.js")) { ... }`),
elle çağrılan `-GeriAl` kolunda yok. 2026-08-24'te düzeltilen "kaynağa değil
hedefe bakma" hatasının aynı sınıftan kardeşi: kontrol iki koldan yalnız
birine eklenmiş.

**Düzeltme (iki parça):**
1. `-GeriAl`, adayı uygulamadan ÖNCE doğrulasın (`ecosystem.config.js` +
   `dist\server.js`). Geçersizse **hiçbir şeye dokunmadan** dursun.
2. `ilk-kurulum.ps1`'in bıraktığı iskelet `app\`, `kur.ps1 [5/9]`'da
   `app.eski-*` yerine ayırt edilebilir bir ada taşınsın (ör.
   `app.iskelet-<damga>`) ki geri dönüş adayı sayılmasın.

---

### BULGU-7 · `[5/9]` ecosystem fark özeti kalıcı olarak kör · **YENİ**

### Belirti
Yükseltmede `[5/9]` şunu bastı — **aynı 13 anahtarı hem "yeni" hem "artık yok"**
diye listeliyor:

```
ecosystem.config.js: sunucununki KORUNDU (paketinki: ecosystem.config.js.paket)
  pakette YENI ayar : APP_ENV BACKUP_DIR BACKUP_HOUR ... PORT   -> gerekiyorsa elle ekleyin
  pakette ARTIK YOK : APP_ENV, BACKUP_DIR, BACKUP_HOUR, ... PORT -> sunucuda duruyor, gozden gecirin
```

Oysa iki dosya **birebir aynı** (aynı `Get-FileHash`, aynı 13 anahtar). Uyarı
tamamen asılsız.

### Kök sebep — değişken adı çakışması + tip kısıtı

```powershell
param([string]$Paket, ...)        # satır 43  — zip yolu, TIPLI
...
$paket  = & $anahtar $ecoPaket    # satır 393 — PowerShell harf duyarsız: AYNI degisken
$yeni   = @($paket  | Where-Object { $sunucu -notcontains $_ })
$dusen  = @($sunucu | Where-Object { $paket  -notcontains $_ })
```

`$Paket` `[string]` kısıtlı olduğu için 13 elemanlı dizi ona atanınca
PowerShell **boşlukla birleştirip tek string'e çeviriyor** (`$OFS`).
Sonuç:

- `$paket` = tek eleman, `"APP_ENV BACKUP_DIR ... PORT"`
- `$yeni` = o dev string (hiçbir anahtara eşit değil) → dolu
- `$dusen` = sunucunun 13 anahtarı (hiçbiri dev string'e eşit değil) → dolu

Çıktıdaki asimetri de bunu ele veriyor: **ilk liste boşlukla, ikincisi virgülle**
ayrılmış — aynı `-join ', '` iki farklı sonuç veremez; ilki zaten tek string.

Yalıtılmış test doğruladı:
```
tip: String · deger: [APP_ENV BACKUP_DIR HOST PORT] · eleman: 1 · yeni: 1 · dusen: 4
```
Aynı blok `[string]$Paket` parametresi olmadan koşturulunca doğru sonucu
(`yeni: 0, dusen: 0`) veriyor.

### Asıl zarar — gürültü değil, körlük
Bu blok tam olarak şu vaka için yazılmıştı (denetim 2026-08-29, BULGU-T1-020):
paketin `ecosystem.config.js`'i sahadakini eziyor ve **gece yedeği güncelleme
gecesi sessizce kapanıyordu**. Bugün dosya doğru korunuyor, ama **fark özeti
her koşumda aynı anlamsız çıktıyı** basıyor. Paket gerçekten yeni bir ayar
getirse operatör onu **ayırt edemez**. Kapı duruyor, ölçmüyor.

### Düzeltme
Satır 393-395'teki yerel değişkeni yeniden adlandırın (`$paketAnahtar` gibi).
Tek satırlık. `$Paket` parametresi fark özetinden **sonra kullanılmıyor**
(satır 146 · 147 · 159 · 264 — hepsi önce), o yüzden başka yan etki yok.

⚠️ Genel ders: `param()` içindeki tipli değişken adlarıyla çakışan yerel
değişken kullanmayın. PowerShell harf duyarsızdır ve tip kısıtı hatayı
**sessiz bir veri dönüşümüne** çevirir — istisna atılmaz.

---

## 5. İkinci koşumda çıkan YENİ gözlemler

Hepsi `backend-err-0.log`'dan; kurulumu kesmiyorlar.

| Gözlem | Sonucu | Karar |
|---|---|---|
| `[audit-guard] ⚠️ KORUMA KAPALI` | Audit kayıtları silinebilir/değiştirilebilir | Kullanıcı: **önemli değil** (bu prova için) |
| `[offsite] BACKUP_RCLONE_REMOTE boş` | Yedekler DB ile aynı diskte | Kullanıcı: **önemli değil** |
| Reboot kalıcılığı yok | Makine yeniden başlarsa backend kalkmaz | Kullanıcı: **önemli değil** |
| `[swagger] OpenAPI spec BOŞ` | `/api-docs` boş görünür | Kullanıcı: **istenen davranış** — prod'da API dokümanı görünmesin |

⚠️ `audit-guard` fabrikada başka bir hikâye olabilir. Açması tek komut ama
**`KURULUM.md`'nin numaralı adımlarında yok**, yalnız hata log'unda görünüyor —
sahada atlanması kolay:
```sql
ALTER DATABASE tekserp SET teks.audit_guard = 'on';   -- + pm2 restart
```

⚠️ `/api-docs` prod'da kapalı kalsın kararı alındı. Not: paketlenmiş kurulumda
onu **açmak da mümkün değil** — swagger glob'u `src/*.ts` arıyor, o da pakete
girmiyor. İleride istenirse ayrı iş.

⚠️ Reboot: makinede `TeksERP-Backend-Boot` adlı bir Görev Zamanlayıcı görevi
duruyor ama `C:\Etkili-Yazilim\pm2-boot.cmd`'yi çağırıyor — **o dosya bu
makinede yok**, görev boşa çalışıyor. Birinci provadan kalma.

---

## 6. `OKU-ONCE §6` kontrol listesi

| # | Madde | 1. koşum | 2. koşum | 3. koşum |
|---|---|---|---|---|
| 1 | Dokuz adım, **elle müdahale olmadan** | ❌ | ✅ | ✅ (yükseltme) |
| 2 | Migration 231 | ⚠ elle | ✅ | ✅ "No pending" |
| 3 | `/api/admin/health` yanıt veriyor | ✅ 401 | ✅ 401 | ✅ |
| 4 | Panel açıldı, sunucuyu buldu | ❌ | ❌ dosya yok | ✅ **kullanıcı bildirdi** |
| 5 | Yazıcı/Kantar "yüklü değil" demiyor | ❌ | ❌ | ✅ **COM port taraması yapıyor** |
| 6 | Tablet açıldı, sunucuyu buldu | ❌ | ❌ dosya yok | ✅ **kullanıcı bildirdi** (ama 2 sunucu listeledi → BULGU C) |
| 7 | Modüller bölümü | ⚠ DB'de var | ⚠ DB'de 6/7 (doğru) | ⚠ ekran ölçülemedi |
| 8 | Fabrika verisi yerinde | ✅ 4306 | ✅ 4306 | ✅ 4306 |
| 9 | `superadmin:kur` koştu | ❌ araç yoktu | ✅ araç + TTY kapısı | ✅ **hesap gerçekten kuruldu** |
| 10 | `logs\` gerçekten doldu | — | ✅ | ✅ |

⚠️ 4, 5 ve 6 numaralı maddeler **kullanıcı beyanıdır, ölçen oturum
doğrulamadı** — panel ve tablet o makinede değil, kullanıcının kendi
cihazlarında.

### ✅ Madde 5 — macOS derlemesi Windows'ta TUTTU

Provanın asıl gerekçelerinden biriydi ve **geçti.** Panelde Yazıcı/Kantar
sekmeleri **COM port taraması yapıyor**.

`OKU-ONCE §3.5`'teki ayrım şuydu: modül yüklenemezse ekranda
`"serialport yüklü değil (electron:rebuild gerekli)"` yazardı. Tarama yapması
modülün **yüklendiği ve çalıştığı** anlamına gelir — yani macOS'ta derlenen
`serialport` / `node-hid` Windows native ikilileri (`PE32+`) pakete doğru
girmiş ve çalışıyor.

**Sonucu:** panel paketini Windows'ta almak için bir zorunluluk yok;
`KURULUM.md D35`'teki "Windows'ta üretilmeli" kısıtı **backend/Electron
installer için** hâlâ geçerli olabilir ama bu paket özelinde macOS derlemesi
sahada çalıştı. Bir sonraki turda cihaz takılıysa gerçek bir baskı denemesi
bunu tamamlar.

---

## 7. Makinenin şu anki hâli

```
C:\TeksERP\
  app\                       calisan kurulum (v2.9.0, commit ab4bf170)
    .env                     JWT_SECRET bu makinede uretildi
    ecosystem.config.js      SUNUCUNUNKI korundu, yollar ${KOK} ile turetiliyor
    ecosystem.config.js.paket  paketinki (ikisi birebir ayni - bkz. BULGU-7)
  app.eski-20260904_134416\  GERCEK kurulum (6d7f1209) - gecerli geri donus adayi
  app.eski-20260904_033846\  ⚠ YALNIZ .env - bos iskelet, bkz. BULGU-6
  backups\
    premigrate_20260904_033846.dump   4 MB     (2. kosum)
    premigrate_20260904_134416.dump   4.17 MB  (3. kosum, dogrulandi)
  logs\  pg-setup\  pm2\  pm2-home\
  pgsql\bin -> C:\Program Files\PostgreSQL\16\bin   (junction)

veritabani : tekserp @ localhost:5432, rol tekserp, 231 migration, 4306 top
             sysadmin.isSystemAccount = true   (04:10'da araçla kuruldu,
             yükseltmeden etkilenmedi — modül kilidi ETKİN)
             admin.isSystemAccount = false     (1. koşumdaki elle yükseltme
             sıfırlamayla gitti — fabrikaya taşınmadı)
pm2        : tekserp-backend / fork / 1 instance / online
             PM2_HOME=C:\TeksERP\pm2-home, dump.pm2 kaydedildi
             ⚠ daemon YONETICI olarak kosuyor - komutlari yukseltilmis kabuktan ver
saglik     : {"status":"UP","api":"UP","db":"UP","version":"2.9.0"}
```

⚠ Klasörde **üç zip** duruyor: bozuk `8ba92ca7`, `6d7f1209` ve kurulu olan
`ab4bf170`. `OKU-ONCE §1` "tek zip olmalı" diyor; eskiler kanıt olarak
bilerek bırakıldı. Fabrikaya giderken **yalnız sonuncusu** taşınmalı.

⚠ `postgres` rolünün parolası bu makinede ölçüldü; **bu nota bilerek
yazılmadı** (`ilk-kurulum.ps1`'in "parola varsayılanı yoktur" kuralıyla aynı
gerekçe — bu dosya repoya gidiyor).

---

## 8. Sonraki oturum için — kalan işler

Kullanıcı kararlarından sonra gerçekten açık kalan üç şey:

1. **BULGU-6'yı düzelt** (`-GeriAl` aday doğrulaması + iskelet klasörün ayrı
   adı). Kod kaybettirmiyor ama çalışan sistemi kapatıyor; fabrikada bir gece
   vardiyasında bedeli yüksek.
2. **BULGU-7'yi düzelt** — tek satır (`$paket` → `$paketAnahtar`). Küçük ama
   `ecosystem.config.js` koruma kapısı bugün hiçbir şey ölçmüyor.
3. **`.bin` kararı** — pakete alınacak mı, yoksa "paketlenmiş kurulumda
   `npm run` yok, `node <yol>` var" kuralı mı yazılacak?

✅ **Satıcı hesabı KURULDU** (3. koşumdan önce, 04:10). `sysadmin` /
`isSystemAccount=true` / TOTP + PIN üretildi / audit'te tek satır
`SUPERADMIN_PROVISIONED`. Modül kilidi artık etkin: anahtarları yalnız o hesap
değiştirebilir.

⚠️ Satıcı hesabı kullanılmaya başlanınca **iki istemci-taraflı belirti** çıktı
(tablette "yetkin yok" ve cihaz onayı ekranı) — bunlar ayrı bir belgede:
`ISTEMCI-BULGULARI-2026-09-04.md`. Birincisi geliştirme ortamınca çürütüldü
(tablette bayat bundle), ikincisi hâlâ açık.

Ayrıca dokümantasyon:
- `OKU-ONCE §3.0` sıfırlama komutu düzeltilmeli (§3.1'deki yıkıcı varsayım)
- `KURULUM.md`'ye `audit_guard` adımı eklenmeli (bugün yalnız log'da)

Kapsam dışı sayılanlar: panel/tablet dağıtımı (kullanıcı kendisi yapıyor),
audit-guard · offsite yedek · reboot kalıcılığı (kullanıcı: bu prova için
önemli değil), `/api-docs` boşluğu (istenen davranış).

---

## 9. TASARIM KARARI — gizli hesap modeli geri alınıyor

Birinci koşumda satıcı hesabının gizlilik tasarımı ölçüldü ve **kullanıcı bu
modelden vazgeçme kararı aldı**: "bu kadar gizlilik iyi bir fikir değildi",
kaynak kodda güncellenecek.

Ölçülen yapı, tek bayrağa (`User.isSystemAccount`) asılı **iki bağımsız
mekanizma** taşıyor. Biri sökülüp diğeri bırakılabilir:

**KİLİT (yetki) — kalabilir**
- `services/helpers/system-account.registry.ts` — kilit defteri
- `routes/feature-flag.routes.ts` → `flagWriteGuard` / `moduleLockedBranch`
- `services/auth.service.ts` → `getEffectivePermissions` → `["*"]`

**GİZLİLİK (görünmezlik) — sökülecek**

| Ne | Nerede |
|---|---|
| Liste filtreleri (`visibleUserWhere` · `VISIBLE_USER` · `VISIBLE_ACTOR` · `SQL_VISIBLE_USER`) | `auth.service` · `permission-management.service` (2) · `inventory.service` · `work-session.service` (2) · `system-log.service` · `reports/production.report.service` |
| Audit maskeleme (`maskSystemActor` · `SQL_ACTOR_*`) | `reports/audit.report.service` (3 — `SELECT` + `GROUP BY` birlikte) · `system-log.service` · `device.service` |
| 404 kapısı | `middlewares/system-account.middleware.ts` + `routes/admin.routes.ts` (`/users/:id` üzerindeki `blockSystemAccountTarget`) |
| Ortak kaynak | `services/helpers/system-account.helper.ts` |

⚠ **İki tuzak:**
1. **`settings-password` uçları açıkta kalır.** `admin.routes.ts`'teki üç uç
   (`GET`/`PUT`/`DELETE /settings-password`) `requireSystemAccountOr404` ile
   korunuyor. Gizlilik sökülürken bunlara **yeni bir kapı** verilmezse
   (ör. `admin:settings`) ayarlar parolasını kimse yönetemez.
2. **`getEffectivePermissions` erken dönüyor** — sistem hesabı için izin
   satırlarına hiç bakmadan `["*"]`. Hesap görünür olunca panelde izinleri boş
   görünüp fiilen her şeyi yapabilecek. Ya UI'da "tüm yetkiler" olarak
   gösterilmeli ya `["*"]` gerçek izin atamasıyla değiştirilmeli.

> Yollar derlenmiş `dist/` üzerinden çıkarıldı; **dosya adları güvenilir,
> satır numaraları `.ts` karşılıklarında kayar.**

---

## 10. Tekrarlanmaması gerekenler

| Tuzak | Ne oldu |
|---|---|
| Paketin "sağlam" demesine güvenmek | 1. koşumda `[1/9]` "paket saglam" dedi, paket 140 dosya eksikti. Kapı yanlış soruyu soruyordu — 2. koşumda dosya sayısı kapısı kondu ve doğru soruyu sordu. |
| `pm2 online` = çalışıyor sanmak | Backend restart döngüsündeyken de `online` görünür. Tek ölçüt `/health`. |
| Windows'ta `PM2_HOME` süreçleri ayırır sanmak | Ayırmaz. Pipe tektir; ayrılan yalnız `dump.pm2` ve loglar. |
| Yükseltme seviyesini karıştırmak | Yönetici daemon + yetkisiz istemci = `EPERM`, "uygulama yok" gibi okunur. |
| `app\` içinde terminal bırakmak | 2. koşumda sıfırlama tam bu yüzden düştü ("Device or resource busy"). `kur.ps1`'in uyarısı gerçek. |
| Makinenin temiz olduğunu varsaymak | 1. koşumda makinede 3 eski veritabanı ve parolası bilinmeyen bir rol vardı. Ölç, varsayma. |
| Kontrolü iki koldan yalnız birine koymak | `GeriAlOtomatik` doğruluyor, `-GeriAl` doğrulamıyor (BULGU-6). |
| Sıfırlama komutunu okumadan koşmak | `OKU-ONCE §3.0` kurulum kökünü siliyor; bu makinede paket ve dump o kökün içindeydi. |
