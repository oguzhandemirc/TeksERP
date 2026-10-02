# =============================================================================
# TeksERP - KANAL ADLARI (TEK KAYNAK): backend hizmet adinin son ekinden turetilen adlar
# =============================================================================
# Nokta-kaynak edilir; yalniz islev tanimlar, HICBIR SEY CALISTIRMAZ. Cagiranlar AYNI dosyayi okur:
#   * setup : deploy\kurulum\kurulum.ps1 (AdlariCoz) + on-olcum.ps1 - kitte {app}\kurulum\deploy\hizmet\
#   * gecis : deploy\gecis\gecis.ps1 - pakette hizmet\kanal-adlari.ps1 (paketle.ps1 $ALT_BETIKLER)
#   Iki yerde de cagiranin ..\hizmet\ komsusudur (depo duzeninin aynasi).
# KURAL (docs/design/GUNCELLEYICI.md 4.2): kanal kaydinin backend.hizmetAdi "TeksERP-Backend" (soneksiz)
#   ya da "TeksERP-Backend-<kanal>". Son ek (-<kanal>) ikinci kanalin HER adina gecer: guncelleyici, PG,
#   veri koku (%ProgramData%\TeksERP<sonek>; backend'in TEKSERP_GUNCELLEME_DIZINI = <veri>\guncelleme),
#   gece yedegi gorevi, mDNS kurali - ayni makinede iki kanal ne hizmet ne IPC paylasir.
# HATA: istisna firlatir (cagiran kendi Dur/Engel'ine cevirir); exit KULLANILMAZ.
# Bekci: Teks-Erp/scripts/test_gecis.ts b.4 (tek kaynak) + test_kurulum_betikleri.ts b.8 (setup icerigi).
# ASCII + PS 5.1: BOM'suz UTF-8'i 5.1 ANSI okur; karsilastirma yalniz -c* (tr-TR 'I' tuzagi).
# =============================================================================

# $kanal: paketin imzali kanali (bos = denetlenmez) | $pgTaban: PG hizmet taban adi (bos = pg null)
# $programData: %ProgramData% (bos = veriKoku null). Doner: [ordered] backend, sonek, guncelleyici, pg,
# veriKoku, gorev, mdnsKurali.
function KanalAdlariCoz([string]$backendAdi, [string]$kanal, [string]$pgTaban, [string]$programData) {
  $taban = "TeksERP-Backend"
  if (-not $backendAdi) { $backendAdi = $taban }
  if ($backendAdi -cnotmatch '^TeksERP-Backend(-[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$') { throw "backend hizmet adi kanal kuralina uymuyor: $backendAdi" }
  $sonek = $backendAdi.Substring($taban.Length)
  if ($sonek -and $kanal -and ($sonek -cne "-$kanal")) { throw "hizmet adi ($backendAdi) paketin imzali kanalina ($kanal) ait degil" }
  return [ordered]@{
    backend      = $backendAdi
    sonek        = $sonek
    guncelleyici = "TeksERP-Guncelleyici$sonek"
    pg           = $(if ($pgTaban) { "$pgTaban$sonek" } else { $null })
    veriKoku     = $(if ($programData) { Join-Path $programData "TeksERP$sonek" } else { $null })
    gorev        = "TeksERP-DB-Backup$sonek"
    mdnsKurali   = "TeksERP mDNS$sonek"
  }
}
