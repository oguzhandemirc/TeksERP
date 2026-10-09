# =============================================================================
# CI DUMANI - iki Windows hizmetinin gercek SCM ile kurulum/baslat/durdur olcumu
# =============================================================================
# NE ZAMAN: yalniz CI (windows-latest, yonetici), `native-windows.yml`. Yerel makinede KOSMA:
#   gecici bir kok kurar, TeksERP-Backend ve TeksERP-Guncelleyici hizmetlerini kaydeder ve siler
#   (ayni adli gercek bir kurulum varsa ONU silerdi - betik bu yuzden once var olani reddeder).
# OLCER:
#   1. konak: hizmet-kur -> baslat -> /health (sahte backend) -> ortam sozlesmesi (TEKSERP_KOK,
#      TEKSERP_HIZMET_ADI, TEKSERP_KAPANIS=stdin, NODE_USE_SYSTEM_CA, NODE_OPTIONS silinmis, cwd =
#      cozulmus surum dizini) -> durdur = stdin "kapat" (duzgun kapanis) -> gunlukler
#   2. --dogrulama baslatma argumani -> yalniz 127.0.0.1 + TEKSERP_DOGRULAMA_KIPI
#   3. node olurse konak hata koduyla cikar, SCM kurtarmasi yeniden baslatir (yeni pid)
#   4. konak olurse is nesnesi node'u da oldurur (yetim node portu tutmaz)
#   5. guncelleyici: hizmet-kur -> baslat -> .env'de zorunlu anahtar (DATABASE_URL) yokken AYAR_EKSIK
#      (ileti anahtar adi tasir, deger degil) -> kok kurulum gibi daraltilir (sahip Administrators, korumali
#      DACL) ama surumler\ Authenticated Users'a yazilabilir -> IZIN_GUVENSIZ (gercek DACL olcumu, G11) ->
#      izin kaldirilinca durum.json (kira yok: DONDURULDU/KIRA_YOK + kalp atisi) -> is\ korumali DACL -> durdur
#   6. hizmet adi parametresi (ayni makinede ikinci kanal): konak --ad ile kendi sanal hesabi ve
#      TEKSERP_HIZMET_ADI; ACL KAYITTAN SONRA (sanal hesap kayitla dogar); guncelleyici --ad + --veri
#   7. karsilikli onarim (W1b, plan GUNCELLEYICI-SAGLAMLIK 4.7): hizmet-kur onarim gorevini kurar (SYSTEM) ->
#      ilk saglikli tur .lkg'yi kurar, gorev ona hizalanir -> ikili silinir + hizmet durur -> gorev (Start-
#      ScheduledTask) surumlu ImagePath'e dogrulanmis kopyayi koyar ve baslatir -> son 4 KB kesilir -> .lkg onar
#      onarir -> "Devre disi" + ikili yok: onarilmaz, cikis 14 + durum.json GUNCELLEYICI_KAPALI -> hizmet-kaldir
#      gorevi de siler -> kayit yokken de onarilmaz (cikis 14)
# ASCII: bilerek yalniz ASCII (PS 5.1 BOM'suz UTF-8'i ANSI okur).
# =============================================================================
param([Parameter(Mandatory = $true)][string]$Bin)
$ErrorActionPreference = "Stop"

function Adim($m) { Write-Host "== $m" -ForegroundColor Cyan }
function Dur($m) { Write-Host "XX $m" -ForegroundColor Red; exit 1 }

$adlar = @("TeksERP-Backend", "TeksERP-Guncelleyici", "TeksERP-Backend-duman", "TeksERP-Guncelleyici-duman")
foreach ($ad in $adlar) {
  if (Get-Service -Name $ad -ErrorAction SilentlyContinue) { Dur "$ad zaten kayitli - duman gercek kuruluma dokunmaz" }
}

