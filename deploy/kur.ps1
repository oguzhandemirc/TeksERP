# =============================================================================
# TeksERP Backend - SURUM KURULUMU (paket tabanli)
# =============================================================================
# NEREDE CALISIR: SUNUCUDA, YONETICI PowerShell'de.
#   C:\TeksERP\kur.ps1 -Paket D:\tekserp-backend-20260801_120000-abc1234.zip
#   C:\TeksERP\kur.ps1 -GeriAl          # son kuruluma geri don
#
# ⚠ YURUTME ILKESI: Windows 11 istemcide varsayilan `Restricted`, Server'da
#   `RemoteSigned` (zip'ten cikan dosya "internetten geldi" isaretli). Iki durumda
#   da cipla `C:\TeksERP\kur.ps1` KOSMAZ. Daima:
#     powershell -NoProfile -ExecutionPolicy Bypass -File C:\TeksERP\kur.ps1 -Paket <zip>
#   Ilke yalniz bu surec icin gevser; makinenin ayari degismez.
#
# ⚠ UZAKTAN (SSH): Windows OpenSSH oturumu kapaninca oturumun alt surecleri olur. pm2
#   daemon'u bu kosumda DOGARSA backend oturumla gider ("KURULUM TAMAM" der, sonra
#   durur). SSH'tan: `uzaktan-kos.ps1` ile SYSTEM gorevi olarak kos (runbook §3b);
#   daemon yoksa betik durur (-SshKabul ile bilerek gecilir).
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
#   orada yapilamaz.
#   ⚠ DUZELTILDI 2026-09-07: bu baslik "paket sunucudaki BUILD klonundan uretilir
#   (D:\tekserp-build\tekserp)" diyordu. SUNUCUDA BOYLE BIR KLON YOK ve olmasi da
#   gerekmiyor. Paket GELISTIRME MAKINESINDE uretilir (macOS dahil - `pwsh` ile;
#   bkz. deploy/paketle.ps1 basligi), zip sunucuya kopyalanir, bu script kosar.
#   (bkz. deploy/README.md). Calisan kod hicbir zaman klondan kosmaz.
#
# BU DOSYANIN REPODAKI KOPYASI: <repo>/deploy/kur.ps1 - kaynak orasidir.
#
# ⚠ NEREDEN KOSULUR (2026-09-07 sadelestirmesi): script KONUMUNDAN BAGIMSIZDIR -
#   `$PSScriptRoot` kullanmaz, her yolu `-Kok`tan turetir. Bu yuzden zip ile
#   BIRLIKTE herhangi bir klasore konur ve ORADAN kosulur:
#       D:\indirilenler\kur.ps1 -Kok C:\TeksERP -Paket D:\indirilenler\<zip>
#   Script 2026-09-07'den beri PAKETIN ICINDE de gelir (paketle.ps1 koyar), yani
#   paket ile onu kuran script ayni turdan cikar ve AYRISAMAZ.
#   `C:\<kok>\kur.ps1` bir KOLAYLIK kopyasidir; bayatlayabilir, guvenme.
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
  [string]$Kok = "C:\TeksERP",
  # ⚠ YAN YANA KURULUMDA ZORUNLU: pm2 uygulama adi. Iki kurulum ayni adi
  #   tasirsa ikincisi birincisini pm2'den SILER (`pm2 delete` [4/9]) - eski
  #   surum sessizce durur ve operator bunu ancak fabrika calismayinca anlar.
  #   Ornek: -UygulamaAdi tekserp-backend-yeni
  #   pm2'de bu kurulumun backend'i BASKA adla kayitliysa [1/9] ve -GeriAl DURUR (pm2 ad kapisi).
  [string]$UygulamaAdi = "tekserp-backend-yeni",
  # PROVA paketini (paketle.ps1 -Prova: etiketsiz, surum belgesiz) kurmaya izin.
  #   Verilmezse [1/9] durur - fabrikaya kazara prova kurulmasin.
  [switch]$ProvaKabul,
  # SSH oturumunda pm2 daemon YOKKEN yine de kos (daemon oturumla olecek - bilerek).
  [switch]$SshKabul
)
$ErrorActionPreference = "Stop"

# =============================================================================
# NATIVE KOMUTU "OLDURMEDEN" KOS  (2026-09-07, sahada olculdu)
# =============================================================================
# ⚠ PowerShell 5.1'de `$ErrorActionPreference = "Stop"` YURURLUKTEYKEN bir native
#   komutun stderr'ini YONLENDIRMEK (`2>$null` ya da `2>&1`) o satiri OLUMCUL
#   yapar: stderr satirlari ErrorRecord'a cevrilir ve NativeCommandError firlar.
#   Komutun BASARILI olmasi fark etmez - stderr'e tek satir yazmasi yeter.
#
#   FABRIKA SUNUCUSUNDA OLCULDU (SAHINSRV, PowerShell 5.1, 2026-09-07):
#     $ErrorActionPreference = "Stop"
#     cmd /c "echo x 1>&2" 2>$null | Out-Null   -> PATLADI (NativeCommandError)
#     cmd /c "echo x 1>&2" 2>&1    | Out-Null   -> PATLADI
#     cmd /c "echo x 1>&2"         | Out-Null   -> GECTI
#   Yani sorun stderr'in KENDISI degil, YONLENDIRILMESI.
#
# ⚠ NEDEN CIDDI: `pm2 delete <olmayan-uygulama>` stderr'e "Process or Namespace
#   not found" yazar. Bu, GERI ALMA yolunun (`-GeriAl`) ilk adimidir ve orada
#   uygulama zaten SILINMIS olur ([4/9] silmisti). Yani guncelleme yarida
#   kalinca calistirilacak arac, tam o anda hicbir sey yapmadan oluyordu.
#
# ⚠ BU DOSYA macOS'ta YAZILIYOR ve PowerShell 7 5.1 gibi davranmiyor - bu yuzden
#   duzeltme IKI KATLI: yonlendirme HIC yapilmaz (stderr ekrana duser, zararsiz)
#   VE cagri suresince EAP "Continue"ya cekilir. Hangi mekanizma tetiklerse
#   tetiklesin satir olumcul olamaz.
function Pm2Kos {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arg)
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try   { & $pm2 @Arg | Out-Null }
  finally { $ErrorActionPreference = $eskiEAP }
  return $LASTEXITCODE
}

# =============================================================================
# ⚠ `pm2 delete` DONDUGUNDE SUREC HENUZ OLMEMIS OLABILIR (SAHADA OLCULDU,
#   2026-09-07 sabahi, 2.9.8 kurulumunun BIRINCI denemesi):
#
#     [4/9] pm2 delete   -> donuyor
#     [5/9] Move-Item app -> "dosya baska bir islem tarafindan kullaniliyor"
#
#   Sebep: kapanan node surecinin CALISMA DIZINI `app\` ve isletim sistemi
#   dizin tanitiscisini pm2 komutu donduktan SONRA birakiyor. Bu bir YARIS:
#   ayni paket, ayni komut uc dakika sonra sorunsuz gecti. Onceki iki kurulumda
#   yaris kazanilmisti, bunda kaybedildi - yani "calisiyordu" bir kanit degildi.
#
#   Dusme ZARARSIZ atlatildi (esik oncesi, script kendini geri aldi, kesinti
#   3 sn) ama kurulumu insanin ikinci kez baslatmasina birakiyordu. Simdi
#   tasima ISRAR EDIYOR: kisa araliklarla birkac kez dener.
#
# ⚠ NEDEN "SUREC OLDU MU" DIYE BAKMIYORUZ: tanitici sahibi her zaman pm2'nin
#   bildigi surec degil (Windows Defender, Explorer onizlemesi, acik bir kabuk).
#   Olculebilir tek sey TASIMANIN KENDISI - onu deniyoruz.
#
# Son deneme de duserse hata AYNEN firlatilir: cagri yerindeki `try/catch`
# otomatik geri almayi kosar, davranis bugunkuyle ayni kalir.
# =============================================================================
function TasiIsrarla($kaynak, $hedef, $deneme = 5, $bekleMs = 1500) {
  for ($i = 1; $i -le $deneme; $i++) {
    try {
      Move-Item $kaynak $hedef -Force -ErrorAction Stop
      if ($i -gt 1) { Write-Host "     (tasima $i. denemede gecti - dizin tanitiscisi gec birakilmisti)" -ForegroundColor DarkGray }
      return
    } catch {
      if ($i -eq $deneme) { throw }
      Write-Host "     tasima mesgul, $([math]::Round($bekleMs/1000,1)) sn sonra tekrar ($i/$deneme)..." -ForegroundColor DarkYellow
      Start-Sleep -Milliseconds $bekleMs
    }
  }
}

# Yeni `app\.env` kokun mirasini alir (C:\'den: Users okur, Authenticated Users
# degistirir). Yalniz SYSTEM (pm2 daemon) + Administrators; SID ile, yerellestirilmis
# grup adina bakmadan. ilk-kurulum.ps1 `SirIzniDaralt` ile ayni sozlesme.
function SirIzniDaralt($yol) {
  if (-not (Test-Path $yol)) { return }
  if (-not (Get-Command icacls.exe -ErrorAction SilentlyContinue)) { Uyar "icacls yok - izin DARALTILAMADI: $yol"; return }
  $hak = if ((Get-Item $yol -Force).PSIsContainer) { "(OI)(CI)F" } else { "F" }
  & icacls.exe $yol /inheritance:r /grant:r "*S-1-5-18:$hak" "*S-1-5-32-544:$hak" /remove:g "*S-1-5-32-545" "*S-1-5-11" "*S-1-1-0" | Out-Null
  if ($LASTEXITCODE -ne 0) { Uyar "izin daraltilamadi (icacls $LASTEXITCODE): $yol" }
  else { Ok "izin: yalniz SYSTEM + Administrators - $(Split-Path $yol -Leaf)" }
}

