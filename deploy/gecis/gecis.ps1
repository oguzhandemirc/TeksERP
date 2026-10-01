# =============================================================================
# TeksERP - TEK SEFERLIK GECIS: pm2 duzeni -> Windows hizmeti + guncelleyici duzeni (Dagitim v2, D6)
# =============================================================================
# NEREDE KOSAR: fabrika sunucusunda, YONETICI PowerShell'de (ya da SSH'tan uzaktan-kos.ps1 ile SYSTEM
#   gorevi olarak). Paketin icinde gelir (gecis\gecis.ps1): betik ve kurdugu paket AYNI derlemeden.
#     powershell -NoProfile -ExecutionPolicy Bypass -File <paket>\gecis\gecis.ps1 -Kok C:\TeksERP -Paket <zip>
#   Varsayilan KURU: hicbir seye dokunmaz, envanteri ve PLANI basar (N kalem + plan ozeti).
#     ... -Uygula -Onay <N>          planin N kalemini uygular (N kurunun bastigi; arada plan degistiyse DURUR)
#     ... -GeriAl                    son gecisin geri alma planini basar; -GeriAl -Uygula -Onay <N> uygular
#     ... -Tamamla                   (gunler sonra) pm2 kalintilarini arsive tasima plani; -Tamamla -Uygula -Onay <N>
#
# NE YAPAR (kalem sirasi BAGLAYICI):
#   kesintisiz : gecis gunlugu (korumali) -> paketi surumler\<surum>'e ac + dogrula -> current -> dizin iskeleti
#                (backend-hizmeti.ps1 -YalnizIskelet) -> yapilandirma\.env (app\.env + ecosystem env blogu,
#                gecis-yardimci.cjs) [+ rclone.conf -> veri\]
#   KESINTI    : pm2 backend durdur -> veritabani yedegi (dogrulanmis) -> acilis gorevi KAPAT -> [guvenlik duvari]
#                -> hizmet kaydi + izinler (backend-hizmeti.ps1: hizmet-kur ONCE, ACL SONRA) -> dogrulama
#                baslatmasi (yalniz 127.0.0.1) + saglik -> normal baslatma + saglik + LAN kimligi
#   sonra      : pm2 sokumu (delete + save + kill) -> <kok>\yedekle.ps1 hizmet-farkinda surumle -> guncelleyici
#                (guncelleyici-hizmeti.ps1) -> [pgsql\ornek.json kip harici]
#
# DEGISMEZLER:
#   * VERITABANINA DOKUNULMAZ: paket app\ ile AYNI derleme olmali (PAKET.json derlemeKimligi + commit + surum);
#     bekleyen goc varsa DURUR - goc pm2 duzeninde kur.ps1 ile, kendi geri alma yoluyla yapilir. Bu yuzden
#     geri alma hicbir kosulda veri geri yuklemez.
#   * PostgreSQL hizmetine/ikililerine/verisine DOKUNULMAZ (harici kip). Yalniz TeksERP adli pm2 uygulamasi,
#     TeksERP-Backend-Boot gorevi ve <kok>\yedekle.ps1 degisir; baska her sey yalniz OLCULUR.
#   * Kok DISINDA silme yok. Kok icinde de silinen yalniz bu betigin yarattigi BOS dizinlerdir; geri alinan
#     her sey <kok>\gecis\<damga>\geri\ altina TASINIR. Sirlar (.env, parola, belirtec) ekrana/gunluge GIRMEZ.
#   * Her kalem gunluge (gecis\<damga>\gunluk.jsonl) BASLADI/BITTI yazar; backend saglikli olana dek her hata
#     OTOMATIK geri alinir (ters sirada telafi). Yarim kalan gecis (elektrik, oturum) -GeriAl ile kapanir.
#
# CIKIS: KURU 0 plan hazir | 1 engel. UYGULA 0 tamam | 3 tamam, uyarili | 1 hata, geri alindi (ya da hic
#   baslamadi) | 4 hata ve GERI ALMA EKSIK (insan gerekir).
# ASCII: PS 5.1 BOM'suz UTF-8'i ANSI okur; bu dosya bilerek yalniz ASCII tasir.
# Runbook: docs/ops/GECIS-PM2-HIZMET.md (SAHINSRV bolumu dahil).
# =============================================================================
[CmdletBinding()]
param(
  [string]$Kok = "C:\TeksERP",
  # app\'teki derlemenin AYNISI (kur.ps1 ile kurulan zip). Gecis surum degistirmez.
  [string]$Paket,
  # Paketin beklenen SHA-256'si (yayin defteri / surum notu). Verilirse tutmazsa DURUR.
  [string]$PaketOzeti,
  # Backend hizmet adi: verilmezse paketin PAKET.json backendHizmetAdi, o da yoksa TeksERP-Backend.
  [string]$HizmetAdi,
  [string]$GuncelleyiciAdi = "TeksERP-Guncelleyici",
  # Backend'in PostgreSQL bagimliligi: verilmezse pgsql\bin baglantisinin gosterdigi hizmet olculur.
  [string]$PgHizmeti,
  [switch]$PgBagimsiz,
  [string]$GuncellemeSunucusu = "https://guncelleme.etkiliyazilim.com",
  [string]$Vekil,
  # pgsql\ornek.json'u kip "harici" ile yaz (istege bagli; yoksa guncelleyici zaten harici sayar).
  [switch]$PgKaydiYaz,
  [switch]$Uygula,
  [int]$Onay = -1,
  [string]$PlanOzeti,
  [switch]$GeriAl,
  [switch]$Tamamla,
  # -Tamamla: duz (sifresiz) gecis yedegini silme.
  [switch]$DokumuKoru,
  # SSH oturumunda -Uygula: oturum koparsa gecis yarida kalir (uzaktan-kos.ps1 onerilir) - bilerek gec.
  [switch]$SshKabul,
  [switch]$ProvaKabul,
  [int]$SaglikSn = 180
)
$ErrorActionPreference = "Stop"

# =============================================================================
# CIKTI
# =============================================================================
function Baslik($m) { Write-Host ""; Write-Host "================================================================"; Write-Host "  $m"; Write-Host "================================================================" }
function Bolum($m)  { Write-Host ""; Write-Host $m -ForegroundColor Cyan; Kayit "== $m" }
function Ok($m)     { Write-Host "  OK $m" -ForegroundColor Green; Kayit "OK $m" }
function Uyar($m)   { Write-Host "  !  $m" -ForegroundColor Yellow; $script:uyarilar += $m; Kayit "UYARI $m" }
function Bilgi($m)  { Write-Host "  .  $m" -ForegroundColor DarkGray; Kayit ".  $m" }
function Engel($m)  { Write-Host "  X  $m" -ForegroundColor Red; $script:engeller += $m; Kayit "ENGEL $m" }
function Dur($m)    { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; Kayit "DUR $m"; exit 1 }
$script:uyarilar = @()
$script:engeller = @()
$script:kayitDosyasi = $null

# Gecis dizini acildiktan sonra her satir gecis.log'a da duser (sir yok - yalniz bu betigin metinleri).
function Kayit($m) {
  if (-not $script:kayitDosyasi) { return }
  try { [System.IO.File]::AppendAllText($script:kayitDosyasi, "$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')) $m`r`n", (New-Object System.Text.UTF8Encoding $false)) } catch { }
}

# Arac ciktisindaki kimlik bilgisi maskelenir (sema://kullanici:parola@ ve parola=...).
function Maske([string]$s) {
  if ($null -eq $s) { return "" }
  $s = [regex]::Replace($s, '(?<=://)[^/\s:@"'']+:[^@\s"'']*@', '***@')
  return [regex]::Replace($s, '(?i)(password|parola|pass|secret|token)(\s*[=:]\s*)\S+', '$1$2***', 'CultureInvariant')
}

# 5.1 (Legacy kip) yerel komut argumanindaki `"`yi KACIRMAZ; psql'e giden SQL buradan gecer.
function NativeArg([string]$s) {
  $pas = Get-Variable -Name PSNativeCommandArgumentPassing -ValueOnly -ErrorAction SilentlyContinue
  if ($PSVersionTable.PSVersion.Major -ge 7 -and $pas -and $pas -ne "Legacy") { return $s }
  return ($s -creplace '(\\*)"', '$1$1\"')
}

# Native komut: EAP cagri suresince Continue (5.1'de stderr yonlendirmesi EAP=Stop altinda olumcul),
# stderr satirlari metne cevrilir, finally'de geri konur. Cikti MASKELI doner.
function NativeKos($exe, [string[]]$argumanlar) {
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $c = & $exe @argumanlar 2>&1
    $kod = $LASTEXITCODE
    $satirlar = @($c | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    })
    return [pscustomobject]@{ Kod = $kod; Satirlar = $satirlar; Metin = (Maske (($satirlar -join "`n").Trim())) }
  } finally {
    $ErrorActionPreference = $eskiEAP
  }
}

# =============================================================================
# ISLETIM SISTEMI SARMALAYICILARI - butun Windows'a ozgu islem buradan gecer (harness bunlari degistirir)
# =============================================================================
function OsYonetici {
  return (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function OsSystemMi { return ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ceq "S-1-5-18") }
function OsSshMi { return [bool]($env:SSH_CONNECTION -or $env:SSH_CLIENT) }
function OsHizmetler {
  return @(Get-CimInstance Win32_Service -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{ Ad = [string]$_.Name; Durum = [string]$_.State; Baslatma = [string]$_.StartMode; Yol = [string]$_.PathName; Hesap = [string]$_.StartName; Cikis = [int]$_.ExitCode; OzelCikis = [int]$_.ServiceSpecificExitCode }
  })
}
function OsHizmet($ad) { return @(OsHizmetler | Where-Object { $_.Ad -ceq $ad }) | Select-Object -First 1 }
function OsHizmetBaslat($ad, [string[]]$ek) {
  $r = NativeKos "sc.exe" (@("start", $ad) + @($ek | Where-Object { $_ }))
  if ($r.Kod -ne 0 -and $r.Kod -ne 1056) { throw "hizmet baslatilamadi ($ad, sc $($r.Kod))" }
}
function OsHizmetDurdur($ad) {
  $r = NativeKos "sc.exe" @("stop", $ad)
  if ($r.Kod -ne 0 -and $r.Kod -ne 1062 -and $r.Kod -ne 1060) { throw "hizmet durdurulamadi ($ad, sc $($r.Kod))" }
}
function OsNodeSurecleri {
  return @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{ Pid = [int]$_.ProcessId; Ust = [int]$_.ParentProcessId; Komut = [string]$_.CommandLine }
  })
}
function OsDinleyenler([int]$port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess } | Select-Object -Unique)
}
function OsGorevler {
  return @(Get-ScheduledTask -ErrorAction Stop | ForEach-Object {
    $t = $_
    [pscustomobject]@{ Ad = [string]$t.TaskName; Klasor = [string]$t.TaskPath; Durum = [string]$t.State
      Eylem = (@($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)".Trim() }) -join " ; ") }
  })
}
function OsGorevKapat($ad, $klasor) { Disable-ScheduledTask -TaskName $ad -TaskPath $klasor | Out-Null }
function OsGorevAc($ad, $klasor) { Enable-ScheduledTask -TaskName $ad -TaskPath $klasor | Out-Null }
function OsGorevBaslat($ad, $klasor) { Start-ScheduledTask -TaskName $ad -TaskPath $klasor }
function OsGorevXml($ad, $klasor) { return [string](Export-ScheduledTask -TaskName $ad -TaskPath $klasor) }
function OsGorevSil($ad, $klasor) { Unregister-ScheduledTask -TaskName $ad -TaskPath $klasor -Confirm:$false }
function OsGuvenlikDuvari([int]$port) {
  $kurallar = @()
  foreach ($f in @(Get-NetFirewallPortFilter -Protocol TCP -ErrorAction SilentlyContinue | Where-Object { @($_.LocalPort) -contains "$port" })) {
    foreach ($r in @($f | Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
      if ("$($r.Enabled)" -ceq "True" -and "$($r.Direction)" -ceq "Inbound" -and "$($r.Action)" -ceq "Allow") {
        $kurallar += [pscustomobject]@{ Ad = [string]$r.DisplayName; Profil = [string]$r.Profile }
      }
    }
  }
  return ,$kurallar
}
function OsGuvenlikDuvariEkle($ad, [int]$port) {
  New-NetFirewallRule -DisplayName $ad -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile @("Domain", "Private") -RemoteAddress @("LocalSubnet") | Out-Null
}
function OsGuvenlikDuvariSil($ad) { Remove-NetFirewallRule -DisplayName $ad -ErrorAction SilentlyContinue }
function OsIpv4 {
  return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.IPAddress } |
    Where-Object { $_ -cnotlike "127.*" -and $_ -cnotlike "169.254.*" })
}
function OsBaglantiMi($yol) {
  if (-not (Test-Path -LiteralPath $yol)) { return $false }
  return ((Get-Item -LiteralPath $yol -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
}
function OsBaglantiHedefi($yol) {
  if (-not (OsBaglantiMi $yol)) { return $null }
  $t = @((Get-Item -LiteralPath $yol -Force).Target | Where-Object { $_ })
  if (-not $t.Count) { return $null }
  # Junction hedefi bazi surumlerde NT onekiyle (\??\C:\...) doner: karsilastirma duz yolla yapilir.
  $h = [string]$t[0]
  if ($h.StartsWith("\??\", [System.StringComparison]::Ordinal)) { $h = $h.Substring(4) }
  return $h
}
function OsBaglantiKur($baglanti, $hedef) {
  $r = NativeKos "cmd.exe" @("/c", "mklink", "/J", $baglanti, $hedef)
  if ($r.Kod -ne 0) { throw "baglanti kurulamadi ($($r.Kod)): $baglanti -> $hedef" }
}
# YALNIZ baglantinin kendisi silinir (yineleme YOK): 5.1'de Remove-Item -Recurse junction'in HEDEFINI bosaltir.
function OsBaglantiSil($baglanti) {
  if (-not (OsBaglantiMi $baglanti)) { throw "baglanti degil, silinmedi: $baglanti" }
  [System.IO.Directory]::Delete($baglanti, $false)
}
function OsAclAl($yol) { return (Get-Acl -LiteralPath $yol).GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access) }
function OsAclKoy($yol, $sddl) {
  $acl = Get-Acl -LiteralPath $yol
  $acl.SetSecurityDescriptorSddlForm($sddl, [System.Security.AccessControl.AccessControlSections]::Access)
  Set-Acl -LiteralPath $yol -AclObject $acl
}
# Yalniz SYSTEM + Administrators (miras kesik, genis gruplar yok) - gecis gunlugu ve karantina burada.
function OsKorumali($yol) {
  $r = NativeKos "icacls.exe" @($yol, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/remove:g", "*S-1-5-32-545", "*S-1-5-11", "*S-1-1-0")
  if ($r.Kod -ne 0) { throw "izin daraltilamadi (icacls $($r.Kod)): $yol" }
}
function OsPm2([string[]]$argumanlar) {
  $env:PM2_HOME = $script:pm2Home
  return NativeKos $script:pm2Cmd $argumanlar
}
function OsPm2Daemon { return @(OsNodeSurecleri | Where-Object { $_.Komut -cmatch 'pm2[\\/]lib[\\/]Daemon\.js' }) }
function OsHttp($url, [int]$sn) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $sn
    return [pscustomobject]@{ Kod = [int]$r.StatusCode; Govde = [string]$r.Content }
  } catch { return [pscustomobject]@{ Kod = 0; Govde = $null } }
}
function OsBetik($betik, [hashtable]$arg) {
  $global:LASTEXITCODE = 0
  & $betik @arg
  return [int]$LASTEXITCODE
}
function OsDugum($node, $yardimci, $komut, $girdi) {
  $eskiKod = $OutputEncoding
  $eskiEAP = $ErrorActionPreference
  try {
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $ErrorActionPreference = "Continue"
    $json = $girdi | ConvertTo-Json -Compress -Depth 8
    $satirlar = @($json | & $node $yardimci $komut)
  } finally { $OutputEncoding = $eskiKod; $ErrorActionPreference = $eskiEAP }
  if (-not $satirlar.Count) { throw "yardimci cevap vermedi ($komut)" }
  return ([string]$satirlar[-1] | ConvertFrom-Json)
}
function OsZipYukle { if ($PSVersionTable.PSVersion.Major -lt 6) { Add-Type -AssemblyName System.IO.Compression.FileSystem } }
function OsZipGirdiler($zip) {
  OsZipYukle
  $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try { return @($z.Entries | ForEach-Object { [pscustomobject]@{ Ad = ([string]$_.FullName -creplace '\\', '/'); Boyut = [int64]$_.Length } }) }
  finally { $z.Dispose() }
}
function OsZipCikar($zip, [string[]]$adlar, $hedef) {
  OsZipYukle
  $z = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach ($e in $z.Entries) {
      $ad = [string]$e.FullName -creplace '\\', '/'
      if ($adlar -notcontains $ad) { continue }
      $yol = Join-Path $hedef ($ad -creplace '/', [System.IO.Path]::DirectorySeparatorChar)
      New-Item -ItemType Directory -Path (Split-Path $yol -Parent) -Force | Out-Null
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $yol, $true)
    }
  } finally { $z.Dispose() }
}
function OsZipAc($zip, $hedef) {
  OsZipYukle
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $hedef)
}
function OsOzet($yol) { return (Get-FileHash -LiteralPath $yol -Algorithm SHA256).Hash.ToLowerInvariant() }
function OsBosAlan($yol) {
  $kok = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($yol))
  return [int64](New-Object System.IO.DriveInfo($kok)).AvailableFreeSpace
}
function OsMakineAnahtarlari { return @([Environment]::GetEnvironmentVariables("Machine").Keys | ForEach-Object { [string]$_ }) }
function OsProgramData { return [string]$env:ProgramData }
function OsBekle([int]$sn) { Start-Sleep -Seconds $sn }
function OsPgDump($hedef) {
  $db = $script:db
  $env:PGPASSWORD = $db.Parola
  try { return NativeKos (Join-Path $db.Bin "pg_dump.exe") @("-h", "localhost", "-p", "$($db.Port)", "-U", $db.Kullanici, "-d", $db.Ad, "-Fc", "-f", $hedef) }
  finally { $env:PGPASSWORD = "" }
}
function OsPgListe($dosya) { return NativeKos (Join-Path $script:db.Bin "pg_restore.exe") @("--list", $dosya) }
function OsSifrele($node, $arac, $dosya, $anahtarDizini) { return NativeKos $node @($arac, "sifrele", "--girdi", $dosya, "--anahtar-dizini", $anahtarDizini, "--duzu-sil") }
# Hizmeti kaydi yapan ikilinin KENDI kaldirma komutu (olay kaynagi da gider); ikili yoksa sc.exe delete.
function OsHizmetKaldir($exe, $ad) {
  if ($exe -and (Test-Path -LiteralPath $exe)) { return NativeKos $exe @("hizmet-kaldir", "--ad", $ad) }
  return NativeKos "sc.exe" @("delete", $ad)
}

