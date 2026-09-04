# =============================================================================
# TeksERP Backend - SURUM KURULUMU (paket tabanli)
# =============================================================================
# NEREDE CALISIR: SUNUCUDA, YONETICI PowerShell'de.
#   C:\Etkili-Yazilim\kur.ps1 -Paket D:\tekserp-backend-20260801_120000-abc1234.zip
#   C:\Etkili-Yazilim\kur.ps1 -GeriAl          # son kuruluma geri don
#
# ⚠ PAKETLENMIS KURULUMDA `npm run <script>` KULLANMA - `node <tam yol>` kullan.
#   Paket `node_modules\.bin` TASIMAZ ve bu BILINCLIDIR: npm o klasordeki
#   shim'leri KURULUM ANINDA, kendi platformunda uretir (Windows'ta `.cmd`,
#   macOS/Linux'ta sembolik bag). macOS'ta uretilen bir pakette `.bin` ya hic
#   olmaz ya da Windows'ta calismayan sembolik baglar tasir - 2026-09-04 ev
#   provasinda `npx prisma` tam bu yuzden `[7/9]`'da dustu.
#   Bu script'in kendisi kurala uyar: prisma `node node_modules\prisma\build\
#   index.js`, satici hesabi `node dist\tools\superadmin-olustur.cjs`.
#   Yeni bir bakim komutu eklerken ayni sekilde yaz.
#
#   YAN YANA (guvenli gecis) - eskiye HIC dokunmadan yeni koke kur:
#   C:\TeksERP\kur.ps1 -Kok C:\TeksERP -Paket D:\tekserp-backend-....zip
#     Eski kurulum yerinde kalir; devretme = eskiyi durdur, yeniyi baslat.
#     Geri donus = yeniyi durdur, eskiyi baslat (DB'ler de ayridir).
#     ⚠ Windows'ta PM2_HOME surecleri AYIRMAZ (tek pipe) - yalniz log/dump konumu.
#
# NEDEN guncelle.ps1'IN YERINI ALDI:
#   CALISAN kurulum (app\) bir git klonu DEGIL, hazir pakettir; "pull et + derle"
#   orada yapilamaz. Paket sunucudaki BUILD klonundan uretilir
#   (D:\tekserp-build\tekserp - tam klon, dalin ucu; klon kokunde
#   .\deploy\paketle.ps1 -Cikti C:\Etkili-Yazilim). C:\Etkili-Yazilim\tekserp
#   klonu sparse + dar refspec'tir (yalnizca main) - paket icin KULLANMA. Dal artik
#   her iki klonda da main (2026-09-02: musteri dali adnansahin emekli edildi).
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
  [switch]$Zorla,
  # KURULUM KOKU. Varsayilan sahadaki yol; YAN YANA kurulum icin degistirilir.
  #
  # ⚠ NEDEN PARAMETRE (2026-09-04): guvenli gecis modeli "eskiyi YERINDE birak,
  #   yeniyi AYRI koke kur, pm2'yi devret" seklindedir. Eski kurulum dosya
  #   duzeyinde HIC dokunulmadan kalir; geri donus = eski pm2'yi baslat. Kok
  #   sabit oldugu surece bu model yazilamiyordu ve tek yol calisan kurulumun
  #   uzerine yazmakti.
  #
  # ⚠ WINDOWS'TA PM2_HOME SURECLERI AYIRMAZ (2026-09-04 ev provasi, BULGU-4).
  #   pm2 daemon'i `\\.\pipe\rpc.sock` adini kullanir ve bu ad PM2_HOME'a gore
  #   isimlendirilmez - makinede TEK pipe vardir. Ayri PM2_HOME yalnizca
  #   `dump.pm2` ve log KONUMUNU ayirir; SUREC LISTESINI AYIRMAZ. Yan yana iki
  #   kok ayni daemon'i paylasir.
  #   ⚠ Ayrica: her iki kokun pm2 komutlari AYNI YUKSELTME SEVIYESINDEN
  #   verilmelidir. Yonetici daemon + yetkisiz istemci = `connect EPERM
  #   \\.\pipe\rpc.sock` ve bu hata "uygulama yok" gibi okunur.
  #   Komut verirken DOGRU PM2_HOME'u
  #   kullan, yoksa "uygulama yok" dersin. Script bunu kendisi ayarlar.
  #
  # ⚠ IKISI AYNI ANDA CALISABILIR - AMA UC SEY BIRDEN AYRILMALI:
  #     1. PORT          -> ikinci kurulumun ecosystem.config.js'inde
  #     2. pm2 adi       -> -UygulamaAdi (yoksa ikincisi birinciyi pm2'den siler)
  #     3. VERITABANI    -> ayri DB. Ayni DB'ye baglanirlarsa TEK-PROCESS
  #        INVARIANTI kirilir: arsiv/yedek zamanlayicilari ve feature-flag
  #        onbellegi process-local durum tutar, ikinci ornek SESSIZCE cift arsiv
  #        ve cift gece yedegi uretir (ecosystem.config.js'de yazili).
  #   Devretmeden once eskisini durdur.
  [string]$Kok = "C:\Etkili-Yazilim",
  # ⚠ YAN YANA KURULUMDA ZORUNLU: pm2 uygulama adi. Iki kurulum ayni adi
  #   tasirsa ikincisi birincisini pm2'den SILER (`pm2 delete` [4/9]) - eski
  #   surum sessizce durur ve operator bunu ancak fabrika calismayinca anlar.
  #   Ornek: -UygulamaAdi tekserp-backend-yeni
  [string]$UygulamaAdi = "tekserp-backend"
)
$ErrorActionPreference = "Stop"

