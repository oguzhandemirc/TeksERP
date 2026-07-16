# =============================================================================
# TeksERP - Docker Yonetim Scripti  (yonet.ps1)
# =============================================================================
# Windows (Docker Desktop) icin tek script: PostgreSQL + backend'i Docker ile
# ayaga kaldirir ve yonetir. Native (setup.exe) kuruluma ALTERNATIF yoldur.
# manage.ps1 (native) ile ayni eylem isimlerini kullanir -> parite.
#
#   .\yonet.ps1 up          Ilk kurulum + guncelleme (container'lari build + baslat)
#   .\yonet.ps1 down        Durdur (container'lari kapat, VERI KORUNUR)
#   .\yonet.ps1 restart     Yeniden baslat
#   .\yonet.ps1 status      Durum + saglik kontrolu
#   .\yonet.ps1 logs        Backend loglarini CANLI izle (Ctrl+C ile cik)
#   .\yonet.ps1 logs -Tail 200
#   .\yonet.ps1 backup      backups\ icine .dump al
#   .\yonet.ps1 restore -BackupFile tekserp_YYYYAAGG.dump
#   .\yonet.ps1 update      Kod degistiyse yeniden build edip baslat (once git pull)
#
# Windows PowerShell 5.1 + PowerShell 7 uyumlu.
# =============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('up', 'down', 'restart', 'status', 'logs', 'backup', 'restore', 'update')]
    [string]$Action,
    [int]$Tail = 100,
    [string]$BackupFile
)

$ErrorActionPreference = 'Stop'

# Backend koku = bu scriptin iki ustu (installer\docker -> Teks-Erp)
$Root      = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile   = Join-Path $Root '.env.docker'
$BackupDir = Join-Path $Root 'backups'
$ApiPort   = 4000

function Say  { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Ok   { param($m) Write-Host "    OK $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "    ! $m"  -ForegroundColor Yellow }
function Die  { param($m) Write-Host "    X $m"  -ForegroundColor Red; exit 1 }

function New-Secret {
    param([int]$Bytes = 32)
    $b = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
    try { $rng.GetBytes($b) } finally { $rng.Dispose() }
    -join ($b | ForEach-Object { $_.ToString('x2') })
}

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Die "Docker yuklu degil. Docker Desktop kur: https://docs.docker.com/desktop/install/windows-install/"
    }
    try { docker info *> $null } catch { Die "Docker calismyor. Docker Desktop'i ac ve tekrar dene." }
    try { docker compose version *> $null } catch { Die "'docker compose' bulunamadi. Docker'i guncelle." }
}

# .env.docker yoksa rastgele sifre + JWT ile uret (baslat.sh ile ayni format).
function Ensure-Env {
    if (Test-Path $EnvFile) { return }
    Say ".env.docker yok -> rastgele sifre + JWT secret uretiliyor..."
    $content = @"
POSTGRES_USER=tekserp
POSTGRES_PASSWORD=$(New-Secret 20)
POSTGRES_DB=tekserp
JWT_SECRET=$(New-Secret 32)
"@
    Set-Content -Path $EnvFile -Value $content -Encoding ascii
    Ok ".env.docker olusturuldu (gizli tut, yedekle - kaybolursa DB'ye baglanilamaz)."
}

# docker compose'u dogru dizin + env-file ile calistir.
function Compose {
    Push-Location $Root
    try { & docker compose --env-file $EnvFile @args }
    finally { Pop-Location }
}

function Get-LanIp {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress
    if ($ip) { $ip } else { '<sunucu-ip-adresi>' }
}

function Test-Health {
    for ($i = 0; $i -lt 20; $i++) {
        try {
            $r = Invoke-WebRequest "http://localhost:$ApiPort/health" -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { return $true }
        } catch { }
        Start-Sleep 2
    }
    return $false
}

