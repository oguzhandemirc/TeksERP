# `kur.ps1` — otomatik geri alma açığı ve onarımı

> ✅ **UYGULANDI — 2026-08-25.** Onarılmış script **`deploy/kur.ps1`** (repoya ilk kez alındı;
> orijinal, prod'daki hâli: `docs/history/kur.ps1.2026-08-24.orig`). Harness
> `deploy/test/run-harness.sh` — pwsh ile 12/12; **aynı harness orijinal script'te S1'de
> `app\`'ı gerçekten siliyor** (negatif kanıt: 8/4). **Bu notun doğru çıkmayan tarafları:**
> - "repoda karşılığı neredeyse aynı … sonraki paketle gelir" → **repoda YOKTU** ve script
>   kendini güncelleyemez (paket `app\` altına iner) → sunucuya **elle kopyalanır** (`deploy/README.md`).
> - **Yama 3 uygulanmadı**: `pm2 delete` sonrasına düşmek zorunda olduğu için `Fail` fabrikayı
>   kapalı bırakırdı ("hiçbir şeye dokunmadan iptal" tutmazdı); Yama 1 + pm2 geri kaldırma aynı sonucu verir.
> - Yama 1'in kendi `exit 1` yolu da yalnız komut basıyordu → mevcut `app\` **pm2 ile yeniden başlatılır**.
> - "Remove-Item koşulsuz" → ikisi de koşullu; kusur iki koşulun **farklı şeye bakması** (hedef ↔ kaynak).
> - "Move-Item hedef doluysa düşer" → düşmez, **içine taşır** (`app\app.eski-…`); `Stop` bu yüzden `Remove-Item`'da load-bearing.
> - Yama 4 yalnız script sonuna değil, **`GeriAlOtomatik`'in ilk satırına** ([6/9] çağrıları cwd `app\` içindeyken koşuyor) + `Fail` + tüm çıkışlara.
> - `-GeriAl` (elle) modunda aynı sınıf açık vardı (taşıma düşerse pm2 kapalı kalır) → kapatıldı.
> Windows'a özgü kilit davranışı burada ölçülemedi; ilk kullanımda kopya kurulumla dene (README).

**Dosya:** `C:\Etkili-Yazilim\kur.ps1` (repoda karşılığı neredeyse aynı)
**İlgili satırlar:** `166-198` (`GeriAlOtomatik` + `[5/9]` bloğu)
**Durum:** açık HÂLÂ duruyor. 2026-08-24 deploy'unda **tetiklenmedi** ama ona güvenilerek değil,
elle `app.guvenlik-<damga>` kopyası alınarak geçildi.

> **Prod'a dokunma gerekmez** — dev'de düzeltilip GitHub'a atılacak, sonraki paketle gelir.

---

## Açık nedir

`[5/9]` bloğu üç adımı tek `try` içine alıyor ve hata olursa `GeriAlOtomatik` çağırıyor:

```powershell
# --- [5/9] Eskisini kenara al, yenisini yerlestir ---------------------------
try {
  Move-Item $mevcut $eskiAd -Force -ErrorAction Stop     # (1) çalışan kurulumu kenara al
  New-Item -ItemType Directory -Path $appDir | Out-Null  # (2) boş app\ aç
  Copy-Item "$temp\*" $appDir -Recurse -Force            # (3) yeni sürümü kopyala
  Copy-Item $envYedek (Join-Path $appDir ".env") -Force
} catch { GeriAlOtomatik "Dosya yerlestirme basarisiz: $($_.Exception.Message)" }
```

`GeriAlOtomatik` ise şunu yapıyor:

```powershell
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $eskiAd) { Move-Item $eskiAd $appDir -Force }
Push-Location $appDir
...
```

**Sorun: `Remove-Item` koşulsuz, `Move-Item` koşullu.** Yani "sil" her zaman çalışıyor,
"geri koy" yalnız kaynak varsa. İkisinin koşulu aynı olmalıydı.

### Ölümcül senaryo — adım (1) başarısız olursa

| | Durum |
|---|---|
| `$appDir` (`C:\Etkili-Yazilim\app`) | **YERİNDE, çalışan kurulum** — taşınamadı |
| `$eskiAd` (`app.eski-<damga>`) | **YOK** — taşıma hiç gerçekleşmedi |

`GeriAlOtomatik` çalışır:

1. `Test-Path $appDir` → **true** → `Remove-Item $appDir -Recurse -Force` → **çalışan kurulum silinir**
2. `Test-Path $eskiAd` → **false** → geri koyacak bir şey yok, atlanır
3. `Push-Location $appDir` → klasör yok, **hata fırlatır**, alttaki mesajlar hiç basılmaz

**Sonuç:** hiçbir şey yapmamış olsa sistem çalışmaya devam edecekti; "otomatik geri alma"
tam da hata anında çalışan kurulumu yok etti. Geriye kalan tek geri dönüş yolu bir önceki
deploy'un `app.eski-*` klasörü — yani **bir sürüm daha eskiye** düşülür.

### Adım (1)'i ne düşürür

`Move-Item` klasördeki **açık bir tanıtıcıya (handle)** takılır:

- `app\` içinde açık bir PowerShell/CMD oturumu (**en sık sebep**)
- Explorer penceresi, VS Code, log görüntüleyici, yedekleme/antivirüs taraması
- **`kur.ps1`'in kendisi:** satır `200`'de `Set-Location $appDir` yapıyor ve **oradan hiç
  çıkmıyor**. Aynı oturumda ikinci kez koşulursa kendi bıraktığı cwd yüzünden (1) düşer.

`pm2 delete` (satır 163) node sürecini kapatıyor, o taraf temiz — kalan risk insan/araç kaynaklı.

---

## Onarım

### Yama 1 — `GeriAlOtomatik`'i kaynak yoksa DURDUR (asıl düzeltme)

`kur.ps1:168-184` içindeki iki satırı şununla değiştir:

```powershell
  # ── GERI ALMA ON KOSULU: geri koyacak bir sey YOKSA HICBIR SEYI SILME ────────
  # Move-Item (adim 1) dusmusse $eskiAd hic olusmamistir ve $appDir HALA CALISAN
  # kurulumdur. Eski kod burada kosulsuz Remove-Item yapip onu yok ediyordu.
  if (-not (Test-Path $eskiAd)) {
    Uyar "GERI ALMA YAPILMADI - '$eskiAd' yok, yani eski kurulum hic kenara alinamamis."
    Uyar "Mevcut '$appDir' klasorune DOKUNULMADI; buyuk ihtimalle hala saglam."
    Uyar "Muhtemel sebep: app\ uzerinde acik dosya kilidi (Explorer/terminal/editor)."
    Write-Host ""
    Write-Host "    Elle baslat:  Push-Location '$appDir'; & '$pm2' start ecosystem.config.js; & '$pm2' save; Pop-Location"
    Write-Host "    Sonra dogrula: curl http://localhost:4000/health"
    exit 1
  }

  if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force -ErrorAction Stop }
  Move-Item $eskiAd $appDir -Force -ErrorAction Stop
