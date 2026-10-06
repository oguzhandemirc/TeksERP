# =============================================================================
# TeksERP Backend - SURUM PAKETI URETICI
# =============================================================================
# NEREDE CALISIR: GELISTIRME MAKINENDE, repo kokunde (Teks-Erp klasorunun ustu).
#                 Sunucuda CALISMAZ - sunucuda kaynak kod yoktur (build klonu da YOK).
#
# ⚠ WINDOWS SART DEGIL. macOS/Linux'ta PowerShell 7 (`pwsh`) ile kosar ve
#   URETILEN PAKET WINDOWS ICINDIR - script bunu ozel olarak sagliyor:
#   `PRISMA_CLI_BINARY_TARGETS=windows` ile sema motorunu indirir, MZ imzasini
#   dogrular, yabanci platform motorlarini ATAR, `node_modules/.bin`i bilerek
#   disarida birakir (macOS sembolik baglari Windows'ta ise yaramaz; `kur.ps1`
#   prisma'yi `.bin` uzerinden DEGIL dogrudan cagirir).
#   Olculdu 2026-09-07: macOS'ta uretilen paket 117,4 MB, schema-engine-windows.exe
#   19,8 MB MZ-dogrulanmis, 13723 girdi = beyan.
#   Kullanim: pwsh -NoProfile -File deploy/paketle.ps1 -Cikti <klasor>
#
# NE URETIR: tekserp-backend-<tarih>-<commit>.zip
#            Sunucudaki kur.ps1 bu paketi bekler.
#
# KULLANIM:
#   .\paketle.ps1                      # node_modules DAHIL (varsayilan, onerilen)
#   .\paketle.ps1 -NodeModulesHaric    # ince paket; sunucu npm ci kosar (internet ister)
#   .\paketle.ps1 -Cikti D:\paketler   # zip'in yazilacagi klasor
#   .\paketle.ps1 -WebPanelHaric      # EMEKLI (B6): etkisiz, web paneli zaten pakete girmez
#   .\paketle.ps1 -Prova              # PROVA paketi: etiket/push YOK, repo DEGISMEZ (asagida)
#
# PROVA KIPI (-Prova): yayin provasi icin paket (bkz. arsiv 2026-09-27 thinkpad-1 provasi).
#   Normal kosum `backend-v<surum>` etiketini atar ve UZAGA ITER, repodaki
#   `package.json`a surumu yazar ve surum belgesini doldurur - yani provanin kendisi
#   bir YAYIN kaydi birakiyordu (belgesi olmayan bir surum icin etiket). Prova kipinde:
#     * surum belgesi ISTENMEZ (uyari basilir), belgeye YAZILMAZ;
#     * repodaki package.json DEGISMEZ - surum yalniz paketin icindeki kopyaya
#       `<surum>-prova.<commit>` olarak yazilir (/health bunu basar, gercek surumle
#       karismaz);
#     * etiket ATILMAZ, push YAPILMAZ;
#     * zip adi `tekserp-backend-prova-...`, PAKET.json `prova: true` - kur.ps1
#       bu paketi `-ProvaKabul` verilmeden KURMAZ (fabrikaya kazara prova gitmesin).
#   Kirli agactan uretilen NORMAL pakette de etiket atilmaz: etiket HEAD'i gosterir,
#   paket ise HEAD'de olmayan degisiklik tasir - etiket yalan olurdu.
#
# TASARIM NOTLARI (degistirmeden once oku):
#   * dist\*.js.map PAKETE GIRMEZ. Kaynak haritalar `../../src/...` yoluna atif
#     yapar; sunucuda src OLMADIGI icin ise yaramazlar (238 dosya / 2,2 MB).
#     Icerlerinde TypeScript GOMULU DEGIL (inlineSources kapali) - yani onlari
#     gondermek kaynak sizdirmazdi, sadece olu agirlik olurdu.
#   * prisma\seed*.ts PAKETE GIRMEZ ve prisma.config'in `seed` kancasi da yok.
#     Canli fabrikada seed kosarsa veriyi dusurur; yapisal olarak imkansiz kilariz.
#   * prisma.config.TS degil, deploy\prisma.config.prod.js -> prisma.config.JS
#     gonderilir. Ikisi birden bulunmasin: hangisinin okundugu belirsizlesir.
#   * prisma\migrations CALISMA ZAMANINDA da okunuyor (process.cwd()/prisma/
#     migrations), yalniz migrate deploy icin degil. Cikarilamaz.
#   * .env PAKETE GIRMEZ. Sunucunun kendi .env'i yerinde korunur (kur.ps1 tasir).
#   * WEB PANELI (dist-web) PAKETE GIRMEZ (2026-09-30, B6): tek tuketicisi emekli
#     tunelin patron kabuguydu. Web hedefi yalniz demo imajinda (Dockerfile) derlenir;
#     eski .env'deki WEB_DIST_DIR'i kur.ps1 uyarir.
#   * HIZMET DUZENI (Dagitim v2, docs/design/GUNCELLEYICI.md §4): KORUMALI paket runtime\ altina
#     iki Rust ikilisini (tekserp-hizmet.exe = backend hizmet konagi, tekserp-guncelleyici.exe =
#     guncelleyici) koyar; yoksa paket URETILMEZ. Ikisi SYSTEM/hizmet olarak kosar: pakete ancak
#     OLCULEREK girer (PE32+ x64 · kunye adi · TEST capasi YOK) ve runtime\ imzali kapsamdadir.
#     hizmet\ (dizin/izin + hizmet kaydi betikleri) ve gecis\ (pm2 -> hizmet gecisi) de imzali
#     kapsamda (Teks-Erp/src/lib/license/integrity-scope.ts). GECIS DONEMI: pm2 dosyalari
#     (kur.ps1 · ilk-kurulum.ps1 · ecosystem.config.js · pm2-boot.cmd) paket kokunde KALIR.
#     Paket icerigi asagidaki $KOK_BETIKLERI / $ALT_BETIKLER / $HIZMET_IKILILERI listelerindedir;
#     bekci: Teks-Erp/scripts/test_paket_kapsami.ts (her calistirilabilir girdi imzali kapsamda).
# =============================================================================
# PowerShell 7 SART (uc argumanli Join-Path, $IsWindows): 5.1'de npm ci'den SONRA
# anlasilmaz hatayla duser; -Korumali Windows x64'te bile "bu hostta uretilemez" derdi.
#Requires -Version 7.0
[CmdletBinding()]
param(
  [switch]$NodeModulesHaric,
  [switch]$WebPanelHaric,
  [string]$Cikti = "."
,
  # Kucuk/buyuk hane bir KARARDIR - elle verilir (ornek: -Surum 3.0.0).
  [string]$Surum,
  # Yayin provasi paketi - baslik "PROVA KIPI".
  [switch]$Prova,
  # ESKI KANAL YOLU (kanallar.json backend blogu; adnansahin pm2, donuk - O15'te kalkar). VERILMEZSE
  # ORTAK PAKET: kimlik deploy/dagitim.json'dan (dagitim-kapisi.mjs), paket musteri/kanal TASIMAZ;
  # firma adi lisanstan, guncelleme grubu kiradan, filigran kurulumda (TEK-ORTAK-PAKET.md O11a).
  [string]$Musteri,
  # KORUMALI paket: esbuild minify + isim karartma -> bytenode .jsc + paketin
  # kendi runtime node ikilisi + yorumsuz Prisma semasi. Bayt kodu OS/mimari/V8'e
  # kilitli oldugundan yalniz HEDEF platformda uretilir (Windows x64 -> win-x64).
  # Verilmezse bugunku tsc --removeComments paketi (eski bicim, sistem Node) uretilir.
  [switch]$Korumali,
  # Korumali paketin hedef platformu (bayt kodu kilidi). Bugun yalniz win-x64
  # sahaya cikiyor; linux-x64 Docker yapiti ayri dilim (2f).
  [ValidateSet("win-x64", "linux-x64")][string]$Hedef = "win-x64",
  # Korumali paketin filigranina girecek kurulum kimligi (UUID). YALNIZ eski kanal yolunda (-Musteri);
  # ortak paket kurulum kimligi tasimaz (filigran kurulumda).
  [string]$Kurulum,
  # Native lisans cekirdegi (URETIM derlemesi, test capasiz). Verilmezse
  # Teks-Erp\native\lisans-cekirdek\dist-uretim\<dosya> (CI/cargo-xwin ciktisi).
  [string]$NativeYol,
  # SIFRELI MODUL (Faz 2d): yalniz -Korumali ile; build-korumali.mjs --sifrele'ye gecer. Verilmezse
  # bugunku SIFRESIZ korumali paket. Muhurleme anahtari (modul anahtari dosyasi) REPO, PAKET ve CI
  # DISIDIR: hazirlik makinesinde `modul-anahtari.ts uret` ile dogar; CI'da -Sifrele reddedilir.
  [switch]$Sifrele,
  # Sifrelenecek paketler: "hepsi" ya da katalogdaki paket adlari (virgullu).
  [string]$SifreliPaketler = "hepsi",
  # Modul anahtari dizini (verilmezse build-korumali'nin varsayilani ~/.tekserp/satici-hazirlik/modul-anahtarlari).
  [string]$ModulAnahtarDizini,
  # HIZMET IKILILERI (Dagitim v2): tekserp-hizmet.exe + tekserp-guncelleyici.exe'nin durdugu dizin.
  # Verilmezse Teks-Erp\native\target\release (yerel `cargo build --release`). CI: korumali-paket.yml
  # win-x64 yapitinin runtime\ dizini (uretim capali, test capasiz derleme).
  [string]$HizmetIkiliDizini)
