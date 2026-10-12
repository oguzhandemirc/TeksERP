# =============================================================================
# Windows Authenticode kod imzası (B9) — sertifika VARSA imzala + doğrula, YOKSA tek satır uyarı.
# =============================================================================
# Sertifika kaynağı (sır repoya GİRMEZ; parmak izi sır değil ama makineye özgü yapılandırmadır):
#   1) ortam: TEKSERP_KOD_IMZA_PARMAKIZI (+ isteğe bağlı TEKSERP_KOD_IMZA_ZAMAN_DAMGASI)
#   2) dosya: %USERPROFILE%\.tekserp\sirlar\kod-imza.json  { "parmakIzi": "<SHA1>", "zamanDamgasi": "<RFC3161 URL>" }
# Sertifika Windows sertifika deposundadır (Certum SimplySign sanal kartı oturumda bağlıyken CurrentUser\My);
# özel anahtar bu makineden çıkmaz. Yoksa bugünkü davranış: dosya imzasız kalır, çıkış 0.
# Çıktı satırları "KODIMZA:" önekiyle başlar (çağıran betik süzer). Çıkış: 0 imzalandı/atlandı · 1 imza ya da doğrulama düştü.
#
# Kullanım: pwsh -NoProfile -ExecutionPolicy Bypass -File deploy\kurulum\kod-imzala.ps1 -Dosya <exe> [-Zorunlu]
#   -Zorunlu  sertifika yoksa uyarı yerine hata (yalnız sertifika geldikten sonra, gerçek yayın kipinde)
param(
  [Parameter(Mandatory = $true)][string]$Dosya,
  [switch]$Zorunlu
)
$ErrorActionPreference = 'Stop'
$VarsayilanZamanDamgasi = 'http://time.certum.pl'

if (-not (Test-Path -LiteralPath $Dosya)) { Write-Output "KODIMZA: HATA dosya yok: $Dosya"; exit 1 }
$ad = Split-Path -Leaf $Dosya

$parmakIzi = $env:TEKSERP_KOD_IMZA_PARMAKIZI
$zaman = $env:TEKSERP_KOD_IMZA_ZAMAN_DAMGASI
$ayarDosyasi = Join-Path $env:USERPROFILE '.tekserp\sirlar\kod-imza.json'
if (-not $parmakIzi -and (Test-Path -LiteralPath $ayarDosyasi)) {
  $ayar = Get-Content -LiteralPath $ayarDosyasi -Raw -Encoding utf8 | ConvertFrom-Json
  $parmakIzi = [string]$ayar.parmakIzi
  if (-not $zaman) { $zaman = [string]$ayar.zamanDamgasi }
}
if (-not $parmakIzi) {
  if ($Zorunlu) { Write-Output "KODIMZA: HATA sertifika yapılandırması yok (-Zorunlu) — $ad imzalanmadı"; exit 1 }
  Write-Output "KODIMZA: UYARI kod imzası sertifikası yok — $ad imzasız kalır (SmartScreen 'bilinmeyen yayıncı')"
  exit 0
}
$parmakIzi = ($parmakIzi -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
if ($parmakIzi.Length -ne 40) { Write-Output "KODIMZA: HATA parmak izi 40 onaltılık hane değil"; exit 1 }
if (-not $zaman) { $zaman = $VarsayilanZamanDamgasi }

$sertifika = @(Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
  Where-Object { $_.Thumbprint -eq $parmakIzi }) | Select-Object -First 1
if (-not $sertifika) { Write-Output "KODIMZA: HATA parmak izli sertifika depoda yok (SimplySign oturumu açık mı?)"; exit 1 }
if (-not $sertifika.HasPrivateKey) { Write-Output "KODIMZA: HATA sertifikanın özel anahtarına erişilemiyor"; exit 1 }

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { Write-Output "KODIMZA: HATA signtool.exe yok (Windows SDK 'Signing Tools' bileşeni)"; exit 1 }

& $signtool sign /sha1 $parmakIzi /fd sha256 /tr $zaman /td sha256 /q $Dosya
if ($LASTEXITCODE) { Write-Output "KODIMZA: HATA signtool sign çıkışı $LASTEXITCODE — $ad"; exit 1 }
& $signtool verify /pa /q $Dosya
if ($LASTEXITCODE) { Write-Output "KODIMZA: HATA signtool verify çıkışı $LASTEXITCODE — $ad"; exit 1 }
$imza = Get-AuthenticodeSignature -LiteralPath $Dosya
if ($imza.Status -ne 'Valid' -or $imza.SignerCertificate.Thumbprint -ne $parmakIzi -or -not $imza.TimeStamperCertificate) {
  Write-Output "KODIMZA: HATA imza doğrulanamadı ($($imza.Status)) — $ad"; exit 1
}
Write-Output "KODIMZA: imzalandı + doğrulandı — $ad · $($imza.SignerCertificate.Subject) · zaman damgalı"
exit 0
