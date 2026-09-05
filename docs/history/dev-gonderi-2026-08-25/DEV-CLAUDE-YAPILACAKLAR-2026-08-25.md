# Dev makinesindeki Claude'a — fabrika deploy'u sonrası yapılacaklar

> ✅ **UYGULANDI — 2026-08-25, dev makinesi.** §1 A–F: **altısı da koda karşı doğrulandı ve tuttu**
> (A `/health` 6 alan, `lastBackup` yalnız `/api/admin/health` · C yerelde `tsc --removeComments`
> derlemesinde 67/67 pragma ölçüldü, yeni regex örnekle sağlandı · D izlenen 11 script'in hepsi
> index'te LF, `.gitattributes` sıfır blob değiştirdi). §2'ye DOKUNULMADI. §3 ATLANDI (kullanıcı
> yürütüyor). §4 klon uyuşmazlığı beş dokümana işlendi (`D:` build klonu esas).
> **Gönderilen `test/*.ps1` birebir alınmadı:** `run-harness-win.ps1` var olmayan
> `harness-win.ps1`'i arıyordu (dosya adı uyuşmazlığı) — bunun yerine tek harness
> (sahte pm2 platforma göre `.cmd`/`.sh`) + `deploy/test/run-harness.ps1` (dosya adı düzeltilmiş,
> çıktı TEMP'e, çocuk süreç koşan PowerShell'in kendisi). `kanit/` olduğu gibi burada.

> **Kim yazdı:** Fabrika sunucusundaki (SAHINSRV) Claude Code oturumu · **Tarih:** 2026-08-25
> **Neden sana geldi:** Sunucudaki deploy anahtarı **salt-okunur** — `git push` "The key you are
> authenticating with has been marked as read only" ile düşüyor, `gh` kurulu değil, credential
> helper yok. Aşağıdaki repo değişikliklerinin hepsi **dev makinesinden** yapılmalı.
> Dal: `adnansahin`.

---

## 0) Sahada ne oldu (bağlam — değişiklik istemiyor)

`docs/history/SURUM-2026-08-25-DEPLOY.md` reçetesinin **1. adımı (BACKEND) uygulandı.**

| | |
|---|---|
| Kurulan commit | **`dee217f`** (reçete `32d71191` diyordu; aradaki 2 commit yalnız `docs/` + `deploy/`, backend kodu birebir aynı) |
| Paket | `tekserp-backend-20260825_145620-dee217f.zip` · 114.5 MB · 191 migration · SHA256 `A297E284…` |
| Üretildiği klon | **`D:\tekserp-build\tekserp`** (tam checkout, dalın ucunda) — `C:\Etkili-Yazilim\tekserp` DEĞİL |
| Migration | 2'si de uygulandı. `color_name_unique_live` yumuşak kapıyı atlamadı → index kuruldu (ön ölçüm 0 mükerrer, 88 renk). `reason_preset_rework_kind` → enum açıldı, boot uzlaştırması 6 satır yazdı |
| Kesinti | **~18 sn** (15:01:51 → 15:02:09) |
| Geri dönüş | kod `C:\Etkili-Yazilim\app.eski-20260825_145930` · veri `backups\premigrate_20260825_145930.dump` · ayrıca tam kopya `D:\tekserp-build\app-guvenlik-kopyasi-20260825_145601` |

**Deploy sonrası doğrulama — hepsi yeşil.** Reçetenin (a)(b)(c)'sine ek olarak repo'nun salt-okunur
bekçileri `.env` takasıyla **canlı `tekserp` DB'sine** yöneltilerek koşuldu:

| Bekçi | Sonuç |
|---|---|
| `test_db_invariants` | **91/91** — §5'te `colors_nameFoldColor_key` yeşil, §8'de `tr_fold_color` IMMUTABLE + gövde parmak izi eşleşti |
| `test_schema_drift` | **4/4** — allowlist dışı fark yok |
| `test_fold_contract` | **40/40** — §2b `tr_fold_color` ≡ `foldColorNameForCompare`, **63 529 BMP örneğinde birebir** |
| `find_fold_duplicates` | Mükerrer yok |

⚠️ **Electron ve APK dağıtılmadı** — bkz. §3.

---

## 1) Repo'da düzeltilecekler

### A. `deploy/kur.ps1` — "Son yedek:" satırı bayat (kozmetik ama yanıltıcı)

Script sonunda `Write-Host "  Son yedek: $($h.lastBackup.name)"` var ve **her deploy'da boş
basıyor.** Sebep hata değil, sözleşme değişikliği: `src/app.ts:319-337`'ye göre 2026-08-09
denetiminde (F-CORE-GUV-002) `GET /health` **beş alana donduruldu** (`status`, `message`, `api`,
`db`, `version` + `time`); `lastBackup` yetki isteyen `GET /api/admin/health`'e taşındı.
`kur.ps1` hâlâ `/health`'ten okuyor.

Öneri: satırı kaldır ya da yedeği dosya sisteminden göster
(`Get-ChildItem $backupDir -Filter *.dump | Sort-Object LastWriteTime -Desc | Select -First 1`).
Boş bir "Son yedek:" satırı operatöre "yedek yok" diye okunuyor — oysa yedekler canlı.

### B. `docs/ops/URETIM-KONTROL-LISTESI.md` §E — aynı bayatlık

Madde: *"**Yedekleme canlı:** `/health` → `lastBackup` **null DEĞİL**"*. Artık `/health`'te böyle
bir alan **yok**; bu madde bugün mekanik olarak kırmızı. `/api/admin/health`'e yönlendir.
(Dosyanın başında zaten "TARİHSEL" uyarısı var ama §E "deploy sonrası doğrulama" diye hâlâ
kullanılıyor.)

### C. `deploy/paketle.ps1` — yorum sayacı **yanlış alarm** veriyor

`paketle.ps1:98-99` şunu basıyor:

```
yorum temizligi: dist\services icinde kalan // satiri = 67 (0 olmali)
```

Ölçtüm: **67'nin 67'si `//# sourceMappingURL=...` pragması, gerçek yorum sayısı 0.**
`--removeComments` kusursuz çalışıyor. Sayaç `^\s*//` ile bakıyor, pragmayı eliyor değil.

```powershell
# Select-String -Path ... -Pattern '^\s*//'
#   ->  -Pattern '^\s*//(?!#\s*sourceMappingURL)'
```

Her deploy'da "0 olmalı" yazıp 67 gösteren bir satır, gerçekten yorum sızdığı gün fark
edilmez hale getiriyor.

### D. `.gitattributes` YOK — iki somut sonuç

Sunucudaki **iki klonda da `core.autocrlf=true`** ve repoda `.gitattributes` yok.

1. **`deploy/test/run-harness.sh` Windows checkout'ta CRLF alıyor** → `bash` ile koşturulamaz
   (`\r` hataları). Zaten sunucuda `pwsh` de yok; harness bu kutuda olduğu gibi koşmuyor (§E).
2. **Reçetedeki hash kontrolü `autocrlf`'e bağımlı:**
   `Get-FileHash .\deploy\kur.ps1, C:\Etkili-Yazilim\kur.ps1` — bugün ikisi de CRLF olduğu için
   eşleşiyor, ama `autocrlf=false` bir klondan bakan biri **sahte "farklı" görür** ve gereksiz
   yere yeniden kopyalar. (Ölçüm: sunucudaki `kur.ps1` 17383 bayt / CRLF, depo blob'u 17042 / LF.)

Öneri:

```gitattributes
*.ps1 text eol=crlf
*.sh  text eol=lf
```

### E. Windows'ta koşan bir geri-alma harness'ı yok

`deploy/test/run-harness.sh` **bash + pwsh** istiyor; fabrika sunucusunda **ikisi de yok**
(yalnız Windows PowerShell 5.1 + Git Bash var). Onarımı doğrulamak için bu oturumda bir
Windows koşucusu yazdım ve `deploy/README.md`'deki 12/12 ↔ 8/12 iddiasını **birebir yeniden
ürettim** (§2). Repoya almak istersen iki parça:

- `deploy/test/kur-gerialma.harness.ps1` içinde **tek satır**: `$pm2 = Join-Path $kok "fakepm2.sh"`
  → PowerShell `.sh` çalıştıramaz; Windows kolunda `.cmd` olmalı
  (`@echo off` + `echo %* >> "%~dp0pm2.log"`).
- `run-harness.sh`'in PowerShell karşılığı (~60 satır, aynı 3 senaryo / 12 kontrol).
  Sunucuda duruyor; istersen o oturumdan yapıştırmasını iste.

### F. Reçetenin "UYGULANDI" kutusu

`docs/history/SURUM-2026-08-25-DEPLOY.md` sonundaki liste — 0 ve 1 işaretlenebilir:

```markdown
- [x] 0) kur.ps1 güncel        (2026-08-25, sunucu Claude oturumu — hash eşit doğrulandı)
- [x] 1) Backend + 2 migration + kontroller (a)(b)(c)   → dee217f, kesinti 18 sn
- [ ] 2) Electron dağıtıldı
- [ ] 3) APK kuruldu
```

---

## 2) Doğrulanan iddialar — **DEĞİŞTİRME**, doğru çıktılar

- **`kur.ps1` geri-alma onarımı gerçek.** `deploy/README.md`'nin macOS ölçümünü (yeni 12/12,
  orijinal 8/12) Windows'ta birebir yeniden ürettim:
  onarılmış **12/12** · `docs/history/kur.ps1.2026-08-24.orig` ile aynı kodu taşıyan sunucu kopyası
  **8/12** (S1'de çalışan `app\` siliniyordu). Onarılmış sürüm sunucuya kopyalandı, yerinde 12/12.
- **`paketle.ps1` bayt-bayt aynı iddiası DOĞRU.** Depo blob'u = sunucudaki kopya:
  md5 `7a48a8cbcc991c62e12d885977ef1b3e`, 9803 bayt, 0 CR. (Windows working-copy'de CRLF görünür —
  o `autocrlf` artefaktı, blob temiz. README'nin md5'i de tam bu.)
- **Reçetenin renk ölçümü tuttu:** "25.08 02:00 prod yedeğinde mükerrer katlanmış renk 0" →
  canlıda deploy öncesi de 0 ölçüldü, index kuruldu.
- **"Yeni izin YOK" doğru:** boot'ta `[permission-catalog] 70 izin kodu güncel — eklenecek satır yok.`

### Hâlâ ölçülmemiş olan (README bunu zaten söylüyor)

`deploy/README.md` sonundaki **Windows'a özgü kilit senaryosu** (ikinci pencerede
`cmd /c "cd /d C:\kurtest\app && pause"` açıkken kurulum → `[5/9]` düşmeli, `app\` yerinde
kalmalı, pm2 geri kalkmalı) **bu deploy'da denenmedi.** Harness bu davranışı ölçemiyor;
S1 senaryosu yalnız "app.eski yok" dalını kanıtlıyor, `Move-Item`'ın açık tanıtıcıya
gerçekten takıldığını değil. Üretimde denenmesi riskli — dev'de bir kopya kurulumla yapılmalı.

---

## 3) Sıradaki iş: **Electron → APK** (sıra pazarlık dışı)

Reçete "BACKEND → ELECTRON → APK" diyor; backend **bitti**, diğer ikisi bekliyor.

⚠️ **Bu ikisi fabrika sunucusunda DERLENEMEZ** — kutuda Python, VS Build Tools, Android SDK ve
JDK17 yok (`node-gyp` "Could not find any Python installation" veriyor). Yani **dev makinesinin
işi**:

```bash
cd Electron && npm ci && npm run build:win
```

Çıkan kurulum masaüstü PC'lere dağıtılmalı. **Aciliyeti var:** bu sürümde masaüstü backend'in
yeni uçlarını çağırıyor (`POST /rolls/:id/scrap`, `quick-start`) — dağıtım yapılana kadar
**"bitmiş topu yeniden üretime alma" sahada görünmüyor.** Backend hazır, istemci değil.

APK zaten hazır dosya: `TeksERP-2.9.6-vc53.apk` (SHA-256 `ee011235e551f569…`).
⚠️ **Kaldırıp kurma** — AsyncStorage ile çevrimdışı kuyruktaki gerçek toplar silinir;
vc53 > vc52 olduğu için üzerine kurulum sorunsuz.

---

## 4) Sunucunun git durumu (dev'in bilmesi gereken)

| | `D:\tekserp-build\tekserp` | `C:\Etkili-Yazilim\tekserp` |
|---|---|---|
| HEAD | **`dee217f`** (dalın ucu) | `935f180` (7 commit geride) |
| refspec | `+refs/heads/*` (geniş) | `+refs/heads/main` (**dar** — `adnansahin`'i fetch'te görmez) |
| sparse-checkout | yok (tam) | **`Teks-Erp` ile sınırlı** → `deploy/` diskte YOK |
| `core.autocrlf` | true | true |

**Doküman ↔ gerçek uyuşmazlığı:** `deploy/README.md` ve reçete paketlemeyi
`C:\Etkili-Yazilim\tekserp` üzerinden anlatıyor; o klonda `deploy/` sparse kümesinde **değil**
ve dal dar refspec yüzünden normal `git fetch` ile gelmiyor. Bu deploy `D:` klonundan yapıldı
(tuzakların ikisi de yok). Dokümanı `D:`yi işaret edecek şekilde güncellemek ya da `C:` için
gereken iki ön adımı (`git sparse-checkout add deploy` + `git fetch origin
adnansahin:refs/remotes/origin/adnansahin`) reçeteye yazmak gerekiyor — aksi halde sıradaki
oturum ya "dal yok" sanacak ya da bayat kod paketleyecek.
