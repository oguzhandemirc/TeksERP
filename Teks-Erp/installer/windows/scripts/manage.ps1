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
#   .\manage.ps1 -Action backup [-BackupPath C:\yedek] [-OffsitePath \\NAS\yedek]
#   .\manage.ps1 -Action restore -BackupFile C:\yedek\tekserp_xxx.dump
#
# Windows PowerShell 5.1 ile uyumludur (Windows Server varsayılanı). PS7 de çalışır.
# =============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("install", "uninstall", "start", "stop", "restart", "status", "backup", "restore", "studio")]
    [string]$Action,

    # setup.exe kurulum dizinini geçer; elle çalıştırırken script kendi konumundan bulur.
    [string]$InstallDir,
    [switch]$RemoveData,
    [string]$BackupPath,
    [string]$BackupFile,
    # Offsite (makine disi) yedek hedefi: UNC (\\NAS\pay) veya harici surucu (E:\yedek).
    # Verilirse backup-offsite.txt'e kalici yazilir -> sonraki gece yedekleri de kullanir.
    [string]$OffsitePath
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
$BackupDir  = Join-Path $DataRoot "backups"
$SecretFile = Join-Path $DataRoot "secret.json"
$SeededFlag = Join-Path $DataRoot ".seeded"
$VersionFile= Join-Path $DataRoot "version.txt"   # kurulu sürüm (güncelleme karşılaştırması)
$EnvFile    = Join-Path $AppDir ".env"   # backend CWD'sinde dursun (dotenv)
# Offsite yedek hedefi burada kalici tutulur (bir kez -OffsitePath ile yazilir,
# sonra gece gorevi param'siz calissa da bu dosyadan okur). Bos/yoksa offsite atlanir.
$OffsiteConfigFile = Join-Path $DataRoot "backup-offsite.txt"

$BackupTaskName = "TeksERP Gece Yedek"   # Görev Zamanlayıcı'daki otomatik yedek görevi

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
# Sürüm yardımcıları
# -----------------------------------------------------------------------------
# Kurulan kodun sürümü (Inno yeni dosyalari KOPYALADIKTAN sonra calistigi icin
# bu, GUNCELLENECEK -yeni- surumu verir). $VersionFile ise ONCEKI kurulu surumu
# tutar -> ikisini karsilastirip yukseltme/ayni/dusurme tespiti yapilir.
function Get-AppVersion {
    $pkg = Join-Path $AppDir "package.json"
    if (Test-Path $pkg) {
        try { return (Get-Content $pkg -Raw | ConvertFrom-Json).version } catch { }
    }
    return "0.0.0"
}

function Get-InstalledVersion {
    if (Test-Path $VersionFile) { return (Get-Content $VersionFile -Raw).Trim() }
    return $null
}

# -----------------------------------------------------------------------------
# Kurulum öncesi ön-kontroller (port çakışması + disk alanı)
# -----------------------------------------------------------------------------
# Bizim kendi servislerimiz (postgres/node) portu tutuyorsa sorun degil; YABANCI
# bir surec tutuyorsa operatore acik uyari verilir (backend bind edemeyip crash
# loop'a girerse sebebi anlasilsin).
function Test-PortConflict {
    param([int]$Port, [string[]]$AllowProcess = @())
    try {
        $conns = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
    } catch {
        return $false   # cmdlet yok (cok eski OS) ya da port bos -> kontrolu atla
    }
    foreach ($c in $conns) {
        $proc  = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        $pname = if ($proc) { $proc.ProcessName } else { "bilinmeyen" }
        if ($AllowProcess -contains $pname) { continue }   # bizim servisimiz
        Write-Warn2 "Port $Port baska bir uygulama tarafindan kullaniliyor: '$pname' (PID $($c.OwningProcess))."
        return $true
    }
    return $false
}

