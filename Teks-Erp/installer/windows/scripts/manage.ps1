# =============================================================================
# TeksERP — Windows Servis Yöneticisi  (manage.ps1)
# =============================================================================
# Bu script, setup.exe tarafından kurulum sonrası ve kaldırma öncesi çağrılır.
# Yönetici tarafından elle de çalıştırılabilir (komutlar README-KURULUM.md'de).
#
#   .\manage.ps1 -Action install      İlk kurulum + güncelleme (idempotent)
#   .\manage.ps1 -Action uninstall     Servisleri kaldır (veri korunur)
#   .\manage.ps1 -Action uninstall -RemoveData   Servisleri + TÜM veriyi sil
#   .\manage.ps1 -Action start|stop|restart|status
#   .\manage.ps1 -Action backup [-BackupPath C:\yedek]
#   .\manage.ps1 -Action restore -BackupFile C:\yedek\tekserp_xxx.dump
#
# Windows PowerShell 5.1 ile uyumludur (Windows Server varsayılanı). PS7 de çalışır.
# =============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("install", "uninstall", "start", "stop", "restart", "status", "backup", "restore")]
    [string]$Action,

    # setup.exe kurulum dizinini geçer; elle çalıştırırken script kendi konumundan bulur.
    [string]$InstallDir,
    [switch]$RemoveData,
    [string]$BackupPath,
    [string]$BackupFile
)

$ErrorActionPreference = "Stop"

# -----------------------------------------------------------------------------
# Sabitler / yollar
# -----------------------------------------------------------------------------
if (-not $InstallDir -or $InstallDir.Trim() -eq "") {
    # scripts\ klasörünün bir üstü = kurulum kökü
    $InstallDir = Split-Path -Parent $PSScriptRoot
}

$AppDir   = Join-Path $InstallDir "app"
$NodeExe  = Join-Path $InstallDir "runtime\node\node.exe"
$PgDir    = Join-Path $InstallDir "runtime\pgsql"
$PgBin    = Join-Path $PgDir "bin"
$Nssm     = Join-Path $InstallDir "runtime\nssm.exe"

$DataRoot   = "C:\ProgramData\TeksERP"
$PgData     = Join-Path $DataRoot "pgdata"
$LogDir     = Join-Path $DataRoot "logs"
$SecretFile = Join-Path $DataRoot "secret.json"
$SeededFlag = Join-Path $DataRoot ".seeded"
$EnvFile    = Join-Path $AppDir ".env"   # backend CWD'sinde dursun (dotenv)

# Servis ve DB ayarları
$DbServiceName      = "TeksErpDB"
$BackendServiceName = "TeksErpBackend"
$PgPort   = 5433                 # Mevcut bir Postgres ile çakışmasın diye 5432 değil
$ApiPort  = 4000
$DbName   = "TeksErpDb"
$DbUser   = "tekserp"
$PgSuper  = "postgres"
$Tz       = "Europe/Istanbul"
$PgAccount = "NT AUTHORITY\NetworkService"  # postgres yönetici hesabıyla ÇALIŞMAZ; NetworkService standart

# -----------------------------------------------------------------------------
# Yardımcılar
# -----------------------------------------------------------------------------
function Write-Step  { param($m) Write-Host "  -> $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "  OK $m" -ForegroundColor Green }
function Write-Warn2 { param($m) Write-Host "  ! $m"  -ForegroundColor Yellow }
function Write-ErrX  { param($m) Write-Host "  X $m"  -ForegroundColor Red }

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Bu islem yonetici (Administrator) yetkisi gerektirir. PowerShell'i 'Yonetici olarak calistir' ile ac."
    }
}

function New-HexSecret {
    param([int]$Bytes = 32)
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $buf = New-Object byte[] $Bytes
    $rng.GetBytes($buf)
    ($buf | ForEach-Object { $_.ToString("x2") }) -join ""
}