$ErrorActionPreference = "Stop"

# --- PAKET ICERIGI: tek liste (bekci test_paket_kapsami bu uc diziyi okur) ------------------------
# Kok betikleri: GECIS DONEMI boyunca pm2 duzeni de bu paketle kurulur (kur.ps1 -Paket) - hicbiri CIKMAZ.
$KOK_BETIKLERI = @("kur.ps1", "ilk-kurulum.ps1", "yedekle.ps1", "pm2-boot.cmd", "uzaktan-kos.ps1", "bakim-rolu.ps1")
# Alt dizindeki betikler: repo `deploy/<yol>` -> paket `<yol>`; goreli yollar ikisinde AYNI
# (gecis\..\hizmet\ , gecis\..\yedekle.ps1). hizmet\ ve gecis\ imzali kapsamdadir.
$ALT_BETIKLER = @("hizmet/backend-hizmeti.ps1", "hizmet/guncelleyici-hizmeti.ps1", "hizmet/kanal-adlari.ps1", "hizmet/sema-hizasi.ps1", "gecis/gecis.ps1", "gecis/gecis-yardimci.cjs")
# runtime\ altina giren Rust hizmet ikilileri (yalniz KORUMALI pakette; yoksa paketleme DURUR).
$HIZMET_IKILILERI = [ordered]@{ "tekserp-hizmet.exe" = "tekserp-hizmet"; "tekserp-guncelleyici.exe" = "tekserp-guncelleyici" }

# Dusen derlemenin sahnesi (%TEMP%\tekserp-backend-*, ~500 MB) diskte kalmasin: Fail ve betik kapsamindaki trap
# sahneyi siler (yalniz GetTempPath altindaysa). thinkpad-1 D8: dusen dort derleme SystemTemp'te 4 sahne birakti.
$script:SahneYolu = $null
function SahneyiTemizle {
  $y = $script:SahneYolu
  $script:SahneYolu = $null
  if (-not $y) { return }
  $tmp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if (-not [System.IO.Path]::GetFullPath($y).StartsWith($tmp, [System.StringComparison]::OrdinalIgnoreCase)) { return }
  if (Test-Path -LiteralPath $y) {
    Remove-Item -LiteralPath $y -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  (yarim sahne silindi: $y)" -ForegroundColor DarkGray
  }
}
function Fail($m) { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; SahneyiTemizle; exit 1 }
trap { SahneyiTemizle; break }
function Adim($m) { Write-Host ""; Write-Host "$m" -ForegroundColor Cyan }

