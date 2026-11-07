# =============================================================================
# TeksERP - PostgreSQL AYAR BAKIMI (mevcut / harici kurulum) - KURU varsayilan
# =============================================================================
# NE: Kurulum PG ayar profilini calisan bir PostgreSQL'e ALTER SYSTEM ile uygular. Degerler TEK KAYNAKTAN:
#   deploy/pg/postgresql.tekserp.conf.sablon (sabit ayarlar) + deploy/pg/pg-ornegi.json (bellek formulu,
#   disk profili, uygulanacak alt kume `yapilandirma.hariciBakim`). Burada deger TEKRARLANMAZ.
#   Kime: eski installer'dan / ilk-kurulum duzeninden kalan harici PostgreSQL (kendi ornegi tekserp.conf'u
#   setup'tan alir, buna gerek duymaz).
#
# KIP: varsayilan KURU - yalniz "mevcut -> hedef" tablosu basilir, HICBIR SEY YAZILMAZ.
#   -Uygula: farkli ayarlar ALTER SYSTEM (postgresql.auto.conf) + pg_reload_conf() + uzanti.
#   Yeniden baslatma isteyen ayar (shared_buffers, shared_preload_libraries, pg_stat_statements.max) tabloda
#   [RESTART] ile isaretlenir. Betik PostgreSQL'i YENIDEN BASLATMAZ; gereken komutu soyler (vardiya disi).
#
# KURALLAR:
#   - Onceden ALTER SYSTEM ile konmus (postgresql.auto.conf) FARKLI deger EZILMEZ; tabloda "ezilmedi".
#   - shared_preload_libraries: uzanti kumede yoksa (pg_available_extensions) YA DA oturumda LOAD sondasi
#     duserse (DLL yok/uyumsuz) on yukleme + uzanti.* + CREATE EXTENSION YAZILMAZ - yuklenemeyen kutuphane on
#     yuklemede sunucuyu KALDIRMAZ. Var olan baska kutuphane korunur, uzanti sona eklenir. auto.conf'ta uzantiyi
#     icermeyen baska liste varsa ezilmez (elle komut ipucu); birlesim yalniz -Uygula -OnYuklemeBirlestir ile.
#   - Sira: CREATE EXTENSION ALTER SYSTEM'den ONCE (kutuphane yuklenemiyorsa hicbir ayar yazilmadan durur).
#     N. ALTER SYSTEM duserse oncekiler auto.conf'ta kalir, reload yapilmaz; nedeni duzeltip tekrar kos
#     (ayni degerler TAMAM/BEKLIYOR gorunur, yalniz kalanlar yazilir).
#   - CREATE EXTENSION yalniz hariciBakim.uzantiVeritabani'nda (postgres) - uygulama DB'sinde DEGIL (dokume
#     girer, super olmayan rolle geri yukleme kirilir); migration'a KONMAZ.
#   - Superuser ister (pg_file_settings + ALTER SYSTEM); degilse durur, kuru kipte de.
#
# CAGRI (yonetici PowerShell; dizinde pg-ornegi.json + postgresql.tekserp.conf.sablon bu betigin yaninda):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\pg-ayar.ps1 -PgBin "D:\PostgreSQL\16\bin" -Port 5432
#   ... -Uygula                  (yazar; sonra soylenen Restart-Service vardiya disinda)
#   ... -Disk HDD                (donen disk: random_page_cost profilden)
#   ... -Uygula -OnYuklemeBirlestir  (auto.conf'taki baska on yukleme listesine uzantiyi ekler)
#   -PgBin verilmezse calisan PostgreSQL hizmetinin yolundan (Win32_Service PathName) bulunur.
#   ... -ParolaDosyasi C:\gecici\pg.txt   (etkilesimsiz; yoksa gizli sorulur)
# CIKIS: 0 tamam (kuru kipte fark olsa da) - 1 hata/durdu.
# Bekci: node scripts/test_pg_ayar.mjs (sahte psql ile kuru kip yazmaz, -Uygula yazar, vektorler).
# =============================================================================
param(
  [string]$PgBin,
  [int]$Port = 5432,
  [string]$Kullanici = "postgres",
  [string]$Parola,
  [string]$ParolaDosyasi,
  [int]$RamMB = 0,
  [ValidateSet("SSD", "HDD")][string]$Disk = "SSD",
  [switch]$Uygula,
  # auto.conf'ta uzantiyi icermeyen baska shared_preload_libraries listesi varsa "liste + uzanti" yaz.
  [switch]$OnYuklemeBirlestir,
  # Yalniz hedef degerleri JSON basar, PostgreSQL'e baglanmaz (bekci: diller arasi altin vektorler).
  [switch]$YalnizHedef
)
$ErrorActionPreference = "Stop"

