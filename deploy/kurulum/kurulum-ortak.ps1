# =============================================================================
# TeksERP KURULUM - ORTAK ISLEVLER (kurulum.ps1 - on-olcum.ps1 - kaldir.ps1 nokta-kaynak eder)
# =============================================================================
# Yalniz islev tanimlar; nokta-kaynak edildiginde HICBIR SEY CALISTIRMAZ (bekci vektorleri bu
# dosyayi pwsh'ta yukler: deploy/pg/pg-sablon-vektorleri.json port kurali, cevap semasi).
# KURALLAR (Teks-Erp/scripts/test_sunucu_betikleri.ts + test_kurulum_betikleri.ts olcer):
#   * PowerShell 5.1 uyumlu, dosya ASCII (BOM'suz dosyayi 5.1 ANSI okur).
#   * Buyuk/kucuk harf + kultur: yalniz -cmatch / -creplace / -csplit / -ceq (tr-TR 'I' tuzagi).
#   * stderr yonlendirmesi yalniz EAP="Continue" yapip finally'de geri koyan yardimcida.
#   * SIR (parola, PIN, anahtar) argv'ye, ortama (cagri suresi disinda), gunluge YAZILMAZ: psql'e SQL
#     STDIN'den, rol parolasi SCRAM dogrulayicisi olarak; gunluge giden her satir Maskele'den gecer.
# Tasarim: docs/design/GUNCELLEYICI.md b.4 - docs/design/KENDI-POSTGRESQL.md b.4 - deploy/kurulum/README yok
#   (belge: tekserp-kurulum.iss basligi + docs/kurallar/deploy-kurulum.md).
# =============================================================================

$script:SID_SYSTEM = "S-1-5-18"
$script:SID_ADMIN = "S-1-5-32-544"
$script:SID_USERS = "S-1-5-32-545"
# Genis gruplar (Users, Authenticated Users, Everyone): sir/veri dizinlerinde OLMAZ.
$script:SID_GENIS = @("S-1-5-32-545", "S-1-5-11", "S-1-1-0")

# --- Gunluk + sir maskesi -----------------------------------------------------------------------
$script:GunlukYolu = $null
$script:Sirlar = New-Object System.Collections.Generic.List[string]

# Kayitli sir degerleri ve `sema://kullanici:parola@` kimligi her gunluk satirindan silinir.
function Maskele([string]$m) {
  if ($null -eq $m) { return "" }
  $s = $m -creplace '(?<sema>[A-Za-z][A-Za-z0-9+.-]*://)[^\s/@"'']+@', '${sema}***@'
  foreach ($x in $script:Sirlar) { if ($x -and $x.Length -ge 4) { $s = $s.Replace($x, "***") } }
  return $s
}

function SirEkle([string]$s) { if ($s) { [void]$script:Sirlar.Add($s) } }

