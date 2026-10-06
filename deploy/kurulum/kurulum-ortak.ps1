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
function MetinYaz([string]$yol, [string]$metin, [Text.Encoding]$kod) {
  if (-not $kod) { $kod = New-Object Text.UTF8Encoding $false }
  $tmp = "$yol.tmp"
  [IO.File]::WriteAllText($tmp, $metin, $kod)
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

# --- .env satiri: SADE BICIM (iki okuyucu - dotenv ve guncelleyicinin envfile.rs'i - ayni okusun) -----
# KEY=deger; tirnak YOK, deger bosluksuz, '#' ve ters bolu YOK (yollar '/' ile). Kurulumun yazdigi her satir.
$script:ENV_SATIRI = '^[A-Z_][A-Z0-9_]*=[^\s"''#\\]*$'
function EnvSatiriGecerli([string]$satir) { return ($satir -cmatch $script:ENV_SATIRI) }

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
    # Dallarda ATAMA (if ifadesinin ciktisi degil): bos dizi boru hattinda $null'a acilirdi.
    if ($var) { $d = $duz[$ad] } else { $d = $t.varsayilan }
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
  # (OI)(CI) izni ve miras kesme YALNIZ dizine (/T YOK): dosyaya uygulaninca (OI)(CI) gecersiz, miras da kesildigi
  # icin dosyanin DACL'i BOS kalir (thinkpad-1 D8 olcumu). Agacta alt ogeler mirasi bu dizinden alir (/reset).
  $a += "/Q"
  $r = NativeKos "icacls.exe" $a
  if ($r.kod -ne 0) { Dur "izin yazilamadi (icacls $($r.kod)): $yol" }
  if ($Agac) {
    $r = NativeKos "icacls.exe" @((Join-Path $yol "*"), "/reset", "/T", "/C", "/Q")
    if ($r.kod -ne 0) { Dur "alt ogelerin izni sifirlanamadi (icacls $($r.kod)): $yol" }
  }
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

# --- Surum onceligi (guncelleyici version.rs / TS compareVersions AYNASI; vektorler test-vektorleri/
#     guncelleme-karar.json "surum-karsilastir", harness olcer) -------------------------------------
function SurumCoz([string]$s) {
  if (-not ($s -cmatch '^([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,6})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$')) { return $null }
  $on = @()
  if ($Matches[4]) { $on = @($Matches[4] -csplit '\.') }
  return @{ cekirdek = @([long]$Matches[1], [long]$Matches[2], [long]$Matches[3]); on = $on }
}

# -1 / 0 / 1; biri bicimsizse $null (cagiran fail-closed davranir).
function SurumKarsilastir([string]$a, [string]$b) {
  $x = SurumCoz $a
  $y = SurumCoz $b
  if ($null -eq $x -or $null -eq $y) { return $null }
  for ($i = 0; $i -lt 3; $i++) {
    if ($x.cekirdek[$i] -ne $y.cekirdek[$i]) { if ($x.cekirdek[$i] -lt $y.cekirdek[$i]) { return -1 } else { return 1 } }
  }
  $xk = $x.on.Count -eq 0
  $yk = $y.on.Count -eq 0
  if ($xk -and $yk) { return 0 }
  if ($xk) { return 1 }
  if ($yk) { return -1 }
  $n = [Math]::Min($x.on.Count, $y.on.Count)
  for ($i = 0; $i -lt $n; $i++) {
    $p = [string]$x.on[$i]; $q = [string]$y.on[$i]
    $ps = $p -cmatch '^[0-9]+$'; $qs = $q -cmatch '^[0-9]+$'
    if ($ps -and $qs) { $c = ([double]$p).CompareTo([double]$q) }
    elseif ($ps) { $c = -1 }
    elseif ($qs) { $c = 1 }
    else { $c = [string]::CompareOrdinal($p, $q) }
    if ($c -lt 0) { return -1 }
    if ($c -gt 0) { return 1 }
  }
  if ($x.on.Count -lt $y.on.Count) { return -1 }
  if ($x.on.Count -gt $y.on.Count) { return 1 }
  return 0
}

# Kokte GERCEKTEN kurulu surumun adaylari. kurulum\kurulum.json paket.surum KURULUM ANININ surumudur; guncelleyici
# sonra tasir ve kaldirma surumler\ ile current'i siler ama kok\kurulum-gecmisi.jsonl ile %ProgramData% durumunu
# korur. Doner: @(@{ surum; kaynak }) - okunamayan kaynak atlanir.
function KuruluSurumAdaylari([string]$kok, [string]$veriKoku) {
  $a = @()
  $h = JunctionHedefi (Join-Path $kok "current")
  if ($h) { $a += @{ surum = (Split-Path -Leaf ($h.TrimEnd('\', '/'))); kaynak = "current baglantisi" } }
  $g = Join-Path $kok "kurulum-gecmisi.jsonl"
  if (Test-Path -LiteralPath $g -PathType Leaf) {
    try {
      $son = @([IO.File]::ReadAllLines($g) | Where-Object { $_.Trim() }) | Select-Object -Last 1
      if ($son) { $j = $son | ConvertFrom-Json; if ($j.yeniSurum) { $a += @{ surum = "$($j.yeniSurum)"; kaynak = "kurulum-gecmisi.jsonl" } } }
    } catch { }
  }
  if ($veriKoku) {
    $d = Join-Path $veriKoku "guncelleme\durum\durum.json"
    if (Test-Path -LiteralPath $d -PathType Leaf) {
      try { $j = JsonOku $d; if ($j.kuruluSurum) { $a += @{ surum = "$($j.kuruluSurum)"; kaynak = "guncelleyici durum.json" } } } catch { }
    }
  }
  $k = Join-Path $kok "kurulum\kurulum.json"
  if (Test-Path -LiteralPath $k -PathType Leaf) {
    try { $j = JsonOku $k; if ($j.paket.surum) { $a += @{ surum = "$($j.paket.surum)"; kaynak = "kurulum.json" } } } catch { }
  }
  return , $a
}

# Adaylarin EN YENI bicimli olani (yoksa $null).
function EnYeniSurum($adaylar) {
  $en = $null
  foreach ($x in @($adaylar)) {
    if ($null -eq (SurumCoz $x.surum)) { continue }
    if ($null -eq $en -or (SurumKarsilastir $x.surum $en.surum) -gt 0) { $en = $x }
  }
  return $en
}

# Eski paket engeli: kurulu surum paketten YENIYSE DUR metni; degilse $null. Eski kod yeni semali veritabanina
# kurulmaz (kaldirip ilk USB ile yeniden kurma). Paket surumu karsilastirilamazsa da DUR (fail-closed).
function EskiPaketEngeli($kurulu, [string]$paketSurum) {
  if ($null -eq $kurulu) { return $null }
  $c = SurumKarsilastir $kurulu.surum $paketSurum
  if ($null -eq $c) { return "paket surumu '$paketSurum' kurulu surumle ($($kurulu.surum)) karsilastirilamadi - hicbir sey degistirilmedi" }
  if ($c -gt 0) { return "bu kokte kurulu surum $($kurulu.surum) ($($kurulu.kaynak)) bu paketten ($paketSurum) YENI - eski paket kurulmaz, veritabani yeni surumun semasinda. $($kurulu.surum) ya da daha yeni bir kurulum paketi kullanin; hicbir sey degistirilmedi." }
  return $null
}

# Eski paket olcumu TEK giris: on-olcum (sihirbazin engel listesi) ve kurulum.ps1 OnKosul (DUR) bunu cagirir.
# Doner: @{ kurulu = <aday|$null>; engel = <DUR metni|$null>; sinif = "eski" | "olculemedi" | "" }.
function EskiPaketOlcumu([string]$kok, [string]$veriKoku, [string]$paketSurum) {
  $ku = EnYeniSurum (KuruluSurumAdaylari $kok $veriKoku)
  $e = EskiPaketEngeli $ku $paketSurum
  $s = ""
  if ($e) { $s = $(if ((SurumKarsilastir $ku.surum $paketSurum) -eq 1) { "eski" } else { "olculemedi" }) }
  return @{ kurulu = $ku; engel = $e; sinif = $s }
}

# --- Gecisle kurulmus duzen (pm2 -> hizmet, deploy/gecis/gecis.ps1) ---------------------------------
# Kurulum kaydi (kurulum\kurulum.json) YOK; IKI isaret birlikte: gecis\<yyyyMMdd_HHmmss>\gunluk.jsonl ve current
# baglantisi (tek isaret yetmez: geri alinmis gecis current'i kaldirir). Kurulum yardimcisi onu ONARMAZ - ayri sinif
# GECISLI, hicbir sey degismeden DUR (docs/ops/GECIS-PM2-HIZMET.md b.7). Doner: @{ damga; metin } ya da $null.
function GecisliDuzen([string]$kok) {
  $g = Join-Path $kok "gecis"
  if (-not (Test-Path -LiteralPath $g -PathType Container)) { return $null }
  $d = @(Get-ChildItem -LiteralPath $g -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -cmatch '^[0-9]{8}_[0-9]{6}$' -and (Test-Path -LiteralPath (Join-Path $_.FullName "gunluk.jsonl") -PathType Leaf) } | Sort-Object Name -Descending)
  if (-not $d.Count) { return $null }
  if (-not (ReparseMi (Join-Path $kok "current"))) { return $null }
  $damga = $d[0].Name
  return @{ damga = $damga; metin = "bu kok pm2 -> hizmet gecisiyle kurulmus bir TeksERP kurulumu (gecis\$damga\gunluk.jsonl + current baglantisi; kurulum\kurulum.json yok) - kurulum yardimcisi onu onarmaz, hicbir sey degistirilmedi. Guncelleme guncelleyiciyle gelir; sorun varsa docs/ops/GECIS-PM2-HIZMET.md (5. bolum: gecis.ps1 -GeriAl; 7. bolum). Yeni kurulum icin baska bir kok secin." }
}

# --- Kanal hizmetleri baska koke bagli mi (FAIL-CLOSED) ---------------------------------------------
# Ayni adli hizmet (KanalAdlariCoz: backend, guncelleyici, PG) BASKA kokun ikilisini ya da --kok'unu gosteriyorsa
# kurulum/onarim o kurulumun hizmetini EZERDI: DUR. Hizmet var ama ImagePath okunamazsa/cozulemezse de DUR.
# Kok karsilastirmasi buyuk/kucuk harf ve sondaki '\' bagimsiz; <kok>\current\... (baglanti) kok altindadir.
function YolKokAltinda([string]$yol, [string]$kok) {
  $y = ("$yol".Trim() -creplace '/', '\').TrimEnd('\').ToLowerInvariant()
  $k = ("$kok".Trim() -creplace '/', '\').TrimEnd('\').ToLowerInvariant()
  if (-not $y -or -not $k -or $y.Contains("..")) { return $false }
  return ($y -ceq $k -or $y.StartsWith($k + "\", [StringComparison]::Ordinal))
}
# $imagePath: $null = hizmet yok (gecer) | "" = var ama okunamadi. Doner: $null (gecer) ya da @{ ad; durum; bagli; metin }.
function HizmetKokKarari([string]$ad, $imagePath, [string]$kok) {
  if ($null -eq $imagePath) { return $null }
  $p = @([regex]::Matches([string]$imagePath, '"([^"]*)"|(\S+)') | ForEach-Object { if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value } })
  if (-not $p.Count -or "$($p[0])" -cnotmatch '^[A-Za-z]:\\') {
    return @{ ad = $ad; durum = "olculemedi"; bagli = ""; metin = "$ad hizmeti var ama hangi koke bagli oldugu olculemedi (ImagePath '$imagePath') - kurulum/onarim yapilamaz (fail-closed), hicbir sey degistirilmedi. Hizmeti 'sc.exe qc $ad' ile denetleyin." }
  }
  $kokArg = $null
  for ($i = 1; $i -lt ($p.Count - 1); $i++) { if ("$($p[$i])" -ceq "--kok") { $kokArg = "$($p[$i + 1])" } }
  foreach ($y in @("$($p[0])", $kokArg)) {
    if ($null -eq $y) { continue }
    if (-not (YolKokAltinda $y $kok)) {
      # Gosterim: diger kurulumun koku (--kok) bilinirse o, yoksa koke uymayan yol.
      $bagli = $(if ($kokArg -and -not (YolKokAltinda $kokArg $kok)) { $kokArg } else { $y })
      return @{ ad = $ad; durum = "baska"; bagli = $bagli; metin = "$ad zaten $bagli'e bagli calisiyor; bu klasore ($kok) kurulum/onarim yapilamaz - o kurulumun hizmetini ezerdi. Ayni koku secin ya da once o kurulumu kaldirin; hicbir sey degistirilmedi." }
    }
  }
  return $null
}
# Kayit defterinden ImagePath: $null = hizmet yok | "" = anahtar var ama okunamadi (fail-closed: engel).
function HizmetImagePath([string]$ad) {
  $k = "HKLM:\SYSTEM\CurrentControlSet\Services\$ad"
  try { if (-not (Test-Path -LiteralPath $k)) { return $null } } catch { return "" }
  try { return "$((Get-ItemProperty -LiteralPath $k -Name ImagePath -ErrorAction Stop).ImagePath)" } catch { return "" }
}
# on-olcum (sihirbazin engel listesi) ve OnKosul (DUR) TEK giris. $okuyucu: bekci harness'i icin (varsayilan kayit defteri).
function HizmetKokEngelleri($adlar, [string]$kok, [scriptblock]$okuyucu) {
  if (-not $okuyucu) { $okuyucu = { param($a) HizmetImagePath $a } }
  $e = @()
  foreach ($ad in @($adlar.backend, $adlar.guncelleyici, $adlar.pg)) {
    if (-not $ad) { continue }
    $r = HizmetKokKarari "$ad" (& $okuyucu "$ad") $kok
    if ($r) { $e += , $r }
  }
  return , $e
}

# --- Ag ayari (API guvenlik duvari): onarim/devamda KAYITTAN ---------------------------------------
# Kayit TEK okuyucuda (on-olcum sihirbaz sayfasini doldurur, kurulum.ps1 OnKosul karar verir); ilk bulunan:
#   kurulum\kurulum.json "ag" > kurulum\durum.json "ag" > kurulum\cevap-onceki.json "api" (setup onarimda yeni cevabi
#   yazmadan once saklar) > kurulum\cevap.json "api" (eski kurulumlar: tek kayit). Semaya uymayan alan yok sayilir.
# Listeler semanin secenek SIRASIYLA (karsilastirma ve gosterim kararli). Doner: @{ izinliAdresler; agProfilleri; mdns;
# kaynak } (bilinmeyen alan $null) ya da $null. Semanin kayitEski degerleri (Tailscale 100.64.0.0/10) YALNIZ kayittan
# taninir: cevapta RED, kayitta korunur (onarim daraltmaz) ve AgKarari uyarir.
$script:AG_ALANLARI = @("izinliAdresler", "agProfilleri", "mdns")
function AgKayitTanimi($tanim) {
  if ($tanim.tur -cne "liste" -or -not $tanim.PSObject.Properties["kayitEski"]) { return $tanim }
  return [pscustomobject]@{ tur = $tanim.tur; en_az_oge = $tanim.en_az_oge; secenek = @(@($tanim.secenek) + @($tanim.kayitEski)) }
}
function AgKanonik($deger, $tanim) {
  if ($tanim.tur -ceq "liste") { return , @(@($tanim.secenek) | Where-Object { @($deger) -ccontains $_ }) }
  return $deger
}
function AgMetni($deger) {
  if ($deger -is [bool]) { return $(if ($deger) { "acik" } else { "kapali" }) }
  return (@($deger) -join ",")
}
function KayitliAgAyari([string]$kok, $sema) {
  $kaynaklar = @(@("kurulum\kurulum.json", "ag"), @("kurulum\durum.json", "ag"), @("kurulum\cevap-onceki.json", "api"), @("kurulum\cevap.json", "api"))
  foreach ($k in $kaynaklar) {
    $y = Join-Path $kok $k[0]
    if (-not (Test-Path -LiteralPath $y -PathType Leaf)) { continue }
    try { $j = Get-Content -LiteralPath $y -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
    if ($null -eq $j -or -not $j.PSObject.Properties[$k[1]]) { continue }
    $n = $j.($k[1])
    $r = @{ kaynak = (Split-Path -Leaf $k[0]) }
    $bir = $false
    foreach ($a in $script:AG_ALANLARI) {
      $r[$a] = $null
      if (-not $n.PSObject.Properties[$a]) { continue }
      $t = AgKayitTanimi $sema.alanlar."api.$a"
      $v = $n.$a
      if ($t.tur -ceq "liste") { $v = @($v) }
      if (AlanDogrula "api.$a" $v $t) { continue }
      $r[$a] = AgKanonik $v $t
      $bir = $true
    }
    if ($bir) { return $r }
  }
  return $null
}
# Karar (OnKosul): onarim/devamda kayittaki alan KAZANIR (kural varsa dokunulmaz, yoksa kayittakiyle kurulur); cevapta
# ACIKCA verilen farkli deger UYGULANMAZ, uyarilir. Kayit yoksa (yeni kurulum) cevap (alan yoksa sema varsayilani).
# $deger: CevapDogrula degeri - $ham: ham cevap (alan verildi mi) - $kayit: KayitliAgAyari ($null = kayit yok).
function AgKarari($deger, $ham, $kayit, $sema) {
  $r = [ordered]@{}
  $u = @()
  $kayittan = @()
  foreach ($a in $script:AG_ALANLARI) {
    $t = $sema.alanlar."api.$a"
    $c = AgKanonik $deger["api.$a"] $t
    $verildi = ($null -ne $ham) -and ($null -ne $ham.PSObject.Properties["api"]) -and ($null -ne $ham.api) -and ($null -ne $ham.api.PSObject.Properties[$a])
    if ($kayit -and $null -ne $kayit[$a]) {
      $r[$a] = $kayit[$a]
      $kayittan += $a
      if ($verildi -and (AgMetni $c) -cne (AgMetni $kayit[$a])) { $u += "cevaptaki api.$a ($(AgMetni $c)) UYGULANMADI: onarim ag ayarini kayittan korur ($(AgMetni $kayit[$a]), $($kayit.kaynak))" }
      $eski = @(@($kayit[$a]) | Where-Object { $t.PSObject.Properties["kayitEski"] -and @($t.kayitEski) -ccontains $_ })
      if ($eski.Count) { $u += "kayitta eski Tailscale izni var (api.$a $(AgMetni $eski), $($kayit.kaynak)): musteri kurulumunda olmamali; onarim erisimi daraltmaz, izin korunur - kaldirmak icin guvenlik duvari kuralini elle daraltin" }
    } else { $r[$a] = $c }
  }
  $r["kaynak"] = $(if ($kayittan.Count) { "kayit ($($kayit.kaynak))" } else { "cevap" })
  return @{ ag = $r; uyarilar = @($u) }
}

# --- Lisans saticisi (backend LICENSE_SERVER_URL): kanal kaydindan, TEK karar ---------------------
# Kanal degeri PAKET.json backendLisansSunucusu (paketle.ps1: dagitim kaydinin lisansSunucusu), derlemenin
# varsayilani lisansSunucusuVarsayilan (vendor-url.ts). kurulum.ps1 OnKosul karari, .env satiri ve Dogrulama olcumu bu
# islevden; sihirbaz ozeti ayni kurali gosterir. Bos alan = kanal; farkli elle deger ve kayittaki farkli deger ENGELLEMEZ,
# UYARIR. Satir yalniz etkin deger derleme varsayilanindan FARKLIYSA yazilir (gecis.ps1 ile ayni kural).
# Eski paket (alan yok): bugunku davranis (girilen yazilir, yoksa derleme varsayilani) + UYARI - fail-closed DEGIL,
# eski paketler bu alani hic tasimadi. $kayit: $null = .env yok (karar cevaptan) | "" = .env var, satir yok | satir degeri.
function LisansKoken([string]$v) {
  if ("$v".Trim() -cmatch '^https://([A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(:[0-9]{1,5})?/?$') { return "https://" + $Matches[1].ToLowerInvariant() + "$($Matches[2])" }
  return $null
}
function LisansSunucusuKarari([string]$kanal, [string]$varsayilan, [string]$girilen, $kayit, [string]$kanalAdi) {
  $kan = LisansKoken $kanal
  $vars = LisansKoken $varsayilan
  $gir = LisansKoken $girilen
  $u = @()
  if ($null -ne $kayit) {
    $ham = "$kayit".Trim()
    if ($ham -ceq "") { $etkili = $vars; $kaynak = "kayit-varsayilan" }
    elseif ($ham.ToLowerInvariant() -ceq "kapali") { $etkili = "kapali"; $kaynak = "kayit" }
    else { $etkili = LisansKoken $ham; if (-not $etkili) { $etkili = "(bicim disi)" }; $kaynak = "kayit" }
    if ($gir -and $gir -cne $etkili) { $u += "cevaptaki lisans sunucusu ($gir) UYGULANMADI: kayittaki yapilandirma\.env korunur (onarim .env'i yeniden yazmaz)" }
  } elseif ("$girilen".Trim()) {
    $etkili = $gir; if (-not $etkili) { $etkili = "(bicim disi)" }
    $kaynak = $(if ($kan -and $gir -ceq $kan) { "kanal" } else { "cevap" })
  } elseif ($kan) { $etkili = $kan; $kaynak = "kanal" }
  else { $etkili = $vars; $kaynak = "varsayilan" }
  $metin = switch ($kaynak) {
    "kanal" { "kanal kaydi" }
    "cevap" { "elle girildi" }
    "kayit" { "kayittaki yapilandirma\.env" }
    "kayit-varsayilan" { "kayittaki .env'de satir yok: derleme varsayilani" }
    default { "derleme varsayilani" }
  }
  $goster = $(if ($etkili) { "$etkili ($metin)" } else { "derleme varsayilani" })
  if (-not $kan) {
    $u += "paket lisans saticisinin kanal degerini tasimiyor (eski ya da kanal-disi paket: PAKET.json backendLisansSunucusu yok) - etkin $goster; kanal kaydiyla karsilastirilamadi"
  } elseif ($etkili -cne $kan) {
    $ad = $(if ($kaynak -ceq "cevap") { "girilen" } elseif ($kaynak -cmatch '^kayit') { "kayittaki" } else { "etkin" })
    $duzelt = $(if ($kaynak -cmatch '^kayit') { "duzeltmek icin yapilandirma\.env'e LICENSE_SERVER_URL=$kan yazip backend hizmetini yeniden baslatin" } else { "yanlissa lisans sunucusu alanini bos birakin (bos = kanal)" })
    $u += "lisans sunucusu kanal kaydindan FARKLI: beklenen $kan (kanal $kanalAdi, dagitim kaydi), $ad $goster - kurulum surer; $duzelt"
  }
  $yaz = ($kaynak -ceq "cevap" -or $kaynak -ceq "kanal") -and [bool](LisansKoken $etkili) -and ($etkili -cne $vars)
  return [ordered]@{ etkili = $etkili; kaynak = $kaynak; kaynakMetni = $metin; yaz = [bool]$yaz; kanal = $kanal; varsayilan = $varsayilan; uyarilar = @($u) }
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

# Saglik: once YEREL uc (GET /health/yerel - yalniz dongu adresinden DOGRUDAN istege cevap verir; guncelleyicinin
# sondasi, GUNCELLEYICI.md b.8.7), uc yoksa (404 - eski backend) /health. Olcut ikisinde AYNI: 200 + status UP +
# db UP + version = beklenen. Vekil KAPALI: sistem vekili istegi dongu disindan iletirse /health/yerel 404 dondururdu.
function SaglikOku([int]$port, [string]$yol) {
  $r = [Net.HttpWebRequest]::Create("http://127.0.0.1:$port$yol")
  $r.Proxy = $null
  $r.Timeout = 5000
  $r.ReadWriteTimeout = 5000
  try {
    $y = $r.GetResponse()
    try { $o = New-Object IO.StreamReader($y.GetResponseStream()); return @{ kod = [int]$y.StatusCode; govde = $o.ReadToEnd() } } finally { $y.Close() }
  } catch [Net.WebException] {
    $h = $_.Exception.Response
    if ($h) { $k = [int]$h.StatusCode; $h.Close(); return @{ kod = $k; govde = "" } }
    return @{ kod = 0; govde = "" }
  }
}

function SaglikBekle([int]$port, [string]$surum, [int]$sn) {
  $son = $null
  $bitis = (Get-Date).AddSeconds($sn)
  while ((Get-Date) -lt $bitis) {
    $c = SaglikOku $port "/health/yerel"
    if ($c.kod -eq 404) { $c = SaglikOku $port "/health" }
    if ($c.kod -eq 200) {
      try {
        $j = $c.govde | ConvertFrom-Json
        $son = "status=$($j.status) db=$($j.db) version=$($j.version)"
        if ("$($j.status)" -ceq "UP" -and "$($j.db)" -ceq "UP" -and "$($j.version)" -ceq $surum) { return @{ tamam = $true; son = $son } }
      } catch { $son = "yanit JSON degil" }
    } else { $son = "HTTP $($c.kod)" }
    Start-Sleep -Seconds 2
  }
  return @{ tamam = $false; son = $son }
}
