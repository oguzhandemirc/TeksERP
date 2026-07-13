# Raster Baskı — F6 Fiziksel Doğrulama Checklist'i

Raster (1bpp bitmap) baskı yazılım tarafında bitti ve testlendi (F1–F5 + F0).
Bu checklist **gerçek Argox/Zebra yazıcıyla** kalan fiziksel doğrulamayı yönetir.
Raster **cihaz-başına opt-in**'dir (`PeripheralDevice.rasterMode`, varsayılan kapalı);
kapalıyken bugünkü komut yolu bayt-aynı çalışır, o yüzden bu adımlar üretimi riske atmaz.

> Kod referansları: `Teks-Erp/src/services/helpers/raster/`, tasarım `ETIKET-TASARIM.md §8`,
> PPLA grafik spec `argox-ppla-spec` memory.

## 0. Ön koşul
- [ ] Backend + Electron güncel branch'te çalışıyor (`feat/raster-isolated` main'e entegre edildi).
- [ ] `Teks-Erp/assets/fonts/` DejaVuSans.ttf + DejaVuSans-Bold.ttf mevcut (prod'da installer `assets\` kopyalar).
- [ ] Pilot yazıcı **PPLB (Eltron/EPL2)** veya **ZPL (Zebra)** ile başla — PPLA'yı §5'e kadar açma.

## 1. Cihazı raster'a al
- [ ] Tanımlar → Donanım → pilot yazıcı → **"Raster baskı (bitmap)"** işaretle, kaydet.
- [ ] `label.nativeSendEnabled` açık mı (Faz-2 gönderim) ya da "Bu Bilgisayar" yerel yazıcı yapılandırılmış mı doğrula.

## 2. Test baskısı (çöp etikete)
- [ ] Etiket Stüdyosu → şablon aç → **Test Baskısı** ("Bu PC" + "Ağ IP" ikisi de).
- [ ] Bir etiket çıktı mı? (Çıkmadıysa: transport/IP/port — F3 log'una bak.)

## 3. ⚠ PPLB GW polaritesi (KRİTİK)
- [ ] Çıktı **NEGATİF** mi (siyah zemin / beyaz görüntü)? → `raster-envelope-pplb.ts`
      `GW_ONE_IS_WHITE` sabitini **`false`** yap; `test_raster_envelope.ts`'teki beklenen
      bayt (0xFF↔0x00) senaryosunu da güncelle; yeniden bas.
- [ ] Çıktı **DOĞRU** (beyaz zemin / siyah görüntü) → polarite tamam.

## 4. Önizleme = baskı doğrulaması
- [ ] Aynı etiketin **BMP önizlemesini** (RollLabelDialog / CanvasPreview) basılı etiketle
      fiziksel bindir (ışık masası/fotoğraf). Konum sapması **≤1mm**, font boyutu birebir bekle.
- [ ] Kenar kırpılması varsa cihaz medyası (`labelWidthMm`/`labelHeightMm`/`labelDpi`) doğru mu kontrol et.
- [ ] **Türkçe glif**: "ĞÜŞİÖÇı" içeren alan gerçek basılıyor mu (asciiFold kalktı).

## 5. Barkod okunabilirliği
- [ ] Code128 `mw`=1..4 her kademede + QR `scale` uçlarında sahadaki okuyucuyla
      **≥20 ardışık başarılı okuma** (tam-dot modül garantisinin kanıtı).
- [ ] Okumuyorsa: DPI/medya doğru mu, modül çok mu küçük (mw artır).

## 6. Yoğunluk (ısı)
- [ ] Büyük siyah alan (lengthBanner) **solgun** mu? → PPLA `H10`→`H12-14` / PPLB `D8`→`D10`
      dene (`raster-envelope-*.ts` sabitleri); seçilen değeri işle + not düş.

## 7. PPLA (yalnız §3-6 PPLB/ZPL'de geçtiyse)
- [ ] `raster-envelope-ppla.ts` grafik komutunu OS-214plus'ta **hurda etikete** dene:
      önce `PPLA_RASTER_VERIFIED=false` iken çıktı **komut modunda** (bugünkü) gelmeli.
- [ ] Geçici olarak `PPLA_RASTER_VERIFIED=true` yapıp bas:
  - [ ] Ters/ayna mı çıkıyor? → `<STX>I…B` (flipped) yerine `b` dene.
  - [ ] Konum kaymış mı? → `1Y11000` koordinat birimi (1/100 inç vs dot) — `u()`'yu gözden geçir.
  - [ ] `<STX>ICCB` char dizisi çalışmıyorsa Argox PPLA manuel "I" komutuyla karşılaştır.
- [ ] Doğru basınca `PPLA_RASTER_VERIFIED=true` bırak; aksi halde `false`'a döndür (komut güvenli).

## 8. Hız
- [ ] Tek etiket + 50'lik bulk gönderim süresini ölç (TCP + winspool). Komut moduna göre
      farkı kaydet — mobil BT-SPP kararına girdi (mobil şimdilik komut modunda).

## 9. Yaygınlaştırma
- [ ] Bir hafta pilot cihazda sorunsuz → cihaz cihaz `rasterMode` aç.
- [ ] Kanvas varyantı olmayan şablonlar komut modunda kalır; gerekirse
      `scripts/migrate_label_templates_to_canvas.ts` ile kanvasa taşı.

## Geri dönüş (her an)
Cihazda **`rasterMode` kapat** → komut yolu bayt-aynı döner. Kod tarafında registry
try/catch zaten çalışma-zamanı sigortası (raster patlarsa komuta düşer); rawCode uzman
yolu hiçbir koşulda rasterlenmez.