# Sırları üret (ilk kurulum) veya mevcut dosyadan oku (güncelleme) — şifreler KORUNUR.
function Get-OrCreateSecrets {
    if (Test-Path $SecretFile) {
        Write-Step "Mevcut sirlar okunuyor (sifreler korunuyor)..."
        return (Get-Content $SecretFile -Raw | ConvertFrom-Json)
    }
    Write-Step "Ilk kurulum: rastgele sifre ve JWT secret uretiliyor..."
    $secrets = [pscustomobject]@{
        pgSuperPassword = New-HexSecret 24
        appDbPassword   = New-HexSecret 24
        jwtSecret       = New-HexSecret 32
    }
    if (-not (Test-Path $DataRoot)) { New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null }
    $secrets | ConvertTo-Json | Set-Content -Path $SecretFile -Encoding UTF8
    # Sadece SYSTEM + Administrators okusun
    icacls $SecretFile /inheritance:r /grant "SYSTEM:(F)" "Administrators:(F)" | Out-Null
    Write-Ok "Sirlar olusturuldu: $SecretFile (gizli)"
    return $secrets
}

function Get-DbUrl {
    param($Secrets, [string]$AsUser = $DbUser, [string]$Pass = $null)
    if (-not $Pass) { $Pass = $Secrets.appDbPassword }
    "postgresql://$AsUser`:$Pass@127.0.0.1:$PgPort/$DbName`?schema=public"
}

function Invoke-Psql {
    param([string]$Sql, [string]$Db = "postgres", [string]$SuperPass)
    $env:PGPASSWORD = $SuperPass
    & (Join-Path $PgBin "psql.exe") -h 127.0.0.1 -p $PgPort -U $PgSuper -d $Db -v ON_ERROR_STOP=1 -tAc $Sql
    $code = $LASTEXITCODE
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ($code -ne 0) { throw "psql hata kodu $code  (SQL: $Sql)" }
}

function Wait-PgReady {
    param([string]$SuperPass, [int]$TimeoutSec = 60)
    Write-Step "PostgreSQL hazir olmasi bekleniyor..."
    $isReady = Join-Path $PgBin "pg_isready.exe"
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        & $isReady -h 127.0.0.1 -p $PgPort -d postgres -U $PgSuper -t 2 *> $null
        if ($LASTEXITCODE -eq 0) { Write-Ok "PostgreSQL hazir."; return }
        Start-Sleep -Seconds 1
    }
    throw "PostgreSQL $TimeoutSec sn icinde hazir olmadi. Log: $PgData\log"
}

