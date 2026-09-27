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
& $Betik @h
exit $LASTEXITCODE
