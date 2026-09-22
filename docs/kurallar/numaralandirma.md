# Numaralandırma · numara serisi · ön ek

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: 2026-09-22 numaralandırma turu (kullanıcı isteği: "buradaki her şey customize edilebilir olabilir mi… başka fabrikalar başka formatlama-ön ek isteyebilir"). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Numara DOĞUŞ anında tam string olarak kendi kolonuna yazılır; ekran, belge, Excel ve barkod o kolonu okur — biçimlendirici sunum katmanında ÇAĞRILMAZ. "Programda P-2, çıktıda P20260202" ancak bu delinirse olur (kullanıcı değişmezi 2026-09-22). · bekçi: `scripts/test_number_series.ts §7`
- **[ÇEKİRDEK]** Render'da biçimlenen tek istisna, "eski belgeler de değişsin" bayrağı olan ve varsayılanı KAPALI olan alandır; orada da program ekranı ile belge AYNI resolver'ı çağırır (boğaz-ikiz). Bugünkü tek üyesi sevkiyat içi çuval sırası ön eki (`shipping.sackSeqPrefixLive`, ön ek `Shipment.sackSeqPrefix`te donar). · bekçi: `test_sack_seq_label §2`
- **[ÇEKİRDEK]** Serinin KİMLİĞİ koda (`src/constants/number-series-catalog.ts`), BİÇİMİ veriye (`number_series` tablosu) aittir. Boot uzlaştırması eksik seriyi tohumla doğurur ve `label`/`scanned`/`editable` alanlarını tazeler; `prefix`/`dateSegment`/`digits`/`separator`/`retiredPrefixes` alanlarına ASLA dokunmaz — fabrikanın seçtiği ön ek bir daha koda dönmez. · bekçi: `test_number_series §1`
- **[ÇEKİRDEK]** Sayaç sıfırlama dönemi ayrı bir ayar DEĞİL, tarih segmentinin sonucudur (`DDMMYY`→günlük · `YYMM`/`YYYYMM`→aylık · `YY`/`YYYY`→yıllık · `NONE`→hiç). Sayaç türetilir ("aynı sabit başla başlayanların SAYISAL max'ı + 1"); ayrı sayaç tablosu ve yeni advisory uzayı açılmaz. · bekçi: `test_number_series §6`
- **[ÇEKİRDEK]** Sıra `10^digits`'i aşarsa kod GENİŞLER, SARMAZ; tam-format doğrulaması en az `digits`, fazlasını serbest kabul eder (`\d{digits,}`) — sabit hane dayatan doğrulama 9999'u aşan günde üretilen kodu okutulamaz kılar. · bekçi: `test_number_series §5`
- **[ÇEKİRDEK]** Okutulan kodun TÜRÜ sunucunun tek sınıflandırıcısından çözülür (`classifyScannedCode`); istemci ön eki REGEX olarak sabitlemez ve backend'de elle yazılmış ikinci bir tam-format tablosu bulunmaz. Ön ek değişince istemcinin sessizce yanlış dala düşmesi (çuval kodunu top sanıp "Top bulunamadı" demesi) böyle önlenir. · bekçi: `test_scan_series §2 §7`
- **[ÇEKİRDEK]** `/api/scan/series` ve `/api/scan/resolve` izin kodu TAŞIMAZ (yalnız `verifyToken`): okutma her operatör ekranının ilk adımıdır ve dar bir izin, o kodu atanmamış tablette okutmayı kırar. Karşılığında iki uç yalnız BİÇİM meta verisi döner ve `/resolve` DB'ye İNMEZ — bu kısıt bir cümle değil bir kapıdır. · bekçi: `test_scan_series §6` · `test_route_auth_coverage` (`BARE_CHAIN_BASELINE` 15)
- **[ÇEKİRDEK]** Serinin tarih ile sıra ARASINDA sabit bir parçası varsa (bugün yalnız top barkodunun faz harfi `[HF]`) bu parça `number_series` tablosuna DEĞİL katalogdaki `infix` alanına yazılır ve biçimle BİRLİKTE taşınır — yapısal özelliktir, fabrika ayarı değildir. Ayrı geçirilen bir parametre olsaydı `matchesSeries(resolveSeriesFormat(key), code)` çağıran bir yol onu unutup SESSİZCE yanlış cevap alırdı. · bekçi: `test_number_series §8`
- **[ÇEKİRDEK]** Biçim değişimi GEÇMİŞE DOKUNMAZ; eski ön ek `retiredPrefixes`e düşer ve okutulmaya devam eder. Geçmişi yeniden numaralandırma seçeneği SUNULMAZ (donmuş belge müşteride basılı · depodaki çuval etiketi eski barkodu taşıyor · numara defter satırlarında referans). · bekçi: `test_number_series §4`
- **[ÇEKİRDEK]** Ön ek çakışması kapısı yalnız TARAMA UZAYINDA küreseldir (`scanned` seriler): iki seri birbirinin ön eki olamaz, emekli ön ekler dahil. Okutulmayan serilerde çakışma meşrudur ve bugün üç yerde vardır (`KS` kartela sevk ↔ kasa kodu · `IADE` iade belgesi ↔ iade sebebi · `P` üretim partisi ↔ sevk partisi adı) — kapıyı küreselleştirmek doğduğu gün üç yanlış kırmızı verir. · bekçi: `test_number_series §3`
- **[ÇEKİRDEK]** Okutulan serinin ön eki ASCII büyük harf + rakam, en çok 6 karakter (Code128 ve istemcilerin `toUpperCase()` varsayımı; Türkçe harf barkodu bozar). · bekçi: `test_number_series §2`

