# =============================================================================
# TeksERP Backend - SURUM PAKETI URETICI
# =============================================================================
# NEREDE CALISIR: GELISTIRME MAKINENDE, repo kokunde (Teks-Erp klasorunun ustu).
#                 Sunucuda CALISMAZ - sunucuda kaynak kod yoktur.
#
# NE URETIR: tekserp-backend-<tarih>-<commit>.zip
#            Sunucudaki kur.ps1 bu paketi bekler.
#
# KULLANIM:
#   .\paketle.ps1                      # node_modules DAHIL (varsayilan, onerilen)
#   .\paketle.ps1 -NodeModulesHaric    # ince paket; sunucu npm ci kosar (internet ister)
#   .\paketle.ps1 -Cikti D:\paketler   # zip'in yazilacagi klasor
#   .\paketle.ps1 -WebPanelHaric      # web panelini pakete KOYMA (asagidaki nota bak)
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
#   * WEB PANELI (dist-web) PAKETE GIRER ve backend ile AYNI ZIP'te gider.
#     Gerekce: panel ile backend'in surumleri AYRISAMAZ. Ayri bir kanaldan
#     yayinlansaydi (VPS'e kopyalama gibi) SPA bir surumu, API baska bir surumu
#     konusabilirdi ve arizanin belirtisi "ekran bos" olurdu - teshis edilecek iz
#     birakmadan. Ayni pakette gitmesi bu sinifi TAMAMEN kapatir.
#     ⚠️ Eksik olursa ariza SESSIZDIR: `WEB_DIST_DIR` var olmayan bir klasoru
#     gosterir, `express.static` sessizce no-op olur ve kok (/) panelin YERINE
#     durum sayfasini basar. Bu yuzden derleme basarisizsa paket URETILMEZ.
# =============================================================================
[CmdletBinding()]
param(
  [switch]$NodeModulesHaric,
  [switch]$WebPanelHaric,
  [string]$Cikti = "."
,
  # Kucuk/buyuk hane bir KARARDIR - elle verilir (ornek: -Surum 3.0.0).
  [string]$Surum)
$ErrorActionPreference = "Stop"

function Fail($m) { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; exit 1 }
function Adim($m) { Write-Host ""; Write-Host "$m" -ForegroundColor Cyan }