# -----------------------------------------------------------------------------
# DB: initdb + servis + rol/veritabani  (idempotent)
# -----------------------------------------------------------------------------
function Install-Database {
    param($Secrets)

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

    # NetworkService veri kokune (DataRoot) girip pgdata'ya ulasabilsin diye traverse izni.
    # secret.json kalitimi kapali oldugundan bu izin onu ACMAZ.
    icacls $DataRoot /grant "$PgAccount:(RX)" *> $null

    $alreadyInit = Test-Path (Join-Path $PgData "PG_VERSION")

    if (-not $alreadyInit) {
        Write-Step "PostgreSQL veri dizini olusturuluyor (initdb)..."
        New-Item -ItemType Directory -Path $PgData -Force | Out-Null

        # Servis hesabinin (NetworkService) pgdata'ya tam erisimi olmali
        icacls $PgData /grant "$PgAccount:(OI)(CI)F" /T | Out-Null

        $pwFile = Join-Path $env:TEMP ("teks_pg_pw_" + (New-HexSecret 6) + ".txt")
        Set-Content -Path $pwFile -Value $Secrets.pgSuperPassword -NoNewline -Encoding ASCII
        try {
            & (Join-Path $PgBin "initdb.exe") `
                -D $PgData -U $PgSuper -A scram-sha-256 --pwfile=$pwFile -E UTF8 --locale=C 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "initdb basarisiz (kod $LASTEXITCODE)." }
        } finally {
            Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
        }

        # postgresql.conf: yalniz localhost, ozel port, performans guvenlikleri (compose ile ayni)
        $conf = Join-Path $PgData "postgresql.conf"
        Add-Content -Path $conf -Value @"

# --- TeksERP ayarlari ---
listen_addresses = '127.0.0.1'
port = $PgPort
timezone = '$Tz'
log_timezone = '$Tz'
statement_timeout = '50s'
idle_in_transaction_session_timeout = '300000'
log_destination = 'stderr'
logging_collector = on
log_directory = 'log'
log_min_duration_statement = 500
"@
        Write-Ok "initdb tamamlandi."
    } else {
        Write-Step "Mevcut veri dizini bulundu (initdb atlaniyor) — guncelleme modu."
        icacls $PgData /grant "$PgAccount:(OI)(CI)F" /T | Out-Null
    }

    # Servisi kaydet (yoksa)
    $svc = Get-Service -Name $DbServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Step "PostgreSQL Windows servisi kaydediliyor ($DbServiceName)..."
        & (Join-Path $PgBin "pg_ctl.exe") register -N $DbServiceName -D $PgData -S auto 2>&1 | Out-Null
        Start-Sleep -Seconds 1
        # postgres, yonetici (LocalSystem) yetkisiyle calismayi REDDEDER -> NetworkService'e cevir.
        # CIM kullaniyoruz: PS 5.1 ve PS7'de calisir, sc.exe'nin bos parola argumani sorununu da onler.
        $cim = Get-CimInstance -ClassName Win32_Service -Filter "Name='$DbServiceName'" -ErrorAction SilentlyContinue
        if ($cim) {
            $chg = Invoke-CimMethod -InputObject $cim -MethodName Change `
                -Arguments @{ StartName = $PgAccount; StartPassword = "" }
            if ($chg.ReturnValue -ne 0) { Write-Warn2 "Servis hesabi NetworkService'e cevrilemedi (kod $($chg.ReturnValue))." }
        }
        & sc.exe description $DbServiceName "TeksERP PostgreSQL veritabani" *> $null
        Write-Ok "DB servisi kaydedildi."
    }

    Write-Step "PostgreSQL servisi baslatiliyor..."
    Start-Service -Name $DbServiceName
    Wait-PgReady -SuperPass $Secrets.pgSuperPassword

    # Rol + veritabani (idempotent)
    Write-Step "Uygulama rolu ve veritabani kontrol ediliyor..."
    $roleExists = Invoke-Psql -Sql "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'" -SuperPass $Secrets.pgSuperPassword
    if (-not $roleExists) {
        Invoke-Psql -Sql "CREATE ROLE $DbUser LOGIN PASSWORD '$($Secrets.appDbPassword)'" -SuperPass $Secrets.pgSuperPassword
        Write-Ok "Rol olusturuldu: $DbUser"
    }
    $dbExists = Invoke-Psql -Sql "SELECT 1 FROM pg_database WHERE datname='$DbName'" -SuperPass $Secrets.pgSuperPassword
    if (-not $dbExists) {
        Invoke-Psql -Sql "CREATE DATABASE ""$DbName"" OWNER $DbUser ENCODING 'UTF8'" -SuperPass $Secrets.pgSuperPassword
        Write-Ok "Veritabani olusturuldu: $DbName"
    }
    # CLAUDE.md operasyonel notu: per-DB statement_timeout
    Invoke-Psql -Sql "ALTER DATABASE ""$DbName"" SET statement_timeout = '30s'" -SuperPass $Secrets.pgSuperPassword
}

# -----------------------------------------------------------------------------
# .env yaz (admin kolayligi) + ortam degiskenlerini hazirla
# -----------------------------------------------------------------------------
function Write-EnvFile {
    param($Secrets)
    $dbUrl = Get-DbUrl -Secrets $Secrets
    $content = @"
PORT=$ApiPort
NODE_ENV=production
TZ=$Tz
DATABASE_URL=$dbUrl
JWT_SECRET=$($Secrets.jwtSecret)
"@
    Set-Content -Path $EnvFile -Value $content -Encoding UTF8
}