function Test-Preflight {
    Write-Step "Kurulum on-kontrolleri..."

    # 1) Disk alani (sistem surucusu: hem Program Files hem ProgramData burada).
    $sysDrive = $env:SystemDrive.TrimEnd(':')   # "C:" -> "C"
    try {
        $free = (Get-PSDrive -Name $sysDrive -ErrorAction Stop).Free
        $freeGb = [math]::Round($free / 1GB, 1)
        if ($free -lt 2GB) {
            Write-Warn2 "Sistem surucusunde dusuk disk alani: $freeGb GB bos. Kurulum + DB icin >=2 GB onerilir."
        } else {
            Write-Ok "Disk alani yeterli ($freeGb GB bos)."
        }
    } catch {
        Write-Warn2 "Disk alani okunamadi (atlaniyor)."
    }

    # 2) Port cakismasi. Kendi servislerimiz haric.
    $apiBusy = Test-PortConflict -Port $ApiPort -AllowProcess @("node")
    $dbBusy  = Test-PortConflict -Port $PgPort  -AllowProcess @("postgres")
    if ($apiBusy) {
        Write-Warn2 "API portu ($ApiPort) dolu. Backend baslayamayabilir. Cozum: cakisan uygulamayi kapatin"
        Write-Warn2 "  veya manage.ps1 basindaki `$ApiPort degerini degistirip yeniden kurun."
    }
    if ($dbBusy) {
        Write-Warn2 "DB portu ($PgPort) dolu. Cozum: manage.ps1 basindaki `$PgPort degerini degistirip yeniden kurun."
    }
    if (-not $apiBusy -and -not $dbBusy) { Write-Ok "Portlar uygun ($ApiPort, $PgPort)." }
}

# -----------------------------------------------------------------------------
# Migration öncesi otomatik yedek (yalnızca GÜNCELLEME'de)
# -----------------------------------------------------------------------------
# Ilk kurulumda DB bostur -> yedek anlamsiz. Guncellemede `migrate deploy`
# calismadan ONCE mevcut veriyi `premigrate_<eskiSurum>_<zaman>.dump` olarak
# yedekler. Boyle bir migration beklenmedik sekilde patlarsa geri donus noktasi olur.
function Invoke-PreMigrationBackup {
    param($Secrets, [string]$FromVersion)
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
    $verTag = if ($FromVersion) { ($FromVersion -replace '[^0-9A-Za-z\.]', '_') } else { "unknown" }
    $stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
    $out    = Join-Path $BackupDir "premigrate_${verTag}_$stamp.dump"
    Write-Step "Guncelleme: migration oncesi otomatik yedek aliniyor -> $out"
    $env:PGPASSWORD = $Secrets.pgSuperPassword
    & (Join-Path $PgBin "pg_dump.exe") -h 127.0.0.1 -p $PgPort -U $PgSuper -d $DbName -Fc -f $out
    $code = $LASTEXITCODE
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ($code -ne 0) {
        # Yedek alinamadi: guncellemeyi BLOKLAMA (ileriye donuk migration'lar
        # genelde guvenli), ama operatore cok acik uyar.
        Write-ErrX "Migration oncesi yedek ALINAMADI (pg_dump kod $code). Yine de devam ediliyor."
        Write-Warn2 "Kritik bir guncellemeden onceyseniz, elle yedek alip dogrulayin: manage.ps1 -Action backup"
        return $null
    }
    Write-Ok "Migration oncesi yedek hazir."
    return $out
}

# -----------------------------------------------------------------------------
# Otomatik gece yedeği (Görev Zamanlayıcı)
# -----------------------------------------------------------------------------
# Her gece 03:00'te SYSTEM hesabiyla `manage.ps1 -Action backup` calistiran bir
# zamanlanmis gorev kurar (idempotent: -Force ile yeniden yazilir). Boylece admin
# elle gorev olusturmak zorunda kalmaz (README-KURULUM.md'deki manuel adim otomatiklesir).
function Register-BackupTask {
    try {
        $manage = Join-Path $InstallDir "scripts\manage.ps1"
        $action = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$manage`" -Action backup"
        $trigger   = New-ScheduledTaskTrigger -Daily -At ([datetime]"03:00")
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
        Register-ScheduledTask -TaskName $BackupTaskName -Action $action -Trigger $trigger `
            -Principal $principal -Settings $settings -Description "TeksERP veritabani gece yedegi" -Force | Out-Null
        Write-Ok "Otomatik gece yedegi kuruldu (her gun 03:00 -> $BackupDir)."
    } catch {
        Write-Warn2 "Otomatik yedek gorevi kurulamadi: $($_.Exception.Message)"
    }
}

function Unregister-BackupTask {
    try {
        if (Get-ScheduledTask -TaskName $BackupTaskName -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $BackupTaskName -Confirm:$false
            Write-Ok "Otomatik yedek gorevi kaldirildi."
        }
    } catch { }
}

