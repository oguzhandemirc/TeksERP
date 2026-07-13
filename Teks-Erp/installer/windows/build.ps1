# =============================================================================
# TeksERP - Windows Setup Paketi Olusturucu  (build.ps1)
# =============================================================================
# Bu script BIR WINDOWS makinede calistirilir ve TeksERP-Setup-<surum>.exe uretir.
#
#   1. Backend'i derler (src + prisma/seed -> .build\bundle)
#   2. Uretim node_modules'unu hazirlar (+ Windows Prisma engine)
#   3. Gomulu runtime'lari indirir: Node, PostgreSQL, NSSM (.cache'te onbellek)
#   4. payload\ + runtime\ klasorlerini stage'ler
#   5. Inno Setup (ISCC.exe) ile dist\TeksERP-Setup-<surum>.exe uretir
#
# Gereksinimler (build makinesinde):
#   - Node.js + npm  (backend'i derlemek + prisma generate icin)
#   - Inno Setup 6   (https://jrsoftware.org/isdl.php) -> ISCC.exe
#   - Internet (runtime'lar ilk seferde indirilir, sonra .cache'ten gelir)
#
# Kullanim:
#   cd Teks-Erp\installer\windows
#   powershell -ExecutionPolicy Bypass -File build.ps1
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Version 1.1.0
# =============================================================================

