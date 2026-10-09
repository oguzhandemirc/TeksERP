# =============================================================================
# gecis.ps1 HARNESS - sahte fabrika koku + sahte Windows (Os* sarmalayicilari) ile GERCEK akis
# =============================================================================
# pwsh 7 (macOS/Linux) ile kosar; Windows'a ozgu her cagri gecis.ps1'de Os* sarmalayicisindadir ve
# burada sahte durumla (sahte.json) degistirilir. Betigin geri kalani (envanter, plan, gunluk, kalemler,
# telafi zinciri, yardimci .cjs) AYNEN kosar. Bekci: Teks-Erp/scripts/test_gecis.ts.
#   pwsh deploy/test/gecis.harness.ps1 -Script deploy/gecis/gecis.ps1 -Taban <dizin> -Kip kur-ortam [-Degisiklik <ad>]
#   pwsh deploy/test/gecis.harness.ps1 -Script deploy/gecis/gecis.ps1 -Taban <dizin> -Kip kuru|uygula|gerial-kuru|gerial|tamamla-kuru|tamamla [-Onay N] [-Hata <ADIM>]
#   ... [-EkJson '{"ProvaKabul":true,...}']  ek parametreler (kipin parametrelerine eklenir; -Kip ham: YALNIZ bunlar -
#        kurunun bastigi komutun ayristirilmis hali aynen verilir)
#   -Degisiklik: derleme-farkli | goc-eksik | pm2-yabanci | gorev-yabanci | duvar-yok | testfabrika (sonekli kanal,
#        hazirlik lisans saticisi) | prova (PAKET.json prova=true)
# Olculmeyen (Windows'ta W3/D8): gercek SCM, icacls/ACL, junction, pm2, PostgreSQL, guvenlik duvari.
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][string]$Taban,
  [Parameter(Mandatory = $true)][string]$Kip,
  [int]$Onay = -1,
  [string]$PlanOzeti,
  [string]$Hata,
  [string]$Degisiklik,
  [string]$EkJson
)
$ErrorActionPreference = "Stop"
$kok = Join-Path $Taban "kok"
$durumYolu = Join-Path $Taban "sahte.json"
$cagriYolu = Join-Path $Taban "cagrilar.log"
$zip = Join-Path $Taban "tekserp-backend-2.14.0.zip"
$repo = Resolve-Path (Join-Path $PSScriptRoot "../..")

function Yaz($yol, $metin) { New-Item -ItemType Directory -Path (Split-Path $yol -Parent) -Force | Out-Null; [System.IO.File]::WriteAllText($yol, $metin) }
function Mz($yol) { New-Item -ItemType Directory -Path (Split-Path $yol -Parent) -Force | Out-Null; [System.IO.File]::WriteAllBytes($yol, [byte[]](0x4D, 0x5A, 0x90, 0x00)) }

