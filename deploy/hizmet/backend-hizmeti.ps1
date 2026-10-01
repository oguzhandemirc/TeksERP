# =============================================================================
# TeksERP - BACKEND WINDOWS HIZMETI + EN AZ YETKI (kayit + dizin izinleri)
# =============================================================================
# NE ZAMAN KOSAR: kurulumda (setup, D5) ve pm2 -> hizmet gecisinde (deploy\gecis\gecis.ps1, D6)
#   BIR KEZ, YONETICI PowerShell'de. Guncellemenin uygulama adiminda KOSMAZ: yeni surum dizini
#   (surumler\<surum>) izinleri ust dizinden MIRAS alir. Backend hizmetinin kaydi ve izinleri
#   YALNIZ bu betikte yazilir (setup ve gecis ayni betigi cagirir).
#     powershell -NoProfile -ExecutionPolicy Bypass -File backend-hizmeti.ps1 -Kok C:\TeksERP
#     (varsayilan: yalniz OLCER, hicbir seyi degistirmez; uygulamak icin -Uygula)
#
# IMZA (D5 ile sabit; degisirse once yoneticiye yazilir):
#   -Kok <mutlak> [-HizmetAdi <ad>] [-PgHizmeti <ad> | -PgYok] [-GuncellemeDizini <mutlak>]
#   [-KonakYolu <yol>] [-YalnizIskelet] [-Uygula]
#
# NE YAPAR (-Uygula), SIRA BAGLAYICI (GUNCELLEYICI.md 4.2 - sanal hesap ANCAK kayitla dogar,
# kayittan ONCE verilen izin icacls 1332 ile duser):
#   [1/4] Dizin iskeleti + korumali izin YALNIZ iyi bilinen SID'lerle (SYSTEM + Administrators;
#         Users / Authenticated Users / Everyone cikar, miras kesilir). Sanal hesap YOK.
#   [2/4] Hizmet kaydi: kayit olculur; yoksa ya da uyumsuzsa konagin KENDI alt komutu
#         `tekserp-hizmet.exe hizmet-kur --kok <Kok> --ad <ad> [--pg-hizmeti <ad> | --pg-yok]`
#         (tek kaynak: hesap NT SERVICE\<ad>, SID turu, en az ayricalik, gecikmeli otomatik,
#         kurtarma eylemleri, olay kaynagi). Uyumluysa tekrar kaydedilmez (idempotent).
#   [3/4] Izinler sanal hesapla (kayittan SONRA): program dizini ve yapilandirma SALT OKUNUR;
#         lisans, backups, logs, veri YAZILABILIR; pg-setup ve guncelleyici ERISILEMEZ.
#         Guncelleme kanali: guncelleme\ ve guncelleme\durum\ okunur, guncelleme\niyet\ yazilir,
#         guncelleme\is\ (guncelleyicinin ozel alani) ve ust ProgramData\TeksERP ERISILEMEZ.
#   [4/4] Olcum.
#   -YalnizIskelet: yalniz [1/4] - SIR YAZMADAN ONCE cagrilir (.env, db-credentials.json);
#         konak gerekmez, kayit yapilmaz.
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
  # PostgreSQL bagimliligi: kendi ornekte TeksERP-PostgreSQL, harici PG'de o hizmetin adi.
  # Ikisi de verilmezse hizmet-kur varsayilani (TeksERP-PostgreSQL varsa ona bagli).
  [string]$PgHizmeti,
  [switch]$PgYok,
  [string]$GuncellemeDizini,
  # Konak ikilisi (surumle birlikte imzali gelir). Varsayilan <Kok>\current\runtime\tekserp-hizmet.exe.
  [string]$KonakYolu,
  [switch]$YalnizIskelet,
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
  @{ Ad = "yapilandirma";     Sinif = "sir"   },
  @{ Ad = "lisans";           Sinif = "yaz"   },
  @{ Ad = "backups";          Sinif = "yaz"   },
  @{ Ad = "yedek-anahtar";    Sinif = "sir"   },
  @{ Ad = "logs";             Sinif = "yaz"   },
  @{ Ad = "veri";             Sinif = "yaz"   },
  @{ Ad = "mobil-guncelleme"; Sinif = "oku"   },
  @{ Ad = "rclone";           Sinif = "oku"   },
  @{ Ad = "pg-setup";         Sinif = "yasak" },
  @{ Ad = "guncelleyici";     Sinif = "yasak" }
)
# Baglanti noktalari (junction) ve PG dizinleri: izinleri koke/D4'e aittir, betik onlara DOKUNMAZ.
$BAGLANTILAR = @("current", "pgsql")
$HAK = @{ oku = "RX"; sir = "R"; yaz = "M" }
# SeImpersonatePrivilege bilerek YOK: sanal hesabin varsayilan jetonundan duser. Kaydi hizmet-kur yazar
# (tekserp-hizmet contract.rs BACKEND_PRIVILEGES); burada yalniz OLCULUR.
$Ayricaliklar = @("SeChangeNotifyPrivilege", "SeCreateGlobalPrivilege")

