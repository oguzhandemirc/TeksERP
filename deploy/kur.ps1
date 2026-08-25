# =============================================================================
# TeksERP Backend - SURUM KURULUMU (paket tabanli)
# =============================================================================
# NEREDE CALISIR: SUNUCUDA, YONETICI PowerShell'de.
#   C:\Etkili-Yazilim\kur.ps1 -Paket D:\tekserp-backend-20260801_120000-abc1234.zip
#   C:\Etkili-Yazilim\kur.ps1 -GeriAl          # son kuruluma geri don
#
# NEDEN guncelle.ps1'IN YERINI ALDI:
#   CALISAN kurulum (app\) bir git klonu DEGIL, hazir pakettir; "pull et + derle"
#   orada yapilamaz. Paket sunucudaki BUILD klonundan uretilir
#   (D:\tekserp-build\tekserp - tam klon, dalin ucu; klon kokunde
#   .\deploy\paketle.ps1 -Cikti C:\Etkili-Yazilim). C:\Etkili-Yazilim\tekserp
#   klonu sparse + dar refspec'tir, adnansahin dalini gormez - paket icin KULLANMA
#   (bkz. deploy/README.md). Calisan kod hicbir zaman klondan kosmaz.
#
# BU DOSYANIN REPODAKI KOPYASI: <repo>/deploy/kur.ps1 - kaynak orasidir. Script
#   KENDINI GUNCELLEYEMEZ (paket app\ altina iner, bu dosya bir ust dizindedir):
#   repodaki surum degisince C:\Etkili-Yazilim\kur.ps1 uzerine ELLE kopyalanir.
#
# GERI DONUS MODELI (load-bearing):
#   Calisan kurulum SILINMEZ, `app.eski-<damga>` olarak YENIDEN ADLANDIRILIR.
#   Migration'dan ONCEKI her hata -> OTOMATIK geri alinir.
#   Migration'dan SONRAKI hata    -> otomatik geri ALINMAZ (DB degisti); script
#                                    komutlari yazar, karari insan verir.
#   Geri alma YALNIZ app.eski-<damga> gercekten olusmussa dokunur. Olusmamissa
#   (app\ tasinamadi - acik dosya kilidi) HICBIR SEY SILINMEZ, mevcut kurulum
#   yeniden baslatilir. (2026-08-24: eski kod bu durumda calisan kurulumu
#   yedeksiz siliyordu - "sil" hedefe, "geri koy" kaynaga bakiyordu.)
#
# MIGRATION ESIGI:
#   `prisma migrate deploy` GERI ALINAMAZ (Prisma down-migration uretmez).
#   O yuzden ondan once: dogrulanmis yedek + paket dogrulamasi + .env kontrolu.
# =============================================================================
[CmdletBinding()]
param(
  [string]$Paket,
  [switch]$GeriAl,
  [switch]$Zorla
)
$ErrorActionPreference = "Stop"

$kok       = "C:\Etkili-Yazilim"
$appDir    = "$kok\app"
$eskiKlon  = "$kok\tekserp\Teks-Erp"      # ilk gecis: git klonundan gelen kurulum
$pm2       = "$kok\pm2\node_modules\.bin\pm2.cmd"
$pgbin     = "$kok\pgsql\bin"
$backupDir = "$kok\backups"
$credFile  = "$kok\pg-setup\db-credentials.json"
$uygulama  = "tekserp-backend"
$env:PM2_HOME = "$kok\pm2-home"

