# =============================================================================
# TeksERP SUNUCU KURULUMU - ASAMA KOSUCUSU (TeksERP-Kurulum.exe cagirir; bayi ayni betigi sessiz kosar)
# =============================================================================
# NE YAPAR: fabrika sunucusuna Windows hizmeti duzeninde (Dagitim v2) SIFIRDAN kurulum ya da AYNI
#   surumun ONARIMI. Asamalar sirayla, her biri olcerek ilerler; olculemeyen adim DURUR (tahmin yok):
#     OnKosul    yonetici - Windows x64 - cevap dosyasi (cevap-semasi.json, KATI, sirsiz) - kok/veri
#                dizini kurallari (gecisle kurulmus duzen DUR) - paket girdileri - kanal hizmeti baska koke bagliysa
#                DUR - portlar (API mesgulse DUR; PG portSec) - RAM/disk - lisans saticisi (bos = paketin kanali
#                PAKET.json backendLisansSunucusu; farkli deger UYARI) - ag ayari (onarim/devamda kayittan)
#     Paket      kok ACL (genis grup yok) - backend paketi KURULUMUN KENDI dogrulayicisiyla (tekserp-
#                guncelleyici kurulum-paket: imza + imzali listedeki her dosya) surumler\<surum>'e -
#                current baglantisi - hizmet\backend-hizmeti.ps1 -Uygula -YalnizIskelet (SIRDAN ONCE)
#     PostgreSQL kendi ornek (D4 KENDI-POSTGRESQL.md b.4): PG paketi (kurulum-pg: kunye imzasi + zip
#                ozeti + icerik manifestosu + tek ICU) pgsql\<surum>-<derleme>'ye - pgsql\bin baglantisi -
#                initdb (parola ACL'li gecici dosyadan) - tekserp.conf + pg_hba.conf (pg-sablon.mjs) -
#                pg_ctl register (sanal hesap) - veri dizini ACL (KAYITTAN SONRA) - baslat + olcum - roller
#                + DB + DB ayarlari - .env + db-credentials.json - ornek.json (postgres parolasi DPAPI initdb'den once)
#     Backend    sema hizasi (goc ONCESI, hizmet\sema-hizasi.ps1) + prisma migrate deploy (paketin kendi Node'u) +
#                goc adlari = paket - bakim rolu (bakim-rolu.ps1) -
#                yedek sifreleme (musteri anahtari dosyaya)
#     Hizmetler  hizmet\backend-hizmeti.ps1 -Uygula (kayit -> ACL) - hizmet\guncelleyici-hizmeti.ps1 -Uygula -
#                gece yedegi gorevi (<KOK>\yedekle.ps1) - guvenlik duvari (API yalniz LocalSubnet; eski Tailscale izni yalniz onarimda kayittan,
#                mDNS; PG'ye kural YOK) - baslat: /health 200 UP/UP/surum - guncelleyici durum.json
#     Sirlar     YALNIZ sihirbaz: STDIN'den JSON (satici parolasi + PIN, yedek parolasi) -> araclara STDIN'den;
#                musteri yedek anahtari ekranda gosterilecekse SONUC satirinda doner. Gunluge sir GIRMEZ.
#     Dogrulama  hizmetler - saglik - izin katalogu (boot uzlastirmasi) - ACL olcumu - kurulum.json
#   Hepsi = OnKosul..Dogrulama (Sirlar haric) - bayinin sessiz kipi.
#
# KULLANIM (YONETICI; 5.1 yurutme ilkesi icin -ExecutionPolicy Bypass):
#   powershell -NoProfile -ExecutionPolicy Bypass -File <KOK>\kurulum\deploy\kurulum\kurulum.ps1 `
#     -Asama Hepsi -Cevap <cevap.json> -Kaynak <paketlerin klasoru> [-Dogrulayici <exe>] [-Sonuc <ini>] [-Kuru]
#   -Kuru: yalniz OnKosul olcer ve PLANI basar; hicbir sey yazmaz.
#   -Sonuc: sonucu UTF-16 INI'ye de yazar ([sonuc] bolumu; sihirbaz GetIniString ile okur) - SIRSIZ.
# CIKIS: 0 tamam - 1 DUR (gunlukte sebep) - 2 cevap dosyasi gecersiz.
# SON SATIR: "SONUC:{json}" - SIR TASIMAZ. Tek sir satiri "SIR:musteriAnahtari=<anahtar>": yalniz Sirlar
#   asamasinda, yalniz ekranda gosterim istendiyse, yalniz STDOUT'a (boruya) - INI'ye, gunluge YAZILMAZ.
# YARIM KURULUM: onceki kosu Dogrulama'ya varmadan durduysa (kurulum\durum.json var, kurulum.json yok)
#   AYNI paket ve AYNI veri dizini/portlarla yeniden kosmak kaldigi yerden DEVAM eder (asamalar olcerek gecer).
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
  [string]$Sonuc,
  [switch]$Kuru
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "kurulum-ortak.ps1")
# Kanal adlari TEK kaynaktan (gecis.ps1 ayni dosyayi paketten okur): kitte ..\hizmet\kanal-adlari.ps1.
. (Join-Path $PSScriptRoot "..\hizmet\kanal-adlari.ps1")
# Sema hizasi TEK kural (guncelleyici Rust aynasi, gecis paketten okur): kitte ..\hizmet\sema-hizasi.ps1.
. (Join-Path $PSScriptRoot "..\hizmet\sema-hizasi.ps1")