# Hizmet ikilisi pakete OLCULEREK girer: Windows PE32+ x64, uretim derlemesi (test capasi YOK: capayi
# ortamdan okuyan `test-anchor` derlemesi SYSTEM guncelleyicisinde guven kokunu disariya acardi) ve
# kunye adi beklenen. Kunye (ikiliyi calistirmak) yalniz Windows'ta; korumali paket zaten Windows'ta uretilir.
function HizmetIkilisiOlc([string]$yol, [string]$beklenenAd, [string]$capaKipi) {
  if (-not (Test-Path -LiteralPath $yol)) {
    Fail "hizmet ikilisi yok: $yol  (-HizmetIkiliDizini ver: CI korumali-paket.yml win-x64 yapitinin runtime\ dizini ya da cargo build --release)"
  }
  $b = [System.IO.File]::ReadAllBytes($yol)
  if ($b.Length -lt 1024 -or $b[0] -ne 0x4D -or $b[1] -ne 0x5A) { Fail "$beklenenAd Windows ikilisi DEGIL (MZ yok): $yol" }
  $pe = [BitConverter]::ToInt32($b, 0x3C)
  if ($pe -lt 64 -or ($pe + 6) -gt $b.Length -or $b[$pe] -ne 0x50 -or $b[$pe + 1] -ne 0x45 -or $b[$pe + 2] -ne 0 -or $b[$pe + 3] -ne 0) {
    Fail "$beklenenAd PE imzasi yok: $yol"
  }
  $makine = [BitConverter]::ToUInt16($b, $pe + 4)
  if ($makine -ne 0x8664) { Fail "$beklenenAd x64 degil (makine 0x$($makine.ToString('X4'))): $yol" }
  if ([System.Text.Encoding]::GetEncoding(28591).GetString($b).Contains("TEKSERP_TEST_CAPASI")) {
    Fail "$beklenenAd TEST CAPALI derleme (test-anchor) - uretim paketine GIRMEZ: $yol"
  }
  $surum = $null
  if ($IsWindows) {
    $k = (& $yol kunye | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "$beklenenAd kunye kosmadi (cikis $LASTEXITCODE): $yol" }
    try { $j = $k | ConvertFrom-Json } catch { Fail "$beklenenAd kunye JSON degil: $k" }
    if ($j.ad -cne $beklenenAd -or $j.hedef -cne "windows") { Fail "$beklenenAd kunye beklenen degil: $k" }
    if (($j.PSObject.Properties.Name -contains "testCapasi") -and ($j.testCapasi -ne $false)) {
      Fail "$beklenenAd kunye testCapasi=$($j.testCapasi) - uretim paketine GIRMEZ"
    }
    # G3: guncelleyicinin gomulu capa kipi paketin (bayt kodu, kanaldan) kipiyle AYNI olmali (konak capa tasimaz).
    if ($beklenenAd -eq "tekserp-guncelleyici" -and $j.capaKipi -cne $capaKipi) {
      Fail "$beklenenAd capa kipi '$($j.capaKipi)', paket '$capaKipi' (hazirlik kanali: npm run derle:hizmetler:win:hazirlik + -HizmetIkiliDizini)"
    }
    $surum = [string]$j.surum
  }
  return [ordered]@{
    surum  = $surum
    boyut  = $b.Length
    sha256 = (Get-FileHash -LiteralPath $yol -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$repo = (Get-Location).Path
$proj = Join-Path $repo "Teks-Erp"
if (-not (Test-Path (Join-Path $proj "package.json"))) {
  Fail "Teks-Erp\package.json bulunamadi. Bu scripti REPO KOKUNDE calistir."
}

# --- Sifreli modul kapisi (Faz 2d) -------------------------------------------
# Anahtar hicbir zaman CI'a, repoya ya da pakete girmez; yalniz .tkmod (muhurlu) pakete girer.
$anahtarTam = $null
if ($Sifrele) {
  if (-not $Korumali) { Fail "-Sifrele yalniz -Korumali ile: sifreli modul korumali derlemenin parcasidir." }
  if ($env:CI -or $env:GITHUB_ACTIONS) { Fail "-Sifrele CI'da KOSMAZ: modul muhurleme anahtari CI'a girmez (anahtarin bulundugu makinede, dizin elle verilir)." }
  if ($ModulAnahtarDizini) {
    $anahtarTam = [System.IO.Path]::GetFullPath($ModulAnahtarDizini)
    if ($anahtarTam.StartsWith([System.IO.Path]::GetFullPath($repo), [System.StringComparison]::OrdinalIgnoreCase)) { Fail "Modul anahtar dizini REPO ICINDE olamaz (anahtar depoya/pakete girmez): $anahtarTam" }
    if (-not (Test-Path $anahtarTam)) { Fail "Modul anahtar dizini yok: $anahtarTam" }
  }
}

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP Backend - surum paketi uretiliyor"
Write-Host "================================================================"

# --- Commit kimligi ---------------------------------------------------------
$commit = (& git -C $repo rev-parse --short HEAD).Trim()
$dal    = (& git -C $repo rev-parse --abbrev-ref HEAD).Trim()
$kirli  = (& git -C $repo status --porcelain)
if ($kirli) {
  Write-Host ""
  Write-Host "  ! UYARI: calisma agaci temiz DEGIL. Paket commit'lenmemis degisiklik icerecek:" -ForegroundColor Yellow
  $kirli | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
  $c = Read-Host "  Devam edilsin mi? (e/h)"
  if ($c -ne 'e') { Fail "Iptal edildi." }
}
Write-Host "  dal=$dal  commit=$commit"

# --- Musteri (kanal) kimligi ------------------------------------------------
# -Musteri <kod>: paket kanalin kimligini (pm2 adi + urun adi) kanallar.json
# backend blogundan alir (kanal-kapisi.mjs dogrular; bilinmeyen kanal = DUR).
# Kimlik pakete FILIGRAN olur (PAKET.json); YOKSA kanal-disi paket + uyari.
$backendPm2 = $null
$backendUrun = $null
$backendHizmet = $null
$backendLisans = $null
$lisansVarsayilan = $null
if ($Musteri) {
  Write-Host ""
  Write-Host "  musteri=$Musteri (kanal kimligi kanallar.json backend blogundan)"
  $kanalCik = & node (Join-Path $repo "scripts/kanal-kapisi.mjs") backend-paketle $Musteri
  if ($LASTEXITCODE -ne 0) { Fail "kanal kapisi: '$Musteri' kanali dogrulanamadi (yukaridaki cikti)." }
  foreach ($satir in @($kanalCik)) {
    if ($satir -cmatch '^TEKSERP_PM2_AD=(.+)$') { $backendPm2 = $Matches[1] }
    elseif ($satir -cmatch '^TEKSERP_BACKEND_URUN=(.+)$') { $backendUrun = $Matches[1] }
    elseif ($satir -cmatch '^TEKSERP_HIZMET_ADI=(.+)$') { $backendHizmet = $Matches[1] }
    elseif ($satir -cmatch '^TEKSERP_LISANS_SUNUCUSU=(.+)$') { $backendLisans = $Matches[1] }
    elseif ($satir -cmatch '^TEKSERP_LISANS_VARSAYILAN=(.+)$') { $lisansVarsayilan = $Matches[1] }
  }
  if (-not $backendLisans -or -not $lisansVarsayilan) { Fail "kanal kapisi lisans satici kimligini (lisansSunucusu/varsayilan) vermedi." }
  if (-not $backendPm2 -or -not $backendUrun -or -not $backendHizmet) { Fail "kanal kapisi backend kimligini (pm2Ad/urunAdi/hizmetAdi) vermedi." }
  # Hizmet adi setup.exe'de SCM adi, olay kaynagi ve NT SERVICE\<ad> olur (GUNCELLEYICI.md §4.2 ad kurali).
  if ($backendHizmet -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { Fail "kanal kaydinin backend.hizmetAdi gecersiz: $backendHizmet" }
  Write-Host "    pm2 adi : $backendPm2"
  Write-Host "    hizmet  : $backendHizmet"
  Write-Host "    urun    : $backendUrun"
} else {
  # ORTAK PAKET (O11a): kimlik dagitim kaydindan; musteri/kanal/kurulum TASINMAZ (backendKanal null).
  if ($Kurulum) { Fail "-Kurulum yalniz eski kanal yolunda (-Musteri) verilir - ortak paket kurulum kimligi tasimaz, filigran kurulumda." }
  Write-Host ""
  Write-Host "  ORTAK PAKET (kimlik deploy/dagitim.json; firma adi lisanstan, grup kiradan)"
  $dagitimCik = & node (Join-Path $repo "scripts/dagitim-kapisi.mjs") backend-paketle
  if ($LASTEXITCODE -ne 0) { Fail "dagitim kapisi: ortak backend kimligi dogrulanamadi (yukaridaki cikti)." }
  foreach ($satir in @($dagitimCik)) {
    if ($satir -cmatch '^TEKSERP_BACKEND_URUN=(.+)$') { $backendUrun = $Matches[1] }
    elseif ($satir -cmatch '^TEKSERP_HIZMET_ADI=(.+)$') { $backendHizmet = $Matches[1] }
    elseif ($satir -cmatch '^TEKSERP_LISANS_SUNUCUSU=(.+)$') { $backendLisans = $Matches[1] }
    elseif ($satir -cmatch '^TEKSERP_LISANS_VARSAYILAN=(.+)$') { $lisansVarsayilan = $Matches[1] }
  }
  if (-not $backendUrun -or -not $backendHizmet -or -not $backendLisans -or -not $lisansVarsayilan) { Fail "dagitim kapisi ortak kimligi (urunAdi/hizmetAdi/lisansSunucusu/varsayilan) eksik verdi." }
  if ($backendHizmet -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { Fail "dagitim kaydinin backend.hizmetAdi gecersiz: $backendHizmet" }
  Write-Host "    hizmet  : $backendHizmet"
  Write-Host "    urun    : $backendUrun"
}

# --- Surum numarasi ---------------------------------------------------------
# ⚠ YAMA hanesi OTOMATIK artar; taban GIT ETIKETI (`backend-v*`). Panel/tablet
#   ile ayni gerekce: numara KODA aittir, yerel dosyaya degil. Aylarca 2.9.0'da
#   sabit kaldigi icin "sunucuda hangi surum var" sorusunun tek cevabi commit
#   kisaltmasiydi ve `/health` her kurulumda ayni sayiyi basiyordu.
#   Kucuk/buyuk hane bir KARARDIR: `-Surum 3.0.0` ile elle verilir.
#   Gerekce ve ilk-kosum tabani: scripts/backend-surum.mjs
if ($Surum) {
  $yeniSurum = $Surum
  Write-Host "  surum=$yeniSurum (elle verildi)"
} else {
  $yeniSurum = (& node (Join-Path $repo "scripts/backend-surum.mjs")).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $yeniSurum) { Fail "Surum numarasi hesaplanamadi." }
  Write-Host "  surum=$yeniSurum (yama hanesi otomatik)"
}
# ── SURUM BELGESI KAPISI ────────────────────────────────────────────────────
# ⚠ NEDEN BURADA: surum COZULDUKTEN hemen sonra, AGIR isten (npm ci + tsc + zip
#   ~3 dk) ONCE. Kapi sonda olsaydi eksik belge 3. dakikada bulunurdu.
#
# ⚠ NEDEN VAR: paketi KURAN taraf (bugun fabrikadaki Claude oturumu) DOSYA okur,
#   paketi uretenin sohbetini degil. 2026-09-10'da bu belge olmadigi icin kurana
#   "2.9.6 -> 2.9.8" denildi; sahadaki 2.9.7'ydi ve delta yanlis sayildi.
#   Ayni turda `dist-web`in yeniden derlendigi de beyan edilmemisti.
#
# ⚠ AYNI DESEN PANELDE ZATEN VAR (`check-surum-notlari.mjs --panel=<surum>`);
#   burada eksik olan simetriydi. `docs/history/SURUM-*-DEPLOY.md` denemesi
#   2026-08-25'te oldu cunku hicbir kapi onu istemiyordu — insanin hatirlamasina
#   birakilan disiplin olur.
$surumBelgesi = Join-Path $repo "docs/surumler/backend-$yeniSurum.md"
if ($Prova) {
  # Prova yayin DEGILDIR: belgesiz de uretilir ama bunu SOYLER.
  $paketSurumu = "$yeniSurum-prova.$commit"
  Write-Host "  ! PROVA KIPI: surum belgesi aranmadi, etiket atilmayacak, repo degismeyecek." -ForegroundColor Yellow
  Write-Host "    paketin surumu: $paketSurumu" -ForegroundColor Yellow
} elseif (-not (Test-Path $surumBelgesi)) {
  Write-Host ""
  Write-Host "  X Surum belgesi YOK: docs/surumler/backend-$yeniSurum.md" -ForegroundColor Red
  Write-Host "    Sablonu kopyala ve doldur:  docs/surumler/SABLON.md" -ForegroundColor Yellow
  Write-Host "    Belgeyi KURAN okur; paket onsuz uretilmez." -ForegroundColor Yellow
  Fail "Surum belgesi eksik -> paketleme durdu."
}
if (-not $Prova) {
  # Icerigin BOS olmadigini bekci olcer (scripts/test_surum_belgesi.ts); burada
  # yalnizca VARLIK kontrolu var - PowerShell'de markdown ayristirmak yanlis yer.
  Write-Host "  + surum belgesi: docs/surumler/backend-$yeniSurum.md" -ForegroundColor DarkGray
  $paketSurumu = $yeniSurum
  & node (Join-Path $repo "scripts/backend-surum.mjs") --uygula --surum $yeniSurum | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "package.json > version yazilamadi." }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ad    = if ($Prova) { "tekserp-backend-prova-$stamp-$commit" } else { "tekserp-backend-$stamp-$commit" }
# ⚠️ `$env:TEMP` YALNIZ Windows'ta tanimlidir; macOS/Linux'ta $null gelir ve
# `Join-Path` "Cannot bind argument to parameter 'Path'" ile duser. Paket
# ARTIK macOS'tan da uretiliyor (pwsh 7), o yuzden platform-bagimsiz API.
# Windows'ta bu cagri zaten %TEMP% dondurur - davranis degismez.
$stage = Join-Path ([System.IO.Path]::GetTempPath()) $ad
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
$script:SahneYolu = $stage

Set-Location $proj

# --- [1/6] Bagimliliklar + derleme ------------------------------------------
Adim "[1/6] npm ci (tam - derleme icin devDependencies gerekli)..."
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm ci basarisiz." }

# ZORUNLU ve tsc'DEN ONCE. npm 11 install-script'leri BLOKLAR (@prisma/engines
# postinstall'i kosmaz), bu yuzden `npm ci` sonrasi `@prisma/client` HENUZ HICBIR
# TIP EXPORT ETMEZ. Atlanirsa derleme yuzlerce
#   "Module '@prisma/client' has no exported member 'Prisma'/'PrismaClient'/<enum>"
# hatasiyla duser ve ardindan tip cikarimi coktugu icin implicit-any yagmuru gelir
# - yani asil sebep gorunmez olur. (2026-08-01'de tam bu sekilde patladi.)
npx prisma generate
if ($LASTEXITCODE -ne 0) { Fail "prisma generate basarisiz - tsc'nin ihtiyac duydugu tipler uretilemedi." }

if ($Korumali) {
  Adim "[2/6] KORUMALI derleme (esbuild minify + isim karartma -> bytenode .jsc)..."
  # ⚠ Bayt kodu (.jsc) OS + mimari + V8'e KILITLIDIR (2a olcumu KOD-KORUMA-OLCUM.md):
  #   win-x64 .jsc yalniz Windows x64'te, linux-x64 yalniz Linux x64'te uretilir.
  #   Mac'te uretilemez -> CI (korumali-paket.yml) ya da hedef makine (thinkpad-1).
  $osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  $hostWin   = $IsWindows -and ($osArch -eq [System.Runtime.InteropServices.Architecture]::X64)
  $hostLinux = $IsLinux   -and ($osArch -eq [System.Runtime.InteropServices.Architecture]::X64)
  $uretebilir = ($Hedef -eq "win-x64" -and $hostWin) -or ($Hedef -eq "linux-x64" -and $hostLinux)
  if (-not $uretebilir) {
    Fail @"
KORUMALI paket .jsc'yi HEDEF platformda uretir: '$Hedef' bu hostta ($($PSVersionTable.Platform)/$osArch) URETILEMEZ.
       Bayt kodu OS/mimari/V8'e kilitlidir (2a olcumu). Sec:
         * CI:  .github/workflows/korumali-paket.yml (windows-latest + ubuntu-latest)
         * ya da hedef makinede kos (or. thinkpad-1 Windows, node 24 -> win-x64).
"@
  }
  if (Test-Path "$proj\dist") { Remove-Item "$proj\dist" -Recurse -Force }  # olu cikti birikmesin
  # ⚠ .jsc GONDERILECEK runtime node ikilisiyle URETILIR (2a: V8 kilidi). Sistemin
  #   Node'u baska surum olabilir (thinkpad-1 26.4) -> onunla uretilen .jsc'yi
  #   paketin runtime\node.exe'si (24.x) ACAMAZ. O yuzden ONCE runtime'i indir,
  #   sonra build-korumali'yi ONUNLA kos (build-korumali'nin V8 kapisi bunu zorlar).
  node (Join-Path $repo "scripts\koruma-runtime-indir.mjs") $Hedef $stage
  if ($LASTEXITCODE -ne 0) { Fail "runtime node ikilisi indirilemedi / SHA256 dogrulanamadi - paket uretilmedi." }
  $rtAlt = if ($Hedef -eq "win-x64") { "runtime\node.exe" } else { "runtime\bin\node" }
  $runtimeNode = Join-Path $stage $rtAlt
  if (-not (Test-Path $runtimeNode)) { Fail "runtime ikilisi sahnede yok: $rtAlt" }
  Write-Host "  runtime     : $rtAlt (paketin kendi Node'u - .jsc BUNUNLA uretilir + acilir)"
  # build-korumali: dist\server.js (KUCUK YUKLEYICI) + dist\server.jsc (bayt kodu) +
  # dist\server-kunye.json (V8/platform/mimari kapisi). Kaynak haritasi REPO DISI arsive.
  # Filigran (Faz 2e): musteri + kurulum kimligi bayt kodu sabitine ve derleme kunyesine girer.
  $filigranArg = @()
  if ($Musteri) { $filigranArg += "--musteri=$Musteri" }
  if ($Kurulum) { $filigranArg += "--kurulum=$Kurulum" }
  $sifreArg = @()
  if ($Sifrele) {
    $sifreArg += "--sifrele=$SifreliPaketler"
    if ($anahtarTam) { $sifreArg += "--modul-anahtar-dizini=$anahtarTam" }
    Write-Host "  sifreli modul: $SifreliPaketler (anahtar paket DISI; pakete yalniz dist\moduller\*.tkmod girer)"
  }
  & $runtimeNode (Join-Path $proj "scripts\build-korumali.mjs") --hedef=$Hedef --cikti="$proj\dist" @filigranArg @sifreArg
  if ($LASTEXITCODE -ne 0) { Fail "KORUMALI DERLEME BASARISIZ - paket uretilmedi (runtime Node ile)." }
  if (-not (Test-Path "$proj\dist\server.js"))  { Fail "dist\server.js (yukleyici) yok - build-korumali bozuk." }
  if (-not (Test-Path "$proj\dist\server.jsc")) { Fail "dist\server.jsc (bayt kodu) yok - host hedefe uymadi." }
  if (-not (Test-Path "$proj\dist\server-kunye.json")) { Fail "dist\server-kunye.json yok - yukleyici kapisi kurulmamis." }
  if ($Sifrele -and -not (Get-ChildItem "$proj\dist\moduller" -Filter *.tkmod -ErrorAction SilentlyContinue)) { Fail "-Sifrele verildi ama dist\moduller\*.tkmod yok - sifreli modul uretilmedi." }
  Write-Host "  korumali: dist\server.js (yukleyici) + server.jsc (bayt kodu) + server-kunye.json"
} else {
  Adim "[2/6] Derleniyor (tsc --removeComments -> dist)..."
  # --removeComments: URETIM paketinde yorumlar SILINIR. Gerekce: derlenmis JS
  # varsayilan olarak tum yorumlari tasir; bu kod tabaninda yorumlar is mantiginin
  # GEREKCESINI anlatir (tek serviste 478 satir) ve kopyalanan dist'i neredeyse
  # kaynak kadar degerli kilar. Bayrak yalniz BURADA verilir - `npm run build`
  # ile yapilan gelistirme derlemen yorumlu kalir.
  #
  # Yan etki: swagger-jsdoc route JSDoc'larindan okur; yorumlar gidince sunucuda
  # baslangicta "[swagger] UYARI: OpenAPI spec BOS" satiri gorunur. ZARARSIZ -
  # Swagger uretimde zaten mount EDILMIYOR (NODE_ENV=production -> erken return).
  if (Test-Path "$proj\dist") { Remove-Item "$proj\dist" -Recurse -Force }  # olu cikti birikmesin
  npx tsc --removeComments
  if ($LASTEXITCODE -ne 0) { Fail "DERLEME BASARISIZ - paket uretilmedi." }
  if (-not (Test-Path "$proj\dist\server.js")) { Fail "dist\server.js yok. tsconfig rootDir/outDir bozulmus olabilir." }
  # `//# sourceMappingURL=` pragmasi yorum DEGILDIR (--removeComments onu birakir, .map dosyalari
  # asagida ayrica cikarilir) - eski desen onu da sayiyordu ve her deploy'da "67 (0 olmali)"
  # basip gercek bir yorum sizintisini gorunmez kiliyordu (2026-08-25 saha olcumu: 67/67 pragma).
  $kalanYorum = (Select-String -Path "$proj\dist\services\*.js" -Pattern '^\s*//(?!#\s*sourceMappingURL)' -CaseSensitive -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Host "  yorum temizligi: dist\services icinde kalan // satiri = $kalanYorum (0 olmali)"
}

# --- Sunucu araclari (dist\tools) -------------------------------------------
# ⚠ Bu script `npm run build` DEGIL dogrudan `npx tsc --removeComments` kosar
#   (yukaridaki yorum-temizleme gerekcesi), dolayisiyla `build`e bagli adimlar
#   BURADA ACIKCA tekrarlanir. 2026-09-04 ev provasi (BULGU-2): satici hesabi
#   pakette kurulamiyordu; arac derlemesi eklendi ama ilk koşumda yine pakete
#   girmedi - cunku `npm run build` hic cagrilmiyordu. Kapi (asagida) yakaladi.
# ⚠ Join-Path: ters bolu macOS/Linux'ta yol ayirici DEGILDIR ve "$proj\scripts\x"
#   tek parca bir dosya adi olur (`$env:TEMP` vakasiyla ayni sinif hata).
# Korumali pakette araclar da karartilir (build-araclar --korumali): karartmasiz cikti
# src'nin onlarca modulunu (lisans protokolu dahil) okunur JS olarak tasiyordu (2b-D).
# @(...) SART: `= if {...}` tek elemanli diziyi dizgeye acar, dizge splat edilince
#   harflerine bolunur ("-","-","k",...) ve --korumali hic gecmez (kapi asagida yakalar).
$aracArg = @(if ($Korumali) { "--korumali" })
node (Join-Path $proj "scripts" "build-araclar.mjs") @aracArg
if ($LASTEXITCODE -ne 0) { Fail "Arac derlemesi basarisiz - paket uretilmedi." }
if (-not (Test-Path "$proj\dist\tools\superadmin-olustur.cjs")) {
  Fail "dist\tools\superadmin-olustur.cjs uretilmedi - bu paketle satici hesabi KURULAMAZ."
}
# Yayin gunu araclari dahil HER arac: liste build-araclar.mjs'in yazdigi araclar.json'dan.
$aracListesi = Join-Path (Join-Path (Join-Path $proj "dist") "tools") "araclar.json"
if (-not (Test-Path $aracListesi)) { Fail "dist/tools/araclar.json yok - arac listesi dogrulanamadi." }
$araclar = @(Get-Content $aracListesi -Raw | ConvertFrom-Json)
foreach ($a in $araclar) {
  if (-not (Test-Path (Join-Path (Join-Path $proj "dist") $a.dosya))) { Fail "Arac uretilmedi: dist/$($a.dosya)" }
}
Write-Host "  araclar (dist/tools): $(($araclar | ForEach-Object { $_.ad }) -join ', ')"
if ($Korumali) {
  # Arac karartma kapisi: karartmasiz esbuild ciktisi her modulun basina `// src/...` yol
  # yorumu koyar; korumali pakette tek bir tane bile kalirsa araclar okunur kaynak tasiyor.
  $yolYorumu = @(Select-String -Path (Join-Path (Join-Path (Join-Path $proj "dist") "tools") "*.cjs") -Pattern '^\s*//\s*(src|scripts)/' -CaseSensitive -ErrorAction SilentlyContinue).Count
  if ($yolYorumu -gt 0) { Fail "KORUMALI paket: dist/tools araclari karartilmamis ($yolYorumu kaynak yolu yorumu) - build-araclar --korumali almadi." }
  Write-Host "  araclar karartildi: kaynak yolu yorumu = 0"
}

# --- Web paneli: 2026-09-30'dan (B6) beri pakete GIRMEZ ----------------------
# -WebPanelHaric geriye uyum icin kabul edilir (runbook komutlari kirilmasin), etkisizdir.
if ($WebPanelHaric) { Write-Host "  (-WebPanelHaric etkisiz: web paneli artik pakete girmez)" -ForegroundColor DarkGray }

# --- [3/6] Calisma zamani dosyalari -----------------------------------------
Adim "[3/6] Calisma zamani dosyalari toplaniyor..."

# dist - .js.map HARIC
Copy-Item "$proj\dist" "$stage\dist" -Recurse
$maps = Get-ChildItem "$stage\dist" -Recurse -Filter "*.js.map"
$mapMB = [math]::Round(($maps | Measure-Object Length -Sum).Sum / 1MB, 1)
$maps | Remove-Item -Force
Write-Host "  dist        : $((Get-ChildItem "$stage\dist" -Recurse -File).Count) dosya  (.map cikarildi: $($maps.Count) dosya / $mapMB MB)"

# prisma - YALNIZ schema + migrations (seed'ler HARIC)
New-Item -ItemType Directory -Path "$stage\prisma" | Out-Null
if ($Korumali) {
  # Korumali paket: sema YORUMSUZ kopyalanir (4.640 yorum satiri pakete girmesin;
  # 2a §4). [4/6] `prisma generate` bu yorumsuz semadan calisir -> uretilmis istemci
  # de yorumsuz olur. Calisma anI veri modeli BIREBIR aynidir (2a: migrate diff 0).
  node (Join-Path $proj "scripts\prisma-yorumsuz-yaz.mjs") "$proj\prisma\schema.prisma" "$stage\prisma\schema.prisma"
  if ($LASTEXITCODE -ne 0) { Fail "prisma semasi yorumsuz kopyalanamadi." }
} else {
  Copy-Item "$proj\prisma\schema.prisma" "$stage\prisma\"
}
Copy-Item "$proj\prisma\migrations"    "$stage\prisma\migrations" -Recurse
$migSayi = (Get-ChildItem "$stage\prisma\migrations" -Directory).Count
Write-Host "  prisma      : schema.prisma + $migSayi migration  (seed*.ts DAHIL DEGIL$(if ($Korumali) { '; YORUMSUZ' }))"

# Korumali paketin runtime\node.exe'si [2/6]'da (build-korumali'den ONCE) $stage'e
# indirildi ve .jsc onunla uretildi - burada yalniz sahnede oldugunu dogrula.
if ($Korumali) {
  $rtAlt = if ($Hedef -eq "win-x64") { "runtime\node.exe" } else { "runtime\bin\node" }
  if (-not (Test-Path (Join-Path $stage $rtAlt))) { Fail "runtime ikilisi sahnede yok: $rtAlt (build adiminda inmeliydi)" }
  Write-Host "  runtime     : $rtAlt (paketin kendi Node'u - pakette)"
  # Native lisans cekirdegi (Faz 2e): paket duzeni app\native\<dosya>; korumali derleme onu
  # ZORUNLU kilar (TS'e dusulmez). Yoksa paket URETILMEZ - native'siz korumali paket her
  # dogrulamayi CEKIRDEK_YOK ile dusururdu.
  $natAd = if ($Hedef -eq "win-x64") { "lisans-cekirdek.win32-x64-msvc.node" } else { "lisans-cekirdek.linux-x64-gnu.node" }
  $natKaynak = if ($NativeYol) { $NativeYol } else { Join-Path $proj "native\lisans-cekirdek\dist-uretim\$natAd" }
  if (-not (Test-Path $natKaynak)) {
    Fail "native lisans cekirdegi yok: $natKaynak (URETIM derlemesi: npm run derle:win:uretim ya da CI korumali-paket.yml; ya da -NativeYol)"
  }
  New-Item -ItemType Directory -Force (Join-Path $stage "native") | Out-Null
  Copy-Item $natKaynak (Join-Path $stage "native\$natAd")
  # G3: native'in gomulu capa kipi bayt kodunun kipiyle (build-korumali kanaldan yazar) AYNI olmali;
  # uyusmazsa paket acilista cekirdeksiz kalirdi. Paketin kendi Node'u .node'u yukleyip kunyesini okur.
  & $runtimeNode (Join-Path (Join-Path $proj "scripts") "native-capa-kipi.mjs") (Join-Path (Join-Path $stage "native") $natAd) (Join-Path (Join-Path $proj "dist") "server-kunye.json")
  if ($LASTEXITCODE -ne 0) { Fail "native lisans cekirdeginin guven capasi kipi paketinkiyle uyusmuyor (yukarida). Hazirlik kanali: npm run derle:win:hazirlik + -NativeYol." }
  Write-Host "  native      : native\$natAd (lisans cekirdegi - zorunlu kip)"
}

# Hizmet ikilileri (Dagitim v2): konak + guncelleyici runtime\ altina, OLCULEREK. Korumali olmayan
# (sistem Node'lu) paket hizmet duzenine KURULAMAZ (konak runtime\node.exe calistirir) - yalniz pm2.
$hizmetIkilileri = $null
if ($Korumali -and $Hedef -eq "win-x64") {
  $ikiliDizin = if ($HizmetIkiliDizini) { $HizmetIkiliDizini } else { Join-Path (Join-Path (Join-Path $proj "native") "target") "release" }
  $hizmetIkilileri = [ordered]@{}
  $paketCapaKipi = (Get-Content -Raw (Join-Path (Join-Path $proj "dist") "server-kunye.json") | ConvertFrom-Json).guvenCapasi
  foreach ($ikiliAd in $HIZMET_IKILILERI.Keys) {
    $olcu = HizmetIkilisiOlc (Join-Path $ikiliDizin $ikiliAd) $HIZMET_IKILILERI[$ikiliAd] $paketCapaKipi
    Copy-Item (Join-Path $ikiliDizin $ikiliAd) (Join-Path (Join-Path $stage "runtime") $ikiliAd)
    $hizmetIkilileri[$ikiliAd] = $olcu
    Write-Host "  runtime     : runtime\$ikiliAd ($($olcu.surum), $([math]::Round($olcu.boyut / 1MB, 1)) MB, sha256 $($olcu.sha256.Substring(0, 16))...)"
  }
} elseif ($Korumali) {
  Write-Host "  ! $Hedef paketi Windows hizmet ikilisi TASIMAZ (hizmet duzeni yalniz win-x64)." -ForegroundColor Yellow
} else {
  Write-Host "  ! KORUMALI OLMAYAN paket: hizmet ikilisi yok - yalniz pm2 duzenine (kur.ps1) kurulur, setup.exe KURMAZ." -ForegroundColor Yellow
}

# cwd'den okunan varliklar
Copy-Item "$proj\public" "$stage\public" -Recurse
Copy-Item "$proj\assets" "$stage\assets" -Recurse
Write-Host "  public+assets: durum sayfasi + etiket fontlari"


# manifest / calistirici
Copy-Item "$proj\package.json"        "$stage\"
if ($Prova) {
  # Prova surumu YALNIZ paketteki kopyaya yazilir; repodaki dosya degismez.
  $pj  = Join-Path $stage "package.json"
  $ham = [System.IO.File]::ReadAllText($pj)
  $rx  = [regex]'("version"\s*:\s*)"[^"]+"'
  $yeniPj = $rx.Replace($ham, { param($eslesme) $eslesme.Groups[1].Value + '"' + $paketSurumu + '"' }, 1)
  if ($yeniPj -eq $ham) { Fail "paketteki package.json'a prova surumu yazilamadi." }
  [System.IO.File]::WriteAllText($pj, $yeniPj)
  Write-Host "  package.json (paketteki): version = $paketSurumu  (repo dosyasi degismedi)"
}
Copy-Item "$proj\package-lock.json"   "$stage\"
Copy-Item "$proj\ecosystem.config.js" "$stage\"

# KURULUM SCRIPT'I PAKETE GIRER (2026-09-07). Iki sebep:
#   ① Paket ile onu kuran script AYNI TURDAN cikar - surum ayrismasi imkansiz.
#     Bu ayrisma 2026-09-07'de olculdu: sahadaki kur.ps1 pm2 adini yanlis
#     yonetiyordu ve guncelleme ikinci bir uygulama kaldiracakti.
#   ② `kur.ps1` KONUMUNDAN BAGIMSIZDIR ($PSScriptRoot kullanmaz, her seyi -Kok'tan
#     alir) - yani operator zip ile script'i ayni klasore koyup ORADAN kosar.
#     `C:\<kok>\kur.ps1` artik zorunlu degil, yalnizca kolaylik kopyasi.
# Sifirdan kurulumun iskeleti de ayni zip'te (ilk-kurulum acilis + gece yedegi gorevlerinin
# dosyalarini kendi yanindan alir); uzaktan-kos.ps1 SSH'tan SYSTEM gorevi kurar; bakim-rolu.ps1 super
# OLMAYAN yedek kimligi. Liste basta ($KOK_BETIKLERI) - hepsi imzali kapsamda (INTEGRITY_SCOPE_FILES).
foreach ($b in $KOK_BETIKLERI) {
  $kaynak = Join-Path (Join-Path $repo "deploy") $b
  if (-not (Test-Path -LiteralPath $kaynak)) { Fail "paket betigi yok: deploy/$b" }
  Copy-Item $kaynak (Join-Path $stage $b)
}
# Hizmet duzeni + gecis betikleri (Dagitim v2): repo deploy/<yol> -> paket <yol>, goreli yollar ayni.
foreach ($b in $ALT_BETIKLER) {
  $parca = $b -csplit '/'
  $kaynak = Join-Path (Join-Path $repo "deploy") ($parca -join [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $kaynak)) { Fail "paket betigi yok: deploy/$b (hizmet duzeni/gecis betikleri pakette ZORUNLU)" }
  # Ad `$hedef` OLAMAZ: PowerShell degisken adi buyuk/kucuk harf duyarsiz, -Hedef parametresinin ValidateSet'i
  # atamayi dogrular ve paketleme burada duser (thinkpad-1 D8 2026-10-01).
  $altHedef = Join-Path $stage ($parca -join [IO.Path]::DirectorySeparatorChar)
  New-Item -ItemType Directory -Force (Split-Path $altHedef -Parent) | Out-Null
  Copy-Item $kaynak $altHedef
}
Write-Host "  betikler    : $($KOK_BETIKLERI.Count) kok (pm2 gecis donemi dahil) + $($ALT_BETIKLER -join ', ')"

# Prisma yapilandirmasi: TS DEGIL, seed kancasi OLMAYAN JS surumu
$prodCfg = "$proj\deploy\prisma.config.prod.js"
if (-not (Test-Path $prodCfg)) { Fail "deploy\prisma.config.prod.js yok - uretim prisma config'i olmadan paket uretilmez." }
Copy-Item $prodCfg "$stage\prisma.config.js"
Write-Host "  prisma.config.js : seed kancasi YOK (canli DB'de seed kazasi imkansiz)"

# --- [4/6] node_modules -----------------------------------------------------
if ($NodeModulesHaric) {
  Adim "[4/6] node_modules ATLANDI - sunucu 'npm ci --omit=dev' kosacak (internet gerekir)."
} else {
  Adim "[4/6] Uretim bagimliliklari kuruluyor (paketin icine)..."
  Push-Location $stage
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npm ci --omit=dev basarisiz." }
  # Prisma istemcisi + sorgu motorlari: npm 11 install-script'leri blokladigi icin
  # motorlari postinstall DEGIL, `generate` ceker. Paket kendi kendine yetsin.
  #
  # ⚠⚠ IKI FARKLI MOTOR VAR VE YALNIZ BIRI PLATFORMDAN BAGIMSIZ (2026-09-04):
  #   * SORGU motoru  -> WASM (`query_compiler_fast_bg.*.wasm`). Platformdan
  #     BAGIMSIZ; macOS'ta uretilen istemci Windows'ta calisir.
  #   * SEMA motoru   -> NATIVE ikili (`schema-engine-<platform>`), `migrate
  #     deploy`in kullandigi sey. macOS'ta paketlenirse pakete YALNIZ
  #     `schema-engine-darwin-arm64` girer ve Windows'ta `kur.ps1 [7/9]` -
  #     yani GERI ALINAMAZ ESIK - duser.
  #   "Prisma 7 WASM kullaniyor, platform motoru yok" cumlesi YALNIZ sorgu
  #   motoru icin dogrudur; tum zincire genellenirse bu tuzak dogar.
  #
  # ⚠ PROVA BU ARIZAYI GORMEZ: Windows makinede Prisma, eksik motoru kendi
  #   onbelleginden (%LOCALAPPDATA%) sessizce tamamlayabilir. Yani yesil prova
  #   "paket saglam" DEMEK DEGILDIR - onbellegi bos VE internetsiz bir sunucuda
  #   ayni paket duser. Kapi bu yuzden PAKETTE, provada degil.
  $env:PRISMA_CLI_BINARY_TARGETS = "windows"
  npx prisma generate
  $prismaKod = $LASTEXITCODE
  Remove-Item Env:\PRISMA_CLI_BINARY_TARGETS -ErrorAction SilentlyContinue
  if ($prismaKod -ne 0) { Pop-Location; Fail "prisma generate basarisiz." }
  Pop-Location

  # --- KAPI: sema motoru WINDOWS ikilisi olmak ZORUNDA ---
  $motorDizin = Join-Path $stage "node_modules/@prisma/engines"
  $winMotor   = Join-Path $motorDizin "schema-engine-windows.exe"
  if (-not (Test-Path $winMotor)) {
    Fail @"
Windows sema motoru pakete girmedi: schema-engine-windows.exe
       `migrate deploy` bu ikiliyi kullanir; onsuz kur.ps1 [7/9] (geri
       alinamaz esik) fabrikada duser.
       Beklenen yol: $winMotor
       Cozum: PRISMA_CLI_BINARY_TARGETS=windows ile `prisma generate` kosmali
       (bu script zaten kosuyor - internet yoksa indirme dusmustur).
"@
  }
  # ⚠ MZ imzasi: bos/yarim inen dosya da "var" gorunur. Ikili gercekten
  #   Windows PE mi, onu okuyoruz.
  $imza = [System.IO.File]::ReadAllBytes($winMotor)[0..1]
  if ($imza[0] -ne 0x4D -or $imza[1] -ne 0x5A) {
    Fail "schema-engine-windows.exe Windows ikilisi DEGIL (MZ imzasi yok) - indirme yarim kalmis olabilir."
  }
  # Yabanci platform motorlari pakette ISE YARAMAZ (24 MB olu agirlik) ve
  # "bu paket hangi platform icin" sorusunu bulanik birakir.
  Get-ChildItem $motorDizin -Filter "schema-engine-*" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "schema-engine-windows.exe" } |
    ForEach-Object { Write-Host "  - yabanci motor atildi: $($_.Name)"; Remove-Item $_.FullName -Force }
  Write-Host "  + sema motoru: schema-engine-windows.exe ($([math]::Round((Get-Item $winMotor).Length/1MB,1)) MB, MZ dogrulandi)"
  $nmMB = [math]::Round((Get-ChildItem "$stage\node_modules" -Recurse -Force | Measure-Object Length -Sum).Sum / 1MB, 1)
  Write-Host "  node_modules: $nmMB MB (uretim-only, Prisma istemcisi uretilmis)"
}

# --- [5/6] Manifest ---------------------------------------------------------
# ⚠ DOSYA LISTESI TEK KAYNAKTIR: manifest de zip de ASAGIDAKI $dosyalar'dan
#   beslenir. 2026-09-04 ev provasinda ikisi AYRI yollardan uretiliyordu
#   (`Get-ChildItem -Force` sayiyor, `Compress-Archive -Path "$stage\*"`
#   zipliyor) ve nokta ile baslayan girdiler SESSIZCE dusuyordu:
#     - `node_modules/.prisma/client` yok  -> backend "Cannot find module
#       '.prisma/client/default'" ile restart dongusune girer
#     - `node_modules/.bin` yok            -> `npx prisma` bulunamaz, kur.ps1 [7/9] duser
#   Olculdu: 13658 dosya sayildi, 13518 zip'lendi, 140 dosya kayip; hicbir kapi
#   gormedi. PowerShell POSIX'te nokta ile baslayan her sey HIDDEN'dir ve
#   `Compress-Archive` gizli girdileri atlar (`-Force` karsiligi yoktur).
Adim "[5/6] Manifest yaziliyor..."

# node_modules/.bin BILEREK DISARIDA: macOS/Linux'ta orada sembolik baglar durur
# (`prisma -> ../prisma/build/index.js`). Windows'ta npm bunun yerine `.cmd`
# shim'i uretir; sembolik bagin ISARET ETTIGI icerigi kopyalamak da ise yaramaz
# (uzantisiz dosya Windows'ta calistirilamaz). Bu yuzden `kur.ps1` prisma'yi
# `.bin` uzerinden DEGIL, dogrudan `node node_modules\prisma\build\index.js`
# ile cagirir - hangi platformda paketlendiginden bagimsiz.
$binDisla = "node_modules" + [IO.Path]::DirectorySeparatorChar + ".bin" + [IO.Path]::DirectorySeparatorChar
$kok_ = $stage.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$dosyalar = @(
  Get-ChildItem $stage -Recurse -File -Force |
    Where-Object { -not $_.FullName.Substring($kok_.Length).StartsWith($binDisla) }
)
if ($dosyalar.Count -eq 0) { Fail "Stage bos - paketlenecek dosya yok." }

# Korumali paketin runtime Node surumu (kur.ps1 [1/9] runtime\node.exe ile karsilastirir).
$runtimeNodeSurumu = $null
if ($Korumali) {
  $nsYol = Join-Path $repo "deploy\node-surumu.json"
  if (-not (Test-Path $nsYol)) { Fail "deploy\node-surumu.json yok - korumali paketin runtime surumu belirlenemez." }
  $runtimeNodeSurumu = (Get-Content $nsYol -Raw | ConvertFrom-Json).surum
}

$derlemeKimligi = [guid]::NewGuid().ToString()
$manifest = [ordered]@{
  ad              = $ad
  commit          = $commit
  dal             = $dal
  calismaAgaciTemiz = [bool](-not $kirli)
  # Kanal (musteri) kimligi - yalniz eski kanal yolunda; ORTAK pakette null (grup kiradan, firma lisanstan).
  backendKanal    = $(if ($Musteri) { $Musteri } else { $null })
  backendUrun     = $backendUrun
  backendPm2Ad    = $backendPm2
  # Hizmet duzeni (Dagitim v2): setup.exe backend hizmetini bu adla kaydeder (ortak: dagitim kaydi; eski: kanal kaydi).
  backendHizmetAdi = $backendHizmet
  # Kanalin lisans saticisi (kanal kaydi backend.lisansSunucusu) + bu derlemenin varsayilani (vendor-url.ts):
  # setup/gecis kurulumun etkin LICENSE_SERVER_URL'sini bunlarla olcer (ortak: dagitim kaydi lisansSunucusu).
  backendLisansSunucusu = $backendLisans
  lisansSunucusuVarsayilan = $lisansVarsayilan
  # runtime\ altindaki Rust hizmet ikilileri {surum, boyut, sha256}; korumali olmayan pakette null.
  hizmetIkilileri = $hizmetIkilileri
  # Korumali paket bicimi: .jsc + runtime\node.exe tasir; kur.ps1 [1/9] onu denetler.
  korumali        = [bool]$Korumali
  korumaHedef     = if ($Korumali) { $Hedef } else { $null }
  runtimeNodeSurumu = $runtimeNodeSurumu
  # Imzali dosya listesi (butunluk.jws) satici Mac'inde eklenir; imza adimi bu alani doldurur.
  butunlukKid     = $null
  uretimZamani    = (Get-Date).ToString("s")
  # Derleme kimligi: musteri paketi URETENIN makine/kullanici adini TASIMAZ; o bilgi yalniz
  # paketleyen makinenin derleme kaydinda (~/.tekserp/derleme-kayitlari, paket DISI).
  derlemeKimligi  = $derlemeKimligi
  paketleyenPlatform = if ($IsWindows) { "windows" } elseif ($IsMacOS) { "macos" } else { "linux" }
  nodeSurumu      = (& node --version).Trim()
  npmSurumu       = (& npm --version).Trim()
  # Paketteki kopyadan okunur: prova kipinde repo dosyasi ESKI surumu tasir.
  uygulamaSurumu  = (Get-Content "$stage\package.json" -Raw | ConvertFrom-Json).version
  # true = yayin provasi (etiket yok, belge yok); kur.ps1 `-ProvaKabul` ister.
  prova           = [bool]$Prova
  migrationSayisi = $migSayi
  nodeModulesDahil= (-not $NodeModulesHaric)
  # Paketteki sunucu araclari (dist/tools); kur.ps1 kurulum sonunda basar.
  araclar         = @($araclar | ForEach-Object { $_.ad })
  # PAKET.json'in KENDISI bu sayiya dahil DEGILDIR (henuz yazilmadi). Zip'te
  # tam olarak $dosyalar.Count + 1 girdi olmasi beklenir - kapi bunu olcer.
  dosyaSayisi     = $dosyalar.Count
  toplamBayt      = ($dosyalar | Measure-Object Length -Sum).Sum
  serverJsSha256  = (Get-FileHash "$stage\dist\server.js" -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 4 | Out-File "$stage\PAKET.json" -Encoding utf8
# Derleme kaydi (paket DISI): ureticinin kimligi yalniz burada; yazilamazsa paket etkilenmez.
try {
  $kayitDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".tekserp/derleme-kayitlari"
  New-Item -ItemType Directory -Force -Path $kayitDir | Out-Null
  [ordered]@{
    derlemeKimligi = $derlemeKimligi
    ad             = $ad
    commit         = $commit
    uretimZamani   = $manifest.uretimZamani
    ureten         = "$([System.Environment]::MachineName)\$([System.Environment]::UserName)"
  } | ConvertTo-Json | Out-File (Join-Path $kayitDir "$ad.json") -Encoding utf8
} catch {
  Write-Host "  UYARI: derleme kaydi yazilamadi ($($_.Exception.Message)) - paket etkilenmez"
}
Write-Host "  $($manifest.dosyaSayisi) dosya / $([math]::Round($manifest.toplamBayt/1MB,1)) MB"

# --- [6/6] Zip --------------------------------------------------------------
Adim "[6/6] Zip'leniyor..."
$ciktiDir = (Resolve-Path $Cikti).Path
$zip = Join-Path $ciktiDir "$ad.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

# Girdiler TEK TEK eklenir. `Compress-Archive` (gizli girdileri atlar) ve
# `ZipFile::CreateFromDirectory` (sembolik bag hedefi yoksa TUM paketlemeyi
# exception'la dusurur - olculdu) yerine acik liste: ne eklendigini biliyoruz.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$arsiv = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
  $eklenen = 0
  foreach ($f in @($dosyalar) + @(Get-Item "$stage\PAKET.json")) {
    # Zip icindeki yol AYIRICISI daima '/' olmalidir; Windows'ta '\' yazilirsa
    # klasor yapisi bazi acicilarda tek uzun dosya adina donusur.
    $rel = $f.FullName.Substring($kok_.Length).Replace([IO.Path]::DirectorySeparatorChar, '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($arsiv, $f.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal)
    $eklenen++
  }
} finally { $arsiv.Dispose() }

# --- KAPI: beyan ile gercek ayrisirsa PAKET URETILMEZ ------------------------
# Bu kapi 2026-09-04'te yoktu ve 140 dosyalik kayip sahaya kadar gitti.
$beklenen = $dosyalar.Count + 1   # +1 = PAKET.json
$arsivOku = [IO.Compression.ZipFile]::OpenRead($zip)
try   { $gercek = @($arsivOku.Entries | Where-Object { $_.FullName -cnotmatch '/$' }).Count
        $iceriyor = { param($yol) [bool]($arsivOku.Entries | Where-Object { $_.FullName -eq $yol }) } }
finally { $arsivOku.Dispose() }

if ($gercek -ne $beklenen) {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Fail "PAKET BOZUK - beyan $beklenen dosya, zip'te $gercek. Fark: $($beklenen - $gercek). Paket SILINDI."
}
Write-Host "  + zip dogrulandi: $gercek girdi = beyan" -ForegroundColor Green

# Prisma istemcisi paketin icinde mi? Yoksa backend acilisSTA duser ve pm2
# 'online' gosterirken restart dongusune girer - en sinsi arizalardan biri.
if (-not $NodeModulesHaric) {
  $arsivOku = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $client = @($arsivOku.Entries | Where-Object { $_.FullName -like 'node_modules/.prisma/client/*' }).Count
    $wasm   = @($arsivOku.Entries | Where-Object { $_.FullName -like 'node_modules/.prisma/client/*.wasm' }).Count
  } finally { $arsivOku.Dispose() }
  if ($client -eq 0) {
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    Fail "PAKET BOZUK - node_modules/.prisma/client YOK. Backend acilamaz. Paket SILINDI."
  }
  Write-Host "  + prisma istemcisi pakette: $client dosya ($wasm wasm)" -ForegroundColor Green
}

Remove-Item $stage -Recurse -Force

# --- Surum etiketi ----------------------------------------------------------
# ⚠ Paket DOGRULANDIKTAN sonra atilir: kapilardan gecmemis bir zip icin numara
#   harcamak, bir sonraki turu bir sayi ileri kaydirirdi. Backend'in yayin
#   sunucusu YOK - paket elden tasiniyor - o yuzden "yayin ani" budur.
# ⚠ KOSULSUZ DEGIL: etiket `git push origin` ile UZAGA da gider; prova
#   kipinde ve kirli agactan uretilen pakette atilmaz (baslik "PROVA KIPI").
if ($Prova) {
  Write-Host "  ! PROVA: etiket atilmadi (backend-v$yeniSurum), push yapilmadi." -ForegroundColor Yellow
} elseif ($kirli) {
  Write-Host "  ! Etiket ATILMADI: paket KIRLI agactan uretildi. backend-v$yeniSurum HEAD'i ($commit)" -ForegroundColor Yellow
  Write-Host "    gosterirdi ama paket HEAD'de olmayan degisiklik tasiyor. Commit'le, TEMIZ agactan yeniden uret." -ForegroundColor Yellow
} else {
  & node (Join-Path $repo "scripts/backend-surum.mjs") --etiketle $yeniSurum
}

$zipMB = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$sha   = (Get-FileHash $zip -Algorithm SHA256).Hash

# --- Surum belgesinin uc alanini DOLDUR -------------------------------------
# ⚠ NEDEN MAKINE YAZIYOR: paket adi, SHA256 ve commit paketleme BITMEDEN
#   bilinemez. Insanin SHA256 kopyalamasi ise tam da hatanin cikacagi yerdir —
#   64 karakterlik bir ozet elle tasinirsa dogrulugu kimse fark etmeden bozulur
#   ve kuran tarafta "SHA tutmuyor, DUR" kurali YANLIS sebeple tetiklenir.
#   Belge boylece kendini dogrular: icindeki ozet, uretilen zip'in ozetidir.
if ($Prova) {
  Write-Host "  ! PROVA: surum belgesine YAZILMADI (paket adi + SHA256 asagida)." -ForegroundColor Yellow
} else {
  $belgeMetni = Get-Content $surumBelgesi -Raw
  $belgeMetni = $belgeMetni -creplace '(?m)^\*\*Paket:\*\*.*$',  "**Paket:** ``$([System.IO.Path]::GetFileName($zip))``"
  $belgeMetni = $belgeMetni -creplace '(?m)^\*\*SHA256:\*\*.*$', "**SHA256:** ``$sha``"
  $belgeMetni = $belgeMetni -creplace '(?m)^\*\*Commit:\*\*.*$', "**Commit:** ``$commit``"
  Set-Content $surumBelgesi $belgeMetni -NoNewline
  Write-Host "  + surum belgesi guncellendi (paket adi + SHA256 + commit)" -ForegroundColor DarkGray
}

Set-Location $repo
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
if ($Prova) { Write-Host "  PROVA PAKETI HAZIR - fabrikaya KURULMAZ (kur.ps1 -ProvaKabul ister)" -ForegroundColor Yellow }
else        { Write-Host "  PAKET HAZIR" -ForegroundColor Green }
Write-Host "  $zip"
Write-Host "  $zipMB MB  |  commit $commit  |  $migSayi migration"
Write-Host "  SHA256: $sha"
Write-Host ""
if ($Korumali) {
  Write-Host "  ! KORUMALI paket IMZASIZ - kur.ps1 imzasiz korumali paketi REDDEDER." -ForegroundColor Yellow
  Write-Host "    Satici Mac'inde imzala (anahtar CI'a/pakete girmez):" -ForegroundColor Yellow
  Write-Host "      npx tsx Teks-Erp/scripts/build-korumali-imza.ts zip --zip=<bu zip> --anahtar=<PAKET anahtari> --surum-belgesi=<surum belgesi>" -ForegroundColor Yellow
}
Write-Host "  KURULUM YOLLARI (gecis donemi - iki duzen yan yana):"
if ($hizmetIkilileri) {
  Write-Host "    * YENI kurulum (Windows hizmeti duzeni): TeksERP-Kurulum.exe - ayni klasorde bu zip + PG paketi"
  Write-Host "      (postgresql-*.zip + pg.json); bayi icin sessiz kip: TeksERP-Kurulum.exe /VERYSILENT /CEVAP=<cevap.json>"
  Write-Host "    * pm2 duzenindeki kurulumu hizmet duzenine GECIR: paketteki gecis\gecis.ps1 (runbook D6)"
}
Write-Host "    * pm2 duzeninde GECIS ONCESI guncelleme - sunucuda YONETICI PowerShell (yurutme ilkesi: -ExecutionPolicy Bypass):"
Write-Host "      powershell -NoProfile -ExecutionPolicy Bypass -File C:\TeksERP\kur.ps1 -Paket <zip yolu>"
Write-Host "================================================================"
Write-Host ""
