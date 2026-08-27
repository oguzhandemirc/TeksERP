<#
.SYNOPSIS
    Electron panelinin yeni sürümünü güncelleme sunucusuna yayınlar.

.DESCRIPTION
    `npm run build:win` çıktısındaki ÜÇ dosyayı VPS'e yükler ve yayının
    gerçekten göründüğünü doğrular. Reçete:
    docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md

    Yükleme SIRASI script'in asıl işidir: `latest.yml` EN SON gider. Ters
    sırada, henüz yüklenmemiş bir .exe'yi işaret eden bir latest.yml yayında
    kalır ve o aralıkta kontrol yapan paneller "sürüm dosyası bulunamadı" der.

.PARAMETER Surum
    Yayınlanacak sürüm (örn "2.8.0"). Verilmezse Electron/package.json okunur.

.EXAMPLE
    .\deploy\electron-yayinla.ps1
    .\deploy\electron-yayinla.ps1 -Surum 2.8.1

.NOTES
    Bash ikizindeki `--dogrula` (yukleme yapmadan mevcut yayini denetleme) kipi
    burada YOK: bu script'in gelistirildigi makinede PowerShell bulunmadigi icin
    o kod yolu calistirilarak dogrulanamazdi. Windows'ta yayini denetlemek icin
    bash ikizini (`deploy/electron-yayinla.sh --dogrula`) ya da elle:
        curl -s https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml
#>
[CmdletBinding()]
param(
    [string]$Surum,
    [string]$SshHedef = "oguzhan@91.217.119.138",
    [int]$SshPort = 2222,
    [string]$UzakDizin = "/opt/stack/apps/tekserp-guncelleme/html/adnansahin/electron",
    [string]$YayinUrl = "https://guncelleme.etkiliyazilim.com/adnansahin/electron"
)

$ErrorActionPreference = "Stop"
$kok = Split-Path -Parent $PSScriptRoot
$electronDir = Join-Path $kok "Electron"

function Fail([string]$m) { Write-Host "HATA: $m" -ForegroundColor Red; exit 1 }

# --- Sürüm ---------------------------------------------------------------
if (-not $Surum) {
    $pkgPath = Join-Path $electronDir "package.json"
    if (-not (Test-Path $pkgPath)) { Fail "package.json bulunamadi: $pkgPath" }
    $Surum = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
}
Write-Host "Surum: $Surum" -ForegroundColor Cyan

$releaseDir = Join-Path $electronDir "release\$Surum"
if (-not (Test-Path $releaseDir)) {
    Fail "Paket klasoru yok: $releaseDir`n  Once 'npm run build:win' calistir. Surum numarasini ARTIRMAYI unutma."
}

# --- Uc dosya de sart ----------------------------------------------------
$setup    = Join-Path $releaseDir "TeksERP-$Surum-Setup.exe"
$blockmap = "$setup.blockmap"
$latest   = Join-Path $releaseDir "latest.yml"

foreach ($f in @($setup, $blockmap, $latest)) {
    if (-not (Test-Path $f)) {
        Fail "Eksik dosya: $f`n  latest.yml yoksa package.json > build.publish eksik olabilir."
    }
}
# latest.yml gercekten BU surumu mu gosteriyor? (eski build kalintisi tuzagi)
$latestIcerik = Get-Content $latest -Raw
if ($latestIcerik -notmatch [regex]::Escape("version: $Surum")) {
    Fail "latest.yml '$Surum' surumunu gostermiyor - eski build kalintisi olabilir. Once release\$Surum klasorunu silip yeniden derle."
}

$mb = [math]::Round((Get-Item $setup).Length / 1MB, 1)
Write-Host "Yuklenecek: TeksERP-$Surum-Setup.exe ($mb MB) + blockmap + latest.yml`n"

