# =============================================================================
# run-harness.sh'in PowerShell karşılığı — aynı 3 senaryo, aynı 12 kontrol.
# Fabrika sunucusunda bash + pwsh yok (yalnız Windows PowerShell 5.1) → bu koşucu.
# Kullanım (repo kökünden, herhangi bir PowerShell):
#   powershell -ExecutionPolicy Bypass -File deploy\test\run-harness.ps1 -Script deploy\kur.ps1
#   pwsh deploy/test/run-harness.ps1 -Script docs/history/kur.ps1.2026-08-24.orig   # negatif kanıt
# Kaynak: fabrika sunucusu oturumunun 2026-08-25 Windows kolu (docs/history/dev-gonderi-2026-08-25/);
# fark: harness dosya adı düzeltildi, çıktı TEMP'e, sahte pm2 platforma göre .cmd/.sh,
# çocuk süreç olarak çağıran PowerShell'in kendisi (5.1'de powershell.exe, 7'de pwsh).
# =============================================================================
param([Parameter(Mandatory = $true)][string]$Script)
$ErrorActionPreference = "Continue"
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$harness = Join-Path $here "kur-gerialma.harness.ps1"
$isWin   = ($env:OS -eq "Windows_NT")
$host_   = (Get-Process -Id $PID).Path                       # koşan PowerShell'in kendisi
$base    = Join-Path ([IO.Path]::GetTempPath()) "kur-harness-run"
if (Test-Path $base) { Remove-Item $base -Recurse -Force }
New-Item -ItemType Directory -Path $base | Out-Null

$pass = 0; $fail = 0
function Check($ad, $kosul) {
  if ($kosul) { $script:pass++; Write-Host "  [OK]   $ad" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  [HATA] $ad" -ForegroundColor Red }
}
function Setup($ad) {
  $r = Join-Path $base $ad
  New-Item -ItemType Directory -Path (Join-Path $r "app") -Force | Out-Null
  if ($isWin) {
    Set-Content -Path (Join-Path $r "fakepm2.cmd") -Value "@echo off`r`necho %* >> `"%~dp0pm2.log`"" -Encoding ascii
  } else {
    $sh = Join-Path $r "fakepm2.sh"
    Set-Content -Path $sh -Value "#!/bin/bash`necho `"`$@`" >> `"$r/pm2.log`"" -Encoding ascii
    & chmod +x $sh
  }
  Set-Content -Path (Join-Path $r "pm2.log") -Value "" -Encoding ascii
  return $r
}
function Kos($r, $senaryo) {
  $out = Join-Path $r "out.txt"
  $p = Start-Process -FilePath $host_ `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $harness, "-Script", $Script, "-Root", $r, "-Scenario", $senaryo) `
        -RedirectStandardOutput $out -RedirectStandardError (Join-Path $r "err.txt") -NoNewWindow -Wait -PassThru
  return $p.ExitCode
}
function Log($r)   { Get-Content (Join-Path $r "pm2.log") -Raw -ErrorAction SilentlyContinue }
function Cikti($r) { Get-Content (Join-Path $r "out.txt") -Raw -ErrorAction SilentlyContinue }
function Marker($r, $rel) { New-Item -ItemType File -Path (Join-Path $r $rel) -Force | Out-Null }

Write-Host ""
Write-Host "=== $Script ===" -ForegroundColor Cyan

# S1: app.eski YOK, app\ calisan kurulum -> dokunulmamali, pm2 start+save cagrilmali, exit 1
$r = Setup "noeski"
Marker $r "app/ecosystem.config.js"; Marker $r "app/MARKER-CALISAN"
$rc = Kos $r "noeski"
Check "S1 cikis kodu 1 (rc=$rc)" ($rc -eq 1)
Check "S1 app\ YERINDE (MARKER-CALISAN duruyor)" (Test-Path (Join-Path $r "app/MARKER-CALISAN"))
Check "S1 pm2 start + save cagrildi" (((Log $r) -match "start ecosystem.config.js") -and ((Log $r) -match "save"))
Check "S1 mesaj: DOKUNULMADI" ((Cikti $r) -match "DOKUNULMADI")

# S2: app.eski VAR, app\ yeni/bozuk -> app\ eskisiyle DEGISMELI, pm2 start+save, exit 1
$r = Setup "eski"
Marker $r "app/YENI-BOZUK"
New-Item -ItemType Directory -Path (Join-Path $r "app.eski-TEST") -Force | Out-Null
Marker $r "app.eski-TEST/ecosystem.config.js"; Marker $r "app.eski-TEST/MARKER-ESKI"
$rc = Kos $r "eski"
Check "S2 cikis kodu 1 (rc=$rc)" ($rc -eq 1)
Check "S2 app\ = eski kurulum (MARKER-ESKI var, YENI-BOZUK yok)" ((Test-Path (Join-Path $r "app/MARKER-ESKI")) -and -not (Test-Path (Join-Path $r "app/YENI-BOZUK")))
Check "S2 app.eski-TEST tasindi (artik yok)" (-not (Test-Path (Join-Path $r "app.eski-TEST")))
Check "S2 ic ice klasor OLUSMADI (app\app.eski-TEST yok)" (-not (Test-Path (Join-Path $r "app/app.eski-TEST")))
Check "S2 pm2 start + save cagrildi" (((Log $r) -match "start ecosystem.config.js") -and ((Log $r) -match "save"))

# S3: app.eski VAR ama ecosystem.config.js YOK -> geri konur, pm2 CAGRILMAZ, exit 1
$r = Setup "eski-ecosystemsiz"
Marker $r "app/YENI-BOZUK"
New-Item -ItemType Directory -Path (Join-Path $r "app.eski-TEST") -Force | Out-Null
Marker $r "app.eski-TEST/MARKER-ESKI"
$rc = Kos $r "eski-ecosystemsiz"
Check "S3 cikis kodu 1 (rc=$rc)" ($rc -eq 1)
Check "S3 app\ geri kondu (MARKER-ESKI)" (Test-Path (Join-Path $r "app/MARKER-ESKI"))
Check "S3 pm2 HIC cagrilmadi (ecosystem yok)" ([string]::IsNullOrWhiteSpace((Log $r)))

Write-Host ""
Write-Host "=== Sonuc: $pass gecti, $fail basarisiz ===" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
Write-Host "(ciktilar: $base)"
exit $(if ($fail -eq 0) { 0 } else { 1 })
