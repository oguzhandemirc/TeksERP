# =============================================================================
# TeksERP SUNUCU SIMGESI (bildirim alani) - kullanici oturumunda calisir, YONETICI ISTEMEZ
# =============================================================================
# NE: sunucu bilgisayarinda oturum acilinca kendiligindan baslar (kurulum HKLM Run kaydi yazar, kaldirici siler).
#   Renk: YESIL calisiyor - SARI uyari/guncelleme - KIRMIZI sorun. Tikla: durum penceresi. Guncelleme baslayinca
#   balon + ilerleme penceresi kendiliginden acilir, bitince kapanir.
# NEREDEN OKUR: YALNIZ http://127.0.0.1:<Port>/health/tepsi (backend; yalniz dongu adresine cevap verir).
#   Guncelleyicinin dizini korumalidir (SYSTEM + Administrators) - simge ona dokunmaz. Renk karari BACKEND'dedir
#   (Teks-Erp/src/lib/tepsi-durumu.ts); burada yalniz gosterilir. HICBIR sey degistirmez, ag dinlemez, sir gostermez.
# KARAR: PowerShell + .NET WinForms (paketsiz, yeni bagimlilik yok); Rust ikilisi windows-sys'e Shell/pencere
#   ozellikleri + paket icinde imzali yeni ikili gerektirirdi.
# -YalnizIslevler: yalniz saf islevleri tanimlar (harness vektorleri; pencere acilmaz).
# ASCII: PS 5.1 BOM'suz UTF-8'i ANSI okur; Turkce metin \uXXXX ile (TrMetin).
# =============================================================================
[CmdletBinding()]
param(
  [int]$Port = 4000,
  [switch]$YalnizIslevler
)
$ErrorActionPreference = "Stop"

# \uXXXX kacislarini cozer (dosya ASCII kalir).
function TrMetin([string]$s) { return [regex]::Unescape($s) }

$script:RENKLER = @("YESIL", "SARI", "KIRMIZI")

# SAF: backend cevabi (ya da $null = ulasilamadi) + ardisik hata sayisi + onceki karar -> gosterilecek karar.
# Tanimayan cevap FAIL-CLOSED KIRMIZI; kisa kesinti (ilk 3 hata) onceki karari korur; guncelleme surerken
# sunucu yeniden basliyorsa (<120 hata ~ 10 dk) SARI "yeniden basliyor", sonra KIRMIZI.
function TepsiKarar($yanit, [int]$ardisikHata, $onceki) {
  if ($null -ne $yanit) {
    $gecerli = ($yanit.PSObject.Properties["v"] -and [int]$yanit.v -eq 1 -and $yanit.PSObject.Properties["renk"] -and ($script:RENKLER -ccontains "$($yanit.renk)"))
    if (-not $gecerli) { return @{ renk = "KIRMIZI"; baslik = (TrMetin "TeksERP Sunucu: yan\u0131t tan\u0131nm\u0131yor"); nedenler = @((TrMetin "Sunucunun durum yan\u0131t\u0131 tan\u0131nm\u0131yor (s\u00fcr\u00fcm uyumsuz olabilir).")); surucu = $false; ilerleme = $null; hedef = $null; adim = $null } }
    $g = $yanit.guncelleme
    $surucu = ($null -ne $g -and $g.surucu -eq $true)
    return @{
      renk = "$($yanit.renk)"; baslik = "$($yanit.baslik)"; nedenler = @($yanit.nedenler | ForEach-Object { "$_" })
      surucu = $surucu; ilerleme = $(if ($surucu) { $g.ilerleme } else { $null }); hedef = $(if ($surucu) { $g.hedefSurum } else { $null }); adim = $(if ($surucu) { $g.adim } else { $null })
    }
  }
  if ($ardisikHata -lt 3 -and $null -ne $onceki) { return $onceki }
  if ($null -ne $onceki -and $onceki.surucu -eq $true -and $ardisikHata -lt 120) {
    return @{ renk = "SARI"; baslik = (TrMetin "TeksERP Sunucu: g\u00fcncelleniyor"); nedenler = @((TrMetin "G\u00fcncelleme s\u00fcr\u00fcyor; sunucu yeniden ba\u015fl\u0131yor.")); surucu = $true; ilerleme = $null; hedef = $onceki.hedef; adim = $onceki.adim }
  }
  return @{ renk = "KIRMIZI"; baslik = (TrMetin "TeksERP Sunucu: sorun var"); nedenler = @((TrMetin "Sunucuya ula\u015f\u0131lam\u0131yor (hizmet kapal\u0131 olabilir).")); surucu = $false; ilerleme = $null; hedef = $null; adim = $null }
}

