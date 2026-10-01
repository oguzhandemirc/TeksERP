# =============================================================================
# KURULUM HARNESS (Dagitim v2 D5) - kurulum-ortak.ps1'in SAF islevleri GERCEK kabukta
# =============================================================================
# Olculen: cevap semasi (CevapDogrula: KATI, SIRSIZ, tur/desen/secenek) - portSec (D4 altin vektorleri,
# deploy/pg/pg-sablon-vektorleri.json) - .env satiri (sade bicim) - sir adi - JSON ASCII kacisi - maske -
# surum onceligi (guncelleyicinin vektorleri) + gercek kurulu surum + eski paket engeli (D8d).
# Iki kultur: degismez + tr-TR ('I' tuzagi: (?i) ve ToLower() 'I'yi 'i'ye indirmez).
# Kosucular: Teks-Erp/scripts/test_kurulum_betikleri.ts (pwsh 7; mutasyon sondalari -Ortak ile) ve
#   .github/workflows/kurulum-windows.yml (Windows PowerShell 5.1 - asil hedef).
# CIKTI: "OK <ad>" / "HATA <ad>: <ayrinti>" / "ATLA <ad>: <sebep>" + "=== Sonuc: N gecti, M basarisiz ===".
# Cikis: 0 hepsi gecti - 1 en az bir HATA.
# =============================================================================
param([string]$Ortak, [string]$Sema, [string]$Ornek, [string]$Vektor, [string]$PgOrnek, [string]$SurumVektor)
$ErrorActionPreference = "Stop"
$depo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Ortak) { $Ortak = Join-Path $depo "deploy\kurulum\kurulum-ortak.ps1" }
if (-not $Sema) { $Sema = Join-Path $depo "deploy\kurulum\cevap-semasi.json" }
if (-not $Ornek) { $Ornek = Join-Path $depo "deploy\kurulum\ornek-cevap.json" }
if (-not $Vektor) { $Vektor = Join-Path $depo "deploy\pg\pg-sablon-vektorleri.json" }
if (-not $PgOrnek) { $PgOrnek = Join-Path $depo "deploy\pg\pg-ornegi.json" }
if (-not $SurumVektor) { $SurumVektor = Join-Path $depo "Teks-Erp\native\test-vektorleri\guncelleme-karar.json" }
. $Ortak

$script:gecti = 0
$script:kaldi = 0
function Olc([string]$ad, [bool]$tamam, [string]$ayrinti) {
  if ($tamam) { $script:gecti++; Write-Output "OK $ad" }
  else { $script:kaldi++; if (-not $ayrinti) { $ayrinti = "-" }; Write-Output "HATA ${ad}: $ayrinti" }
}
function Oku([string]$yol) { return (Get-Content -LiteralPath $yol -Raw -Encoding UTF8 | ConvertFrom-Json) }
# Dikkat: PowerShell degisken adlari buyuk/kucuk harf DUYARSIZ - [string]$Sema parametresine nesne atanirsa
# metne cevrilir; sema nesnesi ayri adda tutulur.
$semaNesne = Oku $Sema
function Cevap([string]$json) { return CevapDogrula ($json | ConvertFrom-Json) $semaNesne }
function HataIcerir($r, [string]$parca) { return @($r.hatalar | Where-Object { "$_".Contains($parca) }).Count -gt 0 }

