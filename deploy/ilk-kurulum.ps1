# =============================================================================
# TeksERP Backend - ILK KURULUM (sifirdan iskelet)
# =============================================================================
# NEREDE CALISIR: YENI SUNUCUDA, YONETICI PowerShell'de.
#
#   # Sifirdan (veritabani da yok):
#   .\ilk-kurulum.ps1 -DbParola <app-parolasi> -PostgresParola <postgres-parolasi>
#
#   # Fabrika yedegini de yukle (tek komut):
#   .\ilk-kurulum.ps1 -DbParola <p> -PostgresParola <pp> -Dump "C:\yol\son.dump"
#
#   # Veritabani ZATEN varsa (elle olusturulmus): -PostgresParola gerekmez.
#   .\ilk-kurulum.ps1 -DbAdi tekserp_yeni -DbParola <p> -DbKullanici postgres
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
  [int]$DbPort = 5432,
  [string]$PgBin,
  [string]$Kok = "C:\TeksERP"
)
$ErrorActionPreference = "Stop"

function Adim($m) { Write-Host ""; Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  + $m" -ForegroundColor Green }
function Uyar($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Dur($m)  { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; Write-Host ""; exit 1 }

# psql'i belirli bir kimlikle kosturur; PGPASSWORD cagri BASINA set/temizlenir
# (surec boyunca acik birakilirsa bu kabuktan calisan her sey onu miras alir).
function Psql($kullanici, $parola, $veritabani, $sorgu) {
  $env:PGPASSWORD = $parola
  try   { $c = & (Join-Path $script:pgsqlBin "psql.exe") -h localhost -p $DbPort -U $kullanici -d $veritabani -v ON_ERROR_STOP=1 -tAc $sorgu 2>&1
          return [pscustomobject]@{ kod = $LASTEXITCODE; cikti = ($c | Out-String).Trim() } }
  finally { $env:PGPASSWORD = "" }
}

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP - ILK KURULUM (iskelet)"
Write-Host "================================================================"
Write-Host "  Kok       : $Kok"
Write-Host "  Veritabani: $DbAdi @ localhost:$DbPort"
Write-Host "  Rol       : $DbKullanici"

# --- [1/8] PostgreSQL araclari ----------------------------------------------
Adim "[1/8] PostgreSQL araclari bulunuyor..."
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

# --- [2/8] Klasorler ---------------------------------------------------------
Adim "[2/8] Klasor iskeleti..."
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

# --- [3/8] Veritabani + rol --------------------------------------------------
# Once BAGLANMAYI dener. Basarirsa hicbir sey yaratmaz - idempotentligin kalbi
# burasi: ikinci kosumda rol de veritabani da zaten vardir.
Adim "[3/8] Veritabani ve rol..."
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

# --- [4/8] Dump (opsiyonel) --------------------------------------------------
# ⚠ YALNIZ BOS veritabanina yukler. Dolu bir veritabaninin uzerine restore,
#   yarim birlesmis bir sema birakir ve hangi satirin hangi surumden geldigi
#   bir daha bilinemez - o yuzden kapi FAIL-CLOSED.
Adim "[4/8] Fabrika yedegi (dump)..."
if (-not $Dump) {
  Uyar "-Dump verilmedi, atlaniyor (bos veritabani ile devam)."
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
}

# --- [5/8] db-credentials.json ----------------------------------------------
# `kur.ps1` [3/9] bunu okur ve migration ONCESI guvenlik yedegini alir. Dosya
# yoksa yedek ADIMI DUSER ve kurulum iptal olur - yani bu dosya opsiyonel degil.
# Alan adlari `user`/`pass`; fabrikadaki eski dosya `superuser`/`superpass`
# tasir ve kur.ps1 ikisini de okur (eski dosya bozulmadan calismaya devam eder).
Adim "[5/8] db-credentials.json..."
$credFile = "$Kok\pg-setup\db-credentials.json"
if (Test-Path $credFile) {
  Uyar "zaten var, DOKUNULMADI: $credFile"
} else {
  @{ db = $DbAdi; port = $DbPort; user = $DbKullanici; pass = $DbParola } |
    ConvertTo-Json | Set-Content $credFile -Encoding UTF8
  Ok "yazildi: $credFile"
}

# --- [6/8] .env --------------------------------------------------------------
# ⚠ SIR DOSYASI. Varsa ASLA ezilmez.
Adim "[6/8] app\.env..."
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

# --- [7/8] pm2 ---------------------------------------------------------------
Adim "[7/8] pm2..."
$pm2 = "$Kok\pm2\node_modules\.bin\pm2.cmd"
if (Test-Path $pm2) {
  Uyar "zaten var: $pm2"
} else {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Dur "npm bulunamadi - once Node.js 22 kur." }
  New-Item -ItemType Directory -Path "$Kok\pm2" -Force | Out-Null
  Push-Location "$Kok\pm2"
  # Global degil YEREL kurulum: `kur.ps1` pm2'yi bu tam yoldan cagirir ve
  # global PATH'e (ve baska bir hesabin global klasorune) bagimli olmaz.
  & npm init -y --silent | Out-Null
  & npm install pm2 --no-audit --no-fund --silent
  Pop-Location
  if (-not (Test-Path $pm2)) { Dur "pm2 kurulamadi: $pm2" }
  Ok "kuruldu: $pm2"
}

# --- [8/8] Son dogrulama -----------------------------------------------------
Adim "[8/8] Dogrulama..."
$mig = (Psql $DbKullanici $DbParola $DbAdi "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL").cikti
if ($mig) { Ok "baglanti OK  |  uygulanmis migration: $mig" }
else      { Ok "baglanti OK  |  veritabani BOS (migration'lari kur.ps1 uygulayacak)" }

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  ISKELET HAZIR" -ForegroundColor Green
Write-Host "================================================================"
Write-Host "  Sonraki adim - surumu kur:"
Write-Host "      .\kur.ps1 -Kok `"$Kok`" -Paket <tekserp-backend-....zip>"
Write-Host ""
Write-Host "  Sonra - satici (superadmin) hesabi:"
Write-Host "      cd $Kok\app ; npm run superadmin:kur    (GERCEK terminal sart)"
Write-Host ""