$kok = Join-Path $env:RUNNER_TEMP "tekserp-duman"
$surum = "0.0.1-duman"
$ver = Join-Path $kok "surumler\$surum"
Remove-Item -Recurse -Force $kok -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$ver\runtime", "$ver\dist", "$kok\yapilandirma", "$kok\logs", "$kok\guncelleyici" | Out-Null
Copy-Item (Get-Command node).Source "$ver\runtime\node.exe"
Copy-Item (Join-Path $Bin "tekserp-hizmet.exe") "$ver\runtime\tekserp-hizmet.exe"
Copy-Item (Join-Path $Bin "tekserp-guncelleyici.exe") "$kok\guncelleyici\tekserp-guncelleyici.exe"
Set-Content -Encoding ascii "$ver\dist\server.js" @'
const http = require("http"), fs = require("fs"), path = require("path");
const port = Number(process.env.PORT || 4999);
const env = { kok: process.env.TEKSERP_KOK, ad: process.env.TEKSERP_HIZMET_ADI, kapanis: process.env.TEKSERP_KAPANIS,
  ca: process.env.NODE_USE_SYSTEM_CA, nodeOptions: process.env.NODE_OPTIONS ?? null, host: process.env.HOST ?? null,
  dogrulama: process.env.TEKSERP_DOGRULAMA_KIPI ?? null, cwd: process.cwd(), pid: process.pid };
http.createServer((q, s) => { s.writeHead(200, { "content-type": "application/json" });
  s.end(JSON.stringify({ status: "UP", db: "UP", version: "0.0.1-duman", env })); }).listen(port, process.env.HOST || "0.0.0.0");
console.log("duman backend dinliyor " + port);
process.stdin.setEncoding("utf8");
const bitir = () => { fs.writeFileSync(path.join(process.env.TEKSERP_KOK, "logs", "kapandi.txt"), "kapat"); process.exit(0); };
process.stdin.on("data", (d) => { if (d.includes("kapat")) bitir(); });
process.stdin.on("end", bitir);
'@
Set-Content -Encoding ascii "$kok\yapilandirma\.env" "PORT=4999`n"
cmd /c mklink /J "$kok\current" "$ver" | Out-Null

function Saglik($beklenen) {
  for ($i = 0; $i -lt 40; $i++) {
    try { $r = Invoke-RestMethod "http://127.0.0.1:4999/health" -TimeoutSec 2; if (-not $beklenen -or $r.env.pid -ne $beklenen) { return $r } } catch { }
    Start-Sleep -Milliseconds 500
  }
  Get-ChildItem "$kok\logs" | ForEach-Object { Write-Host "--- $($_.Name)"; Get-Content $_.FullName -ErrorAction SilentlyContinue }
  Dur "saglik yaniti yok"
}
function Bekle($ad, $durum) { (Get-Service $ad).WaitForStatus($durum, [TimeSpan]::FromSeconds(60)) }