# -----------------------------------------------------------------------------
# Prisma migrate + seed  (seed yalniz ilk kurulumda)
# -----------------------------------------------------------------------------
function Invoke-MigrateAndSeed {
    param($Secrets)
    $dbUrl = Get-DbUrl -Secrets $Secrets
    $env:DATABASE_URL = $dbUrl
    $env:NODE_ENV = "production"
    $env:TZ = $Tz

    Push-Location $AppDir
    try {
        $prismaCli = Join-Path $AppDir "node_modules\prisma\build\index.js"

        Write-Step "Veritabani migration'lari uygulaniyor (migrate deploy)..."
        & $NodeExe $prismaCli migrate deploy
        if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy basarisiz (kod $LASTEXITCODE)." }
        Write-Ok "Migration'lar guncel."

        if (-not (Test-Path $SeededFlag)) {
            Write-Step "Ilk kurulum: seed calistiriliyor (admin/admin123, yetkiler, kalite siniflari)..."
            & $NodeExe (Join-Path $AppDir "dist\prisma\seed.js")
            if ($LASTEXITCODE -ne 0) {
                Write-Warn2 "Seed basarisiz oldu. Sunucu yine de acilacak. Elle: manage.ps1 ile tekrar deneyin."
            } else {
                New-Item -ItemType File -Path $SeededFlag -Force | Out-Null
                Write-Ok "Seed tamamlandi."
            }
        } else {
            Write-Step "Seed daha once calistirilmis — atlaniyor (veriler korunuyor)."
        }
    } finally {
        Pop-Location
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
}

# -----------------------------------------------------------------------------
# Backend servisi (NSSM ile node.exe)
# -----------------------------------------------------------------------------
function Install-BackendService {
    param($Secrets)
    $dbUrl     = Get-DbUrl -Secrets $Secrets
    $serverJs  = Join-Path $AppDir "dist\src\server.js"
    $stdoutLog = Join-Path $LogDir "backend-out.log"
    $stderrLog = Join-Path $LogDir "backend-err.log"

    $svc = Get-Service -Name $BackendServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Step "Backend Windows servisi kaydediliyor ($BackendServiceName)..."
        & $Nssm install $BackendServiceName $NodeExe $serverJs | Out-Null
    } else {
        Write-Step "Backend servisi guncelleniyor..."
        & $Nssm set $BackendServiceName Application $NodeExe | Out-Null
        & $Nssm set $BackendServiceName AppParameters $serverJs | Out-Null
    }

    & $Nssm set $BackendServiceName AppDirectory $AppDir | Out-Null
    & $Nssm set $BackendServiceName DisplayName "TeksERP Backend (API :$ApiPort)" | Out-Null
    & $Nssm set $BackendServiceName Description "TeksERP Express API sunucusu" | Out-Null
    & $Nssm set $BackendServiceName Start SERVICE_AUTO_START | Out-Null
    & $Nssm set $BackendServiceName AppStdout $stdoutLog | Out-Null
    & $Nssm set $BackendServiceName AppStderr $stderrLog | Out-Null
    & $Nssm set $BackendServiceName AppRotateFiles 1 | Out-Null
    & $Nssm set $BackendServiceName AppRotateBytes 10485760 | Out-Null
    # DB hazir olsun diye DB servisine bagimlilik
    & $Nssm set $BackendServiceName DependOnService $DbServiceName | Out-Null
    # Ortam degiskenleri (NSSM = yetkili kaynak; .env de yedek olarak yazildi)
    & $Nssm set $BackendServiceName AppEnvironmentExtra `
        "NODE_ENV=production" "TZ=$Tz" "PORT=$ApiPort" "DATABASE_URL=$dbUrl" "JWT_SECRET=$($Secrets.jwtSecret)" | Out-Null

    Write-Step "Backend servisi (yeniden) baslatiliyor..."
    & $Nssm restart $BackendServiceName *> $null
    if ($LASTEXITCODE -ne 0) { Start-Service -Name $BackendServiceName -ErrorAction SilentlyContinue }
    Write-Ok "Backend servisi ayarlandi."
}

function Open-Firewall {
    Write-Step "Guvenlik duvarinda $ApiPort portu aciliyor (fabrika agi erisimi)..."
    $ruleName = "TeksERP API $ApiPort"
    & netsh advfirewall firewall delete rule name="$ruleName" *> $null
    & netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=$ApiPort *> $null
    Write-Ok "Firewall kurali eklendi (TCP $ApiPort)."
}

function Test-Health {
    Write-Step "Backend saglik kontrolu (http://localhost:$ApiPort/health)..."
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:$ApiPort/health" -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) { Write-Ok "Backend YANIT VERIYOR."; return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    Write-Warn2 "Backend henuz yanit vermiyor. Log: $LogDir\backend-err.log"
    return $false
}

function Get-LanIp {
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike "169.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
            Select-Object -First 1).IPAddress
        if ($ip) { return $ip }
    } catch { }
    return "<sunucu-ip-adresi>"
}

# -----------------------------------------------------------------------------
# Aksiyonlar
# -----------------------------------------------------------------------------
function Do-Install {
    Assert-Admin
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor White
    Write-Host "  TeksERP — Kurulum / Guncelleme" -ForegroundColor White
    Write-Host "================================================================" -ForegroundColor White

    $secrets = Get-OrCreateSecrets
    Install-Database -Secrets $secrets
    Write-EnvFile -Secrets $secrets
    Invoke-MigrateAndSeed -Secrets $secrets
    Install-BackendService -Secrets $secrets
    Open-Firewall
    $healthy = Test-Health
    $ip = Get-LanIp

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor White
    if ($healthy) {
        Write-Host "  TeksERP backend HAZIR" -ForegroundColor Green
    } else {
        Write-Host "  Kurulum bitti ama backend henuz yanit vermiyor — loglara bakin." -ForegroundColor Yellow
    }
    Write-Host "================================================================" -ForegroundColor White
    Write-Host ""
    Write-Host "  Bu sunucuda:     http://localhost:$ApiPort"
    Write-Host "  Fabrika aginda:  http://$ip`:$ApiPort"
    Write-Host "  Swagger:         http://$ip`:$ApiPort/api-docs"
    Write-Host ""
    Write-Host "  Test girisi:     admin / admin123"
    Write-Host ""
    Write-Host "  Servisler:       $DbServiceName , $BackendServiceName  (otomatik baslar)"
    Write-Host "  Veri klasoru:    $DataRoot   (yedek/guncelleme bunu korur)"
    Write-Host "  Loglar:          $LogDir"
    Write-Host ""
}

