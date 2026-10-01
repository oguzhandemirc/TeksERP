# =============================================================================
# TeksERP - UZAKTAN KOSUM: bir kurulum betigini SSH oturumundan BAGIMSIZ, SYSTEM olarak kostur
# =============================================================================
# NEDEN: Windows OpenSSH oturumu kapaninca oturumun alt surecleri OLUR. `kur.ps1` pm2
#   daemon'unu o oturumda dogurursa backend oturumla gider - kurulum "TAMAM" der,
#   dakikalar sonra durur. Bu betik isi tek kullanimlik bir Gorev Zamanlayici gorevine
#   (SYSTEM) verir, ciktiyi dosyadan izler, cikis kodunu dondurur ve gorevi siler.
#   Izleme SSH ile birlikte kopsa da gorev kosmaya devam eder (log dosyasi kalir).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\uzaktan-kos.ps1 `
#     -Betik C:\TeksERP\kur.ps1 -Argumanlar '-Kok C:\TeksERP -Paket "D:\indir\tekserp-backend-....zip" -Zorla'
#   pm2 -> hizmet GECISI (Dagitim v2; gecis kesintisi sirasinda SSH kopsa da gorev surer):
#     -Betik D:\indir\tekserp-backend-...\gecis\gecis.ps1 -Argumanlar '-Kok C:\TeksERP -Paket "D:\indir\tekserp-backend-....zip" -Uygula -Onay <N> -PlanOzeti <ozet>'
#
# ⚠ Gorev ETKILESIMSIZDIR: kur.ps1 -Zorla ister (onay sorusu cevaplanamaz); ilk-kurulum
#   parolalari DOSYADAN ister (-DbParolaDosyasi / -PostgresParolaDosyasi); gecis.ps1 -Uygula,
#   kuru kosumun bastigi -Onay <N> ister (gorevde plan gosterilip onay alinamaz).
# ⚠ gecis.ps1'in varsayilan cikti dosyasi betigin KENDI klasorundedir: hizmet duzeninde <kok>\logs\
#   backend hesabinin yazabildigi dizindir ve bu gorev SYSTEM'dir (D3 guvenilmez dizin kurali).
# Recete ve elle karsiligi: docs/ops/DEPLOY-RUNBOOK.md §3b.
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$Betik,
  # Betige aynen gecen arguman METNI (tirnaklar dahil) - cmd.exe satirina yazilir.
  [string]$Argumanlar = "",
  # Cikti dosyasi. Varsayilan: <SystemDrive>\TeksERP\logs varsa orasi, yoksa betigin klasoru.
  [string]$Log,
  [int]$ZamanAsimiDakika = 120
)
$ErrorActionPreference = "Stop"
function Dur($m) { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; Write-Host ""; exit 1 }

$admin = (New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Dur "YONETICI PowerShell gerekir (SYSTEM gorevi kaydedilecek)." }
if (-not (Test-Path $Betik)) { Dur "Betik yok: $Betik" }
$betikTam = (Resolve-Path $Betik).Path
# PowerShell parametre adi buyuk/kucuk harf duyarsizdir (-zorla da gecer) ama -match kulture bagli:
# tr-TR'de "-GERIAL"daki 'I' 'i'ye inmez. Duyarsizlik GEREKLI -> kultur-bagimsiz regex.
$onayli = [regex]::IsMatch($Argumanlar, '(^|\s)-(Zorla|GeriAl)\b', 'IgnoreCase, CultureInvariant')
if ((Split-Path $betikTam -Leaf) -ieq "kur.ps1" -and -not $onayli) {
  Dur "kur.ps1 gorevde etkilesimsiz kosar - onay sorusu cevaplanamaz: -Argumanlar icine -Zorla ekle."
}
$gecisMi = [string]::Equals((Split-Path $betikTam -Leaf), "gecis.ps1", [System.StringComparison]::OrdinalIgnoreCase)
$uygulaMi = [regex]::IsMatch($Argumanlar, '(^|\s)-Uygula\b', 'IgnoreCase, CultureInvariant')
if ($gecisMi -and $uygulaMi -and -not [regex]::IsMatch($Argumanlar, '(^|\s)-Onay\s+\d+\b', 'IgnoreCase, CultureInvariant')) {
  Dur "gecis.ps1 -Uygula gorevde etkilesimsiz kosar: once KURU kosun, bastigi '-Onay <N> -PlanOzeti <ozet>'i -Argumanlar'a ekleyin."
}

$damga = Get-Date -Format "yyyyMMdd_HHmmss"
if (-not $Log) {
  $varsayilan = Join-Path $env:SystemDrive "TeksERP\logs"
  $dizin = if (-not $gecisMi -and (Test-Path $varsayilan)) { $varsayilan } else { Split-Path $betikTam -Parent }
  $Log = Join-Path $dizin "uzaktan-$damga.log"
}
$gorevAd = "TeksERP-Uzaktan-$damga"
$satir = "/c powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$betikTam`" $Argumanlar > `"$Log`" 2>&1"

$eylem  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $satir -WorkingDirectory (Split-Path $betikTam -Parent)
$sistem = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$ayar   = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes $ZamanAsimiDakika)
Register-ScheduledTask -TaskName $gorevAd -Action $eylem -Principal $sistem -Settings $ayar -Description "TeksERP uzaktan kosum (tek kullanimlik)" | Out-Null
Write-Host "  gorev : $gorevAd  (SYSTEM)"
Write-Host "  betik : $betikTam $Argumanlar"
Write-Host "  log   : $Log"
Write-Host ""

$sonuc = 1
try {
  Start-ScheduledTask -TaskName $gorevAd
  $okunan = 0
  do {
    Start-Sleep -Seconds 2
    $durum = "$((Get-ScheduledTask -TaskName $gorevAd).State)"
    if (Test-Path $Log) {
      $satirlar = @(Get-Content $Log -ErrorAction SilentlyContinue)
      for ($i = $okunan; $i -lt $satirlar.Count; $i++) { Write-Host $satirlar[$i] }
      $okunan = $satirlar.Count
    }
  } while ($durum -eq "Running" -or $durum -eq "Queued")
  Start-Sleep -Seconds 1
  if (Test-Path $Log) {
    $satirlar = @(Get-Content $Log -ErrorAction SilentlyContinue)
    for ($i = $okunan; $i -lt $satirlar.Count; $i++) { Write-Host $satirlar[$i] }
  }
  $sonuc = [int](Get-ScheduledTaskInfo -TaskName $gorevAd).LastTaskResult
  Write-Host ""
  Write-Host "  gorev bitti - cikis kodu: $sonuc   (log: $Log)"
} finally {
  # Izleme yarida kesildiyse (Ctrl+C) gorev KOSMAYA devam eder - silinmez, soylenir.
  $son = "$((Get-ScheduledTask -TaskName $gorevAd -ErrorAction SilentlyContinue).State)"
  if ($son -eq "Running" -or $son -eq "Queued") {
    Write-Host "  ! gorev HALA kosuyor - log: $Log ; bitince: Unregister-ScheduledTask $gorevAd -Confirm:`$false" -ForegroundColor Yellow
  } else {
    Unregister-ScheduledTask -TaskName $gorevAd -Confirm:$false -ErrorAction SilentlyContinue
  }
}
exit $sonuc