# cwd app\ icinde BIRAKILMAZ: script [5/9] sonrasi Set-Location $appDir yapar; oradan
# cikmadan biten/dusen bir kosum, ayni oturumdaki ikinci kosumu (ve geri almayi)
# kendi biraktigi tanitici yuzunden "app\ tasinamiyor" ile dusurur.
function KokeDon { if (Test-Path $kok) { Set-Location $kok } }
function Fail($m) { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; KokeDon; exit 1 }
function Adim($m) { Write-Host ""; Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK $m" -ForegroundColor Green }
function Uyar($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

function Saglik($saniye) {
  $bitis = (Get-Date).AddSeconds($saniye)
  while ((Get-Date) -lt $bitis) {
    try {
      $h = Invoke-WebRequest "http://localhost:4000/health" -UseBasicParsing -TimeoutSec 5 | ConvertFrom-Json
      if ($h.status -eq "UP" -and $h.db -eq "UP") { return $h }
    } catch { Start-Sleep -Milliseconds 800 }
  }
  return $null
}

# --- Yonetici kontrolu ------------------------------------------------------
$admin = (New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail "YONETICI PowerShell gerekir (pm2 daemon SYSTEM olarak kosuyor: EPERM \\.\pipe\rpc.sock)." }

# =============================================================================
# GERI ALMA MODU
# =============================================================================
if ($GeriAl) {
  $adaylar = Get-ChildItem "$kok\app.eski-*" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
  if (-not $adaylar) { Fail "Geri donulecek kurulum yok ($kok\app.eski-* bulunamadi)." }
  $hedef = $adaylar[0].FullName
  Write-Host ""
  Write-Host "GERI ALMA: $hedef  ->  $appDir" -ForegroundColor Yellow
  if (-not $Zorla) { if ((Read-Host "Devam? (e/h)") -ne 'e') { Fail "Iptal." } }

  & $pm2 delete $uygulama 2>$null | Out-Null
  $damga = Get-Date -Format "yyyyMMdd_HHmmss"
  try {
    if (Test-Path $appDir) { Move-Item $appDir "$kok\app.basarisiz-$damga" -Force -ErrorAction Stop }
    Move-Item $hedef $appDir -Force -ErrorAction Stop
  } catch {
    # Tasima dustu (acik kilit?). pm2 az once silindi - mevcut app\ hala yerindeyse
    # onu geri kaldir; fabrika kapali kalmasin.
    Uyar "Tasima basarisiz: $($_.Exception.Message)"
    if (Test-Path (Join-Path $appDir "ecosystem.config.js")) {
      Push-Location $appDir; & $pm2 start ecosystem.config.js | Out-Null; & $pm2 save | Out-Null; Pop-Location
      Uyar "Mevcut kurulum yeniden baslatildi, hicbir sey degismedi."
    }
    Fail "Geri alma yapilamadi. app\ uzerindeki acik pencere/terminal/editoru kapatip tekrar dene."
  }
  Push-Location $appDir
  & $pm2 start ecosystem.config.js
  & $pm2 save
  Pop-Location
  $h = Saglik 90
  if ($h) { Ok "Geri alindi. API $($h.status) / DB $($h.db) / v$($h.version)" }
  else { Fail "Geri alindi ama /health cevap vermedi. Bak: $pm2 logs $uygulama" }
  Write-Host ""
  Uyar "DB migration'lari GERI ALINMADI. Eski kod yeni semayla kosuyor."
  Uyar "Uyumsuzluk varsa yedekten restore gerekir: $backupDir"
  exit 0
}

if (-not $Paket) { Fail "Paket yolu gerekli:  kur.ps1 -Paket <zip>   (veya -GeriAl)" }
if (-not (Test-Path $Paket)) { Fail "Paket bulunamadi: $Paket" }

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP Backend - surum kurulumu"
Write-Host "================================================================"

$damga = Get-Date -Format "yyyyMMdd_HHmmss"
$temp  = Join-Path $env:TEMP "tekserp-kur-$damga"

# --- [1/9] Paketi ac ve DOGRULA ---------------------------------------------
Adim "[1/9] Paket aciliyor ve dogrulaniyor..."
Expand-Archive -Path $Paket -DestinationPath $temp -Force

$zorunlu = @("dist\server.js","package.json","package-lock.json","ecosystem.config.js",
             "prisma.config.js","prisma\schema.prisma","prisma\migrations","public","assets\fonts")
foreach ($z in $zorunlu) {
  if (-not (Test-Path (Join-Path $temp $z))) { Fail "Paket BOZUK - eksik: $z" }
}
if (Test-Path "$temp\prisma.config.ts") { Fail "Pakette hem .ts hem .js prisma config var - hangisinin okundugu belirsiz." }
if (Test-Path "$temp\src")              { Uyar "Pakette src\ var - bu paket eski bir paketle.ps1 ile uretilmis olabilir." }

if (Test-Path "$temp\PAKET.json") {
  $m = Get-Content "$temp\PAKET.json" -Raw | ConvertFrom-Json
  Write-Host "  commit          : $($m.commit)  ($($m.dal))"
  Write-Host "  uygulama surumu : $($m.uygulamaSurumu)"
  Write-Host "  uretim          : $($m.uretimZamani)  /  $($m.ureten)"
  Write-Host "  migration       : $($m.migrationSayisi)"
  Write-Host "  node_modules    : $(if ($m.nodeModulesDahil) {'pakette DAHIL'} else {'YOK - npm ci kosulacak'})"
  if (-not $m.calismaAgaciTemiz) { Uyar "Paket KIRLI calisma agacindan uretilmis (commit'lenmemis degisiklik icerir)." }
} else { Uyar "PAKET.json yok - eski surum paket." }

$nmVar = Test-Path "$temp\node_modules"
$migSayi = (Get-ChildItem "$temp\prisma\migrations" -Directory).Count
Ok "paket saglam ($migSayi migration klasoru)"

# --- [2/9] Mevcut kurulum ve .env -------------------------------------------
Adim "[2/9] Mevcut kurulum ve .env bulunuyor..."
$mevcut = $null; $ilkGecis = $false
if (Test-Path $appDir)          { $mevcut = $appDir }
elseif (Test-Path $eskiKlon)    { $mevcut = $eskiKlon; $ilkGecis = $true; Uyar "Ilk gecis: git klonundan ($eskiKlon) app\ yapisina tasiniyor." }
else { Fail "Mevcut kurulum bulunamadi ($appDir veya $eskiKlon)." }

$envKaynak = Join-Path $mevcut ".env"
if (-not (Test-Path $envKaynak)) { Fail ".env BULUNAMADI: $envKaynak  -> sirlar olmadan kurulum yapilmaz." }
$envYedek = Join-Path $env:TEMP "tekserp-env-$damga.bak"
Copy-Item $envKaynak $envYedek -Force
Ok "mevcut: $mevcut   |  .env kenara alindi"

# --- Onay -------------------------------------------------------------------
if (-not $Zorla) {
  Write-Host ""
  Write-Host "  KURULACAK : $(Split-Path $Paket -Leaf)"
  Write-Host "  HEDEF     : $appDir"
  Write-Host "  ESKISI    : app.eski-$damga olarak saklanacak (silinmeyecek)"
  if ((Read-Host "  Devam? (e/h)") -ne 'e') { Fail "Iptal edildi - hicbir sey degismedi." }
}

# --- [3/9] Dogrulanmis guvenlik yedegi --------------------------------------
Adim "[3/9] Guvenlik yedegi aliniyor (premigrate_)..."
$cred = Get-Content $credFile -Raw | ConvertFrom-Json
$dump = "$backupDir\premigrate_$damga.dump"
$env:PGPASSWORD = $cred.superpass
& "$pgbin\pg_dump.exe" -h localhost -p $cred.port -U $cred.superuser -d $cred.db -Fc -f $dump
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dump)) { $env:PGPASSWORD=""; Fail "Yedek ALINAMADI -> kurulum IPTAL." }
& "$pgbin\pg_restore.exe" --list $dump > $null
if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD=""; Fail "Yedek DOGRULANAMADI (bozuk dump) -> kurulum IPTAL." }
$env:PGPASSWORD = ""
Ok "$([System.IO.Path]::GetFileName($dump))  ($([math]::Round((Get-Item $dump).Length/1MB,2)) MB) - dogrulandi, rotasyon disi"