# -----------------------------------------------------------------------------
switch ($Action) {

    'up' {
        Assert-Docker
        Ensure-Env
        if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
        Say "Container'lar build edilip baslatiliyor (ilk seferde 2-4 dk)..."
        Compose up -d --build
        Say "Backend saglik kontrolu..."
        $healthy = Test-Health
        $ip = Get-LanIp
        Write-Host ""
        Write-Host "================================================================" -ForegroundColor White
        if ($healthy) { Write-Host "  TeksERP backend HAZIR (Docker)" -ForegroundColor Green }
        else { Write-Host "  Container ayakta ama henuz cevap vermiyor -> .\yonet.ps1 logs" -ForegroundColor Yellow }
        Write-Host "================================================================" -ForegroundColor White
        Write-Host ""
        Write-Host "  Bu sunucuda:    http://localhost:$ApiPort"
        Write-Host "  Fabrika aginda: http://${ip}:$ApiPort" -ForegroundColor Green
        Write-Host "  Swagger:        http://${ip}:$ApiPort/api-docs"
        Write-Host "  Test girisi:    admin / 123123"
        Write-Host ""
        Write-Host "  Migration + seed container acilisinda otomatik calisti (entrypoint.sh)."
        Write-Host "  Log:  .\yonet.ps1 logs    Durum: .\yonet.ps1 status    Durdur: .\yonet.ps1 down"
        Write-Host ""
    }

    'down' {
        Assert-Docker
        Say "Container'lar durduruluyor (veri korunur; volume silinmez)..."
        Compose down
        Ok "Durduruldu. Veri Docker volume'lerinde (pg_data) korunuyor."
    }

    'restart' {
        Assert-Docker
        Compose restart
        Ok "Yeniden baslatildi."
    }

    'status' {
        Assert-Docker
        Compose ps
        Write-Host ""
        if (Test-Health) { Write-Host "  Saglik: backend cevap veriyor (http://localhost:$ApiPort)" -ForegroundColor Green }
        else { Write-Host "  Saglik: backend CEVAP VERMIYOR -> .\yonet.ps1 logs" -ForegroundColor Yellow }
    }

    'logs' {
        Assert-Docker
        Write-Host "Canli log (Ctrl+C ile cik)..." -ForegroundColor DarkGray
        Compose logs -f --tail $Tail backend
    }

    'backup' {
        Assert-Docker
        if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
        $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
        $name  = "tekserp_$stamp.dump"
        Say "Yedek aliniyor -> backups\$name"
        # backend container'inda pg_dump var (Dockerfile: postgresql16-client) ve /backups host'a bagli.
        Compose exec -T backend sh -c "pg_dump `"`$DATABASE_URL`" -Fc -f /backups/$name"
        if (Test-Path (Join-Path $BackupDir $name)) {
            # secret.docker'i da yaninda tut: geri yukleme icin .env.docker gerekir.
            Copy-Item $EnvFile (Join-Path $BackupDir "env_$stamp.txt") -Force -ErrorAction SilentlyContinue
            Ok "Yedek hazir: $(Join-Path $BackupDir $name)"
            Warn ".env.docker'i da sakla (env_$stamp.txt olarak kopyalandi) - sifreler orada."
        } else { Die "Yedek olusmadi. .\yonet.ps1 logs ile kontrol et." }
    }

    'restore' {
        Assert-Docker
        if (-not $BackupFile) { Die "Kullanim: .\yonet.ps1 restore -BackupFile tekserp_YYYYAAGG_SSDDSS.dump" }
        $leaf = Split-Path $BackupFile -Leaf
        if (-not (Test-Path (Join-Path $BackupDir $leaf))) { Die "Dosya backups\ icinde yok: $leaf" }
        Warn "GERI YUKLEME mevcut veriyi $leaf ile DEGISTIRIR. 5 sn icinde Ctrl+C ile iptal..."
        Start-Sleep 5
        Say "Geri yukleniyor: $leaf"
        Compose exec -T backend sh -c "pg_restore -d `"`$DATABASE_URL`" --clean --if-exists /backups/$leaf"
        Ok "Geri yukleme tamam."
    }

    'update' {
        Assert-Docker
        Say "Yeni kod build edilip baslatiliyor (once 'git pull' yaptigindan emin ol)..."
        Compose up -d --build
        Ok "Guncellendi. Migration'lar entrypoint'te otomatik uygulandi; seed ATLANIR (veri korunur)."
    }
}