# -----------------------------------------------------------------------------
# DB: initdb + servis + rol/veritabani  (idempotent)
# -----------------------------------------------------------------------------
function Install-Database {
    param($Secrets)

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

    # NetworkService veri kokune (DataRoot) girip pgdata'ya ulasabilsin diye traverse izni.
    # secret.json kalitimi kapali oldugundan bu izin onu ACMAZ.
    icacls $DataRoot /grant "${PgAccount}:(RX)" *> $null

    $alreadyInit = Test-Path (Join-Path $PgData "PG_VERSION")

    # MAJOR surum uyusmazligi guard'i: gomulu PostgreSQL binary'sinin major surumu
    # ile mevcut veri dizininin surumu AYNI olmali. PG 18 binary'si bir PG 16 veri
    # dizinini ACAMAZ -> servis sessizce baslamaz ve "60sn icinde hazir olmadi" ile
    # patlar. Onun yerine burada NET hata verip yukseltme yolunu gosteririz.
    if ($alreadyInit) {
        $dataMajor = (Get-Content (Join-Path $PgData "PG_VERSION") -Raw).Trim()
        $binMajor  = $null
        try {
            $vstr = & (Join-Path $PgBin "postgres.exe") --version 2>$null   # "postgres (PostgreSQL) 18.4"
            if ("$vstr" -match '(\d+)\.\d+') { $binMajor = $Matches[1] }
        } catch { }
        if ($binMajor -and ($dataMajor -ne $binMajor)) {
            throw @"
PostgreSQL MAJOR surum uyusmazligi: veri dizini PG $dataMajor, kurulan binary PG $binMajor.
PG $binMajor, PG $dataMajor veri dizinini ACAMAZ -> major yukseltme gerekir:
  1) ONCE eski surumle yedek al (eski setup.exe ile):
       manage.ps1 -Action backup -OffsitePath <guvenli-bir-yer>
  2) Sonra veriyi tasi: pg_upgrade, VEYA temiz kurulumda -Action restore ile .dump'i geri yukle.
Ayrintili adimlar: README-KURULUM.md (Surum yukseltme). Guncelleme burada guvenle durduruldu.
"@
        }
    }

    if (-not $alreadyInit) {
        Write-Step "PostgreSQL veri dizini olusturuluyor (initdb)..."
        New-Item -ItemType Directory -Path $PgData -Force | Out-Null

        # Servis hesabinin (NetworkService) pgdata'ya tam erisimi olmali
        icacls $PgData /grant "${PgAccount}:(OI)(CI)F" /T | Out-Null

        $pwFile = Join-Path $env:TEMP ("teks_pg_pw_" + (New-HexSecret 6) + ".txt")
        Set-Content -Path $pwFile -Value $Secrets.pgSuperPassword -NoNewline -Encoding ASCII
        try {
            & (Join-Path $PgBin "initdb.exe") `
                -D $PgData -U $PgSuper -A scram-sha-256 --pwfile=$pwFile -E UTF8 --locale=C 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "initdb basarisiz (kod $LASTEXITCODE)." }
        } finally {
            Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
        }

        Write-Ok "initdb tamamlandi."
    } else {
        Write-Step "Mevcut veri dizini bulundu (initdb atlaniyor) — guncelleme modu."
        icacls $PgData /grant "${PgAccount}:(OI)(CI)F" /T | Out-Null
    }

    # postgresql.conf TeksERP ayarlarini IDEMPOTENT uygula (marker yoksa ekle).
    # Bu blok hem ilk kurulumda hem guncellemede calisir: initdb yarim kalmissa
    # (or conf elle bozulmussa) ayarlar yine de uygulanir. Bu olmazsa PostgreSQL
    # varsayilan portta (5432) baslar, script 5433'te bekleyip timeout ile patlar.
    $conf = Join-Path $PgData "postgresql.conf"
    $confChanged = $false
    $confText = if (Test-Path $conf) { Get-Content $conf -Raw } else { "" }
    if ($confText -notmatch "TeksERP ayarlari") {
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
        $confChanged = $true
        Write-Ok "postgresql.conf TeksERP ayarlari uygulandi (port $PgPort)."
    }

    # Bellek/performans tuning (AYRI idempotent blok, kendi marker'i ile). Ayri
    # tutulmasinin sebebi: mevcut kurulumlarda "TeksERP ayarlari" bloğu zaten var
    # ama bellek satirlari yok -> ayri marker sayesinde onlar da guncellemede alir.
    # PostgreSQL default'lari (shared_buffers=128MB, work_mem=4MB) yuzbinlerce satirlik
    # uretim DB'sinde rapor aggregate'lerini diske tasirir ve cache isabetini dusurur;
    # 50s statement_timeout ile birlesince yillik raporlar iptal olmaya baslar.
    if ($confText -notmatch "TeksERP bellek ayarlari") {
        $ramBytes = 0
        try { $ramBytes = [int64](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory } catch { }
        $ramMb    = if ($ramBytes -gt 0) { [int][math]::Round($ramBytes / 1MB) } else { 4096 }  # okunamzsa 4GB varsay
        $sharedMb = [int][math]::Max(128, [math]::Min(8192, [math]::Round($ramMb * 0.25)))       # ~%25, 8GB tavan
        $cacheMb  = [int][math]::Max(512, [math]::Round($ramMb * 0.60))                          # ~%60 (planner ipucu)
        $maintMb  = [int][math]::Max(64,  [math]::Min(512, [math]::Round($ramMb * 0.05)))        # REINDEX/CREATE INDEX
        Add-Content -Path $conf -Value @"

# --- TeksERP bellek ayarlari (RAM ~${ramMb}MB'a gore olceklendi) ---
shared_buffers = '${sharedMb}MB'
effective_cache_size = '${cacheMb}MB'
work_mem = '16MB'
maintenance_work_mem = '${maintMb}MB'
"@
        $confChanged = $true
        Write-Ok "postgresql.conf bellek ayarlari uygulandi (shared_buffers=${sharedMb}MB, RAM ${ramMb}MB)."
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

    # Servisi baslat; zaten calisiyor ve conf degistiyse yeni ayarlar (port!) icin
    # YENIDEN baslat -- aksi halde eski portta calismaya devam eder.
    $svc = Get-Service -Name $DbServiceName -ErrorAction SilentlyContinue
    if ($svc.Status -eq "Running") {
        if ($confChanged) {
            Write-Step "Conf degisti -> PostgreSQL yeniden baslatiliyor..."
            Restart-Service -Name $DbServiceName -Force
        }
    } else {
        Write-Step "PostgreSQL servisi baslatiliyor..."
        Start-Service -Name $DbServiceName
    }
    Wait-PgReady -SuperPass $Secrets.pgSuperPassword

    # Rol + veritabani (idempotent)
    Write-Step "Uygulama rolu ve veritabani kontrol ediliyor..."
    $roleExists = Invoke-Psql -Sql "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'" -SuperPass $Secrets.pgSuperPassword
    if (-not $roleExists) {
        # CREATEDB sart: Prisma 7 `migrate deploy` baglandiginda veritabanini
        # olusturmayi dener; bu yetki olmadan "permission denied to create
        # database" ile patlar (DB onceden olusturulmus olsa bile).
        Invoke-Psql -Sql "CREATE ROLE $DbUser LOGIN CREATEDB PASSWORD '$($Secrets.appDbPassword)'" -SuperPass $Secrets.pgSuperPassword
        Write-Ok "Rol olusturuldu: $DbUser"
    } else {
        # Eski kurulumda rol CREATEDB'siz olusturulmus olabilir -> garanti et.
        Invoke-Psql -Sql "ALTER ROLE $DbUser CREATEDB" -SuperPass $Secrets.pgSuperPassword
    }
    $dbExists = Invoke-Psql -Sql "SELECT 1 FROM pg_database WHERE datname='$DbName'" -SuperPass $Secrets.pgSuperPassword
    if (-not $dbExists) {
        Invoke-Psql -Sql "CREATE DATABASE ""$DbName"" OWNER $DbUser ENCODING 'UTF8'" -SuperPass $Secrets.pgSuperPassword
        Write-Ok "Veritabani olusturuldu: $DbName"
    }
    # CLAUDE.md operasyonel notu: per-DB statement_timeout.
    # 50s = postgresql.conf'taki degerle ve dev DB'yle AYNI olmali — per-DB ayar
    # conf'u ezdigi icin buradaki deger gercek efektif degerdir (2026-06-12: 30s
    # yaziyordu, conf 50s'ti — uretim/dev tutarsizligi duzeltildi).
    Invoke-Psql -Sql "ALTER DATABASE ""$DbName"" SET statement_timeout = '50s'" -SuperPass $Secrets.pgSuperPassword
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
            Write-Step "Ilk kurulum: seed calistiriliyor (admin/123123, yetkiler, kalite siniflari)..."
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
    # AppParameters'a GORELI yol ver: mutlak yol "C:\Program Files\..." bosluk
    # icerdiginden NSSM onu tirnaksiz gecince node "C:\Program" modulunu arayip
    # crash eder. AppDirectory zaten $AppDir oldugundan goreli yol bosluksuz cozulur.
    $serverJsRel = "dist\src\server.js"
    $stdoutLog = Join-Path $LogDir "backend-out.log"
    $stderrLog = Join-Path $LogDir "backend-err.log"

    $svc = Get-Service -Name $BackendServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Step "Backend Windows servisi kaydediliyor ($BackendServiceName)..."
        & $Nssm install $BackendServiceName $NodeExe $serverJsRel | Out-Null
    } else {
        Write-Step "Backend servisi guncelleniyor..."
        & $Nssm set $BackendServiceName Application $NodeExe | Out-Null
        & $Nssm set $BackendServiceName AppParameters $serverJsRel | Out-Null
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
    # BACKUP_DIR: durum sayfasi son yedek zamanini bu klasorden okur.
    & $Nssm set $BackendServiceName AppEnvironmentExtra `
        "NODE_ENV=production" "TZ=$Tz" "PORT=$ApiPort" "DATABASE_URL=$dbUrl" "JWT_SECRET=$($Secrets.jwtSecret)" "BACKUP_DIR=$BackupDir" | Out-Null

    # Backend'i baslat. `nssm restart` YENI kurulan (hic baslamamis) serviste
    # "service has not been started" ile patlar; bu yuzden once (calisiyorsa)
    # durdur, sonra Start-Service ile baslat. Start-Service NSSM servisinde de
    # calisir ve DependOnService (TeksErpDB) bagimliligina uyar.
    Write-Step "Backend servisi baslatiliyor..."
    # Mevcut servisi (Running / Paused / throttled olabilir) kosulsuz durdur ki
    # eski crash-loop throttle durumu temizlensin; sonra baslat.
    Stop-Service -Name $BackendServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-Service -Name $BackendServiceName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
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

# Gercek fiziksel/LAN adaptorlerini sanal olanlardan (VirtualBox, Hyper-V, VMware,
# WSL, vEthernet, loopback) ayiklayan filtre. Cok adaptorlu sunucuda dogru kart
# secilsin diye kullanilir.
function Get-LanIpCandidates {
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notlike "169.*" -and
                $_.IPAddress -ne "127.0.0.1" -and
                $_.PrefixOrigin -ne "WellKnown" -and
                $_.InterfaceAlias -notmatch "vEthernet|VirtualBox|VMware|Hyper-V|Loopback|WSL|Default Switch|Bluetooth"
            } | Select-Object -ExpandProperty IPAddress -Unique
    } catch { @() }
}

