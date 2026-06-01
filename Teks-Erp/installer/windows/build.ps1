# =============================================================================
# TeksERP — Windows Setup Paketi Olusturucu  (build.ps1)
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
$PgVersion   = "16.6-1"     # EnterpriseDB binaries-zip surumu
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
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci basarisiz." }
    }

    Say "Backend derleniyor (src + prisma/seed -> .build\bundle)..."
    & npx tsc -p (Join-Path $Here "tsconfig.bundle.json")
    if ($LASTEXITCODE -ne 0) { throw "tsc derleme basarisiz." }
    Done "Derleme tamam."

    Say "Uretim node_modules hazirlaniyor (devDependencies cikariliyor)..."
    & npm prune --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "npm prune basarisiz." }

    Say "Prisma client + Windows engine uretiliyor (prisma generate)..."
    & npx prisma generate
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
Copy-Item (Join-Path $Bundle "*") (Join-Path $AppOut "dist") -Recurse -Force
# Uretim bagimliliklari
Copy-Item (Join-Path $Backend "node_modules") (Join-Path $AppOut "node_modules") -Recurse -Force
# Prisma sema + migration'lar
Copy-Item (Join-Path $Backend "prisma\schema.prisma") (Join-Path $AppOut "prisma\schema.prisma") -Force
Copy-Item (Join-Path $Backend "prisma\migrations")    (Join-Path $AppOut "prisma\migrations") -Recurse -Force
# package.json (prisma CLI okuyabilir)
Copy-Item (Join-Path $Backend "package.json") (Join-Path $AppOut "package.json") -Force
# Uretim Prisma config (DUZ JS — ts-node gerektirmez)
Copy-Item (Join-Path $Here "prisma.config.prod.js") (Join-Path $AppOut "prisma.config.js") -Force
Done "payload\ hazir."

# -----------------------------------------------------------------------------
# 3) Gomulu runtime'lar (indir + onbellek)
# -----------------------------------------------------------------------------
function Get-Cached {
    param([string]$Url, [string]$FileName)
    $path = Join-Path $Cache $FileName
    if ((Test-Path $path) -and -not $SkipDownload) { Done "onbellek: $FileName"; return $path }
    if ($SkipDownload -and -not (Test-Path $path)) { throw "$FileName onbellekte yok ama -SkipDownload verildi." }
    Say "Indiriliyor: $FileName"
    Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing
    return $path
}

$tmp = Join-Path $Build "extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

# 3a) Node.js — sadece node.exe lazim
Say "Node.js runtime..."
$nodeZip = Get-Cached -Url $NodeUrl -FileName "node-v$NodeVersion-win-x64.zip"
Expand-Archive -Path $nodeZip -DestinationPath $tmp -Force
$nodeExe = Join-Path $tmp "node-v$NodeVersion-win-x64\node.exe"
New-Item -ItemType Directory -Path (Join-Path $Runtime "node") -Force | Out-Null
Copy-Item $nodeExe (Join-Path $Runtime "node\node.exe") -Force
Done "node.exe gomuldu."

# 3b) PostgreSQL — pgsql\ (bin, lib, share)
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
# 4) Inno Setup derle
# -----------------------------------------------------------------------------
Say "Inno Setup (ISCC.exe) araniyor..."
$iscc = $null
$candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
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
