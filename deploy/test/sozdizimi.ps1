# =============================================================================
# Sunucu betiklerinin SOZDIZIMI denetimi - pwsh 7 (macOS/Linux) ve Windows PowerShell 5.1
#   pwsh -NoProfile -File deploy/test/sozdizimi.ps1                  # deploy/*.ps1 hepsi
#   pwsh -NoProfile -File deploy/test/sozdizimi.ps1 -Dosyalar a.ps1,b.ps1
# Betigi CALISTIRMAZ; PowerShell ayristiricisina verir. Hata varsa satiriyla basar,
# cikis kodu 1. Davranis (5.1'e ozgu stderr/EAP, yurutme ilkesi) burada OLCULMEZ -
# o sozlesmeler Teks-Erp/scripts/test_sunucu_betikleri.ts'te kaynaktan olculur.
# =============================================================================
param([string[]]$Dosyalar)
if (-not $Dosyalar) {
  $Dosyalar = @(Get-ChildItem (Join-Path $PSScriptRoot "..") -Filter "*.ps1" -File | ForEach-Object { $_.FullName })
}
$kod = 0
foreach ($d in $Dosyalar) {
  $tokens = $null; $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $d).Path, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) {
    $kod = 1
    $errors | ForEach-Object { Write-Host "PARSE HATASI $d satir $($_.Extent.StartLineNumber): $($_.Message)" }
  } else {
    Write-Host "OK  $d"
  }
}
exit $kod