$KURULUM_BICIMI = 1
$PG_DIZINI = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\pg"))
if (-not $Dogrulayici) { $Dogrulayici = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\araclar\tekserp-guncelleyici.exe")) }
if (-not $Kaynak) { $Kaynak = Split-Path -Parent ([IO.Path]::GetFullPath($Cevap)) }
# Sonuc kaydi -Sonuc PARAMETRESINDEN AYRI ad: PowerShell'de $script:Sonuc ayni degiskendir ve [string] kisiti
# sozlugu metne cevirirdi (thinkpad-1 D8: ilk gercek kosum OnKosul sonunda "Unable to index ... String" ile dustu).
$script:SonucKaydi = [ordered]@{ asama = $Asama; tamam = $false }

# --- Cevap + adlar ------------------------------------------------------------------------------
function CevabiYukle {
  $sema = JsonOku (Join-Path $PSScriptRoot "cevap-semasi.json")
  $c = JsonOku $Cevap
  # Ham cevap (alan ACIKCA verildi mi - ag karari) ve sema (kayit dogrulamasi) asamalara acik.
  $script:CevapHam = $c
  $script:CevapSemasi = $sema
  $r = CevapDogrula $c $sema
  if ($r.hatalar.Count) {
    foreach ($h in $r.hatalar) { [void](GunlugeYaz "CEVAP" $h); Write-Host "  X  cevap: $h" -ForegroundColor Red }
    $script:CevapGecersiz = $true
    Dur "cevap dosyasi gecersiz ($($r.hatalar.Count) hata): $Cevap"
  }
  return $r.deger
}

# Hizmet adlari kanaldan (paketin backendHizmetAdi = kanal kaydi backend.hizmetAdi): kural ve turetim
# TEK yerde - hizmet\kanal-adlari.ps1 KanalAdlariCoz (gecis.ps1 de onu cagirir; GUNCELLEYICI.md b.4.2).
function AdlariCoz([string]$backendAdi, $musteri, $pgOrnek) {
  try { return (KanalAdlariCoz $backendAdi ([string]$musteri) ([string]$pgOrnek.hizmet.ad) $env:ProgramData) }
  catch { Dur $_.Exception.Message }
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

# Yarida kalmis acma dizinleri (.kurulum-<12 hex>; yalniz bu betigin verdigi ad, baglanti DEGILSE) silinir.
function GeciciTemizle([string]$ust) {
  foreach ($g in @(Get-ChildItem -LiteralPath $ust -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -cmatch '^\.kurulum-[0-9a-f]{12}$' })) {
    if (ReparseMi $g.FullName) { Uyar "gecici ad tasiyan baglanti noktasi DOKUNULMADI: $($g.FullName)"; continue }
    Remove-Item -LiteralPath $g.FullName -Recurse -Force
    Bilgi "yarida kalmis acma dizini silindi: $($g.FullName)"
  }
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

# Bitmis goc adlari (hizmet\sema-hizasi.ps1 $SEMA_BITMIS_GOC_SQL - guncelleyiciyle bayt-esit); okunamazsa DUR.
function BitmisGoclar([string]$bin, [int]$port, [string]$kullanici, [string]$parola, [string]$vt) {
  $r = PsqlStdin $bin $port $kullanici $parola $vt "$($script:SEMA_BITMIS_GOC_SQL);"
  if ($r.kod -ne 0) { Dur "goc listesi okunamadi: $($r.cikti)" }
  return @(($r.cikti -csplit "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

# .env yapilandirma\ dizininin MIRASINI alir (iskelet SYSTEM + Administrators; backend-hizmeti.ps1 -Uygula
# hizmet hesabina okuma verir). Korumali DACL KONMAZ: konursa hizmet hesabi .env'i okuyamaz. Dizin genis
# gruplara aciksa (iskelet kurulmamis) sir YAZILMAZ; yazilan dosya da olculur.
# Her satir EnvSatiriGecerli'den (kurulum-ortak.ps1: sade bicim KEY=deger) gecer; tek istisna onarimda
# korunan bakim-rolu.ps1 satirlari (BACKUP_PG_*), onlari kurulum yazmaz.
function EnvYaz([string]$yol, [string]$metin) {
  foreach ($satir in ($metin -csplit "`n")) {
    if ($satir -and -not (EnvSatiriGecerli $satir) -and $satir -cnotmatch '^BACKUP_PG_(USER|PASSWORD)=') { Dur ".env satiri sade bicimde degil (tirnak/bosluk/#/ters bolu): $(($satir -csplit '=', 2)[0])=..." }
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
  # Yarim kurulum: onceki kosu OnKosul'u gecip Dogrulama'ya varmadan durdu (durum.json var, kurulum.json yok).
  $yarim = $null
  if (-not $onarim -and (Test-Path -LiteralPath (DurumYolu $kok))) { $yarim = DurumOku $kok }
  if (-not $onarim -and -not $yarim -and (Test-Path -LiteralPath $kok)) {
    # Gecisle kurulmus duzen (kayit yok, gecis gunlugu + current): ayri sinif, kurulum yardimcisi onarmaz.
    $gd = GecisliDuzen $kok
    if ($gd) { Dur $gd.metin }
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
  if ($yarim) {
    if ("$($yarim.adlar.backend)" -cne $ad.backend -or "$($yarim.paket.surum)" -cne "$($k.uygulamaSurumu)") { Dur "yarim kurulum ($($yarim.adlar.backend) $($yarim.paket.surum)) bu paketle ($($ad.backend) $($k.uygulamaSurumu)) surdurulmez - ayni paketi verin ya da once kaldirin (kaldir.ps1 veriyi korur)" }
    Uyar "YARIM KURULUM bulundu ($($yarim.paket.surum)) - kaldigi yerden devam ediliyor (asamalar yeniden olcer)"
  }
  # Ayni adli kanal hizmeti BASKA koke bagliysa (ya da bagli oldugu kok olculemezse) DUR - o kurulumun hizmetini
  # ezerdi (kurulum-ortak.ps1 HizmetKokEngelleri; sihirbaz ayni islevle engel gosterir).
  $hk = HizmetKokEngelleri $ad $kok
  if ($hk.Count) { Dur ((@($hk) | ForEach-Object { $_.metin }) -join " | ") }
  # Gercek kurulu surum: kurulum.json KURULUM ANININ surumudur. Kaldirilip ESKI kitle yeniden kurulumda eski kod
  # yeni semali veritabanina inmez - hicbir sey degismeden DUR (EskiPaketOlcumu: sihirbazla TEK giris).
  if ($onarim -or $yarim) {
    $ep = EskiPaketOlcumu $kok $ad.veriKoku "$($k.uygulamaSurumu)"
    $engel = $ep.engel
    if ($engel) { Dur $engel }
    if ($ep.kurulu) { Bilgi "kurulu surum $($ep.kurulu.surum) ($($ep.kurulu.kaynak)) - paket $($k.uygulamaSurumu)" }
  }

  # API portu: istemcilerin varsayilan adresi - mesgulse DUR (onarimda dinleyen kendi backend'imiz olabilir).
  $apiPort = [int]$C["api.port"]
  if (PortDinleniyorMu $apiPort) {
    $bizim = ($onarim -or $yarim) -and ((Get-Service -Name $ad.backend -ErrorAction SilentlyContinue).Status -ceq "Running")
    if (-not $bizim) { Dur "API portu $apiPort MESGUL - cevap dosyasinda api.port ile bos bir port verin (panel/tablet adresi de o porta ayarlanir)" }
  }

  # PG portu: kayitli (ornek.json) > istenen > 5432..5499 ilk bos (D4 portSec); olculemeyen port bos sayilmaz.
  $ornekYolu = Join-Path $kok "pgsql\ornek.json"
  $onceki = $null
  if (Test-Path -LiteralPath $ornekYolu) {
    $o = JsonOku $ornekYolu
    if ("$($o.kip)" -ceq "harici") { Dur "bu kok HARICI PostgreSQL kipinde (pm2 donemi kurulumu) - setup onarmaz; gecis: gecis\gecis.ps1 (D6)" }
    $onceki = [int]$o.port
  } elseif ($yarim) { $onceki = [int]$yarim.portlar.pg }
  $mesgul = @()
  try { $mesgul += @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.LocalPort }) } catch { }
  $mesgul += (PgHizmetPortlari)
  $mesgul += (HaricPortlar ([int]$pgOrnek.port.baslangic) ([int]$pgOrnek.port.bitis))
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
  if ($yarim -and ($veri -cne "$($yarim.pg.veriDizini)")) { Dur "yarim kurulumun veri dizini $($yarim.pg.veriDizini) - ayni dizin verilmeli (baska dizin yeni kurulum ister)" }
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
    if ($dolu -and -not (($onarim -or $yarim) -and $pgVar)) { Dur "veri dizini BOS degil ($veri) - dolu dizinde initdb KOSMAZ, veri silinmez; bos bir dizin verin" }
  }
  if ([double]$disk.FreeSpace -lt 2GB) { Uyar "veri surucusunde 2 GB'tan az bos alan ($surucu)" }
  $kokDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($kok.Substring(0, 2))'" -ErrorAction SilentlyContinue
  if ($kokDisk -and [double]$kokDisk.FreeSpace -lt 2GB) { Dur "kok surucusunde 2 GB'tan az bos alan ($($kok.Substring(0, 2)))" }
  $ramMB = [int][math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
  if ($ramMB -lt 2048) { Uyar "RAM $ramMB MB (< 2 GB) - PostgreSQL bellek formulu tabana iner, yavas olabilir" }

  # Lisans saticisi kanal kaydindan (kurulum-ortak.ps1 LisansSunucusuKarari): bos alan = kanal; farkli deger UYARI
  # (engel degil). Var olan .env (onarim/devam) yeniden yazilmaz: karar ondan, kanaldan farkliysa uyari.
  $envYolu = Join-Path $kok "yapilandirma\.env"
  $lisKayit = $null
  if (Test-Path -LiteralPath $envYolu -PathType Leaf) { $lisKayit = "$(EnvDeger ([IO.File]::ReadAllLines($envYolu)) 'LICENSE_SERVER_URL')" }
  $lis = LisansSunucusuKarari ([string]$k.backendLisansSunucusu) ([string]$k.lisansSunucusuVarsayilan) ([string]$C["lisans.saticiAdresi"]) $lisKayit ([string]$k.backendKanal)
  foreach ($x in $lis.uyarilar) { Uyar $x }
  Ok "lisans sunucusu: $(if ($lis.etkili) { $lis.etkili } else { 'derleme varsayilani' }) ($($lis.kaynakMetni))$(if ($lis.yaz) { ' - .env satiri yazilacak' })"

  # Ag ayari (API guvenlik duvari): onarim/devamda KAYITTAN (kurulum-ortak.ps1 KayitliAgAyari + AgKarari) - varsayilan
  # (LocalSubnet) kayittaki erisimi DARALTMAZ; cevapta acikca verilen farkli deger ve kayittaki eski Tailscale izni uyarilir.
  $agKayit = $null
  if ($onarim -or $yarim) { $agKayit = KayitliAgAyari $kok $script:CevapSemasi }
  $agK = AgKarari $C $script:CevapHam $agKayit $script:CevapSemasi
  foreach ($x in $agK.uyarilar) { Uyar $x }
  Ok "ag: API $(AgMetni $agK.ag.izinliAdresler) - profil $(AgMetni $agK.ag.agProfilleri) - mDNS $(AgMetni $agK.ag.mdns) ($($agK.ag.kaynak))"

  $plan = [ordered]@{
    v = $KURULUM_BICIMI; mod = $(if ($onarim) { "onarim" } elseif ($yarim) { "devam" } else { "kurulum" }); kok = $kok
    girdiler = [ordered]@{ backend = $zip; pg = $pgZip; pgKunye = $pgKunye }
    paket = [ordered]@{ surum = "$($k.uygulamaSurumu)"; kanal = $k.backendKanal; gocSayisi = [int]$k.migrationSayisi }
    adlar = $ad
    portlar = [ordered]@{ api = $apiPort; pg = [int]$sec.port }
    pg = [ordered]@{ veriDizini = $veri; surum = "$($pgSurum.surum)"; derleme = "$($pgSurum.derleme)"; cizgi = "$($pgSurum.cizgi)"; icu = "$($pgSurum.yayin.'win-x64'.icuSurum)"; ramMB = $ramMB }
    lisans = [ordered]@{ etkili = $lis.etkili; kaynak = $lis.kaynak; yaz = $lis.yaz; kanal = $lis.kanal; varsayilan = $lis.varsayilan }
    ag = $agK.ag
    asamalar = [ordered]@{}
  }
  if ($Kuru) {
    Write-Host ""
    Write-Host "KURU KIP - PLAN (hicbir sey yazilmadi):" -ForegroundColor Cyan
    Write-Host ($plan | ConvertTo-Json -Depth 6)
    $script:SonucKaydi["plan"] = $plan
    return
  }
  if ($yarim -and $yarim.PSObject.Properties["asamalar"]) {
    foreach ($p in $yarim.asamalar.PSObject.Properties) { if ($p.Name -cne "OnKosul") { $plan.asamalar[$p.Name] = $p.Value } }
    foreach ($a in @("paketId", "kid", "hazirlikAnahtari")) { if ($yarim.paket.PSObject.Properties[$a]) { $plan.paket[$a] = $yarim.paket.$a } }
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
  GeciciTemizle $surumler
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
  [void](BackendHizmetBetigi $kok $d @("-Uygula", "-YalnizIskelet"))
  AsamaBitti $d "Paket"
  DurumYaz $kok $d
}

# TEK CAGRI NOKTASI (yonetici karari): backend hizmetinin kaydi + ACL'si yalniz bu betikte
# (hizmet\backend-hizmeti.ps1, D6). Imza: -Kok -HizmetAdi -PgHizmeti|-PgYok -GuncellemeDizini [-YalnizIskelet] [-Uygula].
# -Uygula yoksa OLCUM kipidir (degisiklik yok): cikis kodu doner, DURMAZ (Dogrulama uyarir).
function BackendHizmetBetigi([string]$kok, $d, [string[]]$ek) {
  $betik = Join-Path $kok "current\hizmet\backend-hizmeti.ps1"
  $arg = @{ Kok = $kok; HizmetAdi = "$($d.adlar.backend)"; PgHizmeti = "$($d.adlar.pg)"; GuncellemeDizini = (Join-Path "$($d.adlar.veriKoku)" "guncelleme") }
  if ($ek -ccontains "-Uygula") { $arg["Uygula"] = $true }
  if ($ek -ccontains "-YalnizIskelet") { $arg["YalnizIskelet"] = $true }
  Bilgi "hizmet\backend-hizmeti.ps1 $($ek -join ' ')"
  $global:LASTEXITCODE = 0
  & $betik @arg 6>&1 | ForEach-Object { [void](GunlugeYaz "BETIK" "$_") }
  $kod = $LASTEXITCODE
  if (-not $arg.ContainsKey("Uygula")) { return $kod }
  if ($kod -ne 0) { Dur "backend-hizmeti.ps1 $($ek -join ' ') cikis $kod (0 uyumlu - 2 uyumsuz - 1 hata) - gunlukte ayrinti" }
  Ok "backend-hizmeti.ps1 $($ek -join ' '): uyumlu"
  return $kod
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
  if (-not $arg.ContainsKey("Uygula")) { return $kod }
  if ($kod -ne 0) { Dur "guncelleyici-hizmeti.ps1 $($ek -join ' ') cikis $kod - gunlukte ayrinti" }
  Ok "guncelleyici-hizmeti.ps1 $($ek -join ' '): uyumlu"
  return $kod
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
  GeciciTemizle $pgsql

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
  #    postgres parolasi initdb'DEN ONCE diske (DPAPI) iner: yarida kalan kurulum parolayi kaybederse veri
  #    dizini bir daha acilamazdi (devam/onarim ayni parolayla baglanir).
  $pgSetup = Join-Path $kok "pg-setup"
  if (-not (Test-Path -LiteralPath $pgSetup)) { New-Item -ItemType Directory -Path $pgSetup | Out-Null; AclKoru $pgSetup @() }
  $dpapi = Join-Path $pgSetup "pg-yonetici.dpapi"
  $alfabe = "$($pgOrnek.parola.alfabe)"; $uzunluk = [int]$pgOrnek.parola.uzunluk
  if (Test-Path -LiteralPath $dpapi) { $suParola = DpapiCoz ([IO.File]::ReadAllBytes($dpapi)) }
  else {
    if (Test-Path -LiteralPath (Join-Path $veri "PG_VERSION")) { Dur "veri dizini dolu ama postgres parolasi (pg-setup\pg-yonetici.dpapi) yok - bu kurulumun veri dizini degil; bos bir veri dizini verin" }
    $suParola = YeniParolaUret $alfabe $uzunluk
    SirDosyasiYaz $dpapi (DpapiKoru $suParola) @()
    Ok "postgres parolasi uretildi -> pg-setup\pg-yonetici.dpapi (DPAPI, yalniz SYSTEM + Administrators) - initdb'den ONCE"
  }
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
    if (-not $d.PSObject.Properties["lisans"]) { Dur "durum.json lisans saticisi kararini tasimiyor - once OnKosul (ayni kurulum kiti)" }
    if ($d.lisans.yaz -eq $true) { $satirlar += "LICENSE_SERVER_URL=$($d.lisans.etkili)" }
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
  Ok "db-credentials.json (yalniz SYSTEM + Administrators)"

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

  # Sema hizasi (hizmet\sema-hizasi.ps1, guncelleyiciyle TEK kural): veritabaninda paketin tasimadigi bitmis goc
  # varsa paket semanin GERISINDE - goc KOSMADAN, hicbir sey degismeden DUR (geri indirme yok).
  $paketGoclari = @(SurumGocAdlari (JunctionHedefi $cur))
  if ($paketGoclari.Count -ne [int]$d.paket.gocSayisi) { Dur "paketin goc dizini $($paketGoclari.Count) goc tasiyor - PAKET.json $($d.paket.gocSayisi)" }
  $tablo = PsqlStdin $bin $port $rol $uyParola $vt "SELECT to_regclass('_prisma_migrations') IS NOT NULL;"
  if ($tablo.kod -ne 0) { Dur "veritabani olculemedi (goc tablosu): $($tablo.cikti)" }
  if ($tablo.cikti -ceq "t") {
    $once = BitmisGoclar $bin $port $rol $uyParola $vt
    $ileri = @(SemaIleride $once $paketGoclari)
    if ($ileri.Count) { Dur "sema ileride: veritabaninda paketin ($($d.paket.surum)) tasimadigi $($ileri.Count) bitmis goc var (ilk: $($ileri[0])) - paket kurulu semadan ESKI, geri indirme yapilmaz; bu goclari tasiyan surumle kurun" }
  }

  $g = NodeKos $node @("node_modules\prisma\build\index.js", "migrate", "deploy") (JunctionHedefi $cur) @{ DOTENV_CONFIG_PATH = $envYolu; NODE_ENV = "production" } $null
  [void](GunlugeYaz "GOC" ($g.stdout + "`n" + $g.stderr))
  if ($g.kod -ne 0) { Dur "prisma migrate deploy cikis $($g.kod) - gunlukte ayrinti (veritabani BOS kurulumda; tekrar denemek guvenli)" }
  $sonra = BitmisGoclar $bin $port $rol $uyParola $vt
  $eksik = @(GocFarki $paketGoclari $sonra)
  $ileri = @(SemaIleride $sonra $paketGoclari)
  if ($eksik.Count -or $ileri.Count) { Dur "goc sonrasi veritabani paketle esit degil: eksik $($eksik.Count)$(if ($eksik.Count) { " (ilk: $($eksik[0]))" }) - fazla $($ileri.Count)$(if ($ileri.Count) { " (ilk: $($ileri[0]))" })" }
  Ok "goc: $($sonra.Count) migration uygulandi = paket (paketin kendi Node'u ve prisma'si)"

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
  [void](BackendHizmetBetigi $kok $d @("-Uygula"))
  [void](GuncelleyiciHizmetBetigi $kok $d $C @("-Uygula"))

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

  # Guvenlik duvari: API yalniz secili profiller + LocalSubnet (onarimda kayittaki eski izin korunur); mDNS (kesif); PG'ye kural YOK.
  # Ayar OnKosul KARARINDAN (durum ag: onarim/devamda kayittan); karar tasimayan eski durum.json -> cevap.
  $ag = $(if ($d.PSObject.Properties["ag"] -and $d.ag) { $d.ag } else { [pscustomobject]@{ izinliAdresler = @($C["api.izinliAdresler"]); agProfilleri = @($C["api.agProfilleri"]); mdns = $C["api.mdns"] } })
  $apiPort = [int]$d.portlar.api
  $apiKural = "TeksERP API $apiPort"
  if (-not (Get-NetFirewallRule -DisplayName $apiKural -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $apiKural -Direction Inbound -Protocol TCP -LocalPort $apiPort -Action Allow -Profile @($ag.agProfilleri) -RemoteAddress @($ag.izinliAdresler) | Out-Null
    Ok "guvenlik duvari: $apiKural ($(@($ag.agProfilleri) -join ',') - $(@($ag.izinliAdresler) -join ','))"
  } else { Bilgi "kural zaten var, DOKUNULMADI: $apiKural" }
  if ($ag.mdns -eq $true -and -not (Get-NetFirewallRule -DisplayName "$($d.adlar.mdnsKurali)" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "$($d.adlar.mdnsKurali)" -Direction Inbound -Protocol UDP -LocalPort 5353 -Action Allow -Profile @($ag.agProfilleri) -RemoteAddress LocalSubnet | Out-Null
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
# ortama, gunluge GIRMEZ; araclara STDIN'den gider. SONUC satiri ve INI sir TASIMAZ - musteri anahtari
# (ekranda bir kez gosterilmesi istendiyse) yalniz "SIR:" satiriyla STDOUT'a (sihirbazin borusuna) gider.
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
    # PIN ozeti hizmetin anahtar halkasiyla yazilir: arac surum dizininde kostugu icin varsayilan lisans deposu yanlis yere duser.
    $r = NodeKos $node @("dist\tools\superadmin-olustur.cjs", "--kurulum-stdin") (JunctionHedefi $cur) @{ DOTENV_CONFIG_PATH = (Join-Path $kok "yapilandirma\.env"); LICENSE_DIR = (Join-Path $kok "lisans") } $girdi
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
      $anahtarSatiri = "$(@($r.stdout -csplit "`n" | Where-Object { $_.Trim() }) | Select-Object -Last 1)".Trim()
      if ($anahtarSatiri -cnotmatch '^[\x21-\x7E]{16,512}$') { Dur "musteri anahtari beklenen bicimde degil (arac ciktisi)" }
      SirEkle $anahtarSatiri
      $script:SirSatiri = "SIR:musteriAnahtari=" + $anahtarSatiri
      $sonuc["musteriAnahtari"] = $true
      Ok "musteri yedek anahtari uretildi - OZEL YARISI yalniz boruya (sihirbaz BIR KEZ gosterir; gunluge/INI'ye yazilmadi)"
    }
  }
  $script:SonucKaydi["sirlar"] = $sonuc
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
  $envSatirlari = [IO.File]::ReadAllLines($envYolu)
  $url = EnvDeger $envSatirlari "DATABASE_URL"
  # Lisans saticisi yazilan .env'den OLCULUR (ayni islev): karardan sapma ya da kanaldan fark sonuca/kurulum.json'a duser.
  if ($d.PSObject.Properties["lisans"]) {
    $lm = LisansSunucusuKarari "$($d.lisans.kanal)" "$($d.lisans.varsayilan)" ([string]$C["lisans.saticiAdresi"]) "$(EnvDeger $envSatirlari 'LICENSE_SERVER_URL')" "$($d.paket.kanal)"
    foreach ($x in $lm.uyarilar) { Uyar $x }
    if ("$($lm.etkili)" -cne "$($d.lisans.etkili)") { Uyar "etkin lisans sunucusu ($($lm.etkili), yapilandirma\.env) kurulumun kararindan ($($d.lisans.etkili)) FARKLI" }
    else { Ok "lisans sunucusu: $(if ($lm.etkili) { $lm.etkili } else { 'derleme varsayilani' }) ($($lm.kaynakMetni))" }
  } else { Uyar "lisans sunucusu olculmedi: durum.json kurulum kararini tasimiyor" }
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
  # Olcum kipinde (degisiklik yok) iki hizmet betigi - AYNI tek cagri noktalarindan: kayit + ACL + ayar uyumlu mu.
  $kb = BackendHizmetBetigi $kok $d @()
  if ($kb -ne 0) { Uyar "backend-hizmeti.ps1 olcumu uyumsuz (cikis $kb) - gunlukte ayrinti" } else { Ok "backend-hizmeti.ps1 olcumu: uyumlu" }
  $kg = GuncelleyiciHizmetBetigi $kok $d $C @()
  if ($kg -ne 0) { Uyar "guncelleyici-hizmeti.ps1 olcumu uyumsuz (cikis $kg) - gunlukte ayrinti" } else { Ok "guncelleyici-hizmeti.ps1 olcumu: uyumlu" }
  $acik = @()
  # Yapilacaklar OLCULUR (onarimda hesap/lisans zaten var): olculemezse eski kural (fail-closed: listede kalir).
  $q = PsqlStdin (Join-Path $kok "pgsql\bin") $port $rol $uyParola $vt 'SELECT count(*) FROM users WHERE "isSystemAccount" AND "isActive" AND "deletedAt" IS NULL;'
  $saticiVar = ($q.kod -eq 0 -and "$($q.cikti)".Trim() -cmatch '^[1-9][0-9]*$')
  if ($saticiVar) { Ok "satici (superadmin) hesabi var" }
  elseif (-not $C["saticiHesabi.kullaniciAdi"] -or -not $d.asamalar.PSObject.Properties["Sirlar"]) {
    $acik += "satici (superadmin) hesabi: yonetici konsolunda `"$kok\current\runtime\node.exe`" `"$kok\current\dist\tools\superadmin-olustur.cjs`" (once: `$env:DOTENV_CONFIG_PATH='$kok\yapilandirma\.env'; cd $kok\current) - gercek terminal"
  }
  $ad = Join-Path $kok "yedek-anahtar"
  if ($C["yedek.sifreleme"] -eq $true) {
    if (-not (Test-Path -LiteralPath (Join-Path $ad "musteri.tkpub"))) { $acik += "musteri yedek anahtari YOK - yedekler sifrelenmez: yedek-sifrele.cjs anahtar-uret --ad musteri --dizin $ad --ozel-cikti <USB>" }
    if (-not (Test-Path -LiteralPath (Join-Path $ad "yerel.tkkey"))) { $acik += "yerel yedek anahtari yok (panelden geri yukleme musteri anahtari ister): yedek-sifrele.cjs anahtar-uret --ad yerel --dizin $ad --parolali" }
    if (-not (Test-Path -LiteralPath (Join-Path $ad "etkili.tkpub"))) { $acik += "Etkili Yazilim yedek alicisi yok: acik anahtari $ad\etkili.tkpub olarak koy" }
  }
  $lis = Join-Path $kok "lisans"
  if ((Test-Path -LiteralPath (Join-Path $lis "hak.jws") -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $lis "kurulum-kimligi.json") -PathType Leaf)) { Ok "lisans etkin (lisans\hak.jws + kurulum-kimligi.json)" }
  else { $acik += "lisans: panelden Sistem > Lisans > etkinlestirme kodu (kurulum anahtari backend ilk acilista uretti)" }
  $kayit = [ordered]@{
    v = $KURULUM_BICIMI; zaman = (Get-Date).ToUniversalTime().ToString("o"); kok = $kok
    paket = $d.paket; adlar = $d.adlar; portlar = $d.portlar
    pg = [ordered]@{ veriDizini = "$($d.pg.veriDizini)"; surum = "$($d.pg.surum)"; derleme = "$($d.pg.derleme)" }
    guvenlikDuvari = @("TeksERP API $($d.portlar.api)", "$($d.adlar.mdnsKurali)")
    ag = $(if ($d.PSObject.Properties["ag"]) { $d.ag } else { $null })
    uyarilar = @($script:Uyarilar); acik = $acik
  }
  MetinYaz (Join-Path $kok "kurulum\kurulum.json") (($kayit | ConvertTo-Json -Depth 6) + "`n")
  $script:SonucKaydi["acik"] = $acik
  $script:SonucKaydi["kurulum"] = [ordered]@{ surum = "$($d.paket.surum)"; api = [int]$d.portlar.api; pg = [int]$d.portlar.pg; backend = "$($d.adlar.backend)"; guncelleyici = "$($d.adlar.guncelleyici)"; postgresql = "$($d.adlar.pg)" }
  AsamaBitti $d "Dogrulama"
  DurumYaz $kok $d
  Write-Host ""
  Write-Host "  KURULUM TAMAM - backend $($d.paket.surum) - http://<sunucu>:$($d.portlar.api) - PG 127.0.0.1:$($d.portlar.pg)" -ForegroundColor Green
  foreach ($a in $acik) { Write-Host "    - ACIK: $a" -ForegroundColor Yellow }
}

# Sihirbazin okudugu sonuc (UTF-16 INI, [sonuc]): duz anahtarlar + numarali listeler (uyari1.., acik1..).
# SIRSIZ: yalniz $script:SonucKaydi'ndan; Sirlar'in musteri anahtari orada yalniz "uretildi" bayragidir.
function SonucIniYaz([string]$yol, $s) {
  $l = New-Object Collections.Generic.List[string]
  $l.Add("[sonuc]")
  $tek = { param($k, $v) $l.Add("$k=" + (Maskele ("$v" -creplace '[\r\n]+', ' '))) }
  & $tek "asama" $s["asama"]
  & $tek "tamam" $(if ($s["tamam"] -eq $true) { 1 } else { 0 })
  if ($s.Contains("hata")) { & $tek "hata" $s["hata"] }
  & $tek "gunluk" $s["gunluk"]
  $u = @($s["uyarilar"] | Where-Object { $_ })
  & $tek "uyariSayisi" $u.Count
  for ($i = 0; $i -lt $u.Count; $i++) { & $tek "uyari$($i + 1)" $u[$i] }
  if ($s.Contains("acik")) { $a = @($s["acik"] | Where-Object { $_ }); & $tek "acikSayisi" $a.Count; for ($i = 0; $i -lt $a.Count; $i++) { & $tek "acik$($i + 1)" $a[$i] } }
  if ($s.Contains("kurulum")) { foreach ($k in @($s["kurulum"].Keys)) { & $tek "kurulum.$k" $s["kurulum"][$k] } }
  if ($s.Contains("plan")) { & $tek "plan.mod" $s["plan"].mod; & $tek "plan.surum" $s["plan"].paket.surum }
  if ($s.Contains("sirlar")) {
    $r = $s["sirlar"]
    if ($r.Contains("satici")) { foreach ($k in @("kod", "sonuc", "hata", "kullaniciAdi")) { & $tek "satici.$k" $r["satici"][$k] } }
    if ($r.Contains("yerelAnahtar")) { & $tek "yerelAnahtar" $(if ($r["yerelAnahtar"]) { 1 } else { 0 }) }
    if ($r.Contains("musteriAnahtari")) { & $tek "musteriAnahtari" $(if ($r["musteriAnahtari"] -eq $true) { 1 } else { 0 }) }
  }
  MetinYaz $yol (($l -join "`r`n") + "`r`n") ([Text.Encoding]::Unicode)
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
  # 32-bit kabuk (SysWOW64) yanlis kayit defteri/yol gorunumu verir: hizmet, ACL ve PG olcumleri 64-bit ister.
  if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) { Dur "64-bit PowerShell gerekir (32-bit kabuktan cagrildi): %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" }
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
  $script:SonucKaydi["tamam"] = $true
} catch {
  $msg = "$($_.Exception.Message)"
  if (-not $msg.StartsWith("KURULUM_DUR:")) {
    [void](GunlugeYaz "HATA" ("beklenmeyen: " + $msg + " @ " + $_.InvocationInfo.PositionMessage))
    Write-Host ("  X  beklenmeyen hata: " + (Maskele $msg)) -ForegroundColor Red
  }
  $script:SonucKaydi["hata"] = (Maskele $msg).Replace("KURULUM_DUR: ", "")
  $cikis = if ($script:CevapGecersiz) { 2 } else { 1 }
}
$script:SonucKaydi["uyarilar"] = @($script:Uyarilar)
$script:SonucKaydi["gunluk"] = $Gunluk
if ($Sonuc) { try { SonucIniYaz $Sonuc $script:SonucKaydi } catch { Write-Host ("  X  sonuc dosyasi yazilamadi: " + $_.Exception.Message) -ForegroundColor Red; $cikis = 1 } }
# Tek sir satiri (yalniz Sirlar, yalniz istendiyse): boruya; SONUC satiri ve INI SIRSIZDIR.
if ($script:SirSatiri) { Write-Output $script:SirSatiri; $script:SirSatiri = $null }
Write-Output ("SONUC:" + ($script:SonucKaydi | ConvertTo-Json -Depth 6 -Compress))
exit $cikis
