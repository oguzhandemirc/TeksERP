# ilk-kurulum-yerel.sh sarmalayicisi: native arguman kipini (Legacy = 5.1) ayarlar, kalan
# argumanlari adli parametrelere cevirip betigi cagirir, cikis kodunu aynen dondurur.
param([string]$Kip, [string]$Betik, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Kalan)
$h = @{}
for ($i = 0; $i -lt $Kalan.Count; $i++) {
  $t = $Kalan[$i]
  if ($t.StartsWith("-")) {
    $ad = $t.TrimStart("-")
    if ($i + 1 -lt $Kalan.Count -and -not $Kalan[$i + 1].StartsWith("-")) { $h[$ad] = $Kalan[$i + 1]; $i++ }
    else { $h[$ad] = $true }
  }
}
$PSNativeCommandArgumentPassing = $Kip
# macOS/Linux provasi: Windows hizmet sorgulari (Get-CimInstance Win32_Service, Get-Service) yok - betigin hizmet
# duzeni kapisi "kayitli TeksERP hizmeti yok" gorsun (Windows'ta bu kapi gercek SCM'i olcer).
if (-not $IsWindows) {
  function global:Get-CimInstance { param([Parameter(Position = 0)]$ClassName, $Filter, $ErrorAction) return @() }
  function global:Get-Service { param($Name, $ErrorAction) return $null }
}
& $Betik @h
exit $LASTEXITCODE
