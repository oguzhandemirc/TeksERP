# =============================================================================
# KURULUM HARNESS (Dagitim v2 D5) - kurulum-ortak.ps1'in SAF islevleri GERCEK kabukta
# =============================================================================
# Olculen: cevap semasi (CevapDogrula: KATI, SIRSIZ, tur/desen/secenek) - portSec (D4 altin vektorleri,
# deploy/pg/pg-sablon-vektorleri.json) - .env satiri (sade bicim) - sir adi - JSON ASCII kacisi - maske -
# surum onceligi (guncelleyicinin vektorleri) + gercek kurulu surum + eski paket engeli (D8d) + lisans saticisi
# karari (D8e: bos alan = paketin kanali, farkli deger UYARI, onarimda kayit korunur, eski paket beyanli) + D8e-3b:
# eski paket TEK giris, gecisli duzen (GECISLI), kanal hizmetinin koku (fail-closed), ag ayari kayittan.
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

# --- Lisans saticisi kanal kaydindan (D8e: bos alan = paketin kanali; farkli deger UYARI, engel degil) ------
# Eski paket (PAKET.json alani yok) BEYANLI istisna: bugunku davranis + uyari, fail-closed degil.
$T = "https://lisans-test.etkiliyazilim.com"; $P = "https://lisans.etkiliyazilim.com"; $X = "https://x.ornek.com:8443"
function LisOz($r) { return "etkili=$($r.etkili) kaynak=$($r.kaynak) yaz=$($r.yaz) uyari=$(@($r.uyarilar).Count): $(@($r.uyarilar) -join ' || ')" }
$r = LisansSunucusuKarari $T $P "" $null "testfabrika"
Olc "lisans.bos-alan-kanaldan" ($r.etkili -ceq $T -and $r.kaynak -ceq "kanal" -and $r.yaz -and @($r.uyarilar).Count -eq 0) (LisOz $r)
$r = LisansSunucusuKarari $P $P "" $null "demofabrika"
Olc "lisans.uretim-kanali-satir-yazmaz" ($r.etkili -ceq $P -and -not $r.yaz -and @($r.uyarilar).Count -eq 0) (LisOz $r)
$r = LisansSunucusuKarari $T $P "https://LISANS-TEST.etkiliyazilim.com/" $null "testfabrika"
Olc "lisans.esit-elle-uyarisiz" ($r.etkili -ceq $T -and $r.kaynak -ceq "kanal" -and $r.yaz -and @($r.uyarilar).Count -eq 0) (LisOz $r)
$r = LisansSunucusuKarari $T $P $P $null "testfabrika"
$u = "$(@($r.uyarilar) -join ' ')"
Olc "lisans.farkli-elle-UYARI" ($r.etkili -ceq $P -and $r.kaynak -ceq "cevap" -and -not $r.yaz -and $u.Contains("FARKLI") -and $u.Contains("beklenen $T") -and $u.Contains("girilen $P")) (LisOz $r)
$r = LisansSunucusuKarari $P $P $X $null "demofabrika"
Olc "lisans.farkli-elle-yazilir" ($r.etkili -ceq $X -and $r.yaz -and "$(@($r.uyarilar))".Contains("beklenen $P")) (LisOz $r)
$r = LisansSunucusuKarari "" "" "" $null ""
$r2 = LisansSunucusuKarari "" "" $X $null ""
Olc "lisans.eski-paket-uyarir-durmaz" ($null -eq $r.etkili -and -not $r.yaz -and "$(@($r.uyarilar))".Contains("kanal degerini tasimiyor") -and $r2.etkili -ceq $X -and $r2.yaz -and "$(@($r2.uyarilar))".Contains("kanal degerini tasimiyor")) ((LisOz $r) + " / " + (LisOz $r2))
$r = LisansSunucusuKarari $T $P "" $T "testfabrika"
Olc "lisans.onarim-kayit-korunur" ($r.etkili -ceq $T -and $r.kaynak -ceq "kayit" -and -not $r.yaz -and @($r.uyarilar).Count -eq 0) (LisOz $r)
$r = LisansSunucusuKarari $T $P "" "" "testfabrika"
Olc "lisans.onarim-satirsiz-varsayilan-UYARI" ($r.etkili -ceq $P -and $r.kaynak -ceq "kayit-varsayilan" -and -not $r.yaz -and "$(@($r.uyarilar))".Contains("beklenen $T")) (LisOz $r)
$r = LisansSunucusuKarari $T $P $P $T "testfabrika"
Olc "lisans.onarim-cevap-uygulanmaz" ($r.etkili -ceq $T -and -not $r.yaz -and "$(@($r.uyarilar))".Contains("UYGULANMADI")) (LisOz $r)