function Ok($m)   { Write-Host "  + $m" -ForegroundColor Green }
function Uyar($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Dur($m)  { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; Write-Host ""; exit 1 }

# --- Tek kaynak: pg-ornegi.json + conf sablonu (betigin yaninda) ----------------
$ornekYolu = Join-Path $PSScriptRoot "pg-ornegi.json"
if (-not (Test-Path -LiteralPath $ornekYolu)) { Dur "pg-ornegi.json bulunamadi: $ornekYolu (betik deploy\pg klasoruyle birlikte kopyalanir)" }
$ornek = [IO.File]::ReadAllText($ornekYolu) | ConvertFrom-Json
$y = $ornek.yapilandirma
$sablonYolu = Join-Path $PSScriptRoot (Split-Path -Leaf ([string]$y.confSablonu))
if (-not (Test-Path -LiteralPath $sablonYolu)) { Dur "conf sablonu bulunamadi: $sablonYolu" }
$hb = $y.hariciBakim
if (-not $hb -or -not $hb.ayarlar) { Dur "pg-ornegi.json yapilandirma.hariciBakim yok - surumler uyusmuyor" }
$uzanti = [string]$hb.uzanti
$uzantiVt = [string]$hb.uzantiVeritabani

# Bellek: pg-ornegi.json formulu (lib/pg-ornegi.mjs bellekHesapla ile ayni; vektorler ikisini de olcer).
function MbBicim([long]$mb) {
  if ($mb % 1024 -eq 0) { return "$([long]($mb / 1024))GB" }
  return "${mb}MB"
}
function BellekHesapla([long]$ram) {
  $s = [ordered]@{}
  foreach ($p in $y.bellek.PSObject.Properties) {
    $f = $p.Value
    if ($null -ne $f.bolen) { $mb = [long][math]::Floor($ram / [long]$f.bolen) }
    else { $mb = [long][math]::Floor(($ram * [long]$f.yuzde) / 100) }
    if ($mb -lt [long]$f.altMB) { $mb = [long]$f.altMB }
    if ($null -ne $f.ustMB -and $mb -gt [long]$f.ustMB) { $mb = [long]$f.ustMB }
    $s[$p.Name] = MbBicim $mb
  }
  return $s
}

# conf satiri: ad = deger; '#' yorumu tirnak disinda kesilir; tek tirnak soyulur (lib confAyristir ile ayni).
function SablonAyarlari([string]$metin, $degerler) {
  $a = @{}
  foreach ($ham in ($metin -csplit "`n")) {
    $satir = $ham
    $tirnak = $false
    for ($i = 0; $i -lt $satir.Length; $i++) {
      $c = $satir[$i]
      if ($c -eq "'") { $tirnak = -not $tirnak }
      elseif ($c -eq '#' -and -not $tirnak) { $satir = $satir.Substring(0, $i); break }
    }
    $satir = $satir.Trim()
    if (-not $satir) { continue }
    if ($satir -cmatch '^([A-Za-z_][A-Za-z0-9_.]*)\s*(?:=\s*|\s+)(.*)$') {
      $v = $Matches[2].Trim()
      if ($v.Length -ge 2 -and $v[0] -eq "'" -and $v[-1] -eq "'") { $v = $v.Substring(1, $v.Length - 2) }
      foreach ($k in $degerler.Keys) { $v = $v.Replace("{{$k}}", [string]$degerler[$k]) }
      $a[$Matches[1].ToLowerInvariant()] = $v
    }
  }
  return $a
}

# --- RAM + hedefler -----------------------------------------------------------
if ($RamMB -le 0) {
  try { $RamMB = [int][math]::Floor((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1MB) } catch { $RamMB = 0 }
  if ($RamMB -le 0) { Dur "RAM olculemedi - bellek hedefi hesaplanamaz. -RamMB <MB> ver." }
}
if ($RamMB -lt 256) { Dur "RAM $RamMB MB - en az 256 bekleniyor" }
$diskAd = $Disk.ToLowerInvariant()
$diskProfil = $y.disk.profiller.PSObject.Properties[$diskAd]
if (-not $diskProfil) { Dur "disk profili '$diskAd' pg-ornegi.json'da yok" }
$degerler = BellekHesapla $RamMB
foreach ($p in $diskProfil.Value.PSObject.Properties) { $degerler[$p.Name] = [string]$p.Value }
$sablon = SablonAyarlari ([IO.File]::ReadAllText($sablonYolu)) $degerler
$hedef = [ordered]@{}
foreach ($ad in @($hb.ayarlar)) {
  if (-not $sablon.ContainsKey($ad)) { Dur "hariciBakim ayari '$ad' sablonda yok" }
  if ($sablon[$ad] -cmatch '\{\{|\}\}') { Dur "'$ad' doldurulmamis yer tutucu tasiyor: $($sablon[$ad])" }
  $hedef[$ad] = $sablon[$ad]
}
$yeniden = @($hb.yenidenBaslatma)

if ($YalnizHedef) {
  [pscustomobject]$hedef | ConvertTo-Json -Compress
  exit 0
}

# --- psql ---------------------------------------------------------------------
# PgBin yoksa: calisan PostgreSQL hizmetinin ikili yolu (sunucunun KENDI bin'i; C:\TeksERP\pgsql yalniz istemci
# kopyasi olabilir). Birden cok hizmet calisiyorsa tahmin edilmez, -PgBin istenir.
if (-not $PgBin) {
  $hizmetler = @()
  try {
    $hizmetler = @(Get-CimInstance Win32_Service -ErrorAction Stop | Where-Object { $_.State -eq "Running" -and ([string]$_.PathName) -cmatch '(?i)\\(pg_ctl|postgres)\.exe' })
  } catch { $hizmetler = @() }
  $yollar = @($hizmetler | ForEach-Object {
    $yol = [string]$_.PathName
    $exe = if ($yol -cmatch '^\s*"([^"]+)"') { $Matches[1] } elseif ($yol -cmatch '^\s*(\S+)') { $Matches[1] } else { "" }
    if ($exe) { Split-Path -Parent $exe }
  } | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "psql.exe")) } | Sort-Object -Unique)
  if ($yollar.Count -gt 1) { Dur "birden cok PostgreSQL hizmeti calisiyor ($($yollar -join ' ; ')) - hedefi -PgBin ve -Port ile ver." }
  if ($yollar.Count -eq 1) { $PgBin = $yollar[0]; Write-Host "  PgBin hizmet yolundan: $PgBin" }
}
if (-not $PgBin) {
  $aday = @("C:\TeksERP\pgsql\bin") + @(Get-ChildItem -Path "C:\Program Files\PostgreSQL\*\bin" -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object { $_.FullName })
  $PgBin = $aday | Where-Object { Test-Path -LiteralPath (Join-Path $_ "psql.exe") } | Select-Object -First 1
  if (-not $PgBin) { Dur "psql bulunamadi. Yolu ver: -PgBin `"D:\PostgreSQL\16\bin`"" }
}
$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path -LiteralPath $psql)) { $psql = Join-Path $PgBin "psql" }
if (-not (Test-Path -LiteralPath $psql)) { Dur "psql yok: $PgBin" }

if ($Parola -and $ParolaDosyasi) { Dur "hem -Parola hem -ParolaDosyasi verildi - birini sec." }
if ($ParolaDosyasi) {
  if (-not (Test-Path -LiteralPath $ParolaDosyasi)) { Dur "parola dosyasi yok: $ParolaDosyasi" }
  $Parola = ([IO.File]::ReadAllText((Resolve-Path -LiteralPath $ParolaDosyasi).Path)).TrimEnd("`r", "`n")
} elseif ($Parola) {
  Uyar "-Parola komut satirinda: PowerShell gecmisine dusebilir (-ParolaDosyasi ya da soru tercih edilir)"
} else {
  $g = Read-Host -AsSecureString "PostgreSQL yonetici ($Kullanici) parolasi"
  $Parola = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($g))
}

# ilk-kurulum.ps1 NativeArg / Psql kalibi: PGPASSWORD cagri basina, EAP Continue (stderr metne).
function NativeArg([string]$s) {
  $pas = Get-Variable -Name PSNativeCommandArgumentPassing -ValueOnly -ErrorAction SilentlyContinue
  if ($PSVersionTable.PSVersion.Major -ge 7 -and $pas -and $pas -ne "Legacy") { return $s }
  return ($s -creplace '(\\*)"', '$1$1\"')
}
function Psql($veritabani, $sorgu) {
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $Parola
  try {
    $c = & $psql -h 127.0.0.1 -p $Port -U $Kullanici -d $veritabani -v ON_ERROR_STOP=1 -tAc (NativeArg $sorgu) 2>&1
    $kod = $LASTEXITCODE
    $satirlar = @($c | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" } })
    return [pscustomobject]@{ kod = $kod; cikti = ($satirlar -join "`n").Trim() }
  } finally {
    $env:PGPASSWORD = ""
    $ErrorActionPreference = $eskiEAP
  }
}
function Satirlar($r) { return @($r.cikti -csplit "`n" | Where-Object { $_ -cmatch '\|' }) }
function Lit([string]$s) { return "'" + ($s -creplace "'", "''") + "'" }