function Do-Uninstall {
    Assert-Admin
    Write-Step "Backend servisi durduruluyor/kaldiriliyor..."
    & $Nssm stop $BackendServiceName *> $null
    & $Nssm remove $BackendServiceName confirm *> $null

    Write-Step "PostgreSQL servisi durduruluyor/kaldiriliyor..."
    Stop-Service -Name $DbServiceName -Force -ErrorAction SilentlyContinue
    & (Join-Path $PgBin "pg_ctl.exe") unregister -N $DbServiceName *> $null
    & sc.exe delete $DbServiceName *> $null

    Write-Step "Guvenlik duvari kurali kaldiriliyor..."
    & netsh advfirewall firewall delete rule name="TeksERP API $ApiPort" *> $null

    if ($RemoveData) {
        Write-Warn2 "RemoveData secildi — TUM veritabani ve sirlar siliniyor!"
        if (Test-Path $DataRoot) { Remove-Item -Path $DataRoot -Recurse -Force -ErrorAction SilentlyContinue }
        Write-Ok "Veri klasoru silindi: $DataRoot"
    } else {
        Write-Ok "Servisler kaldirildi. Veri KORUNDU: $DataRoot"
        Write-Host "  (Veriyi de silmek icin: manage.ps1 -Action uninstall -RemoveData)"
    }
}