# --- D8e-3b: eski paket TEK giris - gecisli duzen - kanal hizmetinin koku - ag ayari kayittan --------------------
function BaglantiKur([string]$baglanti, [string]$hedef) {
  if ($env:OS -ceq "Windows_NT") { [void](NativeKos "cmd.exe" @("/c", "mklink", "/J", $baglanti, $hedef)) }
  else { New-Item -ItemType SymbolicLink -Path $baglanti -Target $hedef | Out-Null }
}
$gk = Join-Path ([IO.Path]::GetTempPath()) ("kurulum-harness-3b-" + [guid]::NewGuid().ToString("N"))
try {
  # Eski paket: sihirbaz (on-olcum) ve OnKosul AYNI islevi (EskiPaketOlcumu) cagirir - sinif ikisine de ayni gider.
  $kk = Join-Path $gk "ep"; $vk = Join-Path $gk "ep-veri"
  New-Item -ItemType Directory -Force -Path (Join-Path $kk "kurulum") | Out-Null
  [IO.File]::WriteAllText((Join-Path $kk "kurulum\kurulum.json"), '{"paket": {"surum": "2.14.5"}}')
  [IO.File]::WriteAllText((Join-Path $kk "kurulum-gecmisi.jsonl"), ('{"tur": "GUNCELLEME", "yeniSurum": "2.14.9"}' + "`n"))
  $a = EskiPaketOlcumu $kk $vk "2.14.5"; $b = EskiPaketOlcumu $kk $vk "2.14.9"; $c = EskiPaketOlcumu $kk $vk "bicimsiz"
  Olc "eskipaket.olcum-tek-giris" ($a.sinif -ceq "eski" -and "$($a.engel)".Contains("2.14.9") -and $a.kurulu.kaynak -ceq "kurulum-gecmisi.jsonl" -and $b.sinif -ceq "" -and $null -eq $b.engel -and $c.sinif -ceq "olculemedi" -and $c.engel) ("eski: $($a.sinif)/$($a.kurulu.surum) esit: '$($b.sinif)' bicimsiz: '$($c.sinif)'")

  # Gecisli duzen: gecis\<damga>\gunluk.jsonl + current baglantisi (IKI isaret) -> GECISLI; tek isaret yetmez.
  $gd1 = Join-Path $gk "gecisli"
  New-Item -ItemType Directory -Force -Path (Join-Path $gd1 "gecis\20261001_101500"), (Join-Path $gd1 "gecis\20260930_090000"), (Join-Path $gd1 "surumler\2.14.9") | Out-Null
  [IO.File]::WriteAllText((Join-Path $gd1 "gecis\20261001_101500\gunluk.jsonl"), "{}`n")
  [IO.File]::WriteAllText((Join-Path $gd1 "gecis\20260930_090000\gunluk.jsonl"), "{}`n")
  BaglantiKur (Join-Path $gd1 "current") (Join-Path $gd1 "surumler\2.14.9")
  $g = GecisliDuzen $gd1
  Olc "gecisli.duzen-tanir" ($g -and $g.damga -ceq "20261001_101500" -and "$($g.metin)".Contains("GECIS-PM2-HIZMET.md") -and "$($g.metin)".Contains("-GeriAl") -and "$($g.metin)".Contains("onarmaz")) ("sonuc: $(if ($g) { "$($g.damga) | $($g.metin)" } else { 'null' })")
  $gd2 = Join-Path $gk "yalniz-gunluk"; New-Item -ItemType Directory -Force -Path (Join-Path $gd2 "gecis\20261001_101500") | Out-Null
  [IO.File]::WriteAllText((Join-Path $gd2 "gecis\20261001_101500\gunluk.jsonl"), "{}`n")
  $gd3 = Join-Path $gk "yalniz-current"; New-Item -ItemType Directory -Force -Path (Join-Path $gd3 "surumler\1.0.0"), (Join-Path $gd3 "gecis\notlar") | Out-Null
  BaglantiKur (Join-Path $gd3 "current") (Join-Path $gd3 "surumler\1.0.0")
  $gd4 = Join-Path $gk "yabanci"; New-Item -ItemType Directory -Force -Path (Join-Path $gd4 "Belgeler") | Out-Null
  [IO.File]::WriteAllText((Join-Path $gd4 "not.txt"), "x")
  Olc "gecisli.tek-isaret-yetmez-yabanci-eski-mesaj" ($null -eq (GecisliDuzen $gd2) -and $null -eq (GecisliDuzen $gd3) -and $null -eq (GecisliDuzen $gd4)) "yalniz gunluk / yalniz current / yabanci klasor GECISLI sayilmamali"
  foreach ($bd in @($gd1, $gd3)) { $cur = Join-Path $bd "current"; if (ReparseMi $cur) { [IO.Directory]::Delete($cur) } }

  # Ag ayari kaydi (TEK okuyucu): kurulum.json ag > durum.json ag > cevap-onceki.json api > cevap.json api.
  $ak = Join-Path $gk "ag"; New-Item -ItemType Directory -Force -Path (Join-Path $ak "kurulum") | Out-Null
  [IO.File]::WriteAllText((Join-Path $ak "kurulum\cevap.json"), '{"v": 1, "api": {"port": 4000, "izinliAdresler": ["100.64.0.0/10", "LocalSubnet"], "agProfilleri": ["Private", "Domain"], "mdns": false}}')
  $r = KayitliAgAyari $ak $semaNesne
  Olc "ag.kayit-eski-cevaptan" ($r -and $r.kaynak -ceq "cevap.json" -and (AgMetni $r.izinliAdresler) -ceq "LocalSubnet,100.64.0.0/10" -and (AgMetni $r.agProfilleri) -ceq "Domain,Private" -and $r.mdns -eq $false) ("kayit: $(if ($r) { "$($r.kaynak) $(AgMetni $r.izinliAdresler) $(AgMetni $r.agProfilleri) $(AgMetni $r.mdns)" } else { 'null' })")
  [IO.File]::WriteAllText((Join-Path $ak "kurulum\cevap-onceki.json"), '{"v": 1, "api": {"izinliAdresler": ["LocalSubnet"]}}')
  $r1 = KayitliAgAyari $ak $semaNesne
  [IO.File]::WriteAllText((Join-Path $ak "kurulum\kurulum.json"), '{"ag": {"izinliAdresler": ["LocalSubnet", "100.64.0.0/10"], "agProfilleri": ["Domain"], "mdns": true}}')
  $r2 = KayitliAgAyari $ak $semaNesne
  Olc "ag.kayit-oncelik" ($r1.kaynak -ceq "cevap-onceki.json" -and (AgMetni $r1.izinliAdresler) -ceq "LocalSubnet" -and $null -eq $r1.agProfilleri -and $r2.kaynak -ceq "kurulum.json" -and (AgMetni $r2.agProfilleri) -ceq "Domain" -and $r2.mdns -eq $true) ("r1: $($r1.kaynak) $(AgMetni $r1.izinliAdresler) / r2: $($r2.kaynak) $(AgMetni $r2.agProfilleri)")
  [IO.File]::WriteAllText((Join-Path $ak "kurulum\kurulum.json"), '{"ag": {"izinliAdresler": ["0.0.0.0/0"], "agProfilleri": ["Public"], "mdns": "evet"}}')
  $r3 = KayitliAgAyari $ak $semaNesne
  Olc "ag.kayit-gecersiz-yok-sayilir" ($r3.kaynak -ceq "cevap-onceki.json") ("gecersiz kurulum.json ag atlanmali, sonraki kaynak: $($r3.kaynak)")
  # Karar: onarimda kayit KAZANIR (sessiz kip alan vermezse varsayilan DARALTMAZ); acik farkli deger UYGULANMADI uyarisi.
  $kayit = @{ izinliAdresler = @("LocalSubnet", "100.64.0.0/10"); agProfilleri = @("Domain", "Private"); mdns = $true; kaynak = "cevap.json" }
  $h = '{"v": 1}' | ConvertFrom-Json
  $k = AgKarari (CevapDogrula $h $semaNesne).deger $h $kayit $semaNesne
  $u = "$(@($k.uyarilar) -join ' || ')"
  Olc "ag.onarim-sessiz-kayit-korunur" ((AgMetni $k.ag.izinliAdresler) -ceq "LocalSubnet,100.64.0.0/10" -and "$($k.ag.kaynak)".StartsWith("kayit") -and -not $u.Contains("UYGULANMADI")) ("ag: $(AgMetni $k.ag.izinliAdresler) ($($k.ag.kaynak)) uyari: $u")
  # O12: kayittaki eski Tailscale izni KORUNUR ama uyarilir (tek uyari; Tailscale'siz kayit uyarisiz).
  Olc "ag.onarim-eski-tailscale-uyarir" (@($k.uyarilar).Count -eq 1 -and $u.Contains("eski Tailscale izni") -and $u.Contains("100.64.0.0/10")) ("uyari: $u")
  $kd = AgKarari (CevapDogrula $h $semaNesne).deger $h @{ izinliAdresler = @("LocalSubnet"); agProfilleri = @("Domain"); mdns = $true; kaynak = "kurulum.json" } $semaNesne
  Olc "ag.onarim-tailscalesiz-uyarisiz" ((AgMetni $kd.ag.izinliAdresler) -ceq "LocalSubnet" -and @($kd.uyarilar).Count -eq 0) ("ag: $(AgMetni $kd.ag.izinliAdresler) uyari $(@($kd.uyarilar).Count)")
  $h = '{"v": 1, "api": {"izinliAdresler": ["LocalSubnet"], "mdns": true}}' | ConvertFrom-Json
  $k = AgKarari (CevapDogrula $h $semaNesne).deger $h $kayit $semaNesne
  $u = "$(@($k.uyarilar) -join ' || ')"
  Olc "ag.onarim-cevap-uygulanmaz" ((AgMetni $k.ag.izinliAdresler) -ceq "LocalSubnet,100.64.0.0/10" -and @($k.uyarilar).Count -eq 2 -and $u.Contains("UYGULANMADI") -and $u.Contains("api.izinliAdresler")) ("ag: $(AgMetni $k.ag.izinliAdresler) uyari: $u")
  # O12: Tailscale cevapta secenek DEGIL (sessiz kip RED, fail-closed); yeni kurulum yalniz LocalSubnet.
  $h = '{"v": 1, "api": {"izinliAdresler": ["LocalSubnet", "100.64.0.0/10"]}}' | ConvertFrom-Json
  $cv = CevapDogrula $h $semaNesne
  Olc "ag.cevap-tailscale-red" (@($cv.hatalar).Count -ge 1 -and "$(@($cv.hatalar) -join ' ')".Contains("100.64.0.0/10")) ("hatalar: $(@($cv.hatalar) -join ' | ')")
  $h = '{"v": 1, "api": {"izinliAdresler": ["LocalSubnet"], "mdns": false}}' | ConvertFrom-Json
  $k = AgKarari (CevapDogrula $h $semaNesne).deger $h $null $semaNesne
  Olc "ag.yeni-kurulum-cevaptan" ((AgMetni $k.ag.izinliAdresler) -ceq "LocalSubnet" -and (AgMetni $k.ag.agProfilleri) -ceq "Domain,Private" -and $k.ag.mdns -eq $false -and $k.ag.kaynak -ceq "cevap" -and @($k.uyarilar).Count -eq 0) ("ag: $(AgMetni $k.ag.izinliAdresler) $(AgMetni $k.ag.agProfilleri) $(AgMetni $k.ag.mdns) ($($k.ag.kaynak))")
} finally { Remove-Item -LiteralPath $gk -Recurse -Force -ErrorAction SilentlyContinue }

