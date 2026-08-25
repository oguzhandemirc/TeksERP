# `deploy/` — sunucu kurulum script'leri

Fabrika sunucusundaki (SAHINSRV, `C:\Etkili-Yazilim`) **paket tabanlı** deploy'un
kaynağı. Akış ve gerekçe: [`docs/ops/DEPLOY-RUNBOOK.md §3`](../docs/ops/DEPLOY-RUNBOOK.md).

| Dosya | Sunucudaki yeri | Ne yapar |
|---|---|---|
| `kur.ps1` | `C:\Etkili-Yazilim\kur.ps1` | Paketi doğrular → `premigrate_` yedeği (pg_restore ile doğrulanır) → pm2 delete → çalışanı `app.eski-<damga>` olarak kenara alır → yeni sürümü `app\`'a yerleştirir → `migrate deploy` → pm2 start + save → `/health`. `-GeriAl` ile son kuruluma döner. |
| `paketle.ps1` | `C:\Etkili-Yazilim\tekserp\paketle.ps1` (klon kökü) | **HENÜZ REPODA DEĞİL** — sunucudaki kopya tek kaynak. İlk fırsatta buraya alınmalı. |

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
