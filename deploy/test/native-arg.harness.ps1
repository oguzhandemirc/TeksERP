# =============================================================================
# ilk-kurulum.ps1 `NativeArg` HARNESS - native komuta giden SQL argumani bozulmadan mi varir?
# Kosucu: deploy/test/native-arg.sh (macOS/Linux, pwsh 7.3+: iki kip de taklit edilir).
# `NativeArg`i betigin AST'sinden yukler; argumanlarini satir satir basan sahte bir
# programa `Standard` ve `Legacy` (= Windows PowerShell 5.1) kipinde gonderir.
# =============================================================================
param([string]$Script, [string]$Exe)
$ErrorActionPreference = "Stop"
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $Script).Path, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { Write-Host "PARSE HATASI"; exit 99 }
$f = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $args[0].Name -eq "NativeArg" }, $true) | Select-Object -First 1
if (-not $f) { Write-Host "fonksiyon yok: NativeArg"; exit 98 }
Invoke-Expression $f.Extent.Text

$ornekler = @(
  "UPDATE system_settings SET ""updatedAt"" = now() WHERE key = 'system.installationId'",
  "CREATE ROLE ""tekserp"" WITH LOGIN PASSWORD 'p""q r'",
  "SELECT 1"
)
$gecti = 0; $kaldi = 0
foreach ($kip in @("Standard", "Legacy")) {
  $PSNativeCommandArgumentPassing = $kip
  foreach ($o in $ornekler) {
    $gelen = (& $Exe (NativeArg $o)) -join "`n"
    if ($gelen -ceq $o) { $gecti++; Write-Host "  OK   [$kip] $o" }
    else { $kaldi++; Write-Host "  HATA [$kip] gonderilen: $o" ; Write-Host "             gelen    : $gelen" }
  }
}
Write-Host "=== Sonuc: $gecti gecti, $kaldi basarisiz ==="
exit ([int]($kaldi -gt 0))
