# Belge şablon tasarımcısı — tablet basım ölçümü (TY, 2026-10-26)

> Plan: `BELGE-SABLON-TASARIMCISI-PLAN.md` §3.3, §3.11, §4 (sayfa ayarları), §7 R7. Bu dilimde KOD YOK; yalnız ölçüm ve öneri.
> Soru: Backend'in ürettiği şablonlu HTML tablette (`expo-print` → Android WebView) doğru basılıyor mu? Ölçülenler: `@page` boyutu ve kenarı, kenar kutuları (`@top-center`, `@bottom-center`, `@bottom-left` künye, `@bottom-right` sayfa no), filigran, `thead{display:table-header-group}`, barkod/QR SVG, Türkçe büyük harf (`lang="tr"`).

## 1 · Ölçülen yollar

| Yol | Motor | Nasıl |
|---|---|---|
| **Electron PDF** | Electron 42.7.0 (Chromium 148) | `webContents.printToPDF`, üretimdeki `PDF_PRINT_OPTIONS` aynen (`preferCSSPageSize:true`, `pageSize:A4`, kenar 0, `printBackground`); JS kapalı gizli pencere |
| **Web Chromium** | Google Chrome 155 headless | `--print-to-pdf --no-pdf-header-footer` (web panelin "Yazdır" yolu yerine) |
| **Tablet** | expo-print 15.0.8 → Android 17 WebView 156.0.8078.47 | Emülatör `Pixel_10_Pro` (o anda açık olan; `Medium_Tablet` açık değildi). Uygulamanın debug APK'sı e2e sunucusuna bağlandı. Basım gerçek ekran yolundan yapıldı: Sevkiyat → Geçmiş → SVK2109260007 → "Sevk İrsaliyesi" (`printHtml`) ve Hızlı Terbiye İş Emri → Belgeler → Refakat Kartı (`workOrderDocuments.printDocument`). Android yazdırma penceresinde "Save as PDF" seçildi, PDF `adb pull` ile alındı. |

Veri: e2e ortamı (`e2e-ortam.ts kur` + `sunucu`, fabrika dump kopyası). `documents.designerEnabled` açıldı. Sevk irsaliyesi ve refakat kartının Sistem kopyası alındı. Kopyalara ölçüm sürümü eklendi: sayfa ayarı A4 dikey, kenar 15/12/18/12 mm, `ustBilgi.orta`, `altBilgi.orta`, `sayfaNo.konum: alt-sag` ("Sayfa {n} / {N}"). Gövde sonuna şunlar eklendi: `text-transform:uppercase` ile "ışık iğne ılık iğde çiçek — istanbul", `{{ belge.no | barkod: "code128" }}` ve `{{ belge.no | qr }}`. Sürüm yayınlandı ve tür varsayılanı yapıldı. Sevkiyat (46 çuval, 275 top) iki kez reissue edildi; v2 ve v3 şablonla dondu. HTML'ler `/printed-documents/SHIPMENT_DISPATCH/:id/html` ve `/traveler-cards/:id/html` uçlarından alındı.

Filigran ölçümü için bir müdahale yapıldı. Tablet yalnız güncel sürümü basıyor. Bu yüzden v3'ün durumu e2e DB'de geçici `UPDATE … SET status='VOIDED'` ile İPTAL yapıldı, basımdan sonra `ACTIVE`e geri alındı. Bu işlem yalnız atılacak e2e kopyasında yapıldı. ESKİ KOPYA filigranı tablette ölçülmedi, çünkü tablet eski sürüm basmıyor. Filigranın çizim mekanizması İPTAL'le aynı.

## 2 · Sonuç tablosu

Sevk irsaliyesi, 46 çuval:

| Öğe | Electron PDF | Web Chromium | Tablet (expo-print / WebView 156) |
|---|---|---|---|
| `@page size: A4` | var: 210×297 mm, 8 sayfa | var: 210×297 mm, 8 sayfa | **farklı**: kâğıdı yazdırma penceresi belirler (emülatör varsayılanı Letter, 216×279 mm). A4 sayfa ≈ %94 ölçeklenip sığdırıldı, **9 sayfa** |
| `@page` kenarı 15/12/18/12 mm | var | var | var (ölçekli) |
| Üst bilgi `@top-center` | var (8/8) | var (8/8) | var (9/9) |
| Alt bilgi `@bottom-center` | var (8/8) | var (8/8) | var (9/9) |
| Sayfa no `@bottom-right` `counter(page)/counter(pages)` | var, "Sayfa 1 / 8" … "Sayfa 8 / 8" | var, aynı | var, "Sayfa 1 / 9" … "Sayfa 9 / 9" (toplam doğru) |
| Künye `@bottom-left` (no · vN · durum · gerekçe) | var (8/8) | var (8/8) | var (9/9) |
| Filigran İPTAL (`position:fixed`) | var (8/8) | var (8/8) | var (9/9) |
| Filigran ESKİ KOPYA | var (8/8) | var (8/8) | ölçülmedi (tablet eski sürüm basmaz) |
| `thead` tekrarı (çeki listesi) | var (sayfa 2–8) | var (sayfa 2–8) | var (sayfa 2–8) |
| Code128 + QR SVG | var | var | var |
| Türkçe büyük harf | "IŞIK İĞNE ILIK İĞDE ÇİÇEK — İSTANBUL" doğru | doğru | doğru |
| Kenar kutusu yazı tipi | **farklı**: tarayıcı varsayılanı serif (macOS Times) | serif | Roboto (Android varsayılanı) |

Refakat kartı (T11 canlı çözüm, `live-binding.ts`): üç yolda da şablon uygulandı ve belge 1 sayfa çıktı. Üst bilgi, alt bilgi, "Sayfa 1 / 1", QR/Code128 ve Türkçe büyük harf her yolda var. Künye kartta yok; bu tasarım gereği, çünkü canlı türde `imprint: null` (P-e). Tablette kâğıt yine Letter oldu.

Sistem (v1, şablonsuz) irsaliye karşılaştırma için basıldı. Electron ve Chrome'da 8 sayfa çıktı, kenar kutusu yok. Bu beklenen davranış.

## 3 · Bulgular

1. **Kenar kutuları tablette basılıyor. `govde` yedeğine şimdilik gerek yok.** WebView 156'da `@top-*`, `@bottom-*` ve `counter(pages)` doğru çıktı. Bunun bir koşulu var: CSS sayfa kenarı kutuları Chromium 131 ile geldi. Android System WebView 131'in altında kalmış bir tablette sayfa no, künye, üst ve alt bilgi sessizce kaybolur; gövde etkilenmez. Sahadaki tabletlerin WebView sürümü bu dilimde ölçülemedi (ölçüm yalnız emülatörde yapıldı). Yedek kararı bu sürüm ölçümüne bağlanır.
2. **Kâğıt boyunu `@page size` değil, Android yazdırma penceresi seçiyor.** expo-print Android'de HTML'i önce varsayılan 612×792 pt (Letter) medya ile WebView'den PDF'e çiziyor (`PrintPDFRenderTask.DEFAULT_MEDIA_*`). Ardından `PrintManager`'a `UNKNOWN_PORTRAIT` + `NO_MARGINS` veriyor ve kâğıdı yazdırma penceresi seçiyor. A4 tasarım Letter'a ölçeklenip sığdırılıyor, yazı biraz küçülüyor ve sayfa sayısı değişebiliyor (8 yerine 9). Türkiye yerel ayarlı gerçek bir tablette varsayılan büyük olasılıkla A4'tür; bu ölçülmedi. Etki: yalnız görünüm, içerik kaybı yok.
3. **Pencerede kâğıt boyu değiştirilince önizleme takıldı.** Letter'dan ISO A4'e geçince "Preparing preview…" 60 saniyeyi aşıp bitmedi. Bu bir kez denendi, emülatörde. Operatör kâğıt boyunu pencereden değiştiremiyor olabilir. Gerçek cihazda doğrulanmalı.
4. **Kenar kutusu yazı tipi platforma bağlı.** `sayfa.ts` kutulara `font-family` yazmıyor, `overlay.ts` künyeye `sans-serif` yazıyor. Bu yüzden üst bilgi, alt bilgi ve sayfa no masaüstünde serif, tablette Roboto çıkıyor. Görünüm farkı var, içerik farkı yok.
5. `ShipmentDetailView` `printHtml`'e `margins: {0,0,0,0}` geçiyor. Bu seçenek expo-print'te yalnız iOS'ta geçerli, Android'de etkisiz ve zararsız.