```

İki ek değişiklik, ikisi de bilinçli:

- `Remove-Item` artık `-ErrorAction Stop`. Eskiden `SilentlyContinue`'ydu: kısmî silme
  sessizce geçiyor, ardından hedef dolu olduğu için `Move-Item` düşüyor ve ortada
  **yarı silinmiş `app\`** kalıyordu. Şimdi ilk hatada duruyor, `app.eski-*` sağlam kalıyor.
- `Move-Item`'a da `-ErrorAction Stop` — geri koyma başarısızsa `Push-Location` boş
  klasöre girmesin, hata net görünsün.

### Yama 2 — `Push-Location`'ı koru

Yama 1'den sonra bu noktaya ancak `app\` geri konmuşken gelinir, ama savunmayı ikile:

```powershell
  if (-not (Test-Path (Join-Path $appDir "ecosystem.config.js"))) {
    Write-Host "  !! Geri alindi ama '$appDir\ecosystem.config.js' yok - pm2 baslatilamiyor." -ForegroundColor Red
    exit 1
  }
  Push-Location $appDir
```

### Yama 3 — kilidi ÖNCEDEN yakala (asıl çözüm: hataya hiç düşme)

`[4/9]` ile `[5/9]` arasına ekle. Taşımayı **deneme amaçlı** yapıp geri alıyor:

```powershell
# --- [4b/9] app\ kilitli mi - YIKICI ADIMDAN ONCE olc ------------------------
Adim "[4b/9] app\ klasoru tasinabilir mi kontrol ediliyor..."
if ($mevcut -eq $appDir) {
  $deneme = "$kok\app.kilit-testi-$damga"
  try {
    Move-Item $appDir $deneme -ErrorAction Stop     # tasinabiliyor mu?
    Move-Item $deneme $appDir -ErrorAction Stop     # hemen geri koy
    Ok "app\ kilitli degil"
  } catch {
    if (Test-Path $deneme) { Move-Item $deneme $appDir -Force }   # yarida kalmadigindan emin ol
    Fail @"
app\ klasoru TASINAMIYOR - kurulum baslatilmadi, hicbir sey degismedi.
  Sebep: $($_.Exception.Message)
  Bu klasore bakan her seyi kapat: Explorer penceresi, terminal (cd ile disari cik),
  VS Code, log goruntuleyici. pm2 zaten durduruldu.
  Acik tanitici arayan komut (Sysinternals):  handle.exe "$appDir"
"@
  }
}
```

> Bu, `Fail` ile çıkar — yani **DB'ye ve `app\`'a hiç dokunulmadan** iptal. En ucuz sonuç bu.

### Yama 4 — script kendi cwd'sini `app\` içinde bırakmasın

`Set-Location $appDir` (satır `200`) load-bearing: `npm ci`, `prisma migrate deploy` ve
`pm2 start` oradan koşuyor. Ama script **bitişte oradan çıkmıyor** ve aynı oturumda ikinci
koşumu kendi eliyle bozuyor.

Sona (`[9/9]` sonrası, "KURULUM TAMAM" bloğundan önce) ekle:

```powershell
Set-Location $kok   # cwd'yi app\ icinde birakma - ayni oturumdaki ikinci kosum kendi kilidine takilir
```

Aynısı `Fail`/`exit` yollarında da olmalı; en temizi `try { ... } finally { Set-Location $kok }`
ile sarmak, ama tek satırlık ekleme de bugünkü sorunu kapatır.

---

## Dev'de nasıl doğrulanır

Üretimde denenmez. Bir kopya kurulumla:

```powershell
# 1) Tek kullanimlik ortam
New-Item -ItemType Directory C:\kurtest\app -Force | Out-Null
Copy-Item C:\Etkili-Yazilim\app\ecosystem.config.js C:\kurtest\app\
Copy-Item C:\Etkili-Yazilim\app\.env C:\kurtest\app\