# Kanal hizmetinin koku (FAIL-CLOSED): ayni kok gecer - baska kok durur - ImagePath okunamaz/cozulemez durur.
$bk = 'C:\TeksERP\current\runtime\tekserp-hizmet.exe hizmet --kok C:\TeksERP --ad TeksERP-Backend-testfabrika'
$pgk = '"C:\TeksERP\pgsql\18.0-1\bin\pg_ctl.exe" runservice -N "TeksERP-PostgreSQL-testfabrika" -D "D:\TeksERP\pgveri" -w -t 60'
$a = HizmetKokKarari "TeksERP-Backend-testfabrika" $bk 'c:\teksERP\'
$b = HizmetKokKarari "TeksERP-PostgreSQL-testfabrika" $pgk 'C:\TeksERP'
$c = HizmetKokKarari "TeksERP-Backend-testfabrika" $null 'C:\TeksERP-testfabrika'
Olc "hizmetkok.ayni-kok-gecer" ($null -eq $a -and $null -eq $b -and $null -eq $c) "current\ baglantisi uzerinden (buyuk/kucuk harf, sondaki \) ve PG -D baska surucude: gecmeli; hizmet yok: gecmeli"
$a = HizmetKokKarari "TeksERP-Backend-testfabrika" $bk 'C:\TeksERP-testfabrika'
$b = HizmetKokKarari "TeksERP-PostgreSQL-testfabrika" $pgk 'C:\TeksERP-testfabrika'
# Onek tuzagi: C:\TeksERP secilmisken C:\TeksERP-testfabrika'ya bagli hizmet de BASKA koktur.
$o = HizmetKokKarari "TeksERP-Backend-testfabrika" 'C:\TeksERP-testfabrika\current\runtime\tekserp-hizmet.exe hizmet --kok C:\TeksERP-testfabrika --ad TeksERP-Backend-testfabrika' 'C:\TeksERP'
Olc "hizmetkok.baska-kok-durur" ($a.durum -ceq "baska" -and $a.bagli -ceq "C:\TeksERP" -and "$($a.metin)".Contains("yapilamaz") -and $b.durum -ceq "baska" -and $o.durum -ceq "baska" -and $o.bagli -ceq "C:\TeksERP-testfabrika") ("backend: $($a.durum) $($a.bagli) / pg: $($b.durum) $($b.bagli) / onek: $($o.durum) $($o.bagli)")
$a = HizmetKokKarari "TeksERP-Guncelleyici-testfabrika" "" 'C:\TeksERP'
$b = HizmetKokKarari "TeksERP-Guncelleyici-testfabrika" "tekserp-guncelleyici.exe hizmet" 'C:\TeksERP'
Olc "hizmetkok.okunamaz-durur" ($a.durum -ceq "olculemedi" -and $b.durum -ceq "olculemedi" -and "$($a.metin)".Contains("olculemedi")) ("bos: $($a.durum) / goreli: $($b.durum)")
$adl = [ordered]@{ backend = "B"; guncelleyici = "G"; pg = "P" }
$e = HizmetKokEngelleri $adl 'C:\K2' { param($hz) switch ($hz) { "B" { 'C:\K1\current\runtime\h.exe hizmet --kok C:\K1 --ad B' } "G" { $null } "P" { "" } } }
$e2 = HizmetKokEngelleri $adl 'C:\K1' { param($hz) switch ($hz) { "B" { 'C:\K1\current\runtime\h.exe hizmet --kok C:\K1 --ad B' } default { $null } } }
Olc "hizmetkok.uc-hizmet-olculur" (@($e).Count -eq 2 -and $e[0].ad -ceq "B" -and $e[0].durum -ceq "baska" -and $e[1].ad -ceq "P" -and $e[1].durum -ceq "olculemedi" -and @($e2).Count -eq 0) ("engeller: $((@($e) | ForEach-Object { "$($_.ad)=$($_.durum)" }) -join ',') / ayni kok: $(@($e2).Count)")

Write-Output "=== Sonuc: $($script:gecti) gecti, $($script:kaldi) basarisiz ==="
if ($script:kaldi -gt 0) { exit 1 }
exit 0