function Do-Start    { Start-Service $DbServiceName; & $Nssm start $BackendServiceName *> $null; Write-Ok "Servisler baslatildi." }
function Do-Stop     { & $Nssm stop $BackendServiceName *> $null; Stop-Service $DbServiceName -Force -ErrorAction SilentlyContinue; Write-Ok "Servisler durduruldu." }
function Do-Restart  { Do-Stop; Start-Sleep 2; Do-Start }

function Do-Status {
    Write-Host ""
    foreach ($s in @($DbServiceName, $BackendServiceName)) {
        $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
        if ($svc) {
            $color = if ($svc.Status -eq "Running") { "Green" } else { "Yellow" }
            Write-Host ("  {0,-18} {1}" -f $s, $svc.Status) -ForegroundColor $color
        } else {
            Write-Host ("  {0,-18} KAYITLI DEGIL" -f $s) -ForegroundColor Red
        }
    }
    Write-Host ""
    Test-Health | Out-Null
}

function Do-Backup {
    Assert-Admin
    if (-not (Test-Path $SecretFile)) { throw "Sir dosyasi yok — kurulum yapilmamis." }
    $secrets = Get-Content $SecretFile -Raw | ConvertFrom-Json
    if (-not $BackupPath) { $BackupPath = Join-Path $DataRoot "backups" }
    if (-not (Test-Path $BackupPath)) { New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null }
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $out = Join-Path $BackupPath "tekserp_$stamp.dump"
    Write-Step "Yedek aliniyor -> $out"
    $env:PGPASSWORD = $secrets.pgSuperPassword
    & (Join-Path $PgBin "pg_dump.exe") -h 127.0.0.1 -p $PgPort -U $PgSuper -d $DbName -Fc -f $out
    $code = $LASTEXITCODE
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ($code -ne 0) { throw "pg_dump basarisiz (kod $code)." }
    Write-Ok "Yedek alindi: $out"
}

function Do-Restore {
    Assert-Admin
    if (-not $BackupFile -or -not (Test-Path $BackupFile)) { throw "-BackupFile gecerli bir .dump dosyasi olmali." }
    if (-not (Test-Path $SecretFile)) { throw "Sir dosyasi yok — kurulum yapilmamis." }
    $secrets = Get-Content $SecretFile -Raw | ConvertFrom-Json
    Write-Warn2 "GERI YUKLEME mevcut verinin UZERINE yazar. Backend durduruluyor..."
    & $Nssm stop $BackendServiceName *> $null
    $env:PGPASSWORD = $secrets.pgSuperPassword
    & (Join-Path $PgBin "pg_restore.exe") -h 127.0.0.1 -p $PgPort -U $PgSuper -d $DbName --clean --if-exists $BackupFile
    $code = $LASTEXITCODE
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    & $Nssm start $BackendServiceName *> $null
    if ($code -ne 0) { Write-Warn2 "pg_restore uyari/hata kodu $code dondu (bazi 'clean' hatalari normaldir)." }
    Write-Ok "Geri yukleme tamamlandi, backend baslatildi."
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------
try {
    switch ($Action) {
        "install"   { Do-Install }
        "uninstall" { Do-Uninstall }
        "start"     { Assert-Admin; Do-Start }
        "stop"      { Assert-Admin; Do-Stop }
        "restart"   { Assert-Admin; Do-Restart }
        "status"    { Do-Status }
        "backup"    { Do-Backup }
        "restore"   { Do-Restore }
    }
    exit 0
} catch {
    Write-ErrX $_.Exception.Message
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    exit 1
}
