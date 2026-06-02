# =============================================================================
# TeksERP - Sistem Tepsisi Durum Paneli (tray.ps1)
# =============================================================================
# Windows saatinin yanindaki tepside TeksERP logosunu, kosesinde renkli bir durum
# rozetiyle gosterir:
#   YESIL  = DB + Backend + API hepsi calisiyor
#   SARI   = kismi (biri calisiyor / API henuz yanit vermiyor / DB bagli degil)
#   KIRMIZI= durdu
# Sag tik: durum + adres + durum sayfasi + Prisma Studio + adres kopyala +
#          yeniden baslat + kaldir + cikis.
# Cift tik: markali DURUM SAYFASINI acar (Swagger degil) -> http://<ip>:4000/
# =============================================================================
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Tek-ornek korumasi: ayni oturumda ikinci kez baslarsa hemen cik (cift ikon olmasin).
$createdNew = $false
$script:mutex = New-Object System.Threading.Mutex($true, "TeksERPTrayPanel", [ref]$createdNew)
if (-not $createdNew) { exit }

$ApiPort   = 4000
$DbSvc     = "TeksErpDB"
$BeSvc     = "TeksErpBackend"
$AppRoot   = Split-Path -Parent $PSScriptRoot
$ManagePs1 = Join-Path $AppRoot "scripts\manage.ps1"
if (-not (Test-Path $ManagePs1)) { $ManagePs1 = "C:\Program Files\TeksERP\scripts\manage.ps1" }
$LogoIco   = Join-Path $AppRoot "branding\TeksERP.ico"
$LogDir    = "C:\ProgramData\TeksERP\logs"

# manage.ps1'i yonetici (UAC) yukseltmesiyle, konsol acik birakacak sekilde calistirir.
# Tray normal kullanici baglaminda calisir; servis islemleri admin gerektirir.
function Invoke-ManageAdmin($ActionName) {
    if (Test-Path $ManagePs1) {
        Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File',"`"$ManagePs1`"",'-Action',$ActionName
    }
}

function Get-PrimaryIp {
    # .NET NetworkInformation kullanir: Get-NetIPConfiguration (WMI) bu sorguyu
    # ~5sn surdurup tepsi panelini UI thread'inde kilitliyordu -> tooltip "kontrol
    # ediliyor"da donuyordu. .NET API milisaniyede doner ve bloklamaz.
    try {
        $nics = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
            Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' }
        # 1. tur: default gateway'i olan (gercek aga cikan) arayuz; 2. tur: gerisi.
        # Boylece sanal host-only adaptorler (orn. 192.168.56.x) sona kalir.
        foreach ($wantGw in @($true, $false)) {
            foreach ($nic in $nics) {
                $props = $nic.GetIPProperties()
                $hasGw = @($props.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' }).Count -gt 0
                if ($wantGw -ne $hasGw) { continue }
                foreach ($ua in $props.UnicastAddresses) {
                    if ($ua.Address.AddressFamily -eq 'InterNetwork') {
                        $cand = $ua.Address.IPAddressToString
                        if ($cand -ne "127.0.0.1" -and $cand -notlike "169.*") { return $cand }
                    }
                }
            }
        }
    } catch {}
    return "localhost"
}

# Logo'yu bir kez bitmap olarak yukle (rozet bindirmeleri bunun uzerine cizilir).
$script:logoBmp = $null
if (Test-Path $LogoIco) {
    try {
        $ic = New-Object System.Drawing.Icon($LogoIco, 64, 64)
        $script:logoBmp = $ic.ToBitmap()
        $ic.Dispose()
    } catch { $script:logoBmp = $null }
}

# Logo + sag-alt renkli durum rozeti -> 32x32 tepsi ikonu.
function New-StatusIcon($colorName) {
    $size = 32
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)
    if ($script:logoBmp) {
        $g.DrawImage($script:logoBmp, 0, 0, $size, $size)
    } else {
        # Logo bulunamazsa: mavi daire (eski davranisa yakin yedek).
        $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::SteelBlue)
        $g.FillEllipse($b, 2, 2, $size - 4, $size - 4); $b.Dispose()
    }
    # Durum rozeti: beyaz halka + renkli ic daire (sag-alt kose).
    $d = 13
    $x = $size - $d - 1; $y = $size - $d - 1
    $halo = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillEllipse($halo, $x - 1, $y - 1, $d + 2, $d + 2); $halo.Dispose()
    $col = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::$colorName)
    $g.FillEllipse($col, $x, $y, $d, $d); $col.Dispose()
    $g.Dispose()
    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $bmp.Dispose()
    return $icon
}

$icoGreen  = New-StatusIcon "LimeGreen"
$icoYellow = New-StatusIcon "Gold"
$icoRed    = New-StatusIcon "Red"