try {
  Adim "1. konak: kayit + baslat + ortam sozlesmesi"
  & "$ver\runtime\tekserp-hizmet.exe" hizmet-kur --kok $kok --pg-yok
  if ($LASTEXITCODE -ne 0) { Dur "hizmet-kur $LASTEXITCODE" }
  $cfg = sc.exe qc TeksERP-Backend | Out-String
  if ($cfg -notmatch "NT SERVICE\\TeksERP-Backend") { Dur "hesap sanal hesap degil: $cfg" }
  if ($cfg -notmatch [regex]::Escape("current\runtime\tekserp-hizmet.exe")) { Dur "ImagePath current uzerinden degil: $cfg" }
  $priv = sc.exe qprivs TeksERP-Backend | Out-String
  if ($priv -notmatch "SeChangeNotifyPrivilege" -or $priv -match "SeImpersonatePrivilege") { Dur "ayricaliklar beklenen degil: $priv" }
  icacls $kok /grant "NT SERVICE\TeksERP-Backend:(OI)(CI)RX" | Out-Null
  icacls "$kok\logs" /grant "NT SERVICE\TeksERP-Backend:(OI)(CI)M" | Out-Null
  $env:NODE_OPTIONS = "--require C:\\yok.js"
  Start-Service TeksERP-Backend
  Bekle "TeksERP-Backend" "Running"
  $r = Saglik $null
  if ($r.env.kapanis -ne "stdin" -or $r.env.ad -ne "TeksERP-Backend" -or $r.env.ca -ne "1") { Dur "ortam sozlesmesi tutmuyor: $($r.env | ConvertTo-Json -Compress)" }
  if ($r.env.kok.TrimEnd('\') -ne $kok.TrimEnd('\')) { Dur "TEKSERP_KOK $($r.env.kok)" }
  if ($null -ne $r.env.nodeOptions) { Dur "NODE_OPTIONS silinmedi" }
  if (-not $r.env.cwd.EndsWith($surum)) { Dur "calisma dizini cozulmus surum dizini degil: $($r.env.cwd)" }
  if ($null -ne $r.env.dogrulama) { Dur "normal kipte dogrulama ortami var" }

  Adim "1b. durdur = stdin kapat (duzgun kapanis)"
  Stop-Service TeksERP-Backend
  Bekle "TeksERP-Backend" "Stopped"
  if (-not (Test-Path "$kok\logs\kapandi.txt")) { Dur "node kapat satirini almadi" }
  Remove-Item "$kok\logs\kapandi.txt"
  $out = Get-Content "$kok\logs\backend-out.log" -Raw
  if ($out -notmatch "duman backend dinliyor") { Dur "backend-out.log satiri yok" }
  if ($out -notmatch "^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d ") { Dur "satir damgasi yerel saat + ofset degil: $out" }

  Adim "2. --dogrulama: yalniz 127.0.0.1"
  sc.exe start TeksERP-Backend --dogrulama | Out-Null
  Bekle "TeksERP-Backend" "Running"
  $r = Saglik $null
  if ($r.env.host -ne "127.0.0.1" -or $r.env.dogrulama -ne "1") { Dur "dogrulama kipi ortami yok: $($r.env | ConvertTo-Json -Compress)" }
  Stop-Service TeksERP-Backend
  Bekle "TeksERP-Backend" "Stopped"

  Adim "3. node olurse SCM kurtarmasi yeniden baslatir"
  Start-Service TeksERP-Backend
  Bekle "TeksERP-Backend" "Running"
  $r = Saglik $null
  $ilk = $r.env.pid
  Stop-Process -Id $ilk -Force
  $r2 = Saglik $ilk
  if ($r2.env.pid -eq $ilk) { Dur "yeniden baslatma olcuulemedi" }
  Write-Host "   yeni pid $($r2.env.pid) (eski $ilk)"

  Adim "4. konak olurse is nesnesi node'u oldurur"
  $konak = (Get-CimInstance Win32_Service -Filter "Name='TeksERP-Backend'").ProcessId
  $node = $r2.env.pid
  Stop-Process -Id $konak -Force
  Start-Sleep -Seconds 2
  if (Get-Process -Id $node -ErrorAction SilentlyContinue) {
    # SCM kurtarmasi yeni bir konak baslatmis olabilir; eski node YASAMAMALI.
    Dur "konak oldu ama node ($node) yasiyor - yetim surec"
  }
  Stop-Service TeksERP-Backend -ErrorAction SilentlyContinue
  & "$ver\runtime\tekserp-hizmet.exe" hizmet-kaldir
  if (Get-Service -Name "TeksERP-Backend" -ErrorAction SilentlyContinue) { Dur "hizmet-kaldir silmedi" }

  Adim "5. guncelleyici: kayit + baslat + durum.json + ozel alan DACL"
  $veri = Join-Path $env:ProgramData "TeksERP"
  Remove-Item -Recurse -Force "$veri\guncelleme" -ErrorAction SilentlyContinue
  & "$kok\guncelleyici\tekserp-guncelleyici.exe" hizmet-kur --kok $kok
  if ($LASTEXITCODE -ne 0) { Dur "guncelleyici hizmet-kur $LASTEXITCODE" }
  Start-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Running"
  $durumYolu = "$veri\guncelleme\durum\durum.json"
  function DurumOku {
    for ($i = 0; $i -lt 60 -and -not (Test-Path $durumYolu); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Path $durumYolu)) { Get-Content "$kok\guncelleyici\gunluk\*.log" -ErrorAction SilentlyContinue; Dur "durum.json yazilmadi" }
    return (Get-Content $durumYolu -Raw | ConvertFrom-Json)
  }
  # .env yalniz PORT tasiyor: guncelleyicinin zorunlu anahtari yok -> hicbir sey yapilmaz (D2b).
  $d = DurumOku
  if ($d.durum -ne "BEKLIYOR" -or $d.hataKodu -ne "AYAR_EKSIK" -or $d.mesaj -notmatch "DATABASE_URL") { Dur "zorunlu anahtar yokken AYAR_EKSIK beklenirdi: $($d | ConvertTo-Json -Compress)" }
  Stop-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Stopped"
  Set-Content -Encoding ascii "$kok\yapilandirma\.env" "PORT=4999`nDATABASE_URL=`"postgresql://tekserp:duman-parola@127.0.0.1:5432/tekserp`"`n"
  # Kok kurulumdaki gibi: sahip Administrators, miras kesik, yalniz SYSTEM + Administrators yazar. surumler\
  # Authenticated Users'a yazilabilirken guncelleyici hicbir sey yapmamali (G11 / DAGK-3).
  icacls $kok /setowner "*S-1-5-32-544" /T /C /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { Dur "kok sahibi Administrators yapilamadi ($LASTEXITCODE)" }
  icacls $kok /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { Dur "kok DACL'i daraltilamadi ($LASTEXITCODE)" }
  icacls "$kok\surumler" /grant "*S-1-5-11:(OI)(CI)M" /Q | Out-Null
  Remove-Item -Force $durumYolu
  Start-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Running"
  $d = DurumOku
  if ($d.hataKodu -ne "IZIN_GUVENSIZ" -or $d.mesaj -notmatch "surumler" -or $d.mesaj -notmatch "S-1-5-11") { Dur "yabanci yazilabilir surumler\ icin IZIN_GUVENSIZ beklenirdi: $($d | ConvertTo-Json -Compress)" }
  Stop-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Stopped"
  icacls "$kok\surumler" /remove:g "*S-1-5-11" /Q | Out-Null
  Remove-Item -Force $durumYolu
  Start-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Running"
  $d = DurumOku
  if ((Get-Content $durumYolu -Raw) -match "duman-parola") { Dur "durum.json DB parolasini tasiyor" }
  if ($d.durum -ne "BEKLIYOR" -or $d.hataKodu -ne "KIRA_YOK" -or $d.kuruluSurum -ne $surum) { Dur "durum beklenen degil: $($d | ConvertTo-Json -Compress)" }
  if ($d.karar.karar -ne "DONDURULDU" -or $d.karar.neden -ne "KIRA_YOK") { Dur "karar beklenen degil: $($d.karar | ConvertTo-Json -Compress)" }
  if (-not $d.sonCanlilik -or $d.canlilikEsigiSn -lt 30) { Dur "kalp atisi alanlari yok: $($d | ConvertTo-Json -Compress)" }
  $acl = Get-Acl "$veri\guncelleme\is"
  if (-not $acl.AreAccessRulesProtected) { Dur "is\ DACL korumali degil (miras acik)" }
  $kimler = $acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique
  $fazla = $kimler | Where-Object { $_ -ne "S-1-5-18" -and $_ -ne "S-1-5-32-544" }
  if ($fazla) { Dur "is\ SYSTEM/Administrators disina acik: $($fazla -join ',')" }
  Stop-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Stopped"
  $kod = (Get-CimInstance Win32_Service -Filter "Name='TeksERP-Guncelleyici'").ExitCode
  if ($kod -ne 0) { Dur "guncelleyici cikis kodu $kod" }
  & "$kok\guncelleyici\tekserp-guncelleyici.exe" hizmet-kaldir

  Adim "6. hizmet adi parametresi (ikinci kanal): --ad + ACL kayittan SONRA + --veri"
  & "$ver\runtime\tekserp-hizmet.exe" hizmet-kur --kok $kok --pg-yok --ad TeksERP-Backend-duman
  if ($LASTEXITCODE -ne 0) { Dur "hizmet-kur --ad $LASTEXITCODE" }
  $cfg = sc.exe qc TeksERP-Backend-duman | Out-String
  if ($cfg -notmatch "NT SERVICE\\TeksERP-Backend-duman") { Dur "ikinci hizmetin hesabi kendi sanal hesabi degil: $cfg" }
  if ($cfg -notmatch "--ad TeksERP-Backend-duman") { Dur "ImagePath --ad tasimiyor: $cfg" }
  icacls $kok /grant "NT SERVICE\TeksERP-Backend-duman:(OI)(CI)RX" | Out-Null
  if ($LASTEXITCODE -ne 0) { Dur "sanal hesaba ACL kayittan sonra verilemedi ($LASTEXITCODE)" }
  icacls "$kok\logs" /grant "NT SERVICE\TeksERP-Backend-duman:(OI)(CI)M" | Out-Null
  Start-Service TeksERP-Backend-duman
  Bekle "TeksERP-Backend-duman" "Running"
  $r = Saglik $null
  if ($r.env.ad -ne "TeksERP-Backend-duman") { Dur "TEKSERP_HIZMET_ADI parametreden gelmedi: $($r.env.ad)" }
  Stop-Service TeksERP-Backend-duman
  Bekle "TeksERP-Backend-duman" "Stopped"
  & "$ver\runtime\tekserp-hizmet.exe" hizmet-kaldir --ad TeksERP-Backend-duman
  if (Get-Service -Name "TeksERP-Backend-duman" -ErrorAction SilentlyContinue) { Dur "hizmet-kaldir --ad silmedi" }
  $veri2 = Join-Path $env:RUNNER_TEMP "tekserp-duman-veri"
  Remove-Item -Recurse -Force $veri2 -ErrorAction SilentlyContinue
  & "$kok\guncelleyici\tekserp-guncelleyici.exe" hizmet-kur --kok $kok --veri $veri2 --ad TeksERP-Guncelleyici-duman
  if ($LASTEXITCODE -ne 0) { Dur "guncelleyici hizmet-kur --ad $LASTEXITCODE" }
  $cfg = sc.exe qc TeksERP-Guncelleyici-duman | Out-String
  if ($cfg -notmatch "--veri" -or $cfg -notmatch "--ad TeksERP-Guncelleyici-duman") { Dur "guncelleyici ImagePath --veri/--ad tasimiyor: $cfg" }
  Start-Service TeksERP-Guncelleyici-duman
  Bekle "TeksERP-Guncelleyici-duman" "Running"
  $durum2 = "$veri2\guncelleme\durum\durum.json"
  for ($i = 0; $i -lt 60 -and -not (Test-Path $durum2); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path $durum2)) { Dur "ikinci guncelleyici kendi veri kokune yazmadi" }
  Stop-Service TeksERP-Guncelleyici-duman
  Bekle "TeksERP-Guncelleyici-duman" "Stopped"
  & "$kok\guncelleyici\tekserp-guncelleyici.exe" hizmet-kaldir --ad TeksERP-Guncelleyici-duman
  if (Get-ScheduledTask -TaskPath "\TeksERP\" -TaskName "TeksERP-Guncelleyici-duman-Onarim" -ErrorAction SilentlyContinue) { Dur "hizmet-kaldir --ad onarim gorevini silmedi" }

  Adim "7. karsilikli onarim: gorev + silinen/kesilen ikili + devre disi"
  $gorevAdi = "TeksERP-Guncelleyici-Onarim"
  $asil = "$kok\guncelleyici\tekserp-guncelleyici.exe"
  $lkg = "$kok\guncelleyici\tekserp-guncelleyici.lkg.exe"
  $is = "$veri\guncelleme\is"
  Remove-Item -Recurse -Force "$veri\guncelleme" -ErrorAction SilentlyContinue
  function Gorev { Get-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorevAdi -ErrorAction SilentlyContinue }
  function HizmetIkilisi {
    $yol = (Get-CimInstance Win32_Service -Filter "Name='TeksERP-Guncelleyici'").PathName
    # hizmet-kur bosluksuz yolu tirnaksiz yazar; bosluklu yol tirnakli gelir.
    if ($yol -notmatch '^(?:"([^"]+)"|(\S+))') { Dur "ImagePath ikili tasimiyor: $yol" }
    if ($Matches[1]) { return $Matches[1] } else { return $Matches[2] }
  }
  function OnarimSayisi { if (Test-Path "$is\onarim.json") { @((Get-Content "$is\onarim.json" -Raw | ConvertFrom-Json).onarimlar).Count } else { 0 } }
  & $asil hizmet-kur --kok $kok
  if ($LASTEXITCODE -ne 0) { Dur "guncelleyici hizmet-kur $LASTEXITCODE" }
  $g = Gorev
  if (-not $g) { Dur "hizmet-kur onarim gorevini kurmadi" }
  if ($g.Principal.UserId -notmatch "SYSTEM" -or $g.Actions[0].Arguments -notmatch "^onar --kok") { Dur "gorev SYSTEM + onar degil: $($g.Principal.UserId) $($g.Actions[0].Arguments)" }
  Start-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Running"
  # Ilk saglikli tur .lkg'yi kurar; hizmet gorevi ona hizalar (onarici onarilan ikiliden bagimsiz).
  for ($i = 0; $i -lt 120 -and -not ((Test-Path $lkg) -and ((Gorev).Actions[0].Execute -match "lkg")); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path $lkg)) { Get-Content "$kok\guncelleyici\gunluk\*.log" -ErrorAction SilentlyContinue; Dur "ilk saglikli tur .lkg kurmadi" }
  if ((Gorev).Actions[0].Execute -notmatch "lkg") { Dur "gorev .lkg'ye hizalanmadi: $((Gorev).Actions[0].Execute)" }
  $boy = (Get-Item $asil).Length

  # 7a. Defender/elle silinme: ikili yok, hizmet durmus -> gorev onarir (surumlu ImagePath) ve baslatir.
  Stop-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Stopped"
  $exe = HizmetIkilisi
  Remove-Item -Force $exe
  Start-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorevAdi
  Bekle "TeksERP-Guncelleyici" "Running"
  $exe = HizmetIkilisi
  if ($exe -notmatch "\\guncelleyici\\s\\[^\\]+\\tekserp-guncelleyici\.exe$" -or -not (Test-Path $exe)) { Dur "onarim surumlu yola konmadi: $exe" }
  if ((Get-Item $exe).Length -ne $boy) { Dur "onarilan ikilinin boyu farkli" }
  for ($i = 0; $i -lt 60 -and (Get-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorevAdi).State -eq "Running"; $i++) { Start-Sleep -Milliseconds 500 }
  $sonuc = (Get-ScheduledTaskInfo -TaskPath "\TeksERP\" -TaskName $gorevAdi).LastTaskResult
  if ($sonuc -ne 0) { Dur "onarim gorevi cikis kodu $sonuc" }
  if ((OnarimSayisi) -ne 1) { Dur "onarim.json bir onarim tasimiyor: $(Get-Content "$is\onarim.json" -Raw)" }
  Write-Host "   gorev onardi: $exe"

  # 7b. Son 4 KB kesildi (yarim yazim): .lkg onar dogru kaynaktan geri koyar.
  Stop-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Stopped"
  $f = [IO.File]::Open($exe, "Open", "ReadWrite")
  $f.SetLength($f.Length - 4096)
  $f.Close()
  $cikti = & $lkg onar --kok $kok --veri $veri | Out-String
  if ($LASTEXITCODE -ne 0 -or $cikti -notmatch "BOZUK") { Dur "kesik ikili onarilmadi ($LASTEXITCODE): $cikti" }
  Bekle "TeksERP-Guncelleyici" "Running"
  if ((Get-Item (HizmetIkilisi)).Length -ne $boy) { Dur "kesik ikili geri konmadi" }
  if ((OnarimSayisi) -ne 2) { Dur "onarim sayaci 2 degil" }

  # 7c. Yonetici "Devre disi" yapti + ikili yok: ONARILMAZ, gorunur (cikis 14, GUNCELLEYICI_KAPALI).
  Stop-Service TeksERP-Guncelleyici
  Bekle "TeksERP-Guncelleyici" "Stopped"
  sc.exe config TeksERP-Guncelleyici start= disabled | Out-Null
  $exe = HizmetIkilisi
  Remove-Item -Force $exe
  $cikti = & $lkg onar --kok $kok --veri $veri | Out-String
  if ($LASTEXITCODE -ne 14) { Dur "devre disi hizmet icin cikis 14 beklenirdi ($LASTEXITCODE): $cikti" }
  $d = Get-Content $durumYolu -Raw | ConvertFrom-Json
  if ($d.hataKodu -ne "GUNCELLEYICI_KAPALI") { Dur "durum.json GUNCELLEYICI_KAPALI degil: $($d | ConvertTo-Json -Compress)" }
  if ((Test-Path $exe) -or (Get-Service TeksERP-Guncelleyici).Status -ne "Stopped" -or (Get-Service TeksERP-Guncelleyici).StartType -ne "Disabled") { Dur "yonetici karari geri alindi" }
  if ((OnarimSayisi) -ne 2) { Dur "devre disi hizmet onarim sayildi" }

  # 7d. hizmet-kaldir gorevi de siler; kayit yokken onar yine dokunmaz (cikis 14).
  & $lkg hizmet-kaldir
  if ($LASTEXITCODE -ne 0) { Dur "hizmet-kaldir $LASTEXITCODE" }
  if (Gorev) { Dur "hizmet-kaldir onarim gorevini silmedi" }
  & $lkg onar --kok $kok --veri $veri | Out-Null
  if ($LASTEXITCODE -ne 14) { Dur "kayitsiz hizmet icin cikis 14 beklenirdi ($LASTEXITCODE)" }
  Write-Host "OK duman: iki hizmet de beklenen gibi (varsayilan ve parametreli adlarla)" -ForegroundColor Green
}
finally {
  foreach ($ad in $adlar) {
    if (Get-Service -Name $ad -ErrorAction SilentlyContinue) { Stop-Service $ad -Force -ErrorAction SilentlyContinue; sc.exe delete $ad | Out-Null }
    Unregister-ScheduledTask -TaskPath "\TeksERP\" -TaskName "$ad-Onarim" -Confirm:$false -ErrorAction SilentlyContinue
  }
}
