# =============================================================================
# TeksERP - BACKEND WINDOWS HIZMETI + EN AZ YETKI (dizin izinleri)
# =============================================================================
# NE ZAMAN KOSAR: kurulumda (setup) ve pm2 -> hizmet gecisinde BIR KEZ, YONETICI
#   PowerShell'de. Guncellemenin uygulama adiminda KOSMAZ: yeni surum dizini
#   (surumler\<surum>) izinleri ust dizinden MIRAS alir.
#     powershell -NoProfile -ExecutionPolicy Bypass -File backend-hizmeti.ps1 -Kok C:\TeksERP
#     (varsayilan: yalniz OLCER, hicbir seyi degistirmez; uygulamak icin -Uygula)
#
# NE YAPAR (-Uygula):
#   1. Dizin iskeleti + izinler. Hizmet hesabi NT SERVICE\<HizmetAdi> (parolasiz sanal
#      hesap). Program dizini (surumler, current, hizmet konagi) ve yapilandirma SALT
#      OKUNUR; lisans, backups, logs, veri YAZILABILIR; pg-setup ERISILEMEZ.
#      Users / Authenticated Users / Everyone her yonetilen dizinden cikar, miras kesilir.
#   2. Guncelleme kanali: <ProgramData>\TeksERP\guncelleme okunur (durum.json),
#      guncelleme\niyet yazilir (niyet.json). ProgramData\TeksERP'e hesap giremez.
#   3. Hizmet kaydi (konak ikilisi varsa): sanal hesap, SID turu unrestricted, en az
#      ayricalik (SeImpersonate YOK), gecikmeli otomatik baslama, cokunce SCM yeniden
#      baslatir (5 sn, 5 sn, 30 sn; gun sonu sifir), istege bagli PG bagimliligi.
#   Hizmeti BASLATMAZ/DURDURMAZ - cagiran yapar.
#
# DIZIN ADLARI: Teks-Erp/src/lib/hizmet-duzeni.ts SERVICE_DIRS ile AYNI (bekci:
#   test_hizmet_duzeni). Ad degisirse iki taraf birlikte degisir.
#
# CIKIS: 0 uyumlu | 2 uyumsuz (olcum ya da uygulama sonrasi) | 1 hata/ret.
# ASCII: PS 5.1 BOM'suz UTF-8'i ANSI okur; bu dosya bilerek yalniz ASCII tasir.
# =============================================================================
[CmdletBinding()]
param(
  [string]$Kok = "C:\TeksERP",
  [string]$HizmetAdi = "TeksERP-Backend",
  # Hizmet konagi (D2 ikilisi). Yoksa hizmet kaydi atlanir, izinler yine uygulanir.
  [string]$KonakYolu,
  [string]$KonakArgumanlari,
  [string]$GuncellemeDizini,
  # Kendi PostgreSQL hizmeti (varsa) - backend ondan sonra kalkar.
  [string]$PgHizmeti,
  # SeImpersonatePrivilege bilerek YOK: sanal hesabin varsayilan jetonundan duser.
  [string[]]$Ayricaliklar = @("SeChangeNotifyPrivilege", "SeCreateGlobalPrivilege"),
  [switch]$Uygula
)
$ErrorActionPreference = "Stop"

function Ok($m)    { Write-Host "  OK $m" -ForegroundColor Green }
function Uyar($m)  { Write-Host "  !  $m" -ForegroundColor Yellow; $script:uyumsuz++ }
function Bilgi($m) { Write-Host "  .  $m" -ForegroundColor DarkGray }
function Dur($m)   { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; exit 1 }
$script:uyumsuz = 0

# --- Dizin tablosu (hizmet-duzeni.ts SERVICE_DIRS) -------------------------
# Sinif: oku = RX | sir = R (yalniz okur) | yaz = M | yasak = hesap giremez.
$DIZINLER = @(
  @{ Ad = "surumler";         Sinif = "oku"   },
  @{ Ad = "hizmet";           Sinif = "oku"   },
  @{ Ad = "yapilandirma";     Sinif = "sir"   },
  @{ Ad = "lisans";           Sinif = "yaz"   },
  @{ Ad = "backups";          Sinif = "yaz"   },
  @{ Ad = "yedek-anahtar";    Sinif = "sir"   },
  @{ Ad = "logs";             Sinif = "yaz"   },
  @{ Ad = "veri";             Sinif = "yaz"   },
  @{ Ad = "mobil-guncelleme"; Sinif = "oku"   },
  @{ Ad = "rclone";           Sinif = "oku"   },
  @{ Ad = "pg-setup";         Sinif = "yasak" }
)
# Baglanti noktalari (junction): izinleri koke aittir, betik onlara DOKUNMAZ.
$BAGLANTILAR = @("current", "pgsql")
$HAK = @{ oku = "RX"; sir = "R"; yaz = "M" }