# Karsilastirma birimden bagimsiz: bellek kB'a, sure ms'ye; liste (on yukleme) sirali kume.
function Normal([string]$ad, [string]$v) {
  $v = $v.Trim()
  if ($ad -ceq "shared_preload_libraries") { return ((@($v -csplit ',' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ }) | Sort-Object) -join ',') }
  if ($v -cmatch '^(\d+)\s*(kB|MB|GB|TB)$') { $k = @{ kB = 1; MB = 1024; GB = 1048576; TB = 1073741824 }[$Matches[2]]; return "$([long]$Matches[1] * $k)kB" }
  if ($v -cmatch '^(\d+)\s*(ms|s|min|h|d)$') { $k = @{ ms = 1; s = 1000; min = 60000; h = 3600000; d = 86400000 }[$Matches[2]]; return "$([long]$Matches[1] * $k)ms" }
  return $v
}

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP - PostgreSQL ayar bakimi ($(if ($Uygula.IsPresent) { 'UYGULA' } else { 'KURU - yazmaz' }))"
Write-Host "================================================================"
Write-Host "  psql : $psql  (127.0.0.1:$Port, $Kullanici)"
Write-Host "  RAM  : $RamMB MB  -  disk: $Disk"

$su = Psql "postgres" "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
if ($su.kod -ne 0) { Dur "PostgreSQL'e baglanilamadi: $($su.cikti)" }
if ($su.cikti -cne "t") { Dur "'$Kullanici' superuser degil - pg_file_settings okunamaz, ALTER SYSTEM yazilamaz." }

