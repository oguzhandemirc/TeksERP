# =============================================================================
# TeksERP - GUNCELLEYICI HIZMETI (TeksERP-Guncelleyici, LocalSystem): ikili + ayar.json + kayit
# =============================================================================
# NE ZAMAN KOSAR: kurulumda (setup, D5) ve pm2 -> hizmet gecisinde (deploy\gecis\gecis.ps1, D6)
#   BIR KEZ, YONETICI PowerShell'de. Sonrasinda guncelleyici kendini KENDISI gunceller
#   (GUNCELLEYICI.md 10); bu betik o alani ezmez. ayar.json bicimi TEK yerde: burada.
#     powershell -NoProfile -ExecutionPolicy Bypass -File guncelleyici-hizmeti.ps1 -Kok C:\TeksERP
#     (varsayilan: yalniz OLCER, hicbir seyi degistirmez; uygulamak icin -Uygula)
#
# IMZA (D5 ile sabit; degisirse once yoneticiye yazilir):
#   -Kok <mutlak> [-HizmetAdi <ad>] [-VeriDizini <mutlak>] [-BackendHizmeti <ad>]
#   [-GuncellemeSunucusu <https>] [-Vekil <http://host:port>] [-Uygula]
#
# NE YAPAR (-Uygula):
#   [1/4] <Kok>\guncelleyici\ korumali (SYSTEM + Administrators, miras kesik, genis gruplar yok):
#         backend'in yazabildigi dizinde olsaydi SYSTEM'in ikilisi/gunlugu ele gecirilebilirdi.
#   [2/4] Ikili: <Kok>\current\runtime\tekserp-guncelleyici.exe -> <Kok>\guncelleyici\ (ozet ayniysa
#         atlanir; farkli ve hizmet CALISIYORSA durur - kendini guncelleme alani, cakismaz).
#   [3/4] ayar.json (GUNCELLEYICI.md 6.1): yoksa yazilir; varsa YALNIZ guncellemeSunucusu,
#         backendHizmeti (yalniz varsayilan degilse) ve vekil (verildiyse) duzeltilir, digerleri korunur.
#         BOM'suz UTF-8 (serde BOM kabul etmez), gecici dosya + yeniden adlandirma.
#   [4/4] Kayit: olculur; yoksa/uyumsuzsa ikilinin KENDI alt komutu
#         `tekserp-guncelleyici.exe hizmet-kur --kok <Kok> [--veri <VeriDizini>] --ad <ad>`.
#   Hizmeti BASLATMAZ/DURDURMAZ - cagiran yapar.
#
# CIKIS: 0 uyumlu | 2 uyumsuz | 1 hata/ret.
# ASCII: PS 5.1 BOM'suz UTF-8'i ANSI okur; bu dosya bilerek yalniz ASCII tasir.
# =============================================================================
[CmdletBinding()]
param(
  [string]$Kok = "C:\TeksERP",
  [string]$HizmetAdi = "TeksERP-Guncelleyici",
  # Ayni makinede ikinci kanal: guncelleyicinin kendi veri koku (backend'in TEKSERP_GUNCELLEME_DIZINI = <veri>\guncelleme).
  [string]$VeriDizini,
  [string]$BackendHizmeti = "TeksERP-Backend",
  [string]$GuncellemeSunucusu = "https://guncelleme.etkiliyazilim.com",
  [string]$Vekil,
  [switch]$Uygula
)
$ErrorActionPreference = "Stop"

function Ok($m)    { Write-Host "  OK $m" -ForegroundColor Green }
function Uyar($m)  { Write-Host "  !  $m" -ForegroundColor Yellow; $script:uyumsuz++ }
function Bilgi($m) { Write-Host "  .  $m" -ForegroundColor DarkGray }
function Dur($m)   { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; exit 1 }
$script:uyumsuz = 0

$SID_SYSTEM = "S-1-5-18"
$SID_ADMIN  = "S-1-5-32-544"
$GENIS = @("S-1-5-32-545", "S-1-5-11", "S-1-1-0")
$VARSAYILAN_BACKEND = "TeksERP-Backend"

