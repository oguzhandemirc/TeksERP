# =============================================================================
# TeksERP Backend - ILK KURULUM (sifirdan iskelet)
# =============================================================================
# NEREDE CALISIR: YENI SUNUCUDA, YONETICI PowerShell'de.
#
# ⚠ YURUTME ILKESI: Windows 11 istemcide varsayilan `Restricted`, Server'da
#   `RemoteSigned` (+ zip'ten cikan dosyada "internetten geldi" isareti). Ikisinde
#   de `.\ilk-kurulum.ps1` HIC KOSMAZ. Script daima su bicimde cagrilir - ilke
#   yalniz bu surec icin gevser, makinenin ayari degismez:
#     powershell -NoProfile -ExecutionPolicy Bypass -File .\ilk-kurulum.ps1 <parametreler>
#
#   # Sifirdan (veritabani da yok) - iki parola da gizli sorulur:
#   ... -File .\ilk-kurulum.ps1 -PgAyarla
#   (-PgAyarla: PostgreSQL sunucu ayarlarini da yazar - YENI sunucuda; bayraksiz yalniz raporlar)
#
#   # Fabrika yedegini de yukle (tek komut) - dokumun AMACI ZORUNLU (asagida):
#   ... -File .\ilk-kurulum.ps1 -Dump "C:\yol\son.dump" -DumpAmaci Kopya -PgAyarla
#
#   # Etkilesimsiz (zamanlanmis gorev / uzaktan): parolalar DOSYADAN
#   ... -File .\ilk-kurulum.ps1 -DbParolaDosyasi C:\gecici\db.txt -PostgresParolaDosyasi C:\gecici\pg.txt
#
#   # Veritabani ZATEN varsa (elle olusturulmus): yonetici parolasi gerekmez.
#   ... -File .\ilk-kurulum.ps1 -DbAdi tekserp_yeni -DbKullanici postgres
#
# NE YAPAR: `kur.ps1`in BEKLEDIGI iskeleti kurar - klasorler, pg baglantisi,
#   veritabani + rol, [dump], DB duzeyi ayarlar, [PostgreSQL sunucu ayarlari],
#   db-credentials.json, .env, sir dosyalarinin izinleri, pm2, acilis + gece yedegi
#   gorevleri, API guvenlik duvari kurali. Kendisi SURUM KURMAZ; islemi bitince
#   `kur.ps1` komutunu ve YAPILMADAN KALANLAR listesini yazar.
#
# NEDEN VAR (2026-09-04): `kur.ps1` bir YUKSELTME aracidir; ilk satirlarinda
#   "Mevcut kurulum bulunamadi" ile durur ve `.env`i MEVCUT kurulumdan alir.
#   Fabrikadaki iskelet bir kez, artik var olmayan bir installer'la kurulmustu
#   (dokumanlardaki "installer'dan tasindi" notlari onun kalintisi). Yani
#   SIFIRDAN kurulumun YAZILI BIR YOLU YOKTU: yeni musteride ve prova
#   makinesinde adimlar elle, hafizadan tekrarlaniyordu. "Tek govde, cok
#   fabrika" hedefinde bu surdurulemez.
#
# ⚠ IDEMPOTENT: var olan hicbir sey EZILMEZ. `.env` varsa dokunulmaz (sir!),
#   klasorler/rol/veritabani varsa gecilir, MEVCUT ROLUN PAROLASI DEGISTIRILMEZ.
#   Iki kez kosmak guvenlidir.
#
# ⚠ -Dump VERILINCE -DumpAmaci ZORUNLUDUR (varsayilan YOK). Dokum fabrikanin kurulum
#   kimligini (`system.installationId`) ve makine disi yedek hedefini
#   (`backup.offsiteRemote`/`offsiteDir`) tasir:
#     Kopya   test/prova/demo kopyasi -> kimlik YENILENIR, offsite hedefi BOSALTILIR.
#             Yenilenmezse ayni LAN'daki tablet/panel kopyayi fabrika sanip baglanir
#             ve kopyanin yedekleri fabrikanin Drive/NAS'ina gider.
#     Tasima  AYNI fabrika yeni sunucuya tasiniyor -> ikisi de KORUNUR.
#   Ikisinin de sessiz bir varsayilani yanlistir; bkz. arsiv 2026-09-27 thinkpad-1 provasi.
#
# ⚠ PAROLA VARSAYILANI YOKTUR ve olmayacaktir. Bu dosya fabrika sunucusunda da
#   kosar; gomulu bir varsayilan oraya da giderdi ve "sonra degistiririz" adimi
#   unutulurdu. Parola uc yoldan gelir, tercih sirasiyla:
#     (1) soru: parametre verilmezse gizli sorulur (Read-Host -AsSecureString);
#     (2) dosya: -DbParolaDosyasi / -PostgresParolaDosyasi <yol> (tek satir; zamanlanmis
#         gorevde soru sorulamaz - dosyayi ACL'li olustur, kurulumdan sonra sil);
#     (3) duz: -DbParola / -PostgresParola - komut satiri PowerShell gecmisine ve surec
#         listesine duser; calisir ama uyari basar.
# =============================================================================
param(
  [string]$DbAdi = "tekserp",
  [string]$DbParola,                                 # uygulamanin baglanti parolasi (baslik: parola)
  [string]$DbParolaDosyasi,
  [string]$DbKullanici = "tekserp",                  # uygulamanin DB rolu
  [string]$PostgresParola,                           # rol/DB yaratmak + superuser ayarlari icin
  [string]$PostgresParolaDosyasi,
  [string]$PostgresKullanici = "postgres",
  [string]$Dump,                                     # opsiyonel: BOS veritabanina yukle
  [ValidateSet("Kopya", "Tasima")][string]$DumpAmaci, # -Dump ile ZORUNLU (baslik)
  [int]$DbPort = 5432,
  [string]$PgBin,
  [string]$Kok = "C:\TeksERP",
  # PostgreSQL SUNUCU ayarlari (runbook §6) ALTER SYSTEM ile yazilsin mi. Sunucu
  # GENELIDIR (tum veritabanlari) - verilmezse yalniz fark RAPORLANIR. Superuser ister.
  [switch]$PgAyarla,
  # Yeniden baslatma isteyen ayar (shared_buffers, listen_addresses...) yazildiysa
  # tek calisan postgresql* servisini yeniden baslat. Canli sunucuda VERME.
  [switch]$PgYenidenBaslat,
  # Gece yedegi gorevinin saati (fabrika dokumlerinin damgasi 03:00:01 - olculdu).
  [ValidatePattern('^\d{2}:\d{2}$')][string]$YedekSaati = "03:00",
  # Opsiyonel ikinci kopya (ikinci disk). Fabrikada E:\TeksERP-yedek.
  [string]$YedekIkinciHedef,
  # Paketteki web paneli (app\dist-web) sunulmasin: .env'e WEB_DIST_DIR yazilmaz.
  [switch]$WebPanelKapali,
  # API (4000) gelen kurali: yalniz bu profiller ve uzak adresler. Public profil ve
  # "Any" adres bilerek varsayilan DEGIL (bkz. Tailscale-In uyarisi, runbook §2.2).
  [int]$ApiPort = 4000,
  [ValidateSet("Domain", "Private", "Public")][string[]]$ApiAgProfili = @("Domain", "Private"),
  [string[]]$ApiIzinliAdres = @("LocalSubnet")
)
$ErrorActionPreference = "Stop"

