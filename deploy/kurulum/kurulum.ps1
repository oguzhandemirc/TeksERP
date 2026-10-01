# =============================================================================
# TeksERP SUNUCU KURULUMU - ASAMA KOSUCUSU (TeksERP-Kurulum.exe cagirir; bayi ayni betigi sessiz kosar)
# =============================================================================
# NE YAPAR: fabrika sunucusuna Windows hizmeti duzeninde (Dagitim v2) SIFIRDAN kurulum ya da AYNI
#   surumun ONARIMI. Asamalar sirayla, her biri olcerek ilerler; olculemeyen adim DURUR (tahmin yok):
#     OnKosul    yonetici - Windows x64 - cevap dosyasi (cevap-semasi.json, KATI, sirsiz) - kok/veri
#                dizini kurallari - paket girdileri - portlar (API mesgulse DUR; PG portSec) - RAM/disk
#     Paket      kok ACL (genis grup yok) - backend paketi KURULUMUN KENDI dogrulayicisiyla (tekserp-
#                guncelleyici kurulum-paket: imza + imzali listedeki her dosya) surumler\<surum>'e -
#                current baglantisi - hizmet\backend-hizmeti.ps1 -Uygula -YalnizIskelet (SIRDAN ONCE)
#     PostgreSQL kendi ornek (D4 KENDI-POSTGRESQL.md b.4): PG paketi (kurulum-pg: kunye imzasi + zip
#                ozeti + icerik manifestosu + tek ICU) pgsql\<surum>-<derleme>'ye - pgsql\bin baglantisi -
#                initdb (parola ACL'li gecici dosyadan) - tekserp.conf + pg_hba.conf (pg-sablon.mjs) -
#                pg_ctl register (sanal hesap) - veri dizini ACL (KAYITTAN SONRA) - baslat + olcum - roller
#                + DB + DB ayarlari - .env + db-credentials.json - postgres parolasi DPAPI - ornek.json
#     Backend    prisma migrate deploy (paketin kendi Node'u) + goc sayisi - bakim rolu (bakim-rolu.ps1) -
#                yedek sifreleme (musteri anahtari dosyaya)
#     Hizmetler  hizmet\backend-hizmeti.ps1 -Uygula (kayit -> ACL) - hizmet\guncelleyici-hizmeti.ps1 -Uygula -
#                gece yedegi gorevi (<KOK>\yedekle.ps1) - guvenlik duvari (API yalniz LocalSubnet [+Tailscale],
#                mDNS; PG'ye kural YOK) - baslat: /health 200 UP/UP/surum - guncelleyici durum.json
#     Sirlar     YALNIZ sihirbaz: STDIN'den JSON (satici parolasi + PIN, yedek parolasi) -> araclara STDIN'den;
#                musteri yedek anahtari ekranda gosterilecekse SONUC satirinda doner. Gunluge sir GIRMEZ.
#     Dogrulama  hizmetler - saglik - izin katalogu (boot uzlastirmasi) - ACL olcumu - kurulum.json
#   Hepsi = OnKosul..Dogrulama (Sirlar haric) - bayinin sessiz kipi.
#
# KULLANIM (YONETICI; 5.1 yurutme ilkesi icin -ExecutionPolicy Bypass):
#   powershell -NoProfile -ExecutionPolicy Bypass -File <KOK>\kurulum\deploy\kurulum\kurulum.ps1 `
#     -Asama Hepsi -Cevap <cevap.json> -Kaynak <paketlerin klasoru> [-Dogrulayici <exe>] [-Kuru]
#   -Kuru: yalniz OnKosul olcer ve PLANI basar; hicbir sey yazmaz.
# CIKIS: 0 tamam - 1 DUR (gunlukte sebep) - 2 cevap dosyasi gecersiz.
# SON SATIR: "SONUC:{json}" (sihirbaz okur; sir yalniz Sirlar asamasinda ve yalniz musteri anahtari).
# ASCII + PS 5.1: Teks-Erp/scripts/test_sunucu_betikleri.ts ve test_kurulum_betikleri.ts olcer.
# =============================================================================
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Hepsi", "OnKosul", "Paket", "PostgreSQL", "Backend", "Hizmetler", "Sirlar", "Dogrulama")]
  [string]$Asama,
  [Parameter(Mandatory = $true)][string]$Cevap,
  [string]$Kaynak,
  [string]$Dogrulayici,
  [string]$Gunluk,
  [switch]$Kuru
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "kurulum-ortak.ps1")