$SID_SYSTEM = "S-1-5-18"
$SID_ADMIN  = "S-1-5-32-544"
# Her yonetilen dizinden cikan genis gruplar (Users, Authenticated Users, Everyone).
$GENIS = @("S-1-5-32-545", "S-1-5-11", "S-1-1-0")
# Hizmet jetonunun tasiyabilecegi gruplar: etkin erisim bunlarin birlesimiyle olculur.
$JETON_GRUPLARI = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545", "S-1-5-6", "S-1-2-0", "S-1-5-80-0", "S-1-5-15")

# Sanal hesabin SID'i hizmet adindan turer (S-1-5-80 + SHA-1(BUYUK HARF ad, UTF-16LE)): hizmet henuz
# yokken de OLCULEBILIR (izin ise ancak kayittan sonra yazilabilir). Bekci TrustedInstaller ile olcer.
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

# Dizin izni: miras kesilir, SYSTEM + Administrators tam, genis gruplar silinir. $sid verilirse hizmet
# hesabi sinifinin hakkini alir (yasak sinifta cikarilir); $sid YOKSA (iskelet, kayittan once) hizmet
# hesabina hic dokunulmaz - bu adimda icacls sanal hesabi cozemez.
function IzinYaz($yol, $sinif, $sid) {
  $icArg = @($yol, "/inheritance:r", "/grant:r", "*$($SID_SYSTEM):(OI)(CI)F", "*$($SID_ADMIN):(OI)(CI)F")
  $kaldir = @($GENIS)
  if ($sid) {
    if ($HAK.ContainsKey($sinif)) { $icArg += "*$($sid):(OI)(CI)$($HAK[$sinif])" } else { $kaldir += $sid }
  }
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

# Iskelet olcumu (kayittan once): genis grup yok ve miras kesik.
function IskeletOlc($yol) {
  if (-not (Test-Path -LiteralPath $yol)) { Uyar "dizin yok: $yol"; return }
  if (ReparseMi $yol) { Uyar "dizin bir baglanti noktasi (junction): $yol"; return }
  $acl = Get-Acl -LiteralPath $yol
  $g = GenisAce $yol
  if ($acl.AreAccessRulesProtected -and $g.Count -eq 0) { Ok "korumali  $yol" }
  else { Uyar "korumali DEGIL  $yol  (miras kesik=$($acl.AreAccessRulesProtected); genis ACE: $($g -join ', '))" }
}

function DosyaOlc($yol, $okurMu, $yazarMi, $jeton) {
  if (-not (Test-Path -LiteralPath $yol)) { Bilgi "dosya yok (olculmedi): $yol"; return }
  $e = Erisim $yol $jeton
  if ($e.Okur -eq $okurMu -and $e.Yazar -eq $yazarMi) { Ok "dosya  $yol  okur=$($e.Okur) yazar=$($e.Yazar)" }
  else { Uyar "dosya  $yol  okur=$($e.Okur) yazar=$($e.Yazar) (beklenen okur=$okurMu yazar=$yazarMi)" }
}

# Windows komut satiri (CommandLineToArgvW kurallari): tirnak, 2n / 2n+1 ters bolu. ImagePath'i
# kayit defterinden okuyup parcalamak icin (hizmet-kur yol bosluksuzsa tirnak KOYMAZ).
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

function YolEsit($a, $b) {
  if (-not $a -or -not $b) { return $false }
  return [string]::Equals(([string]$a).TrimEnd('\'), ([string]$b).TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
}

# --- Hizmet kaydi: kayit defterinden okunur (sc.exe ciktisi yerellestirilmis) -------
# Uyumsuzluklari metin listesi olarak dondurur (bos = uyumlu); $null = hizmet kayitli degil.
function HizmetFarki($ad, $hesap, $konak, $kok, [string[]]$bagimlilik) {
  $k = "HKLM:\SYSTEM\CurrentControlSet\Services\$ad"
  if (-not (Test-Path $k)) { return $null }
  $v = Get-ItemProperty -Path $k
  $fark = @()
  if ([string]$v.ObjectName -cne $hesap) { $fark += "hesap '$($v.ObjectName)' (beklenen '$hesap')" }
  $p = KomutParcala ([string]$v.ImagePath)
  $argOk = ($p.Count -eq 6) -and (YolEsit $p[0] $konak) -and ($p[1] -ceq "hizmet") -and ($p[2] -ceq "--kok") -and (YolEsit $p[3] $kok) -and ($p[4] -ceq "--ad") -and ($p[5] -ceq $ad)
  if (-not $argOk) { $fark += "ImagePath '$($v.ImagePath)' (beklenen $konak hizmet --kok $kok --ad $ad)" }
  if ([int]$v.ServiceSidType -ne 1) { $fark += "SID turu $($v.ServiceSidType) (beklenen 1 = unrestricted)" }
  $priv = @($v.RequiredPrivileges | Where-Object { $_ }) | Sort-Object
  $bek = @($Ayricaliklar) | Sort-Object
  if (($priv -join ",") -cne ($bek -join ",")) { $fark += "ayricaliklar '$($priv -join ', ')' (beklenen '$($bek -join ', ')')" }
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
  if (-not ($sifirla -eq 86400 -and ($eylem -join ",") -ceq "1/5000,1/5000,1/30000")) {
    $fark += "kurtarma eylemleri '$($eylem -join ',')' sifirlama $sifirla (beklenen 1/5000,1/5000,1/30000 ve 86400)"
  }
  if ([int]$v.FailureActionsOnNonCrashFailures -ne 1) { $fark += "FailureActionsOnNonCrashFailures=$($v.FailureActionsOnNonCrashFailures) (beklenen 1 - konak node dusunce sifir-disi kodla cikar)" }
  $dep = @($v.DependOnService | Where-Object { $_ }) | Sort-Object
  $bekDep = @($bagimlilik | Where-Object { $_ }) | Sort-Object
  if (($dep -join ",") -cne ($bekDep -join ",")) { $fark += "bagimlilik '$($dep -join ', ')' (beklenen '$($bekDep -join ', ')')" }
  return ,$fark
}

# Native komut (konak): cikis kodu okunur, stderr YONLENDIRILMEZ (ekrana duser, zararsiz).
function KonakKos {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arg)
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try   { & $KonakYolu @Arg | ForEach-Object { Write-Host "     $_" } }
  finally { $ErrorActionPreference = $eskiEAP }
  return $LASTEXITCODE
}

# --- Guvenlik kapilari ------------------------------------------------------------
$admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Dur "YONETICI PowerShell gerekir (izin ve hizmet kaydi)." }
if ($HizmetAdi -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { Dur "gecersiz hizmet adi: $HizmetAdi" }
if ($PgHizmeti -and $PgYok) { Dur "-PgHizmeti ve -PgYok birlikte verilemez." }
if ($PgHizmeti -and $PgHizmeti -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { Dur "gecersiz PostgreSQL hizmet adi: $PgHizmeti" }
if ($YalnizIskelet -and -not $Uygula) { Dur "-YalnizIskelet yalniz -Uygula ile anlamlidir (olcum zaten degisiklik yapmaz)." }
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
if (-not $KonakYolu) { $KonakYolu = Join-Path (Join-Path (Join-Path $kokTam "current") "runtime") "tekserp-hizmet.exe" }
# Kayit konagin bu yolunu ImagePath yapar (hizmet-kur <Kok>\current\runtime\ ile sabit): olcum de onu bekler.
$kayitKonak = Join-Path (Join-Path (Join-Path $kokTam "current") "runtime") "tekserp-hizmet.exe"
if (-not $GuncellemeDizini) { $GuncellemeDizini = Join-Path (Join-Path $env:ProgramData "TeksERP") "guncelleme" }
if (-not [System.IO.Path]::IsPathRooted($GuncellemeDizini)) { Dur "-GuncellemeDizini mutlak olmali: $GuncellemeDizini" }
$GuncellemeDizini = [System.IO.Path]::GetFullPath($GuncellemeDizini).TrimEnd('\')
$programData = Split-Path $GuncellemeDizini -Parent
# Ust dizin "yasak" izni alir (miras kesilir): bir sistem dizini ya da surucu koku OLAMAZ.
if (-not $programData -or $programData.Length -lt 4) { Dur "-GuncellemeDizini ust dizini gecersiz (surucu koku olamaz): $GuncellemeDizini" }
foreach ($y in $yasakKok) {
  if ([string]::Equals($programData.TrimEnd('\'), $y, [System.StringComparison]::OrdinalIgnoreCase)) { Dur "-GuncellemeDizini dogrudan bir sistem dizininin altinda olamaz (ust dizin yasak izni alir): $programData" }
}
# Guncelleme kanali: ust (yasak), kanal (oku), niyet (yaz), durum (oku), is (yasak - guncelleyicinin ozel alani).
$KANAL = @(
  @{ Yol = $programData;                              Sinif = "yasak" },
  @{ Yol = $GuncellemeDizini;                         Sinif = "oku"   },
  @{ Yol = (Join-Path $GuncellemeDizini "niyet");     Sinif = "yaz"   },
  @{ Yol = (Join-Path $GuncellemeDizini "durum");     Sinif = "oku"   },
  @{ Yol = (Join-Path $GuncellemeDizini "is");        Sinif = "yasak" }
)
# Beklenen PG bagimliligi (hizmet-kur ile ayni kural).
$bagimlilik = @()
if ($PgHizmeti) { $bagimlilik = @($PgHizmeti) }
elseif (-not $PgYok -and (Get-Service -Name "TeksERP-PostgreSQL" -ErrorAction SilentlyContinue)) { $bagimlilik = @("TeksERP-PostgreSQL") }

$kip = if (-not $Uygula) { "OLCUM (degisiklik yok)" } elseif ($YalnizIskelet) { "UYGULA - yalniz iskelet" } else { "UYGULA" }
Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP backend hizmeti - $kip"
Write-Host "================================================================"
Write-Host "  Kok     : $kokTam"
Write-Host "  Hizmet  : $HizmetAdi  ($hesap, $sid)"
Write-Host "  Konak   : $KonakYolu"
Write-Host "  PG bag. : $(if ($bagimlilik.Count) { $bagimlilik -join ', ' } else { '(yok)' })"
Write-Host "  Kanal   : $GuncellemeDizini"

if ($Uygula) {
  Write-Host ""
  Write-Host "[1/4] Dizin iskeleti ve korumali izin (SYSTEM + Administrators)..." -ForegroundColor Cyan
  if (-not (Test-Path -LiteralPath $kokTam)) { New-Item -ItemType Directory -Path $kokTam -Force | Out-Null; Ok "olusturuldu: $kokTam" }
  IzinYaz $kokTam "oku" $null
  foreach ($d in $DIZINLER) {
    $yol = Join-Path $kokTam $d.Ad
    if (-not (Test-Path -LiteralPath $yol)) { New-Item -ItemType Directory -Path $yol -Force | Out-Null; Ok "olusturuldu: $yol" }
    if (ReparseMi $yol) { Uyar "baglanti noktasi - izin DEGISTIRILMEDI: $yol"; continue }
    IzinYaz $yol $d.Sinif $null
  }
  foreach ($d in $KANAL) {
    if (-not (Test-Path -LiteralPath $d.Yol)) { New-Item -ItemType Directory -Path $d.Yol -Force | Out-Null; Ok "olusturuldu: $($d.Yol)" }
    if (ReparseMi $d.Yol) { Dur "baglanti noktasi - SYSTEM'in yazdigi yol ele gecirilmis olabilir: $($d.Yol)" }
    IzinYaz $d.Yol $d.Sinif $null
  }
  if ($YalnizIskelet) {
    Write-Host ""
    Write-Host "OLCUM (iskelet: miras kesik + genis grup yok)" -ForegroundColor Cyan
    $script:uyumsuz = 0
    IskeletOlc $kokTam
    foreach ($d in $DIZINLER) { IskeletOlc (Join-Path $kokTam $d.Ad) }
    foreach ($d in $KANAL) { IskeletOlc $d.Yol }
    Write-Host ""
    if ($script:uyumsuz -eq 0) { Write-Host "  ISKELET HAZIR (sir artik yazilabilir; kayit + izin icin: -Uygula)" -ForegroundColor Green; exit 0 }
    Write-Host "  ISKELET UYUMSUZ ($($script:uyumsuz) madde)" -ForegroundColor Yellow
    exit 2
  }

  Write-Host ""
  Write-Host "[2/4] Hizmet kaydi (hizmet-kur - tek kaynak)..." -ForegroundColor Cyan
  if (-not (Test-Path -LiteralPath $KonakYolu)) { Dur "konak ikilisi yok: $KonakYolu - hizmet kaydedilemez, sanal hesap dogmaz (once surum dizini + current)." }
  $fark = HizmetFarki $HizmetAdi $hesap $kayitKonak $kokTam $bagimlilik
  if ($null -ne $fark -and $fark.Count -eq 0) {
    Ok "kayit zaten uyumlu - yeniden kaydedilmedi: $HizmetAdi"
  } else {
    if ($null -eq $fark) { Bilgi "hizmet kayitli degil - kaydediliyor" } else { foreach ($f in $fark) { Bilgi "kayit farki: $f" } }
    $kurArg = @("hizmet-kur", "--kok", $kokTam, "--ad", $HizmetAdi)
    if ($PgHizmeti) { $kurArg += @("--pg-hizmeti", $PgHizmeti) } elseif ($PgYok) { $kurArg += "--pg-yok" }
    $kod = KonakKos @kurArg
    if ($kod -ne 0) { Dur "hizmet-kur basarisiz (cikis $kod) - izin YAZILMADI (sanal hesap yok)." }
    Ok "kaydedildi: $HizmetAdi"
    $calisan = Get-Service -Name $HizmetAdi -ErrorAction SilentlyContinue
    if ($calisan -and "$($calisan.Status)" -ceq "Running") { Bilgi "hizmet CALISIYOR - kayit degisikligi bir sonraki baslatmada etkin" }
  }

  Write-Host ""
  Write-Host "[3/4] Izinler (sanal hesap: $hesap)..." -ForegroundColor Cyan
  IzinYaz $kokTam "oku" $sid
  foreach ($d in $DIZINLER) {
    $yol = Join-Path $kokTam $d.Ad
    if (ReparseMi $yol) { Uyar "baglanti noktasi - izin DEGISTIRILMEDI: $yol"; continue }
    IzinYaz $yol $d.Sinif $sid
  }
  foreach ($d in $KANAL) { IzinYaz $d.Yol $d.Sinif $sid }
  # Eski kurulumun daralttigi (miras kesik) sir dosyalari yeni dizinin mirasina doner.
  foreach ($f in @("yapilandirma\.env", "veri\rclone.conf")) {
    $yol = Join-Path $kokTam $f
    if ((Test-Path -LiteralPath $yol) -and -not (ReparseMi $yol)) {
      & icacls.exe $yol /reset | Out-Null
      if ($LASTEXITCODE -ne 0) { Uyar "miras geri konamadi (icacls $LASTEXITCODE): $yol" }
    }
  }
  $script:uyumsuz = 0
}

Write-Host ""
Write-Host "OLCUM (hizmet hesabinin etkin erisimi: $($jeton.Count) SID)" -ForegroundColor Cyan
DizinOlc $kokTam "kok" $jeton
foreach ($d in $DIZINLER) { DizinOlc (Join-Path $kokTam $d.Ad) $d.Sinif $jeton }
foreach ($b in $BAGLANTILAR) {
  $yol = Join-Path $kokTam $b
  if (Test-Path -LiteralPath $yol) { Bilgi "dokunulmaz: $yol$(if (ReparseMi $yol) { ' -> ' + (Get-Item -LiteralPath $yol -Force).Target })" }
}
DosyaOlc (Join-Path $kokTam "yapilandirma\.env") $true $false $jeton
DosyaOlc (Join-Path $kokTam "pg-setup\db-credentials.json") $false $false $jeton
DosyaOlc (Join-Path $kokTam "current\dist\server.js") $true $false $jeton
foreach ($d in $KANAL) { DizinOlc $d.Yol $d.Sinif $jeton }
DosyaOlc (Join-Path (Join-Path $GuncellemeDizini "durum") "durum.json") $true $false $jeton
$fark = HizmetFarki $HizmetAdi $hesap $kayitKonak $kokTam $bagimlilik
if ($null -eq $fark) { Uyar "hizmet kayitli degil: $HizmetAdi" }
elseif ($fark.Count -eq 0) { Ok "hizmet kaydi uyumlu: $HizmetAdi ($hesap, SID unrestricted, $($Ayricaliklar -join '+'), gecikmeli otomatik, kurtarma 5/5/30 sn)" }
else { foreach ($f in $fark) { Uyar "hizmet: $f" } }

Write-Host ""
if ($script:uyumsuz -eq 0) { Write-Host "  UYUMLU" -ForegroundColor Green; exit 0 }
Write-Host "  UYUMSUZ ($($script:uyumsuz) madde)$(if (-not $Uygula) { ' - uygulamak icin: -Uygula' })" -ForegroundColor Yellow
exit 2
