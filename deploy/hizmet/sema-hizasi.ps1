# =============================================================================
# TeksERP - SEMA HIZASI (TEK KURAL): paket veritabaninin semasinin GERISINDE mi
# =============================================================================
# Nokta-kaynak edilir; yalniz islev tanimlar, HICBIR SEY CALISTIRMAZ. Cagiranlar AYNI dosyayi okur:
#   * setup : deploy\kurulum\kurulum.ps1 AsamaBackend (goc ONCESI engel + goc SONRASI esitlik) - kitte
#             {app}\kurulum\deploy\hizmet\
#   * gecis : deploy\gecis\gecis.ps1 (envanter: fazla/bekleyen goc ENGEL) - pakette hizmet\sema-hizasi.ps1
#   * guncelleyici: Rust aynasi Teks-Erp/native/tekserp-guncelleyici/src/sema.rs (SEMA_ILERIDE, durum BEKLIYOR)
# KURAL: veritabanindaki BITMIS goc adlari (finished_at IS NOT NULL AND rolled_back_at IS NULL) paketin goc
#   adlarinin (prisma/migrations/<ad>/migration.sql) ALT KUMESI degilse SEMA ILERIDE - paket semayi geri
#   indirir, UYGULANMAZ. Ad bayt-esit (ordinal) karsilastirilir; sayi karsilastirmasi bunu olcmez.
# Eslik: ortak vektorler Teks-Erp/native/test-vektorleri/sema-hizasi.json (uretici test_sema_hizasi.ts
#   --vektor-yaz); bekci bu islevleri pwsh'ta, Rust'i cargo test'te ayni vektorlere kosar; SQL BAYT-ESIT.
# DONUS: dizi doner ama TEK elemanli/bos sonuc boru hattinda acilir - cagiran @( ) ile SARAR.
# ASCII + PS 5.1.
# =============================================================================

$script:SEMA_BITMIS_GOC_SQL = "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1"

# $a'da olup $b'de olmayan adlar (ordinal sirali, tekil).
function GocFarki([string[]]$a, [string[]]$b) {
  $p = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach ($x in @($b)) { if ($null -ne $x) { [void]$p.Add($x) } }
  $f = New-Object 'System.Collections.Generic.SortedSet[string]' ([StringComparer]::Ordinal)
  foreach ($x in @($a)) { if ($null -ne $x -and -not $p.Contains($x)) { [void]$f.Add($x) } }
  return [string[]]@($f)
}

# Veritabaninda olup pakette olmayan bitmis goclar; bos degilse SEMA ILERIDE.
function SemaIleride([string[]]$dbBitmis, [string[]]$paketGoclari) {
  return GocFarki $dbBitmis $paketGoclari
}

# Paketin goc adlari, goreli dosya yollarindan (zip girdileri ya da dizin taramasi; ayirac / ya da \):
# "prisma/migrations/<ad>/migration.sql" olanlarin <ad>'i (ordinal sirali, tekil).
function PaketGocAdlari([string[]]$yollar) {
  $f = New-Object 'System.Collections.Generic.SortedSet[string]' ([StringComparer]::Ordinal)
  foreach ($y in @($yollar)) {
    if ($null -eq $y) { continue }
    $p = $y.Replace('\', '/')
    if ($p -cmatch '^prisma/migrations/([^/]+)/migration\.sql$') { [void]$f.Add($Matches[1]) }
  }
  return [string[]]@($f)
}

# Surum dizininin goc adlari: <dizin>\prisma\migrations\<ad>\migration.sql (dizin yoksa istisna).
function SurumGocAdlari([string]$surumDizini) {
  $m = Join-Path (Join-Path $surumDizini "prisma") "migrations"
  if (-not (Test-Path -LiteralPath $m -PathType Container)) { throw "paketin goc dizini yok: $m" }
  $yollar = @(Get-ChildItem -LiteralPath $m -Directory | ForEach-Object { "prisma/migrations/$($_.Name)/migration.sql" } |
      Where-Object { Test-Path -LiteralPath (Join-Path $surumDizini $_) -PathType Leaf })
  return PaketGocAdlari $yollar
}
