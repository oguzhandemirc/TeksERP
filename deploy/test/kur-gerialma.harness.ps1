# =============================================================================
# kur.ps1 GeriAlOtomatik HARNESS — sahte klasörlerle; pwsh 7 (macOS/Linux/Windows) ve
# Windows PowerShell 5.1 (fabrika sunucusu) ile TEK dosya.
# Koşucular: deploy/test/run-harness.sh (bash+pwsh) · deploy/test/run-harness.ps1 (PowerShell)
# Tek başına: pwsh deploy/test/kur-gerialma.harness.ps1 -Script deploy/kur.ps1 -Root /tmp/x -Scenario noeski|eski|eski-ecosystemsiz
# Script dosyasını PARSE eder (sözdizimi hatası → exit 99), fonksiyon tanımlarını
# AST'den alıp yükler, $pm2'yi argümanlarını dosyaya yazan bir sahteyle değiştirir
# ve GeriAlOtomatik'i çağırır. Sonucu koşucu klasör/işaret dosyalarından okur.
# Windows'a özgü "açık tanıtıcı Move-Item'i düşürür" davranışı burada ÖLÇÜLMEZ.
# =============================================================================
param([string]$Script, [string]$Root, [string]$Scenario)
$ErrorActionPreference = "Stop"

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $Script), [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Host "PARSE HATASI satır $($_.Extent.StartLineNumber): $($_.Message)" }
  exit 99
}
$fns = $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
foreach ($name in @('Adim', 'Ok', 'Uyar', 'KokeDon', 'GeriAlOtomatik')) {
  $f = $fns | Where-Object { $_.Name -eq $name }
  if (-not $f) { if ($name -eq 'KokeDon') { continue }; Write-Host "fonksiyon yok: $name"; exit 98 }
  Invoke-Expression $f.Extent.Text
}

# Stub ortam — script'in beklediği değişken adları
$kok      = $Root
$appDir   = Join-Path $kok "app"
$eskiAd   = Join-Path $kok "app.eski-TEST"
$uygulama = "tekserp-backend"
# Sahte pm2: PowerShell .sh çalıştıramaz → Windows'ta .cmd, diğerlerinde .sh (koşucu
# uygun olanı yazar). $env:OS her iki PowerShell'de de var ($IsWindows 5.1'de yok).
$pm2      = Join-Path $kok $(if ($env:OS -eq "Windows_NT") { "fakepm2.cmd" } else { "fakepm2.sh" })
function Saglik($saniye) { return [pscustomobject]@{ status = "UP"; db = "UP" } }
function Fail($m) { Write-Host "FAIL: $m"; exit 1 }

Set-Location $kok
GeriAlOtomatik "harness senaryo=$Scenario"
