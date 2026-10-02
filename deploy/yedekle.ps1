# =============================================================================
# TeksERP - GECE YEDEGI (Gorev Zamanlayici: TeksERP-DB-Backup, SYSTEM)
# =============================================================================
# ilk-kurulum.ps1 bu dosyayi <kok>\yedekle.ps1 olarak koyar ve gorevi kurar; gorev
# her gece (varsayilan 03:00) su bicimde kosar:
#   powershell -NoProfile -ExecutionPolicy Bypass -File <kok>\yedekle.ps1 [-IkinciHedef E:\TeksERP-yedek]
#
# NEDEN AYRI GOREV: backend'in kendi zamanlayicisi sahada KAPALI
# (ecosystem BACKUP_SCHEDULE_ENABLED=false); bagimsiz gorev backend cokmus ya da
# kapaliyken de yedek alir. Ikisi birden acik kalirsa her gece iki dokum alinir.
#
# AKIS: pg_dump -Fc -> `<ad>.dump.part` -> pg_restore --list dogrulama -> [SIFRELE] ->
#   `<ad>.dump` ya da `<ad>.dump.tkenc` (bozuk dokum silinir, yarim dosya nihai adi almaz -
#   backend'in yedek listesi, /health ve offsite supurucusu `.part` gormez) -> saklama:
#   <SaklamaGun> gunden eski dokum silinir, yasina bakilmaksizin en yeni <EnAzTut>
#   korunur -> [ikinci hedef].
# SIFRELEME: anahtar dizini TEK KAYNAKTAN - backend ile ayni: <kok>\app\.env'deki
#   BACKUP_KEY_DIR (satir varsa niyet BEYANLIDIR); satir yoksa <kok>\yedek-anahtar VARSA.
#   (-AnahtarDizini verilirse o, beyanli.) Dizinde `*.tkpub` alici varsa dogrulanmis `.part`
#   paketteki `app\dist\tools\yedek-sifrele.cjs` ile TUM alicilara sifrelenir ve duz dokum
#   silinir; ikinci hedefe de sifreli dosya gider. Niyet yoksa BUGUNKU davranis (duz `.dump`).
#   Niyet var ama dizin/alici yok ya da sifreleme dusuyor: duz yedek KORUNUR (yedeksiz
#   kalmaktan iyidir), ikinci hedefe KOPYALANMAZ, cikis 3 (gorev kirmizi). Sifreleme icin
#   parola GEREKMEZ (yalniz acik anahtarlar). Backend baska karar verirse /api/admin/health
#   `backupCryptoIntent.warning` soyler.
# AD: `<db>_<yyyyMMdd_HHmmss>.dump`; db `tekserp` ile baslamiyorsa `tekserp_<db>_...`
#   (backend rotasyonu ve offsite supurucusu `tekserp_` onekini okur). Saklama YALNIZ
#   bu desene dokunur: premigrate_ / pre-restore_ / elle getirilenler silinmez.
# KIMLIK: <kok>\pg-setup\db-credentials.json (ilk-kurulum yazar, yalniz SYSTEM +
#   Administrators okur). LOG: <kok>\backups\backup.log. Cikis 0 = alindi + dogrulandi
#   (+ sifrelendi), 1 hata, 2 ikinci kopya dustu, 3 sifrelenemedi (duz yedek korundu).
# =============================================================================
param(
  [string]$Kok = (Split-Path -Parent $PSCommandPath),
  [int]$SaklamaGun = 30,
  [int]$EnAzTut = 3,
  # Opsiyonel ikinci kopya (ikinci disk / baglanmis surucu). Ayni saklama kurali.
  [string]$IkinciHedef,
  # Yedek sifreleme anahtar dizini (BACKUP_DIR DISINDA). Verilmezse app\.env BACKUP_KEY_DIR,
  # o da yoksa <kok>\yedek-anahtar (varsa).
  [string]$AnahtarDizini
)
$ErrorActionPreference = "Stop"

$yedekDir = Join-Path $Kok "backups"
$logDosya = Join-Path $yedekDir "backup.log"
$credDosya = Join-Path (Join-Path $Kok "pg-setup") "db-credentials.json"
$pgbin = Join-Path (Join-Path $Kok "pgsql") "bin"
# Windows hizmeti duzeni (Dagitim v2): .env yapilandirma\ altinda, kod current\ (etkin surum) altinda
# ve Node paketin kendi runtime'i (sistemde Node olmayabilir). Duzen .env'in yerinden anlasilir; pm2
# duzeninde (app\) hicbir sey degismez.
$hizmetEnv = Join-Path (Join-Path $Kok "yapilandirma") ".env"
$hizmetDuzeni = Test-Path -LiteralPath $hizmetEnv
$appDir = if ($hizmetDuzeni) { Join-Path $Kok "current" } else { Join-Path $Kok "app" }
$sifreArac = Join-Path (Join-Path (Join-Path $appDir "dist") "tools") "yedek-sifrele.cjs"