[CmdletBinding()]
param(
    [string]$Version,
    [switch]$SkipNpm,        # node_modules zaten hazirsa derlemeyi atla
    [switch]$SkipDownload    # runtime'lar .cache'te ise indirmeyi atla
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest cok hizlanir

# --- Indirilecek surumler (gerektikce guncelleyin) ---
$NodeVersion = "22.13.1"
$PgVersion   = "18.4-1"     # EnterpriseDB binaries-zip surumu (dev PostgreSQL 18.4 ile parite)
$NssmVersion = "2.24"

$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$PgUrl   = "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64-binaries.zip"
$NssmUrl = "https://nssm.cc/release/nssm-$NssmVersion.zip"

# --- Yollar ---
$Here    = $PSScriptRoot
$Backend = Resolve-Path (Join-Path $Here "..\..")    # Teks-Erp/
$Cache   = Join-Path $Here ".cache"
$Build   = Join-Path $Here ".build"
$Bundle  = Join-Path $Build "bundle"
$Payload = Join-Path $Here "payload"
$Runtime = Join-Path $Here "runtime"
$DistDir = Join-Path $Here "dist"

function Say  { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Done { param($m) Write-Host "    OK $m" -ForegroundColor Green }

# Surumu package.json'dan al (verilmediyse)
if (-not $Version) {
    $pkg = Get-Content (Join-Path $Backend "package.json") -Raw | ConvertFrom-Json
    $Version = $pkg.version
}
Say "Surum: $Version"

# -----------------------------------------------------------------------------
# 0) Temiz stage
# -----------------------------------------------------------------------------
foreach ($d in @($Payload, $Runtime, $Bundle, $DistDir)) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    New-Item -ItemType Directory -Path $d -Force | Out-Null
}
New-Item -ItemType Directory -Path $Cache -Force | Out-Null

# -----------------------------------------------------------------------------
# 1) Backend derle + node_modules (uretim) + Prisma client (Windows engine)
# -----------------------------------------------------------------------------
Push-Location $Backend
try {
    if (-not $SkipNpm) {
        Say "npm ci (tum bagimliliklar)..."
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci basarisiz." }
    }

    # Prisma client tsc'den ONCE uretilmeli: src/* kodu `import { Prisma } from
    # '@prisma/client'` kullanir; client generate edilmeden bu tip yok ve tsc
    # "has no exported member 'Prisma'" + implicit-any hatalariyla patlar.
    Say "Prisma client uretiliyor (tsc oncesi - tip bilgisi icin)..."
    & npx.cmd prisma generate
    if ($LASTEXITCODE -ne 0) { throw "prisma generate (tsc oncesi) basarisiz." }
    Done "Prisma client hazir."

    Say "Backend derleniyor (src + prisma/seed -> .build\bundle)..."
    & npx.cmd tsc -p (Join-Path $Here "tsconfig.bundle.json")
    if ($LASTEXITCODE -ne 0) { throw "tsc derleme basarisiz." }
    Done "Derleme tamam."

    Say "Uretim node_modules hazirlaniyor (devDependencies cikariliyor)..."
    & npm.cmd prune --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm prune basarisiz." }

    # prune sonrasi Windows engine'in pruned agacta oldugundan emin ol.
    Say "Prisma client + Windows engine yeniden uretiliyor (prune sonrasi)..."
    & npx.cmd prisma generate
    if ($LASTEXITCODE -ne 0) { throw "prisma generate basarisiz." }
    Done "node_modules hazir."
} finally {
    Pop-Location
}

# -----------------------------------------------------------------------------
# 2) payload\ stage  (kurulum {app} icine acilacak)
# -----------------------------------------------------------------------------
Say "payload\ hazirlaniyor..."
$AppOut = Join-Path $Payload "app"
New-Item -ItemType Directory -Path $AppOut -Force | Out-Null

# Derlenmis JS -> app\dist  (dist\src\server.js , dist\prisma\seed.js)
# Hedef klasoru once olustur: yoksa Copy-Item coklu ogeyi (src, prisma) tek
# hedefe kopyalarken "Container cannot be copied onto existing leaf" hatasi verir.
$DistOut = Join-Path $AppOut "dist"
New-Item -ItemType Directory -Path $DistOut -Force | Out-Null
Copy-Item (Join-Path $Bundle "*") $DistOut -Recurse -Force
# Uretim bagimliliklari
Copy-Item (Join-Path $Backend "node_modules") (Join-Path $AppOut "node_modules") -Recurse -Force
# Prisma sema + migration'lar (ust klasor Copy-Item tarafindan olusturulmaz -> once yarat)
New-Item -ItemType Directory -Path (Join-Path $AppOut "prisma") -Force | Out-Null
Copy-Item (Join-Path $Backend "prisma\schema.prisma") (Join-Path $AppOut "prisma\schema.prisma") -Force
Copy-Item (Join-Path $Backend "prisma\migrations")    (Join-Path $AppOut "prisma\migrations") -Recurse -Force
# package.json (prisma CLI okuyabilir)
Copy-Item (Join-Path $Backend "package.json") (Join-Path $AppOut "package.json") -Force
# Uretim Prisma config (DUZ JS - ts-node gerektirmez)
Copy-Item (Join-Path $Here "prisma.config.prod.js") (Join-Path $AppOut "prisma.config.js") -Force
# Durum sayfasi statik dosyalari (public\ -> app\public): kok / adresinde markali
# API/DB durum sayfasi sunulur. CWD = app\ oldugundan express.static bunu bulur.
if (Test-Path (Join-Path $Backend "public")) {
    Copy-Item (Join-Path $Backend "public") (Join-Path $AppOut "public") -Recurse -Force
    Done "Durum sayfasi (public\) eklendi."
}
# Raster etiket fontlari (assets\fonts\ -> app\assets\fonts): raster baski DejaVu
# TTF'leri process.cwd()/assets/fonts'tan okur (raster-font.ts). CWD = app\ oldugundan
# burada bulunur. Eksikse raster ilk cagirida Turkce hata verip KOMUT moduna duser
# (baski durmaz), ama raster cihazlarda font ZORUNLU -> bundle'a dahil.
if (Test-Path (Join-Path $Backend "assets")) {
    Copy-Item (Join-Path $Backend "assets") (Join-Path $AppOut "assets") -Recurse -Force
    Done "Raster etiket fontlari (assets\) eklendi."
}
Done "payload\ hazir."

# -----------------------------------------------------------------------------
# 3) Gomulu runtime'lar (indir + onbellek)
# -----------------------------------------------------------------------------
function Get-Cached {
    param([string]$Url, [string]$FileName)
    $path = Join-Path $Cache $FileName
    # Onbellekte gecerli (bos olmayan) dosya varsa HER ZAMAN onu kullan — indirme.
    if ((Test-Path $path) -and ((Get-Item $path).Length -gt 0)) { Done "onbellek: $FileName"; return $path }
    if ($SkipDownload) { throw "$FileName onbellekte yok ama -SkipDownload verildi." }
    Say "Indiriliyor: $FileName"
    $tmp = "$path.partial"
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
    Move-Item $tmp $path -Force   # yarim/bozuk indirme onbellege gecmesin
    return $path
}

$tmp = Join-Path $Build "extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

# 3a) Node.js - sadece node.exe lazim
Say "Node.js runtime..."
$nodeZip = Get-Cached -Url $NodeUrl -FileName "node-v$NodeVersion-win-x64.zip"
Expand-Archive -Path $nodeZip -DestinationPath $tmp -Force
$nodeExe = Join-Path $tmp "node-v$NodeVersion-win-x64\node.exe"
New-Item -ItemType Directory -Path (Join-Path $Runtime "node") -Force | Out-Null
Copy-Item $nodeExe (Join-Path $Runtime "node\node.exe") -Force
Done "node.exe gomuldu."

# 3b) PostgreSQL - pgsql\ (bin, lib, share)
Say "PostgreSQL binaries..."
$pgZip = Get-Cached -Url $PgUrl -FileName "postgresql-$PgVersion-win-x64-binaries.zip"
Expand-Archive -Path $pgZip -DestinationPath $tmp -Force
# Zip icindeki kok klasor: pgsql\
Copy-Item (Join-Path $tmp "pgsql") (Join-Path $Runtime "pgsql") -Recurse -Force
# Gereksiz semboller/dokuman'i atarak biraz kucult (opsiyonel, guvenli olanlar)
foreach ($junk in @("doc", "include", "pgAdmin 4", "symbols", "StackBuilder")) {
    $p = Join-Path $Runtime "pgsql\$junk"
    if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
}
Done "PostgreSQL gomuldu."

# 3c) NSSM
Say "NSSM (servis yoneticisi)..."
$nssmZip = Get-Cached -Url $NssmUrl -FileName "nssm-$NssmVersion.zip"
Expand-Archive -Path $nssmZip -DestinationPath $tmp -Force
$nssmExe = Join-Path $tmp "nssm-$NssmVersion\win64\nssm.exe"
Copy-Item $nssmExe (Join-Path $Runtime "nssm.exe") -Force
Done "nssm.exe gomuldu."

# -----------------------------------------------------------------------------
# 3d) Sihirbaz logosu (BMP) — Inno modern sihirbazinin kucuk gorseli .bmp ister.
#     Logo PNG'sinden oraninikoruyarak beyaz zemin uzerine 138x140 BMP uretilir.
# -----------------------------------------------------------------------------
function New-WizardBmp {
    param([string]$Png, [string]$OutBmp, [int]$W, [int]$H)
    Add-Type -AssemblyName System.Drawing
    $src = [System.Drawing.Image]::FromFile($Png)
    try {
        $bmp = New-Object System.Drawing.Bitmap $W, $H
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.Clear([System.Drawing.Color]::White)
        $pad = 12
        $ratio = [Math]::Min(($W - 2 * $pad) / $src.Width, ($H - 2 * $pad) / $src.Height)
        $dw = [int]($src.Width * $ratio); $dh = [int]($src.Height * $ratio)
        $g.DrawImage($src, [int](($W - $dw) / 2), [int](($H - $dh) / 2), $dw, $dh)
        $g.Dispose()
        $bmp.Save($OutBmp, [System.Drawing.Imaging.ImageFormat]::Bmp)
        $bmp.Dispose()
    } finally { $src.Dispose() }
}

$brandDir = Join-Path $Here "branding"
$brandPng = Join-Path $brandDir "logo.png"
if (Test-Path $brandPng) {
    Say "Sihirbaz logosu (BMP) uretiliyor..."
    New-WizardBmp -Png $brandPng -OutBmp (Join-Path $brandDir "wizard-small.bmp") -W 138 -H 140
    Done "branding\wizard-small.bmp hazir."
}

# -----------------------------------------------------------------------------
# 4) Inno Setup derle
# -----------------------------------------------------------------------------
Say "Inno Setup (ISCC.exe) araniyor..."
$iscc = $null
$candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"   # winget kullanici-bazli kurulum
)
foreach ($c in $candidates) { if (Test-Path $c) { $iscc = $c; break } }
if (-not $iscc) {
    $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($cmd) { $iscc = $cmd.Source }
}
if (-not $iscc) {
    throw "ISCC.exe bulunamadi. Inno Setup 6 kur: https://jrsoftware.org/isdl.php"
}
Done "ISCC: $iscc"

Say "setup.exe derleniyor..."
& $iscc "/DMyAppVersion=$Version" (Join-Path $Here "setup.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC derleme basarisiz." }

$out = Join-Path $DistDir "TeksERP-Setup-$Version.exe"
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  TAMAM:  $out" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Bu dosyayi fabrika sunucusuna kopyalayip cift tikla."
Write-Host "  Yeni surum: surumu yukselt, build.ps1'i tekrar calistir, yeni exe'yi sunucuda calistir."
Write-Host ""