$script:ip  = "localhost"
$script:url = "http://localhost:$ApiPort"

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $icoYellow
$ni.Visible = $true
$ni.Text = "TeksERP - kontrol ediliyor..."

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miTitle  = $menu.Items.Add("TeksERP Sunucu")
$miTitle.Enabled = $false
$miStatus = $menu.Items.Add("Durum kontrol ediliyor...")
$miStatus.Enabled = $false
$miAddr   = $menu.Items.Add("Adres: ...")
$miAddr.Enabled = $false
[void]$menu.Items.Add("-")
$miOpen   = $menu.Items.Add("Durum sayfasini ac")
$miCopy   = $menu.Items.Add("Fabrika adresini kopyala")
$miStudio = $menu.Items.Add("Veritabanini ac (Prisma Studio)")
[void]$menu.Items.Add("-")
$miStart  = $menu.Items.Add("Servisleri baslat (yonetici)")
$miStop   = $menu.Items.Add("Servisleri durdur (yonetici)")
$miRestart= $menu.Items.Add("Servisleri yeniden baslat (yonetici)")
[void]$menu.Items.Add("-")
$miBackup = $menu.Items.Add("Simdi yedek al (yonetici)")
$miLogs   = $menu.Items.Add("Loglari ac")
[void]$menu.Items.Add("-")
$miUninst = $menu.Items.Add("TeksERP'yi kaldir...")
$miExit   = $menu.Items.Add("Cikis")
$ni.ContextMenuStrip = $menu

$miOpen.add_Click({ Start-Process "$($script:url)/" })
$miCopy.add_Click({ Set-Clipboard -Value "$($script:url)/" })
$miStudio.add_Click({ Invoke-ManageAdmin 'studio' })
$miStart.add_Click({ Invoke-ManageAdmin 'start' })
$miStop.add_Click({ Invoke-ManageAdmin 'stop' })
$miRestart.add_Click({ Invoke-ManageAdmin 'restart' })
$miBackup.add_Click({ Invoke-ManageAdmin 'backup' })
$miLogs.add_Click({
    if (Test-Path $LogDir) { Start-Process explorer.exe $LogDir }
    else { [System.Windows.Forms.MessageBox]::Show("Log klasoru henuz olusmamis:`r`n$LogDir", "TeksERP") | Out-Null }
})
$miUninst.add_Click({
    # Inno Setup kaldiricisi: {app}\unins000.exe — kendi yonetici yukseltmesini yapar
    # ve kaldirma sirasinda "veritabanini da sil?" onayini sorar (temiz kurulum).
    $unins = Get-ChildItem $AppRoot -Filter "unins*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($unins) {
        Start-Process $unins.FullName
    } else {
        Start-Process "appwiz.cpl"   # bulunamazsa: Program Ekle/Kaldir
    }
})
$ni.add_DoubleClick({ Start-Process "$($script:url)/" })
$miExit.add_Click({ $script:timer.Stop(); $ni.Visible = $false; $ni.Dispose(); [System.Windows.Forms.Application]::Exit() })

function Update-Status {
    $db = (Get-Service $DbSvc -ErrorAction SilentlyContinue).Status
    $be = (Get-Service $BeSvc -ErrorAction SilentlyContinue).Status
    if (-not $db) { $db = "YOK" }
    if (-not $be) { $be = "YOK" }

    # /health uctan API + DB durumunu cek (DB bagli mi gercekten test eder).
    $apiUp = $false; $dbUp = $false
    try {
        $resp = Invoke-WebRequest "http://localhost:$ApiPort/health" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) {
            $apiUp = $true
            $j = $resp.Content | ConvertFrom-Json
            if ($j.db -eq "UP") { $dbUp = $true }
        }
    } catch {}

    # IP'yi sadece henuz cozulmediyse hesapla (her tick'te degil) -- fabrika
    # sunucusunun adresi nadiren degisir, gereksiz is yapilmasin.
    if (-not $script:ip -or $script:ip -eq "localhost") {
        $script:ip  = Get-PrimaryIp
        $script:url = "http://$($script:ip):$ApiPort"
    }

    if ($be -eq "Running" -and $apiUp -and $dbUp) {
        $ni.Icon = $icoGreen;  $state = "CALISIYOR"
    } elseif ($db -eq "Running" -or $be -eq "Running" -or $apiUp) {
        $ni.Icon = $icoYellow; $state = "KISMI / BASLIYOR"
    } else {
        $ni.Icon = $icoRed;    $state = "DURDU"
    }

    $dbLabel = if ($dbUp) { "bagli" } else { "bagli degil" }
    $tip = "TeksERP: $state`r`nAPI: $(if($apiUp){'acik'}else{'kapali'})  |  DB: $dbLabel`r`n$($script:url)"
    if ($tip.Length -gt 127) { $tip = $tip.Substring(0,127) }
    $ni.Text = $tip
    $miStatus.Text = "Durum: $state   (API: $(if($apiUp){'acik'}else{'kapali'}), DB: $dbLabel)"
    $miAddr.Text   = "Fabrika adresi: $($script:url)"
}

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 8000
$script:timer.add_Tick({ Update-Status })
$script:timer.Start()
Update-Status

[System.Windows.Forms.Application]::Run()