# backend-hizmeti.ps1 ile AYNI govde (bekci ikizligi olcer).
function HizmetSid([string]$ad) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $h = $sha.ComputeHash([System.Text.Encoding]::Unicode.GetBytes($ad.ToUpperInvariant()))
  $p = @()
  for ($i = 0; $i -lt 5; $i++) { $p += [string][BitConverter]::ToUInt32($h, $i * 4) }
  return "S-1-5-80-" + ($p -join "-")
}

# backend-hizmeti.ps1 ile AYNI govde (bekci ikizligi olcer).
function Erisim($yol, [string[]]$sidler) {
  $acl = Get-Acl -LiteralPath $yol
  $izin = 0; $red = 0
  foreach ($k in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($sidler -notcontains $k.IdentityReference.Value) { continue }
    if (($k.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    $m = [int64]$k.FileSystemRights
    if ("$($k.AccessControlType)" -ceq "Deny") { $red = $red -bor $m } else { $izin = $izin -bor $m }
  }
  $e = $izin -band (-bnot $red)
  $okur = (($e -band 0x1) -ne 0) -or (($e -band 0x80000000) -ne 0) -or (($e -band 0x10000000) -ne 0)
  $yazmaMaskesi = 0x2 -bor 0x4 -bor 0x40 -bor 0x10000 -bor 0x40000 -bor 0x80000 -bor 0x40000000 -bor 0x10000000
  $yazar = ($e -band $yazmaMaskesi) -ne 0
  return [pscustomobject]@{ Okur = $okur; Yazar = $yazar }
}

# backend-hizmeti.ps1 ile AYNI govde (bekci ikizligi olcer).
function GenisAce($yol) {
  $bulunan = @()
  foreach ($k in (Get-Acl -LiteralPath $yol).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($GENIS -contains $k.IdentityReference.Value -and "$($k.AccessControlType)" -ceq "Allow") { $bulunan += $k.IdentityReference.Value }
  }
  return ,$bulunan
}

# backend-hizmeti.ps1 ile AYNI govde (bekci ikizligi olcer).
function ReparseMi($yol) {
  return ((Get-Item -LiteralPath $yol -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
}

# backend-hizmeti.ps1 ile AYNI govde (bekci ikizligi olcer).
function KomutParcala([string]$s) {
  $parca = New-Object System.Collections.Generic.List[string]
  $i = 0; $n = $s.Length
  while ($i -lt $n) {
    while ($i -lt $n -and ($s[$i] -ceq ' ' -or $s[$i] -ceq "`t")) { $i++ }
    if ($i -ge $n) { break }
    $sb = New-Object System.Text.StringBuilder
    $tirnak = $false
    while ($i -lt $n) {
      $c = $s[$i]
      if ($c -ceq '\') {
        $b = 0
        while ($i -lt $n -and $s[$i] -ceq '\') { $b++; $i++ }
        if ($i -lt $n -and $s[$i] -ceq '"') {
          [void]$sb.Append('\' * [int][math]::Floor($b / 2))
          if ($b % 2 -eq 1) { [void]$sb.Append('"'); $i++ }
        } else { [void]$sb.Append('\' * $b) }
        continue
      }
      if ($c -ceq '"') { $tirnak = -not $tirnak; $i++; continue }
      if (-not $tirnak -and ($c -ceq ' ' -or $c -ceq "`t")) { break }
      [void]$sb.Append($c); $i++
    }
    $parca.Add($sb.ToString())
  }
  return ,$parca.ToArray()
}

# backend-hizmeti.ps1 ile AYNI govde (bekci ikizligi olcer).
function YolEsit($a, $b) {
  if (-not $a -or -not $b) { return $false }
  return [string]::Equals(([string]$a).TrimEnd('\'), ([string]$b).TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
}

function Ozet($yol) {
  if (-not (Test-Path -LiteralPath $yol)) { return $null }
  return (Get-FileHash -LiteralPath $yol -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Windows ikilisi mi (MZ): yarim kopya / bozuk indirme "var" gorunur ama calismaz.
function MzMi($yol) {
  try {
    $fs = [System.IO.File]::OpenRead($yol)
    try { $b = New-Object byte[] 2; $n = $fs.Read($b, 0, 2); return ($n -eq 2 -and $b[0] -eq 0x4D -and $b[1] -eq 0x5A) }
    finally { $fs.Dispose() }
  } catch { return $false }
}

# Korumali dizin: miras kesik, SYSTEM + Administrators tam, genis gruplar ve backend hesabi yok.
function KorumaliYaz($yol, $backendSid) {
  & icacls.exe $yol /inheritance:r /grant:r "*$($SID_SYSTEM):(OI)(CI)F" "*$($SID_ADMIN):(OI)(CI)F" /remove:g "*S-1-5-32-545" "*S-1-5-11" "*S-1-1-0" | Out-Null
  if ($LASTEXITCODE -ne 0) { Uyar "izin yazilamadi (icacls $LASTEXITCODE): $yol"; return }
  # Backend hesabi kayitliysa (geriye kalmis ACE) cikar; kayitli degilse icacls hesabi cozemez - zaten ACE yok.
  if (Get-Service -Name $BackendHizmeti -ErrorAction SilentlyContinue) {
    & icacls.exe $yol /remove:g "*$backendSid" | Out-Null
    if ($LASTEXITCODE -ne 0) { Uyar "backend hesabi izinden cikarilamadi (icacls $LASTEXITCODE): $yol" }
  }
}

# Kayit defterinden kayit farki (bos = uyumlu; $null = kayitli degil).
function HizmetFarki($ad, $ikili, $kok, $veri) {
  $k = "HKLM:\SYSTEM\CurrentControlSet\Services\$ad"
  if (-not (Test-Path $k)) { return $null }
  $v = Get-ItemProperty -Path $k
  $fark = @()
  if ([string]$v.ObjectName -cne "LocalSystem") { $fark += "hesap '$($v.ObjectName)' (beklenen 'LocalSystem')" }
  $p = KomutParcala ([string]$v.ImagePath)
  $bek = @("hizmet", "--kok", $kok)
  if ($veri) { $bek += @("--veri", $veri) }
  $bek += @("--ad", $ad)
  $argOk = ($p.Count -eq ($bek.Count + 1)) -and (YolEsit $p[0] $ikili)
  if ($argOk) {
    for ($i = 0; $i -lt $bek.Count; $i++) {
      $x = $p[$i + 1]; $y = $bek[$i]
      $esit = if ($y -ceq $kok -or ($veri -and $y -ceq $veri)) { YolEsit $x $y } else { $x -ceq $y }
      if (-not $esit) { $argOk = $false; break }
    }
  }
  if (-not $argOk) { $fark += "ImagePath '$($v.ImagePath)' (beklenen $ikili $($bek -join ' '))" }
  if (-not ([int]$v.Start -eq 2 -and [int]$v.DelayedAutostart -eq 1)) { $fark += "baslama Start=$($v.Start) DelayedAutostart=$($v.DelayedAutostart) (beklenen 2/1)" }
  $fa = [byte[]]$v.FailureActions
  $eylem = @()
  if ($fa -and $fa.Length -ge 20) {
    $adet = [BitConverter]::ToUInt32($fa, 12)
    for ($i = 0; $i -lt $adet -and (20 + 8 * $i + 8) -le $fa.Length; $i++) {
      $eylem += "$([BitConverter]::ToUInt32($fa, 20 + 8 * $i))/$([BitConverter]::ToUInt32($fa, 24 + 8 * $i))"
    }
    $sifirla = [BitConverter]::ToUInt32($fa, 0)
  } else { $sifirla = -1 }
  if (-not ($sifirla -eq 86400 -and ($eylem -join ",") -ceq "1/10000,1/30000,1/60000")) {
    $fark += "kurtarma eylemleri '$($eylem -join ',')' sifirlama $sifirla (beklenen 1/10000,1/30000,1/60000 ve 86400)"
  }
  if ([int]$v.FailureActionsOnNonCrashFailures -ne 1) { $fark += "FailureActionsOnNonCrashFailures=$($v.FailureActionsOnNonCrashFailures) (beklenen 1)" }
  $dep = @($v.DependOnService | Where-Object { $_ })
  if ($dep.Count) { $fark += "bagimlilik '$($dep -join ', ')' (beklenen yok)" }
  return ,$fark
}

# ayar.json: yonetilen alanlar (guncellemeSunucusu + backendHizmeti + verildiyse vekil) istenen degerde mi.
# Dondurur: @{ Durum = "YOK" | "BICIMSIZ" | "UYUMLU" | "FARKLI"; Fark = @(...); Nesne = <ozellikler> }
function AyarOlc($yol) {
  if (-not (Test-Path -LiteralPath $yol)) { return @{ Durum = "YOK"; Fark = @(); Nesne = $null } }
  if (ReparseMi $yol) { return @{ Durum = "BICIMSIZ"; Fark = @("ayar.json bir baglanti"); Nesne = $null } }
  # Bayt olarak okunur: ReadAllText BOM'u sessizce atar, guncelleyici (serde) ise BOM'lu dosyayi REDDEDER.
  $bayt = [System.IO.File]::ReadAllBytes($yol)
  $bom = ($bayt.Length -ge 3 -and $bayt[0] -eq 0xEF -and $bayt[1] -eq 0xBB -and $bayt[2] -eq 0xBF)
  $bas = if ($bom) { 3 } else { 0 }
  $metin = (New-Object System.Text.UTF8Encoding $false).GetString($bayt, $bas, $bayt.Length - $bas)
  try { $j = $metin | ConvertFrom-Json } catch { return @{ Durum = "BICIMSIZ"; Fark = @("ayar.json JSON degil"); Nesne = $null } }
  if ($j -isnot [System.Management.Automation.PSCustomObject]) { return @{ Durum = "BICIMSIZ"; Fark = @("ayar.json nesne degil"); Nesne = $null } }
  $fark = @()
  if ($bom) { $fark += "BOM (guncelleyici okuyamaz)" }
  $ad = @($j.PSObject.Properties.Name)
  if (-not ($ad -ccontains "guncellemeSunucusu") -or [string]$j.guncellemeSunucusu -cne $GuncellemeSunucusu) { $fark += "guncellemeSunucusu" }
  $bh = if ($ad -ccontains "backendHizmeti") { [string]$j.backendHizmeti } else { $null }
  if ($BackendHizmeti -ceq $VARSAYILAN_BACKEND) { if ($bh -and $bh -cne $VARSAYILAN_BACKEND) { $fark += "backendHizmeti" } }
  elseif ($bh -cne $BackendHizmeti) { $fark += "backendHizmeti" }
  if ($Vekil -and (-not ($ad -ccontains "vekil") -or [string]$j.vekil -cne $Vekil)) { $fark += "vekil" }
  return @{ Durum = $(if ($fark.Count) { "FARKLI" } else { "UYUMLU" }); Fark = $fark; Nesne = $j }
}

function AyarYaz($yol, $mevcut) {
  $n = [ordered]@{}
  if ($mevcut) { foreach ($p in $mevcut.PSObject.Properties) { $n[$p.Name] = $p.Value } }
  if (-not $n.Contains("v")) { $n["v"] = 1 }
  $n["guncellemeSunucusu"] = $GuncellemeSunucusu
  if ($BackendHizmeti -ceq $VARSAYILAN_BACKEND) { if ($n.Contains("backendHizmeti")) { $n.Remove("backendHizmeti") } }
  else { $n["backendHizmeti"] = $BackendHizmeti }
  if ($Vekil) { $n["vekil"] = $Vekil }
  $gecici = "$yol.yaziliyor"
  [System.IO.File]::WriteAllText($gecici, (($n | ConvertTo-Json -Depth 5) + "`n"), (New-Object System.Text.UTF8Encoding $false))
  Move-Item -LiteralPath $gecici -Destination $yol -Force
}

# Native komut (guncelleyici ikilisi): cikis kodu okunur, stderr YONLENDIRILMEZ.
function IkiliKos {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arg)
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try   { & $hedefIkili @Arg | ForEach-Object { Write-Host "     $_" } }
  finally { $ErrorActionPreference = $eskiEAP }
  return $LASTEXITCODE
}

# --- Guvenlik kapilari ------------------------------------------------------------
$admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Dur "YONETICI PowerShell gerekir (hizmet kaydi)." }
foreach ($a in @($HizmetAdi, $BackendHizmeti)) {
  if ($a -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { Dur "gecersiz hizmet adi: $a" }
}
if ($GuncellemeSunucusu -cnotmatch '^https://[A-Za-z0-9.-]{1,180}(:[0-9]{1,5})?$') { Dur "-GuncellemeSunucusu yalniz https://<ana-makine>[:port] olmali: $GuncellemeSunucusu" }
if ($Vekil -and $Vekil -cnotmatch '^http://[A-Za-z0-9.-]{1,180}:[0-9]{1,5}$') { Dur "-Vekil http://<ana-makine>:<port> olmali: $Vekil" }
if (-not [System.IO.Path]::IsPathRooted($Kok) -or $Kok.Length -lt 4) { Dur "kok mutlak bir alt dizin olmali: $Kok" }
$kokTam = [System.IO.Path]::GetFullPath($Kok).TrimEnd('\')
if ((Test-Path -LiteralPath $kokTam) -and (ReparseMi $kokTam)) { Dur "kok bir baglanti noktasi (junction): $kokTam" }
if ($VeriDizini) {
  if (-not [System.IO.Path]::IsPathRooted($VeriDizini)) { Dur "-VeriDizini mutlak olmali: $VeriDizini" }
  $VeriDizini = [System.IO.Path]::GetFullPath($VeriDizini).TrimEnd('\')
}
$dizin = Join-Path $kokTam "guncelleyici"
$hedefIkili = Join-Path $dizin "tekserp-guncelleyici.exe"
$kaynakIkili = Join-Path (Join-Path (Join-Path $kokTam "current") "runtime") "tekserp-guncelleyici.exe"
$ayarYolu = Join-Path $dizin "ayar.json"
$backendSid = HizmetSid $BackendHizmeti

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP guncelleyici hizmeti - $(if ($Uygula) { 'UYGULA' } else { 'OLCUM (degisiklik yok)' })"
Write-Host "================================================================"
Write-Host "  Kok      : $kokTam"
Write-Host "  Hizmet   : $HizmetAdi (LocalSystem)"
Write-Host "  Backend  : $BackendHizmeti"
Write-Host "  Veri     : $(if ($VeriDizini) { $VeriDizini } else { '%ProgramData%\TeksERP (varsayilan)' })"
Write-Host "  Sunucu   : $GuncellemeSunucusu$(if ($Vekil) { '  (vekil ' + $Vekil + ')' })"

if ($Uygula) {
  Write-Host ""
  Write-Host "[1/4] Guncelleyici dizini (korumali)..." -ForegroundColor Cyan
  if (-not (Test-Path -LiteralPath $dizin)) { New-Item -ItemType Directory -Path $dizin -Force | Out-Null; Ok "olusturuldu: $dizin" }
  if (ReparseMi $dizin) { Dur "guncelleyici dizini bir baglanti (junction) - SYSTEM'in ikilisi oraya konmaz: $dizin" }
  KorumaliYaz $dizin $backendSid

  Write-Host ""
  Write-Host "[2/4] Ikili..." -ForegroundColor Cyan
  if (-not (Test-Path -LiteralPath $kaynakIkili)) { Dur "surumun guncelleyici ikilisi yok: $kaynakIkili (paket runtime\ tasimali)" }
  if (-not (MzMi $kaynakIkili)) { Dur "surumun guncelleyici ikilisi Windows ikilisi degil (MZ yok): $kaynakIkili" }
  $kaynakOzet = Ozet $kaynakIkili
  $hedefOzet = Ozet $hedefIkili
  if ($hedefOzet -ceq $kaynakOzet) { Ok "ikili zaten ayni - kopyalanmadi" }
  else {
    $svc = Get-Service -Name $HizmetAdi -ErrorAction SilentlyContinue
    if ($hedefOzet -and $svc -and "$($svc.Status)" -cne "Stopped") { Dur "guncelleyici CALISIYOR ve ikilisi surumunkinden farkli - kendini guncelleme alanina dokunulmaz (durdurup tekrar kosun)." }
    Copy-Item -LiteralPath $kaynakIkili -Destination $hedefIkili -Force
    if ((Ozet $hedefIkili) -cne $kaynakOzet) { Dur "ikili kopyasi dogrulanamadi: $hedefIkili" }
    Ok "kopyalandi: $hedefIkili"
  }

  Write-Host ""
  Write-Host "[3/4] ayar.json..." -ForegroundColor Cyan
  $a = AyarOlc $ayarYolu
  if ($a.Durum -ceq "BICIMSIZ") { Dur "$($a.Fark -join '; ') - elle duzeltin ya da silin: $ayarYolu" }
  if ($a.Durum -ceq "UYUMLU") { Ok "ayar.json zaten uyumlu" }
  else {
    AyarYaz $ayarYolu $a.Nesne
    Ok "ayar.json $(if ($a.Durum -ceq 'YOK') { 'yazildi' } else { 'duzeltildi: ' + ($a.Fark -join ', ') })"
  }

  Write-Host ""
  Write-Host "[4/4] Hizmet kaydi (hizmet-kur - tek kaynak)..." -ForegroundColor Cyan
  $fark = HizmetFarki $HizmetAdi $hedefIkili $kokTam $VeriDizini
  if ($null -ne $fark -and $fark.Count -eq 0) { Ok "kayit zaten uyumlu - yeniden kaydedilmedi: $HizmetAdi" }
  else {
    if ($null -ne $fark) { foreach ($f in $fark) { Bilgi "kayit farki: $f" } }
    $kurArg = @("hizmet-kur", "--kok", $kokTam)
    if ($VeriDizini) { $kurArg += @("--veri", $VeriDizini) }
    $kurArg += @("--ad", $HizmetAdi)
    $kod = IkiliKos @kurArg
    if ($kod -ne 0) { Dur "hizmet-kur basarisiz (cikis $kod)." }
    Ok "kaydedildi: $HizmetAdi"
  }
  $script:uyumsuz = 0
}

Write-Host ""
Write-Host "OLCUM" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $dizin)) { Uyar "dizin yok: $dizin" }
elseif (ReparseMi $dizin) { Uyar "dizin bir baglanti (junction): $dizin" }
else {
  $acl = Get-Acl -LiteralPath $dizin
  $g = GenisAce $dizin
  $b = Erisim $dizin @($backendSid)
  if ($acl.AreAccessRulesProtected -and $g.Count -eq 0 -and -not $b.Okur -and -not $b.Yazar) { Ok "korumali: $dizin (backend erisemez)" }
  else { Uyar "korumali DEGIL: $dizin (miras kesik=$($acl.AreAccessRulesProtected); genis ACE: $($g -join ', '); backend okur=$($b.Okur) yazar=$($b.Yazar))" }
}
if (-not (Test-Path -LiteralPath $hedefIkili)) { Uyar "ikili yok: $hedefIkili" }
elseif (-not (MzMi $hedefIkili)) { Uyar "ikili Windows ikilisi degil (MZ yok): $hedefIkili" }
elseif ((Ozet $hedefIkili) -ceq (Ozet $kaynakIkili)) { Ok "ikili = surumunki ($hedefIkili)" }
else { Bilgi "ikili surumunkinden farkli - guncelleyici kendini guncellemis olabilir (GUNCELLEYICI.md 10)" }
$a = AyarOlc $ayarYolu
if ($a.Durum -ceq "UYUMLU") { Ok "ayar.json uyumlu" } else { Uyar "ayar.json $($a.Durum)$(if ($a.Fark.Count) { ': ' + ($a.Fark -join ', ') })" }
$fark = HizmetFarki $HizmetAdi $hedefIkili $kokTam $VeriDizini
if ($null -eq $fark) { Uyar "hizmet kayitli degil: $HizmetAdi" }
elseif ($fark.Count -eq 0) { Ok "hizmet kaydi uyumlu: $HizmetAdi (LocalSystem, gecikmeli otomatik, kurtarma 10/30/60 sn)" }
else { foreach ($f in $fark) { Uyar "hizmet: $f" } }

Write-Host ""
if ($script:uyumsuz -eq 0) { Write-Host "  UYUMLU" -ForegroundColor Green; exit 0 }
Write-Host "  UYUMSUZ ($($script:uyumsuz) madde)$(if (-not $Uygula) { ' - uygulamak icin: -Uygula' })" -ForegroundColor Yellow
exit 2