### Yasaklar

- **[ÇEKİRDEK]** Ön eki servis içinde LİTERAL yazma: `utils/code-format.ts`in biçimlendiricilerini (`dailyCodePrefix` · `buildDailyCode` · `nextDailySeq`) yalnız `services/number-series.service.ts` import eder. İkinci bir import, seri tablosunu SESSİZCE devre dışı bırakır. · bekçi: `test_number_series §7`
- **[ÇEKİRDEK]** Kilitli seriyi (`lockedReason` dolu) panelden düzenlenebilir yapma: top barkodu (tarih ile sıra arasında faz harfi + `RollBarcodeCounter` anahtarı), kısa parti no (fiziksel plaka seti, körlemesine sarar), iş emri/kart no (tek kod + sahadaki `RK` kartları) ve iade belge no (henüz sayaç yok, `id`'den türetiliyor). Kilit kalkacaksa gerekçe önce ölçülür.

### Kararlar

- **[PROFİL]** Bugünkü biçimler: `CV`/`SVK`/`KRT`/`T…H|F` + GGAAYY + NNNN · `PRT-YYMM-NNNN` · `P-n` (sevk partisi adı) · `STK-NNNNNN` (tarihsiz) · `IADE-GGAAYY-<id6>`. Hepsi `number-series-catalog.ts`te tohum olarak yazılıdır ve bekçi her birini eski üreteçle karşılaştırır.
- **[ÇEKİRDEK]** Önbellek fail-SAFE'tir, fail-closed değil ve bu BEYANLIDIR: seri okunamazsa katalog tohumuna düşülür. Gerekçe — numara üretememek üretimi durdurur (çuval açılmaz, sevk kurulmaz), tohum ise bugünkü davranıştır.

**Bekçiler:** `scripts/test_number_series.ts` (DB'siz, 36 kontrol) · `scripts/test_scan_series.ts` (DB'siz, 27 kontrol) · `scripts/test_belge_ekran_ayni.ts` (uçtan uca: ekranda görünen numara belgede birebir) · `scripts/test_sack_seq_label.ts` · `scripts/test_db_invariants.ts` (`number_series_digits_range`) · `scripts/test_packing_group.ts` · `scripts/test_sevk_partisi.ts`