$SID_SYSTEM = "S-1-5-18"
$SID_ADMIN  = "S-1-5-32-544"
# Her yonetilen dizinden cikan genis gruplar (Users, Authenticated Users, Everyone).
$GENIS = @("S-1-5-32-545", "S-1-5-11", "S-1-1-0")
# Hizmet jetonunun tasiyabilecegi gruplar: etkin erisim bunlarin birlesimiyle olculur.
$JETON_GRUPLARI = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545", "S-1-5-6", "S-1-2-0", "S-1-5-80-0", "S-1-5-15")

# Sanal hesabin SID'i hizmet adindan turer (S-1-5-80 + SHA-1(BUYUK HARF ad, UTF-16LE)):
# hizmet henuz yokken de izin yazilabilir. Ayni algoritma bekcide TrustedInstaller ile olculur.
function HizmetSid([string]$ad) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $h = $sha.ComputeHash([System.Text.Encoding]::Unicode.GetBytes($ad.ToUpperInvariant()))
  $p = @()
  for ($i = 0; $i -lt 5; $i++) { $p += [string][BitConverter]::ToUInt32($h, $i * 4) }
  return "S-1-5-80-" + ($p -join "-")
}

# Etkin erisim (ACE birlesimi, reddetme dusulur): okur / yazar. Miras-yalniz ACE nesnenin kendisine uygulanmaz.
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

# Genis gruplara izin veren ACE'ler (ad ya da SID).
function GenisAce($yol) {
  $bulunan = @()
  foreach ($k in (Get-Acl -LiteralPath $yol).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($GENIS -contains $k.IdentityReference.Value -and "$($k.AccessControlType)" -ceq "Allow") { $bulunan += $k.IdentityReference.Value }
  }
  return ,$bulunan
}