# 2) KILIDI YARAT - ikinci bir PowerShell penceresinde:
Set-Location C:\kurtest\app     # <- Move-Item'i dusuren tanitici budur

# 3) $kok'u C:\kurtest'e cevrilmis kur.ps1 kopyasini kos
```

| Beklenen | Yama 3 varsa | Yama 3 yoksa, Yama 1 varsa |
|---|---|---|
| Sonuç | `[4b/9]`'da temiz iptal, `app\` yerinde | `[5/9]` düşer, **`app\` yine yerinde**, elle başlatma komutu basılır |
| Eski davranış | — | **`app\` silinir**, geri konacak bir şey yok |

Üçüncü kontrol: yamalardan sonra **normal** bir deploy'un hâlâ çalıştığını doğrula
(kilit yokken) — `app.eski-<damga>` oluşmalı ve `/health` UP dönmeli.

---

## Neden bu iş bekletilmemeli

- `kur.ps1` her deploy'da koşuyor ve açık **tam da bir şey ters gittiği anda** tetikleniyor —
  yani en kötü anda ikinci bir hasar üretiyor.
- Tetikleyicisi banal: `app\` klasörüne bakan açık bir pencere.
- 2026-08-24'te açığın etrafından elle kopya alınarak dolanıldı; bu, prosedürün parçası
  değil, o günkü oturumun aldığı bir önlemdi. Kalıcı çözüm script'te.

## Özet

| Yama | Dosya / satır | Ne yapar | Öncelik |
|---|---|---|---|
| 1 | `kur.ps1:174-175` | Kaynak yoksa silme — **açığı kapatır** | 🔴 şart |
| 2 | `kur.ps1:176` | `Push-Location`'ı korur | 🟡 ucuz savunma |
| 3 | `[4/9]` ↔ `[5/9]` arası | Kilidi önceden yakalar, temiz iptal | 🟠 önerilir |
| 4 | `kur.ps1:200` + son | cwd'yi `app\` içinde bırakmaz | 🟠 önerilir |

Yama 1 tek başına veri kaybını önler. 3 ve 4 ise hataya hiç düşülmemesini sağlar.