# --- Yukleme: latest.yml EN SON -----------------------------------------
Write-Host "1/2  Kurulum paketi + blockmap yukleniyor..." -ForegroundColor Cyan
& scp -P $SshPort $setup $blockmap "${SshHedef}:$UzakDizin/"
if ($LASTEXITCODE -ne 0) { Fail "scp basarisiz (paket)." }

Write-Host "2/2  latest.yml yukleniyor (en son - sira onemli)..." -ForegroundColor Cyan
& scp -P $SshPort $latest "${SshHedef}:$UzakDizin/"
if ($LASTEXITCODE -ne 0) { Fail "scp basarisiz (latest.yml). Paket yuklendi ama yayin ACIK DEGIL - komutu tekrarla." }

# --- Dogrulama -----------------------------------------------------------
# Her dosyayi ONCE temiz URL ile, sorun varsa onbellegi atlayarak dener. Amac,
# "404" ile "onbellekte kalmis 404"u YUKLEME ANINDA ayirmak: ikisi ayni gorunur
# ama biri yeniden yuklemekle, digeri yalniz Cloudflare purge'uyle cozulur.
# (2026-08-26'da bu ayrim elle yapildi; buraya o yuzden kondu.)
Write-Host "`nDogrulaniyor..." -ForegroundColor Cyan

function Get-Kod([string]$u) {
    try { return (Invoke-WebRequest -Uri $u -Method Head -UseBasicParsing -TimeoutSec 20).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return 0 } }
}

function Test-Yayin([string]$ad, [long]$yerelBoyut) {
    $url = "$YayinUrl/$ad"
    $bust = "$url" + "?onbellek-atla=" + $PID
    $kod = Get-Kod $url
    if ($kod -ne 200) {
        if ((Get-Kod $bust) -eq 200) {
            Fail "$ad - ONBELLEK SORUNU (temiz URL: $kod, origin: 200).`n  Dosya sunucuda DURUYOR; Cloudflare eski bir yaniti onbellekte tutuyor.`n  Cozum: Cloudflare > Caching > Configuration > Purge Cache > Custom Purge > By URL:`n    $url"
        }
        Fail "$ad - yayinda gorunmuyor (HTTP $kod). Dosya gercekten yuklenmemis olabilir."
    }
    if ($yerelBoyut -gt 0) {
        # Yarim yuklenmis dosya 200 doner ama eksiktir.
        $uzak = [long](Invoke-WebRequest -Uri $bust -Method Head -UseBasicParsing -TimeoutSec 20).Headers['Content-Length']
        if ($uzak -ne $yerelBoyut) {
            Fail "$ad - boyut usmuyor (yerel: $yerelBoyut, yayinda: $uzak). Yukleme yarim kalmis olabilir."
        }
    }
}

try {
    $icerik = (Invoke-WebRequest -Uri ("$YayinUrl/latest.yml?onbellek-atla=" + $PID) -UseBasicParsing -TimeoutSec 20).Content
    if ($icerik -notmatch "version:\s*$([regex]::Escape($Surum))") {
        Fail "Yayindaki latest.yml beklenen surumu gostermiyor:`n$icerik"
    }
    Test-Yayin "latest.yml" 0
    Test-Yayin "TeksERP-$Surum-Setup.exe.blockmap" (Get-Item $blockmap).Length
    Test-Yayin "TeksERP-$Surum-Setup.exe" (Get-Item $setup).Length
    Write-Host "OK - yayinda: $Surum" -ForegroundColor Green
} catch {
    if ($_.Exception.Message -like "*ONBELLEK*" -or $_.Exception.Message -like "*yayinda gorunmuyor*") { throw }
    Fail "Yayin dogrulanamadi: $($_.Exception.Message)"
}

Write-Host "`nFabrikadaki paneller en gec 4 saat icinde gorur." -ForegroundColor Green
Write-Host "Hemen denemek icin: Genel Ayarlar > Bu Bilgisayar > Guncelleme > Simdi kontrol et"