$KURULUM_BICIMI = 1
$PG_DIZINI = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\pg"))
if (-not $Dogrulayici) { $Dogrulayici = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\araclar\tekserp-guncelleyici.exe")) }
if (-not $Kaynak) { $Kaynak = Split-Path -Parent ([IO.Path]::GetFullPath($Cevap)) }
$script:Sonuc = [ordered]@{ asama = $Asama; tamam = $false }

# --- Cevap + adlar ------------------------------------------------------------------------------
function CevabiYukle {
  $sema = JsonOku (Join-Path $PSScriptRoot "cevap-semasi.json")
  $c = JsonOku $Cevap
  $r = CevapDogrula $c $sema
  if ($r.hatalar.Count) {
    foreach ($h in $r.hatalar) { [void](GunlugeYaz "CEVAP" $h); Write-Host "  X  cevap: $h" -ForegroundColor Red }
    $script:CevapGecersiz = $true
    Dur "cevap dosyasi gecersiz ($($r.hatalar.Count) hata): $Cevap"
  }
  return $r.deger
}

# Hizmet adlari kanaldan (paketin backendHizmetAdi = kanal kaydi backend.hizmetAdi): varsayilan ad ya da
# "TeksERP-Backend-<kanal>". Son ek (-<kanal>) ikinci kanalin HER adina gecer: guncelleyici, PG, veri koku,
# gorev, AppId (GUNCELLEYICI.md b.4.2: ayni makinede iki kanal ne hizmet ne IPC paylasir).
function AdlariCoz([string]$backendAdi, $musteri, $pgOrnek) {
  if (-not $backendAdi) { $backendAdi = "TeksERP-Backend" }
  if ($backendAdi -cnotmatch '^TeksERP-Backend(-[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$') { Dur "backend hizmet adi kanal kuralina uymuyor: $backendAdi" }
  $sonek = $backendAdi.Substring("TeksERP-Backend".Length)
  if ($sonek -and $musteri -and ($sonek -cne "-$musteri")) { Dur "hizmet adi ($backendAdi) paketin imzali kanalina ($musteri) ait degil" }
  return [ordered]@{
    backend      = $backendAdi
    sonek        = $sonek
    guncelleyici = "TeksERP-Guncelleyici$sonek"
    pg           = "$($pgOrnek.hizmet.ad)$sonek"
    veriKoku     = Join-Path $env:ProgramData "TeksERP$sonek"
    gorev        = "TeksERP-DB-Backup$sonek"
    mdnsKurali   = "TeksERP mDNS$sonek"
  }
}

# --- Durum (asamalar arasi, SIRSIZ) ---------------------------------------------------------------
function DurumYolu([string]$kok) { return Join-Path (Join-Path $kok "kurulum") "durum.json" }
function DurumOku([string]$kok) {
  $y = DurumYolu $kok
  if (-not (Test-Path -LiteralPath $y)) { Dur "durum.json yok - once OnKosul asamasi: $y" }
  return (Get-Content -LiteralPath $y -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function DurumYaz([string]$kok, $durum) {
  $d = Join-Path $kok "kurulum"
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  MetinYaz (DurumYolu $kok) (($durum | ConvertTo-Json -Depth 8) + "`n")
}
function AsamaBitti($durum, [string]$ad) {
  $durum.asamalar | Add-Member -NotePropertyName $ad -NotePropertyValue ((Get-Date).ToUniversalTime().ToString("o")) -Force
  $onceki = @(); if ($durum.PSObject.Properties["uyarilar"]) { $onceki = @($durum.uyarilar) }
  $durum | Add-Member -NotePropertyName uyarilar -NotePropertyValue (@($onceki) + @($script:Uyarilar) | Select-Object -Unique) -Force
}

# --- Paket girdileri --------------------------------------------------------------------------
function GirdiCoz([string]$verilen, [string]$desen, [string]$ne) {
  if ($verilen) {
    $y = if ([IO.Path]::IsPathRooted($verilen)) { $verilen } else { Join-Path $Kaynak $verilen }
    if (-not (Test-Path -LiteralPath $y -PathType Leaf)) { Dur "$ne yok: $y" }
    return [IO.Path]::GetFullPath($y)
  }
  $bulunan = @(Get-ChildItem -LiteralPath $Kaynak -Filter $desen -File -ErrorAction SilentlyContinue)
  if ($bulunan.Count -ne 1) { Dur "$ne $Kaynak klasorunde TEK olmali (${desen}: $($bulunan.Count) dosya) - cevap dosyasinda paket.* ile verin" }
  return $bulunan[0].FullName
}

# Zip'teki PAKET.json (IMZASIZ - yalniz plan/gosterim; karar imzali kunyeden ve acilmis dizinden verilir).
function PaketKunyesiOku([string]$zip) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $a = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $g = $a.GetEntry("PAKET.json")
    if (-not $g) { Dur "paket PAKET.json tasimiyor: $zip" }
    $r = New-Object IO.StreamReader($g.Open(), [Text.Encoding]::UTF8)
    try { return ($r.ReadToEnd() | ConvertFrom-Json) } finally { $r.Dispose() }
  } finally { $a.Dispose() }
}

# Kurulumun KENDI dogrulayicisi (setup.exe icinden; paketin ikilisi kendini dogrulayamaz).
function Dogrula([string[]]$arglar) {
  if (-not (Test-Path -LiteralPath $Dogrulayici -PathType Leaf)) { Dur "kurulum dogrulayicisi yok: $Dogrulayici" }
  $r = NativeKos $Dogrulayici $arglar
  $satir = @($r.cikti -csplit "`n" | Where-Object { $_.Trim().StartsWith("{") }) | Select-Object -Last 1
  if (-not $satir) { Dur "dogrulayici yanit vermedi (cikis $($r.kod)): $($r.cikti)" }
  $j = $satir | ConvertFrom-Json
  if ($j.tamam -ne $true) { Dur "DOGRULAMA DUSTU [$($j.kod)]: $($j.mesaj)" }
  return $j
}

# --- Node araclari (paketin KENDI runtime\node.exe'si) --------------------------------------
# Ortam degiskeni yalniz cagri suresince; NODE_OPTIONS SILINIR (yukleyici enjeksiyonu). $stdin verilirse
# araca STDIN'den gider (ASCII; parola argv'ye/ortama girmez). stdout ve stderr ayri doner.
function NodeKos([string]$node, [string[]]$arglar, [string]$cwd, [hashtable]$ortam, [string]$stdin) {
  $eski = @{}
  $eskiOpt = $env:NODE_OPTIONS
  $eskiEAP = $ErrorActionPreference
  $eskiKod = $OutputEncoding
  $ErrorActionPreference = "Continue"
  Push-Location -LiteralPath $cwd
  try {
    foreach ($k in @($ortam.Keys)) { $eski[$k] = [Environment]::GetEnvironmentVariable($k, "Process"); [Environment]::SetEnvironmentVariable($k, [string]$ortam[$k], "Process") }
    [Environment]::SetEnvironmentVariable("NODE_OPTIONS", $null, "Process")
    $OutputEncoding = New-Object Text.UTF8Encoding $false
    if ($null -ne $stdin) { $c = $stdin | & $node @arglar 2>&1 } else { $c = & $node @arglar 2>&1 }
    $kod = $LASTEXITCODE
    $out = @(); $err = @()
    foreach ($x in @($c)) { if ($x -is [System.Management.Automation.ErrorRecord]) { $err += $x.Exception.Message } else { $out += "$x" } }
    return [pscustomobject]@{ kod = $kod; stdout = ($out -join "`n"); stderr = ($err -join "`n") }
  } finally {
    foreach ($k in @($eski.Keys)) { [Environment]::SetEnvironmentVariable($k, $eski[$k], "Process") }
    [Environment]::SetEnvironmentVariable("NODE_OPTIONS", $eskiOpt, "Process")
    $OutputEncoding = $eskiKod
    Pop-Location
    $ErrorActionPreference = $eskiEAP
  }
}

# --- psql (parola cagri basina ortamdan, SQL STDIN'den - argv'ye sir girmez) --------------------
function PsqlStdin([string]$bin, [int]$port, [string]$kullanici, [string]$parola, [string]$vt, [string]$sql) {
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $parola
  try {
    $c = $sql | & (Join-Path $bin "psql.exe") -X -w -h 127.0.0.1 -p $port -U $kullanici -d $vt -v ON_ERROR_STOP=1 -tA -f - 2>&1
    $kod = $LASTEXITCODE
    $satirlar = @($c | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" } })
    return [pscustomobject]@{ kod = $kod; cikti = ($satirlar -join "`n").Trim() }
  } finally {
    $env:PGPASSWORD = ""
    $ErrorActionPreference = $eskiEAP
  }
}

# .env yapilandirma\ dizininin MIRASINI alir (iskelet SYSTEM + Administrators; backend-hizmeti.ps1 -Uygula
# hizmet hesabina okuma verir). Korumali DACL KONMAZ: konursa hizmet hesabi .env'i okuyamaz. Dizin genis
# gruplara aciksa (iskelet kurulmamis) sir YAZILMAZ; yazilan dosya da olculur.
# SADE BICIM (iki okuyucu - dotenv ve guncelleyicinin envfile.rs'i - ayni okusun): KEY=deger, tirnak YOK,
# deger bosluksuz, '#' ve ters bolu YOK (yollar '/' ile). Kurulumun yazdigi her satir bu kalibi gecer.
$script:ENV_SATIRI = '^[A-Z_][A-Z0-9_]*=[^\s"''#\\]*$'
function EnvYaz([string]$yol, [string]$metin) {
  foreach ($satir in ($metin -csplit "`n")) {
    if ($satir -and $satir -cnotmatch $script:ENV_SATIRI -and $satir -cnotmatch '^BACKUP_PG_(USER|PASSWORD)=') { Dur ".env satiri sade bicimde degil (tirnak/bosluk/#/ters bolu): $(($satir -csplit '=', 2)[0])=..." }
  }
  $dizin = Split-Path -Parent $yol
  if ((GenisAceler $dizin @()).Count) { Dur "yapilandirma\ genis gruplara acik - sir yazilmadi (once backend-hizmeti.ps1 -Uygula -YalnizIskelet)" }
  MetinYaz $yol $metin
  if ((GenisAceler $yol @()).Count) { Dur ".env genis gruplara acik: $yol" }
}

# .env degeri: ilk eslesen satir, cevreleyen tirnak soyulur, anahtar buyuk/kucuk harf DUYARLI.
function EnvDeger($satirlar, $ad) {
  foreach ($l in $satirlar) {
    if ($l -cmatch ('^\s*' + $ad + '\s*=\s*(.*)$')) {
      $v = $Matches[1].Trim()
      if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) { $v = $v.Substring(1, $v.Length - 2) }
      return $v
    }
  }
  return $null
}

# =============================================================================
# ASAMALAR
# =============================================================================

function AsamaOnKosul {
  Baslik "OnKosul - olcum (degisiklik yok)"
  if (-not (YoneticiMi)) { Dur "YONETICI olarak calistirin (hizmet kaydi, izinler, guvenlik duvari)." }
  $os = [Environment]::OSVersion.Version
  if ($os.Major -lt 10 -or $os.Build -lt 14393 -or -not [Environment]::Is64BitOperatingSystem) { Dur "Windows 10/11 ya da Server 2016+ x64 gerekir (olculen $os)." }
  $C = CevabiYukle
  $kok = [IO.Path]::GetFullPath($C["kok"]).TrimEnd('\')
  foreach ($y in @($env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData, "$env:SystemDrive\Users")) {
    if ($y -and ($kok.ToLowerInvariant() -ceq [IO.Path]::GetFullPath($y).TrimEnd('\').ToLowerInvariant() -or $kok.ToLowerInvariant().StartsWith([IO.Path]::GetFullPath($y).TrimEnd('\').ToLowerInvariant() + "\"))) { Dur "kok bir sistem dizini (ya da altinda) olamaz: $kok" }
  }
  if (ReparseMi $kok) { Dur "kok bir baglanti noktasi (junction) olamaz: $kok" }
  $kayit = Join-Path $kok "kurulum\kurulum.json"
  $onarim = Test-Path -LiteralPath $kayit
  if (-not $onarim -and (Test-Path -LiteralPath $kok)) {
    $yabanci = @(Get-ChildItem -LiteralPath $kok -Force | Where-Object { $_.Name -cnotmatch '^(kurulum|unins[0-9]{3}\.(exe|dat|msg))$' })
    if ($yabanci.Count) { Dur "kok bos degil ve TeksERP kurulumu degil ($($yabanci.Count) girdi, or. $($yabanci[0].Name)) - baska bir kok secin; var olan veri ezilmez" }
  }
  $pgOrnek = JsonOku (Join-Path $PG_DIZINI "pg-ornegi.json")
  $pgSurum = JsonOku (Join-Path $PG_DIZINI "pg-surumu.json")

  $zip = GirdiCoz $C["paket.backend"] "tekserp-backend-*.zip" "backend paketi"
  $pgZip = GirdiCoz $C["paket.pg"] "postgresql-*.zip" "PostgreSQL paketi"
  $pgKunye = GirdiCoz $C["paket.pgKunye"] "pg.json" "PostgreSQL kunyesi (pg.json)"
  $k = PaketKunyesiOku $zip
  if ($k.korumali -ne $true -or "$($k.korumaHedef)" -cne "win-x64") { Dur "paket KORUMALI win-x64 degil - hizmet duzenine kurulamaz (yalniz pm2: kur.ps1)" }
  if ($k.prova -eq $true -and $C["provaKabul"] -ne $true) { Dur "PROVA paketi (provaKabul: true verilmeden fabrikaya kurulmaz)" }
  $ad = AdlariCoz ([string]$k.backendHizmetAdi) ([string]$k.backendKanal) $pgOrnek
  if ($onarim) {
    $eski = JsonOku $kayit
    if ("$($eski.adlar.backend)" -cne $ad.backend) { Dur "onarim: kayitli kurulum '$($eski.adlar.backend)' - bu paket '$($ad.backend)' (baska kanal ayri kok ister)" }
  }

  # API portu: istemcilerin varsayilan adresi - mesgulse DUR (onarimda dinleyen kendi backend'imiz olabilir).
  $apiPort = [int]$C["api.port"]
  if (PortDinleniyorMu $apiPort) {
    $bizim = $onarim -and ((Get-Service -Name $ad.backend -ErrorAction SilentlyContinue).Status -ceq "Running")
    if (-not $bizim) { Dur "API portu $apiPort MESGUL - cevap dosyasinda api.port ile bos bir port verin (panel/tablet adresi de o porta ayarlanir)" }
  }

  # PG portu: kayitli (ornek.json) > istenen > 5432..5499 ilk bos (D4 portSec); olculemeyen port bos sayilmaz.
  $ornekYolu = Join-Path $kok "pgsql\ornek.json"
  $onceki = $null
  if (Test-Path -LiteralPath $ornekYolu) {
    $o = JsonOku $ornekYolu
    if ("$($o.kip)" -ceq "harici") { Dur "bu kok HARICI PostgreSQL kipinde (pm2 donemi kurulumu) - setup onarmaz; gecis: gecis\gecis.ps1 (D6)" }
    $onceki = [int]$o.port
  }
  $mesgul = @()
  try { $mesgul += @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.LocalPort }) } catch { }
  $mesgul += @(PgHizmetPortlari)
  $mesgul += @(HaricPortlar ([int]$pgOrnek.port.baslangic) ([int]$pgOrnek.port.bitis))
  $sec = $null
  for ($i = 0; $i -lt 5; $i++) {
    $sec = PortSec $mesgul ([int]$pgOrnek.port.baslangic) ([int]$pgOrnek.port.bitis) $onceki $C["pg.port"]
    if ($sec.hata) { Dur "PostgreSQL portu: $($sec.hata)" }
    if ($null -ne $onceki -or -not (PortDinleniyorMu $sec.port)) { break }
    $mesgul += $sec.port
  }
  Ok "PostgreSQL portu $($sec.port) ($($sec.neden)) - API portu $apiPort"

  # Veri dizini (D4 b.4.2): yerel sabit NTFS, ASCII, program/gecici/yedek dizinlerinin disinda, YOK ya da BOS.
  $veri = if ($C["pg.veriDizini"]) { [IO.Path]::GetFullPath($C["pg.veriDizini"]).TrimEnd('\') } else { Join-Path $kok "pgveri" }
  $yasak = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:TEMP, (Join-Path $kok "app"), (Join-Path $kok "pgsql"), (Join-Path $kok "backups"), (Join-Path $kok "surumler"), (Join-Path $kok "current")) | Where-Object { $_ }
  foreach ($y in $yasak) {
    $yy = [IO.Path]::GetFullPath($y).TrimEnd('\').ToLowerInvariant()
    if ($veri.ToLowerInvariant() -ceq $yy -or $veri.ToLowerInvariant().StartsWith($yy + "\")) { Dur "PostgreSQL veri dizini bu dizinin altinda olamaz: $y" }
  }
  $surucu = $veri.Substring(0, 2)
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$surucu'" -ErrorAction SilentlyContinue
  if (-not $disk -or [int]$disk.DriveType -ne 3) { Dur "veri dizini yerel SABIT diskte olmali (${surucu}: ag/cikarilabilir surucu olmaz)" }
  if ("$($disk.FileSystem)" -cne "NTFS") { Dur "veri dizini NTFS birimde olmali ($surucu = $($disk.FileSystem))" }
  if (Test-Path -LiteralPath $veri) {
    $dolu = @(Get-ChildItem -LiteralPath $veri -Force -ErrorAction SilentlyContinue).Count
    $pgVar = Test-Path -LiteralPath (Join-Path $veri "PG_VERSION")
    if ($dolu -and -not ($onarim -and $pgVar)) { Dur "veri dizini BOS degil ($veri) - dolu dizinde initdb KOSMAZ, veri silinmez; bos bir dizin verin" }
  }
  if ([double]$disk.FreeSpace -lt 2GB) { Uyar "veri surucusunde 2 GB'tan az bos alan ($surucu)" }
  $kokDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($kok.Substring(0, 2))'" -ErrorAction SilentlyContinue
  if ($kokDisk -and [double]$kokDisk.FreeSpace -lt 2GB) { Dur "kok surucusunde 2 GB'tan az bos alan ($($kok.Substring(0, 2)))" }
  $ramMB = [int][math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
  if ($ramMB -lt 2048) { Uyar "RAM $ramMB MB (< 2 GB) - PostgreSQL bellek formulu tabana iner, yavas olabilir" }

  $plan = [ordered]@{
    v = $KURULUM_BICIMI; mod = $(if ($onarim) { "onarim" } else { "kurulum" }); kok = $kok
    girdiler = [ordered]@{ backend = $zip; pg = $pgZip; pgKunye = $pgKunye }
    paket = [ordered]@{ surum = "$($k.uygulamaSurumu)"; kanal = $k.backendKanal; gocSayisi = [int]$k.migrationSayisi }
    adlar = $ad
    portlar = [ordered]@{ api = $apiPort; pg = [int]$sec.port }
    pg = [ordered]@{ veriDizini = $veri; surum = "$($pgSurum.surum)"; derleme = "$($pgSurum.derleme)"; cizgi = "$($pgSurum.cizgi)"; icu = "$($pgSurum.yayin.'win-x64'.icuSurum)"; ramMB = $ramMB }
    asamalar = [ordered]@{}
  }
  if ($Kuru) {
    Write-Host ""
    Write-Host "KURU KIP - PLAN (hicbir sey yazilmadi):" -ForegroundColor Cyan
    Write-Host ($plan | ConvertTo-Json -Depth 6)
    $script:Sonuc["plan"] = $plan
    return
  }
  DurumYaz $kok $plan
  $d = DurumOku $kok
  AsamaBitti $d "OnKosul"
  DurumYaz $kok $d
  Ok "on kosullar tamam ($($plan.mod)) - paket $($plan.paket.surum) - kanal $($plan.paket.kanal) - hizmet $($ad.backend)"
}

function AsamaPaket {
  Baslik "Paket - dogrulama + surum dizini"
  $C = CevabiYukle
  $kok = [IO.Path]::GetFullPath($C["kok"]).TrimEnd('\')
  $d = DurumOku $kok
  $kalan = GenisAceler $kok @()
  if ($kalan.Count) {
    Uyar "kok genis gruplara acik ($($kalan -join ', ')) - korumali DACL uygulaniyor"
    AclKoru $kok @()
  }
  $surumler = Join-Path $kok "surumler"
  if (-not (Test-Path -LiteralPath $surumler)) { New-Item -ItemType Directory -Path $surumler | Out-Null }
  $surum = "$($d.paket.surum)"
  if ($surum -cnotmatch '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z.]{1,40})?$') { Dur "paket surumu bicimsiz: $surum" }
  $hedef = Join-Path $surumler $surum
  $current = Join-Path $kok "current"
  $j = $null
  if (Test-Path -LiteralPath $hedef) {
    $simdiki = JunctionHedefi $current
    $j = Dogrula @("kurulum-dizin", "--dizin", $hedef)
    Ok "var olan surum dizini yeniden olculdu: $hedef (paketId $($j.paketId))"
    if ($simdiki -and ([IO.Path]::GetFullPath($simdiki).TrimEnd('\') -cne $hedef)) { Dur "onarim: current baska surumu gosteriyor ($simdiki) - onarim yalniz KURULU surumun paketiyle yapilir; guncelleme guncelleyicinin isidir" }
  } else {
    if (Test-Path -LiteralPath $current) { Dur "current var ($(JunctionHedefi $current)) ama $surum dizini yok - onarim yalniz kurulu surumun paketiyle" }
    $gecici = Join-Path $surumler (".kurulum-" + [guid]::NewGuid().ToString("N").Substring(0, 12))
    $j = Dogrula @("kurulum-paket", "--zip", $d.girdiler.backend, "--hedef", $gecici)
    if ("$($j.surum)" -cne $surum) { Remove-Item -LiteralPath $gecici -Recurse -Force; Dur "imzali kunyenin surumu ($($j.surum)) PAKET.json'daki ($surum) degil" }
    Move-Item -LiteralPath $gecici -Destination $hedef
    Ok "paket dogrulandi ($($j.dosya) dosya, imza $($j.kid)) ve acildi: $hedef"
  }
  if ($j.hazirlikAnahtari -eq $true) { Uyar "paket HAZIRLIK anahtariyla ($($j.kid)) imzali: yalniz TEST/DEMO sinifi lisansla calisir, URETIM lisansi onu GECERSIZ sayar" }
  if ($j.musteri -and $d.paket.kanal -and ("$($j.musteri)" -cne "$($d.paket.kanal)")) { Dur "imzali kunyenin kanali ($($j.musteri)) PAKET.json'dakinden ($($d.paket.kanal)) farkli" }
  [void](AdlariCoz "$($d.adlar.backend)" "$($j.musteri)" (JsonOku (Join-Path $PG_DIZINI "pg-ornegi.json")))
  foreach ($rel in @("runtime\node.exe", "runtime\tekserp-hizmet.exe", "runtime\tekserp-guncelleyici.exe", "dist\server.js", "hizmet\backend-hizmeti.ps1", "hizmet\guncelleyici-hizmeti.ps1", "yedekle.ps1", "bakim-rolu.ps1", "dist\tools\superadmin-olustur.cjs", "dist\tools\yedek-sifrele.cjs", "node_modules\prisma\build\index.js")) {
    if (-not (Test-Path -LiteralPath (Join-Path $hedef $rel))) { Dur "paket eksik: $rel (hizmet duzeni paketi degil)" }
  }
  JunctionKur $current $hedef
  Ok "current -> surumler\$surum"
  $d.paket | Add-Member -NotePropertyName paketId -NotePropertyValue "$($j.paketId)" -Force
  $d.paket | Add-Member -NotePropertyName kid -NotePropertyValue "$($j.kid)" -Force
  $d.paket | Add-Member -NotePropertyName hazirlikAnahtari -NotePropertyValue ($j.hazirlikAnahtari -eq $true) -Force
  # Dizin iskeleti + iyi bilinen SID'lerle korumali ACL - SIR (.env, parola) YAZILMADAN ONCE (D6 sozlesmesi).
  BackendHizmetBetigi $kok $d @("-Uygula", "-YalnizIskelet")
  AsamaBitti $d "Paket"
  DurumYaz $kok $d
}

# TEK CAGRI NOKTASI (yonetici karari): backend hizmetinin kaydi + ACL'si yalniz bu betikte
# (hizmet\backend-hizmeti.ps1, D6). Imza: -Kok -HizmetAdi -PgHizmeti|-PgYok -GuncellemeDizini [-YalnizIskelet] [-Uygula].
function BackendHizmetBetigi([string]$kok, $d, [string[]]$ek) {
  $betik = Join-Path $kok "current\hizmet\backend-hizmeti.ps1"
  $arg = @{ Kok = $kok; HizmetAdi = "$($d.adlar.backend)"; PgHizmeti = "$($d.adlar.pg)"; GuncellemeDizini = (Join-Path "$($d.adlar.veriKoku)" "guncelleme") }
  if ($ek -ccontains "-Uygula") { $arg["Uygula"] = $true }
  if ($ek -ccontains "-YalnizIskelet") { $arg["YalnizIskelet"] = $true }
  Bilgi "hizmet\backend-hizmeti.ps1 $($ek -join ' ')"
  $global:LASTEXITCODE = 0
  & $betik @arg 6>&1 | ForEach-Object { [void](GunlugeYaz "BETIK" "$_") }
  $kod = $LASTEXITCODE
  if ($kod -ne 0) { Dur "backend-hizmeti.ps1 $($ek -join ' ') cikis $kod (0 uyumlu - 2 uyumsuz - 1 hata) - gunlukte ayrinti" }
  Ok "backend-hizmeti.ps1 $($ek -join ' '): uyumlu"
}

# TEK CAGRI NOKTASI: guncelleyici hizmetinin ikilisi + ayar.json + kaydi (hizmet\guncelleyici-hizmeti.ps1, D6).
function GuncelleyiciHizmetBetigi([string]$kok, $d, $C, [string[]]$ek) {
  $betik = Join-Path $kok "current\hizmet\guncelleyici-hizmeti.ps1"
  $arg = @{ Kok = $kok; HizmetAdi = "$($d.adlar.guncelleyici)"; VeriDizini = "$($d.adlar.veriKoku)"; BackendHizmeti = "$($d.adlar.backend)"; GuncellemeSunucusu = $C["guncelleme.sunucu"] }
  if ($C["guncelleme.vekil"]) { $arg["Vekil"] = $C["guncelleme.vekil"] }
  if ($ek -ccontains "-Uygula") { $arg["Uygula"] = $true }
  Bilgi "hizmet\guncelleyici-hizmeti.ps1 $($ek -join ' ')"
  $global:LASTEXITCODE = 0
  & $betik @arg 6>&1 | ForEach-Object { [void](GunlugeYaz "BETIK" "$_") }
  $kod = $LASTEXITCODE
  if ($kod -ne 0) { Dur "guncelleyici-hizmeti.ps1 $($ek -join ' ') cikis $kod - gunlukte ayrinti" }
  Ok "guncelleyici-hizmeti.ps1 $($ek -join ' '): uyumlu"
}

function AsamaPostgreSQL {
  Baslik "PostgreSQL - kendi ornek"
  $C = CevabiYukle
  $kok = [IO.Path]::GetFullPath($C["kok"]).TrimEnd('\')
  $d = DurumOku $kok
  $pgOrnek = JsonOku (Join-Path $PG_DIZINI "pg-ornegi.json")
  $tag = "$($d.pg.surum)-$($d.pg.derleme)"
  $pgsql = Join-Path $kok "pgsql"
  $ikili = Join-Path $pgsql $tag
  $bin = Join-Path $pgsql "bin"
  $veri = "$($d.pg.veriDizini)"
  $port = [int]$d.portlar.pg
  $hz = "$($d.adlar.pg)"
  if (-not (Test-Path -LiteralPath $pgsql)) { New-Item -ItemType Directory -Path $pgsql | Out-Null }

  # 1) Ikililer: kunye imzasi + zip ozeti + icerik manifestosu + tek ICU; kayitla (pg-surumu.json) birebir.
  if (-not (Test-Path -LiteralPath $ikili)) {
    $gecici = Join-Path $pgsql (".kurulum-" + [guid]::NewGuid().ToString("N").Substring(0, 12))
    $j = Dogrula @("kurulum-pg", "--kunye", $d.girdiler.pgKunye, "--zip", $d.girdiler.pg, "--hedef", $gecici)
    $fark = @()
    if ("$($j.surum)" -cne "$($d.pg.surum)") { $fark += "surum $($j.surum)" }
    if ("$($j.derleme)" -cne "$($d.pg.derleme)") { $fark += "derleme $($j.derleme)" }
    if ("$($j.cizgi)" -cne "$($d.pg.cizgi)") { $fark += "cizgi $($j.cizgi)" }
    if ("$($j.icuSurum)" -cne "$($d.pg.icu)") { $fark += "ICU $($j.icuSurum)" }
    if ($fark.Count) { Remove-Item -LiteralPath $gecici -Recurse -Force; Dur "PG paketi kurulumun sabitledigi surum degil ($($fark -join ', ')) - kayit $tag (ICU $($d.pg.icu))" }
    Move-Item -LiteralPath $gecici -Destination $ikili
    Ok "PostgreSQL $tag dogrulandi ($($j.dosya) dosya, ICU $($j.icuSurum), imza $($j.kid)) ve acildi"
  }
  $v = NativeKos (Join-Path $ikili "bin\postgres.exe") @("--version")
  if ($v.kod -ne 0 -or $v.cikti -cnotmatch ("\(PostgreSQL\) " + [regex]::Escape("$($d.pg.surum)") + '(\s|$)')) { Dur "postgres.exe surumu beklenen degil: $($v.cikti)" }
  # Ikililer: SYSTEM + Administrators tam, Users okuma/calistirma (hizmet hesabi ve backend'in pg_dump'i) - kimse YAZAMAZ.
  AclKoru $ikili @("*$($script:SID_USERS):(OI)(CI)RX") -Agac
  JunctionKur $bin (Join-Path $ikili "bin")
  Ok "pgsql\bin -> $tag\bin (PG_BIN_DIR)"

  # 2) Parolalar: postgres (DPAPI'de saklanir), uygulama rolu (.env'de). Onarimda var olanlar okunur.
  $pgSetup = Join-Path $kok "pg-setup"
  if (-not (Test-Path -LiteralPath $pgSetup)) { New-Item -ItemType Directory -Path $pgSetup | Out-Null; AclKoru $pgSetup @() }
  $dpapi = Join-Path $pgSetup "pg-yonetici.dpapi"
  $alfabe = "$($pgOrnek.parola.alfabe)"; $uzunluk = [int]$pgOrnek.parola.uzunluk
  $suParola = if (Test-Path -LiteralPath $dpapi) { DpapiCoz ([IO.File]::ReadAllBytes($dpapi)) } else { YeniParolaUret $alfabe $uzunluk }
  SirEkle $suParola
  $kullaniciSid = KullaniciSid

  # 3) initdb (yalniz bos dizinde). Yonetici hesabinda initdb KISITLI jetonla calisir: dizin ve parola
  #    dosyasi bu kullanicinin SID'ine acik olmali (Administrators devre disi) - sonra geri alinir.
  if (-not (Test-Path -LiteralPath (Join-Path $veri "PG_VERSION"))) {
    if (-not (Test-Path -LiteralPath $veri)) { New-Item -ItemType Directory -Path $veri -Force | Out-Null }
    AclKoru $veri @("*$($kullaniciSid):(OI)(CI)F") -Agac
    $pw = Join-Path $pgSetup ("initdb-" + [guid]::NewGuid().ToString("N").Substring(0, 12) + ".tmp")
    try {
      SirDosyasiYaz $pw ([Text.Encoding]::UTF8.GetBytes($suParola + "`n")) @("*$($kullaniciSid):R")
      $a = @("-D", $veri) + @($pgOrnek.initdb.argumanlar) + @("$($pgOrnek.initdb.parolaDosyasiArgumani)=$pw")
      $r = NativeKos (Join-Path $ikili "bin\initdb.exe") $a
      [void](GunlugeYaz "INITDB" $r.cikti)
      if ($r.kod -ne 0) { Dur "initdb basarisiz (cikis $($r.kod)) - gunlukte ayrinti" }
    } finally { if (Test-Path -LiteralPath $pw) { Remove-Item -LiteralPath $pw -Force } }
    $pv = ([IO.File]::ReadAllText((Join-Path $veri "PG_VERSION"))).Trim()
    if ($pv -cne "$($d.pg.cizgi)") { Dur "PG_VERSION $pv - beklenen $($d.pg.cizgi)" }
    Ok "initdb: UTF8 + C + scram + checksum ($veri)"
  } else {
    $pv = ([IO.File]::ReadAllText((Join-Path $veri "PG_VERSION"))).Trim()
    if ($pv -cne "$($d.pg.cizgi)") { Dur "veri dizini PG $pv - bu kurulum $($d.pg.cizgi) (ana surum gecisi runbook ile: docs/ops/PG-BUYUK-SURUM-GECISI.md)" }
    Ok "veri dizini var (PG $pv) - initdb atlandi (onarim)"
  }

  # 4) Yapilandirma: tekserp.conf + pg_hba.conf TEK KAYNAKTAN (pg-sablon.mjs yasaklara karsi denetler).
  $node = Join-Path $kok "current\runtime\node.exe"
  $s = NodeKos $node @((Join-Path $PG_DIZINI "pg-sablon.mjs"), "--ram-mb", "$($d.pg.ramMB)", "--port", "$port", "--cikti", $veri) $PG_DIZINI @{} $null
  [void](GunlugeYaz "SABLON" ($s.stdout + "`n" + $s.stderr))
  if ($s.kod -ne 0) { Dur "pg-sablon.mjs cikis $($s.kod): $($s.stderr)" }
  $conf = Join-Path $veri "postgresql.conf"
  $inc = "$($pgOrnek.yapilandirma.includeSatiri)"
  if (-not (@([IO.File]::ReadAllLines($conf)) -ccontains $inc)) { [IO.File]::AppendAllText($conf, "`n$inc`n", (New-Object Text.UTF8Encoding $false)) }
  Ok "tekserp.conf + pg_hba.conf (yalniz 127.0.0.1, yalniz scram, UTC) - port $port"

  # 5) Hizmet kaydi (sanal hesap; -P yok) -> veri dizini ACL KAYITTAN SONRA (hesap kayitla dogar).
  $svc = Get-CimInstance Win32_Service -Filter "Name='$hz'" -ErrorAction SilentlyContinue
  if (-not $svc) {
    $r = NativeKos (Join-Path $ikili "bin\pg_ctl.exe") @("register", "-N", $hz, "-U", "NT SERVICE\$hz", "-D", $veri, "-S", "auto", "-w", "-t", "$($pgOrnek.hizmet.baslatmaBeklemeSn)")
    if ($r.kod -ne 0) { Dur "pg_ctl register $hz basarisiz (cikis $($r.kod)): $($r.cikti)" }
    $gor = "$($pgOrnek.hizmet.gorunenAd)$($d.adlar.sonek)"
    $r1 = NativeKos "sc.exe" @("config", $hz, "DisplayName=", $gor)
    $r2 = NativeKos "sc.exe" @("failure", $hz, "reset=", "$($pgOrnek.hizmet.cokmeSayacSifirlamaSn)", "actions=", "$($pgOrnek.hizmet.cokmeEylemleri)")
    if ($r1.kod -ne 0 -or $r2.kod -ne 0) { Dur "sc.exe config/failure $hz yazilamadi ($($r1.kod)/$($r2.kod))" }
    $svc = Get-CimInstance Win32_Service -Filter "Name='$hz'"
    Ok "hizmet kaydedildi: $hz (NT SERVICE\$hz)"
  }
  $img = "$($svc.PathName)"
  if (-not $img.ToLowerInvariant().Contains(("-D `"$veri`"").ToLowerInvariant())) { Dur "$hz ImagePath veri dizinini gostermiyor: $img" }
  if ("$($svc.StartName)" -cne "NT SERVICE\$hz") { Dur "$hz hesabi sanal hesap degil: $($svc.StartName)" }
  AclKoru $veri @("NT SERVICE\$($hz):(OI)(CI)F") -Agac
  $r = NativeKos "icacls.exe" @($veri, "/remove:g", "*$kullaniciSid", "/T", "/Q")
  if ($r.kod -ne 0) { Dur "veri dizininden kurulum kullanicisinin izni kaldirilamadi (icacls $($r.kod))" }
  if ((GenisAceler $veri @()).Count) { Dur "veri dizini hala genis gruplara acik: $veri" }
  Ok "veri dizini izni: SYSTEM + Administrators + NT SERVICE\$hz (miras kesik)"
  if ($C["pg.defenderDislamasi"] -eq $true) {
    try { Add-MpPreference -ExclusionPath $veri -ErrorAction Stop; Ok "Defender dislamasi: yalniz veri dizini" }
    catch { Uyar "Defender dislamasi eklenemedi (Defender yok ya da politika engelliyor) - WAL dosya kilitleri icin onerilir" }
  }

  # 6) Baslat + olc (D4 b.4.11).
  Start-Service -Name $hz
  if (-not (HizmetBekle $hz "Running" 120)) { Dur "$hz baslamadi - $veri\log altindaki gunluge bakin" }
  $hazir = $false
  for ($i = 0; $i -lt 30 -and -not $hazir; $i++) { $hazir = ((NativeKos (Join-Path $bin "pg_isready.exe") @("-h", "127.0.0.1", "-p", "$port")).kod -eq 0); if (-not $hazir) { Start-Sleep -Seconds 2 } }
  if (-not $hazir) { Dur "pg_isready 127.0.0.1:$port hazir degil" }
  $q = PsqlStdin $bin $port "postgres" $suParola "postgres" ("SELECT current_setting('server_version') || '|' || current_setting('listen_addresses') || '|' || current_setting('password_encryption') || '|' || current_setting('TimeZone') || '|' || current_setting('data_checksums') || '|' || (SELECT datcollate || '/' || datctype FROM pg_database WHERE datname = 'template1') || '|' || (SELECT count(*) FROM pg_collation WHERE collprovider = 'i');")
  if ($q.kod -ne 0) { Dur "postgres ile baglanilamadi: $($q.cikti)" }
  $o = $q.cikti -csplit '\|'
  $beklenen = @("$($d.pg.surum)", "127.0.0.1", "scram-sha-256", "UTC", "on", "C/C")
  for ($i = 0; $i -lt 6; $i++) { if ($o[$i] -cne $beklenen[$i]) { Dur "PostgreSQL ayari beklenen degil: $($o -join ' | ') (beklenen $($beklenen -join ' | '))" } }
  if ([int]$o[6] -lt 1) { Dur "ICU harmanlamasi yok (tr_sort ICU ister)" }
  $neg = PsqlStdin $bin $port "postgres" "" "postgres" "SELECT 1;"
  if ($neg.kod -eq 0) { Dur "PAROLASIZ baglanti kabul edildi - pg_hba yanlis" }
  Ok "PostgreSQL $($o[0]) - yalniz 127.0.0.1 - scram - UTC - checksum - C - ICU - parolasiz baglanti RED"

  # 7) Roller + DB + DB ayarlari (idempotent). Rol parolasi SCRAM dogrulayicisi, SQL STDIN'den, loglanmadan.
  $rol = "$($pgOrnek.roller.uygulama.ad)"
  $vt = "$($pgOrnek.veritabani.ad)"
  $envYolu = Join-Path $kok "yapilandirma\.env"
  $uyParola = $null
  if (Test-Path -LiteralPath $envYolu) {
    $url = EnvDeger ([IO.File]::ReadAllLines($envYolu)) "DATABASE_URL"
    if ($url -and $url -cmatch '^postgresql://[^:]+:([^@]+)@') { $uyParola = [uri]::UnescapeDataString($Matches[1]) }
  }
  $rolVar = (PsqlStdin $bin $port "postgres" $suParola "postgres" "SELECT count(*) FROM pg_roles WHERE rolname = $(Lit $rol);").cikti -ceq "1"
  $yeniEnv = $false
  if (-not $rolVar -or -not $uyParola -or (PsqlStdin $bin $port $rol $uyParola "postgres" "SELECT 1;").kod -ne 0) {
    $uyParola = YeniParolaUret $alfabe $uzunluk
    SirEkle $uyParola
    $fiil = if ($rolVar) { "ALTER" } else { "CREATE" }
    $r = PsqlStdin $bin $port "postgres" $suParola "postgres" ("SET log_statement = 'none';`n$fiil ROLE $(Ident $rol) WITH $($pgOrnek.roller.uygulama.ozellik) PASSWORD " + (Lit (ScramDogrulayici $uyParola)) + ";")
    if ($r.kod -ne 0) { Dur "uygulama rolu yazilamadi: $($r.cikti)" }
    $yeniEnv = $true
    Ok "rol $(if ($rolVar) { 'parolasi yenilendi (onarim)' } else { 'olusturuldu' }): $rol (super degil)"
  } else { SirEkle $uyParola; Ok "rol var ve .env parolasi calisiyor: $rol" }
  if ((PsqlStdin $bin $port "postgres" $suParola "postgres" "SELECT count(*) FROM pg_database WHERE datname = $(Lit $vt);").cikti -cne "1") {
    $r = PsqlStdin $bin $port "postgres" $suParola "postgres" "CREATE DATABASE $(Ident $vt) OWNER $(Ident $rol) TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LOCALE 'C';"
    if ($r.kod -ne 0) { Dur "veritabani olusturulamadi: $($r.cikti)" }
    Ok "veritabani: $vt (sahip $rol, UTF8, C)"
  }
  foreach ($p in $pgOrnek.veritabani.ayarlar.PSObject.Properties) {
    $r = PsqlStdin $bin $port "postgres" $suParola "postgres" "ALTER DATABASE $(Ident $vt) SET $($p.Name) = $(Lit ([string]$p.Value));"
    if ($r.kod -ne 0) { Dur "DB ayari yazilamadi ($($p.Name)): $($r.cikti)" }
  }
  Ok "DB duzeyi ayarlar: $(@($pgOrnek.veritabani.ayarlar.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ', ')"

  # 8) Sirlar diske: .env (yapilandirma\, iskelet ACL'li) + db-credentials.json + postgres parolasi DPAPI.
  $uKod = [uri]::EscapeDataString($rol); $pKod = [uri]::EscapeDataString($uyParola)
  $dbUrl = "postgresql://$($uKod):$($pKod)@127.0.0.1:$port/$($vt)?schema=public"
  if (-not (Test-Path -LiteralPath $envYolu)) {
    $jwtB = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtB)
    $jwt = [Convert]::ToBase64String($jwtB) -creplace '[+/=]', ''
    SirEkle $jwt
    $satirlar = @("DATABASE_URL=$dbUrl", "JWT_SECRET=$jwt", "PORT=$($d.portlar.api)")
    if ($d.adlar.sonek) { $satirlar += "TEKSERP_GUNCELLEME_DIZINI=$((Join-Path "$($d.adlar.veriKoku)" 'guncelleme') -creplace '\\', '/')" }
    if ($C["lisans.saticiAdresi"]) { $satirlar += "LICENSE_SERVER_URL=$($C['lisans.saticiAdresi'])" }
    if ($C["profil"]) { $satirlar += "TEKSERP_PROFIL=$($C['profil'])" }
    if ($C["yedek.sifreleme"] -eq $true) { $satirlar += "BACKUP_KEY_DIR=$((Join-Path $kok 'yedek-anahtar') -creplace '\\', '/')" }
    EnvYaz $envYolu (($satirlar -join "`n") + "`n")
    Ok ".env yazildi (yapilandirma\; JWT_SECRET bu makinede uretildi)"
  } elseif ($yeniEnv) {
    $l = [IO.File]::ReadAllLines($envYolu)
    $yeni = @($l | ForEach-Object { if ($_ -cmatch '^\s*DATABASE_URL\s*=') { "DATABASE_URL=$dbUrl" } else { $_ } })
    EnvYaz $envYolu (($yeni -join "`n") + "`n")
    Ok ".env DATABASE_URL yenilendi (onarim; diger satirlar korundu)"
  }
  $cred = Join-Path $pgSetup "db-credentials.json"
  $credJson = "{`"db`": $(JsonAscii $vt), `"port`": $port, `"user`": $(JsonAscii $rol), `"pass`": $(JsonAscii $uyParola)}`n"
  SirDosyasiYaz $cred ([Text.Encoding]::ASCII.GetBytes($credJson)) @()
  SirDosyasiYaz $dpapi (DpapiKoru $suParola) @()
  Ok "db-credentials.json + pg-yonetici.dpapi (yalniz SYSTEM + Administrators)"

  # 9) Ornek kaydi (D4 b.6): guncelleyici kendi ornegi bundan tanir (yoksa HARICI sayar).
  $ornekYolu = Join-Path $pgsql "ornek.json"
  $kuruldu = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  if (Test-Path -LiteralPath $ornekYolu) { $kuruldu = "$((JsonOku $ornekYolu).kuruldu)" }
  $ornek = "{`n  `"bicim`": 1, `"kip`": `"kendi`", `"hizmet`": $(JsonAscii $hz),`n  `"surum`": $(JsonAscii "$($d.pg.surum)"), `"derleme`": $(JsonAscii "$($d.pg.derleme)"), `"ikiliDizin`": $(JsonAscii $ikili), `"oncekiIkiliDizin`": null,`n  `"veriDizini`": $(JsonAscii $veri), `"port`": $port, `"kuruldu`": $(JsonAscii $kuruldu), `"guncellendi`": null`n}`n"
  MetinYaz $ornekYolu $ornek
  Ok "pgsql\ornek.json (kip kendi)"
  AsamaBitti $d "PostgreSQL"
  DurumYaz $kok $d
}

function AsamaBackend {
  Baslik "Backend - goc + bakim rolu + yedek anahtari"
  $C = CevabiYukle
  $kok = [IO.Path]::GetFullPath($C["kok"]).TrimEnd('\')
  $d = DurumOku $kok
  $cur = Join-Path $kok "current"
  $node = Join-Path $cur "runtime\node.exe"
  $envYolu = Join-Path $kok "yapilandirma\.env"
  if (-not (Test-Path -LiteralPath $envYolu)) { Dur ".env yok - once PostgreSQL asamasi" }
  $l = [IO.File]::ReadAllLines($envYolu)
  $url = EnvDeger $l "DATABASE_URL"
  if (-not $url -or $url -cnotmatch '^postgresql://([^:]+):([^@]+)@127\.0\.0\.1:([0-9]+)/([^?]+)') { Dur ".env DATABASE_URL beklenen bicimde degil" }
  $rol = [uri]::UnescapeDataString($Matches[1]); $uyParola = [uri]::UnescapeDataString($Matches[2]); $port = [int]$Matches[3]; $vt = $Matches[4]
  SirEkle $uyParola
  $bin = Join-Path $kok "pgsql\bin"

  $g = NodeKos $node @("node_modules\prisma\build\index.js", "migrate", "deploy") (JunctionHedefi $cur) @{ DOTENV_CONFIG_PATH = $envYolu; NODE_ENV = "production" } $null
  [void](GunlugeYaz "GOC" ($g.stdout + "`n" + $g.stderr))
  if ($g.kod -ne 0) { Dur "prisma migrate deploy cikis $($g.kod) - gunlukte ayrinti (veritabani BOS kurulumda; tekrar denemek guvenli)" }
  $say = PsqlStdin $bin $port $rol $uyParola $vt "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"
  if ($say.kod -ne 0 -or [int]$say.cikti -ne [int]$d.paket.gocSayisi) { Dur "goc sayisi $($say.cikti) - paket $($d.paket.gocSayisi)" }
  Ok "goc: $($say.cikti) migration uygulandi (paketin kendi Node'u ve prisma'si)"

  $pgOrnek = JsonOku (Join-Path $PG_DIZINI "pg-ornegi.json")
  $suParola = DpapiCoz ([IO.File]::ReadAllBytes((Join-Path $kok "pg-setup\pg-yonetici.dpapi")))
  SirEkle $suParola
  $ss = ConvertTo-SecureString $suParola -AsPlainText -Force
  $global:LASTEXITCODE = 0
  & (Join-Path $cur "bakim-rolu.ps1") -Kok $kok -EnvDosyasi $envYolu -BakimKullanici "$($pgOrnek.roller.bakim.ad)" -PostgresKullanici "$($pgOrnek.initdb.yoneticiRolu)" -PostgresParolaGuvenli $ss -PgBin $bin 6>&1 | ForEach-Object { [void](GunlugeYaz "BAKIM" "$_") }
  if ($LASTEXITCODE -ne 0) { Dur "bakim-rolu.ps1 cikis $LASTEXITCODE - gunlukte ayrinti" }
  Get-ChildItem -LiteralPath (Split-Path $envYolu) -Filter ".env.onceki-*" -Force -ErrorAction SilentlyContinue | Remove-Item -Force
  Ok "bakim rolu: $($pgOrnek.roller.bakim.ad) (super degil; .env BACKUP_PG_*)"

  if ($C["yedek.sifreleme"] -eq $true) {
    $ad = Join-Path $kok "yedek-anahtar"
    if (-not (Test-Path -LiteralPath $ad)) { New-Item -ItemType Directory -Path $ad | Out-Null }
    $arac = Join-Path $cur "dist\tools\yedek-sifrele.cjs"
    if ($C["yedek.etkiliAcikAnahtar"] -and -not (Test-Path -LiteralPath (Join-Path $ad "etkili.tkpub"))) {
      if (-not (Test-Path -LiteralPath $C["yedek.etkiliAcikAnahtar"])) { Dur "Etkili Yazilim acik anahtari yok: $($C['yedek.etkiliAcikAnahtar'])" }
      Copy-Item -LiteralPath $C["yedek.etkiliAcikAnahtar"] -Destination (Join-Path $ad "etkili.tkpub")
      Ok "Etkili Yazilim alicisi eklendi"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $ad "musteri.tkpub")) -and $C["yedek.musteriAnahtariCikti"]) {
      $r = NodeKos $node @($arac, "anahtar-uret", "--ad", "musteri", "--dizin", $ad, "--ozel-cikti", $C["yedek.musteriAnahtariCikti"]) $kok @{} $null
      if ($r.kod -ne 0) { Dur "musteri anahtari uretilemedi (cikis $($r.kod)): $($r.stderr)" }
      Ok "musteri yedek anahtari: acik yarisi yedek-anahtar\musteri.tkpub - OZEL YARISI $($C['yedek.musteriAnahtariCikti']) (USB'yi musteriye teslim et, sunucuda BIRAKMA)"
    }
  }
  AsamaBitti $d "Backend"
  DurumYaz $kok $d
}

function AsamaHizmetler {
  Baslik "Hizmetler - kayit, izin, gorev, guvenlik duvari, baslat"
  $C = CevabiYukle
  $kok = [IO.Path]::GetFullPath($C["kok"]).TrimEnd('\')
  $d = DurumOku $kok
  $cur = Join-Path $kok "current"
  BackendHizmetBetigi $kok $d @("-Uygula")
  GuncelleyiciHizmetBetigi $kok $d $C @("-Uygula")

  # Gece yedegi: <KOK>\yedekle.ps1 (paketin hizmet-farkinda surumu) + SYSTEM gorevi (ilk-kurulum ile ayni tarif).
  $yedekle = Join-Path $kok "yedekle.ps1"
  $kaynak = Join-Path $cur "yedekle.ps1"
  if (-not (Test-Path -LiteralPath $yedekle) -or ((Get-FileHash -LiteralPath $yedekle).Hash -cne (Get-FileHash -LiteralPath $kaynak).Hash)) { Copy-Item -LiteralPath $kaynak -Destination $yedekle -Force; Ok "yedekle.ps1 -> $yedekle" }
  $gorev = "$($d.adlar.gorev)"
  if (-not (Get-ScheduledTask -TaskName $gorev -ErrorAction SilentlyContinue)) {
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$yedekle`" -Kok `"$kok`""
    if ($C["yedek.ikinciHedef"]) { $arg += " -IkinciHedef `"$($C['yedek.ikinciHedef'])`"" }
    $eylem = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
    $tetik = New-ScheduledTaskTrigger -Daily -At $C["yedek.saat"]
    $kim = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $ayar = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $gorev -Action $eylem -Trigger $tetik -Principal $kim -Settings $ayar -Description "TeksERP: gece yedegi (pg_dump + dogrulama + saklama) - kurulum" | Out-Null
    Ok "gorev: $gorev her gun $($C['yedek.saat']) (SYSTEM)"
  } else { Bilgi "gorev zaten var, DOKUNULMADI: $gorev" }

  # Guvenlik duvari: API yalniz secili profiller + LocalSubnet [+ Tailscale]; mDNS (kesif); PG'ye kural YOK.
  $apiPort = [int]$d.portlar.api
  $apiKural = "TeksERP API $apiPort"
  if (-not (Get-NetFirewallRule -DisplayName $apiKural -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $apiKural -Direction Inbound -Protocol TCP -LocalPort $apiPort -Action Allow -Profile @($C["api.agProfilleri"]) -RemoteAddress @($C["api.izinliAdresler"]) | Out-Null
    Ok "guvenlik duvari: $apiKural ($($C['api.agProfilleri'] -join ',') - $($C['api.izinliAdresler'] -join ','))"
  } else { Bilgi "kural zaten var, DOKUNULMADI: $apiKural" }
  if ($C["api.mdns"] -eq $true -and -not (Get-NetFirewallRule -DisplayName "$($d.adlar.mdnsKurali)" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "$($d.adlar.mdnsKurali)" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile @($C["api.agProfilleri"]) -RemoteAddress LocalSubnet | Out-Null
    Ok "guvenlik duvari: $($d.adlar.mdnsKurali) (UDP 5353, LocalSubnet - tablet/panel sunucuyu kesfeder)"
  }
  $pgAcik = @(Get-NetFirewallPortFilter -Protocol TCP -ErrorAction SilentlyContinue | Where-Object { "$($_.LocalPort)" -ceq "$($d.portlar.pg)" } | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { "$($_.Direction)" -ceq "Inbound" -and "$($_.Action)" -ceq "Allow" -and "$($_.Enabled)" -ceq "True" })
  if ($pgAcik.Count) { Uyar "PostgreSQL portuna ($($d.portlar.pg)) GELEN izin kurali var: $($pgAcik[0].DisplayName) - PG yalniz 127.0.0.1'i dinler ama kural kapatilmali" }

  # Baslat: backend -> /health 200 UP/UP/surum; guncelleyici -> durum.json.
  Start-Service -Name "$($d.adlar.backend)"
  if (-not (HizmetBekle "$($d.adlar.backend)" "Running" 60)) { Dur "$($d.adlar.backend) baslamadi - $kok\logs\hizmet.log" }
  $s = SaglikBekle $apiPort "$($d.paket.surum)" 180
  if (-not $s.tamam) {
    $err = Join-Path $kok "logs\backend-err.log"
    if (Test-Path -LiteralPath $err) { Get-Content -LiteralPath $err -Tail 20 | ForEach-Object { [void](GunlugeYaz "BACKEND" "$_") } }
    Dur "backend saglikli degil ($($s.son)) - logs\backend-err.log"
  }
  Ok "backend: /health UP - db UP - surum $($d.paket.surum)"
  Start-Service -Name "$($d.adlar.guncelleyici)"
  if (-not (HizmetBekle "$($d.adlar.guncelleyici)" "Running" 60)) { Dur "$($d.adlar.guncelleyici) baslamadi - $kok\guncelleyici\gunluk" }
  $durum = Join-Path "$($d.adlar.veriKoku)" "guncelleme\durum\durum.json"
  for ($i = 0; $i -lt 60 -and -not (Test-Path -LiteralPath $durum); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Path -LiteralPath $durum)) { Uyar "guncelleyici durum.json yazmadi (60 sn) - $kok\guncelleyici\gunluk" }
  else {
    $g = Get-Content -LiteralPath $durum -Raw -Encoding UTF8 | ConvertFrom-Json
    if ("$($g.kuruluSurum)" -cne "$($d.paket.surum)") { Uyar "guncelleyici kurulu surumu $($g.kuruluSurum) goruyor (beklenen $($d.paket.surum))" }
    else { Ok "guncelleyici: durum $($g.durum) - karar $($g.karar.karar)/$($g.karar.neden) (lisans etkinlesince politika gelir)" }
  }
  AsamaBitti $d "Hizmetler"
  DurumYaz $kok $d
}

# YALNIZ sihirbaz: STDIN'den {saticiParolasi, saticiPin, yedekParolasi, musteriAnahtariEkrana}. Sir argv'ye,
# ortama, gunluge GIRMEZ; araclara STDIN'den gider. SONUC satiri sir tasimaz - TEK istisna musteri anahtari
# (ekranda bir kez gosterilmesi istendiyse; sihirbaz gunluge YAZMAZ).
function AsamaSirlar {
  Baslik "Sirlar - satici hesabi + yedek anahtarlari (STDIN)"
  $C = CevabiYukle
  $kok = [IO.Path]::GetFullPath($C["kok"]).TrimEnd('\')
  $d = DurumOku $kok
  $cur = Join-Path $kok "current"
  $node = Join-Path $cur "runtime\node.exe"
  if (-not [Console]::IsInputRedirected) { Dur "Sirlar asamasi STDIN boru ister (sihirbaz verir) - elle: satici hesabi icin konsolda dist\tools\superadmin-olustur.cjs" }
  $ham = [Console]::In.ReadToEnd()
  if ($ham.Length -gt 8192) { Dur "Sirlar girdisi 8 KB tavanini asiyor" }
  try { $g = $ham | ConvertFrom-Json } catch { Dur "Sirlar girdisi JSON degil" }
  $ham = $null
  foreach ($p in $g.PSObject.Properties) { if ($p.Value -is [string] -and $p.Value) { SirEkle $p.Value } }
  $sonuc = [ordered]@{}

  if ($C["saticiHesabi.kullaniciAdi"] -and $g.saticiParolasi) {
    $girdi = "{`"kullaniciAdi`":" + (JsonAscii $C["saticiHesabi.kullaniciAdi"]) + ",`"parola`":" + (JsonAscii "$($g.saticiParolasi)") + ",`"pin`":" + (JsonAscii "$($g.saticiPin)") + "}"
    $r = NodeKos $node @("dist\tools\superadmin-olustur.cjs", "--kurulum-stdin") (JunctionHedefi $cur) @{ DOTENV_CONFIG_PATH = (Join-Path $kok "yapilandirma\.env") } $girdi
    $girdi = $null
    $satir = @($r.stdout -csplit "`n" | Where-Object { $_.Trim().StartsWith("{") }) | Select-Object -Last 1
    $j = if ($satir) { $satir | ConvertFrom-Json } else { $null }
    $sonuc["satici"] = [ordered]@{ kod = $r.kod; sonuc = "$($j.sonuc)"; hata = "$($j.kod)"; mesaj = "$($j.mesaj)"; kullaniciAdi = "$($j.kullaniciAdi)" }
    if ($r.kod -eq 0) { Ok "satici hesabi: $($j.sonuc) ($($j.kullaniciAdi))" } else { Uyar "satici hesabi KURULAMADI [$($j.kod)] $($j.mesaj)" }
  }

  if ($C["yedek.sifreleme"] -eq $true) {
    $ad = Join-Path $kok "yedek-anahtar"
    $arac = Join-Path $cur "dist\tools\yedek-sifrele.cjs"
    if ($g.yedekParolasi -and -not (Test-Path -LiteralPath (Join-Path $ad "yerel.tkkey"))) {
      if ("$($g.yedekParolasi)" -cnotmatch '^[\x21-\x7E]{10,128}$') { Dur "yedek parolasi 10-128 ASCII karakter olmali (Turkce harf yok - kurtarmada baska klavyede yazilacak)" }
      $r = NodeKos $node @($arac, "anahtar-uret", "--ad", "yerel", "--dizin", $ad, "--parolali", "--parola-stdin") $kok @{} ("$($g.yedekParolasi)")
      if ($r.kod -ne 0) { Uyar "yerel yedek anahtari uretilemedi: $($r.stderr)" } else { Ok "yerel yedek anahtari (yedek parolasiyla sarili): yedek-anahtar\yerel.tkkey" }
      $sonuc["yerelAnahtar"] = ($r.kod -eq 0)
    }
    if ($g.musteriAnahtariEkrana -eq $true -and -not (Test-Path -LiteralPath (Join-Path $ad "musteri.tkpub"))) {
      $r = NodeKos $node @($arac, "anahtar-uret", "--ad", "musteri", "--dizin", $ad) $kok @{} $null
      if ($r.kod -ne 0) { Dur "musteri anahtari uretilemedi (cikis $($r.kod))" }
      $anahtarSatiri = @($r.stdout -csplit "`n" | Where-Object { $_.Trim() }) | Select-Object -Last 1
      $sonuc["musteriAnahtari"] = "$anahtarSatiri".Trim()
      Ok "musteri yedek anahtari uretildi - OZEL YARISI sihirbazda BIR KEZ gosterilir (gunluge yazilmadi)"
    }
  }
  $script:Sonuc["sirlar"] = $sonuc
  AsamaBitti $d "Sirlar"
  DurumYaz $kok $d
}

function AsamaDogrulama {
  Baslik "Dogrulama - kurulum olculuyor"
  $C = CevabiYukle
  $kok = [IO.Path]::GetFullPath($C["kok"]).TrimEnd('\')
  $d = DurumOku $kok
  foreach ($h in @("$($d.adlar.pg)", "$($d.adlar.backend)", "$($d.adlar.guncelleyici)")) {
    $s = Get-Service -Name $h -ErrorAction SilentlyContinue
    if (-not $s -or "$($s.Status)" -cne "Running") { Dur "hizmet calismiyor: $h" }
  }
  $s = SaglikBekle ([int]$d.portlar.api) "$($d.paket.surum)" 60
  if (-not $s.tamam) { Dur "backend saglik olcumu dustu: $($s.son)" }
  # Niyet dizini (backend'in TEK yazabildigi kanal dizini, D7): var, baglanti DEGIL (niyet yazicisi bagi reddeder).
  $niyet = Join-Path "$($d.adlar.veriKoku)" "guncelleme\niyet"
  if (-not (Test-Path -LiteralPath $niyet -PathType Container)) { Dur "guncelleme\niyet\ yok: $niyet (backend-hizmeti.ps1 -Uygula kurar)" }
  if (ReparseMi $niyet) { Dur "guncelleme\niyet\ bir baglanti noktasi - niyet yazicisi reddeder: $niyet" }
  $envYolu = Join-Path $kok "yapilandirma\.env"
  $url = EnvDeger ([IO.File]::ReadAllLines($envYolu)) "DATABASE_URL"
  [void]($url -cmatch '^postgresql://([^:]+):([^@]+)@127\.0\.0\.1:([0-9]+)/([^?]+)')
  $rol = [uri]::UnescapeDataString($Matches[1]); $uyParola = [uri]::UnescapeDataString($Matches[2]); $port = [int]$Matches[3]; $vt = $Matches[4]
  SirEkle $uyParola
  $izin = 0
  for ($i = 0; $i -lt 30 -and $izin -lt 1; $i++) {
    $q = PsqlStdin (Join-Path $kok "pgsql\bin") $port $rol $uyParola $vt "SELECT count(*) FROM permissions;"
    if ($q.kod -eq 0) { $izin = [int]$q.cikti }
    if ($izin -lt 1) { Start-Sleep -Seconds 2 }
  }
  if ($izin -lt 1) { Dur "izin katalogu uzlastirilmadi (permissions bos) - backend acilis isi; logs\backend-out.log" }
  Ok "izin katalogu: $izin izin (acilis uzlastirmasi)"
  # Olcum kipinde (degisiklik yok) iki hizmet betigi: kayit + ACL + ayar sozlesmesi uyumlu mu.
  foreach ($b in @("backend", "guncelleyici")) {
    $betik = Join-Path $kok "current\hizmet\$b-hizmeti.ps1"
    $global:LASTEXITCODE = 0
    if ($b -ceq "backend") { & $betik -Kok $kok -HizmetAdi "$($d.adlar.backend)" -PgHizmeti "$($d.adlar.pg)" -GuncellemeDizini (Join-Path "$($d.adlar.veriKoku)" "guncelleme") 6>&1 | ForEach-Object { [void](GunlugeYaz "BETIK" "$_") } }
    else { & $betik -Kok $kok -HizmetAdi "$($d.adlar.guncelleyici)" -VeriDizini "$($d.adlar.veriKoku)" -BackendHizmeti "$($d.adlar.backend)" -GuncellemeSunucusu $C["guncelleme.sunucu"] 6>&1 | ForEach-Object { [void](GunlugeYaz "BETIK" "$_") } }
    if ($LASTEXITCODE -ne 0) { Uyar "$b-hizmeti.ps1 olcumu uyumsuz (cikis $LASTEXITCODE) - gunlukte ayrinti" } else { Ok "$b-hizmeti.ps1 olcumu: uyumlu" }
  }
  $acik = @()
  if (-not $C["saticiHesabi.kullaniciAdi"] -or -not $d.asamalar.PSObject.Properties["Sirlar"]) {
    $acik += "satici (superadmin) hesabi: yonetici konsolunda `"$kok\current\runtime\node.exe`" `"$kok\current\dist\tools\superadmin-olustur.cjs`" (once: `$env:DOTENV_CONFIG_PATH='$kok\yapilandirma\.env'; cd $kok\current) - gercek terminal"
  }
  $ad = Join-Path $kok "yedek-anahtar"
  if ($C["yedek.sifreleme"] -eq $true) {
    if (-not (Test-Path -LiteralPath (Join-Path $ad "musteri.tkpub"))) { $acik += "musteri yedek anahtari YOK - yedekler sifrelenmez: yedek-sifrele.cjs anahtar-uret --ad musteri --dizin $ad --ozel-cikti <USB>" }
    if (-not (Test-Path -LiteralPath (Join-Path $ad "yerel.tkkey"))) { $acik += "yerel yedek anahtari yok (panelden geri yukleme musteri anahtari ister): yedek-sifrele.cjs anahtar-uret --ad yerel --dizin $ad --parolali" }
    if (-not (Test-Path -LiteralPath (Join-Path $ad "etkili.tkpub"))) { $acik += "Etkili Yazilim yedek alicisi yok: acik anahtari $ad\etkili.tkpub olarak koy" }
  }
  $acik += "lisans: panelden Sistem > Lisans > etkinlestirme kodu (kurulum anahtari backend ilk acilista uretti)"
  $kayit = [ordered]@{
    v = $KURULUM_BICIMI; zaman = (Get-Date).ToUniversalTime().ToString("o"); kok = $kok
    paket = $d.paket; adlar = $d.adlar; portlar = $d.portlar
    pg = [ordered]@{ veriDizini = "$($d.pg.veriDizini)"; surum = "$($d.pg.surum)"; derleme = "$($d.pg.derleme)" }
    guvenlikDuvari = @("TeksERP API $($d.portlar.api)", "$($d.adlar.mdnsKurali)")
    uyarilar = @($script:Uyarilar); acik = $acik
  }
  MetinYaz (Join-Path $kok "kurulum\kurulum.json") (($kayit | ConvertTo-Json -Depth 6) + "`n")
  $script:Sonuc["acik"] = $acik
  $script:Sonuc["kurulum"] = [ordered]@{ surum = "$($d.paket.surum)"; api = [int]$d.portlar.api; pg = [int]$d.portlar.pg; backend = "$($d.adlar.backend)"; guncelleyici = "$($d.adlar.guncelleyici)"; postgresql = "$($d.adlar.pg)" }
  AsamaBitti $d "Dogrulama"
  DurumYaz $kok $d
  Write-Host ""
  Write-Host "  KURULUM TAMAM - backend $($d.paket.surum) - http://<sunucu>:$($d.portlar.api) - PG 127.0.0.1:$($d.portlar.pg)" -ForegroundColor Green
  foreach ($a in $acik) { Write-Host "    - ACIK: $a" -ForegroundColor Yellow }
}

# =============================================================================
# KOSU
# =============================================================================
$cikis = 0
try {
  $C0 = $null
  try { $kok0 = [IO.Path]::GetFullPath((Get-Content -LiteralPath $Cevap -Raw -Encoding UTF8 | ConvertFrom-Json).kok).TrimEnd('\') } catch { $kok0 = "C:\TeksERP" }
  if (-not $Gunluk -and -not $Kuru) {
    $gd = Join-Path $kok0 "kurulum\gunluk"
    if (-not (Test-Path -LiteralPath $gd)) { New-Item -ItemType Directory -Path $gd -Force | Out-Null }
    $Gunluk = Join-Path $gd ("kurulum-" + (Get-Date -Format "yyyyMMdd") + ".log")
  }
  $script:GunlukYolu = $Gunluk
  [void](GunlugeYaz "BASLA" "asama $Asama - cevap $Cevap - kaynak $Kaynak$(if ($Kuru) { ' - KURU' })")
  if ($Kuru -and $Asama -cne "OnKosul" -and $Asama -cne "Hepsi") { Dur "-Kuru yalniz OnKosul/Hepsi ile (plan olcumu)" }
  switch ($Asama) {
    "OnKosul" { AsamaOnKosul }
    "Paket" { AsamaPaket }
    "PostgreSQL" { AsamaPostgreSQL }
    "Backend" { AsamaBackend }
    "Hizmetler" { AsamaHizmetler }
    "Sirlar" { AsamaSirlar }
    "Dogrulama" { AsamaDogrulama }
    "Hepsi" {
      AsamaOnKosul
      if (-not $Kuru) { AsamaPaket; AsamaPostgreSQL; AsamaBackend; AsamaHizmetler; AsamaDogrulama }
    }
  }
  $script:Sonuc["tamam"] = $true
} catch {
  $msg = "$($_.Exception.Message)"
  if (-not $msg.StartsWith("KURULUM_DUR:")) {
    [void](GunlugeYaz "HATA" ("beklenmeyen: " + $msg + " @ " + $_.InvocationInfo.PositionMessage))
    Write-Host ("  X  beklenmeyen hata: " + (Maskele $msg)) -ForegroundColor Red
  }
  $script:Sonuc["hata"] = (Maskele $msg).Replace("KURULUM_DUR: ", "")
  $cikis = if ($script:CevapGecersiz) { 2 } else { 1 }
}
$script:Sonuc["uyarilar"] = @($script:Uyarilar)
$script:Sonuc["gunluk"] = $Gunluk
# SONUC satiri: musteri anahtari (yalniz Sirlar) disinda sir TASIMAZ; o da gunluge yazilmaz.
Write-Output ("SONUC:" + ($script:Sonuc | ConvertTo-Json -Depth 6 -Compress))
exit $cikis