# SAF: NotifyIcon.Text en cok 63 karakter (.NET 4 yoksa ArgumentException).
function TepsiIpucu($karar) {
  $m = "$($karar.baslik)"
  if ($m.Length -gt 63) { $m = $m.Substring(0, 62) + [string][char]0x2026 }
  return $m
}

# SAF: ilerleme yuzdesi (bilinmiyorsa $null -> belirsiz cubuk).
function TepsiYuzde($ilerleme) {
  if ($null -eq $ilerleme) { return $null }
  if (-not $ilerleme.PSObject.Properties["toplam"] -or -not $ilerleme.PSObject.Properties["indirilen"]) { return $null }
  $t = [double]$ilerleme.toplam
  if ($t -le 0) { return $null }
  return [int][math]::Max(0, [math]::Min(100, [math]::Floor(100 * [double]$ilerleme.indirilen / $t)))
}

if ($YalnizIslevler) { return }

# ----------------------------- pencere/simge katmani -----------------------------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$yeni = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\TeksERP-Sunucu-Tepsi", [ref]$yeni)
if (-not $yeni) { return }   # bu oturumda zaten calisiyor

function SimgeYap([string]$renk) {
  $rgb = switch ($renk) { "YESIL" { @(46, 160, 67) } "SARI" { @(227, 160, 8) } default { @(204, 41, 54) } }
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $f = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($rgb[0], $rgb[1], $rgb[2]))
  $k = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 2
  $gr.FillEllipse($f, 2, 2, 27, 27); $gr.DrawEllipse($k, 2, 2, 27, 27)
  $gr.Dispose(); $f.Dispose(); $k.Dispose()
  $h = $bmp.GetHicon()
  $ic = [System.Drawing.Icon]::FromHandle($h)
  $kopya = $ic.Clone()
  $ic.Dispose(); $bmp.Dispose()
  return $kopya
}
$simgeler = @{}
foreach ($r in $script:RENKLER) { $simgeler[$r] = SimgeYap $r }

function Sorgula {
  try {
    $istek = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/health/tepsi")
    $istek.Proxy = $null; $istek.Timeout = 3000; $istek.ReadWriteTimeout = 3000; $istek.Method = "GET"
    $yanit = $istek.GetResponse()
    try {
      $okuyucu = New-Object System.IO.StreamReader($yanit.GetResponseStream(), [System.Text.Encoding]::UTF8)
      $metin = $okuyucu.ReadToEnd(); $okuyucu.Dispose()
    } finally { $yanit.Close() }
    if ($metin.Length -gt 65536) { return $null }
    return ($metin | ConvertFrom-Json)
  } catch { return $null }
}

$bildirim = New-Object System.Windows.Forms.NotifyIcon
$bildirim.Icon = $simgeler["KIRMIZI"]
$bildirim.Text = TepsiIpucu @{ baslik = "TeksERP Sunucu" }
$bildirim.Visible = $true

$script:karar = $null
$script:hata = 0
$script:surucuOnceki = $false
$script:durumForm = $null
$script:ilerlemeForm = $null