# .env degeri: ilk eslesen satir, cevreleyen tek/cift tirnak soyulur. Anahtar buyuk/kucuk
# harf DUYARLI (-cmatch): tr-TR kulturunde -match 'I'yi 'i'ye indirger (thinkpad-1 dersi).
# Backend'in gece gorevini taklit eden okuyucusu (backup-crypto/intent.ts) AYNI kurali uygular.
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

function Log($m) {
  $satir = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"
  Write-Host $satir
  try { Add-Content -Path $logDosya -Value $satir -Encoding UTF8 } catch { }
}

# 5.1'de EAP=Stop altinda stderr YONLENDIRMESI satiri olumcul yapar: cagri suresince
# EAP "Continue", stderr satirlari metne cevrilir (ilk-kurulum.ps1 `Psql` ile ayni).
function NativeKos($exe, [string[]]$argumanlar) {
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $c = & $exe @argumanlar 2>&1
    $kod = $LASTEXITCODE
    $satirlar = @($c | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    })
    return [pscustomobject]@{ kod = $kod; cikti = ($satirlar -join " | ").Trim() }
  } finally {
    $ErrorActionPreference = $eskiEAP
  }
}

# Saklama: desene uyan dokumlerden en yeni $EnAzTut'u koru, kalanlardan $SaklamaGun
# gunden eski olani sil. Saat ileri kayarsa gun hesabi hepsini eski sayardi - taban bu.
function Sakla($dizin, $desen) {
  $hepsi = @(Get-ChildItem $dizin -File -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -cmatch $desen } | Sort-Object LastWriteTime -Descending)
  $sinir = (Get-Date).AddDays(-$SaklamaGun)
  foreach ($f in @($hepsi | Select-Object -Skip $EnAzTut | Where-Object { $_.LastWriteTime -lt $sinir })) {
    Remove-Item $f.FullName -Force
    Log "silindi (saklama $SaklamaGun gun): $($f.FullName)"
  }
}