# Adimlar kendiliginden numaralanir; adim eklenince yalniz toplam degisir.
$script:adimNo = 0
$script:adimToplam = 13
function Adim($m) { $script:adimNo++; Write-Host ""; Write-Host "[$($script:adimNo)/$($script:adimToplam)] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  + $m" -ForegroundColor Green }
function Uyar($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Dur($m)  { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; Write-Host ""; exit 1 }
# Kurulumu durdurmayan ama YAPILMADAN kalan is: sonda tek listede tekrar basilir.
$script:acik = @()
function Acik($m) { Uyar $m; $script:acik += $m }

# Parola: dosya > duz (uyarili) > gizli soru. Etkilesimsiz oturumda soru sorulamaz.
# -Zorunlu: yoksa durur. Degilse etkilesimli oturumda bos birakilabilir soru sorulur.
function ParolaCoz($duz, $dosya, $etiket, [switch]$Zorunlu) {
  if ($duz -and $dosya) { Dur "$etiket icin hem parola hem dosya verildi - birini sec." }
  if ($dosya) {
    if (-not (Test-Path $dosya)) { Dur "$etiket parola dosyasi yok: $dosya" }
    $p = ([System.IO.File]::ReadAllText((Resolve-Path $dosya).Path)).TrimEnd("`r", "`n")
    if (-not $p) { Dur "$etiket parola dosyasi BOS: $dosya" }
    return $p
  }
  if ($duz) {
    Uyar "$etiket parolasi komut satirinda verildi - PowerShell gecmisine ve surec listesine duser (tercih: soru ya da ...ParolaDosyasi)."
    return $duz
  }
  $soramaz = -not [Environment]::UserInteractive -or [Console]::IsInputRedirected
  if ($soramaz) {
    if ($Zorunlu) { Dur "$etiket parolasi gerekli ve bu oturum soru soramiyor: -...ParolaDosyasi <yol> ver." }
    return $null
  }
  $ss = Read-Host -AsSecureString "  $etiket parolasi$(if (-not $Zorunlu) { ' (bos = yok)' })"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { $p = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if (-not $p) { if ($Zorunlu) { Dur "$etiket parolasi bos." }; return $null }
  return $p
}

# Sir tasiyan yol yalniz SYSTEM (pm2 daemon, zamanlanmis gorevler) + Administrators'a:
# kok C:\'den "Users okur / Authenticated Users degistirir" mirasini alir. SID ile
# (yerellestirilmis grup adi "Yoneticiler" olabilir); dizinde alt ogelere de (/T).
function SirIzniDaralt($yol) {
  if (-not (Test-Path $yol)) { return }
  if (-not (Get-Command icacls.exe -ErrorAction SilentlyContinue)) { Acik "icacls yok - izin DARALTILAMADI: $yol"; return }
  $dizin = (Get-Item $yol -Force).PSIsContainer
  $hak = if ($dizin) { "(OI)(CI)F" } else { "F" }
  $ek = if ($dizin) { @("/T") } else { @() }
  & icacls.exe $yol /inheritance:r /grant:r "*S-1-5-18:$hak" "*S-1-5-32-544:$hak" /remove:g "*S-1-5-32-545" "*S-1-5-11" "*S-1-1-0" @ek | Out-Null
  if ($LASTEXITCODE -ne 0) { Acik "izin daraltilamadi (icacls $LASTEXITCODE): $yol" }
}

# Users / Authenticated Users / Everyone'a izin veren ACE'ler. $null = olculemedi.
function GenisErisim($yol) {
  if (-not (Test-Path $yol) -or -not (Get-Command Get-Acl -ErrorAction SilentlyContinue)) { return $null }
  $genis = @("S-1-5-32-545", "S-1-5-11", "S-1-1-0")
  $bulunan = @()
  foreach ($ace in (Get-Acl $yol).Access) {
    try { $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { continue }
    if ($genis -contains $sid -and "$($ace.AccessControlType)" -eq "Allow") { $bulunan += "$($ace.IdentityReference)" }
  }
  return ,$bulunan
}

# Native komuta, icinde cift tirnak olan TEK arguman. PowerShell 5.1 (ve 7.3 oncesi
# "Legacy" kip) argumani tirnaklarken icerdeki `"`yi KACIRMAZ; psql `"updatedAt"`
# yerine `updatedAt` alir ve kolonu bulamaz. Legacy kipte `"` -> `\"` (onundeki ters
# bolular ikilenir); Standard kipte PowerShell bunu kendisi yapar, dokunulmaz.
function NativeArg([string]$s) {
  $pas = Get-Variable -Name PSNativeCommandArgumentPassing -ValueOnly -ErrorAction SilentlyContinue
  if ($PSVersionTable.PSVersion.Major -ge 7 -and $pas -and $pas -ne "Legacy") { return $s }
  return ($s -replace '(\\*)"', '$1$1\"')
}

# psql'i belirli bir kimlikle kosturur; PGPASSWORD cagri BASINA set/temizlenir
# (surec boyunca acik birakilirsa bu kabuktan calisan her sey onu miras alir).
# ⚠ 5.1'de EAP="Stop" altinda stderr YONLENDIRMESI satiri olumcul yapar ve ilk
#   baglanti denemesinin hatasi BEKLENEN bir hatadir: cagri suresince EAP
#   "Continue", stderr satirlari (ErrorRecord) metne cevrilir (kur.ps1 `Pm2Kos`).
function Psql($kullanici, $parola, $veritabani, $sorgu) {
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $parola
  try {
    $c = & (Join-Path $script:pgsqlBin "psql.exe") -h localhost -p $DbPort -U $kullanici -d $veritabani -v ON_ERROR_STOP=1 -tAc (NativeArg $sorgu) 2>&1
    $kod = $LASTEXITCODE
    $satirlar = @($c | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    })
    return [pscustomobject]@{ kod = $kod; cikti = ($satirlar -join "`n").Trim() }
  } finally {
    $env:PGPASSWORD = ""
    $ErrorActionPreference = $eskiEAP
  }
}

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP - ILK KURULUM (iskelet)"
Write-Host "================================================================"
Write-Host "  Kok       : $Kok"
Write-Host "  Veritabani: $DbAdi @ localhost:$DbPort"
Write-Host "  Rol       : $DbKullanici"

if ($Dump -and -not $DumpAmaci) {
  Dur @"
-Dump verildi ama -DumpAmaci verilmedi. Dokumun kurulum kimligi icin karar ver:
         -DumpAmaci Kopya   test/prova/demo kopyasi: kurulum kimligi YENILENIR,
                            makine disi yedek hedefi (offsite) BOSALTILIR.
         -DumpAmaci Tasima  AYNI fabrika yeni sunucuya tasiniyor: kimlik ve
                            offsite KORUNUR (cihazlar sunucuyu ayni kurulum tanir).
"@
}
if ($DumpAmaci -and -not $Dump) { Uyar "-DumpAmaci verildi ama -Dump yok - kullanilmayacak." }

$DbParola       = ParolaCoz $DbParola $DbParolaDosyasi "DB (uygulama rolu)" -Zorunlu
$PostgresParola = ParolaCoz $PostgresParola $PostgresParolaDosyasi "PostgreSQL yonetici ($PostgresKullanici)"

# --- PostgreSQL araclari ----------------------------------------------------
Adim "PostgreSQL araclari bulunuyor..."
if (-not $PgBin -and (Test-Path (Join-Path "$Kok\pgsql\bin" "pg_dump.exe"))) {
  # Onceki kosumun baglantisi (fabrikada D:\PostgreSQL\16\bin'e JUNCTION) ya da zip'ten
  # yerinde acilmis ikililer: ikinci kosum -PgBin'siz de ayni araci bulur.
  $PgBin = "$Kok\pgsql\bin"
}
if (-not $PgBin) {
  # Program Files altindaki EN YUKSEK surum. `kur.ps1` bunlari $Kok\pgsql\bin
  # altinda arar; asagida oraya baglanacak.
  $adaylar = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
             Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending
  foreach ($a in $adaylar) {
    if (Test-Path (Join-Path $a.FullName "bin\pg_dump.exe")) { $PgBin = Join-Path $a.FullName "bin"; break }
  }
}
if (-not $PgBin -or -not (Test-Path (Join-Path $PgBin "pg_dump.exe"))) {
  Dur "PostgreSQL bulunamadi. Kuruluysa yolu ver: -PgBin `"C:\Program Files\PostgreSQL\16\bin`""
}
$pgSurum = (& (Join-Path $PgBin "pg_dump.exe") --version) -replace '.*\s'
Ok "pg_dump $pgSurum  ($PgBin)"

# --- Klasorler --------------------------------------------------------------
Adim "Klasor iskeleti..."
foreach ($d in @("$Kok", "$Kok\app", "$Kok\backups", "$Kok\logs", "$Kok\pg-setup", "$Kok\pm2-home")) {
  if (Test-Path $d) { Uyar "zaten var: $d" } else { New-Item -ItemType Directory -Path $d -Force | Out-Null; Ok "olusturuldu: $d" }
}

# `kur.ps1` pg araclarini $Kok\pgsql\bin altinda arar. Kopyalamak yerine BAGLANTI:
# PostgreSQL guncellenince baglanti otomatik dogru surumu gosterir, kopya bayatlar.
$pgsqlBin = "$Kok\pgsql\bin"
if (Test-Path $pgsqlBin) {
  Uyar "zaten var: $pgsqlBin"
} else {
  New-Item -ItemType Directory -Path "$Kok\pgsql" -Force | Out-Null
  cmd /c mklink /J "$pgsqlBin" "$PgBin" | Out-Null
  if (-not (Test-Path (Join-Path $pgsqlBin "pg_dump.exe"))) { Dur "Baglanti kurulamadi: $pgsqlBin -> $PgBin" }
  Ok "baglandi: $pgsqlBin -> $PgBin"
}

# --- Veritabani + rol -------------------------------------------------------
# Once BAGLANMAYI dener. Basarirsa hicbir sey yaratmaz - idempotentligin kalbi
# burasi: ikinci kosumda rol de veritabani da zaten vardir.
Adim "Veritabani ve rol..."
$hazir = (Psql $DbKullanici $DbParola $DbAdi "SELECT 1").kod -eq 0

if ($hazir) {
  Ok "'$DbAdi' veritabanina '$DbKullanici' ile baglanildi - olusturmaya gerek yok."
} else {
  if (-not $PostgresParola) {
    Dur @"
'$DbAdi' veritabanina '$DbKullanici' ile baglanilamadi ve olusturamiyorum.
       Olusturmam icin PostgreSQL yonetici parolasi gerekir:
         -PostgresParolaDosyasi <yol>  (ya da etkilesimli oturumda sorulunca gir)
       Veritabani zaten VARSA, dogru rol/parolayi ver (-DbKullanici / -DbParola).
"@
  }

  # Yonetici erisimini ONCE dogrula - yoksa asagidaki her komut ayni hatayi
  # bir daha uretir ve kullanici gercek sebebi 3 satir altinda arar.
  $y = Psql $PostgresKullanici $PostgresParola "postgres" "SELECT 1"
  if ($y.kod -ne 0) { Dur "PostgreSQL'e '$PostgresKullanici' ile baglanilamadi. Parolayi kontrol et.`n       $($y.cikti)" }

  # SQL string literali: tek tirnak ikilenir. Tanimlayicilar cift tirnakli.
  $sqlParola = $DbParola -replace "'", "''"

  $rolVar = (Psql $PostgresKullanici $PostgresParola "postgres" "SELECT 1 FROM pg_roles WHERE rolname='$($DbKullanici -replace "'","''")'").cikti -eq "1"
  if ($rolVar) {
    # Parolayi DEGISTIRMIYORUZ: bu rolu baska bir kurulum kullaniyor olabilir ve
    # sessizce ezmek onu dusururdu. Dogru komutu yazip birakiyoruz.
    Uyar "'$DbKullanici' rolu zaten var - parolasina DOKUNULMADI."
    if ($DbKullanici -ne $PostgresKullanici) {
      Write-Host "      Parola tutmuyorsa (bu kurulumun rolu oldugundan EMINSEN):" -ForegroundColor DarkGray
      Write-Host "      ALTER ROLE `"$DbKullanici`" WITH PASSWORD '<yeni>';" -ForegroundColor DarkGray
    }
  } else {
    $r = Psql $PostgresKullanici $PostgresParola "postgres" "CREATE ROLE `"$DbKullanici`" WITH LOGIN PASSWORD '$sqlParola'"
    if ($r.kod -ne 0) { Dur "Rol olusturulamadi: $($r.cikti)" }
    Ok "rol olusturuldu: $DbKullanici  (superuser DEGIL - uygulama yetkili hesapla kosmaz)"
  }

  $dbVar = (Psql $PostgresKullanici $PostgresParola "postgres" "SELECT 1 FROM pg_database WHERE datname='$($DbAdi -replace "'","''")'").cikti -eq "1"
  if ($dbVar) {
    Uyar "'$DbAdi' veritabani zaten var - DOKUNULMADI (icindeki veri korunur)."
  } else {
    $d = Psql $PostgresKullanici $PostgresParola "postgres" "CREATE DATABASE `"$DbAdi`" OWNER `"$DbKullanici`""
    if ($d.kod -ne 0) { Dur "Veritabani olusturulamadi: $($d.cikti)" }
    Ok "veritabani olusturuldu: $DbAdi  (sahibi: $DbKullanici)"
  }

  $son = Psql $DbKullanici $DbParola $DbAdi "SELECT 1"
  if ($son.kod -ne 0) { Dur "Olusturuldu ama '$DbKullanici' ile BAGLANILAMIYOR:`n       $($son.cikti)" }
  Ok "baglanti dogrulandi"
}

# --- Dump (opsiyonel) -------------------------------------------------------
# ⚠ YALNIZ BOS veritabanina yukler. Dolu bir veritabaninin uzerine restore,
#   yarim birlesmis bir sema birakir ve hangi satirin hangi surumden geldigi
#   bir daha bilinemez - o yuzden kapi FAIL-CLOSED.
Adim "Fabrika yedegi (dump)..."
if (-not $Dump) {
  Uyar "-Dump verilmedi - veritabani oldugu gibi kullaniliyor."
} elseif (-not (Test-Path $Dump)) {
  Dur "Dump bulunamadi: $Dump"
} else {
  $tablo = [int](Psql $DbKullanici $DbParola $DbAdi "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").cikti
  if ($tablo -gt 0) {
    Dur @"
'$DbAdi' BOS DEGIL ($tablo tablo) - dump yuklenmedi.
       Uzerine restore yarim birlesmis sema birakir. Ya bos bir ad ver
       (-DbAdi tekserp_yeni), ya da bu veritabanini elle sil.
"@
  }
  Write-Host "  yukleniyor: $(Split-Path $Dump -Leaf)  ($([math]::Round((Get-Item $Dump).Length/1MB,1)) MB)"
  # --no-owner: nesneler BAGLANAN rolun (yani $DbKullanici'nin) olur. Fabrika
  # dump'i 'postgres' sahipliginde geldigi icin bu SART - yoksa uygulama kendi
  # veritabanindaki tablolari degistiremez.
  $env:PGPASSWORD = $DbParola
  & (Join-Path $pgsqlBin "pg_restore.exe") -h localhost -p $DbPort -U $DbKullanici -d $DbAdi --no-owner --no-privileges $Dump
  $restoreKod = $LASTEXITCODE
  $env:PGPASSWORD = ""
  # pg_restore iyi huylu uyarilarda da 1 doner -> koda degil SONUCA bak.
  $mig = (Psql $DbKullanici $DbParola $DbAdi "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL").cikti
  if (-not $mig -or [int]$mig -eq 0) { Dur "Restore basarisiz gorunuyor - _prisma_migrations okunamadi/bos. (pg_restore kod: $restoreKod)" }
  if ($restoreKod -ne 0) { Uyar "pg_restore uyari verdi (kod $restoreKod) ama sema yuklendi - asagidaki sayilar dogruysa sorun yok." }
  $top = (Psql $DbKullanici $DbParola $DbAdi "SELECT count(*) FROM rolls").cikti
  Ok "yuklendi  |  migration: $mig  |  top: $top"

  if ($DumpAmaci -eq "Tasima") {
    Uyar "-DumpAmaci Tasima: kurulum kimligi ve offsite hedefi dokumdeki gibi KORUNDU."
  } else {
    # Kopya: kimlik ve makine disi yedek hedefi fabrikanin; ikisi de bu makinede YANLIS.
    # Iz SystemLog'a duser (backend'in kendi yenileme olayiyla ayni ad) - cihazlarin
    # "farkli kurulum" sorusunun sebebi kayitsiz kalmasin.
    $eski = (Psql $DbKullanici $DbParola $DbAdi "SELECT value->>'installationId' FROM system_settings WHERE key = 'system.installationId'").cikti
    $yeni = [guid]::NewGuid().ToString()
    $an   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    if ($eski) {
      $k = Psql $DbKullanici $DbParola $DbAdi ("UPDATE system_settings SET value = jsonb_build_object('installationId', '$yeni', 'createdAt', '$an'), ""updatedAt"" = now(), ""updatedById"" = NULL WHERE key = 'system.installationId'")
      if ($k.kod -ne 0) { Dur "Kurulum kimligi yenilenemedi: $($k.cikti)" }
      Ok "kurulum kimligi YENILENDI: $eski -> $yeni"
    } else {
      Ok "dokumde kurulum kimligi yok - backend ilk acilista yenisini uretir"
    }
    # CTE: psql `-t` UPDATE'in komut etiketini ("UPDATE 2") de basar; SELECT basmaz.
    $o = Psql $DbKullanici $DbParola $DbAdi "WITH u AS (UPDATE system_settings SET value = '""""'::jsonb, ""updatedAt"" = now(), ""updatedById"" = NULL WHERE key IN ('backup.offsiteRemote', 'backup.offsiteDir') AND value <> '""""'::jsonb RETURNING key) SELECT key FROM u ORDER BY key"
    if ($o.kod -ne 0) { Dur "Offsite hedefi bosaltilamadi: $($o.cikti)" }
    $bosalan = @($o.cikti -split "`n" | Where-Object { $_ })
    if ($bosalan.Count) { Ok "makine disi yedek hedefi BOSALTILDI: $($bosalan -join ', ')  (panelden yeniden girilir)" }
    else                { Ok "dokumde makine disi yedek hedefi yok" }
    $iz = "{""kaynak"":""ilk-kurulum -DumpAmaci Kopya"",""old"":""$eski"",""new"":""$(if ($eski) { $yeni } else { '' })"",""offsiteBosaltilan"":""$($bosalan -join ',')""}"
    $l = Psql $DbKullanici $DbParola $DbAdi "INSERT INTO system_logs (id, category, action, ""tableName"", ""recordId"", ""newData"", ""createdAt"") VALUES (gen_random_uuid(), 'SYSTEM', 'INSTALLATION_ID_REGENERATED', 'system_settings', 'system.installationId', '$iz'::jsonb, now())"
    if ($l.kod -ne 0) { Uyar "Iz SystemLog'a yazilamadi (kimlik yine de yenilendi): $($l.cikti)" }
  }
}

# --- Veritabani duzeyi ayarlar ------------------------------------------------
# pg_restore bunlari TASIMAZ (ayar veritabaninin OID'sine bagli): dokumden kurulan
# kopya korumasiz acilir ("[audit-guard] KORUMA KAPALI"). Restore'dan SONRA kurulur -
# statement_timeout restore'un index yaratimini keserdi. Var olan FARKLI deger ezilmez.
Adim "Veritabani ayarlari (DB duzeyi)..."
$dbAyarlari = [ordered]@{
  "statement_timeout"                   = "50s"
  "idle_in_transaction_session_timeout" = "5min"
  # HEDEF ayar - fabrikadaki degeri OLCULMEDI (repo notu K6 "sahada KAPALI" diyor).
  "teks.audit_guard"                    = "on"
}
$yonetici = $false
if ($PostgresParola) { $yonetici = (Psql $PostgresKullanici $PostgresParola "postgres" "SELECT 1").kod -eq 0 }
$mevcutAyar = @{}
$r = Psql $DbKullanici $DbParola $DbAdi "SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setrole = 0 AND setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())"
foreach ($satir in @($r.cikti -split "`n" | Where-Object { $_ -match '=' })) {
  $parca = $satir -split '=', 2
  $mevcutAyar[$parca[0]] = $parca[1]
}
$dbAdiSql = $DbAdi -replace '"', '""'
foreach ($ad in $dbAyarlari.Keys) {
  $hedef = $dbAyarlari[$ad]
  if ($mevcutAyar.ContainsKey($ad)) {
    if ($mevcutAyar[$ad] -eq $hedef) { Ok "zaten: $ad = $hedef" }
    else { Acik "$ad = $($mevcutAyar[$ad]) (hedef $hedef) - var olan deger DOKUNULMADI" }
    continue
  }
  $sql = "ALTER DATABASE ""$dbAdiSql"" SET $ad = '$hedef'"
  # Ozel (teks.*) parametreyi PG 16'da yalniz superuser kurar: DB sahibi
  # "permission denied to set parameter" alir (olculdu).
  if ($yonetici) { $a = Psql $PostgresKullanici $PostgresParola "postgres" $sql }
  elseif ($ad -notlike "teks.*") { $a = Psql $DbKullanici $DbParola $DbAdi $sql }
  else { Acik "$ad KURULAMADI - superuser gerekir (-PostgresParola). Elle: $sql"; continue }
  if ($a.kod -eq 0) { Ok "kuruldu: $ad = $hedef" } else { Acik "$ad kurulamadi: $($a.cikti)" }
}

# --- PostgreSQL sunucu ayarlari (runbook §6) -----------------------------------
# Eski installer'in postgresql.conf'a yazdiklari. Sunucu GENELI oldugu icin yalniz
# -PgAyarla ile yazilir (ALTER SYSTEM -> postgresql.auto.conf); onceden ALTER SYSTEM ile
# konmus farkli deger ezilmez. Bellek degerleri RAM'den (installer olcegi).
Adim "PostgreSQL sunucu ayarlari..."
function MbDeger([double]$mb) {
  $mb = [math]::Floor($mb)
  if ($mb % 1024 -eq 0) { return "$([int]($mb / 1024))GB" }
  return "$([int]$mb)MB"
}
$pgHedef = [ordered]@{
  "listen_addresses"                    = "127.0.0.1"
  "timezone"                            = "Europe/Istanbul"
  "log_timezone"                        = "Europe/Istanbul"
  "statement_timeout"                   = "50s"
  "idle_in_transaction_session_timeout" = "5min"
  "log_destination"                     = "stderr"
  "logging_collector"                   = "on"
  "log_directory"                       = "log"
  "log_min_duration_statement"          = "500ms"
  "work_mem"                            = "16MB"
}
$ramMB = $null
try { $ramMB = [math]::Floor((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1MB) } catch { $ramMB = $null }
if ($ramMB) {
  $pgHedef["shared_buffers"]       = MbDeger ([math]::Min([math]::Max($ramMB * 0.25, 128), 8192))
  $pgHedef["effective_cache_size"] = MbDeger ([math]::Max($ramMB * 0.60, 512))
  $pgHedef["maintenance_work_mem"] = MbDeger ([math]::Min([math]::Max($ramMB * 0.05, 64), 512))
} else {
  Acik "RAM olculemedi - shared_buffers / effective_cache_size / maintenance_work_mem hesaplanmadi"
}
$adlar = ($pgHedef.Keys | ForEach-Object { "'$_'" }) -join ","
# pg_settings adi buyuk/kucuk harf tasir ("TimeZone"); karsilastirma kucuk harfle.
$okuSql = "SELECT lower(name) || '|' || current_setting(name) || '|' || pending_restart || '|' || coalesce(sourcefile, '') FROM pg_settings WHERE lower(name) IN ($adlar)"
# Superuser yoksa uygulama DB'sinden okunur: DB duzeyi degerler ve gizli ayarlar karisir,
# rapor YAKLASIKTIR (yazma zaten superuser ister).
$oku = if ($yonetici) { Psql $PostgresKullanici $PostgresParola "postgres" $okuSql } else { Psql $DbKullanici $DbParola $DbAdi $okuSql }
$pgMevcut = @{}
foreach ($satir in @($oku.cikti -split "`n" | Where-Object { $_ -match '\|' })) {
  $parca = $satir -split '\|', 4
  $pgMevcut[$parca[0]] = [pscustomobject]@{ deger = $parca[1]; bekliyor = ($parca[2] -in @("t", "true")); dosya = $parca[3] }
}
# Yazilmis ama yeniden baslatma bekleyen ayar "farkli" sayilmaz: ikinci kosum onu
# yeniden yazmaz, yalniz yeniden baslatmayi hatirlatir.
$bekleyen = @($pgMevcut.Keys | Where-Object { $pgMevcut[$_].bekliyor } | Sort-Object)
$farkli = @($pgHedef.Keys | Where-Object {
  -not $pgMevcut.ContainsKey($_) -or ($pgMevcut[$_].deger -ne $pgHedef[$_] -and -not $pgMevcut[$_].bekliyor)
})
if (-not $farkli.Count) {
  Ok "yazilacak ayar yok ($($pgHedef.Count) ayar hedefte ya da yeniden baslatma bekliyor)"
} elseif (-not $PgAyarla) {
  foreach ($ad in $farkli) {
    $not = if ($pgMevcut[$ad] -and $pgMevcut[$ad].dosya -like "*postgresql.auto.conf") { "  [onceden ALTER SYSTEM - -PgAyarla da dokunmaz]" } else { "" }
    Write-Host "    $ad = $($pgMevcut[$ad].deger)  (hedef $($pgHedef[$ad]))$not"
  }
  if (-not $yonetici) { Write-Host "    (superuser olmadan okundu - yaklasik)" }
  Acik "$($farkli.Count) PostgreSQL sunucu ayari hedeften farkli - YAZILMADI. Uygulamak icin -PgAyarla -PostgresParola <...> ile yeniden kos."
} elseif (-not $yonetici) {
  Acik "-PgAyarla superuser ister (-PostgresParola) - sunucu ayarlari YAZILMADI."
} else {
  $yazilan = 0
  foreach ($ad in $farkli) {
    $m = $pgMevcut[$ad]
    if ($m -and $m.dosya -like "*postgresql.auto.conf") {
      Acik "$ad = $($m.deger) onceden ALTER SYSTEM ile konmus (hedef $($pgHedef[$ad])) - DOKUNULMADI"
      continue
    }
    $a = Psql $PostgresKullanici $PostgresParola "postgres" "ALTER SYSTEM SET $ad = '$($pgHedef[$ad])'"
    if ($a.kod -eq 0) { $yazilan++; Ok "yazildi: $ad = $($pgHedef[$ad])  (onceki $($m.deger))" } else { Acik "$ad yazilamadi: $($a.cikti)" }
  }
  [void](Psql $PostgresKullanici $PostgresParola "postgres" "SELECT pg_reload_conf()")
  $bekleyen = @((Psql $PostgresKullanici $PostgresParola "postgres" "SELECT lower(name) FROM pg_settings WHERE pending_restart ORDER BY 1").cikti -split "`n" | Where-Object { $_ })
}
if ($bekleyen.Count) {
  $servis = @()
  if (Get-Command Get-Service -ErrorAction SilentlyContinue) {
    $servis = @(Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Running" })
  }
  if ($PgYenidenBaslat -and $servis.Count -eq 1) {
    Restart-Service -Name $servis[0].Name -Force
    Ok "PostgreSQL servisi yeniden baslatildi ($($servis[0].Name)) - etkin: $($bekleyen -join ', ')"
  } else {
    $servisAd = if ($servis.Count -eq 1) { $servis[0].Name } else { "<postgresql servisi>" }
    Acik "PostgreSQL yeniden baslatilinca etkin: $($bekleyen -join ', ')  ->  Restart-Service $servisAd  (ya da -PgYenidenBaslat)"
  }
} elseif ($PgAyarla -and $yonetici -and $yazilan) {
  Ok "ayarlar yeniden yuklendi (yeniden baslatma gerekmiyor)"
}

# --- db-credentials.json ---------------------------------------------------
# `kur.ps1` [3/9] bunu okur ve migration ONCESI guvenlik yedegini alir. Dosya
# yoksa yedek ADIMI DUSER ve kurulum iptal olur - yani bu dosya opsiyonel degil.
# Alan adlari `user`/`pass`; fabrikadaki eski dosya `superuser`/`superpass`
# tasir ve kur.ps1 ikisini de okur (eski dosya bozulmadan calismaya devam eder).
Adim "db-credentials.json..."
$credFile = "$Kok\pg-setup\db-credentials.json"
if (Test-Path $credFile) {
  Uyar "zaten var, DOKUNULMADI: $credFile"
} else {
  @{ db = $DbAdi; port = $DbPort; user = $DbKullanici; pass = $DbParola } |
    ConvertTo-Json | Set-Content $credFile -Encoding UTF8
  Ok "yazildi: $credFile"
}

# --- .env -------------------------------------------------------------------
# ⚠ SIR DOSYASI. Varsa ASLA ezilmez.
Adim "app\.env..."
$envDosya = "$Kok\app\.env"
if (Test-Path $envDosya) {
  Uyar "zaten var, DOKUNULMADI (sir dosyasi): $envDosya"
} else {
  # JWT_SECRET makinede uretilir - ornek kopyalanmaz. Zayif/paylasilan bir sir,
  # oturum imzasini tahmin edilebilir kilar.
  $bayt = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bayt)
  $gizli = [Convert]::ToBase64String($bayt) -replace '[+/=]', ''
  # DATABASE_URL bir URI'dir: parola/kullanici URL-kodlanir. Ham yazilirsa
  # icindeki @ : / ? # karakterleri adresi sessizce baska bir yere isaret ettirir.
  $uKod = [uri]::EscapeDataString($DbKullanici)
  $pKod = [uri]::EscapeDataString($DbParola)
  $satirlar = @(
    "DATABASE_URL=`"postgresql://${uKod}:${pKod}@localhost:${DbPort}/${DbAdi}?schema=public`""
    "JWT_SECRET=`"$gizli`""
    "PORT=4000"
  )
  # Paket web panelini (`app\dist-web`) tasir; degisken yoksa backend onu sunmaz ve
  # kok (/) durum sayfasi olur. Mutlak yol: express.static goreliyi pm2 cwd'sine gore cozer.
  if (-not $WebPanelKapali) { $satirlar += "WEB_DIST_DIR=`"$(($Kok -replace '\\', '/').TrimEnd('/'))/app/dist-web`"" }
  $satirlar | Set-Content $envDosya -Encoding UTF8
  Ok "olusturuldu: $envDosya  (JWT_SECRET bu makinede uretildi$(if (-not $WebPanelKapali) { '; web paneli: WEB_DIST_DIR' }))"
}
if ((Test-Path $envDosya) -and -not $WebPanelKapali -and -not (Select-String -Path $envDosya -Pattern '^\s*WEB_DIST_DIR\s*=' -Quiet)) {
  Uyar "mevcut .env'de WEB_DIST_DIR yok - paketteki web paneli SUNULMUYOR (bilincliyse yok say)."
  Uyar "  acmak icin .env'e ekle:  WEB_DIST_DIR=`"$(($Kok -replace '\\', '/').TrimEnd('/'))/app/dist-web`"  (sonra pm2 restart)"
}

# --- Sir dosyalarinin izinleri -------------------------------------------------
# .env (DB parolasi + JWT_SECRET), db-credentials.json, gece yedekleri (fabrikanin TUM
# verisi) ve rclone.conf (Drive jetonu) - hepsi kokun genis mirasini aliyordu.
# Idempotent: her kosumda daraltilir ve OLCULUR (izin daraltilamadiysa acik kalir).
Adim "Sir dosyalarinin izinleri (yalniz SYSTEM + Administrators)..."
$sirYollari = @("$Kok\app\.env", "$Kok\pg-setup", "$Kok\backups", "$Kok\rclone.conf")
foreach ($y in $sirYollari) {
  if (-not (Test-Path $y)) { continue }
  SirIzniDaralt $y
  $kontrol = @($y)
  if ((Get-Item $y -Force).PSIsContainer) { $kontrol += @(Get-ChildItem $y -Recurse -Force | ForEach-Object { $_.FullName }) }
  $olculemedi = $false; $kalan = @()
  foreach ($k in $kontrol) {
    $g = GenisErisim $k
    if ($null -eq $g) { $olculemedi = $true; break }
    if ($g.Count) { $kalan += "$(Split-Path $k -Leaf): $($g -join ', ')" }
  }
  if ($olculemedi)   { Acik "izin OLCULEMEDI (Get-Acl yok): $y" }
  elseif ($kalan.Count) { Acik "hala genis erisim var: $($kalan -join ' | ')" }
  else               { Ok "yalniz SYSTEM + Administrators: $y" }
}

# --- pm2 --------------------------------------------------------------------
Adim "pm2..."
$pm2 = "$Kok\pm2\node_modules\.bin\pm2.cmd"
if (Test-Path $pm2) {
  Uyar "zaten var: $pm2"
} else {
  # `npm.cmd`, `npm` DEGIL: PowerShell `npm`i once `npm.ps1`e cozer ve o bir
  # SCRIPT'tir - yurutme ilkesi Restricted ise bu satir kosmaz. `.cmd` ilkeye tabi degil.
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Dur "npm.cmd bulunamadi - once Node.js 22 kur." }
  New-Item -ItemType Directory -Path "$Kok\pm2" -Force | Out-Null
  Push-Location "$Kok\pm2"
  # Global degil YEREL kurulum: `kur.ps1` pm2'yi bu tam yoldan cagirir ve
  # global PATH'e (ve baska bir hesabin global klasorune) bagimli olmaz.
  & npm.cmd init -y --silent | Out-Null
  & npm.cmd install pm2 --no-audit --no-fund --silent
  Pop-Location
  if (-not (Test-Path $pm2)) { Dur "pm2 kurulamadi: $pm2" }
  Ok "kuruldu: $pm2"
}

# --- Zamanlanmis gorevler: acilis + gece yedegi ---------------------------------
# Hicbir betik bunlari kurmuyordu ve paketteki ecosystem BACKUP_SCHEDULE_ENABLED=false:
# sifirdan kurulumda reboot'ta backend kalkmiyor, gece yedegi HIC alinmiyordu. Tarif
# fabrikadaki gorevlerden (runbook): ikisi de SYSTEM. Var olan gorev/dosya ezilmez.
Adim "Zamanlanmis gorevler (TeksERP-Backend-Boot, TeksERP-DB-Backup)..."
foreach ($dosya in @("pm2-boot.cmd", "yedekle.ps1")) {
  $hedef = Join-Path $Kok $dosya
  $kaynak = Join-Path $PSScriptRoot $dosya
  if (Test-Path $hedef) { Uyar "zaten var, DOKUNULMADI: $hedef" }
  elseif (Test-Path $kaynak) { Copy-Item $kaynak $hedef; Ok "kondu: $hedef" }
  else { Acik "$dosya bu betigin yaninda yok ($PSScriptRoot) - paketi ya da repodaki deploy\ klasorunu kullan" }
}
if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
  Acik "Gorev Zamanlayici cmdlet'leri yok - TeksERP-Backend-Boot ve TeksERP-DB-Backup KURULAMADI"
} else {
  $sistem = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $gorevler = @(
    @{ ad = "TeksERP-Backend-Boot"; dosya = "$Kok\pm2-boot.cmd"
       eylem = { New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$Kok\pm2-boot.cmd`"" }
       tetik = { New-ScheduledTaskTrigger -AtStartup }
       sure = (New-TimeSpan -Minutes 30)
       tanim = "TeksERP: acilista pm2 resurrect (backend) - ilk-kurulum.ps1" },
    @{ ad = "TeksERP-DB-Backup"; dosya = "$Kok\yedekle.ps1"
       eylem = {
         $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$Kok\yedekle.ps1`""
         if ($YedekIkinciHedef) { $arg += " -IkinciHedef `"$YedekIkinciHedef`"" }
         New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg }
       tetik = { New-ScheduledTaskTrigger -Daily -At $YedekSaati }
       sure = (New-TimeSpan -Hours 2)
       tanim = "TeksERP: gece yedegi (pg_dump + dogrulama + 30 gun) - ilk-kurulum.ps1" }
  )
  foreach ($g in $gorevler) {
    $var = Get-ScheduledTask -TaskName $g.ad -ErrorAction SilentlyContinue
    if ($var) {
      $e = @($var.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join " ; "
      Uyar "gorev zaten var, DOKUNULMADI: $($g.ad)  ($e)"
      continue
    }
    if (-not (Test-Path $g.dosya)) { Acik "gorev kurulmadi: $($g.ad) - $($g.dosya) yok"; continue }
    # StartWhenAvailable: kacan calisma (makine o saatte kapaliydi) acilinca telafi edilir.
    $ayar = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit $g.sure
    Register-ScheduledTask -TaskName $g.ad -Action (& $g.eylem) -Trigger (& $g.tetik) -Principal $sistem -Settings $ayar -Description $g.tanim | Out-Null
    Ok "gorev kuruldu: $($g.ad)"
  }
  Write-Host "    Dogrula: Get-ScheduledTask TeksERP-* | Get-ScheduledTaskInfo  (NextRunTime dolu olmali)"
  Write-Host "    Gece yedegini simdi dene: Start-ScheduledTask TeksERP-DB-Backup ; sonra $Kok\backups\backup.log"
}

# --- Guvenlik duvari: API portu --------------------------------------------------
# Tabletler ve paneller 4000'e baglanir; kural eskiden elle aciliyordu. Yalniz Domain +
# Private profil ve yerel alt ag: Public (kafe/otel Wi-Fi) profilinde API KAPALI kalir.
# ⚠ Tailscale kurulu makinede "Tailscale-In" kurali Private profilde HER portu acabilir
#   (thinkpad-1 provasi): Wi-Fi Private'a alinirsa 4000 - ve her sey - o aga acilir.
#   Ucuncu tarafin kuralina dokunulmaz; yalniz OLCULUR ve soylenir.
Adim "Guvenlik duvari (API $ApiPort)..."
if (-not (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue)) {
  Acik "NetSecurity cmdlet'leri yok - API $ApiPort kurali KURULAMADI/OLCULEMEDI"
} else {
  $kuralAd = "TeksERP API $ApiPort"
  $kural = Get-NetFirewallRule -DisplayName $kuralAd -ErrorAction SilentlyContinue
  if ($kural) {
    $adres = @(($kural | Get-NetFirewallAddressFilter).RemoteAddress)
    $profil = "$($kural.Profile)"
    Uyar "kural zaten var, DOKUNULMADI: $kuralAd  (profil: $profil, uzak adres: $($adres -join ', '))"
    if ($profil -match 'Any|Public' -or $adres -contains "Any") {
      Acik "$kuralAd Public profilde ya da her adrese acik - daraltmak icin: Set-NetFirewallRule -DisplayName '$kuralAd' -Profile $($ApiAgProfili -join ',') -RemoteAddress $($ApiIzinliAdres -join ',')"
    }
  } else {
    New-NetFirewallRule -DisplayName $kuralAd -Direction Inbound -Protocol TCP -LocalPort $ApiPort -Action Allow `
      -Profile $ApiAgProfili -RemoteAddress $ApiIzinliAdres | Out-Null
    Ok "kural kuruldu: $kuralAd  (profil: $($ApiAgProfili -join ', '), uzak adres: $($ApiIzinliAdres -join ', '))"
  }
  $ts = @(Get-NetFirewallRule -DisplayName "Tailscale-In" -ErrorAction SilentlyContinue | Where-Object { "$($_.Enabled)" -eq "True" })
  foreach ($r in $ts) {
    $arayuz = @(($r | Get-NetFirewallInterfaceFilter).InterfaceAlias)
    $port = @(($r | Get-NetFirewallPortFilter).LocalPort)
    if ("$($r.Profile)" -match 'Any|Private' -and ($arayuz -contains "Any" -or -not $arayuz.Count) -and ($port -contains "Any")) {
      $ozel = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { "$($_.NetworkCategory)" -eq "Private" } | ForEach-Object { $_.InterfaceAlias })
      Acik ("Tailscale-In kurali Private profilde HER porta acik (arayuz sinirsiz). Private aglar: " +
            "$(if ($ozel.Count) { $ozel -join ', ' } else { '(yok)' }) - Wi-Fi'yi Public tut ya da kurali Tailscale arayuzuyle sinirla (DEPLOY-RUNBOOK 2.2).")
    }
  }
}

# --- Son dogrulama ----------------------------------------------------------
Adim "Dogrulama..."
$mig = (Psql $DbKullanici $DbParola $DbAdi "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL").cikti
if ($mig) { Ok "baglanti OK  |  uygulanmis migration: $mig" }
else      { Ok "baglanti OK  |  veritabani BOS (migration'lari kur.ps1 uygulayacak)" }

if ($script:acik.Count) {
  Write-Host ""
  Write-Host "  YAPILMADAN KALANLAR ($($script:acik.Count)) - yukarida ayrintisi var:" -ForegroundColor Yellow
  foreach ($x in $script:acik) { Write-Host "    - $x" -ForegroundColor Yellow }
}

Write-Host ""
if ($script:acik.Count) {
  Write-Host "================================================================" -ForegroundColor Yellow
  Write-Host "  ISKELET HAZIR - AMA $($script:acik.Count) IS YAPILMADAN KALDI (yukaridaki liste)" -ForegroundColor Yellow
} else {
  Write-Host "================================================================" -ForegroundColor Green
  Write-Host "  ISKELET HAZIR" -ForegroundColor Green
}
Write-Host "================================================================"
Write-Host "  Sonraki adim - surumu kur:"
Write-Host "      powershell -NoProfile -ExecutionPolicy Bypass -File .\kur.ps1 -Kok `"$Kok`" -Paket <tekserp-backend-....zip>"
Write-Host ""
Write-Host "  Sonra - satici (superadmin) hesabi:"
Write-Host "      cd $Kok\app ; node dist\tools\superadmin-olustur.cjs    (GERCEK terminal sart)"
Write-Host ""