$adlar = ($hedef.Keys | ForEach-Object { Lit $_ }) -join ","
$mevcut = @{}
foreach ($s in (Satirlar (Psql "postgres" "SELECT lower(name) || '|' || current_setting(name) || '|' || context FROM pg_settings WHERE lower(name) IN ($adlar)"))) {
  $p = $s -csplit '\|', 3
  $mevcut[$p[0]] = [pscustomobject]@{ deger = $p[1]; baglam = $p[2] }
}
# postgresql.auto.conf'taki (ALTER SYSTEM) degerler; son satir kazanir.
$oto = @{}
foreach ($s in (Satirlar (Psql "postgres" "SELECT lower(name) || '|' || coalesce(setting, '') FROM pg_file_settings WHERE sourcefile LIKE '%postgresql.auto.conf' ORDER BY seqno"))) {
  $p = $s -csplit '\|', 2
  $oto[$p[0]] = $p[1]
}
$uzantiVar = (Psql "postgres" "SELECT count(*) FROM pg_available_extensions WHERE name = $(Lit $uzanti)").cikti -ceq "1"
$uzantiNeden = "$uzanti kumede yok (pg_available_extensions)"
if ($uzantiVar) {
  # .control var diye DLL yuklenir demek degil: LOAD yalniz bu oturuma, kalici iz birakmaz (kuru kipte de).
  $yukle = Psql "postgres" "LOAD $(Lit $uzanti)"
  if ($yukle.kod -ne 0) { $uzantiVar = $false; $uzantiNeden = "kutuphane yuklenemedi (LOAD): $($yukle.cikti -creplace '\s+', ' ')" }
}
$uzantiKurulu = (Psql $uzantiVt "SELECT count(*) FROM pg_extension WHERE extname = $(Lit $uzanti)").cikti -ceq "1"