function ReparseMi($yol) {
  return ((Get-Item -LiteralPath $yol -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
}

# Dizin izni: miras kesilir, SYSTEM + Administrators tam, hizmet hesabi sinifinin hakki; genis gruplar silinir.
function IzinYaz($yol, $sinif, $sid) {
  $icArg = @($yol, "/inheritance:r", "/grant:r", "*$($SID_SYSTEM):(OI)(CI)F", "*$($SID_ADMIN):(OI)(CI)F")
  $kaldir = @($GENIS)
  if ($HAK.ContainsKey($sinif)) { $icArg += "*$($sid):(OI)(CI)$($HAK[$sinif])" } else { $kaldir += $sid }
  $icArg += @("/remove:g") + @($kaldir | ForEach-Object { "*$_" })
  & icacls.exe @icArg | Out-Null
  if ($LASTEXITCODE -ne 0) { Uyar "izin yazilamadi (icacls $LASTEXITCODE): $yol"; return }
  # Sahibi SYSTEM/Administrators degilse (onceden baskasinin actigi dizin) sahiplik alinir.
  $sahip = (Get-Acl -LiteralPath $yol).GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($sahip -cne $SID_SYSTEM -and $sahip -cne $SID_ADMIN) {
    & icacls.exe $yol /setowner "*$SID_ADMIN" | Out-Null
    if ($LASTEXITCODE -ne 0) { Uyar "sahiplik alinamadi (icacls $LASTEXITCODE): $yol" }
  }
}

# Beklenen erisim: sinif -> (okur, yazar).
function Beklenen($sinif) {
  switch ($sinif) {
    "kok"   { return @($true, $false) }
    "oku"   { return @($true, $false) }
    "sir"   { return @($true, $false) }
    "yaz"   { return @($true, $true) }
    default { return @($false, $false) }
  }
}

function DizinOlc($yol, $sinif, $jeton) {
  if (-not (Test-Path -LiteralPath $yol)) { Uyar "dizin yok: $yol"; return }
  if (ReparseMi $yol) { Uyar "dizin bir baglanti noktasi (junction) - izin olculmedi: $yol"; return }
  $e = Erisim $yol $jeton
  $b = Beklenen $sinif
  $g = GenisAce $yol
  $ok = ($e.Okur -eq $b[0]) -and ($e.Yazar -eq $b[1]) -and ($g.Count -eq 0)
  $metin = "okur=$($e.Okur) yazar=$($e.Yazar) (beklenen okur=$($b[0]) yazar=$($b[1]))"
  if ($ok) { Ok "$sinif  $yol  $metin" }
  else { Uyar "$sinif  $yol  $metin$(if ($g.Count) { ' | genis ACE: ' + ($g -join ', ') })" }
}

function DosyaOlc($yol, $okurMu, $yazarMi, $jeton) {
  if (-not (Test-Path -LiteralPath $yol)) { Bilgi "dosya yok (olculmedi): $yol"; return }
  $e = Erisim $yol $jeton
  if ($e.Okur -eq $okurMu -and $e.Yazar -eq $yazarMi) { Ok "dosya  $yol  okur=$($e.Okur) yazar=$($e.Yazar)" }
  else { Uyar "dosya  $yol  okur=$($e.Okur) yazar=$($e.Yazar) (beklenen okur=$okurMu yazar=$yazarMi)" }
}

# --- Hizmet kaydi: kayit defterinden okunur (sc.exe ciktisi yerellestirilmis) -------
function HizmetOlc($ad, $hesap, $imagePath) {
  $k = "HKLM:\SYSTEM\CurrentControlSet\Services\$ad"
  if (-not (Test-Path $k)) { Uyar "hizmet kayitli degil: $ad"; return }
  $v = Get-ItemProperty -Path $k
  if ([string]$v.ObjectName -ceq $hesap) { Ok "hesap: $hesap" } else { Uyar "hesap '$($v.ObjectName)' (beklenen '$hesap')" }
  if ($imagePath -and [string]$v.ImagePath -cne $imagePath) { Uyar "ImagePath '$($v.ImagePath)' (beklenen '$imagePath')" }
  if ([int]$v.ServiceSidType -eq 1) { Ok "SID turu: unrestricted" } else { Uyar "SID turu $($v.ServiceSidType) (beklenen 1 = unrestricted)" }
  $priv = @($v.RequiredPrivileges | Where-Object { $_ }) | Sort-Object
  $bek = @($Ayricaliklar) | Sort-Object
  if (($priv -join ",") -ceq ($bek -join ",")) { Ok "ayricaliklar: $($priv -join ', ')" }
  else { Uyar "ayricaliklar '$($priv -join ', ')' (beklenen '$($bek -join ', ')')" }
  if ([int]$v.Start -eq 2 -and [int]$v.DelayedAutostart -eq 1) { Ok "baslama: gecikmeli otomatik" }
  else { Uyar "baslama Start=$($v.Start) DelayedAutostart=$($v.DelayedAutostart) (beklenen 2/1)" }
  $fa = [byte[]]$v.FailureActions
  $eylem = @()
  if ($fa -and $fa.Length -ge 20) {
    $adet = [BitConverter]::ToUInt32($fa, 12)
    for ($i = 0; $i -lt $adet -and (20 + 8 * $i + 8) -le $fa.Length; $i++) {
      $eylem += "$([BitConverter]::ToUInt32($fa, 20 + 8 * $i))/$([BitConverter]::ToUInt32($fa, 24 + 8 * $i))"
    }
    $sifirla = [BitConverter]::ToUInt32($fa, 0)
  } else { $sifirla = -1 }
  if ($sifirla -eq 86400 -and ($eylem -join ",") -ceq "1/5000,1/5000,1/30000") { Ok "kurtarma: yeniden baslat 5 sn, 5 sn, 30 sn (gun sonu sifir)" }
  else { Uyar "kurtarma eylemleri '$($eylem -join ',')' sifirlama $sifirla (beklenen 1/5000,1/5000,1/30000 ve 86400)" }
  if ([int]$v.FailureActionsOnNonCrashFailures -eq 1) { Ok "kurtarma sifir-disi cikista da" }
  else { Uyar "FailureActionsOnNonCrashFailures=$($v.FailureActionsOnNonCrashFailures) (beklenen 1 - konak node dusunce sifir-disi kodla cikar)" }
  if ($PgHizmeti) {
    $dep = @($v.DependOnService)
    if ($dep -contains $PgHizmeti) { Ok "bagimlilik: $PgHizmeti" } else { Uyar "bagimlilik yok: $PgHizmeti" }
  }
}

# Native komut: cikis kodu okunur, stderr YONLENDIRILMEZ (ekrana duser, zararsiz).
function ScKos {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arg)
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try   { & sc.exe @Arg | Out-Null }
  finally { $ErrorActionPreference = $eskiEAP }
  return $LASTEXITCODE
}

function HizmetKur($ad, $hesap, $imagePath) {
  $svc = Get-Service -Name $ad -ErrorAction SilentlyContinue
  if (-not $svc) {
    New-Service -Name $ad -BinaryPathName $imagePath -DisplayName "TeksERP Backend" -StartupType Automatic `
      -Description "TeksERP backend (Node) - hizmet konagi; dusuk yetkili sanal hesap" | Out-Null
    Ok "hizmet olusturuldu: $ad"
  }
  # Hesap + ImagePath WMI ile (sc.exe'nin tirnak kacisi PS 5.1'de bozulur).
  $w = Get-CimInstance Win32_Service -Filter "Name='$ad'"
  $r = Invoke-CimMethod -InputObject $w -MethodName Change -Arguments @{ PathName = $imagePath; StartName = $hesap; StartPassword = "" }
  if ([int]$r.ReturnValue -ne 0) { Uyar "hizmet hesabi/yolu yazilamadi (Win32_Service.Change $($r.ReturnValue))" }
  $kodlar = [ordered]@{
    "start"       = (ScKos config $ad start= delayed-auto)
    "sidtype"     = (ScKos sidtype $ad unrestricted)
    "privs"       = (ScKos privs $ad ($Ayricaliklar -join "/"))
    "failure"     = (ScKos failure $ad reset= 86400 actions= restart/5000/restart/5000/restart/30000)
    "failureflag" = (ScKos failureflag $ad 1)
  }
  if ($PgHizmeti) { $kodlar["depend"] = (ScKos config $ad depend= $PgHizmeti) }
  $dusen = @($kodlar.Keys | Where-Object { $kodlar[$_] -ne 0 })
  if ($dusen.Count) { foreach ($d in $dusen) { Uyar "sc.exe $d yazilamadi (kod $($kodlar[$d]))" } }
  else { Ok "hizmet ayarlari yazildi ($($kodlar.Keys -join ', '))" }
}

# --- Guvenlik kapilari ------------------------------------------------------------
$admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Dur "YONETICI PowerShell gerekir (izin ve hizmet kaydi)." }
if ($HizmetAdi -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { Dur "gecersiz hizmet adi: $HizmetAdi" }
if (-not [System.IO.Path]::IsPathRooted($Kok) -or $Kok.Length -lt 4) { Dur "kok mutlak bir alt dizin olmali: $Kok" }
$kokTam = [System.IO.Path]::GetFullPath($Kok).TrimEnd('\')
$yasakKok = @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData, "$env:SystemDrive\Users") |
  Where-Object { $_ } | ForEach-Object { [System.IO.Path]::GetFullPath($_).TrimEnd('\') }
foreach ($y in $yasakKok) {
  if ([string]::Equals($kokTam, $y, [System.StringComparison]::OrdinalIgnoreCase)) { Dur "kok bir sistem dizini olamaz: $kokTam" }
}
if ((Test-Path -LiteralPath $kokTam) -and (ReparseMi $kokTam)) { Dur "kok bir baglanti noktasi (junction) - izinler hedefi degistirirdi: $kokTam" }

$sid = HizmetSid $HizmetAdi
$hesap = "NT SERVICE\$HizmetAdi"
$jeton = @($sid) + $JETON_GRUPLARI
if (-not $KonakYolu) { $KonakYolu = Join-Path $kokTam "hizmet\tekserp-hizmet.exe" }
if (-not $KonakArgumanlari) { $KonakArgumanlari = "--kok `"$kokTam`"" }
$imagePath = "`"$KonakYolu`" $KonakArgumanlari"
if (-not $GuncellemeDizini) { $GuncellemeDizini = Join-Path (Join-Path $env:ProgramData "TeksERP") "guncelleme" }
$programData = Split-Path $GuncellemeDizini -Parent

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP backend hizmeti - $(if ($Uygula) { 'UYGULA' } else { 'OLCUM (degisiklik yok)' })"
Write-Host "================================================================"
Write-Host "  Kok     : $kokTam"
Write-Host "  Hizmet  : $HizmetAdi  ($hesap, $sid)"
Write-Host "  Konak   : $imagePath"
Write-Host "  Kanal   : $GuncellemeDizini"

if ($Uygula) {
  Write-Host ""
  Write-Host "[1/3] Dizinler ve izinler..." -ForegroundColor Cyan
  if (-not (Test-Path -LiteralPath $kokTam)) { New-Item -ItemType Directory -Path $kokTam -Force | Out-Null; Ok "olusturuldu: $kokTam" }
  IzinYaz $kokTam "oku" $sid
  foreach ($d in $DIZINLER) {
    $yol = Join-Path $kokTam $d.Ad
    if (-not (Test-Path -LiteralPath $yol)) { New-Item -ItemType Directory -Path $yol -Force | Out-Null; Ok "olusturuldu: $yol" }
    if (ReparseMi $yol) { Uyar "baglanti noktasi - izin DEGISTIRILMEDI: $yol"; continue }
    IzinYaz $yol $d.Sinif $sid
  }
  # Eski kurulumun daralttigi (miras kesik) sir dosyalari yeni dizinin mirasina doner.
  foreach ($f in @("yapilandirma\.env", "veri\rclone.conf")) {
    $yol = Join-Path $kokTam $f
    if ((Test-Path -LiteralPath $yol) -and -not (ReparseMi $yol)) {
      & icacls.exe $yol /reset | Out-Null
      if ($LASTEXITCODE -ne 0) { Uyar "miras geri konamadi (icacls $LASTEXITCODE): $yol" }
    }
  }
  Write-Host ""
  Write-Host "[2/3] Guncelleme kanali..." -ForegroundColor Cyan
  foreach ($d in @($programData, $GuncellemeDizini, (Join-Path $GuncellemeDizini "niyet"))) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null; Ok "olusturuldu: $d" }
    if (ReparseMi $d) { Dur "baglanti noktasi - SYSTEM'in yazdigi yol ele gecirilmis olabilir: $d" }
  }
  IzinYaz $programData "yasak" $sid
  IzinYaz $GuncellemeDizini "oku" $sid
  IzinYaz (Join-Path $GuncellemeDizini "niyet") "yaz" $sid
  Write-Host ""
  Write-Host "[3/3] Hizmet kaydi..." -ForegroundColor Cyan
  if (Test-Path -LiteralPath $KonakYolu) { HizmetKur $HizmetAdi $hesap $imagePath }
  else { Bilgi "konak ikilisi yok ($KonakYolu) - hizmet kaydi ATLANDI (izinler hazir)" }
  $script:uyumsuz = 0
}

Write-Host ""
Write-Host "OLCUM (hizmet hesabinin etkin erisimi: $($jeton.Count) SID)" -ForegroundColor Cyan
DizinOlc $kokTam "kok" $jeton
foreach ($d in $DIZINLER) { DizinOlc (Join-Path $kokTam $d.Ad) $d.Sinif $jeton }
foreach ($b in $BAGLANTILAR) {
  $yol = Join-Path $kokTam $b
  if (Test-Path -LiteralPath $yol) { Bilgi "baglanti $yol - hedef: $((Get-Item -LiteralPath $yol -Force).Target)" }
}
DosyaOlc (Join-Path $kokTam "yapilandirma\.env") $true $false $jeton
DosyaOlc (Join-Path $kokTam "pg-setup\db-credentials.json") $false $false $jeton
DosyaOlc (Join-Path $kokTam "current\dist\server.js") $true $false $jeton
DizinOlc $programData "yasak" $jeton
DizinOlc $GuncellemeDizini "oku" $jeton
DizinOlc (Join-Path $GuncellemeDizini "niyet") "yaz" $jeton
DosyaOlc (Join-Path $GuncellemeDizini "durum.json") $true $false $jeton
if (Test-Path -LiteralPath $KonakYolu) { HizmetOlc $HizmetAdi $hesap $imagePath }
else { Bilgi "konak ikilisi yok ($KonakYolu) - hizmet kaydi olculmedi" }

Write-Host ""
if ($script:uyumsuz -eq 0) { Write-Host "  UYUMLU" -ForegroundColor Green; exit 0 }
Write-Host "  UYUMSUZ ($($script:uyumsuz) madde)$(if (-not $Uygula) { ' - uygulamak icin: -Uygula' })" -ForegroundColor Yellow
exit 2
