# =============================================================================
# TeksERP KURULUM - SIHIRBAZ ON OLCUMU (salt okuma; hicbir seyi degistirmez)
# =============================================================================
# TeksERP-Kurulum.exe sihirbaz acilirken cagirir ve sayfalari doldurur: paketin kimligi (imzasiz
# PAKET.json - yalniz gosterim; karar kurulum.ps1'de imzali kunyeden), onceki kurulum (onarim),
# portlar (API mesgul mu; PG portSec onerisi), veri dizini onerisi (D: varsa), suruculer, RAM.
#   powershell -NoProfile -ExecutionPolicy Bypass -File on-olcum.ps1 -Kaynak <setup klasoru> -Kok <kok> -Cikti <ini>
# CIKTI: UTF-16 INI ([olcum] bolumu) - Inno GetIniString okur. Cikis 0 (olcum hatasi INI'de "hata=").
# =============================================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Kaynak,
  [string]$Kok = "C:\TeksERP",
  [int]$ApiPort = 4000,
  [Parameter(Mandatory = $true)][string]$Cikti
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "kurulum-ortak.ps1")
$PG_DIZINI = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\pg"))
$o = [ordered]@{}

function IniDeger([string]$s) { return ($s -creplace '[\r\n]', ' ') }

try {
  $o["yonetici"] = [int](YoneticiMi)
  $o["windows"] = "$([Environment]::OSVersion.Version)"
  $o["x64"] = [int][Environment]::Is64BitOperatingSystem
  $o["ramMB"] = [int][math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
  $pgOrnek = JsonOku (Join-Path $PG_DIZINI "pg-ornegi.json")
  $pgSurum = JsonOku (Join-Path $PG_DIZINI "pg-surumu.json")
  $o["pgSurum"] = "$($pgSurum.surum)-$($pgSurum.derleme)"

  # Paket girdileri (setup ile ayni klasorde): tek eslesme beklenir.
  $p = @(Get-ChildItem -LiteralPath $Kaynak -Filter "tekserp-backend-*.zip" -File -ErrorAction SilentlyContinue)
  $o["paketSayisi"] = $p.Count
  if ($p.Count -eq 1) {
    $o["paketDosya"] = $p[0].FullName
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $a = [IO.Compression.ZipFile]::OpenRead($p[0].FullName)
    try {
      $g = $a.GetEntry("PAKET.json")
      if ($g) {
        $r = New-Object IO.StreamReader($g.Open(), [Text.Encoding]::UTF8)
        try { $k = $r.ReadToEnd() | ConvertFrom-Json } finally { $r.Dispose() }
        $o["paketSurum"] = "$($k.uygulamaSurumu)"
        $o["paketKanal"] = "$($k.backendKanal)"
        $o["paketHizmet"] = "$($k.backendHizmetAdi)"
        $o["paketKorumali"] = [int]($k.korumali -eq $true -and "$($k.korumaHedef)" -ceq "win-x64")
        $o["paketProva"] = [int]($k.prova -eq $true)
      } else { $o["paketHata"] = "PAKET.json yok" }
    } finally { $a.Dispose() }
  }
  $o["pgZipSayisi"] = @(Get-ChildItem -LiteralPath $Kaynak -Filter "postgresql-*.zip" -File -ErrorAction SilentlyContinue).Count
  $o["pgKunyeVar"] = [int](Test-Path -LiteralPath (Join-Path $Kaynak "pg.json"))

  # Adlar (kurulum.ps1 AdlariCoz ile ayni kural; burada yalniz gosterim + AppId).
  $hizmet = if ($o["paketHizmet"]) { $o["paketHizmet"] } else { "TeksERP-Backend" }
  $sonek = if ($hizmet -cmatch '^TeksERP-Backend(-[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$') { $hizmet.Substring("TeksERP-Backend".Length) } else { "" }
  $o["sonek"] = $sonek
  $o["backendHizmeti"] = $hizmet
  $o["guncelleyiciHizmeti"] = "TeksERP-Guncelleyici$sonek"
  $o["pgHizmeti"] = "$($pgOrnek.hizmet.ad)$sonek"

  # Onceki kurulum (onarim): kayit + ornek kaydi.
  $kok = [IO.Path]::GetFullPath($Kok).TrimEnd('\')
  $o["kok"] = $kok
  $kayit = Join-Path $kok "kurulum\kurulum.json"
  $o["onarim"] = [int](Test-Path -LiteralPath $kayit)
  $onceki = $null
  if ($o["onarim"] -eq 1) {
    $k = JsonOku $kayit
    $o["oncekiSurum"] = "$($k.paket.surum)"
    $o["oncekiApi"] = "$($k.portlar.api)"
    $o["oncekiVeri"] = "$($k.pg.veriDizini)"
    $o["oncekiHizmet"] = "$($k.adlar.backend)"
    $ApiPort = [int]$k.portlar.api
  }
  $ornek = Join-Path $kok "pgsql\ornek.json"
  if (Test-Path -LiteralPath $ornek) { $onceki = [int](JsonOku $ornek).port; $o["oncekiPg"] = $onceki }
  $o["kokVar"] = [int](Test-Path -LiteralPath $kok)
  if ($o["kokVar"] -eq 1 -and $o["onarim"] -eq 0) {
    $o["kokYabanci"] = @(Get-ChildItem -LiteralPath $kok -Force | Where-Object { $_.Name -cnotmatch '^(kurulum|unins[0-9]{3}\.(exe|dat|msg))$' }).Count
  }

  # API portu: mesgulse oneri (4000..4099 ilk bos) - kurulum.ps1 mesgul portta DURUR.
  $o["apiPort"] = $ApiPort
  $o["apiMesgul"] = [int]((PortDinleniyorMu $ApiPort) -and $o["onarim"] -eq 0)
  if ($o["apiMesgul"] -eq 1) {
    for ($p2 = 4000; $p2 -le 4099; $p2++) { if (-not (PortDinleniyorMu $p2)) { $o["apiOneri"] = $p2; break } }
  }
  # PG portu (D4 portSec): kayitli > 5432..5499 ilk bos.
  $mesgul = @()
  try { $mesgul += @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.LocalPort }) } catch { }
  $mesgul += @(PgHizmetPortlari)
  $mesgul += @(HaricPortlar ([int]$pgOrnek.port.baslangic) ([int]$pgOrnek.port.bitis))
  $sec = PortSec $mesgul ([int]$pgOrnek.port.baslangic) ([int]$pgOrnek.port.bitis) $onceki $null
  if ($sec.hata) { $o["pgPortHata"] = $sec.hata } else { $o["pgPort"] = $sec.port; $o["pgPortNeden"] = $sec.neden }

  # Suruculer (sabit + NTFS) ve veri dizini onerisi: D: varsa D:\TeksERP\pgveri; yoksa C:'de < 20 GB bos
  # iken daha genis sabit birim; aksi halde <kok>\pgveri (D4 b.4.2).
  $sur = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | Where-Object { "$($_.FileSystem)" -ceq "NTFS" })
  $o["suruculer"] = (@($sur | ForEach-Object { "$($_.DeviceID)|$([math]::Floor([double]$_.FreeSpace / 1GB))" }) -join ";")
  $oneri = Join-Path $kok "pgveri"
  $d = @($sur | Where-Object { "$($_.DeviceID)" -ceq "D:" })
  if ($o["onarim"] -eq 1 -and $o["oncekiVeri"]) { $oneri = $o["oncekiVeri"] }
  elseif ($d.Count) { $oneri = "D:\TeksERP\pgveri" }
  else {
    $c = @($sur | Where-Object { "$($_.DeviceID)" -ceq $kok.Substring(0, 2) })
    $enGenis = @($sur | Sort-Object { [double]$_.FreeSpace } -Descending) | Select-Object -First 1
    if ($c.Count -and [double]$c[0].FreeSpace -lt 20GB -and $enGenis -and "$($enGenis.DeviceID)" -cne $kok.Substring(0, 2)) { $oneri = "$($enGenis.DeviceID)\TeksERP\pgveri" }
  }
  $o["veriOneri"] = $oneri
  $o["tamam"] = 1
} catch {
  $o["tamam"] = 0
  $o["hata"] = "$($_.Exception.Message)"
}
$satirlar = @("[olcum]") + @($o.Keys | ForEach-Object { "$_=" + (IniDeger "$($o[$_])") })
[IO.File]::WriteAllText($Cikti, (($satirlar -join "`r`n") + "`r`n"), [Text.Encoding]::Unicode)
exit 0
