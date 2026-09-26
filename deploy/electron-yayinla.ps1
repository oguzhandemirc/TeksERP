<#
.SYNOPSIS
    EMEKLİ — Electron paneli bu betikle YAYINLANMAZ (fail-closed saplama).

.DESCRIPTION
    Bu dosya bash yayıncısının Windows ikiziydi ve ondan AYRIŞMIŞTI: eski sunucuyu
    (91.217.119.138) ve sabit `adnansahin` klasörünü gösteriyordu; değişmezlik,
    sunucu tarafı sha512, yayın defteri, sürüm etiketi ve kanal kapısı YOKTU.
    İki yayıncı = aynı kapının iki kopyası = ayrışan yüzey; kopyayı kapılara
    bağlamak ikinci bir kapı gövdesi yazmak olurdu. Tek yol:

        ./deploy/electron-yayinla.sh --musteri=<kanal>   (macOS/Linux; Windows'ta Git Bash/WSL)

    Dosya silinmedi ki eski bir reçeteden kopyalanan komut sessizce değil
    GÜRÜLTÜLÜ düşsün. Tamamen kaldırma önerisi: docs/kurallar/surum-yayin.md.
    Bekçi: scripts/check-kanallar.mjs §5 (saplama hiçbir yükleme komutu taşımaz,
    sıfır-dışı çıkar).
#>
[CmdletBinding()]
param(
    # Eski çağrı biçimleri bağlanabilsin diye aynı adlar — hiçbiri KULLANILMAZ.
    [string]$Surum,
    [string]$SshHedef,
    [int]$SshPort,
    [string]$UzakDizin,
    [string]$YayinUrl
)

# Kod dizeleri ASCII: Windows PowerShell 5.1 BOM'suz dosyayı ANSI okur; UTF-8 tire/harf
# baytları orada tırnak karakterine dönüşüp dizeyi bölebilir.
Write-Host "HATA: deploy/electron-yayinla.ps1 EMEKLI - bu betik hicbir sey yuklemez." -ForegroundColor Red
Write-Host "  Kanal kapisi, degismezlik, sha512, yayin defteri ve etiket yalniz bash yayincisinda:"
Write-Host "    ./deploy/electron-yayinla.sh --musteri=<kanal>"
exit 1