# Birincil LAN IP'si: ONCE default gateway'i olan (internete/aga cikan) arayuzun
# IPv4'unu sec -- bu, sanal host-only adaptorleri (orn. 192.168.56.x) eler. Gateway
# yoksa (izole fabrika agi) sanal-olmayan ilk gercek IPv4'e duser.
function Get-LanIp {
    # 1) Default gateway'li arayuz (en dusuk route metric)
    try {
        $cfg = Get-NetIPConfiguration -ErrorAction Stop |
            Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" -and $_.IPv4Address } |
            Sort-Object -Property @{ Expression = { ($_.IPv4DefaultGateway | Select-Object -First 1).RouteMetric } } |
            Select-Object -First 1
        if ($cfg) {
            $ip = ($cfg.IPv4Address | Select-Object -First 1).IPAddress
            if ($ip) { return $ip }
        }
    } catch { }
    # 2) Gateway yok -> sanal-olmayan ilk gercek IPv4
    $cand = @(Get-LanIpCandidates)
    if ($cand.Count -gt 0) { return $cand[0] }
    # 3) Hicbiri yoksa: filtresiz ilk IPv4
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike "169.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
            Select-Object -First 1).IPAddress
        if ($ip) { return $ip }
    } catch { }
    return "<sunucu-ip-adresi>"
}