$cikis = 1
try {
  if (-not (Test-Path $credDosya)) { throw "kimlik dosyasi yok: $credDosya" }
  $cred = Get-Content $credDosya -Raw | ConvertFrom-Json
  $kul = if ($cred.user) { $cred.user } else { $cred.superuser }
  $par = if ($cred.pass) { $cred.pass } else { $cred.superpass }
  if (-not $cred.db -or -not $kul -or -not $par) { throw "kimlik dosyasi eksik (db/user/pass): $credDosya" }
  $port = if ($cred.port) { "$($cred.port)" } else { "5432" }
  if (-not (Test-Path $yedekDir)) { New-Item -ItemType Directory -Path $yedekDir | Out-Null }
  # Hizmet duzeninde backups\ hizmet hesabinin YAZABILDIGI dizindir: bu gorev SYSTEM'dir ve baglanti
  # noktasina (junction) donusturulmus bir dizinde yazmaz/silmez.
  if ($hizmetDuzeni -and ((Get-Item -LiteralPath $yedekDir -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw "yedek dizini bir baglanti noktasi (junction) - SYSTEM gorevi izlemez: $yedekDir"
  }

  $onEk = if ($cred.db -eq "tekserp" -or $cred.db -like "tekserp_*") { $cred.db } else { "tekserp_$($cred.db)" }
  $ad = "$($onEk)_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
  $hedef = Join-Path $yedekDir $ad
  $yarim = "$hedef.part"

  $env:PGPASSWORD = $par
  $d = NativeKos (Join-Path $pgbin "pg_dump.exe") @("-h", "localhost", "-p", $port, "-U", $kul, "-d", $cred.db, "-Fc", "-f", $yarim)
  if ($d.kod -ne 0 -or -not (Test-Path $yarim)) {
    Remove-Item $yarim -Force -ErrorAction SilentlyContinue
    throw "pg_dump basarisiz (kod $($d.kod)): $($d.cikti)"
  }
  $v = NativeKos (Join-Path $pgbin "pg_restore.exe") @("--list", $yarim)
  if ($v.kod -ne 0) {
    Remove-Item $yarim -Force -ErrorAction SilentlyContinue
    throw "dogrulama basarisiz (pg_restore --list kod $($v.kod)) - bozuk dokum SILINDI: $($v.cikti)"
  }
  # Sifreleme niyeti: -AnahtarDizini > .env BACKUP_KEY_DIR (beyanli) > <kok>\yedek-anahtar (varsa).
  # .env: pm2 duzeninde app\.env, hizmet duzeninde yapilandirma\.env (backend'le ayni dosya).
  $beyanli = [bool]$AnahtarDizini
  if (-not $AnahtarDizini) {
    $envDosya = if ($hizmetDuzeni) { $hizmetEnv } else { Join-Path $appDir ".env" }
    $envDizin = if (Test-Path $envDosya) { EnvDeger (Get-Content $envDosya -Encoding UTF8) "BACKUP_KEY_DIR" } else { $null }
    if ($envDizin) {
      $beyanli = $true
      $AnahtarDizini = if ([IO.Path]::IsPathRooted($envDizin)) { $envDizin } else { Join-Path $appDir $envDizin }
    } else {
      $AnahtarDizini = Join-Path $Kok "yedek-anahtar"
    }
  }
  $sifreHatasi = $null
  if ($beyanli -and -not (Test-Path $AnahtarDizini)) {
    $sifreHatasi = "sifreleme niyeti beyanli (BACKUP_KEY_DIR) ama anahtar dizini yok: $AnahtarDizini"
  } elseif (Test-Path $AnahtarDizini) {
    $alicilar = @(Get-ChildItem $AnahtarDizini -Filter "*.tkpub" -File -ErrorAction SilentlyContinue)
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = Join-Path $env:ProgramFiles "nodejs\node.exe" }
    if ($hizmetDuzeni) { $node = Join-Path (Join-Path $appDir "runtime") "node.exe" }
    if ($alicilar.Count -eq 0) { $sifreHatasi = "anahtar dizininde alici (*.tkpub) yok: $AnahtarDizini" }
    elseif (-not (Test-Path $sifreArac)) { $sifreHatasi = "sifreleme araci yok: $sifreArac" }
    elseif (-not (Test-Path $node)) { $sifreHatasi = "node bulunamadi: $node" }
    else {
      $s = NativeKos $node @($sifreArac, "sifrele", "--girdi", $yarim, "--cikti", "$hedef.tkenc", "--anahtar-dizini", $AnahtarDizini)
      if ($s.kod -eq 0 -and (Test-Path "$hedef.tkenc")) {
        Remove-Item $yarim -Force
        $hedef = "$hedef.tkenc"
        $ad = "$ad.tkenc"
      } else {
        $sifreHatasi = "sifreleme basarisiz (kod $($s.kod)): $($s.cikti)"
      }
    }
  }
  if (Test-Path $yarim) { Move-Item $yarim $hedef -Force }
  $etiket = if ($ad -like "*.tkenc") { ", sifreli" } else { "" }
  Log "OK $ad  ($([math]::Round((Get-Item $hedef).Length / 1MB, 1)) MB, dogrulandi$etiket)"
  if ($sifreHatasi) { Log "HATA SIFRELENEMEDI - duz yedek korundu, ikinci hedefe KOPYALANMAYACAK: $sifreHatasi" }

  # Iki bicim de ayni saklama kuralina girer.
  $desen = "^$([regex]::Escape($onEk))_\d{8}_\d{6}\.dump(\.tkenc)?$"
  Sakla $yedekDir $desen

  if ($IkinciHedef -and $sifreHatasi) {
    Log "ikinci kopya ATLANDI (sifreleme niyeti var, dosya duz): $hedef"
  } elseif ($IkinciHedef) {
    try {
      if (-not (Test-Path $IkinciHedef)) { New-Item -ItemType Directory -Path $IkinciHedef | Out-Null }
      Copy-Item $hedef (Join-Path $IkinciHedef $ad) -Force
      Sakla $IkinciHedef $desen
      Log "ikinci kopya: $(Join-Path $IkinciHedef $ad)"
    } catch {
      # Asil yedek alindi; ikinci kopyanin dusmesi gorevi KIRMIZI yapar ki fark edilsin.
      Log "HATA ikinci kopya: $($_.Exception.Message)"
      $cikis = 2
      throw
    }
  }
  $cikis = if ($sifreHatasi) { 3 } else { 0 }
} catch {
  if ($cikis -ne 2) { Log "HATA: $($_.Exception.Message)" }
} finally {
  $env:PGPASSWORD = ""
}
exit $cikis