# --- [4/9] Uygulamayi durdur ------------------------------------------------
Adim "[4/9] pm2 uygulamasi durduruluyor..."
& $pm2 delete $uygulama 2>$null | Out-Null   # delete: ecosystem env blogu degismis olabilir
Ok "durduruldu"

# --- Buradan sonrasi icin otomatik geri alma --------------------------------
$eskiAd = "$kok\app.eski-$damga"
function GeriAlOtomatik($sebep) {
  # [6/9]'dan gelen cagrilar cwd app\ icindeyken kosar (Set-Location $appDir):
  # Remove-Item $appDir kendi altini keser, tasima "kilitli" diye duser. Once cik.
  KokeDon
  Uyar "HATA: $sebep"

  # -- GERI ALMA ON KOSULU: geri koyacak bir sey YOKSA HICBIR SEYI SILME ---------
  # [5/9]'daki ilk Move-Item dusmusse $eskiAd hic olusmamistir ve $appDir HALA
  # CALISAN kurulumdur. Eski kod "hedef var mi" diye bakip siliyor, "kaynak var mi"
  # diye bakip geri koyuyordu - iki kosul FARKLI seyi soruyordu; tam da hata
  # aninda calisan kurulum yedeksiz siliniyordu (2026-08-24 tespiti).
  if (-not (Test-Path $eskiAd)) {
    Uyar "GERI ALMA YAPILMADI - '$eskiAd' yok: eski kurulum hic kenara alinamamis."
    Uyar "'$appDir' HALA CALISAN KURULUM, DOKUNULMADI. Muhtemel sebep: app\ uzerinde acik"
    Uyar "dosya kilidi (Explorer penceresi / terminal cd / VS Code / log goruntuleyici / antivirus)."
    if (Test-Path (Join-Path $appDir "ecosystem.config.js")) {
      Uyar "Mevcut kurulum oldugu gibi yeniden baslatiliyor (pm2 [4/9]'da durdurulmustu)..."
      Push-Location $appDir
      & $pm2 start ecosystem.config.js | Out-Null
      & $pm2 save | Out-Null
      Pop-Location
      $h = Saglik 90
      if ($h) { Write-Host "  Mevcut surum calisiyor: $($h.status) / DB $($h.db) - hicbir sey degismedi." -ForegroundColor Green }
      else    { Write-Host "  !! pm2 start verildi ama /health cevap vermedi. $pm2 logs $uygulama" -ForegroundColor Red }
    } else {
      Write-Host "  !! '$appDir\ecosystem.config.js' yok - pm2 elle baslatilamadi." -ForegroundColor Red
    }
    Write-Host "    Kilidi bul (Sysinternals):  handle.exe `"$appDir`"   - kapat, sonra kur.ps1'i yeniden kos."
    exit 1
  }

  Uyar "Otomatik geri aliniyor (DB'ye HENUZ dokunulmadi)..."
  # NOT: Move-Item kullaniliyor, Rename-Item DEGIL - ilk geciste kaynak
  # C:\...\tekserp\Teks-Erp yani FARKLI bir ust klasor; Rename-Item klasorler
  # arasi tasiyamaz ve geri alma tam da hata aninda patlardi.
  # -ErrorAction Stop (eskiden SilentlyContinue): yarim silinmis app\ uzerine
  # Move-Item hedefi VAR sanip app.eski'yi app\ ICINE tasirdi (ic ice kurulum).
  # Ilk hatada dur; app.eski-* saglam kalir, elle komutlar asagida.
  try {
    if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force -ErrorAction Stop }
    Move-Item $eskiAd $appDir -Force -ErrorAction Stop
  } catch {
    Write-Host "  !! Geri alma YARIDA KALDI: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "     Eski kurulum SAGLAM: $eskiAd" -ForegroundColor Yellow
    Write-Host "     Elle:  Remove-Item '$appDir' -Recurse -Force; Move-Item '$eskiAd' '$appDir'"
    Write-Host "            Push-Location '$appDir'; & '$pm2' start ecosystem.config.js; & '$pm2' save; Pop-Location"
    exit 1
  }
  if (-not (Test-Path (Join-Path $appDir "ecosystem.config.js"))) {
    Write-Host "  !! Geri alindi ama '$appDir\ecosystem.config.js' yok - pm2 baslatilamiyor." -ForegroundColor Red
    exit 1
  }
  Push-Location $appDir
  & $pm2 start ecosystem.config.js | Out-Null
  & $pm2 save | Out-Null
  Pop-Location
  $h = Saglik 90
  if ($h) { Write-Host "  Eski surum geri geldi: $($h.status) / DB $($h.db)" -ForegroundColor Green }
  else    { Write-Host "  !! Geri alindi ama /health cevap vermedi. $pm2 logs $uygulama" -ForegroundColor Red }
  exit 1
}

# --- [5/9] Eskisini kenara al, yenisini yerlestir ---------------------------
Adim "[5/9] Yeni surum yerlestiriliyor..."
try {
  # Move-Item: ilk geciste kaynak farkli bir ust klasorde (tekserp\Teks-Erp),
  # Rename-Item bunu yapamaz.
  Move-Item $mevcut $eskiAd -Force -ErrorAction Stop
  # Ilk gecis sonrasi C:\...\tekserp\ kabugu (icinde .git) geride kalir;
  # BILEREK silinmez - geri donus tamamlanana kadar dursun (sonda hatirlatilir).
  New-Item -ItemType Directory -Path $appDir | Out-Null
  Copy-Item "$temp\*" $appDir -Recurse -Force
  Copy-Item $envYedek (Join-Path $appDir ".env") -Force
} catch { GeriAlOtomatik "Dosya yerlestirme basarisiz: $($_.Exception.Message)" }
Ok "app\ olusturuldu, .env tasindi"

Set-Location $appDir

# --- [6/9] Bagimliliklar (pakette yoksa) ------------------------------------
if (-not $nmVar) {
  Adim "[6/9] Uretim bagimliliklari kuruluyor (npm ci --omit=dev)..."
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { GeriAlOtomatik "npm ci basarisiz (internet erisimi var mi?)" }
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { GeriAlOtomatik "prisma generate basarisiz" }
  Ok "bagimliliklar kuruldu"
} else {
  Adim "[6/9] Bagimliliklar pakette geldi - npm ci ATLANDI."
}

# --- [7/9] Migration - GERI ALINAMAZ ESIK -----------------------------------
Adim "[7/9] Migration'lar uygulaniyor (GERI ALINAMAZ ESIK)..."
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  X MIGRATION BASARISIZ" -ForegroundColor Red
  Write-Host "    DB kismi degismis OLABILIR. Otomatik geri alinmiyor - karar senin." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "    Durumu gor :  cd $appDir ; npx prisma migrate status"
  Write-Host "    Kodu geri al:  $kok\kur.ps1 -GeriAl"
  Write-Host "    DB'yi geri al: pg_restore ... $dump   (KURULUM dokumanina bak)"
  KokeDon
  exit 1
}
Ok "migration'lar uygulandi"

# --- [8/9] pm2 --------------------------------------------------------------
Adim "[8/9] pm2 baslatiliyor..."
& $pm2 start ecosystem.config.js
if ($LASTEXITCODE -ne 0) { Fail "pm2 start basarisiz. Geri donus: $kok\kur.ps1 -GeriAl" }
& $pm2 save    # ZORUNLU: reboot'ta dogru klasor kalksin (dump.pm2 tazelenir)
Ok "baslatildi ve kaydedildi (pm2 save)"

# --- [9/9] Dogrulama --------------------------------------------------------
Adim "[9/9] Saglik kontrolu..."
$h = Saglik 120
if (-not $h) {
  Write-Host "  X /health 120 sn icinde cevap vermedi." -ForegroundColor Red
  Write-Host "    Loglar :  `$env:PM2_HOME='$kok\pm2-home'; & '$pm2' logs $uygulama --lines 80"
  Write-Host "    Geri al:  $kok\kur.ps1 -GeriAl"
  KokeDon
  exit 1
}

Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
KokeDon   # cwd'yi app\ icinde birakma - ayni oturumdaki ikinci kosum kendi kilidine takilir

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  KURULUM TAMAM" -ForegroundColor Green
Write-Host "================================================================"
Write-Host "  API      : $($h.status)   DB: $($h.db)   surum: $($h.version)"
# /health'te `lastBackup` YOK (2026-08-09 denetimi F-CORE-GUV-002: alan yetkili
# /api/admin/health'e tasindi) - eski satir her deploy'da BOS basiyor ve operatore
# "yedek yok" diye okunuyordu. Gece yedegi (tekserp_*.dump, rotasyona giren) klasorden okunur;
# bu kurulumun premigrate_ dump'i ayrica asagida "veri:" satirinda.
$geceYedegi = Get-ChildItem $backupDir -Filter "tekserp_*.dump" -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($geceYedegi) { Write-Host "  Son gece yedegi: $($geceYedegi.Name)  ($($geceYedegi.LastWriteTime.ToString('yyyy-MM-dd HH:mm')))" }
else             { Write-Host "  Son gece yedegi: YOK - $backupDir icinde tekserp_*.dump bulunamadi (Gorev Zamanlayici TeksERP-DB-Backup'a bak)" -ForegroundColor Yellow }
Write-Host "  Kurulum  : $appDir"
Write-Host "  Geri donus noktalari:"
Write-Host "     kod : $eskiAd        ->  kur.ps1 -GeriAl"
Write-Host "     veri: $dump"
Write-Host ""
Write-Host "  Birkac gun sorunsuz calistiktan sonra $eskiAd silinebilir."
if ($ilkGecis) {
  Write-Host ""
  Write-Host "  ! ILK GECIS TAMAMLANDI - kaynak kod artik sunucuda DEGIL." -ForegroundColor Yellow
  Write-Host "    Geride kalan git kabugu:  $kok\tekserp   (icinde .git, src, scripts)"
  Write-Host "    Sistem birkac gun sorunsuz calistiktan SONRA silinecek:"
  Write-Host "       Remove-Item '$kok\tekserp' -Recurse -Force"
  Write-Host "    (Once silme - geri donus yolun o klasor.)"
}
Write-Host "================================================================"
Write-Host ""