# =============================================================================
# YARDIMCILAR
# =============================================================================
function YolEsit($a, $b) {
  if (-not $a -or -not $b) { return $false }
  return [string]::Equals(([string]$a).TrimEnd('\', '/'), ([string]$b).TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)
}
function IcerirI([string]$metin, [string]$parca) {
  if (-not $metin -or -not $parca) { return $false }
  return $metin.IndexOf($parca, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}
function JsonOku($yol) {
  $bayt = [System.IO.File]::ReadAllBytes($yol)
  $bas = if ($bayt.Length -ge 3 -and $bayt[0] -eq 0xEF -and $bayt[1] -eq 0xBB -and $bayt[2] -eq 0xBF) { 3 } else { 0 }
  return ((New-Object System.Text.UTF8Encoding $false).GetString($bayt, $bas, $bayt.Length - $bas) | ConvertFrom-Json)
}
function MzMi($yol) {
  try {
    $fs = [System.IO.File]::OpenRead($yol)
    try { $b = New-Object byte[] 2; $n = $fs.Read($b, 0, 2); return ($n -eq 2 -and $b[0] -eq 0x4D -and $b[1] -eq 0x5A) }
    finally { $fs.Dispose() }
  } catch { return $false }
}
function KisaOzet([string]$s) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $h = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($s))
  return (($h | ForEach-Object { $_.ToString("x2") }) -join "").Substring(0, 12)
}
function SaglikOku($port, [int]$sn) {
  $r = OsHttp "http://127.0.0.1:$port/health" $sn
  if ($r.Kod -ne 200 -or -not $r.Govde) { return $null }
  try { return ($r.Govde | ConvertFrom-Json) } catch { return $null }
}
function KimlikOku($adres, $port, [int]$sn) {
  $r = OsHttp "http://$($adres):$port/api/discovery/identity" $sn
  if ($r.Kod -ne 200 -or -not $r.Govde) { return $null }
  try { return ($r.Govde | ConvertFrom-Json) } catch { return $null }
}
# Dosyanin son satirlari (maskeli) - tani.
function Kuyruk($yol, [int]$adet) {
  if (-not (Test-Path -LiteralPath $yol)) { return @() }
  try { return @(Get-Content -LiteralPath $yol -Tail $adet -Encoding UTF8 | ForEach-Object { Maske "$_" }) } catch { return @() }
}

# Psql: kimlik db-credentials.json'dan; PGPASSWORD cagri basina kurulur ve temizlenir.
function Psql($sql) {
  $db = $script:db
  $env:PGPASSWORD = $db.Parola
  try { return NativeKos (Join-Path $db.Bin "psql.exe") @("-X", "-w", "-h", "localhost", "-p", "$($db.Port)", "-U", $db.Kullanici, "-d", $db.Ad, "-v", "ON_ERROR_STOP=1", "-tAc", (NativeArg $sql)) }
  finally { $env:PGPASSWORD = "" }
}

# =============================================================================
# GUNLUK (gecis\<damga>\gunluk.jsonl) - her satir diske iner; yarim satir okunurken atilir
# =============================================================================
function GunlukYaz($olay, $adim, $veri) {
  $script:sira++
  $satir = [ordered]@{ sira = $script:sira; zaman = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"); olay = $olay; adim = $adim; veri = $veri }
  $metin = ($satir | ConvertTo-Json -Compress -Depth 8) + "`n"
  $bayt = (New-Object System.Text.UTF8Encoding $false).GetBytes($metin)
  $fs = New-Object System.IO.FileStream($script:gunluk, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read, 4096, [System.IO.FileOptions]::WriteThrough)
  try { $fs.Write($bayt, 0, $bayt.Length); $fs.Flush() } finally { $fs.Dispose() }
}
function GunlukOku($yol) {
  $kayitlar = @()
  foreach ($l in @(Get-Content -LiteralPath $yol -Encoding UTF8 -ErrorAction SilentlyContinue)) {
    if (-not $l.Trim()) { continue }
    try { $kayitlar += ($l | ConvertFrom-Json) } catch { }
  }
  return ,$kayitlar
}
# Son gecis: <kok>\gecis\<yyyyMMdd_HHmmss>\gunluk.jsonl (en yeni damga). Durum: YOK | YARIM | BASARILI |
# BASARILI_UYARILI | GERI_ALINDI | GERI_ALMA_EKSIK | TAMAMLANDI.
function SonGecis($kok) {
  $ust = Join-Path $kok "gecis"
  if (-not (Test-Path -LiteralPath $ust)) { return [pscustomobject]@{ Durum = "YOK"; Dizin = $null; Kayitlar = @() } }
  $d = @(Get-ChildItem -LiteralPath $ust -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -cmatch '^\d{8}_\d{6}$' -and (Test-Path -LiteralPath (Join-Path $_.FullName "gunluk.jsonl")) } | Sort-Object Name -Descending)
  if (-not $d.Count) { return [pscustomobject]@{ Durum = "YOK"; Dizin = $null; Kayitlar = @() } }
  $k = GunlukOku (Join-Path $d[0].FullName "gunluk.jsonl")
  $durum = "YARIM"
  foreach ($x in $k) {
    if ($x.olay -ceq "SONUC") { $durum = [string]$x.veri.sonuc }
    elseif ($x.olay -ceq "GERI_ALMA_BASLADI") { $durum = "GERI_ALMA_EKSIK" }
    elseif ($x.olay -ceq "TAMAMLANDI") { $durum = "TAMAMLANDI" }
  }
  return [pscustomobject]@{ Durum = $durum; Dizin = $d[0].FullName; Damga = $d[0].Name; Kayitlar = $k }
}

# =============================================================================
# ENVANTER - hicbir seye dokunmaz; engeller $script:engeller'a, uyarilar $script:uyarilar'a
# =============================================================================
$script:DIZINLER = @("surumler", "yapilandirma", "lisans", "backups", "yedek-anahtar", "logs", "veri", "mobil-guncelleme", "rclone", "pg-setup", "guncelleyici")
$script:SURUM_BICIMI = '^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9A-Za-z][0-9A-Za-z.-]{0,39})?$'

function Envanter {
  $E = [ordered]@{}
  Bolum "ENVANTER (salt okuma)"
  # --- yetki, oturum -----------------------------------------------------------
  if (-not (OsYonetici)) { Engel "YONETICI PowerShell gerekir (hizmet kaydi, izin, gorev)." }
  $E.System = OsSystemMi
  $E.Ssh = OsSshMi
  if ($E.Ssh -and -not $E.System) { Uyar "SSH oturumu: -Uygula oturum koparsa yarida kalir - uzaktan-kos.ps1 ile SYSTEM gorevi olarak kosun (ya da -SshKabul)." }
  # --- kok -------------------------------------------------------------------
  if (-not [System.IO.Path]::IsPathRooted($Kok) -or $Kok.Length -lt 4) { Engel "kok mutlak bir alt dizin olmali: $Kok"; return $E }
  $kok = [System.IO.Path]::GetFullPath($Kok).TrimEnd('\', '/')
  $E.Kok = $kok
  if (-not (Test-Path -LiteralPath $kok)) { Engel "kok yok: $kok"; return $E }
  if (OsBaglantiMi $kok) { Engel "kok bir baglanti noktasi (junction): $kok"; return $E }
  $E.App = Join-Path $kok "app"
  Bilgi "kok: $kok"
  $sg = SonGecis $kok
  $E.SonGecis = $sg
  if ($sg.Durum -cne "YOK") { Bilgi "son gecis: $($sg.Damga) - $($sg.Durum)" }
  if ($sg.Durum -ceq "YARIM" -or $sg.Durum -ceq "GERI_ALMA_EKSIK") { Engel "yarim kalmis gecis var ($($sg.Damga), $($sg.Durum)) - once: -GeriAl" }
  foreach ($iz in @("surumler", "current", "yapilandirma\.env")) {
    if (Test-Path -LiteralPath (Join-Path $kok $iz)) { Engel "kok zaten hizmet duzeni izi tasiyor: $kok\$iz$(if ($sg.Durum -cmatch '^BASARILI') { ' (gecis tamamlanmis - durum icin parametresiz kosun)' })" }
  }
  foreach ($hz in @("surumler\.hazirlik-*")) {
    if (@(Get-ChildItem -Path (Join-Path $kok $hz) -Directory -ErrorAction SilentlyContinue).Count) { Engel "yarim paket hazirlik dizini var ($kok\$hz) - once -GeriAl ya da elle" }
  }
  # --- pm2 duzeni: app\ ------------------------------------------------------
  $E.AppPaket = $null
  foreach ($f in @("dist\server.js", ".env", "package.json")) {
    if (-not (Test-Path -LiteralPath (Join-Path $E.App $f))) { Engel "pm2 duzeni bulunamadi: $($E.App)\$f yok" }
  }
  if (Test-Path -LiteralPath (Join-Path $E.App "PAKET.json")) {
    try { $E.AppPaket = JsonOku (Join-Path $E.App "PAKET.json") } catch { Engel "app\PAKET.json okunamadi" }
  } else { Engel "app\PAKET.json yok - eski paket bicimi; once kur.ps1 ile guncel pakete gecin" }
  $E.AppSurum = $null
  try { $E.AppSurum = [string](JsonOku (Join-Path $E.App "package.json")).version } catch { }
  if ($E.AppPaket) { Ok "app\: surum $($E.AppSurum) | commit $($E.AppPaket.commit) | derleme $($E.AppPaket.derlemeKimligi) | kanal $(if ($E.AppPaket.backendKanal) { $E.AppPaket.backendKanal } else { '(kanal-disi)' })" }
  $E.Eko = Join-Path $E.App "ecosystem.config.js"
  if (-not (Test-Path -LiteralPath $E.Eko)) { Uyar "app\ecosystem.config.js yok - env blogu tasinmaz (yalniz .env)"; $E.Eko = $null }
  # --- paket (yardimci + betikler paketten) -------------------------------------
  PaketEnvanteri $E
  # --- pm2 (baslatma ortami anahtarlari yapilandirma kiyasina girer) ----------------
  if ($E.Gecici) { Pm2Envanteri $E }
  # --- yapilandirma: app\.env + ecosystem env -> yapilandirma\.env (yalniz hesap) ----
  if ($E.Gecici) { OrtamEnvanteri $E }
  # --- veritabani -----------------------------------------------------------------
  DbEnvanteri $E
  # --- port, saglik, kimlik ---------------------------------------------------------
  CalisanEnvanteri $E
  # --- gorevler, hizmetler, guvenlik duvari -----------------------------------------
  GorevEnvanteri $E
  HizmetEnvanteri $E
  # --- dizinler (dokunulmayacaklar dahil) ---------------------------------------------
  DizinEnvanteri $E
  return $E
}

function PaketEnvanteri($E) {
  $E.Gecici = $null
  if (-not $Paket) { Engel "-Paket <zip> gerekli (app\'teki derlemenin AYNISI)"; return }
  if (-not (Test-Path -LiteralPath $Paket)) { Engel "paket yok: $Paket"; return }
  $E.Zip = (Resolve-Path -LiteralPath $Paket).Path
  $E.ZipOzet = OsOzet $E.Zip
  Bilgi "paket: $($E.Zip) (sha256 $($E.ZipOzet))"
  if ($PaketOzeti -and $PaketOzeti.ToLowerInvariant() -cne $E.ZipOzet) { Engel "paket ozeti beklenenden farkli (-PaketOzeti)" }
  try { $girdiler = OsZipGirdiler $E.Zip } catch { Engel "paket zip olarak okunamadi"; return }
  $adlar = @($girdiler | ForEach-Object { $_.Ad })
  $E.ZipDosyaSayisi = @($girdiler | Where-Object { -not $_.Ad.EndsWith("/") }).Count
  $E.ZipBoyut = [int64](($girdiler | Measure-Object -Property Boyut -Sum).Sum)
  $kotu = @($adlar | Where-Object { $_ -cmatch '(^|/)\.\.(/|$)' -or $_ -cmatch '^[A-Za-z]:' -or $_.StartsWith("/") })
  if ($kotu.Count) { Engel "pakette kok disina yazan girdi var: $($kotu[0])"; return }
  $zorunlu = @("dist/server.js", "package.json", "PAKET.json", "prisma.config.js", "prisma/schema.prisma",
    "runtime/node.exe", "runtime/tekserp-hizmet.exe", "runtime/tekserp-guncelleyici.exe",
    "node_modules/prisma/build/index.js", "butunluk.jws", "butunluk-liste.txt", "yedekle.ps1")
  foreach ($z in $zorunlu) { if ($adlar -notcontains $z) { Engel "pakette yok: $z" } }
  if (-not @($adlar | Where-Object { $_.StartsWith("node_modules/.prisma/client/") }).Count) { Engel "pakette yok: node_modules/.prisma/client" }
  $E.PaketGoclari = @($adlar | Where-Object { $_ -cmatch '^prisma/migrations/[^/]+/migration\.sql$' } | ForEach-Object { ($_ -csplit '/')[2] } | Sort-Object -Unique)
  $gecici = Join-Path ([System.IO.Path]::GetTempPath()) ("tekserp-gecis-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $gecici -Force | Out-Null
  $E.Gecici = $gecici
  $al = @("PAKET.json", "package.json", "runtime/node.exe", "gecis/gecis-yardimci.cjs", "hizmet/backend-hizmeti.ps1", "hizmet/guncelleyici-hizmeti.ps1", "yedekle.ps1") | Where-Object { $adlar -contains $_ }
  OsZipCikar $E.Zip $al $gecici
  try { $E.Paket = JsonOku (Join-Path $gecici "PAKET.json") } catch { Engel "paketin PAKET.json'u okunamadi"; return }
  $E.Surum = $null
  try { $E.Surum = [string](JsonOku (Join-Path $gecici "package.json")).version } catch { }
  if (-not $E.Surum -or $E.Surum -cnotmatch $script:SURUM_BICIMI) { Engel "paket surumu guncelleyicinin surum bicimine uymuyor: '$($E.Surum)'"; return }
  Ok "paket: surum $($E.Surum) | commit $($E.Paket.commit) | derleme $($E.Paket.derlemeKimligi) | $($E.ZipDosyaSayisi) dosya | $([math]::Round($E.ZipBoyut / 1MB)) MB acik"
  if ($E.Paket.prova -and -not $ProvaKabul) { Engel "PROVA paketi (PAKET.json prova=true) - fabrikaya kurulmaz; prova makinesindeysen -ProvaKabul" }
  if (-not $E.Paket.korumali) { Uyar "paket korumali degil (butunluk + native cekirdek beklenir)" }
  # Ayni derleme: gecis surum DEGISTIRMEZ, veritabanina dokunmaz.
  if ($E.AppPaket) {
    $ayni = ([string]$E.Paket.derlemeKimligi -ceq [string]$E.AppPaket.derlemeKimligi) -and ([string]$E.Paket.commit -ceq [string]$E.AppPaket.commit) -and ($E.Surum -ceq $E.AppSurum)
    if ($ayni) { Ok "paket = app\ derlemesi (derleme kimligi + commit + surum ayni) - gecis surum degistirmez" }
    else { Engel "paket app\'teki derleme DEGIL (app $($E.AppSurum)/$($E.AppPaket.derlemeKimligi), paket $($E.Surum)/$($E.Paket.derlemeKimligi)) - once pm2 duzeninde: kur.ps1 -Paket <bu zip>, sonra gecis" }
  }
  $beklenenDosya = 0
  if ($E.Paket.dosyaSayisi) { $beklenenDosya = [int]$E.Paket.dosyaSayisi + 1; if ($E.ZipDosyaSayisi -ne $beklenenDosya) { Engel "paket dosya sayisi beyanla tutmuyor (beyan $beklenenDosya, zip $($E.ZipDosyaSayisi))" } }
  $E.BeklenenDosya = $beklenenDosya
  # Hizmet adi: parametre > paket kimligi > varsayilan.
  $E.HizmetAdi = if ($HizmetAdi) { $HizmetAdi } elseif ($E.Paket.PSObject.Properties.Name -ccontains "backendHizmetAdi" -and $E.Paket.backendHizmetAdi) { [string]$E.Paket.backendHizmetAdi } else { "TeksERP-Backend" }
  foreach ($a in @($E.HizmetAdi, $GuncelleyiciAdi)) { if ($a -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') { Engel "gecersiz hizmet adi: $a" } }
  $E.Node = Join-Path $gecici "runtime\node.exe"
  if (-not (MzMi $E.Node)) { Engel "paketin runtime\node.exe'si Windows ikilisi degil (MZ yok)" }
  $E.Yardimci = Kaynak $gecici "gecis\gecis-yardimci.cjs" "gecis-yardimci.cjs"
  $E.AclBetigi = Kaynak $gecici "hizmet\backend-hizmeti.ps1" "..\hizmet\backend-hizmeti.ps1"
  $E.GuncBetigi = Kaynak $gecici "hizmet\guncelleyici-hizmeti.ps1" "..\hizmet\guncelleyici-hizmeti.ps1"
  foreach ($b in @($E.Yardimci, $E.AclBetigi, $E.GuncBetigi)) { if (-not $b) { Engel "gecis yardimci dosyasi bulunamadi (ne pakette ne betigin yaninda)" } }
}

# Paketteki kopya oncelikli (ayni derleme); yoksa betigin yanindaki (kaynak agac) - soylenir.
function Kaynak($gecici, $paketYolu, $yanYolu) {
  $p = Join-Path $gecici $paketYolu
  if (Test-Path -LiteralPath $p) { return $p }
  $y = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $yanYolu))
  if (Test-Path -LiteralPath $y) { Uyar "paket $paketYolu tasimiyor - betigin yanindaki kullanilacak: $y"; return $y }
  return $null
}

function OrtamEnvanteri($E) {
  if (-not $E.Yardimci -or -not (Test-Path -LiteralPath (Join-Path $E.App ".env"))) { return }
  $girdi = [ordered]@{ kok = $E.Kok; eskiApp = $E.App; eskiEnv = (Join-Path $E.App ".env"); eko = $E.Eko; makineAnahtarlari = @(OsMakineAnahtarlari) }
  if ($E.Pm2Anahtarlar) { $girdi.pm2Anahtarlar = @($E.Pm2Anahtarlar) }
  try { $r = OsDugum $E.Node $E.Yardimci "ortam" $girdi } catch { Engel "yapilandirma birlestirmesi olculemedi: $($_.Exception.Message)"; return }
  if ([string]$r.karar -ceq "HATA") { Engel "yapilandirma birlestirmesi: $($r.hata)"; return }
  $E.Ortam = $r
  $E.Port = if ($r.port) { [int]$r.port } else { 4000 }
  $oz = @($r.ozet.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " "
  Ok "yapilandirma\.env: .env $($r.envAnahtarSayisi) + ecosystem $($r.ecoAnahtarSayisi) anahtar -> $oz (port $($E.Port))"
  foreach ($u in @($r.uyarilar)) { Uyar "yapilandirma: $u" }
  foreach ($x in @($r.engeller)) { Engel "yapilandirma: $x" }
  $E.Rclone = $null
  if ($r.rclone) {
    $eski = [string]$r.rclone.eskiYol -creplace '/', '\'
    $yeni = [string]$r.rclone.yeniYol -creplace '/', '\'
    if (Test-Path -LiteralPath $eski) {
      if (Test-Path -LiteralPath $yeni) { Uyar "rclone.conf iki yerde: $eski ve $yeni - veri\ altindaki kullanilacak (kopyalanmaz)" }
      else { $E.Rclone = [pscustomobject]@{ Kaynak = $eski; Hedef = $yeni }; Ok "rclone.conf: $eski -> $yeni (kopya; eskisi yerinde kalir)" }
    } else { Bilgi "rclone.conf yok ($eski) - makine disi supurucu yapilandirilmamis" }
  }
}

function DbEnvanteri($E) {
  $cred = Join-Path $E.Kok "pg-setup\db-credentials.json"
  $E.PgBin = Join-Path $E.Kok "pgsql\bin"
  if (-not (Test-Path -LiteralPath $cred)) { Engel "kimlik dosyasi yok: $cred"; return }
  if (-not (Test-Path -LiteralPath (Join-Path $E.PgBin "psql.exe"))) { Engel "PostgreSQL araclari yok: $($E.PgBin)\psql.exe"; return }
  try { $c = JsonOku $cred } catch { Engel "kimlik dosyasi okunamadi: $cred"; return }
  $kul = if ($c.user) { [string]$c.user } else { [string]$c.superuser }
  $par = if ($c.pass) { [string]$c.pass } else { [string]$c.superpass }
  if (-not $c.db -or -not $kul -or -not $par) { Engel "kimlik dosyasi eksik (db/user/pass)"; return }
  $script:db = [pscustomobject]@{ Bin = $E.PgBin; Port = $(if ($c.port) { [int]$c.port } else { 5432 }); Kullanici = $kul; Parola = $par; Ad = [string]$c.db }
  $E.Db = [pscustomobject]@{ Ad = [string]$c.db; Port = $script:db.Port; Kullanici = $kul }
  $v = Psql "SHOW server_version"
  if ($v.Kod -ne 0) { Engel "veritabanina baglanilamadi ($($E.Db.Ad) @ localhost:$($E.Db.Port)): $($v.Metin)"; return }
  $E.PgSurum = ([string]@($v.Satirlar)[0]).Trim()
  $g = Psql "SELECT migration_name || '|' || (CASE WHEN finished_at IS NOT NULL AND rolled_back_at IS NULL THEN 'T' WHEN rolled_back_at IS NOT NULL THEN 'G' ELSE 'Y' END) FROM _prisma_migrations ORDER BY 1"
  if ($g.Kod -ne 0) { Engel "goc listesi okunamadi: $($g.Metin)"; return }
  $uyg = @(); $yarim = @()
  foreach ($s in @($g.Satirlar)) {
    $p = ([string]$s).Trim() -csplit '\|'
    if ($p.Count -ne 2) { continue }
    if ($p[1] -ceq "T") { $uyg += $p[0] } elseif ($p[1] -ceq "Y") { $yarim += $p[0] }
  }
  $E.DbGoclari = $uyg
  if ($yarim.Count) { Engel "veritabaninda BITMEMIS goc var: $($yarim -join ', ') - once kur.ps1/migrate status ile cozulmeli" }
  if ($E.PaketGoclari) {
    $bekleyen = @($E.PaketGoclari | Where-Object { $uyg -notcontains $_ })
    $fazla = @($uyg | Where-Object { $E.PaketGoclari -notcontains $_ })
    if ($bekleyen.Count) { Engel "paketin $($bekleyen.Count) goc'u veritabaninda UYGULANMAMIS ($($bekleyen[0])...) - gecis veritabanina DOKUNMAZ; once pm2 duzeninde kur.ps1 -Paket <bu zip>" }
    if ($fazla.Count) { Engel "veritabaninda paketin bilmedigi $($fazla.Count) goc var ($($fazla[0])...) - paket kurulu semadan ESKI" }
    if (-not $bekleyen.Count -and -not $fazla.Count) { Ok "veritabani: $($E.Db.Ad) @ localhost:$($E.Db.Port) | PostgreSQL $($E.PgSurum) | $($uyg.Count) goc = paket (bekleyen yok)" }
  }
  $boy = Psql "SELECT pg_database_size(current_database())"
  if ($boy.Kod -eq 0) { $E.DbBoyut = [int64]([string]@($boy.Satirlar)[0]).Trim() }
}

function Pm2Envanteri($E) {
  $E.Pm2 = $null
  $script:pm2Home = Join-Path $E.Kok "pm2-home"
  $yerel = Join-Path $E.Kok "pm2\node_modules\.bin\pm2.cmd"
  $script:pm2Cmd = if (Test-Path -LiteralPath $yerel) { $yerel } else { $g = Get-Command pm2.cmd -ErrorAction SilentlyContinue; if ($g) { $g.Source } else { $null } }
  $daemon = @()
  try { $daemon = @(OsPm2Daemon) } catch { Engel "pm2 daemon sureci olculemedi"; return }
  $E.Pm2Daemon = $daemon.Count
  if (-not $daemon.Count) { Uyar "pm2 daemon calismiyor - backend pm2 altinda kosmuyor (durdurulacak surec yok)"; return }
  if (-not $script:pm2Cmd) { Engel "pm2 daemon calisiyor ama pm2 komutu bulunamadi ($yerel)"; return }
  $l = OsPm2 @("jlist")
  $girdi = [ordered]@{ jlist = (@($l.Satirlar) -join "`n"); app = $E.App; ad = $(if ($E.AppPaket) { [string]$E.AppPaket.backendPm2Ad } else { $null }) }
  try { $r = OsDugum $E.Node $E.Yardimci "pm2" $girdi } catch { Engel "pm2 listesi siniflanamadi: $($_.Exception.Message)"; return }
  $E.Pm2 = $r
  if ([string]$r.karar -ceq "OLCULEMEDI" -or [string]$r.karar -ceq "ENGEL" -or [string]$r.karar -ceq "HATA") { Engel "pm2: $($r.neden)$($r.hata)"; return }
  if ([string]$r.karar -ceq "YOK") { Uyar "pm2: $($r.neden)"; return }
  $b = $r.bizim
  Ok "pm2: '$($b.ad)' $($b.durum) (PID $($b.pid), port $(if ($b.port) { $b.port } else { '?' })) | moduller: $(if (@($r.moduller).Count) { @($r.moduller) -join ', ' } else { '-' })$(if ($r.neden) { ' | ' + $r.neden })"
  $E.Pm2Anahtarlar = @($r.pm2Anahtarlar)
}

function CalisanEnvanteri($E) {
  if (-not $E.Port) { $E.Port = 4000 }
  $E.Kimlik = $null
  try { $dinleyen = @(OsDinleyenler $E.Port) } catch { $dinleyen = @() }
  $bizimPid = if ($E.Pm2 -and $E.Pm2.bizim) { [int]$E.Pm2.bizim.pid } else { 0 }
  $yabanci = @($dinleyen | Where-Object { $_ -ne $bizimPid })
  if ($yabanci.Count) { Engel "port $($E.Port)'u pm2 backend'i DISINDA bir surec dinliyor (PID $($yabanci -join ', ')) - once o cozulmeli" }
  $h = SaglikOku $E.Port 5
  if ($h) {
    $E.SurumOnce = [string]$h.version
    if ($E.AppSurum -and $E.SurumOnce -cne $E.AppSurum) { Engel "calisan backend surumu $($E.SurumOnce), app\ $($E.AppSurum) - pm2 sureci app\'teki derlemeyi kosmuyor" }
    else { Ok "/health: $($h.status) / DB $($h.db) / v$($h.version)" }
    $k = KimlikOku "127.0.0.1" $E.Port 5
    if ($k -and $k.installationId) { $E.Kimlik = [string]$k.installationId; Ok "kurulum kimligi: $($E.Kimlik) ($($k.companyName))" } else { Uyar "kurulum kimligi okunamadi (/api/discovery/identity) - gecis sonrasi kiyas yalniz surum + DB" }
  } elseif ($E.Pm2 -and $E.Pm2.bizim -and [string]$E.Pm2.bizim.durum -ceq "online") { Uyar "pm2 backend'i online ama /health cevap vermiyor (port $($E.Port))" }
  else { Uyar "backend bugun cevap vermiyor - gecis oncesi saglik olculemedi" }
  $kira = $null
  try { $kira = OsDugum $E.Node $E.Yardimci "kira" ([ordered]@{ yol = (Join-Path $E.Kok "lisans\kira.jws") }) } catch { }
  if ($kira -and $kira.var -and $kira.bicimli) {
    Ok "kira: kanal $($kira.kanal) | bitis $($kira.bitis) | guncelleme politikasi $($kira.politika)$(if ($kira.hedefSurum) { ' (hedef ' + $kira.hedefSurum + ')' })$(if ($kira.guncellemeDonuk) { ' | YAPTIRIM: guncelleme donuk' })"
    if ($E.Paket -and $E.Paket.backendKanal -and $kira.kanal -and [string]$kira.kanal -cne [string]$E.Paket.backendKanal) { Uyar "kiranin kanali ($($kira.kanal)) paketin kanalindan ($($E.Paket.backendKanal)) farkli - guncelleyici bu kanalin surumlerini kurar" }
    if ([string]$kira.politika -ceq "OTOMATIK") { Uyar "politika OTOMATIK: gecis penceresinde guncelleyici kendiliginden surum kurabilir - portalda gecis boyunca ONAYLI/DONDUR onerilir" }
  } elseif ($kira -and -not $kira.var) { Bilgi "kira yok (lisans etkin degil) - guncelleyici DONDURULDU/KIRA_YOK der, bir sey kurmaz" }
}

function GorevEnvanteri($E) {
  $E.Boot = $null; $E.YedekGorevleri = @()
  try { $gorevler = @(OsGorevler) } catch { Engel "zamanlanmis gorevler olculemedi"; return }
  $kokI = $E.Kok
  foreach ($g in $gorevler) {
    $teks = $g.Ad.StartsWith("TeksERP", [System.StringComparison]::Ordinal)
    $pm2Iz = (IcerirI $g.Eylem "pm2") -or (IcerirI $g.Eylem "$kokI\app")
    if ($teks -and $g.Ad -ceq "TeksERP-Backend-Boot") {
      $E.Boot = $g
      if (-not (IcerirI $g.Eylem "pm2-boot.cmd")) { Uyar "TeksERP-Backend-Boot eylemi pm2-boot.cmd degil: $($g.Eylem)" }
      Ok "acilis gorevi: $($g.Klasor)$($g.Ad) ($($g.Durum)) - KAPATILACAK"
    } elseif ($teks -and $g.Ad.StartsWith("TeksERP-DB-Backup", [System.StringComparison]::Ordinal)) {
      $E.YedekGorevleri += $g
      if (IcerirI $g.Eylem "$kokI\yedekle.ps1") { Ok "gece yedegi gorevi: $($g.Ad) ($($g.Durum)) - korunur; betigi hizmet-farkinda surumle degisir" }
      else { Uyar "gece yedegi gorevi $($g.Ad) bu kokun yedekle.ps1'ini cagirmiyor: $($g.Eylem)" }
    } elseif ($teks -and $g.Ad.StartsWith("TeksERP-Uzaktan-", [System.StringComparison]::Ordinal)) {
      Bilgi "uzaktan kosum gorevi (dokunulmaz): $($g.Ad)"
    } elseif ($teks) {
      Bilgi "TeksERP gorevi (dokunulmaz): $($g.Ad) - $($g.Eylem)"
    } elseif ($pm2Iz) {
      Engel "TeksERP adli OLMAYAN gorev pm2/app\ cagiriyor: $($g.Klasor)$($g.Ad) - acilista eski backend'i geri getirir; elle kapatilmali (betik yalniz TeksERP adlilara dokunur)"
    }
  }
  if (-not $E.Boot) { Uyar "TeksERP-Backend-Boot gorevi yok - acilista pm2'yi baslatan baska bir yol var mi kontrol edin" }
  if (-not $E.YedekGorevleri.Count) { Uyar "gece yedegi gorevi (TeksERP-DB-Backup*) YOK - gecisten bagimsiz, kurulmali" }
  $E.KokYedekle = Join-Path $E.Kok "yedekle.ps1"
}

function HizmetEnvanteri($E) {
  try { $hizmetler = @(OsHizmetler) } catch { Engel "hizmetler olculemedi"; return }
  $E.PgHizmetleri = @($hizmetler | Where-Object { (IcerirI $_.Yol "pg_ctl.exe") -or (IcerirI $_.Yol "postgres.exe") })
  foreach ($h in $hizmetler) {
    if ($h.Ad -ceq $E.HizmetAdi -or $h.Ad -ceq $GuncelleyiciAdi) { Engel "hizmet zaten kayitli: $($h.Ad) ($($h.Durum), $($h.Yol)) - onceki kurulum/gecis kalintisi; -GeriAl ya da hizmet-kaldir" ; continue }
    if ($E.PgHizmetleri -contains $h) { continue }
    if ((IcerirI $h.Yol "$($E.Kok)\") -or (IcerirI $h.Yol "pm2")) {
      if ($h.Durum -ceq "Running") { Engel "bu koku ya da pm2'yi kullanan baska hizmet CALISIYOR: $($h.Ad) ($($h.Yol)) - elle durdurulmali" }
      else { Uyar "bu koku ya da pm2'yi gosteren durmus hizmet: $($h.Ad) ($($h.Baslatma)) - dokunulmaz" }
    }
  }
  # PG bagimliligi: pgsql\bin baglantisinin gosterdigi ikili dizinini kullanan hizmet.
  $E.PgHizmeti = $null
  $hedef = OsBaglantiHedefi $E.PgBin
  if ($PgBagimsiz) { Bilgi "PostgreSQL bagimliligi: yok (-PgBagimsiz)" }
  elseif ($PgHizmeti) {
    if (-not @($hizmetler | Where-Object { $_.Ad -ceq $PgHizmeti }).Count) { Engel "PostgreSQL hizmeti yok: $PgHizmeti" } else { $E.PgHizmeti = $PgHizmeti; Ok "PostgreSQL bagimliligi: $PgHizmeti (parametre)" }
  } else {
    $aday = @($E.PgHizmetleri | Where-Object { $hedef -and (IcerirI $_.Yol ([string]$hedef).TrimEnd('\')) })
    if ($aday.Count -eq 1) { $E.PgHizmeti = $aday[0].Ad; Ok "PostgreSQL: hizmet $($aday[0].Ad) ($($aday[0].Durum)) - DOKUNULMAZ, yalniz backend bagimliligi" }
    elseif ($E.PgHizmetleri.Count -eq 1 -and -not $hedef) { $E.PgHizmeti = $E.PgHizmetleri[0].Ad; Ok "PostgreSQL: hizmet $($E.PgHizmeti) - DOKUNULMAZ, yalniz backend bagimliligi" }
    else { Uyar "PostgreSQL hizmeti tekil olarak bulunamadi ($(@($E.PgHizmetleri | ForEach-Object { $_.Ad }) -join ', ')) - bagimliliksiz kaydedilir (-PgHizmeti <ad> ile verilebilir)" }
  }
  if (Test-Path -LiteralPath (Join-Path $E.Kok "pgsql\ornek.json")) { Bilgi "pgsql\ornek.json var - dokunulmaz" }
  # Guvenlik duvari: backend portuna gelen izin (program degil PORT kurali - node artik surumler\'den kosar).
  $E.DuvarGerekli = $false
  try { $kural = OsGuvenlikDuvari $E.Port } catch { $kural = $null }
  if ($null -eq $kural) { Uyar "guvenlik duvari olculemedi" }
  elseif ($kural.Count) { Ok "guvenlik duvari: port $($E.Port) izinli ($(@($kural | ForEach-Object { $_.Ad + ' [' + $_.Profil + ']' }) -join ', '))" }
  else { $E.DuvarGerekli = $true; Uyar "port $($E.Port) icin etkin PORT kurali yok (program kurali node'un eski yolunu tutabilir) - 'TeksERP API $($E.Port)' eklenecek (Domain+Private, LocalSubnet)" }
}

function DizinEnvanteri($E) {
  foreach ($d in @("lisans", "backups", "yedek-anahtar", "logs", "pg-setup")) {
    $y = Join-Path $E.Kok $d
    if (Test-Path -LiteralPath $y) { Bilgi "yerinde kalir: $y$(if (OsBaglantiMi $y) { ' (BAGLANTI - izni degismez)' })" }
  }
  $ak = Join-Path $E.Kok "yedek-anahtar"
  $E.Alicilar = @(Get-ChildItem -LiteralPath $ak -Filter "*.tkpub" -File -ErrorAction SilentlyContinue).Count
  if ($E.Alicilar) { Ok "yedek sifreleme: $($E.Alicilar) alici - gecis yedegi sifrelenir" } else { Bilgi "yedek sifreleme anahtari yok - gecis yedegi DUZ, korumali gecis dizininde" }
  if (Test-Path -LiteralPath (Join-Path $E.Kok "kurulum-gecmisi.jsonl")) { Bilgi "kurulum-gecmisi.jsonl yerinde kalir" }
  $gerek = [int64]($E.ZipBoyut * 1.2) + 500MB + [int64]($E.DbBoyut)
  try { $bos = OsBosAlan $E.Kok } catch { $bos = -1 }
  if ($bos -lt 0) { Uyar "bos alan olculemedi" }
  elseif ($bos -lt $gerek) { Engel "bos alan yetersiz: $([math]::Round($bos / 1MB)) MB (gereken ~$([math]::Round($gerek / 1MB)) MB)" }
  else { Ok "bos alan: $([math]::Round($bos / 1GB, 1)) GB" }
  $E.ProgramData = OsProgramData
}

# =============================================================================
# PLAN - kalemler sirali; N = kalem sayisi, ozet = metinlerin SHA-256 onu
# =============================================================================
function PlanKur($E) {
  $p = New-Object System.Collections.Generic.List[object]
  $ekle = { param($adim, $metin) $p.Add([pscustomobject]@{ No = $p.Count + 1; Adim = $adim; Metin = $metin }) }
  & $ekle "PAKET_AC" "paketi ac + dogrula: $([System.IO.Path]::GetFileName($E.Zip)) -> $($E.Kok)\surumler\$($E.Surum) ($($E.ZipDosyaSayisi) dosya)"
  & $ekle "CURRENT" "baglanti: $($E.Kok)\current -> surumler\$($E.Surum)"
  & $ekle "ISKELET" "dizin iskeleti + korumali izin (SYSTEM + Administrators): backend-hizmeti.ps1 -YalnizIskelet"
  & $ekle "YAPILANDIRMA" "yapilandirma\.env: app\.env + ecosystem env blogu ($(@($E.Ortam.anahtarlar).Count) anahtar karari)$(if ($E.Rclone) { ' + rclone.conf -> veri\' })"
  if ($E.Pm2 -and $E.Pm2.bizim -and [string]$E.Pm2.bizim.durum -ceq "online") { & $ekle "PM2_DURDUR" "KESINTI BASLAR - pm2 durdur: $($E.Pm2.bizim.ad) (PID $($E.Pm2.bizim.pid))" }
  & $ekle "YEDEK" "veritabani yedegi (dogrulanmis$(if ($E.Alicilar) { ', sifreli' } else { ', duz' })): $($E.Db.Ad) -> gecis\<damga>\"
  if ($E.Boot -and [string]$E.Boot.Durum -cne "Disabled") { & $ekle "ACILIS_KAPAT" "acilis gorevi kapat: $($E.Boot.Klasor)$($E.Boot.Ad) (pm2 resurrect)" }
  if ($E.DuvarGerekli) { & $ekle "DUVAR" "guvenlik duvari kurali ekle: TeksERP API $($E.Port) (TCP, Domain+Private, LocalSubnet)" }
  & $ekle "HIZMET_KAYIT" "hizmet kaydi + izinler: $($E.HizmetAdi) (NT SERVICE\$($E.HizmetAdi))$(if ($E.PgHizmeti) { ', bagimlilik ' + $E.PgHizmeti })"
  & $ekle "DOGRULAMA" "dogrulama baslatmasi (yalniz 127.0.0.1) + saglik: surum $($E.Surum) + DB$(if ($E.Kimlik) { ' + kimlik' })"
  & $ekle "BASLAT" "normal baslatma + saglik + LAN kimligi - KESINTI BITER"
  if ($E.Pm2 -and $E.Pm2.bizim) { & $ekle "PM2_SOKUM" "pm2 sokumu: delete $($E.Pm2.bizim.ad) + save --force$(if (-not @($E.Pm2.digerleri).Count) { ' + kill (daemon)' })" }
  & $ekle "YEDEKLE_BETIGI" "$($E.Kok)\yedekle.ps1 <- paketin hizmet-farkinda surumu (gorev adi/saati/argumanlari korunur)"
  & $ekle "GUNCELLEYICI" "guncelleyici: $GuncelleyiciAdi (LocalSystem) ikili + ayar.json + kayit + baslat"
  if ($PgKaydiYaz) { & $ekle "PG_KAYDI" "pgsql\ornek.json: kip harici, hizmet $($E.PgHizmeti)" }
  return ,$p.ToArray()
}
function PlanOzetiHesapla($plan) { return KisaOzet ((@($plan | ForEach-Object { "$($_.No)|$($_.Adim)|$($_.Metin)" })) -join "`n") }
function PlanBas($plan, $baslik) {
  Bolum $baslik
  foreach ($k in $plan) { Write-Host ("  {0,2}. {1}" -f $k.No, $k.Metin); Kayit ("{0,2}. {1}" -f $k.No, $k.Metin) }
}

# =============================================================================
# KALEMLER - her biri Is_<adim> ($E, $damga) ve Telafi_<adim> ($bas, $bit); telafi tekrar kosulabilir
# =============================================================================
function GeriDizin { $g = Join-Path $script:gdizin "geri"; if (-not (Test-Path -LiteralPath $g)) { New-Item -ItemType Directory -Path $g -Force | Out-Null }; return $g }
# Karantinaya tasima: hedef varsa ad sonuna sayi eklenir. Hicbir sey silinmez.
function Karantina($yol, $ad) {
  if (-not (Test-Path -LiteralPath $yol)) { return }
  $hedef = Join-Path (GeriDizin) $ad
  $i = 1
  while (Test-Path -LiteralPath $hedef) { $hedef = Join-Path (GeriDizin) "$ad.$i"; $i++ }
  Move-Item -LiteralPath $yol -Destination $hedef -Force
  Bilgi "karantina: $yol -> $hedef"
}

function Is_PAKET_AC($E) {
  $sur = Join-Path $E.Kok "surumler"
  $haz = Join-Path $sur ".hazirlik-$($E.Surum)"
  $hedef = Join-Path $sur $E.Surum
  if (-not (Test-Path -LiteralPath $sur)) { New-Item -ItemType Directory -Path $sur -Force | Out-Null }
  OsZipAc $E.Zip $haz
  $sayi = @(Get-ChildItem -LiteralPath $haz -Recurse -File -Force).Count
  if ($E.BeklenenDosya -and $sayi -ne $E.BeklenenDosya) { throw "acilan dosya sayisi $sayi, beyan $($E.BeklenenDosya)" }
  $pk = JsonOku (Join-Path $haz "PAKET.json")
  if ([string]$pk.derlemeKimligi -cne [string]$E.Paket.derlemeKimligi) { throw "acilan paketin derleme kimligi farkli" }
  foreach ($x in @("runtime\node.exe", "runtime\tekserp-hizmet.exe", "runtime\tekserp-guncelleyici.exe")) {
    if (-not (MzMi (Join-Path $haz $x))) { throw "$x Windows ikilisi degil (MZ yok)" }
  }
  $motor = Join-Path $haz "node_modules\@prisma\engines"
  if ((Test-Path -LiteralPath $motor) -and -not (Test-Path -LiteralPath (Join-Path $motor "schema-engine-windows.exe"))) { throw "pakette Windows sema motoru yok (schema-engine-windows.exe)" }
  Move-Item -LiteralPath $haz -Destination $hedef
  Ok "acildi ve dogrulandi: $hedef ($sayi dosya)"
  return @{ dosya = $sayi }
}
function Telafi_PAKET_AC($bas, $bit) {
  $sur = Join-Path $script:kok "surumler"
  if (-not (Test-Path -LiteralPath $sur)) { return }
  if (OsBaglantiMi (Join-Path $script:kok "current")) { throw "current hala bagli - once current telafisi" }
  if (-not $bas.surumlerVardi) { Karantina $sur "surumler" }
  else {
    Karantina (Join-Path $sur ".hazirlik-$($bas.surum)") ".hazirlik-$($bas.surum)"
    Karantina (Join-Path $sur $bas.surum) "surum-$($bas.surum)"
  }
}

function Is_CURRENT($E) {
  $cur = Join-Path $E.Kok "current"
  $hedef = Join-Path (Join-Path $E.Kok "surumler") $E.Surum
  OsBaglantiKur $cur $hedef
  $t = OsBaglantiHedefi $cur
  if (-not (YolEsit $t $hedef)) { throw "current yanlis hedefi gosteriyor: $t" }
  Ok "current -> $hedef"
  return @{}
}
function Telafi_CURRENT($bas, $bit) {
  $cur = Join-Path $script:kok "current"
  if (OsBaglantiMi $cur) { OsBaglantiSil $cur; Bilgi "current baglantisi kaldirildi" }
  elseif (Test-Path -LiteralPath $cur) { Karantina $cur "current-dizin" }
}

function Is_ISKELET($E) {
  $kod = OsBetik $E.AclBetigi @{ Kok = $E.Kok; HizmetAdi = $E.HizmetAdi; Uygula = $true; YalnizIskelet = $true }
  if ($kod -ne 0) { throw "backend-hizmeti.ps1 -YalnizIskelet cikis $kod" }
  return @{}
}
function Telafi_ISKELET($bas, $bit) {
  # Onceden var olan yollarin erisim listesi gecis oncesine doner; bu gecisin yarattiklari bossa silinir, degilse karantinaya.
  foreach ($p in @($bas.acl.PSObject.Properties)) {
    if (Test-Path -LiteralPath $p.Name) {
      try { OsAclKoy $p.Name ([string]$p.Value); Bilgi "izin geri kondu: $($p.Name)" } catch { Uyar "izin geri konamadi: $($p.Name) - $($_.Exception.Message)" }
    }
  }
  $olusan = @($bas.olusacak | ForEach-Object { [string]$_ })
  $kokIci = { param($y) $y.StartsWith($script:kok + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -or $y.StartsWith($script:kok + "\", [System.StringComparison]::OrdinalIgnoreCase) }
  foreach ($y in @($olusan | Sort-Object { $_.Length } -Descending)) {
    if (-not (Test-Path -LiteralPath $y)) { continue }
    if (OsBaglantiMi $y) { continue }
    if (-not (& $kokIci $y)) {
      # Kok DISI: hicbir sey silinmez - bu gecisin yarattigi EN UST dizinin adi degistirilerek birakilir.
      $ust = Split-Path $y -Parent
      if ($olusan | Where-Object { YolEsit $_ $ust }) { continue }
      $yeni = "$y.gecis-geri-$($script:damga)"; Move-Item -LiteralPath $y -Destination $yeni; Bilgi "yeniden adlandirildi (kok disi, silinmez): $y -> $yeni"
      continue
    }
    $bos = -not @(Get-ChildItem -LiteralPath $y -Force -ErrorAction SilentlyContinue).Count
    if ($bos) { [System.IO.Directory]::Delete($y, $false); Bilgi "bu gecisin yarattigi bos dizin kaldirildi: $y" }
    else { Karantina $y ("dizin-" + (Split-Path $y -Leaf)) }
  }
}

function Is_YAPILANDIRMA($E) {
  $hedef = Join-Path $E.Kok "yapilandirma\.env"
  if (Test-Path -LiteralPath $hedef) { throw "yapilandirma\.env zaten var" }
  $girdi = [ordered]@{ kok = $E.Kok; eskiApp = $E.App; eskiEnv = (Join-Path $E.App ".env"); eko = $E.Eko; cikti = $hedef; damga = $script:damga; makineAnahtarlari = @(OsMakineAnahtarlari) }
  $r = OsDugum $E.NodeKurulu $E.YardimciKurulu "ortam" $girdi
  if ([string]$r.karar -cne "TAMAM" -or -not $r.yazildi) { throw "yapilandirma\.env yazilmadi: $(@($r.engeller) -join '; ')$($r.hata)" }
  Ok "yapilandirma\.env yazildi ($(@($r.anahtarlar).Count) anahtar karari; degerler basilmaz)"
  $kopya = $false
  if ($E.Rclone -and -not (Test-Path -LiteralPath $E.Rclone.Hedef)) {
    Copy-Item -LiteralPath $E.Rclone.Kaynak -Destination $E.Rclone.Hedef
    $kopya = $true
    Ok "rclone.conf -> $($E.Rclone.Hedef)"
  }
  return @{ rcloneKopya = $kopya }
}
function Telafi_YAPILANDIRMA($bas, $bit) {
  Karantina (Join-Path $script:kok "yapilandirma\.env") "yapilandirma.env"
  if ($bas.rclone -and ($null -eq $bit -or $bit.rcloneKopya)) {
    $veri = [string]$bas.rclone.Hedef; $kok = [string]$bas.rclone.Kaynak
    if (Test-Path -LiteralPath $veri) {
      # Hizmet duzenindeyken Drive belirteci yenilendiyse yenisi eski yere doner (eskisi karantinada).
      if ((Test-Path -LiteralPath $kok) -and (OsOzet $veri) -cne (OsOzet $kok)) {
        Copy-Item -LiteralPath $kok -Destination (Join-Path (GeriDizin) "rclone.conf.gecis-oncesi") -Force
        Copy-Item -LiteralPath $veri -Destination $kok -Force
        Bilgi "rclone.conf: hizmet duzeninde guncellenen belirtec eski yerine dondu"
      }
      Karantina $veri "veri-rclone.conf"
    }
  }
}

function Is_PM2_DURDUR($E) {
  $ad = [string]$E.Pm2.bizim.ad
  $r = OsPm2 @("stop", $ad)
  if ($r.Kod -ne 0) { throw "pm2 stop $ad basarisiz ($($r.Kod)): $($r.Metin)" }
  for ($i = 0; $i -lt 30; $i++) {
    if (-not @(OsDinleyenler $E.Port).Count) { Ok "pm2 durdu: $ad (port $($E.Port) bos)"; return @{} }
    OsBekle 1
  }
  throw "pm2 durduruldu ama port $($E.Port) 30 sn icinde bosalmadi"
}
function Telafi_PM2_DURDUR($bas, $bit) {
  $ad = [string]$bas.ad
  $daemon = @(OsPm2Daemon).Count
  if ($daemon) {
    $l = OsPm2 @("jlist")
    if (IcerirI (@($l.Satirlar) -join "`n") "`"name`":`"$ad`"") { $r = OsPm2 @("start", $ad) } else { $r = OsPm2 @("resurrect") }
    if ($r.Kod -ne 0) { Uyar "pm2 baslatilamadi ($($r.Kod)): $($r.Metin)" }
  } elseif ($bas.boot) {
    OsGorevBaslat ([string]$bas.boot.Ad) ([string]$bas.boot.Klasor)
    Bilgi "acilis gorevi baslatildi (pm2 resurrect, SYSTEM)"
  } else {
    $r = OsPm2 @("resurrect")
    if ($r.Kod -ne 0) { Uyar "pm2 resurrect basarisiz ($($r.Kod)): $($r.Metin)" }
  }
  for ($i = 0; $i -lt 45; $i++) {
    $h = SaglikOku $bas.port 5
    if ($h -and [string]$h.status -ceq "UP") { Ok "eski backend geri geldi: $($h.status) / DB $($h.db) / v$($h.version)"; return }
    OsBekle 2
  }
  throw "pm2 backend'i 90 sn icinde saglikli donmedi (port $($bas.port))"
}

function Is_YEDEK($E) {
  $ad = "gecis-oncesi_$($E.Db.Ad)_$($script:damga).dump"
  $dosya = Join-Path $script:gdizin $ad
  $d = OsPgDump "$dosya.part"
  if ($d.Kod -ne 0 -or -not (Test-Path -LiteralPath "$dosya.part")) { throw "pg_dump basarisiz ($($d.Kod)): $($d.Metin)" }
  $v = OsPgListe "$dosya.part"
  if ($v.Kod -ne 0) { throw "yedek dogrulanamadi (pg_restore --list $($v.Kod))" }
  Move-Item -LiteralPath "$dosya.part" -Destination $dosya
  $sifreli = $false
  if ($E.Alicilar) {
    $arac = Join-Path $E.SurumDizini "dist\tools\yedek-sifrele.cjs"
    $s = OsSifrele $E.NodeKurulu $arac $dosya (Join-Path $E.Kok "yedek-anahtar")
    if ($s.Kod -eq 0 -and (Test-Path -LiteralPath "$dosya.tkenc") -and -not (Test-Path -LiteralPath $dosya)) { $dosya = "$dosya.tkenc"; $sifreli = $true }
    else { Uyar "gecis yedegi sifrelenemedi ($($s.Kod)) - DUZ kaldi (korumali dizinde): $dosya" }
  }
  $boy = (Get-Item -LiteralPath $dosya).Length
  Ok "yedek: $dosya ($([math]::Round($boy / 1MB, 1)) MB, dogrulandi$(if ($sifreli) { ', sifreli' }))"
  return @{ dosya = $dosya; boyut = $boy; sifreli = $sifreli }
}
function Telafi_YEDEK($bas, $bit) { }

function Is_ACILIS_KAPAT($E) {
  OsGorevKapat ([string]$E.Boot.Ad) ([string]$E.Boot.Klasor)
  Ok "acilis gorevi kapatildi: $($E.Boot.Ad)"
  return @{}
}
function Telafi_ACILIS_KAPAT($bas, $bit) {
  if ($bas.etkinIdi) { OsGorevAc ([string]$bas.ad) ([string]$bas.klasor); Bilgi "acilis gorevi yeniden acildi: $($bas.ad)" }
}

function Is_DUVAR($E) {
  OsGuvenlikDuvariEkle "TeksERP API $($E.Port)" $E.Port
  Ok "guvenlik duvari kurali eklendi: TeksERP API $($E.Port)"
  return @{ ad = "TeksERP API $($E.Port)" }
}
function Telafi_DUVAR($bas, $bit) { OsGuvenlikDuvariSil "TeksERP API $($bas.port)"; Bilgi "guvenlik duvari kurali kaldirildi: TeksERP API $($bas.port)" }

function Is_HIZMET_KAYIT($E) {
  $arg = @{ Kok = $E.Kok; HizmetAdi = $E.HizmetAdi; Uygula = $true }
  if ($E.PgHizmeti) { $arg.PgHizmeti = $E.PgHizmeti } else { $arg.PgYok = $true }
  $kod = OsBetik $E.AclBetigi $arg
  if ($kod -ne 0) { throw "backend-hizmeti.ps1 -Uygula cikis $kod (kayit/izin uyumsuz)" }
  return @{}
}
function Telafi_HIZMET_KAYIT($bas, $bit) {
  $ad = [string]$bas.hizmet
  if (-not (OsHizmet $ad)) { return }
  try { OsHizmetDurdur $ad } catch { }
  $exe = $null
  foreach ($y in @((Join-Path $script:kok "current\runtime\tekserp-hizmet.exe"), (Join-Path $script:kok "surumler\$($bas.surum)\runtime\tekserp-hizmet.exe"))) { if (Test-Path -LiteralPath $y) { $exe = $y; break } }
  $r = OsHizmetKaldir $exe $ad
  if ($r.Kod -ne 0) { throw "hizmet kaldirilamadi ($ad, $($r.Kod)): $($r.Metin)" }
  Bilgi "hizmet kaldirildi: $ad"
}

# Saglik: HTTP 200 + UP + DB UP + surum; ardindan kurulum kimligi (biliniyorsa) ayni.
function SaglikBekle($E, [string]$baslik) {
  $son = $null
  $bitis = (Get-Date).AddSeconds($SaglikSn)
  while ((Get-Date) -lt $bitis) {
    $h = SaglikOku $E.Port 5
    if ($h) { $son = $h; if ([string]$h.status -ceq "UP" -and [string]$h.db -ceq "UP" -and [string]$h.version -ceq $E.Surum) { break } }
    OsBekle 2
  }
  if (-not $son -or [string]$son.status -cne "UP" -or [string]$son.db -cne "UP" -or [string]$son.version -cne $E.Surum) {
    throw "$baslik saglik $SaglikSn sn icinde gelmedi (son: $(if ($son) { 'API ' + $son.status + ' / DB ' + $son.db + ' / v' + $son.version } else { 'cevap yok' }))"
  }
  if ($E.Kimlik) {
    # Kimlik onbellegi /health'ten SONRA dolar (acilis isi DB'den okur): null = henuz yok, beklenir; dolu ve farkli = hata.
    $k = $null
    $kimlikBitis = (Get-Date).AddSeconds($SaglikSn)
    do {
      $k = KimlikOku "127.0.0.1" $E.Port 5
      if ($k -and $k.installationId) { break }
      OsBekle 2
    } while ((Get-Date) -lt $kimlikBitis)
    if (-not $k -or -not $k.installationId) { throw "$baslik kurulum kimligi $SaglikSn sn icinde okunamadi" }
    if ([string]$k.installationId -cne $E.Kimlik) { throw "$baslik kurulum kimligi farkli: $($k.installationId) (beklenen $($E.Kimlik))" }
  }
  Ok "$($baslik): API UP / DB UP / v$($son.version)$(if ($E.Kimlik) { ' / kimlik ayni' })"
}
function HizmetTanisi($E) {
  $h = OsHizmet $E.HizmetAdi
  if ($h) { Uyar "hizmet $($h.Ad): $($h.Durum) (cikis $($h.Cikis), ozel $($h.OzelCikis); 12=.env yok, 14=current, 11=node/server.js)" }
  foreach ($l in @(Kuyruk (Join-Path $E.Kok "logs\hizmet.log") 15)) { Write-Host "     hizmet.log | $l" -ForegroundColor DarkGray }
  foreach ($l in @(Kuyruk (Join-Path $E.Kok "logs\backend-err.log") 15)) { Write-Host "     backend-err | $l" -ForegroundColor DarkGray }
}
function HizmetDurmasiniBekle($ad) {
  for ($i = 0; $i -lt 60; $i++) { $h = OsHizmet $ad; if (-not $h -or [string]$h.Durum -ceq "Stopped") { return } ; OsBekle 1 }
  throw "hizmet 60 sn icinde durmadi: $ad"
}

function Is_DOGRULAMA($E) {
  OsHizmetBaslat $E.HizmetAdi @("--dogrulama")
  try { SaglikBekle $E "dogrulama (127.0.0.1)" } catch { HizmetTanisi $E; throw }
  OsHizmetDurdur $E.HizmetAdi
  HizmetDurmasiniBekle $E.HizmetAdi
  return @{}
}
function Telafi_DOGRULAMA($bas, $bit) { if (OsHizmet ([string]$bas.hizmet)) { try { OsHizmetDurdur ([string]$bas.hizmet); HizmetDurmasiniBekle ([string]$bas.hizmet) } catch { Uyar "hizmet durdurulamadi: $($_.Exception.Message)" } } }

function Is_BASLAT($E) {
  OsHizmetBaslat $E.HizmetAdi @()
  try { SaglikBekle $E "normal baslatma" } catch { HizmetTanisi $E; throw }
  $ipler = @(OsIpv4)
  if (-not $ipler.Count) { Uyar "yerel IPv4 adresi bulunamadi - LAN kimligi olculemedi" }
  else {
    $iyi = @()
    foreach ($ip in $ipler) {
      $k = KimlikOku $ip $E.Port 5
      if ($k -and (-not $E.Kimlik -or [string]$k.installationId -ceq $E.Kimlik)) { $iyi += $ip }
    }
    if (-not $iyi.Count) { HizmetTanisi $E; throw "backend LAN adreslerinden ($($ipler -join ', ')) cevap vermiyor - istemciler baglanamaz (HOST?)" }
    Ok "LAN: $($iyi -join ', '):$($E.Port) kimlik ayni - panel/tablet ayni sunucuyu bulur"
  }
  return @{}
}
function Telafi_BASLAT($bas, $bit) { Telafi_DOGRULAMA $bas $bit }

function Is_PM2_SOKUM($E) {
  $ad = [string]$E.Pm2.bizim.ad
  $r = OsPm2 @("delete", $ad)
  if ($r.Kod -ne 0) { Uyar "pm2 delete $ad ($($r.Kod)): $($r.Metin)" }
  $r = OsPm2 @("save", "--force")
  if ($r.Kod -ne 0) { throw "pm2 save basarisiz ($($r.Kod))" }
  if (-not @($E.Pm2.digerleri).Count) {
    $r = OsPm2 @("kill")
    if ($r.Kod -ne 0) { Uyar "pm2 kill ($($r.Kod)): $($r.Metin)" }
    if (@(OsPm2Daemon).Count) { Uyar "pm2 daemon hala calisiyor" } else { Ok "pm2 daemon durdu (moduller dahil)" }
  }
  Ok "pm2'de TeksERP backend'i yok - acilis gorevi kapali, dump bos (eski dump gecis dizininde)"
  return @{}
}
function Telafi_PM2_SOKUM($bas, $bit) {
  # ($HOME otomatik ve salt okunur bir degiskendir - yerel ad farkli.)
  $pm2Ev = $script:pm2Home
  foreach ($f in @("dump.pm2", "dump.pm2.bak")) {
    $kopya = Join-Path $script:gdizin "kopya\$f"
    if (Test-Path -LiteralPath $kopya) { Copy-Item -LiteralPath $kopya -Destination (Join-Path $pm2Ev $f) -Force; Bilgi "pm2 $f gecis oncesine dondu" }
  }
}

function Is_YEDEKLE_BETIGI($E) {
  $kaynak = Join-Path $E.SurumDizini "yedekle.ps1"
  Copy-Item -LiteralPath $kaynak -Destination $E.KokYedekle -Force
  if ((OsOzet $E.KokYedekle) -cne (OsOzet $kaynak)) { throw "yedekle.ps1 kopyasi dogrulanamadi" }
  Ok "$($E.KokYedekle) <- surum $($E.Surum) (hizmet duzenini tanir; gorev degismedi)"
  return @{}
}
function Telafi_YEDEKLE_BETIGI($bas, $bit) {
  $hedef = [string]$bas.hedef
  $kopya = Join-Path $script:gdizin "kopya\yedekle.ps1"
  if ($bas.varIdi -and (Test-Path -LiteralPath $kopya)) { Copy-Item -LiteralPath $kopya -Destination $hedef -Force; Bilgi "yedekle.ps1 gecis oncesine dondu" }
  elseif (-not $bas.varIdi) { Karantina $hedef "yedekle.ps1" }
}

function Is_GUNCELLEYICI($E) {
  $arg = @{ Kok = $E.Kok; HizmetAdi = $GuncelleyiciAdi; BackendHizmeti = $E.HizmetAdi; GuncellemeSunucusu = $GuncellemeSunucusu; Uygula = $true }
  if ($Vekil) { $arg.Vekil = $Vekil }
  $kod = OsBetik $E.GuncBetigiKurulu $arg
  if ($kod -ne 0) { throw "guncelleyici-hizmeti.ps1 -Uygula cikis $kod" }
  OsHizmetBaslat $GuncelleyiciAdi @()
  $durum = Join-Path $E.ProgramData "TeksERP\guncelleme\durum\durum.json"
  $bitis = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $bitis) {
    if (Test-Path -LiteralPath $durum) {
      try { $d = JsonOku $durum; Ok "guncelleyici calisiyor: durum $($d.durum)$(if ($d.hataKodu) { ' / ' + $d.hataKodu })$(if ($d.karar) { ' / karar ' + $d.karar.karar })"; return @{} } catch { }
    }
    OsBekle 3
  }
  Uyar "guncelleyici baslatildi ama 120 sn icinde durum.json yazmadi ($durum) - $($E.Kok)\guncelleyici\gunluk\ incelenmeli"
  return @{}
}
function Telafi_GUNCELLEYICI($bas, $bit) {
  $ad = [string]$bas.hizmet
  if (-not (OsHizmet $ad)) { return }
  try { OsHizmetDurdur $ad; HizmetDurmasiniBekle $ad } catch { }
  $r = OsHizmetKaldir (Join-Path $script:kok "guncelleyici\tekserp-guncelleyici.exe") $ad
  if ($r.Kod -ne 0) { throw "guncelleyici kaldirilamadi ($($r.Kod)): $($r.Metin)" }
  Bilgi "guncelleyici kaldirildi: $ad"
}

function Is_PG_KAYDI($E) {
  $yol = Join-Path $E.Kok "pgsql\ornek.json"
  if (Test-Path -LiteralPath $yol) { Bilgi "ornek.json zaten var - dokunulmadi"; return @{ yazildi = $false } }
  $h = if ($E.PgHizmeti) { OsHizmet $E.PgHizmeti } else { $null }
  $ikili = $null; $veri = $null
  if ($h -and ([string]$h.Yol -cmatch '"?([A-Za-z]:\\[^"]*?)\\bin\\pg_ctl\.exe"?')) { $ikili = $Matches[1] }
  if ($h -and ([string]$h.Yol -cmatch '-D\s+"([^"]+)"')) { $veri = $Matches[1] }
  $kayit = [ordered]@{ bicim = 1; kip = "harici"; hizmet = $E.PgHizmeti; surum = ($E.PgSurum -csplit '\s')[0]; derleme = ""; ikiliDizin = $ikili; oncekiIkiliDizin = $null; veriDizini = $veri; port = $E.Db.Port; kuruldu = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"); guncellendi = $null }
  [System.IO.File]::WriteAllText($yol, (($kayit | ConvertTo-Json) + "`n"), (New-Object System.Text.UTF8Encoding $false))
  Ok "pgsql\ornek.json yazildi (kip harici - guncelleyici PG'ye dokunmaz)"
  return @{ yazildi = $true }
}
function Telafi_PG_KAYDI($bas, $bit) { if ($null -eq $bit -or $bit.yazildi) { Karantina (Join-Path $script:kok "pgsql\ornek.json") "ornek.json" } }

# Kalem -> BASLADI verisi (telafinin ihtiyaci; adimdan ONCE yazilir).
function BaslangicVerisi($adim, $E) {
  switch ($adim) {
    "PAKET_AC"       { return @{ surum = $E.Surum; surumlerVardi = (Test-Path -LiteralPath (Join-Path $E.Kok "surumler")) } }
    "ISKELET"        { return @{ acl = $script:aclAnlik; olusacak = @($script:olusacak) } }
    "YAPILANDIRMA"   { return @{ rclone = $E.Rclone } }
    "PM2_DURDUR"     { return @{ ad = [string]$E.Pm2.bizim.ad; port = $E.Port; boot = $(if ($E.Boot) { @{ Ad = $E.Boot.Ad; Klasor = $E.Boot.Klasor } } else { $null }) } }
    "ACILIS_KAPAT"   { return @{ ad = [string]$E.Boot.Ad; klasor = [string]$E.Boot.Klasor; etkinIdi = ([string]$E.Boot.Durum -cne "Disabled") } }
    "DUVAR"          { return @{ port = $E.Port } }
    "HIZMET_KAYIT"   { return @{ hizmet = $E.HizmetAdi; surum = $E.Surum } }
    "DOGRULAMA"      { return @{ hizmet = $E.HizmetAdi } }
    "BASLAT"         { return @{ hizmet = $E.HizmetAdi } }
    "YEDEKLE_BETIGI" { return @{ hedef = $E.KokYedekle; varIdi = (Test-Path -LiteralPath $E.KokYedekle) } }
    "GUNCELLEYICI"   { return @{ hizmet = $GuncelleyiciAdi } }
    default          { return @{} }
  }
}
# Backend saglikli olana dek kalemler KRITIK: hata = otomatik geri alma. Sonrakiler uyarili devam.
$script:KRITIK = @("PAKET_AC", "CURRENT", "ISKELET", "YAPILANDIRMA", "PM2_DURDUR", "YEDEK", "ACILIS_KAPAT", "DUVAR", "HIZMET_KAYIT", "DOGRULAMA", "BASLAT")

$script:TELAFI_METNI = @{
  PAKET_AC = "surumler\<surum> karantinaya (gecis\<damga>\geri\)"; CURRENT = "current baglantisini kaldir (hedefe dokunmadan)"
  ISKELET = "onceden var olan dizinlerin izinleri gecis oncesine; yeni dizinler bossa kaldir, doluysa karantina"
  YAPILANDIRMA = "yapilandirma\.env (+ veri\rclone.conf) karantinaya; yenilenmis Drive belirteci eski yerine"
  PM2_DURDUR = "pm2 backend'ini yeniden baslat + saglik"; YEDEK = "(gecis yedegi gecis dizininde kalir)"
  ACILIS_KAPAT = "acilis gorevini yeniden ac"; DUVAR = "eklenen guvenlik duvari kuralini kaldir"
  HIZMET_KAYIT = "backend hizmetini durdur + kaldir (hizmet-kaldir)"; DOGRULAMA = "backend hizmetini durdur"; BASLAT = "backend hizmetini durdur"
  PM2_SOKUM = "pm2 dump.pm2'yi gecis oncesine dondur"; YEDEKLE_BETIGI = "<kok>\yedekle.ps1'i gecis oncesine dondur"
  GUNCELLEYICI = "guncelleyiciyi durdur + kaldir"; PG_KAYDI = "pgsql\ornek.json karantinaya"
}

# =============================================================================
# GERI ALMA ZINCIRI - gunlukteki BASLADI kalemleri TERS sirada telafi edilir
# =============================================================================
function TelafiZinciri($kayitlar) {
  $basladi = [ordered]@{}; $bitti = @{}; $telafiEdildi = @{}
  foreach ($k in $kayitlar) {
    if ($k.olay -ceq "BASLADI") { $basladi[[string]$k.adim] = $k.veri }
    elseif ($k.olay -ceq "BITTI") { $bitti[[string]$k.adim] = $k.veri }
    elseif ($k.olay -ceq "TELAFI_BITTI") { $telafiEdildi[[string]$k.adim] = $true }
  }
  $adimlar = @($basladi.Keys)
  [array]::Reverse($adimlar)
  $eksik = 0
  foreach ($a in $adimlar) {
    if ($telafiEdildi.ContainsKey($a)) { continue }
    GunlukYaz "TELAFI_BASLADI" $a $null
    try {
      & "Telafi_$a" $basladi[$a] $bitti[$a]
      GunlukYaz "TELAFI_BITTI" $a $null
    } catch {
      $eksik++
      GunlukYaz "TELAFI_HATA" $a @{ hata = (Maske $_.Exception.Message) }
      Write-Host "  X telafi $a basarisiz: $(Maske $_.Exception.Message)" -ForegroundColor Red
    }
  }
  return $eksik
}

# =============================================================================
# KIPLER
# =============================================================================
function GecisDiziniAc($E) {
  $script:damga = Get-Date -Format "yyyyMMdd_HHmmss"
  $ust = Join-Path $E.Kok "gecis"
  if (-not (Test-Path -LiteralPath $ust)) { New-Item -ItemType Directory -Path $ust -Force | Out-Null }
  OsKorumali $ust
  $script:gdizin = Join-Path $ust $script:damga
  New-Item -ItemType Directory -Path $script:gdizin -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $script:gdizin "kopya") -Force | Out-Null
  $script:gunluk = Join-Path $script:gdizin "gunluk.jsonl"
  $script:kayitDosyasi = Join-Path $script:gdizin "gecis.log"
  $script:sira = 0
  $script:kok = $E.Kok
}

function AnlikGoruntu($E) {
  # Izin anlik goruntusu (yalniz erisim bolumu, sir degil) ve bu gecisin yaratacagi dizinler.
  $acl = [ordered]@{}
  $yollar = @($E.Kok) + @($script:DIZINLER | ForEach-Object { Join-Path $E.Kok $_ })
  $pd = Join-Path $E.ProgramData "TeksERP"
  $yollar += @($pd, (Join-Path $pd "guncelleme"), (Join-Path $pd "guncelleme\niyet"), (Join-Path $pd "guncelleme\durum"), (Join-Path $pd "guncelleme\is"))
  $olusacak = @()
  foreach ($y in $yollar) {
    if (Test-Path -LiteralPath $y) { if (-not (OsBaglantiMi $y)) { $acl[$y] = OsAclAl $y } }
    elseif (-not (YolEsit $y (Join-Path $E.Kok "surumler"))) { $olusacak += $y }   # surumler\ PAKET_AC'nin (kendi telafisi)
  }
  $script:aclAnlik = $acl
  $script:olusacak = $olusacak
  foreach ($f in @("dump.pm2", "dump.pm2.bak")) {
    $y = Join-Path $script:pm2Home $f
    if (Test-Path -LiteralPath $y) { Copy-Item -LiteralPath $y -Destination (Join-Path $script:gdizin "kopya\$f") -Force }
  }
  if (Test-Path -LiteralPath $E.KokYedekle) { Copy-Item -LiteralPath $E.KokYedekle -Destination (Join-Path $script:gdizin "kopya\yedekle.ps1") -Force }
  if ($E.Boot) { try { [System.IO.File]::WriteAllText((Join-Path $script:gdizin "kopya\TeksERP-Backend-Boot.xml"), (OsGorevXml $E.Boot.Ad $E.Boot.Klasor)) } catch { Uyar "acilis gorevi disa aktarilamadi" } }
}

function KuruKip {
  Baslik "TeksERP GECIS (pm2 -> Windows hizmeti) - KURU (degisiklik yok)"
  # Gecmis kok: envanter yerine OLCUM raporu (pm2 izi aranmaz - beklenen yokluktur).
  if ([System.IO.Path]::IsPathRooted($Kok) -and $Kok.Length -ge 4) {
    $k0 = [System.IO.Path]::GetFullPath($Kok).TrimEnd('\', '/')
    $sg0 = SonGecis $k0
    if (([string]$sg0.Durum -cmatch '^BASARILI' -or [string]$sg0.Durum -ceq "TAMAMLANDI") -and (Test-Path -LiteralPath (Join-Path $k0 "current"))) {
      DurumRaporu ([ordered]@{ Kok = $k0; HizmetAdi = "TeksERP-Backend" })
      Write-Host ""
      Write-Host "  Geri donus: ... -GeriAl  |  pm2 kalintilarini arsivle: ... -Tamamla"
      exit 0
    }
  }
  $E = Envanter
  if ($E.Gecici) { Remove-Item -LiteralPath $E.Gecici -Recurse -Force -ErrorAction SilentlyContinue }
  if ($script:engeller.Count) {
    Bolum "ENGELLER ($($script:engeller.Count)) - plan UYGULANAMAZ"
    foreach ($x in $script:engeller) { Write-Host "  X $x" -ForegroundColor Red }
    exit 1
  }
  $plan = PlanKur $E
  PlanBas $plan "PLAN ($($plan.Count) kalem)"
  $oz = PlanOzetiHesapla $plan
  Write-Host ""
  Write-Host "  Uyarilar: $($script:uyarilar.Count)  |  plan ozeti: $oz"
  Write-Host "  Uygulamak icin (planla birebir; arada plan degisirse DURUR):"
  Write-Host "    powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Kok `"$($E.Kok)`" -Paket `"$($E.Zip)`" -Uygula -Onay $($plan.Count) -PlanOzeti $oz"
  exit 0
}

function UygulaKip {
  Baslik "TeksERP GECIS (pm2 -> Windows hizmeti) - UYGULA"
  $E = Envanter
  if ($E.Ssh -and -not $E.System -and -not $SshKabul) { Engel "SSH oturumu: oturum koparsa gecis yarida kalir - uzaktan-kos.ps1 ile kosun ya da -SshKabul" }
  if ($script:engeller.Count) {
    if ($E.Gecici) { Remove-Item -LiteralPath $E.Gecici -Recurse -Force -ErrorAction SilentlyContinue }
    Bolum "ENGELLER - HICBIR SEYE DOKUNULMADI"
    foreach ($x in $script:engeller) { Write-Host "  X $x" -ForegroundColor Red }
    exit 1
  }
  $plan = PlanKur $E
  $oz = PlanOzetiHesapla $plan
  if ($Onay -ne $plan.Count) { PlanBas $plan "PLAN ($($plan.Count) kalem)"; Dur "-Onay $Onay, plan $($plan.Count) kalem - kuru kosumdan bu yana plan degisti ya da onay eksik. HICBIR SEYE DOKUNULMADI." }
  if ($PlanOzeti -and $PlanOzeti -cne $oz) { PlanBas $plan "PLAN ($($plan.Count) kalem)"; Dur "plan ozeti $oz, onaylanan $PlanOzeti - plan degisti. HICBIR SEYE DOKUNULMADI." }
  GecisDiziniAc $E
  PlanBas $plan "PLAN ($($plan.Count) kalem, ozet $oz) - gecis dizini $($script:gdizin)"
  AnlikGoruntu $E
  # Lisans dizininin dosya ADLARI (icerik degil): gecis sonrasi "yerinde mi" olcumu bununla.
  $lisansAdlari = @(Get-ChildItem -LiteralPath (Join-Path $E.Kok "lisans") -File -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  GunlukYaz "PLAN" $null @{ damga = $script:damga; kok = $E.Kok; surum = $E.Surum; paket = @{ ad = [System.IO.Path]::GetFileName($E.Zip); sha256 = $E.ZipOzet; derleme = [string]$E.Paket.derlemeKimligi }; hizmet = $E.HizmetAdi; guncelleyici = $GuncelleyiciAdi; pg = $E.PgHizmeti; port = $E.Port; kimlik = $E.Kimlik; lisans = $lisansAdlari; kalemler = @($plan | ForEach-Object { $_.Adim }); ozet = $oz }
  $E.SurumDizini = Join-Path (Join-Path $E.Kok "surumler") $E.Surum
  $E.NodeKurulu = Join-Path $E.SurumDizini "runtime\node.exe"
  $E.YardimciKurulu = $E.Yardimci
  $E.GuncBetigiKurulu = $E.GuncBetigi
  $sonucUyari = $false
  foreach ($k in $plan) {
    $a = $k.Adim
    Bolum ("[{0}/{1}] {2}" -f $k.No, $plan.Count, $k.Metin)
    GunlukYaz "BASLADI" $a (BaslangicVerisi $a $E)
    try {
      $veri = & "Is_$a" $E
      GunlukYaz "BITTI" $a $veri
      if ($a -ceq "PAKET_AC") {
        # Ayni derleme: yardimci ve betikler artik kurulu surumden (gecici kopya silinir).
        foreach ($p in @(@("YardimciKurulu", "gecis\gecis-yardimci.cjs"), @("AclBetigi", "hizmet\backend-hizmeti.ps1"), @("GuncBetigiKurulu", "hizmet\guncelleyici-hizmeti.ps1"))) {
          $y = Join-Path $E.SurumDizini $p[1]
          if (Test-Path -LiteralPath $y) { $E[$p[0]] = $y }
        }
      }
    } catch {
      $hata = Maske $_.Exception.Message
      GunlukYaz "HATA" $a @{ hata = $hata }
      Write-Host "  X $a basarisiz: $hata" -ForegroundColor Red
      if ($script:KRITIK -ccontains $a) {
        Bolum "OTOMATIK GERI ALMA (veritabanina dokunulmamisti)"
        GunlukYaz "GERI_ALMA_BASLADI" $null @{ neden = $a }
        $eksik = TelafiZinciri (GunlukOku $script:gunluk)
        if ($E.Gecici) { Remove-Item -LiteralPath $E.Gecici -Recurse -Force -ErrorAction SilentlyContinue }
        if ($eksik) {
          GunlukYaz "SONUC" $null @{ sonuc = "GERI_ALMA_EKSIK"; hata = $hata }
          Write-Host ""; Write-Host "  !! GERI ALMA $eksik kalemde TAMAMLANAMADI - insan gerekir. Gunluk: $($script:gunluk)" -ForegroundColor Red
          Write-Host "     Tekrar denemek icin: -GeriAl -Uygula (telafiler tekrar kosulabilir)"
          exit 4
        }
        GunlukYaz "SONUC" $null @{ sonuc = "GERI_ALINDI"; hata = $hata; otomatik = $true }
        Write-Host ""; Write-Host "  Gecis geri alindi - pm2 duzeni gecis oncesindeki gibi. Sebep: $hata" -ForegroundColor Yellow
        exit 1
      }
      Uyar "$a tamamlanamadi (backend saglikli; gecis surer): $hata"
      $sonucUyari = $true
    }
  }
  if ($E.Gecici) { Remove-Item -LiteralPath $E.Gecici -Recurse -Force -ErrorAction SilentlyContinue }
  if ($script:uyarilar.Count) { $sonucUyari = $true }
  $sonuc = if ($sonucUyari) { "BASARILI_UYARILI" } else { "BASARILI" }
  GunlukYaz "SONUC" $null @{ sonuc = $sonuc; uyari = $script:uyarilar.Count }
  DurumRaporu $E
  Write-Host ""
  Write-Host "================================================================" -ForegroundColor $(if ($sonucUyari) { "Yellow" } else { "Green" })
  Write-Host "  GECIS TAMAM$(if ($sonucUyari) { ' - UYARILI (' + $script:uyarilar.Count + ')' })"
  Write-Host "================================================================"
  Write-Host "  Gunluk     : $($script:gunluk)"
  Write-Host "  Geri donus : powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Kok `"$($E.Kok)`" -GeriAl"
  Write-Host "  Birkac gun sorunsuz calistiktan sonra pm2 kalintilari: ... -Tamamla"
  exit $(if ($sonucUyari) { 3 } else { 0 })
}

# Gecis sonrasi olcum (parametresiz kosum da bunu basar).
function DurumRaporu($E) {
  Bolum "DURUM (olcum)"
  $kok = $E.Kok
  $sg = SonGecis $kok
  if ($sg.Durum -cne "YOK") { Bilgi "son gecis: $($sg.Damga) - $($sg.Durum)" }
  $plan = $null
  foreach ($x in $sg.Kayitlar) { if ($x.olay -ceq "PLAN") { $plan = $x.veri } }
  $ad = if ($plan) { [string]$plan.hizmet } else { $E.HizmetAdi }
  $gad = if ($plan) { [string]$plan.guncelleyici } else { $GuncelleyiciAdi }
  $port = if ($plan -and $plan.port) { [int]$plan.port } else { 4000 }
  $cur = OsBaglantiHedefi (Join-Path $kok "current")
  if ($cur) { Ok "current -> $cur" } else { Uyar "current baglantisi yok" }
  foreach ($h in @($ad, $gad)) { $s = OsHizmet $h; if ($s) { if ($s.Durum -ceq "Running") { Ok "hizmet $h calisiyor ($($s.Baslatma))" } else { Uyar "hizmet $h $($s.Durum)" } } else { Uyar "hizmet $h kayitli degil" } }
  $hl = SaglikOku $port 5
  if ($hl) { Ok "/health: $($hl.status) / DB $($hl.db) / v$($hl.version)" } else { Uyar "/health cevap vermiyor (port $port)" }
  if ($plan -and $plan.kimlik) { $k = KimlikOku "127.0.0.1" $port 5; if ($k -and [string]$k.installationId -ceq [string]$plan.kimlik) { Ok "kurulum kimligi ayni: $($plan.kimlik)" } else { Uyar "kurulum kimligi okunamadi ya da farkli" } }
  if (@(OsPm2Daemon).Count) { Uyar "pm2 daemon hala calisiyor" } else { Ok "pm2 daemon yok" }
  if ($plan -and $plan.lisans) {
    $eksik = @(@($plan.lisans) | Where-Object { -not (Test-Path -LiteralPath (Join-Path (Join-Path $kok "lisans") ([string]$_))) })
    if ($eksik.Count) { Uyar "lisans dizininde gecis oncesi dosya EKSIK: $($eksik -join ', ')" } else { Ok "lisans dizini yerinde ($(@($plan.lisans).Count) dosya; kira/HAK/kurulum anahtari gecis oncesindeki gibi)" }
  }
  $ky = Join-Path $kok "yedekle.ps1"; $cy = Join-Path $kok "current\yedekle.ps1"
  if ((Test-Path -LiteralPath $ky) -and (Test-Path -LiteralPath $cy)) {
    if ((OsOzet $ky) -ceq (OsOzet $cy)) { Ok "gece yedegi betigi = kurulu surumunku (hizmet duzenini tanir)" } else { Uyar "$ky kurulu surumunkinden farkli - gece yedegi hizmet duzenini tanimayabilir" }
  }
  try {
    foreach ($g in @(OsGorevler | Where-Object { $_.Ad.StartsWith("TeksERP", [System.StringComparison]::Ordinal) })) {
      if ($g.Ad -ceq "TeksERP-Backend-Boot") { if ($g.Durum -ceq "Disabled") { Ok "acilis gorevi kapali" } else { Uyar "acilis gorevi ACIK ($($g.Durum)) - pm2 resurrect hizmetle cakisir" } }
      elseif ($g.Ad.StartsWith("TeksERP-DB-Backup", [System.StringComparison]::Ordinal)) { Ok "gece yedegi gorevi: $($g.Ad) ($($g.Durum))" }
    }
  } catch { Uyar "gorevler olculemedi" }
  $durum = Join-Path (OsProgramData) "TeksERP\guncelleme\durum\durum.json"
  if (Test-Path -LiteralPath $durum) { try { $d = JsonOku $durum; Ok "guncelleyici durum.json: $($d.durum)$(if ($d.hataKodu) { ' / ' + $d.hataKodu }) | son canlilik $($d.sonCanlilik)" } catch { Uyar "durum.json okunamadi" } } else { Uyar "guncelleyici durum.json yok" }
  $acl = Join-Path $PSScriptRoot "..\hizmet\backend-hizmeti.ps1"
  if (Test-Path -LiteralPath (Join-Path $kok "current\hizmet\backend-hizmeti.ps1")) { $acl = Join-Path $kok "current\hizmet\backend-hizmeti.ps1" }
  if (Test-Path -LiteralPath $acl) {
    # Olcum kaydin KENDI PostgreSQL bagimliligiyla: parametresiz betik yalniz TeksERP-PostgreSQL'i bekler, harici PG'de yanlis UYUMSUZ der.
    $olcArg = @{ Kok = $kok; HizmetAdi = $ad }
    if ($plan -and ($plan.PSObject.Properties.Name -ccontains "pg")) { if ($plan.pg) { $olcArg.PgHizmeti = [string]$plan.pg } else { $olcArg.PgYok = $true } }
    $kod = OsBetik $acl $olcArg
    if ($kod -eq 0) { Ok "izin + kayit olcumu: UYUMLU" } else { Uyar "izin + kayit olcumu: UYUMSUZ (cikis $kod) - ayrinti yukarida" }
  }
}

function GeriAlKip {
  Baslik "TeksERP GECIS - GERI ALMA$(if ($Uygula) { '' } else { ' (KURU)' })"
  if (-not (OsYonetici)) { Dur "YONETICI PowerShell gerekir." }
  $kok = [System.IO.Path]::GetFullPath($Kok).TrimEnd('\', '/')
  $sg = SonGecis $kok
  if ($sg.Durum -ceq "YOK") { Dur "gecis gunlugu yok ($kok\gecis\) - geri alinacak gecis yok." }
  if ($sg.Durum -ceq "TAMAMLANDI") { Dur "gecis TAMAMLANMIS ($($sg.Damga)) - pm2 kalintilari arsivde; geri donus betikle yapilmaz (runbook: elle)." }
  if ($sg.Durum -ceq "GERI_ALINDI") { Dur "son gecis ($($sg.Damga)) zaten geri alinmis." }
  $script:kok = $kok; $script:gdizin = $sg.Dizin; $script:damga = $sg.Damga
  $script:gunluk = Join-Path $sg.Dizin "gunluk.jsonl"
  $script:kayitDosyasi = Join-Path $sg.Dizin "gecis.log"
  $script:sira = @($sg.Kayitlar | ForEach-Object { [int]$_.sira } | Measure-Object -Maximum).Maximum
  $script:pm2Home = Join-Path $kok "pm2-home"
  $yerel = Join-Path $kok "pm2\node_modules\.bin\pm2.cmd"
  $script:pm2Cmd = if (Test-Path -LiteralPath $yerel) { $yerel } else { $g = Get-Command pm2.cmd -ErrorAction SilentlyContinue; if ($g) { $g.Source } else { $null } }
  $basladi = @(); $telafi = @{}
  foreach ($k in $sg.Kayitlar) { if ($k.olay -ceq "BASLADI") { $basladi += [string]$k.adim } elseif ($k.olay -ceq "TELAFI_BITTI") { $telafi[[string]$k.adim] = $true } }
  [array]::Reverse($basladi)
  $plan = @($basladi | Where-Object { -not $telafi.ContainsKey($_) } | ForEach-Object -Begin { $i = 0 } -Process { $i++; [pscustomobject]@{ No = $i; Adim = $_; Metin = "$($_): $($script:TELAFI_METNI[$_])" } })
  PlanBas $plan "GERI ALMA PLANI ($($plan.Count) kalem, son gecis $($sg.Damga) - $($sg.Durum)) - veritabanina dokunulmaz (gecis dokunmamisti)"
  $oz = PlanOzetiHesapla $plan
  if (-not $Uygula) {
    Write-Host ""
    Write-Host "  Uygulamak icin: ... -GeriAl -Uygula -Onay $($plan.Count) -PlanOzeti $oz"
    exit 0
  }
  if ($Onay -ne $plan.Count) { Dur "-Onay $Onay, geri alma plani $($plan.Count) kalem - HICBIR SEYE DOKUNULMADI." }
  if ($PlanOzeti -and $PlanOzeti -cne $oz) { Dur "geri alma plan ozeti $oz, onaylanan $PlanOzeti - HICBIR SEYE DOKUNULMADI." }
  GunlukYaz "GERI_ALMA_BASLADI" $null @{ elle = $true }
  $eksik = TelafiZinciri $sg.Kayitlar
  if ($eksik) {
    GunlukYaz "SONUC" $null @{ sonuc = "GERI_ALMA_EKSIK" }
    Write-Host "  !! $eksik telafi tamamlanamadi - gunluk: $($script:gunluk); tekrar: -GeriAl -Uygula" -ForegroundColor Red
    exit 4
  }
  GunlukYaz "SONUC" $null @{ sonuc = "GERI_ALINDI"; otomatik = $false }
  Write-Host ""
  Write-Host "  GERI ALINDI - pm2 duzeni gecis oncesindeki gibi (kur.ps1 yeniden kullanilabilir). Gunluk: $($script:gunluk)" -ForegroundColor Green
  exit 0
}

function TamamlaKip {
  Baslik "TeksERP GECIS - TAMAMLA (pm2 kalintilari arsive)$(if ($Uygula) { '' } else { ' (KURU)' })"
  if (-not (OsYonetici)) { Dur "YONETICI PowerShell gerekir." }
  $kok = [System.IO.Path]::GetFullPath($Kok).TrimEnd('\', '/')
  $sg = SonGecis $kok
  if ([string]$sg.Durum -cnotmatch '^BASARILI') { Dur "son gecis basarili degil ($($sg.Durum)) - tamamlanacak bir sey yok." }
  $plan0 = $null; foreach ($x in $sg.Kayitlar) { if ($x.olay -ceq "PLAN") { $plan0 = $x.veri } }
  $h = OsHizmet ([string]$plan0.hizmet)
  $s = SaglikOku ([int]$plan0.port) 5
  if (-not $h -or $h.Durum -cne "Running" -or -not $s -or [string]$s.status -cne "UP") { Dur "backend hizmeti saglikli degil - once sorun cozulmeli (ya da -GeriAl)." }
  $script:kok = $kok; $script:gdizin = $sg.Dizin; $script:damga = $sg.Damga
  $script:gunluk = Join-Path $sg.Dizin "gunluk.jsonl"
  $script:kayitDosyasi = Join-Path $sg.Dizin "gecis.log"
  $script:sira = @($sg.Kayitlar | ForEach-Object { [int]$_.sira } | Measure-Object -Maximum).Maximum
  $arsiv = Join-Path $sg.Dizin "pm2-duzeni"
  $tasinacak = @()
  foreach ($d in @("app", "pm2", "pm2-home", "pm2-boot.cmd", "kur.ps1")) { $y = Join-Path $kok $d; if (Test-Path -LiteralPath $y) { $tasinacak += $y } }
  $tasinacak += @(Get-ChildItem -LiteralPath $kok -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -cmatch '^app\.(eski|iskelet|basarisiz)-\d{8}_\d{6}$' } | ForEach-Object { $_.FullName })
  if ((Test-Path -LiteralPath (Join-Path $kok "rclone.conf")) -and (Test-Path -LiteralPath (Join-Path $kok "veri\rclone.conf"))) { $tasinacak += (Join-Path $kok "rclone.conf") }
  $boot = $null
  try { $boot = @(OsGorevler | Where-Object { $_.Ad -ceq "TeksERP-Backend-Boot" }) | Select-Object -First 1 } catch { }
  $duz = @(Get-ChildItem -LiteralPath $sg.Dizin -Filter "gecis-oncesi_*.dump" -File -ErrorAction SilentlyContinue)
  $plan = New-Object System.Collections.Generic.List[object]
  if ($boot) { $plan.Add([pscustomobject]@{ No = $plan.Count + 1; Adim = "GOREV_SIL"; Metin = "acilis gorevi sil (XML gecis dizininde): $($boot.Ad) ($($boot.Durum))" }) }
  foreach ($t in $tasinacak) { $plan.Add([pscustomobject]@{ No = $plan.Count + 1; Adim = "TASI"; Metin = "arsive tasi: $t -> $arsiv\" }) }
  if (-not $DokumuKoru) { foreach ($d in $duz) { $plan.Add([pscustomobject]@{ No = $plan.Count + 1; Adim = "DOKUM_SIL"; Metin = "duz gecis yedegini sil: $($d.FullName)" }) } }
  PlanBas $plan "TAMAMLAMA PLANI ($($plan.Count) kalem) - bundan sonra -GeriAl betikle yapilamaz"
  $oz = PlanOzetiHesapla $plan
  if (-not $Uygula) { Write-Host ""; Write-Host "  Uygulamak icin: ... -Tamamla -Uygula -Onay $($plan.Count) -PlanOzeti $oz"; exit 0 }
  if ($Onay -ne $plan.Count) { Dur "-Onay $Onay, plan $($plan.Count) kalem - HICBIR SEYE DOKUNULMADI." }
  if ($PlanOzeti -and $PlanOzeti -cne $oz) { Dur "plan ozeti $oz, onaylanan $PlanOzeti - HICBIR SEYE DOKUNULMADI." }
  GunlukYaz "TAMAMLA_BASLADI" $null @{ kalem = $plan.Count }
  $sorun = 0
  if ($boot) {
    try { [System.IO.File]::WriteAllText((Join-Path $sg.Dizin "kopya\TeksERP-Backend-Boot.son.xml"), (OsGorevXml $boot.Ad $boot.Klasor)); OsGorevSil $boot.Ad $boot.Klasor; Ok "acilis gorevi silindi" } catch { $sorun++; Uyar "acilis gorevi silinemedi: $($_.Exception.Message)" }
  }
  if ($tasinacak.Count -and -not (Test-Path -LiteralPath $arsiv)) { New-Item -ItemType Directory -Path $arsiv -Force | Out-Null }
  foreach ($t in $tasinacak) { try { Move-Item -LiteralPath $t -Destination (Join-Path $arsiv (Split-Path $t -Leaf)); Ok "arsivlendi: $t" } catch { $sorun++; Uyar "tasinamadi: $t - $($_.Exception.Message)" } }
  if (-not $DokumuKoru) { foreach ($d in $duz) { try { Remove-Item -LiteralPath $d.FullName -Force; Ok "duz yedek silindi: $($d.Name)" } catch { $sorun++; Uyar "silinemedi: $($d.FullName)" } } }
  GunlukYaz "TAMAMLANDI" $null @{ sorun = $sorun }
  Write-Host ""
  Write-Host "  TAMAMLANDI$(if ($sorun) { ' - ' + $sorun + ' kalem uyarili' }). pm2 duzeni arsivi: $arsiv (haftalar sonra elle silinebilir)" -ForegroundColor $(if ($sorun) { "Yellow" } else { "Green" })
  exit $(if ($sorun) { 3 } else { 0 })
}

function Ana {
  # 5.1'in sistem vekili LAN adresine giden saglik istegini yakalamasin: dogrudan baglanti.
  try { [System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy } catch { }
  if ($GeriAl -and $Tamamla) { Dur "-GeriAl ve -Tamamla birlikte verilemez." }
  if ($GeriAl) { GeriAlKip }
  if ($Tamamla) { TamamlaKip }
  if ($Uygula) { UygulaKip }
  KuruKip
}

Ana