if ($Kip -ceq "kur-ortam") {
  # --- paket agaci ---------------------------------------------------------------------------------------
  $pk = Join-Path $Taban "paket"
  Yaz (Join-Path $pk "dist/server.js") "// yukleyici"
  Yaz (Join-Path $pk "dist/tools/yedek-sifrele.cjs") "// arac"
  Yaz (Join-Path $pk "package.json") '{"name":"teks-erp","version":"2.14.0"}'
  Yaz (Join-Path $pk "prisma.config.js") "// config"
  Yaz (Join-Path $pk "prisma/schema.prisma") "// sema"
  foreach ($g in @("20260901000000_a", "20260902000000_b")) { Yaz (Join-Path $pk "prisma/migrations/$g/migration.sql") "SELECT 1;" }
  Mz (Join-Path $pk "runtime/node.exe"); Mz (Join-Path $pk "runtime/tekserp-hizmet.exe"); Mz (Join-Path $pk "runtime/tekserp-guncelleyici.exe")
  Yaz (Join-Path $pk "node_modules/prisma/build/index.js") "// prisma"
  Yaz (Join-Path $pk "node_modules/.prisma/client/default.js") "// istemci"
  Mz (Join-Path $pk "node_modules/@prisma/engines/schema-engine-windows.exe")
  Yaz (Join-Path $pk "butunluk.jws") "a.b.c"
  Yaz (Join-Path $pk "butunluk-liste.txt") "liste"
  Copy-Item (Join-Path $repo "deploy/yedekle.ps1") (Join-Path $pk "yedekle.ps1")
  New-Item -ItemType Directory -Path (Join-Path $pk "gecis"), (Join-Path $pk "hizmet") -Force | Out-Null
  Copy-Item (Join-Path $repo "deploy/gecis/gecis-yardimci.cjs") (Join-Path $pk "gecis/gecis-yardimci.cjs")
  Copy-Item (Join-Path $repo "deploy/gecis/gecis.ps1") (Join-Path $pk "gecis/gecis.ps1")
  Copy-Item (Join-Path $repo "deploy/hizmet/backend-hizmeti.ps1") (Join-Path $pk "hizmet/backend-hizmeti.ps1")
  Copy-Item (Join-Path $repo "deploy/hizmet/guncelleyici-hizmeti.ps1") (Join-Path $pk "hizmet/guncelleyici-hizmeti.ps1")
  Copy-Item (Join-Path $repo "deploy/hizmet/kanal-adlari.ps1") (Join-Path $pk "hizmet/kanal-adlari.ps1")
  Copy-Item (Join-Path $repo "deploy/hizmet/sema-hizasi.ps1") (Join-Path $pk "hizmet/sema-hizasi.ps1")
  $sayi = @(Get-ChildItem $pk -Recurse -File -Force).Count
  $paketJson = [ordered]@{ commit = "abc1234"; derlemeKimligi = "derleme-1"; uygulamaSurumu = "2.14.0"; dosyaSayisi = $sayi; korumali = $true; backendKanal = "adnansahin"; backendPm2Ad = "tekserp-backend-yeni"; backendHizmetAdi = "TeksERP-Backend"; backendLisansSunucusu = "https://lisans.etkiliyazilim.com"; lisansSunucusuVarsayilan = "https://lisans.etkiliyazilim.com"; prova = $false }
  if ($Degisiklik -ceq "testfabrika") { $paketJson.backendKanal = "testfabrika"; $paketJson.backendHizmetAdi = "TeksERP-Backend-testfabrika"; $paketJson.backendLisansSunucusu = "https://lisans-test.etkiliyazilim.com" }
  if ($Degisiklik -ceq "prova") { $paketJson.prova = $true }
  Yaz (Join-Path $pk "PAKET.json") ($paketJson | ConvertTo-Json)
  [System.IO.Compression.ZipFile]::CreateFromDirectory($pk, $zip)
  # --- pm2 duzenindeki kok -------------------------------------------------------------------------------
  $app = Join-Path $kok "app"
  Yaz (Join-Path $app "dist/server.js") "// yukleyici"
  Yaz (Join-Path $app "package.json") '{"name":"teks-erp","version":"2.14.0"}'
  if ($Degisiklik -ceq "derleme-farkli") { $paketJson.derlemeKimligi = "derleme-ESKI" }
  Yaz (Join-Path $app "PAKET.json") ($paketJson | ConvertTo-Json)
  Yaz (Join-Path $app ".env") "DATABASE_URL=`"postgresql://tekserp:gizli-parola@localhost:5432/tekserp_yeni?schema=public`"`r`nJWT_SECRET=`"jwt-gizli`"`r`nPORT=4000`r`n"
  Copy-Item (Join-Path $repo "Teks-Erp/ecosystem.config.js") (Join-Path $app "ecosystem.config.js")
  Yaz (Join-Path $kok "pg-setup/db-credentials.json") '{"db":"tekserp_yeni","port":5432,"user":"tekserp","pass":"gizli-parola"}'
  Mz (Join-Path $kok "pgsql/bin/psql.exe")
  $yuk = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('{"kanal":{"kod":"adnansahin","guncelSurumler":{"backend":"2.14.0"}},"bitis":"2026-12-01T00:00:00Z","guncelleme":{"kip":"ONAYLI","hedefSurum":null},"yaptirim":{"guncellemeDonuk":false}}')).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Yaz (Join-Path $kok "lisans/kira.jws") "e30.$yuk.imza"
  New-Item -ItemType Directory -Path (Join-Path $kok "backups"), (Join-Path $kok "logs") -Force | Out-Null
  Yaz (Join-Path $kok "rclone.conf") "[gdrive]`ntoken = gizli-belirtec`n"
  Yaz (Join-Path $kok "yedekle.ps1") "# ESKI yedekle.ps1 (pm2 donemi)"
  Yaz (Join-Path $kok "pm2-boot.cmd") "@echo off"
  Yaz (Join-Path $kok "pm2/node_modules/.bin/pm2.cmd") "@echo off"
  Yaz (Join-Path $kok "pm2-home/dump.pm2") '[{"name":"tekserp-backend-yeni"}]'
  New-Item -ItemType Directory -Path (Join-Path $Taban "programdata") -Force | Out-Null
  # --- sahte Windows durumu ----------------------------------------------------------------------------------
  $sahte = [ordered]@{
    pm2 = [ordered]@{ daemon = $true; uygulamalar = @([ordered]@{ ad = "tekserp-backend-yeni"; durum = "online"; pid = 1234; cwd = $app; betik = (Join-Path $app "dist/server.js") }); dump = @("tekserp-backend-yeni") }
    hizmetler = @([ordered]@{ Ad = "postgresql-tekserp"; Durum = "Running"; Baslatma = "Auto"; Yol = '"D:\PostgreSQL\16\bin\pg_ctl.exe" runservice -N "postgresql-tekserp" -D "D:\PostgreSQL\data" -w'; Hesap = "NT AUTHORITY\NetworkService"; Kip = "" })
    gorevler = @(
      [ordered]@{ Ad = "TeksERP-Backend-Boot"; Klasor = "\"; Durum = "Ready"; Eylem = "cmd.exe /c `"$kok\pm2-boot.cmd`"" },
      [ordered]@{ Ad = "TeksERP-DB-Backup-Yeni"; Klasor = "\"; Durum = "Ready"; Eylem = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$kok\yedekle.ps1`" -IkinciHedef `"E:\TeksERP-yedek`"" })
    duvar = $true
    goclar = @("20260901000000_a", "20260902000000_b")
    hata = ""
    acl = [ordered]@{}
  }
  if ($Degisiklik -ceq "goc-eksik") { $sahte.goclar = @("20260901000000_a") }
  if ($Degisiklik -ceq "pm2-yabanci") { $sahte.pm2.uygulamalar += [ordered]@{ ad = "baska-uygulama"; durum = "online"; pid = 777; cwd = "/x"; betik = "/x/app.js" } }
  if ($Degisiklik -ceq "gorev-yabanci") { $sahte.gorevler += [ordered]@{ Ad = "PM2-Baslat"; Klasor = "\"; Durum = "Ready"; Eylem = "cmd.exe /c pm2 resurrect" } }
  if ($Degisiklik -ceq "duvar-yok") { $sahte.duvar = $false }
  ($sahte | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $durumYolu -Encoding utf8
  "" | Set-Content -LiteralPath $cagriYolu
  Write-Host "ORTAM HAZIR: $kok"
  exit 0
}

# --- betigi yukle (son satirdaki `Ana` cagrisi olmadan), parametrelerle ------------------------------------
# Kopya paketin gecis\ dizinine: betik hizmet\kanal-adlari.ps1'i kendi komsusundan (paket duzeni) okur.
$metin = Get-Content -LiteralPath $Script -Raw
$metin = [regex]::Replace($metin, '(?m)^Ana\s*$', '')
$kopya = Join-Path (Join-Path (Join-Path $Taban "paket") "gecis") "gecis-yuklu.ps1"
[System.IO.File]::WriteAllText($kopya, $metin)
$p = @{ Kok = $kok; Paket = $zip; SaglikSn = 3 }
switch ($Kip) {
  "kuru"         { }
  "uygula"       { $p.Uygula = $true; $p.Onay = $Onay; if ($PlanOzeti) { $p.PlanOzeti = $PlanOzeti } }
  "gerial-kuru"  { $p.GeriAl = $true }
  "gerial"       { $p.GeriAl = $true; $p.Uygula = $true; $p.Onay = $Onay }
  "tamamla-kuru" { $p.Tamamla = $true }
  "tamamla"      { $p.Tamamla = $true; $p.Uygula = $true; $p.Onay = $Onay }
  "ham"          { $p = @{} }
  default        { throw "bilinmeyen kip $Kip" }
}
if ($EkJson) { foreach ($x in ($EkJson | ConvertFrom-Json).PSObject.Properties) { $p[$x.Name] = $x.Value } }
. $kopya @p

# --- sahte Windows ----------------------------------------------------------------------------------------------
$global:S = Get-Content -LiteralPath $durumYolu -Raw | ConvertFrom-Json
if ($Hata) { $global:S.hata = $Hata }
function Kaydet { ($global:S | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $durumYolu -Encoding utf8 }
function Cagri($m) { Add-Content -LiteralPath $cagriYolu -Value $m }
function Hizmet($ad) { return @($global:S.hizmetler | Where-Object { $_.Ad -ceq $ad }) | Select-Object -First 1 }
function BackendCalisiyor { return @($global:S.hizmetler | Where-Object { $_.Ad -cmatch '^TeksERP-Backend' -and $_.Durum -ceq "Running" }) | Select-Object -First 1 }
function Pm2Online { return @($global:S.pm2.uygulamalar | Where-Object { $_.durum -ceq "online" }) | Select-Object -First 1 }

function OsYonetici { return $true }
function OsSystemMi { return $false }
function OsSshMi { return $false }
function OsHizmetler { return @($global:S.hizmetler | ForEach-Object { [pscustomobject]@{ Ad = $_.Ad; Durum = $_.Durum; Baslatma = $_.Baslatma; Yol = $_.Yol; Hesap = $_.Hesap; Cikis = 0; OzelCikis = 0 } }) }
function OsHizmetBaslat($ad, [string[]]$ek) {
  $h = Hizmet $ad; if (-not $h) { throw "sahte: hizmet yok $ad" }
  $h.Durum = "Running"; $h.Kip = (@($ek) -join " "); $global:S | Add-Member -NotePropertyName kimlikBos -NotePropertyValue 0 -Force; Kaydet; Cagri "hizmet baslat $ad $($h.Kip)"
  if ($ad -cmatch '^TeksERP-Guncelleyici') {
    $veri = if ($global:S.PSObject.Properties.Name -ccontains "guncVeri" -and $global:S.guncVeri) { [string]$global:S.guncVeri } else { Join-Path $Taban "programdata/TeksERP" }
    Yaz (Join-Path $veri "guncelleme/durum/durum.json") '{"durum":"BEKLIYOR","hataKodu":"BELIRTEC_YOK","sonCanlilik":"2026-10-01T03:00:00Z"}'
  }
}
function OsHizmetDurdur($ad) { $h = Hizmet $ad; if ($h) { $h.Durum = "Stopped"; $h.Kip = ""; Kaydet; Cagri "hizmet durdur $ad" } }
function OsHizmetKaldir($exe, $ad) { $global:S.hizmetler = @($global:S.hizmetler | Where-Object { $_.Ad -cne $ad }); Kaydet; Cagri "hizmet kaldir $ad"; return [pscustomobject]@{ Kod = 0; Metin = "" } }
function OsOnarimGoreviSil($ad) { $var = @($global:S.gorevler | Where-Object { $_.Ad -ceq "$ad-Onarim" }); if (-not $var.Count) { return $false }; $global:S.gorevler = @($global:S.gorevler | Where-Object { $_.Ad -cne "$ad-Onarim" }); Kaydet; Cagri "onarim gorevi sil $ad"; return $true }
function OsNodeSurecleri { return @() }
function OsPm2Daemon { if ($global:S.pm2.daemon) { return @([pscustomobject]@{ Pid = 900; Ust = 1; Komut = "node pm2\lib\Daemon.js" }) } else { return @() } }
function OsDinleyenler([int]$port) { if (BackendCalisiyor) { return @(5555) } elseif (Pm2Online) { return @([int](Pm2Online).pid) } else { return @() } }
function OsPm2([string[]]$a) {
  Cagri "pm2 $($a -join ' ')"
  $u = $global:S.pm2
  switch ($a[0]) {
    "jlist" {
      $l = @($u.uygulamalar | ForEach-Object { [ordered]@{ name = $_.ad; pid = $_.pid; pm2_env = [ordered]@{ status = $_.durum; pm_cwd = $_.cwd; pm_exec_path = $_.betik; env = [ordered]@{ PORT = "4000"; HTTPS_PROXY = "http://vekil:8080" } } } })
      return [pscustomobject]@{ Kod = 0; Satirlar = @(("[" + ((@($l | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 5 })) -join ",") + "]")); Metin = "" }
    }
    "stop"      { foreach ($x in $u.uygulamalar) { if ($x.ad -ceq $a[1]) { $x.durum = "stopped" } } }
    "start"     { foreach ($x in $u.uygulamalar) { if ($x.ad -ceq $a[1]) { $x.durum = "online" } } }
    "delete"    { $u.uygulamalar = @($u.uygulamalar | Where-Object { $_.ad -cne $a[1] }) }
    "save"      { $u.dump = @($u.uygulamalar | ForEach-Object { $_.ad }); Yaz (Join-Path $kok "pm2-home/dump.pm2") ((@($u.dump) | ConvertTo-Json -Compress)) }
    "kill"      { $u.daemon = $false; $u.uygulamalar = @() }
    "resurrect" { Pm2Dirilt }
  }
  Kaydet
  return [pscustomobject]@{ Kod = 0; Satirlar = @(); Metin = "" }
}
function Pm2Dirilt {
  $u = $global:S.pm2
  $u.daemon = $true
  $dump = @(Get-Content -LiteralPath (Join-Path $kok "pm2-home/dump.pm2") -Raw | ConvertFrom-Json | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.name } })
  $u.uygulamalar = @($dump | ForEach-Object { [ordered]@{ ad = $_; durum = "online"; pid = 4321; cwd = (Join-Path $kok "app"); betik = (Join-Path $kok "app/dist/server.js") } })
}
function OsGorevler { return @($global:S.gorevler | ForEach-Object { [pscustomobject]@{ Ad = $_.Ad; Klasor = $_.Klasor; Durum = $_.Durum; Eylem = $_.Eylem } }) }
function OsGorevKapat($ad, $klasor) { foreach ($g in $global:S.gorevler) { if ($g.Ad -ceq $ad) { $g.Durum = "Disabled" } }; Kaydet; Cagri "gorev kapat $ad" }
function OsGorevAc($ad, $klasor) { foreach ($g in $global:S.gorevler) { if ($g.Ad -ceq $ad) { $g.Durum = "Ready" } }; Kaydet; Cagri "gorev ac $ad" }
function OsGorevBaslat($ad, $klasor) { Cagri "gorev baslat $ad"; if ($ad -ceq "TeksERP-Backend-Boot") { Pm2Dirilt; Kaydet } }
function OsGorevXml($ad, $klasor) { return "<Task>$ad</Task>" }
function OsGorevSil($ad, $klasor) { $global:S.gorevler = @($global:S.gorevler | Where-Object { $_.Ad -cne $ad }); Kaydet; Cagri "gorev sil $ad" }
function OsGuvenlikDuvari([int]$port) { if ($global:S.duvar) { return ,@([pscustomobject]@{ Ad = "TeksERP API $port"; Profil = "Domain, Private" }) } else { return ,@() } }
function OsGuvenlikDuvariEkle($ad, [int]$port) { $global:S.duvar = $true; Kaydet; Cagri "duvar ekle $ad" }
function OsGuvenlikDuvariSil($ad) { $global:S.duvar = $false; Kaydet; Cagri "duvar sil $ad" }
function OsIpv4 { return @("10.0.0.5") }
function OsBaglantiKur($baglanti, $hedef) { New-Item -ItemType SymbolicLink -Path $baglanti -Target $hedef | Out-Null; Cagri "baglanti kur current" }
function OsBaglantiSil($baglanti) { [System.IO.File]::Delete($baglanti); Cagri "baglanti sil current" }
function OsAclAl($yol) { return "D:AI(sahte)" }
function OsAclKoy($yol, $sddl) { Cagri "acl koy $(Split-Path $yol -Leaf)" }
function OsKorumali($yol) { Cagri "korumali $(Split-Path $yol -Leaf)" }
function OsHttp($url, [int]$sn) {
  $b = BackendCalisiyor
  $surum = $null; $db = "UP"
  if ($b) {
    $surum = "2.14.0"
    if ($global:S.hata -ceq "DOGRULAMA" -and $b.Kip -cmatch 'dogrulama') { $db = "DOWN" }
    if ($global:S.hata -ceq "BASLAT" -and -not ($b.Kip -cmatch 'dogrulama')) { $db = "DOWN" }
  } elseif (Pm2Online) { $surum = "2.14.0" }
  if (-not $surum) { return [pscustomobject]@{ Kod = 0; Govde = $null } }
  if ($url -cmatch '/health$') { return [pscustomobject]@{ Kod = 200; Govde = (@{ status = "UP"; db = $db; version = $surum } | ConvertTo-Json -Compress) } }
  if ($url -cmatch '/api/discovery/identity$') {
    # KIMLIK_GEC: gercek backend'de kimlik onbellegi /health'ten sonra dolar (thinkpad-1 D8c) - her baslatmadan sonra ilk 3 okuma null.
    $id = "kurulum-kimligi-1"
    if ($b -and $global:S.hata -ceq "KIMLIK_GEC" -and [int]$global:S.kimlikBos -lt 3) { $global:S.kimlikBos = [int]$global:S.kimlikBos + 1; Kaydet; $id = $null }
    if ($b -and $global:S.hata -ceq "KIMLIK_FARKLI" -and $b.Kip -cmatch 'dogrulama') { $id = "baska-kurulum" }
    return [pscustomobject]@{ Kod = 200; Govde = (@{ installationId = $id; companyName = "Sahte Tekstil" } | ConvertTo-Json -Compress) }
  }
  return [pscustomobject]@{ Kod = 404; Govde = $null }
}
function OsBetik($betik, [hashtable]$arg) {
  $ad = Split-Path $betik -Leaf
  Cagri "betik $ad $(@($arg.Keys | Sort-Object | ForEach-Object { if ($arg[$_] -is [bool]) { '-' + $_ } else { '-' + $_ + '=' + $arg[$_] } }) -join ' ')"
  if ($ad -ceq "backend-hizmeti.ps1" -and $arg.Uygula -and $arg.YalnizIskelet) {
    foreach ($d in @("surumler", "yapilandirma", "lisans", "backups", "yedek-anahtar", "logs", "veri", "mobil-guncelleme", "rclone", "pg-setup", "guncelleyici")) { New-Item -ItemType Directory -Path (Join-Path $kok $d) -Force | Out-Null }
    $gd = if ($arg.GuncellemeDizini) { [string]$arg.GuncellemeDizini } else { Join-Path $Taban "programdata/TeksERP/guncelleme" }
    foreach ($d in @("niyet", "durum", "is")) { New-Item -ItemType Directory -Path (Join-Path $gd $d) -Force | Out-Null }
    return 0
  }
  if ($ad -ceq "backend-hizmeti.ps1" -and $arg.Uygula) {
    if (-not (Test-Path -LiteralPath (Join-Path $kok "current/runtime/tekserp-hizmet.exe"))) { return 1 }
    $global:S.hizmetler += [pscustomobject]@{ Ad = $arg.HizmetAdi; Durum = "Stopped"; Baslatma = "Auto"; Yol = "$kok\current\runtime\tekserp-hizmet.exe hizmet --kok $kok --ad $($arg.HizmetAdi)"; Hesap = "NT SERVICE\$($arg.HizmetAdi)"; Kip = "" }
    Kaydet; return 0
  }
  if ($ad -ceq "guncelleyici-hizmeti.ps1" -and $arg.Uygula) {
    Mz (Join-Path $kok "guncelleyici/tekserp-guncelleyici.exe")
    $global:S | Add-Member -NotePropertyName guncVeri -NotePropertyValue ([string]$arg.VeriDizini) -Force
    Yaz (Join-Path $kok "guncelleyici/ayar.json") '{"v":1}'
    $global:S.hizmetler += [pscustomobject]@{ Ad = $arg.HizmetAdi; Durum = "Stopped"; Baslatma = "Auto"; Yol = "$kok\guncelleyici\tekserp-guncelleyici.exe hizmet --kok $kok --ad $($arg.HizmetAdi)"; Hesap = "LocalSystem"; Kip = "" }
    Kaydet; return 0
  }
  return 0
}
function OsDugum($node, $yardimci, $komut, $girdi) {
  $json = $girdi | ConvertTo-Json -Compress -Depth 8
  $satirlar = @($json | & node $yardimci $komut)
  return ([string]$satirlar[-1] | ConvertFrom-Json)
}
function Psql($sql) {
  Cagri "psql $($sql.Substring(0, [math]::Min(30, $sql.Length)))"
  if ($sql -cmatch '^SHOW server_version') { return [pscustomobject]@{ Kod = 0; Satirlar = @("16.9"); Metin = "" } }
  if ($sql -cmatch '_prisma_migrations') { return [pscustomobject]@{ Kod = 0; Satirlar = @($global:S.goclar | ForEach-Object { "$_|T" }); Metin = "" } }
  if ($sql -cmatch 'pg_database_size') { return [pscustomobject]@{ Kod = 0; Satirlar = @("8000000"); Metin = "" } }
  return [pscustomobject]@{ Kod = 1; Satirlar = @(); Metin = "sahte: bilinmeyen sorgu" }
}
function OsPgDump($hedef) { [System.IO.File]::WriteAllText($hedef, "PGDMP"); Cagri "pg_dump"; return [pscustomobject]@{ Kod = 0; Metin = "" } }
function OsPgListe($dosya) { return [pscustomobject]@{ Kod = 0; Metin = "" } }
function OsSifrele($node, $arac, $dosya, $anahtarDizini) { return [pscustomobject]@{ Kod = 1; Metin = "" } }
function OsBosAlan($yol) { return [int64]100GB }
function OsMakineAnahtarlari { return @("PATH") }
function OsProgramData { return (Join-Path $Taban "programdata") }
function OsBekle([int]$sn) { Start-Sleep -Milliseconds 20 }

Ana
