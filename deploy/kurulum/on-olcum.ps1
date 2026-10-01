# =============================================================================
# TeksERP KURULUM - SIHIRBAZ ON OLCUMU (salt okuma; hicbir seyi degistirmez)
# =============================================================================
# TeksERP-Kurulum.exe sihirbaz acilirken cagirir ve sayfalari doldurur: paketin kimligi (imzasiz
# PAKET.json - yalniz gosterim; karar kurulum.ps1'de imzali kunyeden), onceki kurulum (onarim),
# portlar (API mesgul mu; PG portSec onerisi), veri dizini onerisi (D: varsa), suruculer, RAM.
#   powershell -NoProfile -ExecutionPolicy Bypass -File on-olcum.ps1 -Kaynak <setup klasoru> -Kok <kok> -Cikti <ini> [-Cevap <json>] [-Hafif]
# -Cevap (sessiz kip): cevap dosyasi semaya gore dogrulanir (cevapGecerli, cevapHata1..) ve kok/portlar ondan.
# -Hafif (sihirbaz acilisi): yalniz paketin kimligi + yonetici + 64-bit (AppId icin sonek); CIM, port ve kok
#   olcumu YOK - sihirbaz hemen acilir, tam olcum kok secilince "Sistem denetleniyor" penceresiyle kosar.
# Onarim/devamda gercek kurulu surum (kurulum.json'daki DEGIL: current - kurulum-gecmisi.jsonl - guncelleyici durumu)
#   paketten YENIYSE "eskiPaket" engeli; gelismis ayarlar (guncelleme sunucusu, vekil, lisans sunucusu) kayittan.
# CIKTI: UTF-16 INI ([olcum] bolumu) - Inno GetIniString okur. Cikis 0 (olcum hatasi INI'de "hata=").
# =============================================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Kaynak,
  [string]$Kok = "C:\TeksERP",
  [int]$ApiPort = 4000,
  [Parameter(Mandatory = $true)][string]$Cikti,
  [string]$Cevap,
  [switch]$Hafif
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
  $o["x64Surec"] = [int][Environment]::Is64BitProcess
  if ($Cevap) {
    $c = $null
    try { $c = JsonOku $Cevap } catch { $o["cevapGecerli"] = 0; $o["cevapHataSayisi"] = 1; $o["cevapHata1"] = "cevap dosyasi okunamadi: $($_.Exception.Message)" }
    if ($c) {
      $r = CevapDogrula $c (JsonOku (Join-Path $PSScriptRoot "cevap-semasi.json"))
      $o["cevapGecerli"] = [int]($r.hatalar.Count -eq 0)
      $o["cevapHataSayisi"] = $r.hatalar.Count
      for ($i = 0; $i -lt $r.hatalar.Count; $i++) { $o["cevapHata$($i + 1)"] = $r.hatalar[$i] }
      if ($r.hatalar.Count -eq 0) {
        $Kok = $r.deger["kok"]; $ApiPort = [int]$r.deger["api.port"]
        $o["cevapKok"] = $Kok
        foreach ($a in @("backend", "pg", "pgKunye")) { if ($r.deger["paket.$a"]) { $o["cevapPaket.$a"] = $r.deger["paket.$a"] } }
      }
    }
  }
  if (-not $Hafif) { $o["ramMB"] = [int][math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB) }
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
  $pz = @(Get-ChildItem -LiteralPath $Kaynak -Filter "postgresql-*.zip" -File -ErrorAction SilentlyContinue)
  $o["pgZipSayisi"] = $pz.Count
  if ($pz.Count -eq 1) { $o["pgDosya"] = $pz[0].FullName }
  $o["pgKunyeVar"] = [int](Test-Path -LiteralPath (Join-Path $Kaynak "pg.json") -PathType Leaf)
  if ($o["pgKunyeVar"] -eq 1) { $o["pgKunyeDosya"] = [IO.Path]::GetFullPath((Join-Path $Kaynak "pg.json")) }
  $o["etkiliAnahtar"] = $(if (Test-Path -LiteralPath (Join-Path $Kaynak "etkili.tkpub") -PathType Leaf) { [IO.Path]::GetFullPath((Join-Path $Kaynak "etkili.tkpub")) } else { "" })

  # Adlar (kurulum.ps1 AdlariCoz ile ayni kural; burada yalniz gosterim + AppId).
  $hizmet = if ($o["paketHizmet"]) { $o["paketHizmet"] } else { "TeksERP-Backend" }
  $sonek = if ($hizmet -cmatch '^TeksERP-Backend(-[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$') { $hizmet.Substring("TeksERP-Backend".Length) } else { "" }
  $o["sonek"] = $sonek
  $o["backendHizmeti"] = $hizmet
  $o["guncelleyiciHizmeti"] = "TeksERP-Guncelleyici$sonek"
  $o["pgHizmeti"] = "$($pgOrnek.hizmet.ad)$sonek"

  # Hafif kip (sihirbaz acilisi): kok, port, surucu olcumu YOK.
  if ($Hafif) { $o["hafif"] = 1 } else {
    # Onceki kurulum (onarim): kayit + ornek kaydi.
    $kok = [IO.Path]::GetFullPath($Kok).TrimEnd('\')
    $o["kok"] = $kok
    $kayit = Join-Path $kok "kurulum\kurulum.json"
    $durum = Join-Path $kok "kurulum\durum.json"
    $o["onarim"] = [int](Test-Path -LiteralPath $kayit)
    # Yarim kurulum (kurulum.ps1 ile ayni tanim): durum.json var, kurulum.json yok -> ayni paketle DEVAM.
    $o["yarim"] = [int]($o["onarim"] -eq 0 -and (Test-Path -LiteralPath $durum))
    $onceki = $null
    if ($o["onarim"] -eq 1 -or $o["yarim"] -eq 1) {
      $k = JsonOku $(if ($o["onarim"] -eq 1) { $kayit } else { $durum })
      $o["oncekiSurum"] = "$($k.paket.surum)"
      $o["oncekiApi"] = "$($k.portlar.api)"
      $o["oncekiPgPort"] = "$($k.portlar.pg)"
      $o["oncekiVeri"] = "$($k.pg.veriDizini)"
      $o["oncekiHizmet"] = "$($k.adlar.backend)"
      $ApiPort = [int]$k.portlar.api
      # Gercek kurulu surum (kayit KURULUM ANININ surumudur) - eski paketle onarim degisiklikten ONCE durur.
      $veriKoku = if ($env:ProgramData) { Join-Path $env:ProgramData "TeksERP$sonek" } else { $null }
      $ku = EnYeniSurum (KuruluSurumAdaylari $kok $veriKoku)
      if ($ku) { $o["kuruluSurum"] = $ku.surum; $o["kuruluKaynak"] = $ku.kaynak }
      # eskiPaket: "eski" = kurulu surum paketten YENI; "olculemedi" = karsilastirilamadi (ikisi de engel, sihirbaz metni).
      if ($o["paketSurum"]) {
        $e = EskiPaketEngeli $ku "$($o["paketSurum"])"
        if ($e) { $o["eskiPaket"] = $(if ((SurumKarsilastir $ku.surum "$($o["paketSurum"])") -eq 1) { "eski" } else { "olculemedi" }) }
      }
      # Gelismis ayarlar kayittan: guncelleyicinin ayar.json'u ve .env'deki lisans sunucusu (onarim .env'i yeniden yazmaz).
      $ay = Join-Path $kok "guncelleyici\ayar.json"
      if (Test-Path -LiteralPath $ay -PathType Leaf) {
        try {
          $j = JsonOku $ay
          if ("$($j.guncellemeSunucusu)" -cmatch '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$') { $o["oncekiGuncellemeSunucusu"] = "$($j.guncellemeSunucusu)" }
          if ("$($j.vekil)" -cmatch '^http://[A-Za-z0-9.-]+:[0-9]{1,5}$') { $o["oncekiVekil"] = "$($j.vekil)" }
        } catch { }
      }
      $ev = Join-Path $kok "yapilandirma\.env"
      if (Test-Path -LiteralPath $ev -PathType Leaf) {
        try {
          foreach ($l in [IO.File]::ReadAllLines($ev)) {
            if ($l -cmatch '^LICENSE_SERVER_URL=(https://[A-Za-z0-9.-]+(:[0-9]{1,5})?)/?$') { $o["oncekiLisansSunucusu"] = $Matches[1] }
          }
          $o["oncekiLisansOkundu"] = 1
        } catch { }
      }
    }
    $ornek = Join-Path $kok "pgsql\ornek.json"
    if (Test-Path -LiteralPath $ornek) { $onceki = [int](JsonOku $ornek).port; $o["oncekiPg"] = $onceki }
    elseif ($o["yarim"] -eq 1 -and $o["oncekiPgPort"]) { $onceki = [int]$o["oncekiPgPort"] }
    $o["kokVar"] = [int](Test-Path -LiteralPath $kok)
    if ($o["kokVar"] -eq 1 -and $o["onarim"] -eq 0 -and $o["yarim"] -eq 0) {
      $o["kokYabanci"] = @(Get-ChildItem -LiteralPath $kok -Force | Where-Object { $_.Name -cnotmatch '^(kurulum|unins[0-9]{3}\.(exe|dat|msg))$' }).Count
    }

    # API portu: mesgulse oneri (4000..4099 ilk bos) - kurulum.ps1 mesgul portta DURUR.
    $o["apiPort"] = $ApiPort
    $o["apiMesgul"] = [int]((PortDinleniyorMu $ApiPort) -and $o["onarim"] -eq 0 -and $o["yarim"] -eq 0)
    if ($o["apiMesgul"] -eq 1) {
      for ($p2 = 4000; $p2 -le 4099; $p2++) { if (-not (PortDinleniyorMu $p2)) { $o["apiOneri"] = $p2; break } }
    }
    # PG portu (D4 portSec): kayitli > 5432..5499 ilk bos.
    $mesgul = @()
    try { $mesgul += @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.LocalPort }) } catch { }
    $mesgul += (PgHizmetPortlari)
    $mesgul += (HaricPortlar ([int]$pgOrnek.port.baslangic) ([int]$pgOrnek.port.bitis))
    $sec = PortSec $mesgul ([int]$pgOrnek.port.baslangic) ([int]$pgOrnek.port.bitis) $onceki $null
    if ($sec.hata) { $o["pgPortHata"] = $sec.hata } else { $o["pgPort"] = $sec.port; $o["pgPortNeden"] = $sec.neden }

    # Suruculer (sabit + NTFS) ve veri dizini onerisi: D: varsa D:\TeksERP\pgveri; yoksa C:'de < 20 GB bos
    # iken daha genis sabit birim; aksi halde <kok>\pgveri (D4 b.4.2).
    $sur = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | Where-Object { "$($_.FileSystem)" -ceq "NTFS" })
    $o["suruculer"] = (@($sur | ForEach-Object { "$($_.DeviceID)|$([math]::Floor([double]$_.FreeSpace / 1GB))" }) -join ";")
    $oneri = Join-Path $kok "pgveri"
    $d = @($sur | Where-Object { "$($_.DeviceID)" -ceq "D:" })
    if (($o["onarim"] -eq 1 -or $o["yarim"] -eq 1) -and $o["oncekiVeri"]) { $oneri = $o["oncekiVeri"] }
    elseif ($d.Count -and $kok.Substring(0, 2) -cne "D:") { $oneri = "D:\TeksERP$sonek\pgveri" }
    else {
      $c = @($sur | Where-Object { "$($_.DeviceID)" -ceq $kok.Substring(0, 2) })
      $enGenis = @($sur | Sort-Object { [double]$_.FreeSpace } -Descending) | Select-Object -First 1
      if ($c.Count -and [double]$c[0].FreeSpace -lt 20GB -and $enGenis -and "$($enGenis.DeviceID)" -cne $kok.Substring(0, 2)) { $oneri = "$($enGenis.DeviceID)\TeksERP$sonek\pgveri" }
    }
    $o["veriOneri"] = $oneri
  }
  $o["tamam"] = 1
} catch {
  $o["tamam"] = 0
  $o["hata"] = "$($_.Exception.Message)"
}
$satirlar = @("[olcum]") + @($o.Keys | ForEach-Object { "$_=" + (IniDeger "$($o[$_])") })
[IO.File]::WriteAllText($Cikti, (($satirlar -join "`r`n") + "`r`n"), [Text.Encoding]::Unicode)
exit 0