# -----------------------------------------------------------------------------
# Eski/artik kurulum temizligi
# -----------------------------------------------------------------------------
# Onceki bir surum FARKLI bir dizine (orn. C:\Users\Public\TeksERP) ve kullanici
# Startup klasorune kisayol birakmis olabilir. O kurulum kaldirilmadan yenisi
# yapilinca acilista IKI tepsi ikonu birden basliyordu. Bu fonksiyon su anki
# kurulum disindaki tum TeksERP tepsi artiklarini temizler (idempotent).
function Remove-LegacyTray {
    # 1) Su anki kurulum disindaki konumdan calisan tepsi panellerini durdur.
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "powershell.exe" -and $_.CommandLine -like "*tray.ps1*" -and
                       $_.CommandLine -notlike "*$InstallDir*" } |
        ForEach-Object {
            Write-Step "Eski tepsi paneli kapatiliyor (PID $($_.ProcessId))..."
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }

    # 2) Tum kullanici profillerindeki kisisel Startup kisayolunu sil (yeni surum
    #    yalniz Common Startup kullanir; kisisel olan eski surumden kalmadir).
    $userStartups = @(Get-ChildItem "C:\Users\*\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\TeksERP*.lnk" -ErrorAction SilentlyContinue)
    foreach ($lnk in $userStartups) {
        Write-Step "Eski kisisel acilis kisayolu kaldiriliyor: $($lnk.FullName)"
        Remove-Item $lnk.FullName -Force -ErrorAction SilentlyContinue
    }

    # 3) Eski kurulum dizinini (su anki degilse) tamamen kaldir.
    foreach ($legacy in @("C:\Users\Public\TeksERP")) {
        if ((Test-Path $legacy) -and ($legacy.TrimEnd('\') -ne $InstallDir.TrimEnd('\'))) {
            Write-Step "Eski kurulum dizini siliniyor: $legacy"
            Remove-Item $legacy -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# -----------------------------------------------------------------------------
# Aksiyonlar
# -----------------------------------------------------------------------------
function Do-Install {
    Assert-Admin
    Remove-LegacyTray

    # Sürüm tespiti: $VersionFile = ONCEKI kurulu surum, Get-AppVersion = simdi
    # kopyalanan -yeni- surum. Ilk kurulumda onceki yoktur.
    $prevVersion = Get-InstalledVersion
    $newVersion  = Get-AppVersion
    $isUpdate    = (Test-Path $SeededFlag) -or ($null -ne $prevVersion)

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor White
    if ($isUpdate) {
        Write-Host "  TeksERP — Guncelleme" -ForegroundColor White
        if ($prevVersion) {
            if ($prevVersion -eq $newVersion) {
                Write-Host "  Sürüm: $newVersion (yeniden kurulum)" -ForegroundColor Gray
            } else {
                $direction = try { if ([version]$newVersion -lt [version]$prevVersion) { "GERI ALMA" } else { "yukseltme" } } catch { "degisim" }
                Write-Host "  Sürüm: $prevVersion -> $newVersion ($direction)" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "  TeksERP — Ilk Kurulum (sürüm $newVersion)" -ForegroundColor White
    }
    Write-Host "================================================================" -ForegroundColor White

    Test-Preflight

    $secrets = Get-OrCreateSecrets
    Install-Database -Secrets $secrets
    Write-EnvFile -Secrets $secrets
    # Guncellemede: migration'lar calismadan ONCE mevcut veriyi yedekle (geri donus noktasi).
    if ($isUpdate) { Invoke-PreMigrationBackup -Secrets $secrets -FromVersion $prevVersion | Out-Null }
    Invoke-MigrateAndSeed -Secrets $secrets
    Install-BackendService -Secrets $secrets
    Open-Firewall
    Register-BackupTask

    # Bu sürümü kurulu sürüm olarak kaydet (bir sonraki guncellemede karsilastirilir).
    Set-Content -Path $VersionFile -Value $newVersion -Encoding UTF8 -NoNewline

    $healthy = Test-Health
    $ip = Get-LanIp
    $altIps = @(Get-LanIpCandidates | Where-Object { $_ -ne $ip })

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
    Write-Host "  Fabrika aginda:  http://$ip`:$ApiPort" -ForegroundColor Green
    Write-Host "  Swagger:         http://$ip`:$ApiPort/api-docs"
    if ($altIps.Count -gt 0) {
        Write-Host ""
        Write-Host "  Bu sunucuda birden fazla ag adresi var. Yukaridaki calismazsa" -ForegroundColor Yellow
        Write-Host "  asagidakilerden fabrika agindakini deneyin:" -ForegroundColor Yellow
        foreach ($a in $altIps) { Write-Host "      http://$a`:$ApiPort" }
    }
    Write-Host ""
    Write-Host "  Test girisi:     admin / 123123"
    Write-Host ""
    Write-Host "  Servisler:       $DbServiceName , $BackendServiceName  (otomatik baslar)"
    Write-Host "  Veri klasoru:    $DataRoot   (yedek/guncelleme bunu korur)"
    Write-Host "  Loglar:          $LogDir"
    Write-Host "  Yedekler:        $BackupDir"
    Write-Host "  Otomatik yedek:  her gun 03:00 (Gorev Zamanlayici: '$BackupTaskName')"
    $offsiteVal = if (Test-Path $OffsiteConfigFile) { (Get-Content $OffsiteConfigFile -Raw).Trim() } else { "" }
    if ($offsiteVal) {
        Write-Host "  Offsite kopya:   $offsiteVal" -ForegroundColor Green
    } else {
        Write-Host "  Offsite kopya:   AYARLANMADI — makine disi yedek icin: manage.ps1 -Action backup -OffsitePath \\NAS\pay" -ForegroundColor Yellow
    }
    Write-Host ""
}

function Do-Uninstall {
    Assert-Admin
    Write-Step "Otomatik yedek gorevi kaldiriliyor..."
    Unregister-BackupTask

    Write-Step "Tepsi durum paneli kapatiliyor (calisiyorsa)..."
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "powershell.exe" -and $_.CommandLine -like "*tray.ps1*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

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
    if (-not $BackupPath) { $BackupPath = $BackupDir }
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

    # O-17: Butunluk kontrolu — dump gercekten okunabiliyor mu? pg_dump exit code 0
    # dondugu halde dosya yarim/bozuk olabilir (disk dolmasi, sessiz kesinti). Bozuk
    # bir dump 14'luk rotasyonla SAGLAM yedeklerin yerini alirsa felakete kadar fark
    # edilmez -> once dogrula, bozuksa SIL (retention'a inmez, eski yedekler korunur).
    Write-Step "Yedek butunlugu kontrol ediliyor (pg_restore --list)..."
    & (Join-Path $PgBin "pg_restore.exe") --list $out *> $null
    if ($LASTEXITCODE -ne 0) {
        Remove-Item $out -Force -ErrorAction SilentlyContinue
        throw "Yedek DOGRULANAMADI (pg_restore --list kod $LASTEXITCODE) — bozuk dump silindi, onceki yedekler korundu."
    }
    Write-Ok "Yedek butunlugu dogrulandi."

    # O-17: secret.json'i yedegin YANINA kopyala. Geri yukleme icin ikisi de gerekir
    # (DEPLOY-RUNBOOK: 'Yedegi + secret.json'i birlikte sakla') ve offsite kopya da
    # onu tasisin. Kisitli ACL korunur (yalniz SYSTEM + Administrators).
    $secretCopy = Join-Path $BackupPath "secret.json"
    Copy-Item $SecretFile $secretCopy -Force -ErrorAction SilentlyContinue
    if (Test-Path $secretCopy) {
        icacls $secretCopy /inheritance:r /grant "SYSTEM:(F)" "Administrators:(F)" *> $null
    }

    # Saklama (retention): zamanli gunluk yedek (tekserp_*) dosyalarindan en yeni
    # 14'u tutulur, eskiler silinir -> disk dolmaz. Migration oncesi yedekler
    # (premigrate_*) ve elle baska klasore alinanlar bu temizlige DAHIL DEGIL.
    $keep = 14
    $old = @(Get-ChildItem -Path $BackupPath -Filter "tekserp_*.dump" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip $keep)
    foreach ($f in $old) {
        Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
        Write-Step "Eski yedek silindi (saklama: $keep): $($f.Name)"
    }

    # Y-4: Offsite (makine disi) kopya. Tek disk arizasi / ransomware / yangin hem DB'yi
    # hem yedekleri ayni anda yok etmesin diye ikinci bir ortama (NAS/UNC/harici disk)
    # kopyalar. Hedef: -OffsitePath param'i veya backup-offsite.txt (gece gorevi param'siz
    # calistigi icin kalici config dosyasi sart). Ayarli degilse ACIK uyari verir.
    if ($OffsitePath) {
        # Elle -OffsitePath verildi: sonraki (param'siz) gece yedekleri de kullansin.
        Set-Content -Path $OffsiteConfigFile -Value $OffsitePath.Trim() -Encoding UTF8 -NoNewline
    }
    $offsite = if (Test-Path $OffsiteConfigFile) { (Get-Content $OffsiteConfigFile -Raw).Trim() } else { $null }
    if ($offsite) {
        Write-Step "Offsite kopya -> $offsite"
        if (-not (Test-Path $offsite)) {
            New-Item -ItemType Directory -Path $offsite -Force -ErrorAction SilentlyContinue | Out-Null
        }
        if (Test-Path $offsite) {
            # robocopy yalniz yedek dosyalari + secret.json'i tasir; sadece yeni/degisen
            # dosyayi kopyalar (mevcutlari atlar). /MIR YOK -> offsite'ta gecmis birikir
            # (guvenli taraf); offsite saklama operatore birakilir.
            & robocopy $BackupPath $offsite "tekserp_*.dump" "secret.json" /R:2 /W:5 /NFL /NDL /NJH /NJS /NP *> $null
            $rc = $LASTEXITCODE   # robocopy: 0-7 basari, 8+ hata
            if ($rc -ge 8) {
                Write-Warn2 "Offsite kopya BASARISIZ (robocopy kod $rc) — hedefe erisilemiyor olabilir: $offsite"
            } else {
                Write-Ok "Offsite kopya tamam -> $offsite"
            }
        } else {
            Write-Warn2 "Offsite hedefi olusturulamadi/erisilemiyor: $offsite"
        }
    } else {
        Write-Warn2 "OFFSITE YEDEK AYARLANMADI — tum yedekler DB ile ayni diskte (felaket riski)."
        Write-Warn2 "  Ikinci kopya icin sunlardan birini yapin:"
        Write-Warn2 "    * '$OffsiteConfigFile' dosyasina hedef yol yazin (or. \\NAS\teksyedek veya E:\yedek)"
        Write-Warn2 "    * veya bir kez:  manage.ps1 -Action backup -OffsitePath \\NAS\teksyedek"
    }
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
# Prisma Studio (veritabani GUI) — SADECE bu sunucuda, localhost'ta acilir.
# secret.json'dan gizli sifreyi okur (admin yetkisi gerekir), gomulu node.exe ile
# urun node_modules'undaki prisma CLI'yi calistirir. Default hostname 127.0.0.1
# oldugundan fabrika agina ACILMAZ — DB'ye tam erisim verir, sadece sunucu basinda.
# -----------------------------------------------------------------------------
function Do-Studio {
    Assert-Admin
    if (-not (Test-Path $SecretFile)) { throw "Sir dosyasi yok — once kurulum yapin." }
    $secrets = Get-Content $SecretFile -Raw | ConvertFrom-Json
    $prismaCli = Join-Path $AppDir "node_modules\prisma\build\index.js"
    if (-not (Test-Path $prismaCli)) { throw "Prisma CLI bulunamadi: $prismaCli" }

    $env:DATABASE_URL = Get-DbUrl -Secrets $secrets
    $env:NODE_ENV = "production"
    $env:TZ = $Tz

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor White
    Write-Host "  Prisma Studio baslatiliyor (veritabani arayuzu)" -ForegroundColor White
    Write-Host "================================================================" -ForegroundColor White
    Write-Host "  Tarayicida acilacak:  http://localhost:5555" -ForegroundColor Green
    Write-Host "  Sadece bu sunucuda erisilebilir (fabrika agina kapali)." -ForegroundColor Yellow
    Write-Host "  Kapatmak icin bu pencerede Ctrl+C." -ForegroundColor DarkGray
    Write-Host ""
    Push-Location $AppDir
    try {
        & $NodeExe $prismaCli studio --port 5555
    } finally {
        Pop-Location
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
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
        "studio"    { Do-Studio }
    }
    exit 0
} catch {
    Write-ErrX $_.Exception.Message
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    exit 1
}