$repo = (Get-Location).Path
$proj = Join-Path $repo "Teks-Erp"
if (-not (Test-Path (Join-Path $proj "package.json"))) {
  Fail "Teks-Erp\package.json bulunamadi. Bu scripti REPO KOKUNDE calistir."
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
& node (Join-Path $repo "scripts/backend-surum.mjs") --uygula --surum $yeniSurum | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "package.json > version yazilamadi." }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ad    = "tekserp-backend-$stamp-$commit"
# ⚠️ `$env:TEMP` YALNIZ Windows'ta tanimlidir; macOS/Linux'ta $null gelir ve
# `Join-Path` "Cannot bind argument to parameter 'Path'" ile duser. Paket
# ARTIK macOS'tan da uretiliyor (pwsh 7), o yuzden platform-bagimsiz API.
# Windows'ta bu cagri zaten %TEMP% dondurur - davranis degismez.
$stage = Join-Path ([System.IO.Path]::GetTempPath()) $ad
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

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
$kalanYorum = (Select-String -Path "$proj\dist\services\*.js" -Pattern '^\s*//(?!#\s*sourceMappingURL)' -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Host "  yorum temizligi: dist\services icinde kalan // satiri = $kalanYorum (0 olmali)"

# --- Sunucu araclari (dist\tools) -------------------------------------------
# ⚠ Bu script `npm run build` DEGIL dogrudan `npx tsc --removeComments` kosar
#   (yukaridaki yorum-temizleme gerekcesi), dolayisiyla `build`e bagli adimlar
#   BURADA ACIKCA tekrarlanir. 2026-09-04 ev provasi (BULGU-2): satici hesabi
#   pakette kurulamiyordu; arac derlemesi eklendi ama ilk koşumda yine pakete
#   girmedi - cunku `npm run build` hic cagrilmiyordu. Kapi (asagida) yakaladi.
# ⚠ Join-Path: ters bolu macOS/Linux'ta yol ayirici DEGILDIR ve "$proj\scripts\x"
#   tek parca bir dosya adi olur (`$env:TEMP` vakasiyla ayni sinif hata).
node (Join-Path $proj "scripts" "build-araclar.mjs")
if ($LASTEXITCODE -ne 0) { Fail "Arac derlemesi basarisiz - paket uretilmedi." }
if (-not (Test-Path "$proj\dist\tools\superadmin-olustur.cjs")) {
  Fail "dist\tools\superadmin-olustur.cjs uretilmedi - bu paketle satici hesabi KURULAMAZ."
}

# --- Web paneli (Electron/dist-web) -----------------------------------------
# Ayni React kaynagi, Electron kabugu OLMADAN (Electron\vite.config.web.ts).
# Backend onu `WEB_DIST_DIR` ile ayni origin'den servis eder -> CORS/karisik-icerik/
# sunucu-adresi ucluSU tamamen duser ve patron paneli de bu yoldan yayinlanir.
$elektron = Join-Path $repo "Electron"
$webDist  = Join-Path $elektron "dist-web"
if ($WebPanelHaric) {
  Adim "[2b] Web paneli ATLANDI (-WebPanelHaric)."
  Write-Host "  UYARI: WEB_DIST_DIR tanimliysa sunucuda panel ACILMAZ, kok (/) durum sayfasi olur." -ForegroundColor Yellow
} else {
  Adim "[2b] Web paneli derleniyor (Electron -> dist-web)..."
  if (-not (Test-Path (Join-Path $elektron "node_modules"))) {
    Fail "Electron\node_modules yok - web paneli derlenemez. 'npm install' kos ya da -WebPanelHaric ver."
  }
  if (Test-Path $webDist) { Remove-Item $webDist -Recurse -Force }  # bayat cikti gitmesin
  Push-Location $elektron
  npm run build:web
  $webRc = $LASTEXITCODE
  Pop-Location
  if ($webRc -ne 0) { Fail "Web paneli derlemesi basarisiz - paket uretilmedi." }
  # ⚠️ Cikti KONTROL EDILIR: derleme 0 dondurup bos klasor birakirsa ariza
  # sunucuda "panel yerine durum sayfasi" olarak, haftalar sonra gorunurdu.
  if (-not (Test-Path (Join-Path $webDist "index.html"))) {
    Fail "dist-web\index.html yok - web paneli derlemesi bos cikti uretti."
  }
}

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
Copy-Item "$proj\prisma\schema.prisma" "$stage\prisma\"
Copy-Item "$proj\prisma\migrations"    "$stage\prisma\migrations" -Recurse
$migSayi = (Get-ChildItem "$stage\prisma\migrations" -Directory).Count
Write-Host "  prisma      : schema.prisma + $migSayi migration  (seed*.ts DAHIL DEGIL)"

# cwd'den okunan varliklar
Copy-Item "$proj\public" "$stage\public" -Recurse
Copy-Item "$proj\assets" "$stage\assets" -Recurse
Write-Host "  public+assets: durum sayfasi + etiket fontlari"

# Web paneli - sunucuda `app\dist-web` olur; .env'deki WEB_DIST_DIR bunu gosterir.
if (-not $WebPanelHaric) {
  Copy-Item $webDist "$stage\dist-web" -Recurse
  $webSayi = (Get-ChildItem "$stage\dist-web" -Recurse -File).Count
  $webMB = [math]::Round(((Get-ChildItem "$stage\dist-web" -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
  Write-Host "  dist-web    : $webSayi dosya / $webMB MB  (WEB_DIST_DIR bunu gosterir)"
}

# manifest / calistirici
Copy-Item "$proj\package.json"        "$stage\"
Copy-Item "$proj\package-lock.json"   "$stage\"
Copy-Item "$proj\ecosystem.config.js" "$stage\"

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
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "prisma generate basarisiz." }
  Pop-Location
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

$manifest = [ordered]@{
  ad              = $ad
  commit          = $commit
  dal             = $dal
  calismaAgaciTemiz = [bool](-not $kirli)
  uretimZamani    = (Get-Date).ToString("s")
  # Makine/kullanici adi: Windows'ta COMPUTERNAME+USERNAME, POSIX'te HOSTNAME+USER.
  # Damga bilgi amacli; cozulemezse "?" yazilir, paketleme DURMAZ.
  ureten          = "$([System.Environment]::MachineName)\$([System.Environment]::UserName)"
  paketleyenPlatform = if ($IsWindows) { "windows" } elseif ($IsMacOS) { "macos" } else { "linux" }
  nodeSurumu      = (& node --version).Trim()
  npmSurumu       = (& npm --version).Trim()
  uygulamaSurumu  = (Get-Content "$proj\package.json" -Raw | ConvertFrom-Json).version
  migrationSayisi = $migSayi
  nodeModulesDahil= (-not $NodeModulesHaric)
  # PAKET.json'in KENDISI bu sayiya dahil DEGILDIR (henuz yazilmadi). Zip'te
  # tam olarak $dosyalar.Count + 1 girdi olmasi beklenir - kapi bunu olcer.
  dosyaSayisi     = $dosyalar.Count
  toplamBayt      = ($dosyalar | Measure-Object Length -Sum).Sum
  serverJsSha256  = (Get-FileHash "$stage\dist\server.js" -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 4 | Out-File "$stage\PAKET.json" -Encoding utf8
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
try   { $gercek = @($arsivOku.Entries | Where-Object { $_.FullName -notmatch '/$' }).Count
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
& node (Join-Path $repo "scripts/backend-surum.mjs") --etiketle $yeniSurum

$zipMB = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$sha   = (Get-FileHash $zip -Algorithm SHA256).Hash

Set-Location $repo
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  PAKET HAZIR" -ForegroundColor Green
Write-Host "  $zip"
Write-Host "  $zipMB MB  |  commit $commit  |  $migSayi migration"
Write-Host "  SHA256: $sha"
Write-Host ""
Write-Host "  Sunucuya kopyala, sonra YONETICI PowerShell'de:"
Write-Host "    C:\Etkili-Yazilim\kur.ps1 -Paket <zip yolu>"
Write-Host "================================================================"
Write-Host ""