## 4 · Öneriler (hepsi ayrı karar; bu dilimde kod yok)

- **Y1, `sayfaNo.konum: "govde"` yedeği: HAYIR, şimdilik.** Gerekçe: Bulgu 1'de kutular WebView 156'da basıldı. Sahada WebView 131 altı bir cihaz ölçülürse açılır. Açılırsa derleyici altbilgiyi gövdeye `position:fixed` ile koyar. Filigranın aynı mekanizması tablette 9/9 sayfada basıldı. Ancak Chromium `counter(page)` ve `counter(pages)` sayaçlarını sayfa kenarı bağlamı dışında saymaz. Bu yüzden gövde yedeği künye ve sabit metni her sayfaya taşıyabilir, **sayfa numarası basamaz**. Eski WebView'de sayfa no için CSS yolu yoktur; tek seçenek sunucuda sayfalamaktır (kapsam dışı).
- **Y2, tablette kâğıt boyu:** `printHtml` çağrısı belge türünün kâğıdını expo-print'e `width/height` olarak verebilir (A4 = 595×842 pt). Ayrıca İş Emri Belgeler ekranındaki "kâğıt boyu" kutusu (`pageSize` A4/A5) sevkiyat ekranına da taşınabilir. Bulgu 3 doğrulanmadan seçenek eklenmez.
- **Y3, kenar kutusu yazı tipi:** `sayfa.ts` her kutuya künyedeki gibi sabit bir aile yazabilir (`font-family:sans-serif; font-size` sabit). Üç yol aynı görünür. Bu bir renderer değişikliği olduğu için eşlenik eşitlik bekçisi etkilenir.
- **Y4, saha ölçümü:** Tabletlerin `Android System WebView` sürümü kurulum ya da güncelleme özetinde görünür kılınabilir. Y1 kararının girdisi budur.

## 5 · Kanıt dosyaları

Hepsi `~/.tekserp/belge-sablon-1024/ty/` altında (oturum scratchpad'i `belge/ty`).

- HTML: `irsaliye-sistem-v1.html`, `irsaliye-sablon-guncel.html` (v3), `irsaliye-sablon-eski-kopya.html` (v2), `irsaliye-sablon-iptal.html`, `refakat-sablon.html`, `refakat-sablon-ie31.html`
- Electron ve Chrome PDF'leri: `pdf/*.electron.pdf`, `pdf/*.chrome.pdf`
- Tablet PDF'leri: `tablet/irsaliye-sablon-guncel.tablet-letter.pdf`, `tablet/irsaliye-sablon-iptal.tablet-letter.pdf`, `tablet/refakat-sablon-ie31.tablet-letter.pdf`
- Emülatör ekranları: `emu-11.png` (yazdırma önizlemesi, kenar kutuları görünür), `emu-15.png` (İPTAL filigranı), `emu-14.png` (A4'e geçişte takılan önizleme)
- Ölçüm betikleri: `../ty-betik/` (`hazirla.mjs` API kurgusu, `electron-pdf.cjs`, `analiz.mjs`: pdf-lib ile sayfa sayısı/boyutu, pdftotext ile sayfa başına metin, `ui.sh` emülatör yardımcıları)