# On yukleme: var olan kutuphaneler korunur, uzanti sona eklenir. Taban: auto.conf (restart sonrasi gecerli olan)
# varsa o, yoksa su anki deger. auto.conf listesi uzantiyi icermiyorsa ezilmez (yalniz -OnYuklemeBirlestir).
function ListeOku([string]$v) { return @($v -csplit ',' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ }) }
$onYukleme = @()
$otoListe = $oto.ContainsKey("shared_preload_libraries")
if ($otoListe) { $onYukleme = ListeOku $oto["shared_preload_libraries"] }
elseif ($mevcut.ContainsKey("shared_preload_libraries")) { $onYukleme = ListeOku $mevcut["shared_preload_libraries"].deger }
$onYuklemeEngel = $otoListe -and ($onYukleme -cnotcontains $uzanti) -and -not $OnYuklemeBirlestir
$birlestir = $otoListe -and ($onYukleme -cnotcontains $uzanti) -and $OnYuklemeBirlestir
if ($onYuklemeEngel) { $uzantiNeden = "auto.conf'taki on yukleme listesi uzantiyi icermiyor (ezilmedi) - uzanti ayarlari da atlandi" }
if ($hedef.Contains("shared_preload_libraries")) {
  $istenen = @($hedef["shared_preload_libraries"] -csplit ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $liste = @($onYukleme)
  foreach ($k in $istenen) { if ($liste -cnotcontains $k) { $liste += $k } }
  $hedef["shared_preload_libraries"] = $liste -join ', '
}

$satirlar = @()
foreach ($ad in $hedef.Keys) {
  $h = [string]$hedef[$ad]
  $m = if ($mevcut.ContainsKey($ad)) { [string]$mevcut[$ad].deger } else { $null }
  $restart = ($yeniden -ccontains $ad) -or ($mevcut.ContainsKey($ad) -and $mevcut[$ad].baglam -ceq "postmaster")
  $durum = "YAZILACAK"
  $uzantiAyari = ($ad -ceq "shared_preload_libraries" -or $ad.StartsWith("$uzanti."))
  if (-not $uzantiVar -and $uzantiAyari) { $durum = "ATLANDI" }
  elseif ($ad -ceq "shared_preload_libraries" -and $onYuklemeEngel) { $durum = "EZILMEDI" }
  elseif ($onYuklemeEngel -and $uzantiAyari) { $durum = "ATLANDI" }
  elseif ($ad -ceq "shared_preload_libraries" -and $birlestir) { $durum = "YAZILACAK" }
  elseif ($oto.ContainsKey($ad)) {
    if ((Normal $ad $oto[$ad]) -ceq (Normal $ad $h)) { $durum = if ($null -ne $m -and (Normal $ad $m) -ceq (Normal $ad $h)) { "TAMAM" } else { "BEKLIYOR" } }
    else { $durum = "EZILMEDI" }
  }
  elseif ($null -ne $m -and (Normal $ad $m) -ceq (Normal $ad $h)) { $durum = "TAMAM" }
  $satirlar += [pscustomobject]@{ ad = $ad; mevcut = $(if ($null -eq $m) { "(yok)" } elseif ($m -ceq "") { "(bos)" } else { $m }); hedef = $h; durum = $durum; restart = $restart }
}

Write-Host ""
Write-Host ("  {0,-30} {1,-22} {2,-22} {3}" -f "ayar", "mevcut", "hedef", "durum")
Write-Host ("  {0,-30} {1,-22} {2,-22} {3}" -f "----", "------", "-----", "-----")
foreach ($r in $satirlar) {
  $not = switch ($r.durum) {
    "EZILMEDI" {
      $n = "ALTER SYSTEM ile farkli deger var ($($oto[$r.ad])), ezilmedi"
      if ($r.ad -ceq "shared_preload_libraries") { $n += " - birlestirmek icin -Uygula -OnYuklemeBirlestir ya da elle: ALTER SYSTEM SET shared_preload_libraries = $((@($r.hedef -csplit ',' | ForEach-Object { Lit $_.Trim() })) -join ', ')" }
      $n
    }
    "ATLANDI"  { "$uzantiNeden - on yukleme yazilmaz" }
    "BEKLIYOR" { "yazili (postgresql.auto.conf), yeniden baslatma/yukleme bekliyor" }
    default    { $r.durum }
  }
  if ($r.restart -and $r.durum -cne "TAMAM") { $not += "  [RESTART]" }
  Write-Host ("  {0,-30} {1,-22} {2,-22} {3}" -f $r.ad, $r.mevcut, $r.hedef, $not)
}
$uzantiYaz = $uzantiVar -and -not $onYuklemeEngel -and -not $uzantiKurulu
$uzNot = if (-not $uzantiVar -or $onYuklemeEngel) { "ATLANDI ($uzantiNeden)" } elseif ($uzantiKurulu) { "TAMAM" } else { "YAZILACAK (CREATE EXTENSION)" }
Write-Host ("  {0,-30} {1,-22} {2,-22} {3}" -f "uzanti $uzanti", $(if ($uzantiKurulu) { "kurulu" } else { "yok" }), "kurulu ($uzantiVt DB)", $uzNot)

$yazilacak = @($satirlar | Where-Object { $_.durum -ceq "YAZILACAK" })
$bekleyen = @($satirlar | Where-Object { $_.restart -and $_.durum -ceq "BEKLIYOR" } | ForEach-Object { $_.ad })

# Yazan TEK dal: KURU kip (varsayilan) bu blok disinda yazan SQL calistirmaz (bekci N1 sondasi).
if ($Uygula) {
  Write-Host ""
  # Uzanti ONCE: CREATE EXTENSION kutuphaneyi yukler; duserse hicbir ALTER SYSTEM yazilmadan durulur.
  if ($uzantiYaz) {
    $a = Psql $uzantiVt "CREATE EXTENSION IF NOT EXISTS $uzanti"
    if ($a.kod -ne 0) { Dur "CREATE EXTENSION $uzanti ($uzantiVt) basarisiz - HICBIR AYAR YAZILMADI: $($a.cikti)" }
    Ok "uzanti kuruldu: $uzanti ($uzantiVt veritabani; uygulama DB'sine DEGIL)"
  }
  foreach ($r in $yazilacak) {
    # Liste ayari (on yukleme) her ogeyi AYRI literal ister: tek literal 'a, b' tek kutuphane adi sayilir.
    $deger = if ($r.ad -ceq "shared_preload_libraries") { (@($r.hedef -csplit ',' | ForEach-Object { Lit $_.Trim() })) -join ', ' } else { Lit $r.hedef }
    $a = Psql "postgres" "ALTER SYSTEM SET $($r.ad) = $deger"
    if ($a.kod -ne 0) { Dur "$($r.ad) yazilamadi: $($a.cikti)" }
    Ok "yazildi: $($r.ad) = $($r.hedef)  (onceki $($r.mevcut))"
    if ($r.restart) { $bekleyen += $r.ad }
  }
  $a = Psql "postgres" "SELECT pg_reload_conf()"
  if ($a.kod -ne 0) { Dur "pg_reload_conf basarisiz: $($a.cikti)" }
  foreach ($s in @((Psql "postgres" "SELECT lower(name) FROM pg_settings WHERE pending_restart ORDER BY 1").cikti -csplit "`n" | Where-Object { $_ })) {
    if ($bekleyen -cnotcontains $s) { $bekleyen += $s }
  }
  Ok "ayarlar yeniden yuklendi (pg_reload_conf)"
} else {
  Write-Host ""
  if ($yazilacak.Count) { Uyar "KURU: $($yazilacak.Count) ayar yazilacak - HICBIR SEY YAZILMADI. Uygulamak icin ayni komuta -Uygula ekle." }
  else { Ok "KURU: yazilacak ayar yok." }
}

$bekleyen = @($bekleyen | Sort-Object -Unique)
if ($bekleyen.Count) {
  $servis = "<postgresql hizmeti>"
  try {
    $hs = @(Get-Service -Name "postgresql*", "TeksERP-PostgreSQL*" -ErrorAction Stop | Where-Object { $_.Status -eq "Running" })
    if ($hs.Count -eq 1) { $servis = $hs[0].Name }
  } catch { $servis = "<postgresql hizmeti>" }
  $kip = if ($Uygula.IsPresent) { "etkin olmasi icin" } else { "-Uygula sonrasi" }
  Uyar "YENIDEN BASLATMA GEREKLI ($kip): $($bekleyen -join ', ')"
  Write-Host "    Vardiya disinda:  Restart-Service $servis   (bu betik yeniden BASLATMAZ; backend kisa sure baglanti kaybeder)"
} elseif ($Uygula.IsPresent) {
  Ok "yeniden baslatma gerekmiyor"
}
exit 0
