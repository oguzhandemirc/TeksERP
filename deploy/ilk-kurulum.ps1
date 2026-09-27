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
#   # Sifirdan (veritabani da yok):
#   ... -File .\ilk-kurulum.ps1 -DbParola <app-parolasi> -PostgresParola <postgres-parolasi> -PgAyarla
#   (-PgAyarla: PostgreSQL sunucu ayarlarini da yazar - YENI sunucuda; bayraksiz yalniz raporlar)
#
#   # Fabrika yedegini de yukle (tek komut) - dokumun AMACI ZORUNLU (asagida):
#   ... -File .\ilk-kurulum.ps1 -DbParola <p> -PostgresParola <pp> -Dump "C:\yol\son.dump" -DumpAmaci Kopya
#
#   # Veritabani ZATEN varsa (elle olusturulmus): -PostgresParola gerekmez.
#   ... -File .\ilk-kurulum.ps1 -DbAdi tekserp_yeni -DbParola <p> -DbKullanici postgres
#
# NE YAPAR: `kur.ps1`in BEKLEDIGI iskeleti kurar - klasorler, pg baglantisi,
#   veritabani + rol, db-credentials.json, .env, pm2. Kendisi SURUM KURMAZ;
#   islemi bitince size `kur.ps1` komutunu yazar.
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
#   unutulurdu. Parola komut satirindan gelir.
# =============================================================================
param(
  [string]$DbAdi = "tekserp",
  [Parameter(Mandatory = $true)][string]$DbParola,   # uygulamanin baglanti parolasi
  [string]$DbKullanici = "tekserp",                  # uygulamanin DB rolu
  [string]$PostgresParola,                           # YALNIZ rol/DB yaratmak icin
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
  [switch]$PgYenidenBaslat
)
$ErrorActionPreference = "Stop"

# Adimlar kendiliginden numaralanir; adim eklenince yalniz toplam degisir.
$script:adimNo = 0
$script:adimToplam = 10
function Adim($m) { $script:adimNo++; Write-Host ""; Write-Host "[$($script:adimNo)/$($script:adimToplam)] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  + $m" -ForegroundColor Green }
function Uyar($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Dur($m)  { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; Write-Host ""; exit 1 }
# Kurulumu durdurmayan ama YAPILMADAN kalan is: sonda tek listede tekrar basilir.
$script:acik = @()
function Acik($m) { Uyar $m; $script:acik += $m }

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

# --- PostgreSQL araclari ----------------------------------------------------
Adim "PostgreSQL araclari bulunuyor..."
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
       Olusturmam icin PostgreSQL yonetici parolasini ver:
         -PostgresParola <postgres-parolasi>
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
  foreach ($ad in $farkli) { Write-Host "    $ad = $($pgMevcut[$ad].deger)  (hedef $($pgHedef[$ad]))" }
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
  $gizli = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 })) -replace '[+/=]', ''
  # DATABASE_URL bir URI'dir: parola/kullanici URL-kodlanir. Ham yazilirsa
  # icindeki @ : / ? # karakterleri adresi sessizce baska bir yere isaret ettirir.
  $uKod = [uri]::EscapeDataString($DbKullanici)
  $pKod = [uri]::EscapeDataString($DbParola)
  @(
    "DATABASE_URL=`"postgresql://${uKod}:${pKod}@localhost:${DbPort}/${DbAdi}?schema=public`""
    "JWT_SECRET=`"$gizli`""
    "PORT=4000"
  ) | Set-Content $envDosya -Encoding UTF8
  Ok "olusturuldu: $envDosya  (JWT_SECRET bu makinede uretildi)"
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
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  ISKELET HAZIR" -ForegroundColor Green
Write-Host "================================================================"
Write-Host "  Sonraki adim - surumu kur:"
Write-Host "      powershell -NoProfile -ExecutionPolicy Bypass -File .\kur.ps1 -Kok `"$Kok`" -Paket <tekserp-backend-....zip>"
Write-Host ""
Write-Host "  Sonra - satici (superadmin) hesabi:"
Write-Host "      cd $Kok\app ; node dist\tools\superadmin-olustur.cjs    (GERCEK terminal sart)"
Write-Host ""
