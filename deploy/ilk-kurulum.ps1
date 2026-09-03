# =============================================================================
# TeksERP Backend - ILK KURULUM (sifirdan iskelet)
# =============================================================================
# NEREDE CALISIR: YENI SUNUCUDA, YONETICI PowerShell'de.
#   .\ilk-kurulum.ps1 -DbAdi tekserp -DbParola <postgres-parolasi>
#   .\ilk-kurulum.ps1 -DbAdi tekserp -DbParola <p> -PgBin "C:\Program Files\PostgreSQL\16\bin"
#
# NE YAPAR: `kur.ps1`in BEKLEDIGI iskeleti kurar. Kendisi surum KURMAZ - islemi
#   bitince size `kur.ps1` komutunu yazar.
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
#   klasorler varsa gecilir. Iki kez kosmak guvenlidir.
#
# ⚠ BU SCRIPT VERITABANI OLUSTURMAZ ve DUMP YUKLEMEZ. Ikisi de veri islemidir
#   ve karar ister (hangi dump? uzerine mi yazilacak?). Script yalnizca
#   BAGLANABILDIGINI dogrular ve yoksa komutu yazar.
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$DbAdi,
  [Parameter(Mandatory = $true)][string]$DbParola,
  [string]$DbKullanici = "postgres",
  [int]$DbPort = 5432,
  [string]$PgBin,
  [string]$Kok = "C:\Etkili-Yazilim"
)
$ErrorActionPreference = "Stop"

function Adim($m) { Write-Host ""; Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  + $m" -ForegroundColor Green }
function Uyar($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Dur($m)  { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; Write-Host ""; exit 1 }

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP - ILK KURULUM (iskelet)"
Write-Host "================================================================"
Write-Host "  Kok      : $Kok"
Write-Host "  Veritabani: $DbAdi @ localhost:$DbPort ($DbKullanici)"

# --- [1/6] PostgreSQL araclari ----------------------------------------------
Adim "[1/6] PostgreSQL araclari bulunuyor..."
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

# --- [2/6] Klasorler ---------------------------------------------------------
Adim "[2/6] Klasor iskeleti..."
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

# --- [3/6] db-credentials.json ----------------------------------------------
# `kur.ps1` [3/9] bunu okur ve migration ONCESI guvenlik yedegini alir. Dosya
# yoksa yedek ADIMI DUSER ve kurulum iptal olur - yani bu dosya opsiyonel degil.
Adim "[3/6] db-credentials.json..."
$credFile = "$Kok\pg-setup\db-credentials.json"
if (Test-Path $credFile) {
  Uyar "zaten var, DOKUNULMADI: $credFile"
} else {
  @{ db = $DbAdi; port = $DbPort; superuser = $DbKullanici; superpass = $DbParola } |
    ConvertTo-Json | Set-Content $credFile -Encoding UTF8
  Ok "yazildi: $credFile"
}

# --- [4/6] .env --------------------------------------------------------------
# ⚠ SIR DOSYASI. Varsa ASLA ezilmez.
Adim "[4/6] app\.env..."
$envDosya = "$Kok\app\.env"
if (Test-Path $envDosya) {
  Uyar "zaten var, DOKUNULMADI (sir dosyasi): $envDosya"
} else {
  # JWT_SECRET makinede uretilir - ornek kopyalanmaz. Zayif/paylasilan bir sir,
  # oturum imzasini tahmin edilebilir kilar.
  $gizli = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 })) -replace '[+/=]', ''
  @(
    "DATABASE_URL=`"postgresql://${DbKullanici}:${DbParola}@localhost:${DbPort}/${DbAdi}?schema=public`""
    "JWT_SECRET=`"$gizli`""
    "PORT=4000"
  ) | Set-Content $envDosya -Encoding UTF8
  Ok "olusturuldu: $envDosya  (JWT_SECRET bu makinede uretildi)"
}

# --- [5/6] pm2 ---------------------------------------------------------------
Adim "[5/6] pm2..."
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

# --- [6/6] Veritabani erisimi -----------------------------------------------
# Olusturmuyoruz (veri islemi, karar ister) - yalnizca BAGLANABILIYOR MUYUZ.
Adim "[6/6] Veritabani erisimi dogrulaniyor..."
$env:PGPASSWORD = $DbParola
$sonuc = & (Join-Path $pgsqlBin "psql.exe") -h localhost -p $DbPort -U $DbKullanici -d $DbAdi -tAc "SELECT 1" 2>&1
$erisim = ($LASTEXITCODE -eq 0)
$env:PGPASSWORD = ""
if ($erisim) {
  $env:PGPASSWORD = $DbParola
  $mig = & (Join-Path $pgsqlBin "psql.exe") -h localhost -p $DbPort -U $DbKullanici -d $DbAdi -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>$null
  $env:PGPASSWORD = ""
  Ok "baglanti OK  |  uygulanmis migration: $(($mig | Out-String).Trim())"
} else {
  Uyar "'$DbAdi' veritabanina BAGLANILAMADI. Once olustur (ve gerekiyorsa dump yukle):"
  Write-Host "      & `"$pgsqlBin\createdb.exe`" -h localhost -p $DbPort -U $DbKullanici $DbAdi"
  Write-Host "      & `"$pgsqlBin\pg_restore.exe`" -h localhost -p $DbPort -U $DbKullanici -d $DbAdi --no-owner <dump>"
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  ISKELET HAZIR" -ForegroundColor Green
Write-Host "================================================================"
Write-Host "  Sonraki adim - surumu kur:"
Write-Host "      $Kok\kur.ps1 -Paket <tekserp-backend-....zip>"
Write-Host ""
Write-Host "  Not: kur.ps1 `"$Kok\app`" icinde MEVCUT kurulum arar. Bu ilk"
Write-Host "       kurulumda app\ yalnizca .env tasir; paket uzerine acilir."
Write-Host ""
