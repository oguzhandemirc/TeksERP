# =============================================================================
# TeksERP SUNUCU KURULUMU - KALDIRMA (TeksERP-Kurulum kaldiricisi cagirir) - VERI KORUNUR
# =============================================================================
# KALDIRILAN (yalniz PROGRAM): uc hizmetin kaydi (guncelleyici, backend, kendi PostgreSQL ornegi -
#   harici PG'ye DOKUNULMAZ) - gece yedegi gorevi - bu kurulumun guvenlik duvari kurallari - program
#   dizinleri: surumler\ - current (baglanti) - guncelleyici\ - pgsql\<surum>-<derleme>\ - pgsql\bin
#   (baglanti) - <KOK>\yedekle.ps1.
# KORUNAN (VERI - bu betik ASLA silmez; silmek ayri, bilincli karardir, once yedek dogrulanir):
#   PostgreSQL veri dizini - pg-setup\ (postgres parolasi DPAPI + db-credentials) - yapilandirma\ (.env) -
#   lisans\ - backups\ - yedek-anahtar\ - veri\ - logs\ - mobil-guncelleme\ - rclone\ - pgsql\ornek.json -
#   kurulum\kurulum.json + gunluk\ - %ProgramData%\TeksERP[-kanal]\guncelleme\ (guncelleme oncesi yedekler).
#   Ayni kok ve veriyle yeniden kurulum = ONARIM (veri dizini dolu -> initdb kosmaz, kayitli port korunur).
# DOKUNULMAYAN: Windows saat esitlemesi (kurulumun actigi NTP acik kalir; onceki ayar kurulum.json saat.onceki).
# BAGLANTI (junction) yalniz [IO.Directory]::Delete ile silinir: Remove-Item -Recurse HEDEFINI bosaltirdi.
#   powershell -NoProfile -ExecutionPolicy Bypass -File kaldir.ps1 -Kok C:\TeksERP
# CIKIS: 0 (adim dusse de devam eder, sonda ACIK liste) - 1 yonetici degil / kok gecersiz.
# =============================================================================
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Kok)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "kurulum-ortak.ps1")

$acik = @()
function AdimDene([string]$ne, [scriptblock]$is) {
  try { & $is } catch { $script:acik += "$ne : $($_.Exception.Message)"; Uyar "$ne yapilamadi: $($_.Exception.Message)" }
}