function GunlugeYaz([string]$duzey, [string]$m) {
  $satir = "{0} {1} {2}" -f (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffzzz"), $duzey, (Maskele $m)
  if ($script:GunlukYolu) {
    try { [IO.File]::AppendAllText($script:GunlukYolu, $satir + "`r`n", (New-Object Text.UTF8Encoding $false)) } catch { }
  }
  return (Maskele $m)
}

function Bilgi($m) { Write-Host ("  .  " + (GunlugeYaz "BILGI" $m)) }
function Ok($m)    { Write-Host ("  +  " + (GunlugeYaz "TAMAM" $m)) -ForegroundColor Green }
function Uyar($m)  { Write-Host ("  !  " + (GunlugeYaz "UYARI" $m)) -ForegroundColor Yellow; $script:Uyarilar += , (Maskele $m) }
function Baslik($m) { Write-Host ""; Write-Host ("== " + (GunlugeYaz "ASAMA" $m)) -ForegroundColor Cyan }
$script:Uyarilar = @()

# Durma: gunluge yazilir, istisna firlatilir; cagiran (asama kosucusu) tek yerde yakalar ve cikis
# kodunu verir. `exit` ISLEV ICINDE KULLANILMAZ (nokta-kaynakli bekci harness'ini oldururdu).
function Dur([string]$m) {
  $mm = GunlugeYaz "DUR" $m
  Write-Host ""
  Write-Host ("  X  " + $mm) -ForegroundColor Red
  throw [System.InvalidOperationException]::new("KURULUM_DUR: " + $mm)
}

# --- Yonetici, isletim sistemi -----------------------------------------------------------------
function YoneticiMi {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function KullaniciSid { return [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }

# --- JSON ---------------------------------------------------------------------------------------
function JsonOku([string]$yol) {
  if (-not (Test-Path -LiteralPath $yol -PathType Leaf)) { Dur "dosya yok: $yol" }
  try { return (Get-Content -LiteralPath $yol -Raw -Encoding UTF8 | ConvertFrom-Json) }
  catch { Dur "JSON okunamadi: $yol" }
}

# BOM'suz UTF-8 + LF; yazilan once .tmp'ye, sonra yerine (yarim dosya gorulmez).
function MetinYaz([string]$yol, [string]$metin) {
  $tmp = "$yol.tmp"
  [IO.File]::WriteAllText($tmp, $metin, (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $tmp -Destination $yol -Force
}

# Sihirbaz/arac sinirinda JSON ASCII kalir: BMP disi dahil her ASCII-disi karakter \uXXXX.
function JsonAscii([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $s.ToCharArray()) {
    $k = [int]$ch
    if ($ch -ceq '"') { [void]$sb.Append('\"') }
    elseif ($ch -ceq '\') { [void]$sb.Append('\\') }
    elseif ($k -lt 0x20 -or $k -gt 0x7E) { [void]$sb.Append(('\u{0:x4}' -f $k)) }
    else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

# --- Cevap dosyasi (sema: deploy/kurulum/cevap-semasi.json) ------------------------------------
# Sema duz anahtarli (nokta yolu): her alanin turu, varsayilani, deseni. Cevapta SEMADA OLMAYAN
# anahtar RED (KATI); anahtar adi sir cagristiriyorsa RED (cevap dosyasi sir TASIMAZ).
# Kucuk harfe kultursuz cevrilmis anahtar SEGMENTINE uygulanir (tr-TR'de (?i) 'I'yi 'i'ye indirmez).
# ("yedek.sifreleme" sir DEGIL: `sifre` yalniz tam segment ya da `sifresi` sonu olarak sayilir.)
$script:SIR_ADI = '(parola|password|secret|token|apikey|^pin$|^sifre$|sifresi$)'
function SirAdiMi([string]$anahtar) {
  foreach ($seg in ($anahtar -csplit '\.')) {
    if ($seg.ToLowerInvariant() -cmatch $script:SIR_ADI) { return $true }
  }
  return $false
}

function CevapDuzlestir($nesne, [string]$onek, $hedef) {
  foreach ($p in $nesne.PSObject.Properties) {
    $ad = if ($onek) { "$onek.$($p.Name)" } else { $p.Name }
    $d = $p.Value
    if ($d -is [System.Management.Automation.PSCustomObject]) { CevapDuzlestir $d $ad $hedef }
    else { $hedef[$ad] = $d }
  }
}

function AlanDogrula([string]$ad, $deger, $tanim) {
  if ($null -eq $deger) {
    if ($tanim.bos -eq $true) { return $null }
    return "$ad bos olamaz"
  }
  switch ($tanim.tur) {
    "sayi" {
      if (-not ($deger -is [int] -or $deger -is [long] -or $deger -is [double]) -or [math]::Floor([double]$deger) -ne [double]$deger) { return "$ad tamsayi olmali" }
      if ($null -ne $tanim.en_az -and [double]$deger -lt [double]$tanim.en_az) { return "$ad en az $($tanim.en_az)" }
      if ($null -ne $tanim.en_cok -and [double]$deger -gt [double]$tanim.en_cok) { return "$ad en cok $($tanim.en_cok)" }
    }
    "mantik" { if (-not ($deger -is [bool])) { return "$ad true/false olmali" } }
    "metin" {
      if (-not ($deger -is [string])) { return "$ad metin olmali" }
      if ($tanim.desen -and $deger -cnotmatch $tanim.desen) { return "$ad bicimsiz" }
      if ($tanim.secenek -and ($tanim.secenek -cnotcontains $deger)) { return "$ad su degerlerden biri olmali: $($tanim.secenek -join ', ')" }
    }
    "yol" {
      if (-not ($deger -is [string])) { return "$ad metin olmali" }
      # Bosluk YOK: yol .env'e tirnaksiz yazilir (iki okuyucu ayni okusun) ve hizmet komut satirina girer.
      if ($deger -cnotmatch '^[A-Za-z]:\\[\x21-\x7E]*$' -or $deger.Contains("..") -or $deger.Contains('"') -or $deger.Length -gt 200) { return "$ad mutlak, ASCII, bosluksuz, '..' tasimayan Windows yolu olmali (X:\...)" }
    }
    "liste" {
      $dizi = @($deger)
      if ($dizi.Count -lt [int]$tanim.en_az_oge) { return "$ad en az $($tanim.en_az_oge) oge" }
      foreach ($o in $dizi) {
        if (-not ($o -is [string]) -or ($tanim.secenek -cnotcontains $o)) { return "$ad ogesi '$o' izinli degil: $($tanim.secenek -join ', ')" }
      }
      if (@($dizi | Select-Object -Unique).Count -ne $dizi.Count) { return "$ad tekrar eden oge tasiyor" }
    }
    default { return "$ad icin semada bilinmeyen tur $($tanim.tur)" }
  }
  return $null
}

# Doner: @{ hatalar = @(...); deger = @{ "<nokta.yol>" = <deger> } } (varsayilanlar uygulanmis).
function CevapDogrula($cevap, $sema) {
  $hatalar = @()
  $duz = @{}
  CevapDuzlestir $cevap "" $duz
  $alanlar = @{}
  foreach ($p in $sema.alanlar.PSObject.Properties) { $alanlar[$p.Name] = $p.Value }
  foreach ($k in $duz.Keys) {
    if (SirAdiMi $k) { $hatalar += "cevap dosyasi sir tasiyamaz: '$k' (parola/PIN sihirbazdan boruyla gelir)" ; continue }
    if (-not $alanlar.ContainsKey($k)) { $hatalar += "semada olmayan alan: '$k'" }
  }
  $deger = @{}
  foreach ($ad in $alanlar.Keys) {
    $t = $alanlar[$ad]
    $var = $duz.ContainsKey($ad)
    if (-not $var -and $t.zorunlu -eq $true) { $hatalar += "zorunlu alan yok: '$ad'"; continue }
    $d = if ($var) { $duz[$ad] } else { $t.varsayilan }
    $h = AlanDogrula $ad $d $t
    if ($h) { $hatalar += $h } else { $deger[$ad] = $d }
  }
  if ($duz.ContainsKey("v") -and $duz["v"] -ne [int]$sema.surum) { $hatalar += "cevap dosyasi surumu $($duz['v']) - bu kurulum $($sema.surum) tanir" }
  return @{ hatalar = $hatalar; deger = $deger }
}

# --- Parola ve SCRAM (bakim-rolu.ps1 / ilk-kurulum.ps1 ile AYNI govde) --------------------------
# Alfabe + uzunluk pg-ornegi.json parola blogundan; reddetmeli ornekleme (modulo yanliligi yok).
function YeniParolaUret([string]$alfabe, [int]$uzunluk) {
  $abc = $alfabe.ToCharArray()
  $tavan = [int]([math]::Floor(256 / $abc.Length) * $abc.Length)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $s = New-Object System.Text.StringBuilder
  while ($s.Length -lt $uzunluk) {
    $b = New-Object byte[] 64
    $rng.GetBytes($b)
    foreach ($x in $b) { if ($x -lt $tavan -and $s.Length -lt $uzunluk) { [void]$s.Append($abc[$x % $abc.Length]) } }
  }
  return $s.ToString()
}

function Pbkdf2Sha256([byte[]]$parola, [byte[]]$tuz, [int]$tur) {
  $h = [Security.Cryptography.HMACSHA256]::new($parola)
  $u = $h.ComputeHash([byte[]]($tuz + [byte[]](0, 0, 0, 1)))
  $t = [byte[]]$u.Clone()
  for ($i = 1; $i -lt $tur; $i++) {
    $u = $h.ComputeHash($u)
    for ($j = 0; $j -lt 32; $j++) { $t[$j] = $t[$j] -bxor $u[$j] }
  }
  return $t
}
function ScramDogrulayici([string]$parola) {
  $tuz = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tuz)
  $tuzlu = Pbkdf2Sha256 ([Text.Encoding]::UTF8.GetBytes($parola)) $tuz 4096
  $istemci = [Security.Cryptography.HMACSHA256]::new($tuzlu).ComputeHash([Text.Encoding]::ASCII.GetBytes("Client Key"))
  $sunucu = [Security.Cryptography.HMACSHA256]::new($tuzlu).ComputeHash([Text.Encoding]::ASCII.GetBytes("Server Key"))
  $saklanan = [Security.Cryptography.SHA256]::Create().ComputeHash($istemci)
  return "SCRAM-SHA-256`$4096:" + [Convert]::ToBase64String($tuz) + "`$" + [Convert]::ToBase64String($saklanan) + ":" + [Convert]::ToBase64String($sunucu)
}

function Ident($ad) { return '"' + ($ad -creplace '"', '""') + '"' }
function Lit($s) { return "'" + ($s -creplace "'", "''") + "'" }

# --- DPAPI (yerel makine): postgres super kullanici parolasi .env'e GIRMEZ (D4 b.4.13) ----------
$script:DPAPI_ENTROPI = [Text.Encoding]::ASCII.GetBytes("TeksERP-PG-Yonetici-1")
function DpapiKoru([string]$metin) {
  Add-Type -AssemblyName System.Security
  return [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($metin), $script:DPAPI_ENTROPI, [Security.Cryptography.DataProtectionScope]::LocalMachine)
}
function DpapiCoz([byte[]]$b) {
  Add-Type -AssemblyName System.Security
  return [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $script:DPAPI_ENTROPI, [Security.Cryptography.DataProtectionScope]::LocalMachine))
}

# --- Dizin, ACL, baglanti ----------------------------------------------------------------------
function ReparseMi([string]$yol) {
  if (-not (Test-Path -LiteralPath $yol)) { return $false }
  return ((Get-Item -LiteralPath $yol -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

# Native komut (icacls/sc.exe/cmd): cikis kodu doner, ciktisi yutulur; stderr EAP=Continue altinda.
function NativeKos([string]$exe, [string[]]$arglar) {
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $c = & $exe @arglar 2>&1
    return [pscustomobject]@{ kod = $LASTEXITCODE; cikti = ((@($c) | ForEach-Object { "$_" }) -join "`n").Trim() }
  } finally { $ErrorActionPreference = $eskiEAP }
}

# Dizin icin KORUMALI DACL (miras kesik): SYSTEM + Administrators tam, ek ACE'ler ("*<SID>:(OI)(CI)RX" bicimi).
function AclKoru([string]$yol, [string[]]$ek, [switch]$Agac) {
  if (ReparseMi $yol) { Dur "baglanti noktasina izin yazilmaz (hedefi degistirirdi): $yol" }
  $a = @($yol, "/inheritance:r", "/grant:r", "*$($script:SID_SYSTEM):(OI)(CI)F", "*$($script:SID_ADMIN):(OI)(CI)F")
  foreach ($e in @($ek)) { if ($e) { $a += $e } }
  # Ek ACE'lerde ACIKCA verilen genis grup (or. D4: ikililere Users RX) kaldirilmaz; digerleri kaldirilir.
  $izinli = @(@($ek) | ForEach-Object { if ($_ -cmatch '^\*(S-[0-9-]+):') { $Matches[1] } })
  $a += @("/remove:g") + @($script:SID_GENIS | Where-Object { $izinli -cnotcontains $_ } | ForEach-Object { "*" + $_ })
  if ($Agac) { $a += "/T" }
  $a += "/Q"
  $r = NativeKos "icacls.exe" $a
  if ($r.kod -ne 0) { Dur "izin yazilamadi (icacls $($r.kod)): $yol" }
}

# Dosya icin korumali DACL (dizinsiz hak bicimi); ek: "*<SID>:R" gibi.
function DosyaAclKoru([string]$yol, [string[]]$ek) {
  $a = @($yol, "/inheritance:r", "/grant:r", "*$($script:SID_SYSTEM):F", "*$($script:SID_ADMIN):F")
  foreach ($e in @($ek)) { if ($e) { $a += $e } }
  $a += @("/remove:g") + @($script:SID_GENIS | ForEach-Object { "*$_" })
  $r = NativeKos "icacls.exe" $a
  if ($r.kod -ne 0) { Dur "dosya izni yazilamadi (icacls $($r.kod)): $yol" }
}

# Genis gruplara (Users / Authenticated Users / Everyone) IZIN veren ACE'ler; @() = temiz.
function GenisAceler([string]$yol, [string[]]$izinli) {
  $bulunan = @()
  foreach ($k in (Get-Acl -LiteralPath $yol).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    $s = $k.IdentityReference.Value
    if (($script:SID_GENIS -ccontains $s) -and ("$($k.AccessControlType)" -ceq "Allow") -and -not (@($izinli) -ccontains $s)) { $bulunan += $s }
  }
  return , $bulunan
}

# Sir dosyasi: once BOS dosya + korumali ACL, SONRA icerik (icerik hicbir an genis izinle durmaz).
function SirDosyasiYaz([string]$yol, [byte[]]$icerik, [string[]]$ekOkuyucu) {
  if (Test-Path -LiteralPath $yol) { Remove-Item -LiteralPath $yol -Force }
  [IO.File]::WriteAllBytes($yol, [byte[]]@())
  DosyaAclKoru $yol $ekOkuyucu
  [IO.File]::WriteAllBytes($yol, $icerik)
}

function JunctionHedefi([string]$yol) {
  if (-not (ReparseMi $yol)) { return $null }
  $t = (Get-Item -LiteralPath $yol -Force).Target
  if ($t -is [array]) { $t = $t[0] }
  return [string]$t
}

# Baglanti (junction) kur/cevir. Var olan baglanti [IO.Directory]::Delete ile (ozyinelemesiz) silinir:
# Remove-Item -Recurse baglantinin HEDEFINI bosaltirdi (D4 b.4.4).
function JunctionKur([string]$baglanti, [string]$hedef) {
  if (-not (Test-Path -LiteralPath $hedef -PathType Container)) { Dur "baglanti hedefi yok: $hedef" }
  if (Test-Path -LiteralPath $baglanti) {
    if (-not (ReparseMi $baglanti)) { Dur "baglanti yerinde GERCEK dizin var (silinmez): $baglanti" }
    $simdiki = JunctionHedefi $baglanti
    if ($simdiki -and ([IO.Path]::GetFullPath($simdiki).TrimEnd('\') -ceq [IO.Path]::GetFullPath($hedef).TrimEnd('\'))) { return }
    [IO.Directory]::Delete($baglanti)
  }
  $r = NativeKos "cmd.exe" @("/c", "mklink", "/J", $baglanti, $hedef)
  if ($r.kod -ne 0) { Dur "baglanti kurulamadi (mklink $($r.kod)): $baglanti -> $hedef" }
  $olc = JunctionHedefi $baglanti
  if (-not $olc -or ([IO.Path]::GetFullPath($olc).TrimEnd('\') -cne [IO.Path]::GetFullPath($hedef).TrimEnd('\'))) { Dur "baglanti olculemedi: $baglanti" }
}

# --- Portlar (D4 b.4.5: kural deploy/pg/lib/pg-ornegi.mjs portSec ile AYNI; vektorler bekcide) ----
# Doner: @{ port = <int> ; neden = "..." } ya da @{ hata = "..." }.
function PortSec([int[]]$mesgul, [int]$baslangic, [int]$bitis, $onceki, $istenen) {
  $dolu = @{}
  foreach ($m in @($mesgul)) { $dolu[[int]$m] = $true }
  if ($null -ne $onceki) {
    if ($onceki -is [int] -or $onceki -is [long]) { return @{ port = [int]$onceki; neden = "kayitli port (onceki kurulum)" } }
    return @{ hata = "kayitli port gecersiz: $onceki" }
  }
  if ($null -ne $istenen) {
    if (-not ($istenen -is [int] -or $istenen -is [long]) -or $istenen -le 1024 -or $istenen -gt 65535) { return @{ hata = "istenen port $istenen 1025..65535 disinda" } }
    if ($dolu.ContainsKey([int]$istenen)) { return @{ hata = "istenen port $istenen mesgul - baska port verin ya da bos birakin" } }
    return @{ port = [int]$istenen; neden = "istenen port" }
  }
  for ($p = $baslangic; $p -le $bitis; $p++) {
    if (-not $dolu.ContainsKey($p)) {
      $n = if ($p -eq $baslangic) { "varsayilan port bos" } else { "$baslangic..$($p - 1) mesgul" }
      return @{ port = $p; neden = $n }
    }
  }
  return @{ hata = "$baslangic..$bitis araliginda bos port yok" }
}

# Mesgul: herhangi bir adreste DINLEYEN var ya da 127.0.0.1'e baglanilamiyor degil (baglanti kabul ediyor).
function PortDinleniyorMu([int]$port) {
  try {
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
      if (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count) { return $true }
    }
  } catch { }
  $c = New-Object Net.Sockets.TcpClient
  try {
    $ar = $c.BeginConnect("127.0.0.1", $port, $null, $null)
    if ($ar.AsyncWaitHandle.WaitOne(300) -and $c.Connected) { return $true }
  } catch { } finally { $c.Close() }
  return $false
}

# Windows'un ayrilmis port araliklari (Hyper-V/WinNAT): o portu PG baglayamaz - mesgul sayilir.
function HaricPortlar([int]$bas, [int]$bit) {
  $out = @()
  $r = NativeKos "netsh.exe" @("int", "ipv4", "show", "excludedportrange", "protocol=tcp")
  if ($r.kod -ne 0) { return , $out }
  foreach ($l in ($r.cikti -csplit "`n")) {
    if ($l -cmatch '^\s*([0-9]{1,5})\s+([0-9]{1,5})') {
      $a = [int]$Matches[1]; $b = [int]$Matches[2]
      for ($p = [math]::Max($a, $bas); $p -le [math]::Min($b, $bit); $p++) { $out += $p }
    }
  }
  return , $out
}

# Makinedeki PostgreSQL hizmetlerinin yapilandirdigi portlar (durmus hizmet de portu TUTAR; D4 b.4.5 (3)).
function PgHizmetPortlari {
  $portlar = @()
  foreach ($s in @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue)) {
    $yol = [string]$s.PathName
    if ($yol.ToLowerInvariant() -cnotmatch 'pg_ctl(\.exe)?"?\s+runservice') { continue }
    $veri = $null
    if ($yol -cmatch '-D\s+"([^"]+)"') { $veri = $Matches[1] } elseif ($yol -cmatch '-D\s+(\S+)') { $veri = $Matches[1] }
    $portlar += (PgVeriPortu $veri)
  }
  return , $portlar
}

# Veri dizininin portu: postgresql.conf (+ bir duzey `include`) sonra postgresql.auto.conf; okunamazsa
# 5432 de mesgul sayilir (D4 b.4.5: olculemeyen port bos sayilmaz).
function PgVeriPortu([string]$veri) {
  if (-not $veri) { return @(5432) }
  $port = 5432
  $dosyalar = New-Object System.Collections.Generic.List[string]
  [void]$dosyalar.Add((Join-Path $veri "postgresql.conf"))
  $okunamadi = $false
  try {
    foreach ($l in [IO.File]::ReadAllLines((Join-Path $veri "postgresql.conf"))) {
      if ($l -cmatch "^\s*include(_if_exists)?\s+'([^']+)'") {
        $inc = $Matches[2]
        if (-not [IO.Path]::IsPathRooted($inc)) { $inc = Join-Path $veri $inc }
        [void]$dosyalar.Add($inc)
      }
    }
  } catch { $okunamadi = $true }
  [void]$dosyalar.Add((Join-Path $veri "postgresql.auto.conf"))
  foreach ($f in $dosyalar) {
    try {
      if (-not (Test-Path -LiteralPath $f)) { continue }
      foreach ($l in [IO.File]::ReadAllLines($f)) { if ($l -cmatch '^\s*port\s*=\s*(\d+)') { $port = [int]$Matches[1] } }
    } catch { $okunamadi = $true }
  }
  if ($okunamadi -and $port -ne 5432) { return @($port, 5432) }
  return @($port)
}

# --- Hizmet bekleme, saglik -------------------------------------------------------------------
function HizmetBekle([string]$ad, [string]$durum, [int]$sn) {
  $s = Get-Service -Name $ad -ErrorAction SilentlyContinue
  if (-not $s) { return $false }
  try { $s.WaitForStatus($durum, [TimeSpan]::FromSeconds($sn)); return $true } catch { return $false }
}

# GET /health: 200 + status UP + db UP + version = beklenen (GUNCELLEYICI.md b.8.7 ile ayni olcut).
function SaglikBekle([int]$port, [string]$surum, [int]$sn) {
  $son = $null
  $bitis = (Get-Date).AddSeconds($sn)
  while ((Get-Date) -lt $bitis) {
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5 -UseBasicParsing
      $son = "status=$($r.status) db=$($r.db) version=$($r.version)"
      if ("$($r.status)" -ceq "UP" -and "$($r.db)" -ceq "UP" -and "$($r.version)" -ceq $surum) { return @{ tamam = $true; son = $son } }
    } catch { $son = "yanit yok" }
    Start-Sleep -Seconds 2
  }
  return @{ tamam = $false; son = $son }
}
