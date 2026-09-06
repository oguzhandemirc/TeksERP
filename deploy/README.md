# `deploy/` — sunucu kurulum script'leri

Fabrika sunucusundaki (SAHINSRV, `C:\TeksERP`) **paket tabanlı** deploy'un
kaynağı. Akış ve gerekçe: [`docs/ops/DEPLOY-RUNBOOK.md §3`](../docs/ops/DEPLOY-RUNBOOK.md).

| Dosya | Sunucudaki yeri | Ne yapar |
|---|---|---|
| `kur.ps1` | `C:\TeksERP\kur.ps1` | Paketi doğrular → `premigrate_` yedeği (pg_restore ile doğrulanır) → pm2 delete → çalışanı `app.eski-<damga>` olarak kenara alır → yeni sürümü `app\`'a yerleştirir → `migrate deploy` → pm2 start + save → `/health`. `-GeriAl` ile son kuruluma döner. |
| `paketle.ps1` | **GELİŞTİRME MAKİNESİNDE** repo kökünden koşulur (sunucuda build klonu YOK — düzeltildi 2026-09-07). Windows şart değil: `pwsh -NoProfile -File deploy/paketle.ps1 -Cikti <klasor>` | Repo kökünde (`Teks-Erp`'nin üstünde) koşar: `npm ci` → `prisma generate` → `tsc --removeComments` → dist (`.js.map`siz) + `prisma/{schema,migrations}` (seed YOK) + `public` + `assets` + `package*.json` + `ecosystem.config.js` + `Teks-Erp/deploy/prisma.config.prod.js` → `prisma.config.js` + (varsayılan) üretim `node_modules` + `PAKET.json` → `tekserp-backend-<damga>-<commit>.zip`. Windows **şema motoru** kapıları: `PRISMA_CLI_BINARY_TARGETS=windows` + varlık + MZ imzası (yabancı platform motoru paketten atılır). Sunucudaki kopyayla bayt-bayt aynı olmalıdır — md5'i sabitleme, `Get-FileHash` ile karşılaştır. |

> **`paketle.ps1` sunucuda klon KÖKÜNDE untracked duruyordu.** Repoya `deploy/` altına alındı —
> kökte olsaydı `git pull` untracked dosyanın üstüne yazmayı reddederdi. Kök kopyası istenirse
> silinir; iki kopya aynı olduğu sürece hangisi koşarsa koşsun fark etmez. Script çalışma
> dizinini `(Get-Location)` ile alır → **her zaman klon kökünden** `.\deploy\paketle.ps1` diye
> çağrılır, kendi klasöründen değil.

### ⚠️ Sunucuda İKİ klon var — paket `D:`'den üretilir (2026-08-25 sunucu ölçümü)

| | *(sunucuda build klonu yok — paket geliştirme makinesinde üretilir)* | |
|---|---|---|
| checkout | **tam**, `main` dalının ucu (2026-09-02'ye dek `adnansahin`) | sparse — yalnız `Teks-Erp/`, **`deploy/` diskte YOK** |
| refspec | `+refs/heads/*` | `+refs/heads/main` — yalnız `main`'i görür (2026-09-02'den sonra bu yeterli; eskiden `adnansahin`'i görmediği için 7 commit geride kalmıştı) |
| kullanım | **paket üretimi + `kur.ps1` kopyası** | kullanma; kullanılacaksa önce `git sparse-checkout add deploy` |

2026-08-25 deploy'u `D:`'den yapıldı; dokümanlar o güne dek `C:`'yi anlatıyordu (yanlıştı).

### ⚠️ 2026-09-02 — `adnansahin` dalı EMEKLİ, build klonu `main`'e alınır (tek seferlik sunucu adımı)

Müşteri dalı kalktı (`docs/design/MODUL-BAYRAK-TASARIM.md` §0); paket artık `main`'den üretilir.
Build klonu hâlâ `adnansahin`'deyse `git pull` "upstream yok" diye düşer — sıradaki paketlemeden ÖNCE:

```powershell
# SUNUCUDA — BUILD klonu (D:)
cd <repo kökü>   # geliştirme makinesi
git fetch --prune origin
git checkout main
git pull
git branch -D adnansahin      # yerel kalıntı; origin'de zaten yok
```

`paketle.ps1` dal adını yalnız `PAKET.json`a yazar, `kur.ps1` onu yalnız basar — dal adına bağlı bir kapı YOK, `main`'den üretilen paket aynı sözleşmeyle kurulur.

### `kur.ps1` ↔ `paketle.ps1` sözleşmesi (2026-08-25'te doğrulandı)

| `kur.ps1` bekler | `paketle.ps1` üretir |
|---|---|
| `dist\server.js`, `package.json`, `package-lock.json`, `ecosystem.config.js`, `prisma.config.js`, `prisma\schema.prisma`, `prisma\migrations`, `public`, `assets\fonts` | hepsi ✅ (`assets` tümüyle kopyalanır) |
| `prisma.config.ts` OLMAMALI (ikisi birden → 400) · `src\` varsa "eski paketle" uyarısı | `.ts` kopyalanmaz, `src` kopyalanmaz ✅ |
| `PAKET.json`: `commit` `dal` `uygulamaSurumu` `uretimZamani` `ureten` `migrationSayisi` `nodeModulesDahil` `calismaAgaciTemiz` | manifestte var (+ `nodeSurumu`, `npmSurumu`, `dosyaSayisi`, `toplamBayt`, `serverJsSha256` — `kur.ps1` bunları okumaz) ✅ |
| `node_modules` varsa `npm ci` atlanır | varsayılan DAHİL; `-NodeModulesHaric` ile ince paket |

**Bilinen davranışlar (değiştirilmedi):** kirli çalışma ağacında `Read-Host` ile sorar — `-Zorla`
eşdeğeri YOK, Claude oturumunda asılı kalır → paketi **temiz** klondan üret. `--removeComments`
yüzünden sunucu boot'unda `[swagger] OpenAPI spec BOŞ` uyarısı çıkar (zararsız, Swagger üretimde
mount edilmiyor). Başlık yorumu "sunucuda çalışmaz, kaynak kod yoktur" der — bayat: 2026-08-24'ten
beri sunucudaki sparse klondan koşuyor. `Fail` yollarında cwd `Teks-Erp\` içinde kalır (zararsız).

## ⚠️ `kur.ps1` KENDİNİ GÜNCELLEYEMEZ — elle kopyalanır

Script paketi `app\` altına açar; `kur.ps1` ise bir üst dizinde (`C:\TeksERP\`)
yaşar. Bu dosyayı pakete koymak onu **`app\kur.ps1`** olarak indirir ve çalışan kopyaya
dokunmaz. Repodaki sürüm değiştiğinde:

```powershell
# SUNUCUDA (Claude Code oturumu yapabilir) — yönetici PowerShell, BUILD klonu (D:)
cd <repo kökü>   # geliştirme makinesi
git pull
Get-FileHash .\deploy\kur.ps1, C:\TeksERP\kur.ps1 | Format-Table Path,Hash
# Hash'ler FARKLIYSA:
Copy-Item .\deploy\kur.ps1 C:\TeksERP\kur.ps1 -Force
```

> Hash karşılaştırması `.gitattributes` (`*.ps1 eol=crlf`) sayesinde `core.autocrlf`
> ayarından bağımsızdır — iki dosya da CRLF checkout edilir. Kopya, sıradaki
> `kur.ps1 -Paket …` koşumundan **önce** yapılmalı ki deploy'u güncel sürüm yürütsün.
> `kur.ps1` repoda her değiştiğinde (son: 2026-08-25 "Son gece yedegi" satırı) hash yeniden
> farklı çıkar ve aynı üç satır tekrarlanır.

## 2026-08-25 onarımı — otomatik geri alma açığı

Kaynak: `docs/history/KURPS1-GERIALMA-ACIGI-DEV-YAPILACAKLAR.md` (prod oturumunun tespiti;
doğrulama + düzeltmeler oradaki başlık bloğunda). Özet:

- **Açık:** `GeriAlOtomatik` "sil" kararını HEDEFE (`app\` var mı), "geri koy" kararını
  KAYNAĞA (`app.eski-*` var mı) bakarak veriyordu. `[5/9]`'daki ilk `Move-Item` düşerse
  (açık dosya kilidi — Explorer/terminal/editor) `app.eski` hiç oluşmaz ama `app\` silinirdi:
  **çalışan kurulum yedeksiz yok olurdu.** 2026-08-24 deploy'unda tetiklenmedi; elle
  güvenlik kopyasıyla dolanıldı.
- **Yama 1 (asıl):** `app.eski-*` yoksa **hiçbir şey silinmez**, mevcut `app\` pm2 ile
  **yeniden başlatılır** (prod notu yalnız komut basıyordu → fabrika kapalı kalırdı), `exit 1`.
  `Remove-Item`/`Move-Item` artık `-ErrorAction Stop` + try/catch (yarım silinmiş `app\`
  üzerine `Move-Item` hedefi var sanıp `app.eski`'yi **içine** taşırdı).
- **Yama 2:** geri koyduktan sonra `ecosystem.config.js` yoksa `Push-Location`'a girilmez.
- **Yama 4:** `KokeDon` — cwd `app\` içinde bırakılmaz: `GeriAlOtomatik`'in ilk satırı
  (`[6/9]`'dan gelen çağrılar `Set-Location $appDir` sonrasıdır — `Remove-Item` kendi altını
  keserdi), `Fail`, `[7/9]`/`[9/9]` çıkışları ve script sonu.
- **Yama 3 (kilit sondası) BİLİNÇLİ UYGULANMADI:** Yama 1 + pm2 geri kaldırma aynı sonucu
  verir; sonda `pm2 delete` sonrasına düşmek zorunda olduğu için fazladan iki taşıma riski
  taşır ve "hiçbir şeye dokunmadan iptal" vaadi tutmazdı (pm2 zaten durmuş olurdu).
- **`-GeriAl` (elle) modu:** taşıma düşerse pm2 geri kaldırılır — aynı hata sınıfı.

### Doğrulama

Tek harness (`kur-gerialma.harness.ps1`, pwsh 7 ve Windows PowerShell 5.1) + iki koşucu:
dosya sözdizimi + `GeriAlOtomatik` üç senaryoda sahte klasörlerle (`app.eski` yok → `app\`
dokunulmadı ve pm2 start çağrıldı · var → geri kondu · var ama `ecosystem.config.js` yok →
geri kondu, pm2 çağrılmadı) + eski script'e karşı negatif kanıt (aynı senaryoda `app\` siliniyor).
Ölçüldü 2026-08-25: **macOS** (pwsh 7.6) yeni **12/12**, orijinal **8/4**; **fabrika sunucusu**
(Windows PowerShell 5.1) **birebir aynı** 12/12 ↔ 8/4 (kanıt:
`docs/history/dev-gonderi-2026-08-25/kanit/harness-onarilmis-vs-orijinal.txt`).

```bash
# macOS/Linux (bash + pwsh)
deploy/test/run-harness.sh deploy/kur.ps1                              # onarılmış sürüm → 12/12 beklenir
deploy/test/run-harness.sh docs/history/kur.ps1.2026-08-24.orig        # orijinal → S1'de app\ silinir (4 kırmızı)
PWSH=/yol/pwsh deploy/test/run-harness.sh deploy/kur.ps1               # pwsh PATH'te değilse
```

```powershell
# Windows (yalnız PowerShell — bash/pwsh gerekmez), repo kökünden
powershell -ExecutionPolicy Bypass -File deploy\test\run-harness.ps1 -Script deploy\kur.ps1
powershell -ExecutionPolicy Bypass -File deploy\test\run-harness.ps1 -Script docs\history\kur.ps1.2026-08-24.orig
```

> pwsh bu Mac'te sistemde kurulu değil: `brew install --cask powershell@preview` pkg için
> sudo şifresi ister (arka planda geçmez). Microsoft'un `osx-arm64.tar.gz` sürümü herhangi bir
> klasöre açılıp `PWSH=` ile gösterilebilir — sisteme kurulum gerekmez.

**Windows'a özgü kilit davranışı (`Move-Item` açık tanıtıcıya takılır) burada ölçülemez** —
ilk kullanımda bir kopya kurulumla dene: ikinci bir pencerede `cmd /c "cd /d C:\kurtest\app
&& pause"` açıkken `kur.ps1`'i koş; beklenen `[5/9]` düşer, `app\` yerinde kalır, pm2 geri kalkar.