$kok       = $Kok
$appDir    = "$kok\app"
$eskiKlon  = "$kok\tekserp\Teks-Erp"      # ilk gecis: git klonundan gelen kurulum
$pm2       = "$kok\pm2\node_modules\.bin\pm2.cmd"
$pgbin     = "$kok\pgsql\bin"
$backupDir = "$kok\backups"
$credFile  = "$kok\pg-setup\db-credentials.json"
$uygulama  = $UygulamaAdi
$env:PM2_HOME = "$kok\pm2-home"

# cwd app\ icinde BIRAKILMAZ: script [5/9] sonrasi Set-Location $appDir yapar; oradan
# cikmadan biten/dusen bir kosum, ayni oturumdaki ikinci kosumu (ve geri almayi)
# kendi biraktigi tanitici yuzunden "app\ tasinamiyor" ile dusurur.
function KokeDon { if (Test-Path $kok) { Set-Location $kok } }
function Fail($m) { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; KokeDon; exit 1 }
function Adim($m) { Write-Host ""; Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  OK $m" -ForegroundColor Green }
function Uyar($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

# Kurulumun GERCEK portu — `ecosystem.config.js`ten okunur, sabit DEGIL.
# ⚠ YAN YANA KURULUMDA LOAD-BEARING: saglik kontrolu 4000'e sabitken ikinci
#   kurulum (ornegin :4100) YANLIS backend'i sorgulayip "API UP" derdi - yani
#   hic baslamamis bir kurulum BASARILI raporlanirdi. Sessiz yalanci gecis.
$script:saglikPort = 4000
function PortCoz {
  $eco = Join-Path $appDir "ecosystem.config.js"
  if (-not (Test-Path $eco)) { return }
  try {
    $p = & node -e "try{const c=require(process.argv[1]);process.stdout.write(String(c.apps?.[0]?.env?.PORT??''))}catch(e){}" $eco
    if ($p -match '^\d+$') { $script:saglikPort = [int]$p }
  } catch { }
}

function Saglik($saniye) {
  $bitis = (Get-Date).AddSeconds($saniye)
  while ((Get-Date) -lt $bitis) {
    try {
      $h = Invoke-WebRequest "http://localhost:$script:saglikPort/health" -UseBasicParsing -TimeoutSec 5 | ConvertFrom-Json
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
  # ⚠ ADAY DOGRULANIR (2026-09-04 ev provasi, BULGU-6). Eski kod EN YENI
  #   `app.eski-*` klasorunu KOSULSUZ geri koyuyordu. Provada olculdu: ilk
  #   kurulumda `ilk-kurulum.ps1`in biraktigi iskelet `app\` (icinde YALNIZ
  #   `.env`) [5/9] tarafindan `app.eski-*` olarak kenara alinmisti; `-GeriAl`
  #   onu "geri donulecek surum" sanip CALISAN kurulumu
  #   `app.basarisiz-<damga>`ya tasir, bos iskeleti `app\` yapar ve pm2 hicbir
  #   sey baslatamazdi -> fabrika kapali, saglam kurulum operatorun EN SON
  #   bakacagi klasorde.
  #   ⚠ Asimetri load-bearing'di: OTOMATIK kol (`GeriAlOtomatik`) bu kontrolu
  #   yapiyordu, ELLE cagrilan kolda yoktu - "kontrolu iki koldan yalniz birine
  #   koymak" sinifi (2026-08-24 vakasinin kardesi).
  function AdayGecerliMi($yol) {
    return (Test-Path (Join-Path $yol "ecosystem.config.js")) -and
           (Test-Path (Join-Path $yol "dist\server.js"))
  }
  $tumAdaylar = @(Get-ChildItem "$kok\app.eski-*" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
  if (-not $tumAdaylar) { Fail "Geri donulecek kurulum yok ($kok\app.eski-* bulunamadi)." }
  $gecerli = @($tumAdaylar | Where-Object { AdayGecerliMi $_.FullName })
  if (-not $gecerli) {
    Write-Host ""
    Write-Host "  Bulunan ama CALISTIRILAMAZ adaylar:" -ForegroundColor Yellow
    foreach ($a in $tumAdaylar) {
      $eksik = @()
      if (-not (Test-Path (Join-Path $a.FullName "ecosystem.config.js"))) { $eksik += "ecosystem.config.js" }
      if (-not (Test-Path (Join-Path $a.FullName "dist\server.js")))      { $eksik += "dist\server.js" }
      Write-Host "    $($a.Name)  - eksik: $($eksik -join ', ')"
    }
    Fail "Gecerli geri donus adayi YOK. HICBIR SEYE DOKUNULMADI - calisan kurulum yerinde."
  }
  if ($gecerli.Count -lt $tumAdaylar.Count) {
    Uyar "$($tumAdaylar.Count - $gecerli.Count) aday calistirilamaz oldugu icin ATLANDI."
  }
  $hedef = $gecerli[0].FullName
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

$m = $null
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

# ⚠ 2026-09-04 ev provasi (BULGU-1): bu kapi "paket saglam" dedi ve paket 140
#   dosya eksikti. Kapi YANLIS SORUYU soruyordu - yalnizca ust duzey klasorlere
#   bakiyordu. Eksik olanlar nokta ile baslayan girdilerdi ve ikisi de olumcul:
#     node_modules/.prisma/client  -> backend "Cannot find module
#       '.prisma/client/default'" ile ACILMAZ; pm2 'online' gosterirken restart
#       dongusune girer (en sinsi ariza: sureç doğar, saniyeler icinde olur)
#     dist/tools/superadmin-olustur.cjs -> satici hesabi HIC kurulamaz
#   Beyan/gercek sayisi da kiyaslanir: PAKET.json 13658 diyordu, zip'te 13518
#   vardi ve kimse gormedi.
if ($nmVar) {
  # `.bin` BILEREK aranmaz: macOS/Linux'ta uretilen pakette orada sembolik baglar
  # olur (Windows'ta ise yaramaz) ve bu script prisma'yi `.bin` uzerinden DEGIL
  # dogrudan node ile cagirir. bkz. [7/9].
  # ⚠⚠ SEMA MOTORU (2026-09-04, sahada yakalandi): `migrate deploy` NATIVE bir
  #   ikili kullanir - `schema-engine-<platform>`. Sorgu motoru WASM oldugu icin
  #   "Prisma 7'de platform motoru yok" sanilip macOS'ta paketlenen bir pakete
  #   yalnizca `schema-engine-darwin-arm64` girdi. Windows'ta o ikili
  #   CALISMAZ ve arizanin cikacagi yer [7/9] - GERI ALINAMAZ ESIK, ustelik
  #   fabrika o anda ZATEN KAPALI (eski API durdurulmus olur).
  #   ⚠ Prisma eksik motoru %LOCALAPPDATA% onbelleginden ya da internetten
  #   sessizce tamamlayabilir; yani bu arizanin bir kez "kendiliginden gecmis"
  #   olmasi paketin saglam oldugunu GOSTERMEZ. Kapi burada, esikten ONCE.
  $motorDizin = Join-Path $temp "node_modules\@prisma\engines"
  if (Test-Path $motorDizin) {
    $winMotor = Join-Path $motorDizin "schema-engine-windows.exe"
    if (-not (Test-Path $winMotor)) {
      $bulunan = (Get-ChildItem $motorDizin -Filter "schema-engine-*" -File -ErrorAction SilentlyContinue |
                  ForEach-Object { $_.Name }) -join ", "
      if (-not $bulunan) { $bulunan = "(hic yok)" }
      Fail @"
Pakette WINDOWS sema motoru yok: schema-engine-windows.exe
       Bulunan: $bulunan
       Bu paket baska bir platformda uretilmis. `migrate deploy` [7/9]'da
       duser ve orasi GERI ALINAMAZ ESIK.
       Cozum: paketi PRISMA_CLI_BINARY_TARGETS=windows ile yeniden uret
       (guncel deploy\paketle.ps1 bunu zaten yapiyor ve kendi kapisi var).
"@
    }
  }
  foreach ($z in @("node_modules\.prisma\client", "node_modules\prisma\build\index.js")) {
    if (-not (Test-Path (Join-Path $temp $z))) { Fail "Paket BOZUK - eksik: $z  (backend acilamaz)" }
  }
}
if (-not (Test-Path "$temp\dist\tools\superadmin-olustur.cjs")) {
  Uyar 'dist\tools\superadmin-olustur.cjs YOK - (npm run superadmin:kur) bu paketle KOSMAZ - satici hesabi kurulamaz.'
}

if ($m -and $m.dosyaSayisi) {
  # PAKET.json kendisi sayima dahil DEGIL -> beklenen = dosyaSayisi + 1
  $gercekDosya = (Get-ChildItem $temp -Recurse -File -Force).Count
  $beklenen = [int]$m.dosyaSayisi + 1
  if ($gercekDosya -ne $beklenen) {
    Fail "Paket BOZUK - beyan $beklenen dosya, acilanlar $gercekDosya. Fark: $($beklenen - $gercekDosya)."
  }
  Ok "dosya sayisi beyanla uyusuyor ($gercekDosya)"
}

# Node surumu: package.json ZEMIN koyar (`engines.node`), bu kapi onu OLCER.
# 2026-09-04 ev provasi (BULGU-6): dokuman "22.x" diyordu, saha makinesi 26.4,
# paketi ureten 26.8 idi ve hicbir kapi farki gormuyordu. Ust sinir YOK.
$nodeSurum = (& node --version) -replace '^v',''
$nodeMajor = [int](($nodeSurum -split '\.')[0])
$paketJson = Get-Content (Join-Path $temp "package.json") -Raw | ConvertFrom-Json
$zemin = 22
if ($paketJson.engines -and $paketJson.engines.node -match '(\d+)') { $zemin = [int]$Matches[1] }
if ($nodeMajor -lt $zemin) {
  Fail "Node $nodeSurum bu paket icin COK ESKI (en az $zemin gerekiyor). Once Node'u yukseltin."
}
Ok "node $nodeSurum (zemin: >=$zemin)"
if ($m -and $m.nodeSurumu) {
  $ureticiMajor = [int](($m.nodeSurumu -replace '^v','' -split '\.')[0])
  if ($nodeMajor -lt $ureticiMajor) {
    Uyar "Paket Node $($m.nodeSurumu) ile uretildi, bu sunucuda Node $nodeSurum var - daha ESKI. Sorun cikarsa ilk buraya bakin."
  }
}

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

# ecosystem.config.js SUNUCUNUNDUR, paketin degil (denetim 2026-08-29, BULGU-T1-020).
# Icinde .env'de olmayan OPERASYONEL ayarlar yasar: BACKUP_SCHEDULE_ENABLED,
# BACKUP_DIR, BACKUP_RETENTION_DAYS, BACKUP_RCLONE_REMOTE/BIN/CONFIG, BACKUP_HOUR,
# PG_BIN_DIR, DISCOVERY_MDNS_ENABLED. Paketteki dosya REPO varsayilanlarini tasir
# (offsite bos, scheduler acik) -> her kurulum sahadaki ayari sessizce geri aliyordu:
# gece yedegi ve makine disi kopya, guncelleme yapilan gece KAPANIYORDU.
$ecoKaynak = Join-Path $mevcut "ecosystem.config.js"
$ecoYedek  = $null
if (Test-Path $ecoKaynak) {
  $ecoYedek = Join-Path $env:TEMP "tekserp-ecosystem-$damga.bak"
  Copy-Item $ecoKaynak $ecoYedek -Force
}
Ok "mevcut: $mevcut   |  .env + ecosystem.config.js kenara alindi"

# --- Onay -------------------------------------------------------------------
if (-not $Zorla) {
  Write-Host ""
  Write-Host "  KURULACAK : $(Split-Path $Paket -Leaf)"
  Write-Host "  HEDEF     : $appDir"
  Write-Host "  ESKISI    : app.eski-/app.iskelet-$damga olarak saklanacak (silinmeyecek)"
  if ((Read-Host "  Devam? (e/h)") -ne 'e') { Fail "Iptal edildi - hicbir sey degismedi." }
}

# --- [3/9] Dogrulanmis guvenlik yedegi --------------------------------------
Adim "[3/9] Guvenlik yedegi aliniyor (premigrate_)..."
$cred = Get-Content $credFile -Raw | ConvertFrom-Json
$dump = "$backupDir\premigrate_$damga.dump"
# Alan adlari iki nesildir: yeni kurulumlar `user`/`pass` yazar (uygulama rolu),
# fabrikadaki eski dosya `superuser`/`superpass` tasir. Ikisini de okuruz -
# tek isim dayatmak, calisan bir sunucudaki dosyayi elle duzeltmek demekti.
$dbKul = if ($cred.user) { $cred.user } else { $cred.superuser }
$dbPar = if ($cred.pass) { $cred.pass } else { $cred.superpass }
if (-not $dbKul -or -not $dbPar) { Fail "db-credentials.json kimlik tasimiyor (user/pass ya da superuser/superpass)." }
$env:PGPASSWORD = $dbPar
& "$pgbin\pg_dump.exe" -h localhost -p $cred.port -U $dbKul -d $cred.db -Fc -f $dump
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
# ⚠ ISKELET ile CALISAN kurulum AYRI adlar alir (2026-09-04, BULGU-6'nin ikinci
#   parcasi). `ilk-kurulum.ps1` yalnizca `.env` tasiyan bos bir `app\` birakir;
#   o `app.eski-*` adiyla kenara alinirsa `-GeriAl` icin sahte bir "geri donus
#   adayi" olur. Ayirt edici olcut CALISTIRILABILIRLIK: `dist\server.js`.
#   ⚠ Olcum $mevcut uzerinde: [5/9] tasinan odur ($appDir DEGIL - ilk geciste
#     $mevcut git klonu olabilir).
$calisirdi = (Test-Path (Join-Path $mevcut "dist\server.js"))
$eskiAd = if ($calisirdi) { "$kok\app.eski-$damga" } else { "$kok\app.iskelet-$damga" }
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
  # Sunucunun ecosystem'i KORUNUR; paketinki yanina '.paket' olarak birakilir.
  # Prompt YOK (kurulum -Zorla ile otomatik kosabiliyor) - fark EKRANA basilir,
  # karar operatorde kalir. Yeni ayar geldiyse .paket dosyasindan elle alinir.
  if ($ecoYedek -and (Test-Path $ecoYedek)) {
    $ecoHedef = Join-Path $appDir "ecosystem.config.js"
    if (Test-Path $ecoHedef) { Copy-Item $ecoHedef "$ecoHedef.paket" -Force }
    Copy-Item $ecoYedek $ecoHedef -Force
  }
} catch { GeriAlOtomatik "Dosya yerlestirme basarisiz: $($_.Exception.Message)" }
if ($ecoYedek) {
  Ok "app\ olusturuldu, .env + ecosystem.config.js (SUNUCUNUNKI) tasindi"
  # Fark ozeti: yalnizca env: blogundaki ANAHTARLAR karsilastirilir; deger
  # basilmaz (sir olmasa da operasyonel bilgi ekrana dokulmesin).
  # Yollar burada YENIDEN kurulur - try blogundaki degiskene guvenilmez.
  $ecoHedef = Join-Path $appDir "ecosystem.config.js"
  $ecoPaket = Join-Path $appDir "ecosystem.config.js.paket"
  if (Test-Path $ecoPaket) {
    $anahtar = {
      param($yol)
      if (-not (Test-Path $yol)) { return @() }
      $ham = Get-Content $yol -Raw
      if (-not $ham) { return @() }
      ([regex]::Matches($ham, '(?m)^\s{6,}([A-Z][A-Z0-9_]{2,})\s*:') | ForEach-Object { $_.Groups[1].Value }) | Sort-Object -Unique
    }
    $sunucu = & $anahtar $ecoHedef
    # ⚠ DEGISKEN ADI `$paket` OLAMAZ (2026-09-04 ev provasi, BULGU-7).
    #   param() blogunda `[string]$Paket` var ve PowerShell HARF DUYARSIZDIR:
    #   ikisi AYNI degiskendir. Tip kisiti yuzunden 13 elemanlik dizi ona
    #   atanirken hata ATILMAZ - sessizce bosluklarla birlesip TEK STRING olur.
    #   Sonuc: `$yeni` o dev string'i (hicbir anahtara esit degil) ve `$dusen`
    #   sunucunun tum anahtarlarini icerir -> ayni 13 anahtar hem "YENI" hem
    #   "ARTIK YOK" diye listelenir. Kapi duruyordu ama HICBIR SEY OLCMUYORDU:
    #   paket gercekten yeni bir ayar getirse operator onu ayirt edemezdi.
    #   (Belirti: ilk liste bosluklu, ikincisi virgullu basiliyordu - ayni
    #   `-join ', '` iki farkli sonuc veremez; ilki zaten tek string'di.)
    $paketAnahtar = & $anahtar $ecoPaket
    $yeni   = @($paketAnahtar | Where-Object { $sunucu -notcontains $_ })
    $dusen  = @($sunucu       | Where-Object { $paketAnahtar -notcontains $_ })
    if ($yeni.Count -or $dusen.Count) {
      Write-Host ""
      Write-Host "  ecosystem.config.js: sunucununki KORUNDU (paketinki: ecosystem.config.js.paket)" -ForegroundColor Yellow
      if ($yeni.Count)  { Write-Host "    pakette YENI ayar : $($yeni  -join ', ')  -> gerekiyorsa elle ekleyin" -ForegroundColor Yellow }
      if ($dusen.Count) { Write-Host "    pakette ARTIK YOK : $($dusen -join ', ')  -> sunucuda duruyor, gozden gecirin" -ForegroundColor Yellow }
      Write-Host ""
    }
  }
} else {
  Ok "app\ olusturuldu, .env tasindi (onceki ecosystem.config.js yoktu - paketinki kullanilacak)"
}

Set-Location $appDir

# Prisma CLI'nin giris noktasi. `.bin` shim'lerine BAGIMLI DEGILDIR - bkz. [7/9].
$prismaCli = Join-Path $appDir "node_modules\prisma\build\index.js"
if (-not (Test-Path $prismaCli)) { GeriAlOtomatik "prisma CLI bulunamadi: $prismaCli" }

# --- [6/9] Bagimliliklar (pakette yoksa) ------------------------------------
if (-not $nmVar) {
  Adim "[6/9] Uretim bagimliliklari kuruluyor (npm ci --omit=dev)..."
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { GeriAlOtomatik "npm ci basarisiz (internet erisimi var mi?)" }
  & node $prismaCli generate
  if ($LASTEXITCODE -ne 0) { GeriAlOtomatik "prisma generate basarisiz" }
  Ok "bagimliliklar kuruldu"
} else {
  Adim "[6/9] Bagimliliklar pakette geldi - npm ci ATLANDI."
}

# --- [7/9] Migration - GERI ALINAMAZ ESIK -----------------------------------
Adim "[7/9] Migration'lar uygulaniyor (GERI ALINAMAZ ESIK)..."
# ⚠ `npx prisma` KULLANILMAZ (2026-09-04 ev provasi, BULGU-1). `npx` CLI'yi
#   `node_modules\.bin` uzerinden cozer; o klasor macOS/Linux'ta uretilen
#   pakette ya hic yoktur ya da Windows'ta calismayan sembolik baglar tasir
#   (npm `.cmd` shim'lerini KURULUM ANINDA, kendi platformunda uretir). Giris
#   noktasini dogrudan cagirmak her platformda ayni sekilde calisir.
& node $prismaCli migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  X MIGRATION BASARISIZ" -ForegroundColor Red
  Write-Host "    DB kismi degismis OLABILIR. Otomatik geri alinmiyor - karar senin." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "    Durumu gor :  cd $appDir ; node node_modules\prisma\build\index.js migrate status"
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

# --- Firewall: mDNS servis kesfi (UDP 5353) ---------------------------------
# Sunucu kendini aga "_teks-erp._tcp" olarak ilan eder; yeni kurulan Electron
# paneli boylece IP yazmadan bulur. Bu kural OLMADAN ilan fabrika aginda
# GORUNMEZ (kesif yalnizca istemcinin alt ag taramasiyla calisir - yavas ama
# calisir, o yuzden hata burada kurulumu KESMEZ).
#
# Idempotent: script her surumde yeniden kosuyor, mukerrer kural birikmesin.
# TCP 4000 kurali BU SCRIPTTE DEGIL - elle acilir (docs/ops/DEPLOY-RUNBOOK.md).
$mdnsKural = "TeksERP mDNS 5353"
try {
  if (-not (Get-NetFirewallRule -DisplayName $mdnsKural -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $mdnsKural -Direction Inbound `
      -Protocol UDP -LocalPort 5353 -Action Allow -ErrorAction Stop | Out-Null
    Ok "firewall kurali eklendi: $mdnsKural"
  } else {
    Ok "firewall kurali zaten var: $mdnsKural"
  }
} catch {
  # Fail DEGIL: kesif calismasa da fabrika calisir. Gorunur uyari yeter.
  Uyar "firewall kurali eklenemedi ($mdnsKural): $($_.Exception.Message)"
  Uyar "  -> sunucu kesfi yalnizca ag taramasiyla calisacak (yavas). Elle ekleyin."
}

# --- [9/9] Dogrulama --------------------------------------------------------
PortCoz
Adim "[9/9] Saglik kontrolu (port $script:saglikPort)..."
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