function DurumPenceresi {
  if ($script:durumForm -and -not $script:durumForm.IsDisposed) { $script:durumForm.Activate(); return }
  $f = New-Object System.Windows.Forms.Form
  $f.Text = "TeksERP Sunucu"; $f.Size = New-Object System.Drawing.Size(460, 300); $f.StartPosition = "CenterScreen"
  $f.FormBorderStyle = "FixedDialog"; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.ShowInTaskbar = $true
  $e = New-Object System.Windows.Forms.Label; $e.Name = "baslik"; $e.Location = New-Object System.Drawing.Point(16, 14); $e.Size = New-Object System.Drawing.Size(420, 28)
  $e.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
  $n = New-Object System.Windows.Forms.Label; $n.Name = "nedenler"; $n.Location = New-Object System.Drawing.Point(16, 54); $n.Size = New-Object System.Drawing.Size(420, 150)
  $b = New-Object System.Windows.Forms.Button; $b.Text = (TrMetin "Kapat"); $b.Location = New-Object System.Drawing.Point(346, 220); $b.Add_Click({ $script:durumForm.Close() })
  $f.Controls.AddRange(@($e, $n, $b)); $f.AcceptButton = $b
  $script:durumForm = $f
  DurumPenceresiYenile
  $f.Show()
}
function DurumPenceresiYenile {
  if (-not $script:durumForm -or $script:durumForm.IsDisposed -or $null -eq $script:karar) { return }
  $k = $script:karar
  $script:durumForm.Controls["baslik"].Text = "$($k.baslik)"
  $satirlar = @($k.nedenler)
  if (-not $satirlar.Count) { $satirlar = @((TrMetin "Her \u015fey yolunda: sunucu \u00e7al\u0131\u015f\u0131yor.")) }
  $script:durumForm.Controls["nedenler"].Text = ($satirlar -join "`r`n`r`n")
}
function IlerlemePenceresiAc {
  if ($script:ilerlemeForm -and -not $script:ilerlemeForm.IsDisposed) { return }
  $f = New-Object System.Windows.Forms.Form
  $f.Text = (TrMetin "TeksERP g\u00fcncelleniyor"); $f.Size = New-Object System.Drawing.Size(440, 160); $f.StartPosition = "CenterScreen"
  $f.FormBorderStyle = "FixedDialog"; $f.ControlBox = $false; $f.TopMost = $true
  $e = New-Object System.Windows.Forms.Label; $e.Name = "ileti"; $e.Location = New-Object System.Drawing.Point(16, 16); $e.Size = New-Object System.Drawing.Size(400, 40)
  $p = New-Object System.Windows.Forms.ProgressBar; $p.Name = "cubuk"; $p.Location = New-Object System.Drawing.Point(16, 66); $p.Size = New-Object System.Drawing.Size(400, 24); $p.Style = "Marquee"
  $f.Controls.AddRange(@($e, $p))
  $script:ilerlemeForm = $f
  $f.Show()
}
function IlerlemePenceresiYenile {
  if (-not $script:ilerlemeForm -or $script:ilerlemeForm.IsDisposed) { return }
  $k = $script:karar
  $hedef = $(if ($k.hedef) { " $($k.hedef)" } else { "" })
  $script:ilerlemeForm.Controls["ileti"].Text = (TrMetin "Sunucu g\u00fcncelleniyor$hedef. L\u00fctfen bilgisayar\u0131 kapatmay\u0131n; i\u015flem bitince bu pencere kendisi kapan\u0131r.")
  $y = TepsiYuzde $k.ilerleme
  $c = $script:ilerlemeForm.Controls["cubuk"]
  if ($null -eq $y) { $c.Style = "Marquee" } else { $c.Style = "Continuous"; $c.Value = $y }
}
function IlerlemePenceresiKapat {
  if ($script:ilerlemeForm -and -not $script:ilerlemeForm.IsDisposed) { $script:ilerlemeForm.Close(); $script:ilerlemeForm.Dispose() }
  $script:ilerlemeForm = $null
}

function Tazele {
  $yanit = Sorgula
  if ($null -eq $yanit) { $script:hata++ } else { $script:hata = 0 }
  $yeniKarar = TepsiKarar $yanit $script:hata $script:karar
  $script:karar = $yeniKarar
  $bildirim.Icon = $simgeler[$yeniKarar.renk]
  $bildirim.Text = TepsiIpucu $yeniKarar
  if ($yeniKarar.surucu -and -not $script:surucuOnceki) {
    $bildirim.BalloonTipTitle = "TeksERP Sunucu"; $bildirim.BalloonTipText = (TrMetin "G\u00fcncelleme ba\u015flad\u0131.")
    $bildirim.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info; $bildirim.ShowBalloonTip(5000)
    IlerlemePenceresiAc
  } elseif (-not $yeniKarar.surucu -and $script:surucuOnceki) {
    IlerlemePenceresiKapat
    $bildirim.BalloonTipTitle = "TeksERP Sunucu"
    if ($yeniKarar.renk -eq "KIRMIZI") { $bildirim.BalloonTipText = (TrMetin "G\u00fcncelleme sona erdi ancak sorun var; durum i\u00e7in simgeye t\u0131klay\u0131n."); $bildirim.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning }
    else { $bildirim.BalloonTipText = (TrMetin "G\u00fcncelleme tamamland\u0131."); $bildirim.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info }
    $bildirim.ShowBalloonTip(5000)
  }
  $script:surucuOnceki = [bool]$yeniKarar.surucu
  if ($yeniKarar.surucu) { IlerlemePenceresiYenile }
  DurumPenceresiYenile
  $zamanlayici.Interval = $(if ($yeniKarar.surucu) { 2000 } else { 5000 })
}

$zamanlayici = New-Object System.Windows.Forms.Timer
$zamanlayici.Interval = 1000
$zamanlayici.Add_Tick({ try { Tazele } catch { } })
$bildirim.Add_MouseClick({ param($o, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { DurumPenceresi } })
$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add((TrMetin "Durum"), $null, { DurumPenceresi })
[void]$menu.Items.Add((TrMetin "Simgeyi kapat"), $null, { [System.Windows.Forms.Application]::Exit() })
$bildirim.ContextMenuStrip = $menu
$zamanlayici.Start()
try { [System.Windows.Forms.Application]::Run() }
finally {
  $zamanlayici.Stop(); $bildirim.Visible = $false; $bildirim.Dispose()
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