$cikis = 0
try {
  if (-not (YoneticiMi)) { Dur "YONETICI olarak calistirin." }
  $kok = [IO.Path]::GetFullPath($Kok).TrimEnd('\')
  if ($kok.Length -lt 4 -or (ReparseMi $kok)) { Dur "kok gecersiz: $kok" }
  $gd = Join-Path $kok "kurulum\gunluk"
  if (Test-Path -LiteralPath (Join-Path $kok "kurulum")) {
    if (-not (Test-Path -LiteralPath $gd)) { New-Item -ItemType Directory -Path $gd -Force | Out-Null }
    $script:GunlukYolu = Join-Path $gd ("kaldir-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
  }
  Baslik "TeksERP sunucu kurulumu kaldiriliyor (VERI KORUNUR): $kok"

  # Adlar: kurulum kaydi > yarim kurulumun durum dosyasi > varsayilan.
  $ad = $null; $guvenlik = @(); $veriDizini = $null
  foreach ($f in @("kurulum\kurulum.json", "kurulum\durum.json")) {
    $y = Join-Path $kok $f
    if (-not $ad -and (Test-Path -LiteralPath $y)) {
      $k = Get-Content -LiteralPath $y -Raw -Encoding UTF8 | ConvertFrom-Json
      $ad = $k.adlar
      if ($k.PSObject.Properties["guvenlikDuvari"]) { $guvenlik = @($k.guvenlikDuvari) }
      elseif ($k.portlar) { $guvenlik = @("TeksERP API $($k.portlar.api)", "$($k.adlar.mdnsKurali)") }
      if ($k.pg) { $veriDizini = "$($k.pg.veriDizini)" }
    }
  }
  if (-not $ad) {
    Uyar "kurulum kaydi yok - varsayilan adlar kullaniliyor"
    $ad = [pscustomobject]@{ backend = "TeksERP-Backend"; guncelleyici = "TeksERP-Guncelleyici"; pg = "TeksERP-PostgreSQL"; gorev = "TeksERP-DB-Backup"; veriKoku = (Join-Path $env:ProgramData "TeksERP") }
  }

  # 1) Hizmetler: once guncelleyici (backend'i yeniden baslatmasin), sonra backend, sonra kendi PG.
  AdimDene "guncelleyici hizmeti" {
    $exe = Join-Path $kok "guncelleyici\tekserp-guncelleyici.exe"
    if (Get-Service -Name "$($ad.guncelleyici)" -ErrorAction SilentlyContinue) {
      if (Test-Path -LiteralPath $exe) { $r = NativeKos $exe @("hizmet-kaldir", "--ad", "$($ad.guncelleyici)"); if ($r.kod -ne 0) { throw "hizmet-kaldir $($r.kod): $($r.cikti)" } }
      else { Stop-Service -Name "$($ad.guncelleyici)" -Force -ErrorAction SilentlyContinue; $r = NativeKos "sc.exe" @("delete", "$($ad.guncelleyici)"); if ($r.kod -ne 0) { throw "sc delete $($r.kod)" } }
      Ok "hizmet kaldirildi: $($ad.guncelleyici)"
    }
  }
  AdimDene "backend hizmeti" {
    $exe = Join-Path $kok "current\runtime\tekserp-hizmet.exe"
    if (Get-Service -Name "$($ad.backend)" -ErrorAction SilentlyContinue) {
      if (Test-Path -LiteralPath $exe) { $r = NativeKos $exe @("hizmet-kaldir", "--ad", "$($ad.backend)"); if ($r.kod -ne 0) { throw "hizmet-kaldir $($r.kod): $($r.cikti)" } }
      else { Stop-Service -Name "$($ad.backend)" -Force -ErrorAction SilentlyContinue; $r = NativeKos "sc.exe" @("delete", "$($ad.backend)"); if ($r.kod -ne 0) { throw "sc delete $($r.kod)" } }
      Ok "hizmet kaldirildi: $($ad.backend)"
    }
  }
  $ornekYolu = Join-Path $kok "pgsql\ornek.json"
  $kendi = $false
  if (Test-Path -LiteralPath $ornekYolu) {
    $o = Get-Content -LiteralPath $ornekYolu -Raw -Encoding UTF8 | ConvertFrom-Json
    $kendi = ("$($o.kip)" -ceq "kendi")
    if (-not $veriDizini) { $veriDizini = "$($o.veriDizini)" }
    if (-not $kendi) { Bilgi "PostgreSQL HARICI ($($o.hizmet)) - dokunulmadi" }
  }
  if ($kendi) {
    AdimDene "PostgreSQL hizmeti" {
      if (Get-Service -Name "$($ad.pg)" -ErrorAction SilentlyContinue) {
        Stop-Service -Name "$($ad.pg)" -Force -ErrorAction SilentlyContinue
        [void](HizmetBekle "$($ad.pg)" "Stopped" 120)
        $pgctl = Join-Path $kok "pgsql\bin\pg_ctl.exe"
        $r = if (Test-Path -LiteralPath $pgctl) { NativeKos $pgctl @("unregister", "-N", "$($ad.pg)") } else { NativeKos "sc.exe" @("delete", "$($ad.pg)") }
        if ($r.kod -ne 0) { throw "kayit silinemedi ($($r.kod)): $($r.cikti)" }
        Ok "hizmet kaldirildi: $($ad.pg) (veri dizini KORUNDU: $veriDizini)"
      }
    }
  }

  # 2) Gorev ve guvenlik duvari: yalniz bu kurulumunkiler (gorev eylemi bu kokun yedekle.ps1'i).
  AdimDene "gece yedegi gorevi" {
    $g = Get-ScheduledTask -TaskName "$($ad.gorev)" -ErrorAction SilentlyContinue
    if ($g) {
      $eylem = @($g.Actions | ForEach-Object { "$($_.Arguments)" }) -join " "
      if ($eylem.ToLowerInvariant().Contains((Join-Path $kok "yedekle.ps1").ToLowerInvariant())) { Unregister-ScheduledTask -TaskName "$($ad.gorev)" -Confirm:$false; Ok "gorev kaldirildi: $($ad.gorev)" }
      else { Uyar "gorev $($ad.gorev) baska bir koku gosteriyor - DOKUNULMADI" }
    }
  }
  foreach ($kural in $guvenlik) {
    if (-not $kural) { continue }
    AdimDene "guvenlik duvari kurali $kural" {
      if (Get-NetFirewallRule -DisplayName $kural -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName $kural; Ok "kural kaldirildi: $kural" }
    }
  }

  # 3) Program dizinleri - YALNIZ bu liste. Baglantilar ozyinelemesiz silinir.
  AdimDene "current baglantisi" {
    $c = Join-Path $kok "current"
    if (Test-Path -LiteralPath $c) { if (ReparseMi $c) { [IO.Directory]::Delete($c); Ok "current baglantisi kaldirildi" } else { throw "current baglanti degil (gercek dizin) - DOKUNULMADI" } }
  }
  AdimDene "pgsql\bin baglantisi" {
    $b = Join-Path $kok "pgsql\bin"
    if (Test-Path -LiteralPath $b) { if (ReparseMi $b) { [IO.Directory]::Delete($b); Ok "pgsql\bin baglantisi kaldirildi" } else { throw "pgsql\bin baglanti degil - DOKUNULMADI" } }
  }
  $programDizinleri = @(Join-Path $kok "surumler") + @(Join-Path $kok "guncelleyici")
  if ($kendi) { $programDizinleri += @(Get-ChildItem -LiteralPath (Join-Path $kok "pgsql") -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -cmatch '^[0-9]{2}\.[0-9]{1,3}-[0-9]{1,3}$' } | ForEach-Object { $_.FullName }) }
  foreach ($p in $programDizinleri) {
    AdimDene "program dizini $p" {
      if (Test-Path -LiteralPath $p) {
        if (ReparseMi $p) { throw "baglanti noktasi - ozyinelemeli silinmez" }
        $ic = @(Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })
        if ($ic.Count) { throw "icinde baglanti var ($($ic[0].FullName)) - DOKUNULMADI" }
        Remove-Item -LiteralPath $p -Recurse -Force
        Ok "silindi: $p"
      }
    }
  }
  AdimDene "yedekle.ps1" { $y = Join-Path $kok "yedekle.ps1"; if (Test-Path -LiteralPath $y) { Remove-Item -LiteralPath $y -Force; Ok "silindi: $y" } }

  # 4) Korunanlar - adlariyla.
  $korunan = @()
  foreach ($rel in @("yapilandirma", "pg-setup", "lisans", "backups", "yedek-anahtar", "veri", "logs", "mobil-guncelleme", "rclone", "pgsql\ornek.json", "kurulum\kurulum.json")) {
    $y = Join-Path $kok $rel
    if (Test-Path -LiteralPath $y) { $korunan += $y }
  }
  if ($veriDizini -and (Test-Path -LiteralPath $veriDizini)) { $korunan += "$veriDizini (PostgreSQL VERI dizini)" }
  $gk = Join-Path "$($ad.veriKoku)" "guncelleme"
  if (Test-Path -LiteralPath $gk) { $korunan += "$gk (guncelleme oncesi yedekler is\yedek\)" }
  Write-Host ""
  Write-Host "  KORUNDU (veri - silinmedi):" -ForegroundColor Green
  foreach ($k in $korunan) { Write-Host "    - $k"; [void](GunlugeYaz "KORUNDU" $k) }
  Write-Host "  Ayni kok ve veriyle yeniden kurulum ONARIM olur. Veriyi silmek ayri ve bilincli bir karardir:" -ForegroundColor Yellow
  Write-Host "  once son yedegi baska makinede GERI YUKLEYEREK dogrulayin, sonra dizinleri elle silin." -ForegroundColor Yellow
  # Saat esitlemesi GERI ALINMAZ: acik NTP makine icin guvenli varsayilandir; ilk kurulumun onceki ayari kurulum.json'da.
  Write-Host "  Windows saat esitlemesi (NTP) oldugu gibi birakildi; kurulum oncesi ayar: kurulum\kurulum.json (saat.onceki)."
} catch {
  $cikis = 1
  if (-not "$($_.Exception.Message)".StartsWith("KURULUM_DUR:")) { Write-Host ("  X  " + (Maskele "$($_.Exception.Message)")) -ForegroundColor Red }
}
if ($acik.Count) {
  Write-Host ""
  Write-Host "  YAPILAMAYANLAR ($($acik.Count)):" -ForegroundColor Yellow
  foreach ($a in $acik) { Write-Host "    - $a" -ForegroundColor Yellow }
}
exit $cikis