# Lisans dizini: yoksa yaratilir, yalniz SYSTEM + Administrators (kalitim kapali). /T YOK:
# dizin yeni ya da yalniz bizim dosyalarimizi tasir, alt ogeler (OI)(CI) ile miras alir.
# Junction/sembolik bag ise DOKUNULMAZ (hedefi baska bir yerin izinlerini degistirirdi).
function LisansDiziniKur($yol) {
  if (Test-Path $yol) {
    $oge = Get-Item $yol -Force
    if (-not $oge.PSIsContainer) { Uyar "lisans yolu bir DOSYA - dokunulmadi: $yol"; return }
    if ($oge.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { Uyar "lisans dizini junction/bag - izin DEGISTIRILMEDI: $yol"; return }
  } else {
    New-Item -ItemType Directory -Path $yol -Force | Out-Null
  }
  if (-not (Get-Command icacls.exe -ErrorAction SilentlyContinue)) { Uyar "icacls yok - lisans dizini izni DARALTILAMADI: $yol"; return }
  & icacls.exe $yol /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { Uyar "lisans dizini izni daraltilamadi (icacls $LASTEXITCODE): $yol"; return }
  $g = GenisErisim $yol
  if ($null -eq $g) { Uyar "lisans dizini izni OLCULEMEDI: $yol" }
  elseif ($g.Count) { Uyar "lisans dizininde hala genis erisim: $($g -join ', ')" }
  else { Ok "lisans dizini: yalniz SYSTEM + Administrators ($yol)" }
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

$kok       = $Kok
$appDir    = "$kok\app"
$eskiKlon  = "$kok\tekserp\Teks-Erp"      # ilk gecis: git klonundan gelen kurulum
$pm2       = "$kok\pm2\node_modules\.bin\pm2.cmd"
$pgbin     = "$kok\pgsql\bin"
$backupDir = "$kok\backups"
# Yedek sifreleme anahtar dizini (yedekle.ps1 ile ayni varsayilan; BACKUP_DIR DISINDA).
$anahtarDizini = "$kok\yedek-anahtar"
# Lisans deposu (kurulum anahtari, HAK, kira): app\ ve backups\ DISINDA - kurulum app\'i
# degistirir, offsite supurucu backups\'u makine disina kopyalar. Backend varsayilani ayni yol.
$lisansDizini = "$kok\lisans"
$credFile  = "$kok\pg-setup\db-credentials.json"
$uygulama  = $UygulamaAdi
# Ad acikca verildi mi: varsayilan ad baska adla calisan backend'i HEDEFLEMEZ (pm2 ad kapisi).
$adAcik    = $PSBoundParameters.ContainsKey('UygulamaAdi')
# Operatore basilan komutlar: cipla `kur.ps1` yurutme ilkesine takilir (baslik).
$kurKomut  = "powershell -NoProfile -ExecutionPolicy Bypass -File $kok\kur.ps1"
$env:PM2_HOME = "$kok\pm2-home"
# pm2 adi TUM yollarda (kurulum, -GeriAl, otomatik geri alma) ayni: sablon adi bu env'den okur.
$env:TEKSERP_PM2_AD = $uygulama

# --- KURULUM KAYDI (3d-2) -----------------------------------------------------
# Her kurulum ve -GeriAl, kurulum kokundeki EKLEME-YALNIZ gecmis dosyasina BIR JSON
# satiri yazar (app\ DISI, lisans\ ile yan yana; backend yoklamada son kayitlari
# saticiya tasir). Kayit bilgidir: yazilamazsa kurulum DURMAZ, uyarir. Alanlar
# protokolun InstallRecordSchema allowlist'i; geri donus noktasi YOL degil damga.
$gecmisDosyasi = "$kok\kurulum-gecmisi.jsonl"
$surumDeseni = '^\d{1,4}\.\d{1,4}\.\d{1,6}([-+][0-9A-Za-z.-]{1,40})?$'
function PaketSurumu($dizin) {
  $p = Join-Path $dizin "package.json"
  if (-not (Test-Path $p)) { return $null }
  try { $v = [string](Get-Content $p -Raw | ConvertFrom-Json).version } catch { return $null }
  if ($v -cmatch $surumDeseni) { return $v } else { return $null }
}
function MigrationSayisi($dizin) {
  $p = Join-Path $dizin "prisma\migrations"
  if (-not (Test-Path $p)) { return $null }
  return @(Get-ChildItem $p -Directory).Count
}
# 5.1 (Legacy kip) yerel komut argumanindaki `"`yi KACIRMAZ; psql'e giden SQL buradan gecer.
function NativeArg([string]$s) {
  $pas = Get-Variable -Name PSNativeCommandArgumentPassing -ValueOnly -ErrorAction SilentlyContinue
  if ($PSVersionTable.PSVersion.Major -ge 7 -and $pas -and $pas -ne "Legacy") { return $s }
  return ($s -creplace '(\\*)"', '$1$1\"')
}
# DB'de UYGULANMIS migration sayisi (paketteki klasor sayisi DEGIL - DB paketin gerisinde de olabilir).
# Olculemezse $null: kurulum kaydi "bilinmiyor" der, kurulum durmaz. stderr YONLENDIRILMEZ (test_deploy_log_rotation §6);
# psql hatasi ekrana duser, EAP=Continue onu olumcul yapmaz.
function DbMigrationSayisi($binDir, $c, $kul, $par) {
  if (-not $c -or -not $kul -or -not $par -or -not (Test-Path (Join-Path $binDir "psql.exe"))) { return $null }
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $par
  try {
    $cikti = & (Join-Path $binDir "psql.exe") -X -w -h localhost -p $c.port -U $kul -d $c.db -v ON_ERROR_STOP=1 -tAc (NativeArg "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
    if ($LASTEXITCODE -ne 0) { return $null }
    $s = ([string](@($cikti)[0])).Trim()
    if ($s -cmatch '^\d{1,6}$') { return [int]$s }
    return $null
  } catch { return $null }
  finally { $env:PGPASSWORD = ""; $ErrorActionPreference = $eskiEAP }
}
function KurulumKaydiYaz($alanlar) {
  try {
    $kayit = [ordered]@{
      kayitId             = [guid]::NewGuid().ToString()
      tur                 = $alanlar.tur
      tarih               = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
      commit              = $(if ([string]$alanlar.commit -cmatch '^[0-9a-f]{7,40}$') { [string]$alanlar.commit } else { $null })
      paketOzeti          = $(if ([string]$alanlar.paketOzeti -cmatch '^[0-9a-f]{64}$') { [string]$alanlar.paketOzeti } else { $null })
      oncekiSurum         = $alanlar.oncekiSurum
      yeniSurum           = $alanlar.yeniSurum
      migrationSayisi     = $alanlar.migrationSayisi
      yeniMigrationSayisi = $alanlar.yeniMigrationSayisi
      geriDonus           = [ordered]@{
        damga       = $(if ([string]$alanlar.damga -cmatch '^\d{8}_\d{6}$') { [string]$alanlar.damga } else { $null })
        kod         = [bool]$alanlar.kod
        veri        = [bool]$alanlar.veri
        veriSifreli = [bool]$alanlar.veriSifreli
      }
    }
    if (-not $kayit.yeniSurum) { Uyar "kurulum kaydi YAZILMADI: yeni surum okunamadi"; return }
    $satir = $kayit | ConvertTo-Json -Compress -Depth 4
    [System.IO.File]::AppendAllText($gecmisDosyasi, $satir + "`n", (New-Object System.Text.UTF8Encoding $false))
    Ok "kurulum kaydi eklendi: $gecmisDosyasi"
  } catch { Uyar "kurulum kaydi YAZILAMADI: $($_.Exception.Message)" }
}

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

# =============================================================================
# ECOSYSTEM BIRLESTIRME - korumali paket (runtime\node.exe) yukseltmesi
# =============================================================================
# ecosystem.config.js SUNUCUNUNDUR (env blogu: yedek/rclone/PG ayarlari) ve [5/9] onu korur.
# Ama runtime bagi (`interpreter`) olmayan eski dosya korumali paketi SISTEM Node'uyla
# baslatir; yukleyici V8 uyumsuzlugunda reddeder (cikis 78) ve [9/9] migration esigi
# GECILDIKTEN sonra duser (thinkpad-1, 2026-09-30). Bu yuzden runtime tasiyan pakette dosya
# BIRLESTIRILIR: paketin sablonu name/script/cwd/interpreter'in TEK kaynagidir, sunucunun
# diger butun alanlari (env AYNEN) korunur. Karar [2/9]'da, [3/9]'dan ONCE verilir: dosya
# okunamazsa HICBIR SEY degismeden durulur. Korumasiz pakette bu blok hic kosmaz.
# Birlestirici PAKETIN Node'uyla kosar (sunucu Node'u sablonu yanlis surumle degerlendirmesin).
$ecoBirlestirJs = @'
// ecosystem birlestirici - kur.ps1 [2/9] bunu gecici dosyaya yazar ve PAKETIN Node'uyla kosar.
// Karar: sunucunun dosyasi paketin kokunde paketin Node'una BAGLANIYORSA dokunulmaz; yoksa
// paketin sablonu (tek kaynak: name/script/cwd/interpreter) + sunucunun diger BUTUN alanlari.
// stdout'un SON satiri tek satir JSON'dur; hata da oraya yazilir (stderr yonlendirilmez).
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");
const SABLON_ALANLARI = ["name", "script", "cwd", "interpreter", "exec_interpreter"];
function arg(ad) { const i = process.argv.indexOf("--" + ad); return i > 1 ? process.argv[i + 1] : undefined; }
function cik(nesne, kod) {
  const s = JSON.stringify(nesne).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  process.stdout.write("\n" + s + "\n");
  process.exitCode = kod;
}
function yukle(kaynak, sanal) {
  const m = new Module(sanal, null);
  m.filename = sanal;
  m.paths = Module._nodeModulePaths(path.dirname(sanal));
  m._compile(String(kaynak).replace(/^\uFEFF/, ""), sanal);
  return m.exports;
}
function tekUygulama(c, ad) {
  const a = c && Array.isArray(c.apps) && c.apps.length === 1 ? c.apps[0] : null;
  if (!a || typeof a !== "object" || Array.isArray(a)) throw new Error(ad + ": apps tek uygulama tasimiyor");
  return a;
}
function yorumlayici(a) { const y = a.interpreter || a.exec_interpreter; return y ? String(y).replace(/\\/g, "/") : null; }
function goreli(y, kok) {
  const k = String(kok).replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  return y && y.startsWith(k) ? y.slice(k.length) : y;
}
function jsonDuz(d, yol) {
  if (d === null || d === undefined || typeof d === "string" || typeof d === "boolean") return;
  if (typeof d === "number") { if (!Number.isFinite(d)) throw new Error(yol + ": sonlu sayi degil"); return; }
  if (Array.isArray(d)) { d.forEach((x, i) => jsonDuz(x, yol + "[" + i + "]")); return; }
  const p = typeof d === "object" ? Object.getPrototypeOf(d) : undefined;
  if (p === Object.prototype || p === null) { for (const k of Object.keys(d)) jsonDuz(d[k], yol + "." + k); return; }
  throw new Error(yol + ": JSON'a kayipsiz donmeyen deger (" + typeof d + ")");
}
function birlestir(o) {
  const sanalPaket = path.join(o.paketKok, "ecosystem.config.js");
  const beklenen = yorumlayici(tekUygulama(yukle(o.paketKaynak, sanalPaket), "paket sablonu"));
  if (!beklenen) throw new Error("paket sablonu paketin kokunde interpreter uretmiyor (runtime bagi yok)");
  const mevcut = yorumlayici(tekUygulama(yukle(o.sunucuKaynak, sanalPaket), "sunucu dosyasi"));
  if (mevcut === beklenen) return { karar: "DOKUNMA", eski: goreli(mevcut, o.paketKok), yeni: goreli(beklenen, o.paketKok) };
  const sunucu = yukle(o.sunucuKaynak, path.join(o.app, "ecosystem.config.js"));
  const sApp = tekUygulama(sunucu, "sunucu dosyasi");
  const app = {};
  for (const k of Object.keys(sApp)) if (!SABLON_ALANLARI.includes(k) && sApp[k] !== undefined) app[k] = sApp[k];
  const ust = {};
  for (const k of Object.keys(sunucu)) if (k !== "apps" && sunucu[k] !== undefined) ust[k] = sunucu[k];
  jsonDuz(app, "apps[0]");
  jsonDuz(ust, "module.exports");
  const veri = JSON.stringify({ ust, app }, null, 2);
  const metin = String(o.paketKaynak).replace(/^\uFEFF/, "").replace(/\s*$/, "\n") + [
    "",
    "// =============================================================================",
    "// KUR.PS1 BIRLESTIRMESI - ustteki metin PAKETIN sablonudur; " + SABLON_ALANLARI.join("/") + " oradan",
    "// gelir (RUNTIME_NODE: paketin kendi Node'u). Asagidaki nesne sunucunun ONCEKI dosyasinin degerleridir",
    "// (env blogu dahil, kurulum aninda donduruldu; yedek: ecosystem.config.js.onceki). Sunucuya ozgu",
    "// ayar ASAGIDA duzenlenir; bir sonraki kurulum bu dosyaya dokunmaz (bag zaten dogru).",
    "// =============================================================================",
    "module.exports = (function (sablon, sunucu) {",
    "  const s = sablon.apps[0];",
    "  const app = Object.assign({}, sunucu.app);",
    "  for (const k of " + JSON.stringify(SABLON_ALANLARI) + ") {",
    "    if (s[k] !== undefined) app[k] = s[k]; else delete app[k];",
    "  }",
    "  return Object.assign({}, sunucu.ust, { apps: [app] });",
    "})(module.exports, " + veri + ");",
    "",
  ].join("\n");
  return {
    karar: "BIRLESTIR", eski: sApp.interpreter || sApp.exec_interpreter ? yorumlayici(sApp) : null,
    yeni: goreli(beklenen, o.paketKok), envAnahtar: app.env && typeof app.env === "object" ? Object.keys(app.env).length : null, metin,
  };
}
try {
  const r = birlestir({
    sunucuKaynak: fs.readFileSync(arg("sunucu"), "utf8"), paketKaynak: fs.readFileSync(arg("paket"), "utf8"),
    app: arg("app"), paketKok: arg("paket-kok"),
  });
  if (r.metin !== undefined) fs.writeFileSync(arg("cikti"), r.metin, "utf8");
  cik({ karar: r.karar, eski: r.eski, yeni: r.yeni, envAnahtar: r.envAnahtar === undefined ? null : r.envAnahtar }, 0);
} catch (e) {
  cik({ karar: "HATA", hata: String((e && e.message) || e) }, 3);
}
'@

# Karar nesnesi: Karar = DOKUNMA | BIRLESTIR, Bayt = birlesik dosya (yalniz BIRLESTIR).
# Hata FIRLATIR - cagiran [3/9] oncesi Fail eder.
function EcoBirlestirHesapla($nodeExe, $sunucuEco, $paketEco, $hedefApp, $paketKok) {
  $arac  = Join-Path ([System.IO.Path]::GetTempPath()) ("tekserp-eco-birlestir-" + [guid]::NewGuid().ToString("N") + ".cjs")
  $cikti = "$arac.birlesik.js"
  try {
    [System.IO.File]::WriteAllText($arac, $ecoBirlestirJs, (New-Object System.Text.UTF8Encoding $false))
    $satirlar = @(& $nodeExe $arac --sunucu $sunucuEco --paket $paketEco --app $hedefApp --paket-kok $paketKok --cikti $cikti)
    $kod = $LASTEXITCODE
    $r = $null
    if ($satirlar.Count -gt 0) { try { $r = [string]$satirlar[-1] | ConvertFrom-Json } catch { $r = $null } }
    if ($kod -ne 0 -or -not $r -or ([string]$r.karar -ceq "HATA")) {
      $neden = if ($r -and $r.hata) { [string]$r.hata } else { "birlestirici cikis kodu $kod" }
      throw "ecosystem.config.js birlestirilemedi: $neden"
    }
    $bayt = $null
    if ([string]$r.karar -ceq "BIRLESTIR") {
      if (-not (Test-Path $cikti)) { throw "ecosystem.config.js birlestirilemedi: cikti yazilmadi" }
      $bayt = [System.IO.File]::ReadAllBytes($cikti)
    } elseif ([string]$r.karar -cne "DOKUNMA") {
      throw "ecosystem.config.js birlestirilemedi: taninmayan karar '$($r.karar)'"
    }
    return [pscustomobject]@{ Karar = [string]$r.karar; Bayt = $bayt; Eski = $r.eski; Yeni = $r.yeni; EnvAnahtar = $r.envAnahtar }
  } finally {
    Remove-Item -LiteralPath $arac, $cikti -Force -ErrorAction SilentlyContinue
  }
}

# [5/9] yerlestirme: paketinki '.paket' olarak yanda kalir; birlesik yazilacaksa sunucununki
# ONCE '.onceki' olarak yedeklenir (yazim yarida kalsa da ayar app\ icinde durur).
function EcoYerlestir($hedefApp, $sunucuBayt, $birlesikBayt) {
  $ecoHedef = Join-Path $hedefApp "ecosystem.config.js"
  if (Test-Path $ecoHedef) { Copy-Item $ecoHedef "$ecoHedef.paket" -Force }
  if ($birlesikBayt) {
    [System.IO.File]::WriteAllBytes("$ecoHedef.onceki", $sunucuBayt)
    [System.IO.File]::WriteAllBytes($ecoHedef, $birlesikBayt)
  } else {
    [System.IO.File]::WriteAllBytes($ecoHedef, $sunucuBayt)
  }
}

# Dosyanin pm2'ye verecegi yorumlayici (sistem Node'uyla okunur; okunamazsa "?").
function EcoYorumlayici($eco) {
  if (-not (Test-Path $eco)) { return "?" }
  try {
    $y = & node -e "try{const c=require(process.argv[1]);const a=(c.apps||[])[0]||{};process.stdout.write(String(a.interpreter||a.exec_interpreter||'sistem Node'))}catch(e){process.stdout.write('?')}" $eco
    if ($y) { return [string]$y } else { return "?" }
  } catch { return "?" }
}

# -GeriAl simetrisi: birakilan kurulum birlestirme yaptiysa ('.onceki' var) geri alinan kurulumun
# dosyasi o yedekle AYNI olmali (kenara alinan app\ onu tasir). pm2 kaydi cagirida delete+start
# ile yenilenir - `restart` pm2 dokumundeki ESKI yorumlayiciyi korurdu.
function EcoGeriAlOlc($geriApp, $birakilan) {
  $onceki = Join-Path $birakilan "ecosystem.config.js.onceki"
  if (-not (Test-Path $onceki)) { return }
  $eco = Join-Path $geriApp "ecosystem.config.js"
  $a = [System.IO.File]::ReadAllBytes($onceki)
  $b = if (Test-Path $eco) { [System.IO.File]::ReadAllBytes($eco) } else { [byte[]]@() }
  $ayni = ($a.Length -eq $b.Length)
  if ($ayni) { for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { $ayni = $false; break } } }
  if ($ayni) { Ok "ecosystem: birlestirme oncesi dosya geri geldi (yorumlayici: $(EcoYorumlayici $eco))" }
  else { Uyar "ecosystem: geri alinan dosya birlestirme oncesi yedekten FARKLI (baska app.eski secildi?) - yedek: $onceki" }
}

# =============================================================================
# PM2 AD KAPISI - ayni portta IKINCI BACKEND dogmasin (tek-process yasagi)
# =============================================================================
# Silinen/baslatilan ad daima -UygulamaAdi (varsayilan tekserp-backend-yeni); pm2 kaydi baska
# adla calisiyorsa (thinkpad-1: kanal kimligi testfabrika, pm2'de tekserp-backend-yeni) [4/9]
# `delete` hicbir seyi durdurmaz, [8/9] `start` AYNI PORTA ikinci backend dogururdu. Bu yuzden
# [1/9] ve -GeriAl HICBIR SEYE dokunmadan once pm2'deki TeksERP backend'lerini OLCER; ad calisan
# backend'le eslesmiyorsa, liste okunamiyorsa DURUR. Liste diske yazilmaz (env tasir): stdin.
$pm2AdJs = @'
// pm2 ad olcumu - kur.ps1 bunu gecici dosyaya yazar ve sistem Node'uyla kosar; stdin `pm2 jlist` ciktisidir.
// Karar: UYUMLU | ILK | YAN_YANA (uyari) | IHLAL | OLCULEMEDI. stdout'un SON satiri tek satir JSON (ASCII).
"use strict";
const fs = require("fs");
function arg(ad) { const i = process.argv.indexOf("--" + ad); return i > 1 ? String(process.argv[i + 1] || "") : ""; }
function cik(nesne) {
  const s = JSON.stringify(nesne).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  process.stdout.write("\n" + s + "\n");
}
function listeCoz(metin) {
  const satirlar = String(metin).replace(/^\uFEFF/, "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = satirlar.length - 1; i >= 0; i--) {
    if (satirlar[i][0] !== "[") continue;
    try { const v = JSON.parse(satirlar[i]); if (Array.isArray(v)) return v; } catch (e) { /* pm2 log satiri */ }
  }
  return null;
}
function yolDuz(y) { return String(y || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(); }
function ozet(u) {
  const e = (u && u.pm2_env) || {};
  const env = e.env && typeof e.env === "object" ? e.env : {};
  const port = String(env.PORT || e.PORT || "");
  return { ad: String((u && u.name) || ""), durum: String(e.status || "?"), cwd: String(e.pm_cwd || ""),
    betik: String(e.pm_exec_path || ""), port: /^\d+$/.test(port) ? port : "" };
}
function backendMi(x) { return /(^|[\\/])dist[\\/]server\.js$/i.test(x.betik) || /^tekserp-backend/i.test(x.ad); }
function tarif(x) { return "'" + x.ad + "' (" + x.durum + (x.port ? ", port " + x.port : "") + ", " + (x.cwd || "?") + ")"; }
function karar(o) {
  if (!/^[A-Za-z0-9._-]{2,60}$/.test(o.ad)) return { karar: "IHLAL", neden: "pm2 adi gecersiz ya da bos: '" + o.ad + "'" };
  const l = listeCoz(o.jlist);
  if (l === null) return { karar: "OLCULEMEDI", neden: "pm2 listesi (pm2 jlist) okunamadi - hangi backend'in calistigi bilinmeden kurulum yapilmaz" };
  const b = l.map(ozet).filter(backendMi);
  const app = yolDuz(o.app);
  const ayniKok = (x) => app !== "" && yolDuz(x.cwd) === app;
  const calisan = b.filter((x) => x.durum === "online");
  if (b.some((x) => x.ad === o.ad)) {
    const diger = calisan.filter((x) => x.ad !== o.ad && (ayniKok(x) || (o.port !== "" && x.port === o.port)));
    if (diger.length) return { karar: "IHLAL", neden: "Sunucuda " + diger.map(tarif).join(", ") + " de calisiyor - '" + o.ad + "' ile ayni kurulumda/portta IKINCI backend. Once fazlasini durdur: pm2 delete <ad>" };
    return { karar: "UYUMLU" };
  }
  if (b.length === 0) return { karar: "ILK" };
  const kok = b.filter(ayniKok);
  if (kok.length) return { karar: "IHLAL", neden: "Sunucuda " + kok.map(tarif).join(", ") + " kayitli - bu kurulumun backend'i; '" + o.ad + "' adiyla kurmak AYNI PORTTA IKINCI BACKEND dogurur. -UygulamaAdi " + kok[0].ad + " verin" };
  if (calisan.length && !o.acik) return { karar: "IHLAL", neden: "Sunucuda " + calisan.map(tarif).join(", ") + " calisiyor; varsayilan ad '" + o.ad + "' onunla eslesmiyor. Bu kurulumun backend'iyse -UygulamaAdi " + calisan[0].ad + " verin; bilerek YAN YANA kurulumsa -UygulamaAdi <yeni-ad> ve farkli PORT ile kos" };
  const cakisan = calisan.filter((x) => o.port === "" || x.port === "" || x.port === o.port);
  if (cakisan.length) return { karar: "IHLAL", neden: "Sunucuda " + cakisan.map(tarif).join(", ") + " calisiyor ve port ayriligi yok ya da OLCULEMEDI (bu kurulum: " + (o.port || "?") + ") - '" + o.ad + "' AYNI PORTTA IKINCI BACKEND olur. Yan yana kurulum farkli PORT ister (ecosystem.config.js env.PORT)" };
  return { karar: "YAN_YANA", neden: "pm2'de baska TeksERP backend'i var: " + b.map(tarif).join(", ") + " - '" + o.ad + "' YAN YANA kurulacak (baska kok" + (o.port ? ", port " + o.port : "") + ")" };
}
try {
  const port = arg("port");
  cik(karar({ jlist: fs.readFileSync(0, "utf8"), ad: arg("ad"), app: arg("app"), port: /^\d+$/.test(port) ? port : "", acik: arg("acik") === "1" }));
} catch (e) {
  cik({ karar: "OLCULEMEDI", neden: "pm2 ad olcumu dustu: " + String((e && e.message) || e) });
}
'@

# ecosystem dosyasinin env.PORT'u (sistem Node'uyla okunur); okunamazsa "" = olculemedi.
function EcoPortu($eco) {
  if (-not (Test-Path $eco)) { return "" }
  try {
    $p = & node -e "try{const c=require(process.argv[1]);process.stdout.write(String(c.apps?.[0]?.env?.PORT??''))}catch(e){}" $eco
    if ([string]$p -cmatch '^\d+$') { return [string]$p }
  } catch { }
  return ""
}

# Karar UYUMLU / ILK -> gec · YAN_YANA -> uyar · IHLAL / OLCULEMEDI / cevapsiz -> Fail.
function Pm2AdiDogrula($port) {
  if (-not (Test-Path $pm2)) { Fail "pm2 bulunamadi: $pm2 - once ilk-kurulum.ps1." }
  $arac = Join-Path ([System.IO.Path]::GetTempPath()) ("tekserp-pm2-ad-" + [guid]::NewGuid().ToString("N") + ".cjs")
  $acikArg = if ($adAcik) { "1" } else { "0" }
  $eskiEAP = $ErrorActionPreference
  $eskiKodlama = $OutputEncoding
  $satirlar = @()
  try {
    [System.IO.File]::WriteAllText($arac, $pm2AdJs, (New-Object System.Text.UTF8Encoding $false))
    $ErrorActionPreference = "Continue"
    $liste = (@(& $pm2 jlist) -join "`n")
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $satirlar = @($liste | & node $arac --ad $uygulama --app $appDir --port "$port" --acik $acikArg)
  } finally {
    $ErrorActionPreference = $eskiEAP
    $OutputEncoding = $eskiKodlama
    Remove-Item -LiteralPath $arac -Force -ErrorAction SilentlyContinue
  }
  $r = $null
  if ($satirlar.Count -gt 0) { try { $r = [string]$satirlar[-1] | ConvertFrom-Json } catch { $r = $null } }
  if (-not $r) { Fail "pm2 uygulama adi OLCULEMEDI (olcum araci cevap vermedi) - hangi backend'in calistigi bilinmeden kurulum yapilmaz." }
  $karar = [string]$r.karar
  if ($karar -ceq "UYUMLU") { Ok "pm2: '$uygulama' bu kurulumun backend'i" }
  elseif ($karar -ceq "ILK") { Ok "pm2: kayitli TeksERP backend'i yok - '$uygulama' ilk kez baslatilacak" }
  elseif ($karar -ceq "YAN_YANA") { Uyar ([string]$r.neden) }
  else { Fail "pm2 ad kapisi ($karar): $([string]$r.neden)" }
}

# --- Yonetici kontrolu ------------------------------------------------------
$admin = (New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Fail "YONETICI PowerShell gerekir (pm2 daemon SYSTEM olarak kosuyor: EPERM \\.\pipe\rpc.sock)." }

# --- Uzaktan (SSH) kosum -----------------------------------------------------
# Daemon yoksa bu kosum onu SSH oturumunun icinde dogurur ve oturumla birlikte olur;
# SYSTEM'e ait daemon (acilis gorevi / uzaktan-kos) oturumdan bagimsizdir. Uc sonuc:
# bagimsiz -> gec · yok -> DUR · olculemedi / baska hesap -> uyar.
if ($env:SSH_CONNECTION -or $env:SSH_CLIENT) {
  $daemon = $null
  try {
    $daemon = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop |
                Where-Object { $_.CommandLine -match 'pm2[\\/]lib[\\/]Daemon\.js' })
  } catch { $daemon = $null }
  if ($null -eq $daemon) {
    Uyar "SSH oturumu: pm2 daemon'u OLCULEMEDI - oturum kapaninca backend durabilir (DEPLOY-RUNBOOK 3b)."
  } elseif ($daemon.Count -eq 0) {
    if (-not $SshKabul) {
      Fail "SSH oturumu ve pm2 daemon YOK: daemon bu oturumda dogar ve oturum kapaninca backend OLUR. SYSTEM gorevi olarak kos: uzaktan-kos.ps1 -Betik <kur.ps1> -Argumanlar '... -Zorla' (DEPLOY-RUNBOOK 3b). Bilerek devam: -SshKabul"
    }
    Uyar "-SshKabul: daemon bu oturumda dogacak - oturumu kapatmadan once 'Start-ScheduledTask TeksERP-Backend-Boot' ya da yeniden baslatma."
  } else {
    $sahip = ""
    try { $sahip = "$((Invoke-CimMethod -InputObject $daemon[0] -MethodName GetOwner -ErrorAction Stop).User)" } catch { }
    if ($sahip -eq "SYSTEM") { Ok "SSH oturumu: pm2 daemon SYSTEM'de (PID $($daemon[0].ProcessId)) - oturumdan bagimsiz" }
    else { Uyar "SSH oturumu: pm2 daemon '$(if ($sahip) { $sahip } else { '?' })' hesabinda (PID $($daemon[0].ProcessId)) - bu oturumda dogduysa oturumla gider." }
  }
}

# =============================================================================
# SIFRELI PREMIGRATE YEDEGINI COZ (-GeriAl sonunda) - veri geri donusu icin
# =============================================================================
# Kod geri alinir, DB alinmaz (yukarida). Veri de geri donecekse en yeni premigrate_
# yedegi SIFRELIYSE once duz kopyaya cozulur: yedek parolasi ARACIN KENDISI tarafindan
# terminalde gizli sorulur - argv'ye, gecmise, loga GIRMEZ. Arac geri alinan eski
# surumde olmayabilir: once app\, sonra kenara alinan app.basarisiz-* denenir.
function PremigrateCoz {
  $son = Get-ChildItem $backupDir -File -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -match '^premigrate_.*\.dump(\.tkenc)?$' } |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $son -or $son.Name -notlike "*.tkenc") { return }
  $duz = Join-Path $backupDir (($son.Name -replace '\.tkenc$', '') + ".coz-geri.part")
  $araclar = @("$appDir\dist\tools\yedek-sifrele.cjs") + @(Get-ChildItem "$kok\app.basarisiz-*" -Directory -ErrorAction SilentlyContinue |
               Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName "dist\tools\yedek-sifrele.cjs" })
  $arac = $araclar | Where-Object { Test-Path $_ } | Select-Object -First 1
  Write-Host ""
  Uyar "Son premigrate yedegi SIFRELI: $($son.Name)"
  if (-not $arac) { Uyar "yedek-sifrele araci bulunamadi - musteri anahtariyla baska makinede coz (runbook: YEDEK-SIFRELEME)."; return }
  $komut = "node `"$arac`" coz --girdi `"$($son.FullName)`" --cikti `"$duz`" --anahtar-dizini `"$anahtarDizini`""
  if ($Zorla -or [Console]::IsInputRedirected) { Write-Host "  Cozmek icin (parola terminalde sorulur): $komut"; return }
  if ((Read-Host "  Veri geri donusu icin simdi cozulsun mu? Yedek parolasi sorulur (e/h)") -ne 'e') { Write-Host "  Sonra cozmek icin: $komut"; return }
  & node $arac coz --girdi $son.FullName --cikti $duz --anahtar-dizini $anahtarDizini
  if ($LASTEXITCODE -eq 0 -and (Test-Path $duz)) {
    Ok "cozuldu: $duz"
    Write-Host "  Geri yukleme (backend DURDURULMUS, yonetici pencere): pg_restore -h localhost -p <port> -U <kullanici> -d <db> --clean --if-exists `"$duz`""
    Write-Host "  Bitince DUZ kopyayi sil: Remove-Item `"$duz`""
  } else {
    Uyar "cozulemedi (kod $LASTEXITCODE) - parola/anahtar. Musteri anahtariyla: node `"$arac`" coz --girdi `"$($son.FullName)`" --cikti `"$duz`" --anahtar <musteri.tksec>"
  }
}

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
  # pm2 ad kapisi: hicbir seye dokunmadan ONCE (port geri donulecek surumun dosyasindan).
  Pm2AdiDogrula (EcoPortu (Join-Path $hedef "ecosystem.config.js"))
  Write-Host ""
  Write-Host "GERI ALMA: $hedef  ->  $appDir" -ForegroundColor Yellow
  if (-not $Zorla) { if ((Read-Host "Devam? (e/h)") -ne 'e') { Fail "Iptal." } }

  Pm2Kos delete $uygulama | Out-Null
  $damga = Get-Date -Format "yyyyMMdd_HHmmss"
  try {
    if (Test-Path $appDir) { TasiIsrarla $appDir "$kok\app.basarisiz-$damga" }
    TasiIsrarla $hedef $appDir
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
  # Simetri: birlestirilmis dosyanin yerine birlestirme ONCESI dosya geri gelir (olculur) ve pm2
  # kaydi yukaridaki delete + asagidaki start ile ONUN yorumlayicisiyla yenilenir (restart DEGIL).
  EcoGeriAlOlc $appDir "$kok\app.basarisiz-$damga"
  Push-Location $appDir
  & $pm2 start ecosystem.config.js
  & $pm2 save
  Pop-Location
  $h = Saglik 90
  if ($h) { Ok "Geri alindi. API $($h.status) / DB $($h.db) / v$($h.version)" }
  else { Fail "Geri alindi ama /health cevap vermedi. Bak: $pm2 logs $uygulama" }
  KurulumKaydiYaz @{ tur = "GERI_ALMA"; oncekiSurum = (PaketSurumu "$kok\app.basarisiz-$damga"); yeniSurum = (PaketSurumu $appDir); migrationSayisi = (MigrationSayisi $appDir) }
  Write-Host ""
  Uyar "DB migration'lari GERI ALINMADI. Eski kod yeni semayla kosuyor."
  Uyar "Uyumsuzluk varsa yedekten restore gerekir: $backupDir"
  PremigrateCoz
  exit 0
}

if (-not $Paket) { Fail "Paket yolu gerekli:  kur.ps1 -Paket <zip>   (veya -GeriAl)" }
if (-not (Test-Path $Paket)) { Fail "Paket bulunamadi: $Paket" }
# Kurulum kaydi icin paket ozeti SIMDI (cwd sonra degisir; goreli yol kaybolur).
$paketOzeti = $null
try { $paketOzeti = (Get-FileHash $Paket -Algorithm SHA256).Hash.ToLowerInvariant() } catch { Uyar "paket ozeti olculemedi: $($_.Exception.Message)" }

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
  Write-Host "  uretim          : $($m.uretimZamani)  /  derleme $($m.derlemeKimligi)"
  Write-Host "  migration       : $($m.migrationSayisi)"
  Write-Host "  node_modules    : $(if ($m.nodeModulesDahil) {'pakette DAHIL'} else {'YOK - npm ci kosulacak'})"
  if (-not $m.calismaAgaciTemiz) { Uyar "Paket KIRLI calisma agacindan uretilmis (commit'lenmemis degisiklik icerir)." }
  if ($m.prova) {
    if (-not $ProvaKabul) {
      Fail "Bu bir PROVA paketi (PAKET.json prova=true: etiketsiz, surum belgesiz). Fabrikaya KURULMAZ. Prova makinesindeysen -ProvaKabul ver."
    }
    Uyar "PROVA PAKETI kuruluyor (-ProvaKabul) - surum: $($m.uygulamaSurumu)"
  }
  # Kanal kimligi (paketle.ps1 -Musteri) pm2 adini tasir; kurulum adi DEGISTIRMEZ (calisan
  # uygulamayi yetim birakirdi) - yalniz soyler. Silinen/baslatilan ad daima -UygulamaAdi.
  if (($m.PSObject.Properties.Name -contains 'backendPm2Ad') -and $m.backendPm2Ad -and ([string]$m.backendPm2Ad -cne $uygulama)) {
    Uyar "Paketin kanal kimligi pm2 adi '$($m.backendPm2Ad)', bu kurulum '$uygulama' (-UygulamaAdi). Yalniz '$uygulama' silinip baslatilir."
  }
} else { Uyar "PAKET.json yok - eski surum paket." }

# pm2 ad kapisi (hicbir seye dokunmadan once). Port [5/9]'un koruyacagi sunucu dosyasindan, yoksa paketinkinden.
$ecoPortKaynak = if (Test-Path "$appDir\ecosystem.config.js") { "$appDir\ecosystem.config.js" } else { "$temp\ecosystem.config.js" }
Pm2AdiDogrula (EcoPortu $ecoPortKaynak)

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
$nodeSurum = (& node --version) -creplace '^v',''
$nodeMajor = [int](($nodeSurum -csplit '\.')[0])
$paketJson = Get-Content (Join-Path $temp "package.json") -Raw | ConvertFrom-Json
# Zemin MAJOR.MINOR olculur: lisans yoklamasinin proxy destegi Node 22.21+/24.5+ ister;
# yalniz major karsilastirmak 22.5'i gecirirdi (proxy ayari SESSIZCE yok sayilirdi).
$zemin = [version]"22.0"
if ($paketJson.engines -and $paketJson.engines.node -cmatch '(\d+)(?:\.(\d+))?') {
  $zeminMinor = if ($Matches[2]) { $Matches[2] } else { "0" }
  $zemin = [version]("{0}.{1}" -f $Matches[1], $zeminMinor)
}
$nodeSurumV = [version](($nodeSurum -csplit '[-+]')[0])
if ($nodeSurumV -lt $zemin) {
  Fail "Node $nodeSurum bu paket icin COK ESKI (en az $zemin gerekiyor). Once Node'u yukseltin."
}
Ok "node $nodeSurum (zemin: >=$zemin)"
if ($m -and $m.nodeSurumu) {
  $ureticiMajor = [int](($m.nodeSurumu -replace '^v','' -split '\.')[0])
  if ($nodeMajor -lt $ureticiMajor) {
    Uyar "Paket Node $($m.nodeSurumu) ile uretildi, bu sunucuda Node $nodeSurum var - daha ESKI. Sorun cikarsa ilk buraya bakin."
  }
}

# --- Paketin KENDI Node'u (KORUMALI PAKET, Faz 2b) --------------------------
# Korumali paket `dist\server.jsc` (V8 bayt kodu) tasir; bayt kodu paketi ureten
# Node'un V8 surumune KILITLIDIR. O yuzden paket yaninda `runtime\node.exe`
# getirir ve pm2 uygulamayi ONUNLA baslatir (ecosystem.config.js `interpreter`).
# Sistem Node'u (baska surum) .jsc'yi V8 ONBELLEK REDDIYLE reddederdi.
#
# ⚠ GERIYE UYUM: `runtime\node.exe` YOKSA bu ESKI PAKET BICIMIDIR (duz
#   dist\server.js) - uygulama yukaridaki sistem Node'uyla kosmaya devam eder,
#   davranis DEGISMEZ. Yeni bicim yalniz `runtime\` varsa devreye girer.
$runtimeExe = Join-Path $temp "runtime\node.exe"
$paketRuntime = $null   # yalniz dogrulanmis runtime: ecosystem birlestirmesi [2/9] bunu bekler
if (Test-Path $runtimeExe) {
  # MZ imzasi: yarim inen / bozuk ikili "var" gorunur ama backend acilamaz.
  $rtImza = [System.IO.File]::ReadAllBytes($runtimeExe)[0..1]
  if ($rtImza[0] -ne 0x4D -or $rtImza[1] -ne 0x5A) {
    Fail "runtime\node.exe Windows ikilisi DEGIL (MZ imzasi yok) - paketleme yarim kalmis. Backend bu Node'la acilamaz."
  }
  $rtSurum = (& $runtimeExe --version) -creplace '^v',''
  # Manifest paketin node surumunu beyan eder; runtime\node.exe onunla BIREBIR olmali,
  # yoksa .jsc bayt kodu bu ikilide acilmaz (V8 uyumsuzlugu -> acik hata iyi ki [1/9]'da).
  $beklenenRt = if ($m -and $m.PSObject.Properties.Name -contains 'runtimeNodeSurumu' -and $m.runtimeNodeSurumu) { ($m.runtimeNodeSurumu -creplace '^v','') } else { $null }
  if ($beklenenRt -and ($rtSurum -cne $beklenenRt)) {
    Fail "Paketin runtime\node.exe surumu $rtSurum, manifest $beklenenRt bekliyor - .jsc bayt kodu bu ikilide acilmaz. Paket bozuk."
  }
  Ok "paket kendi Node'unu tasiyor: runtime\node.exe v$rtSurum (uygulama BUNUNLA kosar - .jsc uyumu)"
  $paketRuntime = $runtimeExe
  # Bu paket bayt kodu tasiyorsa (dist\server.jsc) dist\server.js yalniz yukleyicidir;
  # yukleyici acmadan ONCE process.versions.v8'i manifestteki v8Taban ile de kiyaslar (build-korumali).
  if (Test-Path (Join-Path $temp "dist\server.jsc")) {
    Ok "paket korumali (dist\server.jsc bayt kodu) - dist\server.js yukleyici"
  }
  # Faz 2e: korumali paket IMZALI yuk (butunluk.jws) + onun ozetine bagli dosya listesi
  # (butunluk-liste.txt) + native lisans cekirdegi tasir. Imzasiz korumali paket KURULMAZ: acilista
  # butunluk GECERSIZ (BUTUNLUK_LISTE_YOK / _LISTE_BOZUK) ve native cekirdek yuklenmez -> lisans
  # merdiveni. Imza satici Mac'inde atilir.
  if ($m -and $m.korumali) {
    if (-not (Test-Path (Join-Path $temp "butunluk.jws"))) {
      Fail "Korumali paket IMZASIZ (butunluk.jws yok). Satici Mac'inde imzala: npx tsx Teks-Erp/scripts/build-korumali-imza.ts zip --zip=<paket> --anahtar=<PAKET anahtari>"
    }
    if (-not (Test-Path (Join-Path $temp "butunluk-liste.txt"))) {
      Fail "Korumali paketin dosya listesi yok (butunluk-liste.txt) - imza yarim kalmis; paketi yeniden imzala."
    }
    if (-not (Get-ChildItem (Join-Path $temp "native") -Filter "lisans-cekirdek.*.node" -File -ErrorAction SilentlyContinue)) {
      Fail "Korumali paket native lisans cekirdegini (native\lisans-cekirdek.*.node) tasimiyor - paket bozuk."
    }
    Ok "paket imzali dosya listesi tasiyor (butunluk.jws, anahtar $($m.butunlukKid)) + native lisans cekirdegi"
  }
} else {
  Write-Host "  . paket kendi Node'unu tasimiyor (eski bicim) - uygulama sistem Node'uyla kosar" -ForegroundColor DarkGray
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
# Sir %TEMP%'e YAZILMAZ: kopya orada kalir (kosum dusse de, bitse de) ve dosya
# kullanicinin TEMP ACL'ini tasir. Bellekte tutulur; geri donus kaynagi zaten
# `app.eski-*\.env`dir.
$envBayt = [System.IO.File]::ReadAllBytes($envKaynak)

# ecosystem.config.js SUNUCUNUNDUR, paketin degil (denetim 2026-08-29, BULGU-T1-020).
# Icinde .env'de olmayan OPERASYONEL ayarlar yasar: BACKUP_SCHEDULE_ENABLED,
# BACKUP_DIR, BACKUP_RETENTION_DAYS, BACKUP_RCLONE_REMOTE/BIN/CONFIG, BACKUP_HOUR,
# PG_BIN_DIR, DISCOVERY_MDNS_ENABLED. Paketteki dosya REPO varsayilanlarini tasir
# (offsite bos, scheduler acik) -> her kurulum sahadaki ayari sessizce geri aliyordu:
# gece yedegi ve makine disi kopya, guncelleme yapilan gece KAPANIYORDU.
# Tek istisna runtime tasiyan (korumali) paket: dosya korunur ama paketin Node'una BAGLANIR
# (ECOSYSTEM BIRLESTIRME blogu) - env ve diger ayarlar yine sunucunun.
$ecoKaynak = Join-Path $mevcut "ecosystem.config.js"
$ecoBayt   = $null
if (Test-Path $ecoKaynak) { $ecoBayt = [System.IO.File]::ReadAllBytes($ecoKaynak) }
Ok "mevcut: $mevcut   |  .env + ecosystem.config.js kenara alindi"
# Korumali paket: sunucunun dosyasi paketin Node'una bagli degilse BIRLESTIRILIR (blok basligi).
# Karar SIMDI - [3/9]'dan ve pm2 durdurmadan ONCE; okunamayan dosyada hicbir sey degismeden durulur.
$ecoPlan = $null
$ecoBirlesikBayt = $null
if ($paketRuntime -and $ecoBayt) {
  try {
    $ecoPlan = EcoBirlestirHesapla $paketRuntime $ecoKaynak (Join-Path $temp "ecosystem.config.js") $appDir $temp
  } catch {
    Fail "$($_.Exception.Message) - HICBIR SEY DEGISMEDI. Korumali paket sunucunun ecosystem.config.js'ine paketin Node'unu baglamadan kurulmaz; dosyayi duzeltip tekrar kosun."
  }
  if ($ecoPlan.Karar -ceq "BIRLESTIR") {
    $ecoBirlesikBayt = $ecoPlan.Bayt
    $eskiY = if ($ecoPlan.Eski) { $ecoPlan.Eski } else { "sistem Node" }
    $envNot = if ($null -ne $ecoPlan.EnvAnahtar) { "env $($ecoPlan.EnvAnahtar) anahtar AYNEN" } else { "env blogu yoktu, eklenmez" }
    Ok "ecosystem.config.js BIRLESTIRILECEK: yorumlayici $eskiY -> $($ecoPlan.Yeni) (paketin sablonundan) | sunucu ayarlari korunur ($envNot) | yedek: ecosystem.config.js.onceki"
  } else {
    Ok "ecosystem.config.js zaten paketin Node'una bagli ($($ecoPlan.Yeni)) - DOKUNULMAYACAK"
  }
}

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
# Sifreleme (anahtar dizininde alici varsa): gece yedegiyle ayni arac ve kural. Sifreleme
# duserse kurulum DURMAZ - migration oncesi dogrulanmis bir geri donus noktasi sifresizden
# iyidir; duz dosya yerel kalir, offsite supurucusu sifreleme niyetinde onu kopyalamaz.
if ((Test-Path $anahtarDizini) -and @(Get-ChildItem $anahtarDizini -Filter "*.tkpub" -File -ErrorAction SilentlyContinue).Count -gt 0) {
  $sifreArac = "$temp\dist\tools\yedek-sifrele.cjs"
  if (-not (Test-Path $sifreArac)) {
    Uyar "yedek-sifrele araci pakette yok - premigrate yedegi DUZ kaldi: $dump"
  } else {
    & node $sifreArac sifrele --girdi $dump --anahtar-dizini $anahtarDizini --duzu-sil
    if ($LASTEXITCODE -eq 0 -and (Test-Path "$dump.tkenc") -and -not (Test-Path $dump)) { $dump = "$dump.tkenc" }
    else { Uyar "premigrate yedegi SIFRELENEMEDI (kod $LASTEXITCODE) - DUZ kaldi: $dump" }
  }
}
Ok "$([System.IO.Path]::GetFileName($dump))  ($([math]::Round((Get-Item $dump).Length/1MB,2)) MB) - dogrulandi, rotasyon disi"

# --- [4/9] Uygulamayi durdur ------------------------------------------------
Adim "[4/9] pm2 uygulamasi durduruluyor..."
# ⚠ `pm2 delete <kayitli-olmayan-uygulama>` stderr'e "Process or Namespace not
#   found" yazar ve bu satir EKRANA DUSER (stderr YONLENDIRILEMEZ - PowerShell
#   5.1'de olumcul olur, bkz. `Pm2Kos` basligi). ILK kurulumda ve pm2 kaydi
#   dusmus bir sunucuda bu NORMALDIR: silinecek bir sey yoktur.
#   Operator o satiri hata sanmasin diye cikis kodu okunup ADIYLA aciklanir.
$silKod = Pm2Kos delete $uygulama   # delete: ecosystem env blogu degismis olabilir
if ($silKod -ne 0) {
  Write-Host "     (pm2'de kayitli '$uygulama' yoktu - yukaridaki 'not found' satiri BEKLENEN, hata degil)" -ForegroundColor DarkGray
}
# pm2 komutu donunce surec HENUZ olmemis olabilir; tanitici birakilsin diye kisa
# bir yatisma. Tek basina YETMEZ (yaris suresi degisken) - asil sed [5/9]'daki
# `TasiIsrarla`. Bu bekleme yalnizca ilk denemenin dusme olasiligini dusurur.
Start-Sleep -Milliseconds 1200
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
    TasiIsrarla $eskiAd $appDir
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
  TasiIsrarla $mevcut $eskiAd
  # Ilk gecis sonrasi C:\...\tekserp\ kabugu (icinde .git) geride kalir;
  # BILEREK silinmez - geri donus tamamlanana kadar dursun (sonda hatirlatilir).
  New-Item -ItemType Directory -Path $appDir | Out-Null
  Copy-Item "$temp\*" $appDir -Recurse -Force
  [System.IO.File]::WriteAllBytes((Join-Path $appDir ".env"), $envBayt)
  # Sunucunun ecosystem'i KORUNUR; paketinki yanina '.paket' olarak birakilir.
  # Prompt YOK (kurulum -Zorla ile otomatik kosabiliyor) - fark EKRANA basilir,
  # karar operatorde kalir. Yeni ayar geldiyse .paket dosyasindan elle alinir.
  # Korumali pakette [2/9] BIRLESTIR dediyse sunucunun degerleriyle birlesik dosya yazilir.
  if ($ecoBayt) { EcoYerlestir $appDir $ecoBayt $ecoBirlesikBayt }
} catch { GeriAlOtomatik "Dosya yerlestirme basarisiz: $($_.Exception.Message)" }
SirIzniDaralt (Join-Path $appDir ".env")
LisansDiziniKur $lisansDizini
# Yedekler ve kimlik dosyasi bu surumde DEGISTIRILMEZ (canli sunucuda o klasoru okuyan
# baska bir sey olabilir); genis erisim yalniz SOYLENIR - daraltma ilk-kurulum.ps1'in isi.
foreach ($y in @($backupDir, (Split-Path $credFile -Parent))) {
  $g = GenisErisim $y
  if ($g -and $g.Count) {
    Uyar "$y herkese acik ($(@($g | Sort-Object -Unique) -join ', ')) - yedek/kimlik fabrika verisi tasir."
    Uyar "  -> daraltmak icin: powershell -NoProfile -ExecutionPolicy Bypass -File <paket>\ilk-kurulum.ps1 ... (idempotent; izin adimi)"
  }
}

# Emekli anahtarlar (2026-09-30, B6): paket web panelini TASIMAZ ve uzaktan erisim tuneli kalkti.
# Eski .env'deki WEB_DIST_DIR var olmayan klasoru gosterir, kok (/) durum sayfasi olur - SOYLENIR (.env'e dokunulmaz).
$envMetin = [System.Text.Encoding]::UTF8.GetString($envBayt).TrimStart([char]0xFEFF)   # 5.1 Set-Content BOM yazar
foreach ($emekli in @('WEB_DIST_DIR', 'REMOTE_PORT', 'CF_ACCESS_ENABLED', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD')) {
  if ([regex]::IsMatch($envMetin, "(?m)^\s*$emekli\s*=")) {
    Uyar "$emekli emekli (fabrika web paneli + uzaktan erisim tuneli kaldirildi) - satiri .env'den silin."
  }
}
# Panel yedegi / DB kopyasi super kullanici istemez; postgres parolasi .env'de ise soylenir (dokunulmaz).
$bk = [regex]::Match($envMetin, '(?m)^\s*BACKUP_PG_USER\s*=\s*"?([^"\r\n]*)"?')
if ($bk.Success -and $bk.Groups[1].Value.Trim() -ceq "postgres") {
  Write-Host "     (BACKUP_PG_USER=postgres: super kullanici parolasi .env'de. Super OLMAYAN bakim rolune gecis: <paket>\bakim-rolu.ps1 -Kok `"$kok`")" -ForegroundColor DarkGray
}
if ($ecoBayt) {
  Ok "app\ olusturuldu, .env + ecosystem.config.js ($(if ($ecoBirlesikBayt) { 'BIRLESIK: paketin sablonu + sunucunun ayarlari' } else { 'SUNUCUNUNKI' })) tasindi"
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
    # Birlesik dosya sablonun metnini tasir; sunucunun anahtarlari yedekten okunur.
    $sunucu = & $anahtar $(if ($ecoBirlesikBayt) { "$ecoHedef.onceki" } else { $ecoHedef })
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
      # Birlesik dosya sunucununki DEGILDIR: "KORUNDU" demek operatoru yaniltir.
      if ($ecoBirlesikBayt) {
        Write-Host "  ecosystem.config.js: BIRLESTIRILDI (paketin sablonu + sunucunun ayarlari; paketinki: ecosystem.config.js.paket, onceki: ecosystem.config.js.onceki)" -ForegroundColor Yellow
      } else {
        Write-Host "  ecosystem.config.js: sunucununki KORUNDU (paketinki: ecosystem.config.js.paket)" -ForegroundColor Yellow
      }
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
  # `npm.cmd`: cipla `npm` once `npm.ps1`e cozulur ve yurutme ilkesine takilir.
  & npm.cmd ci --omit=dev --no-audit --no-fund
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
$dbMigOnce = DbMigrationSayisi $pgbin $cred $dbKul $dbPar
& node $prismaCli migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  X MIGRATION BASARISIZ" -ForegroundColor Red
  Write-Host "    DB kismi degismis OLABILIR. Otomatik geri alinmiyor - karar senin." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "    Durumu gor :  cd $appDir ; node node_modules\prisma\build\index.js migrate status"
  Write-Host "    Kodu geri al:  $kurKomut -GeriAl"
  Write-Host "    DB'yi geri al: pg_restore ... $dump   (KURULUM dokumanina bak)"
  if ($dump -like "*.tkenc") {
    Write-Host "    (yedek SIFRELI - once coz, parola terminalde sorulur:"
    Write-Host "     node `"$appDir\dist\tools\yedek-sifrele.cjs`" coz --girdi `"$dump`" --cikti `"$($dump -replace '\.tkenc$','').coz-elle.part`" --anahtar-dizini `"$anahtarDizini`")"
  }
  KokeDon
  exit 1
}
$dbMigSonra = DbMigrationSayisi $pgbin $cred $dbKul $dbPar
$dbMigUygulanan = $(if ($null -ne $dbMigOnce -and $null -ne $dbMigSonra -and $dbMigSonra -ge $dbMigOnce) { $dbMigSonra - $dbMigOnce } else { $null })
Ok "migration'lar uygulandi (bu kurulumda DB'ye uygulanan: $(if ($null -ne $dbMigUygulanan) { $dbMigUygulanan } else { 'OLCULEMEDI' }))"

# --- [8/9] pm2 --------------------------------------------------------------
Adim "[8/9] pm2 baslatiliyor..."
# ⚠ ADI BURADA VERIYORUZ (2026-09-07). `ecosystem.config.js` adi bu env'den okur;
#   verilmezse dosyadaki varsayilan gecerli olur. Boylece [4/9]'un SILDIGI ad ile
#   [8/9]'un BASLATTIGI ad YAPISAL OLARAK ayni olur — eskiden ad dosyada sabitti
#   ve ikisi ayrisinca ayni porta ikinci uygulama kalkiyordu.
$env:TEKSERP_PM2_AD = $uygulama
if ($ecoPlan -and $ecoPlan.Karar -ceq "BIRLESTIR") {
  # Yorumlayici DEGISTI: pm2 onu kendi dokumunde saklar; kayit yasarsa `start` onu RESTART
  # eder ve ESKI yorumlayiciyla acar. [4/9] silmisti - kayit geri dogmussa yalniz BU uygulama
  # yeniden silinir ("not found" BEKLENEN).
  Pm2Kos delete $uygulama | Out-Null
}
& $pm2 start ecosystem.config.js
if ($LASTEXITCODE -ne 0) { Fail "pm2 start basarisiz. Geri donus: $kurKomut -GeriAl" }
& $pm2 save    # ZORUNLU: reboot'ta dogru klasor kalksin (dump.pm2 tazelenir)
Ok "baslatildi ve kaydedildi (pm2 save)"

# --- Log rotasyonu: pm2-logrotate -------------------------------------------
# pm2 log dosyasini KENDISI DONDURMEZ (ecosystem.fabrika.js basliginda da yazili).
# Modul kurulmazsa `logs\backend-out-0.log` sinirsiz buyur.
#
# OLCULDU (2026-09-06, fabrika): eski kurulumda tek dosya 5 haftada 57 MB
# olmustu. Disk tehlikesi degil (221 GB bostu, ~5 MB/gun) ama dosya PRATIKTE
# ACILAMAZ hale gelir - "gecen sali ne oldu" sorusunun cevabi icindeydi ve
# ulasilamiyordu. NSSM bunu kendisi yapiyordu; pm2'ye gecerken kayboldu ve
# yalniz kontrol listesinde kaldi, yani BIR INSANIN hatirlamasina bagliydi.
# Burada olmasinin sebebi bu: `kur.ps1` HER surumde kosar, `ilk-kurulum.ps1`
# yalnizca bir kez - sahadaki mevcut kurulumlar da ilk guncellemede duzelir.
#
# Idempotent: `pm2 install` kurulu modulu gunceller, mukerrer kurulum yapmaz.
# Fail DEGIL: internet yoksa surum yine cikmali - rotasyonsuz calismak hic
# calismamaktan iyidir (mDNS firewall kuralindaki ayni gerekce).
try {
  $rotKod = Pm2Kos install pm2-logrotate
  if ($rotKod -eq 0) {
    # 10M x 14 dosya ~ bir aylik gecmis (olculen ~5 MB/gun hizinda).
    # Donen dosyalar sikistirilir; CANLI dosya sikistirilmaz, dogrudan okunur.
    # ⚠ AYARLAR AYRI RAPORLANIR: modul kurulup ayarlar yazilamazsa rotasyon
    #   pm2 VARSAYILANLARIYLA kalir (retain 30, sikistirma yok) ve eskiden
    #   ekranda yine "kuruldu" yazardi - mesaj gercegi soylemezdi.
    # ⚠ CIKIS KODLARI TOPLANMAZ (2026-09-10). Eskiden `$ayarKod += ...` yaziyordu;
    #   toplam bir cikis kodu DEGILDIR ve hangi ayarin yazilamadigini soylemez.
    #   Negatif kod donen bir cagri (Windows'ta olur) toplami sifira bile
    #   cekebilirdi - yani "hepsi yazildi" YALANI. Artik her ayar ADIYLA izlenir
    #   ve basarisiz olanlar operatore tek tek bildirilir.
    $ayarlar = @(
      @{ Ad = "max_size"; Deger = "10M"  },
      @{ Ad = "retain";   Deger = "14"   },
      @{ Ad = "compress"; Deger = "true" }
    )
    $yazilamayan = @()
    foreach ($a in $ayarlar) {
      if ((Pm2Kos set "pm2-logrotate:$($a.Ad)" $a.Deger) -ne 0) { $yazilamayan += $a.Ad }
    }
    if ($yazilamayan.Count -eq 0) {
      Ok "log rotasyonu ayarlandi (10M x 14 dosya, eskiler sikistirilir)"
    } else {
      Uyar "pm2-logrotate KURULDU ama $($yazilamayan.Count) ayar yazilamadi: $($yazilamayan -join ', ')"
      Uyar "  -> rotasyon o ayarlarda pm2 VARSAYILANIYLA kosuyor (retain 30, sikistirma yok)."
      Uyar "  -> elle: $pm2 set pm2-logrotate:max_size 10M ; retain 14 ; compress true"
    }
  } else {
    Uyar "pm2-logrotate kurulamadi (internet yok?) - log dosyasi DONMEYECEK, sinirsiz buyur."
    Uyar "  -> internet gelince elle: $pm2 install pm2-logrotate"
  }
} catch {
  Uyar "pm2-logrotate kurulamadi: $($_.Exception.Message)"
}

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
  Write-Host "    Geri al:  $kurKomut -GeriAl"
  KokeDon
  exit 1
}

Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
KokeDon   # cwd'yi app\ icinde birakma - ayni oturumdaki ikinci kosum kendi kilidine takilir

# Kurulum kaydi (3d-2): onceki surum kenara alinan kurulumdan; yeniMigrationSayisi [7/9]'da DB'den
# olculen, GERCEKTEN uygulanan sayidir (paket farki degil).
$yeniMig = MigrationSayisi $appDir
KurulumKaydiYaz @{
  tur = "KURULUM"; commit = $(if ($m) { $m.commit } else { $null })
  paketOzeti = $paketOzeti
  oncekiSurum = (PaketSurumu $eskiAd); yeniSurum = (PaketSurumu $appDir)
  migrationSayisi = $yeniMig; yeniMigrationSayisi = $dbMigUygulanan
  damga = $damga; kod = (Test-Path $eskiAd); veri = (Test-Path $dump); veriSifreli = ($dump -clike "*.tkenc")
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  KURULUM TAMAM" -ForegroundColor Green
Write-Host "================================================================"
Write-Host "  API      : $($h.status)   DB: $($h.db)   surum: $($h.version)"
# /health'te `lastBackup` YOK (2026-08-09 denetimi F-CORE-GUV-002: alan yetkili
# /api/admin/health'e tasindi) - eski satir her deploy'da BOS basiyor ve operatore
# "yedek yok" diye okunuyordu. Gece yedegi (tekserp_*.dump, rotasyona giren) klasorden okunur;
# bu kurulumun premigrate_ dump'i ayrica asagida "veri:" satirinda.
$geceYedegi = Get-ChildItem $backupDir -File -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -match '^tekserp_.*\.dump(\.tkenc)?$' } |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($geceYedegi) { Write-Host "  Son gece yedegi: $($geceYedegi.Name)  ($($geceYedegi.LastWriteTime.ToString('yyyy-MM-dd HH:mm')))" }
else             { Write-Host "  Son gece yedegi: YOK - $backupDir icinde tekserp_*.dump(.tkenc) bulunamadi (Gorev Zamanlayici TeksERP-DB-Backup'a bak)" -ForegroundColor Yellow }
Write-Host "  Kurulum  : $appDir"
if ($m -and $m.araclar) {
  # Surum notunun YAYIN GUNU adimlari buradan kosulur (pakette tsx/scripts yok).
  Write-Host "  Araclar  : cd $appDir ; node dist\tools\<ad>.cjs   (deneme; --apply surum notundaki gibi)"
  Write-Host "             $(@($m.araclar) -join ', ')"
}
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