function KulturleKos([string]$kultur, [scriptblock]$is) {
  $eski = [Threading.Thread]::CurrentThread.CurrentCulture
  try {
    [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo($kultur)
    & $is
  } finally { [Threading.Thread]::CurrentThread.CurrentCulture = $eski }
}

# --- Cevap semasi (iki kulturde) -----------------------------------------------------------------
$cevapOlc = {
  param([string]$e)
  $r = CevapDogrula (Oku $Ornek) $semaNesne
  Olc "cevap.ornek-gecerli$e" ($r.hatalar.Count -eq 0) ($r.hatalar -join " | ")
  $r = Cevap '{"v": 1}'
  Olc "cevap.varsayilanlar$e" ($r.hatalar.Count -eq 0 -and $r.deger["kok"] -ceq "C:\TeksERP" -and $r.deger["api.port"] -eq 4000 -and @($r.deger["api.agProfilleri"]).Count -eq 2) ($r.hatalar -join " | ")
  $r = Cevap '{}'
  Olc "cevap.surum-zorunlu$e" (HataIcerir $r "zorunlu alan yok: 'v'") ($r.hatalar -join " | ")
  $r = Cevap '{"v": 2}'
  Olc "cevap.surum-yanlis$e" (HataIcerir $r "surumu 2") ($r.hatalar -join " | ")
  $r = Cevap '{"v": 1, "pg": {"bilinmeyen": 1}}'
  Olc "cevap.bilinmeyen-alan$e" (HataIcerir $r "semada olmayan alan: 'pg.bilinmeyen'") ($r.hatalar -join " | ")
  $sirler = @("saticiHesabi.parola", "pg.password", "api.secret", "x.token", "guncelleme.apikey", "saticiHesabi.pin", "yedek.sifre", "yedek.anahtarSifresi", "saticiHesabi.PAROLA", "yedek.SIFRE")
  $kacan = @()
  foreach ($s in $sirler) {
    $p = $s -csplit '\.'
    $r = Cevap ('{"v": 1, "' + $p[0] + '": {"' + $p[1] + '": "x"}}')
    if (-not (HataIcerir $r "sir tasiyamaz: '$s'")) { $kacan += $s }
  }
  Olc "cevap.sir-alan-red$e" ($kacan.Count -eq 0) ("sir sayilmadi: " + ($kacan -join ", "))
  $yanlis = @(@("yedek.sifreleme", "api.port", "saticiHesabi.kullaniciAdi", "x.spinner", "x.pinyon", "x.sifreleme") | Where-Object { SirAdiMi $_ })
  Olc "cevap.sir-adi-dar$e" ($yanlis.Count -eq 0) ("sir sanildi: " + ($yanlis -join ", "))
  $r = Cevap '{"v": 1, "api": {"port": "4000"}}'
  Olc "cevap.tur-sayi$e" (HataIcerir $r "api.port tamsayi olmali") ($r.hatalar -join " | ")
  $r = Cevap '{"v": 1, "api": {"port": 80}}'
  Olc "cevap.sayi-aralik$e" (HataIcerir $r "api.port en az 1025") ($r.hatalar -join " | ")
  $r = Cevap '{"v": 1, "api": {"mdns": "evet"}}'
  Olc "cevap.tur-mantik$e" (HataIcerir $r "api.mdns true/false") ($r.hatalar -join " | ")
  $kotu = @()
  foreach ($y in @("C:\\Teks ERP", "C:\\a\\..\\b", "TeksERP", "C:/TeksERP", "\\\\sunucu\\pay", "C:\\T\u00fcrk\u00e7e")) {
    $r = Cevap ('{"v": 1, "kok": "' + $y + '"}')
    if (-not (HataIcerir $r "kok mutlak")) { $kotu += $y }
  }
  $r = Cevap '{"v": 1, "kok": "D:\\TeksERP-demo"}'
  Olc "cevap.tur-yol$e" ($kotu.Count -eq 0 -and $r.hatalar.Count -eq 0) ("kabul edilen kotu yol: " + ($kotu -join ", ") + " | iyi yol: " + ($r.hatalar -join " | "))
  $r = Cevap '{"v": 1, "guncelleme": {"sunucu": "http://guncelleme.ornek.com"}, "yedek": {"saat": "24:00"}}'
  Olc "cevap.desen$e" ((HataIcerir $r "guncelleme.sunucu bicimsiz") -and (HataIcerir $r "yedek.saat bicimsiz")) ($r.hatalar -join " | ")
  $r = Cevap '{"v": 1, "profil": "xyz", "api": {"izinliAdresler": ["Any"], "agProfilleri": ["Domain", "Domain"]}}'
  $r2 = Cevap '{"v": 1, "api": {"izinliAdresler": []}}'
  Olc "cevap.secenek-liste$e" ((HataIcerir $r "profil su degerlerden") -and (HataIcerir $r "izinliAdresler ogesi 'Any'") -and (HataIcerir $r "agProfilleri tekrar") -and (HataIcerir $r2 "en az 1 oge")) (($r.hatalar + $r2.hatalar) -join " | ")
  $r = Cevap '{"v": 1, "pg": {"veriDizini": null}, "kok": null}'
  Olc "cevap.bos$e" ((HataIcerir $r "kok bos olamaz") -and -not (HataIcerir $r "pg.veriDizini")) ($r.hatalar -join " | ")
  $sirli = @($semaNesne.alanlar.PSObject.Properties | Where-Object { SirAdiMi $_.Name } | ForEach-Object { $_.Name })
  Olc "cevap.sema-sirsiz$e" ($sirli.Count -eq 0) ("semada sir cagristiran alan: " + ($sirli -join ", "))
}
& $cevapOlc ""
$trEtkin = KulturleKos "tr-TR" { ("I".ToLower() -ceq ([string][char]0x131)) }
if ($trEtkin) { KulturleKos "tr-TR" { & $cevapOlc "@tr-TR" } }
else { Write-Output "ATLA cevap@tr-TR: kultur verisi yok (InvariantGlobalization) - 'I' tuzagi olculemedi" }

# --- portSec: D4 altin vektorleri (deploy/pg/lib/pg-ornegi.mjs portSec ile ayni kural) ------------
$vek = Oku $Vektor
$pg = Oku $PgOrnek
$bas = [int]$pg.port.baslangic; $bit = [int]$pg.port.bitis
$n = 0
foreach ($v in @($vek.port)) {
  $n++
  $mesgul = if ("$($v.girdi.mesgul)" -ceq "aralik") { @($bas..$bit) } else { @($v.girdi.mesgul | ForEach-Object { [int]$_ }) }
  $onceki = if ($v.girdi.PSObject.Properties["onceki"]) { $v.girdi.onceki } else { $null }
  $istenen = if ($v.girdi.PSObject.Properties["istenen"]) { $v.girdi.istenen } else { $null }
  $s = PortSec $mesgul $bas $bit $onceki $istenen
  $tamam = if ($v.beklenen.PSObject.Properties["hata"]) { [bool]$s.hata } else { -not $s.hata -and [int]$s.port -eq [int]$v.beklenen.port }
  Olc "port.$($v.ad)" $tamam ("sonuc: " + $(if ($s.hata) { "HATA $($s.hata)" } else { "$($s.port)" }))
}
Olc "port.vektor-kumesi-bos-degil" ($n -ge 5) "vektor sayisi $n"

# --- .env satiri (sade bicim; dotenv ve envfile.rs ayni okusun) ----------------------------------
$iyi = @("DATABASE_URL=postgresql://tekserp:a%2Bb@127.0.0.1:5433/tekserp?schema=public", "JWT_SECRET=abcDEF123", "PORT=4000", "TEKSERP_GUNCELLEME_DIZINI=C:/ProgramData/TeksERP-demo/guncelleme", "BACKUP_KEY_DIR=C:/TeksERP/yedek-anahtar", "EMPTY=")
$kotu = @('A="b"', "A='b'", "A=b c", "A=b#c", "A=C:\TeksERP", "a=b", "A =b", " A=b", "A=b`t")
$r1 = @($iyi | Where-Object { -not (EnvSatiriGecerli $_) })
$r2 = @($kotu | Where-Object { EnvSatiriGecerli $_ })
Olc "env.sade-kabul" ($r1.Count -eq 0) ("reddedilen iyi satir: " + ($r1 -join " ; "))
Olc "env.tirnak-bosluk-diyez-tersbolu-red" ($r2.Count -eq 0) ("kabul edilen kotu satir: " + ($r2 -join " ; "))

# --- JSON ASCII kacisi (sihirbaz/arac siniri) ----------------------------------------------------
$ornekler = @(([string][char]0x11E + [char]0xFC + [char]0x15F + [char]0x130 + '"\x'), ("a" + [char]1 + "b"), ([string][char]0xD83D + [char]0xDE00))
$bozuk = @()
foreach ($o in $ornekler) {
  $j = JsonAscii $o
  $ascii = $j -cmatch '^[\x20-\x7E]*$'
  $geri = ('{"a": ' + $j + '}' | ConvertFrom-Json).a
  if (-not $ascii -or $geri -cne $o) { $bozuk += $j }
}
Olc "json.ascii-gidis-donus" ($bozuk.Count -eq 0) ("bozuk: " + ($bozuk -join " ; "))

# --- Maske (gunluk ve sonuc satiri) ------------------------------------------------------------------
SirEkle "gizli-Parola-42"
$m1 = Maskele "baglanti gizli-Parola-42 ile"
$m2 = Maskele "postgresql://tekserp:p4ss@127.0.0.1:5433/x"
Olc "maske.kayitli-sir" ($m1 -ceq "baglanti *** ile") $m1
Olc "maske.url-kimligi" ($m2 -ceq "postgresql://***@127.0.0.1:5433/x") $m2

# --- Surum onceligi: guncelleyicinin vektorleri (version.rs ile AYNI kural) -----------------------
$sv = @((Oku $SurumVektor).kayitlar | Where-Object { "$($_.vektor.tur)" -ceq "surum-karsilastir" })
foreach ($v in $sv) {
  $c = SurumKarsilastir "$($v.vektor.a)" "$($v.vektor.b)"
  $tamam = if ($null -eq $v.beklenen) { $null -eq $c } else { $null -ne $c -and [int]$c -eq [int]$v.beklenen }
  Olc "surum.$($v.vektor.ad)" $tamam ("sonuc: " + $(if ($null -eq $c) { "null" } else { "$c" }) + " beklenen: " + $(if ($null -eq $v.beklenen) { "null" } else { "$($v.beklenen)" }))
}
Olc "surum.vektor-kumesi-bos-degil" ($sv.Count -ge 5) "vektor sayisi $($sv.Count)"

# --- Gercek kurulu surum + eski paket engeli (D8d: kaldirilip ESKI kitle yeniden kurulum) ----------
$gk = Join-Path ([IO.Path]::GetTempPath()) ("kurulum-harness-" + [guid]::NewGuid().ToString("N"))
try {
  $kk = Join-Path $gk "kok"; $vk = Join-Path $gk "veri"
  New-Item -ItemType Directory -Force -Path (Join-Path $kk "kurulum"), (Join-Path $vk "guncelleme\durum") | Out-Null
  [IO.File]::WriteAllText((Join-Path $kk "kurulum\kurulum.json"), '{"paket": {"surum": "2.14.0"}}')
  $ad = KuruluSurumAdaylari $kk $vk
  $en = EnYeniSurum $ad
  Olc "kurulu.yalniz-kayit" ($ad.Count -eq 1 -and $en.surum -ceq "2.14.0" -and $en.kaynak -ceq "kurulum.json") ("en yeni: $($en.surum) ($($en.kaynak)) aday $($ad.Count)")
  [IO.File]::WriteAllText((Join-Path $kk "kurulum-gecmisi.jsonl"), ('{"tur": "KURULUM", "yeniSurum": "2.14.5"}' + "`n" + '{"tur": "GERI_ALMA", "yeniSurum": "2.14.3"}' + "`n"))
  [IO.File]::WriteAllText((Join-Path $vk "guncelleme\durum\durum.json"), '{"kuruluSurum": "2.14.3"}')
  $en = EnYeniSurum (KuruluSurumAdaylari $kk $vk)
  Olc "kurulu.gecmisin-SON-satiri" ($en.surum -ceq "2.14.3") ("en yeni: $($en.surum) ($($en.kaynak)) - geri alinmis 2.14.5 sayilmamali")
  [IO.File]::WriteAllText((Join-Path $vk "guncelleme\durum\durum.json"), '{"kuruluSurum": "2.14.5"}')
  [IO.File]::WriteAllText((Join-Path $kk "kurulum-gecmisi.jsonl"), "bozuk satir`n")
  $en = EnYeniSurum (KuruluSurumAdaylari $kk $vk)
  Olc "kurulu.bayat-kayit-yerine-guncelleyici" ($en.surum -ceq "2.14.5" -and $en.kaynak -ceq "guncelleyici durum.json") ("en yeni: $($en.surum) ($($en.kaynak))")
  New-Item -ItemType Directory -Force -Path (Join-Path $kk "surumler\2.14.7") | Out-Null
  $cur = Join-Path $kk "current"; $hedef = Join-Path $kk "surumler\2.14.7"
  if ($env:OS -ceq "Windows_NT") { [void](NativeKos "cmd.exe" @("/c", "mklink", "/J", $cur, $hedef)) }
  else { New-Item -ItemType SymbolicLink -Path $cur -Target $hedef | Out-Null }
  $en7 = EnYeniSurum (KuruluSurumAdaylari $kk $vk)
  Olc "kurulu.current-baglantisi" ($en7.surum -ceq "2.14.7" -and $en7.kaynak -ceq "current baglantisi") ("en yeni: $($en7.surum) ($($en7.kaynak))")
  if (ReparseMi $cur) { [IO.Directory]::Delete($cur) }
  $e1 = EskiPaketEngeli $en "2.14.0"
  $e2 = EskiPaketEngeli $en "2.14.5"
  $e3 = EskiPaketEngeli $en "2.14.9"
  $e4 = EskiPaketEngeli $null "2.14.0"
  $e5 = EskiPaketEngeli $en "bicimsiz"
  Olc "kurulu.eski-paket-DUR" ($e1 -and $e1.Contains("2.14.5") -and $e1.Contains("2.14.0") -and $null -eq $e2 -and $null -eq $e3 -and $null -eq $e4 -and $e5) ("eski: '$e1' esit: '$e2' yeni: '$e3' kayitsiz: '$e4' bicimsiz: '$e5'")
} finally { Remove-Item -LiteralPath $gk -Recurse -Force -ErrorAction SilentlyContinue }

Write-Output "=== Sonuc: $($script:gecti) gecti, $($script:kaldi) basarisiz ==="
if ($script:kaldi -gt 0) { exit 1 }
exit 0
