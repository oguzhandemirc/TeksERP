# `deploy/` — sunucu kurulum script'leri

Fabrika sunucusundaki (SAHINSRV, `C:\Etkili-Yazilim`) **paket tabanlı** deploy'un
kaynağı. Akış ve gerekçe: [`docs/ops/DEPLOY-RUNBOOK.md §3`](../docs/ops/DEPLOY-RUNBOOK.md).

| Dosya | Sunucudaki yeri | Ne yapar |
|---|---|---|
| `kur.ps1` | `C:\Etkili-Yazilim\kur.ps1` | Paketi doğrular → `premigrate_` yedeği (pg_restore ile doğrulanır) → pm2 delete → çalışanı `app.eski-<damga>` olarak kenara alır → yeni sürümü `app\`'a yerleştirir → `migrate deploy` → pm2 start + save → `/health`. `-GeriAl` ile son kuruluma döner. |
| `paketle.ps1` | klon kökünden koşulur: `C:\Etkili-Yazilim\tekserp` → `.\deploy\paketle.ps1 -Cikti C:\Etkili-Yazilim` | Repo kökünde (`Teks-Erp`'nin üstünde) koşar: `npm ci` → `prisma generate` → `tsc --removeComments` → dist (`.js.map`siz) + `prisma/{schema,migrations}` (seed YOK) + `public` + `assets` + `package*.json` + `ecosystem.config.js` + `Teks-Erp/deploy/prisma.config.prod.js` → `prisma.config.js` + (varsayılan) üretim `node_modules` + `PAKET.json` → `tekserp-backend-<damga>-<commit>.zip`. Sunucudaki kopyayla **bayt-bayt aynı** (md5 `7a48a8cb…`, 2026-08-25). |

> **`paketle.ps1` sunucuda klon KÖKÜNDE untracked duruyordu** (`C:\Etkili-Yazilim\tekserp\paketle.ps1`).
> Repoya `deploy/` altına alındı — kökte olsaydı `git pull` untracked dosyanın üstüne yazmayı
> reddederdi. Kök kopyası istenirse silinir; iki kopya aynı olduğu sürece hangisi koşarsa koşsun
> fark etmez. Script çalışma dizinini `(Get-Location)` ile alır → **her zaman klon kökünden**
> `.\deploy\paketle.ps1` diye çağrılır, kendi klasöründen değil.

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

Script paketi `app\` altına açar; `kur.ps1` ise bir üst dizinde (`C:\Etkili-Yazilim\`)
yaşar. Bu dosyayı pakete koymak onu **`app\kur.ps1`** olarak indirir ve çalışan kopyaya
dokunmaz. Repodaki sürüm değiştiğinde:

```powershell
# SUNUCUDA (Claude Code oturumu yapabilir) — yönetici PowerShell
cd C:\Etkili-Yazilim\tekserp
git sparse-checkout list                       # 'deploy' yoksa:  git sparse-checkout add deploy
git pull
Copy-Item .\deploy\kur.ps1 C:\Etkili-Yazilim\kur.ps1 -Force
(Get-FileHash .\deploy\kur.ps1).Hash -eq (Get-FileHash C:\Etkili-Yazilim\kur.ps1).Hash   # True olmalı
```

> Klon sparse-checkout ile dar tutuluyor; `deploy/` sparse kümesinde değilse `git pull`
> dosyayı **indirmez** ve `Copy-Item` "bulunamadı" der — önce `git sparse-checkout add deploy`.
> Kopya, sıradaki `kur.ps1 -Paket …` koşumundan **önce** yapılmalı ki deploy'u onarılmış
> sürüm yürütsün. Bir kez kopyalandıktan sonra script her deploy'da aynı kalır; yeni bir
> onarım gelirse aynı üç satır tekrarlanır.

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

macOS'ta `pwsh` ile: dosya sözdizimi + `GeriAlOtomatik` üç senaryoda sahte klasörlerle
(`app.eski` yok → `app\` dokunulmadı ve pm2 start çağrıldı · var → geri kondu · var ama
`ecosystem.config.js` yok → geri kondu, pm2 çağrılmadı) + eski script'e karşı negatif kanıt
(aynı senaryoda `app\` siliniyor). Ölçüldü 2026-08-25: yeni **12/12**, orijinal **8/4**.

```bash
deploy/test/run-harness.sh deploy/kur.ps1                              # onarılmış sürüm → 12/12 beklenir
deploy/test/run-harness.sh docs/history/kur.ps1.2026-08-24.orig        # orijinal → S1'de app\ silinir (4 kırmızı)
PWSH=/yol/pwsh deploy/test/run-harness.sh deploy/kur.ps1               # pwsh PATH'te değilse
```

> pwsh bu Mac'te sistemde kurulu değil: `brew install --cask powershell@preview` pkg için
> sudo şifresi ister (arka planda geçmez). Microsoft'un `osx-arm64.tar.gz` sürümü herhangi bir
> klasöre açılıp `PWSH=` ile gösterilebilir — sisteme kurulum gerekmez.

**Windows'a özgü kilit davranışı (`Move-Item` açık tanıtıcıya takılır) burada ölçülemez** —
ilk kullanımda bir kopya kurulumla dene: ikinci bir pencerede `cmd /c "cd /d C:\kurtest\app
&& pause"` açıkken `kur.ps1`'i koş; beklenen `[5/9]` düşer, `app\` yerinde kalır, pm2 geri kalkar.
