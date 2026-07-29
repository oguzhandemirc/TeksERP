# Etiket Stüdyosu — Tasarım Referansı (v2, 2026-07)

Branch: `feat/label-studio`. Üç büyük değişiklik: **tek şablon havuzu**, **müşteriye
özel şablon**, **serbest kanvas editör + 4 dile otomatik derleme**.

## 1. Model

```
LabelTemplate (TEK HAVUZ — türden bağımsız; kind/isDefault/fields DEPRECATED geçiş kolonları)
 └─ LabelTemplateVariant  boyut varyantı: tuval (widthMm×heightMm) + elements JSON (kanvas)
                          şablon-başına tek isPrimary; profil referansı sıkı bağsız
Atamalar (şablonu KİM kullanır):
 ├─ LabelContextDefault   kind → şablon (bağlam varsayılanı; kind UNIQUE)
 ├─ PeripheralTemplateRoute  (cihaz, kind) → şablon
 └─ CustomerTemplateRoute    (müşteri, kind) → şablon
```

- `kind` (ROLL_RAW/ROLL_FINISHED/SWATCH) artık **veri bağlamıdır**, kimlik değil:
  baskı anında veriden türer (`colorId == null → ROLL_RAW`), alan değerlerinin
  sözlüğünü seçer. Şablon her bağlama atanabilir; bağlam-dışı alan **boş kalır**
  (mutlak konumda kayma olmaz).
- Kanvas eleman modeli: `config/label-elements.ts` (TEK KAYNAK — tipler +
  CAPABILITY degrade matrisi + validateCanvasLayout). Eleman tipleri: `field`
  (veri-bağlı metin), `text`, `qr`, `code128`, `line`, `box`, `lengthBanner`.
  Koordinat mm, sol-üst orijin, 90° adım rotasyon, font kademe (sm/md/lg/xl) + bold.

## 2. Çözüm zinciri (şablon seçimi)

```
explicit templateId > MÜŞTERİ route[customerId, kind] > CİHAZ route[peripheralId, kind]
                    > bağlam default[kind] > null (şablonsuz katalog düzeni)
```

- Müşteri halkası yalnız `payload.customerId` doluysa sorgulanır — **etiket
  müşterisi EXPLICIT-ONLY** kuralı korunur (stok baskıda asla tetiklenmez, WO
  tahmini yok).
- Dil her koşulda cihazdan (`languageOverride`), geometri format profilinden —
  müşteri şablonu yalnız İÇERİK düzenini değiştirir.
- **Reprint güncel atamayla basar** (snapshot'a templateId dondurulmaz — alias
  taze-çözümüyle aynı felsefe). İzlenebilirlik: `LABEL_PRINTED` audit'inde
  `{templateId, templateName, variantId, variantMatch, language}`.

## 3. Varyant seçimi (boyutlar)

- Baskıda cihaz format profilinin boyutuna **±1mm** eşleşen varyant seçilir
  (`pickVariant`; orientation normalize edilmez — 100×148 ≠ 148×100).
- Eşleşme yoksa **isPrimary** varyant basılır; **baskı asla bloklanmaz** (taşanı
  yazıcı kırpar). Panel proaktif uyarır (Stüdyo VariantMismatchBanner + cihaz
  formu TemplateVariantHint). Yanıt header'ları: `X-Label-Template-Id`,
  `X-Label-Variant-Match: exact|fallback` (cors exposedHeaders'ta).
- Yeni varyant mevcut birinden **kopyalanır** (başka şablondan da) — **otomatik
  ölçekleme YOK**; elle düzeltilir/teyit edilir (kullanıcının sıfır-hata kararı).

## 4. Render sırası (registry)

```
rawCode[dil] dolu → HAM KOD basılır (uzman modu her şeyi ezer)
  ↓ değilse
varyant kanvası → emitCanvas{Ppla,Pplb,Zpl} / buildCanvasLabelHtml
  ↓ varyant yoksa (dual-mode — dönüşmemiş/geri alınmış şablon)
eski akış üreticisi (fields listesi)
  ↓ şablon da yoksa
rollTextLines şablonsuz fallback (bayt-stabil)
```

- Medya komutları (q/Q, ^PW/^LL, STX M) **format profilinden**; eleman
  koordinatları **varyanttan**. Profil PAYLARI (margin*) kanvas yolunda
  KULLANILMAZ (boşluk = tasarım); yalnız eski akış düzenleri tüketir
  (kartela + varyantsız şablon + şablonsuz fallback) — profil formunda
  "gelişmiş" bölüme indirildi. gapMm (etiket arası) medya gerçeğidir,
  kanvasta da kullanılır.
- HTML kanvası native yerleşimle aynı düzendedir (bilinçli sapma: eski el-kodlu
  portrait/landscape HTML iskeletleri yalnız şablonsuz fallback'te yaşar; marka
  satırı isteyen statik metin elemanı ekler).

## 5. Dil yetenek (degrade) matrisi

**ORTAK PAYDA İLKESİ (kullanıcı kararı):** kanvas yolunda bir eleman DÖRT dilde
BİREBİR AYNI çıkar — aynı boyut (dördü de aynı font+çarpan kombinasyonunu basar;
ZPL/HTML serbest ölçeklenebilse de bilerek kullanılmaz), aynı metin (HTML de
Türkçe'yi ASCII'ye katlar), aynı görünüm (bant hepsinde çerçeveli; bold kanvas
yolunda parite dışı — kalın görünümü genişlik oranı verir). Kapatılamayan tek
fark glif piksel şekilleri (bitmap kafa vs vektör motor) — boyut/konum/metin aynı.

| Eleman | PPLA | PPLB | ZPL | HTML |
|---|---|---|---|---|
| field/text/qr/code128 | ✓ | ✓ | ✓ | ✓ |
| line / box | ✓ (DPL font-X) | ✓ | ✓ | ✓ |
| **barkod okunur satırı** | ✓ ortalı | ✓ ortalı | ✓ ortalı | ✓ ortalı |
| lengthBanner | **çerçeveli** (DPL reverse güvenilmez) | ✓ siyah/beyaz | ✓ siyah/beyaz | ✓ siyah/beyaz |
| icon (bakım sembolü) | ✗ skip (DPL grafik ayrı iş) | ✓ **GW** inline | ✓ ^GFA inline | ✓ SVG |
| logo/görsel | v1'de YOK (karar) | — | — | — |

- **Barkod okunur satırı** dört dilde de firmware'in sola-yasladığı satır KAPATILIP
  manuel olarak barkod ALTINDA ORTALANIR (code128WidthDots ile).
- **icon / bakım sembolü (2026-07-27 — PPLB sahaya indi):** Metin/barkod NATIVE komut
  kalır; SADECE ikon 1bpp bitmap olarak gömülür — Bluetooth'ta düşük yük (tüm etiketi
  raster'a çevirmeye gerek yok). PPLB `GW` (Print Immediate Graphics), ZPL `^GFA`, ikisi
  de aynı `renderIconBitmap`/`iconBitmap` çıktısını kullanır. PPLB GW kodlaması +
  polaritesi `pplbGwBlock` ile tam-raster zarfıyla TEK KAYNAK; binary blok komut akışına
  **latin1 string** olarak gömülür (join(CRLF) bozmaz, transport bayt round-trip). Fiziksel
  kill-switch: `PPLB_RASTER_VERIFIED` (aynı GW komutu) — Argox GW'yi basmıyorsa false yap →
  ikon PPLB'de atlanır (rest native basılır), diğer diller etkilenmez. **PPLA (DPL) hâlâ
  skip** — DPL grafik kaydı ayrı iş. Önizleme: PPLB'de GW header'ından ayak-izi placeholder;
  ZPL/HTML gerçek çizim. ⚠ GW fiziksel Argox testi (F6) bekliyor.
- **lengthBanner**: PPLB (saha yazıcısı) / ZPL / HTML'de siyah zemin + beyaz değer
  (reverse). PPLA/DPL'de ters-renk cihaza bağlı ve güvenilmez → değer siyah-üstü-siyah
  görünmez riskine düşmemek için ÇERÇEVELİ (kutu + siyah değer). Fiziksel Argox-PPLA
  testinde reverse çalışırsa PPLA da dolguluya geçirilebilir (tek dal).
- **Bant ÇEVRİLEBİLİR** (`rot` 0/90/180/270; varsayılan 90 dikey↑): değer 90° adımlarla
  döner (bannerGeom top-sol anchor + CW merkezleme; dört dil aynı model). Dikey bant =
  dar+uzun boyut (9×40) rot 90; yatay bant = geniş+kısa (40×9) rot 0. Yanlış şekilde
  metin bantı taşarsa koordinat 0'a kıstırılır (etikette kalır).
- **Bant kişiselleştirme (2026-07-27):** `unit` ("m" birim eki; yok → true = "230,5m",
  false → yalnız sayı — bannerValueText tek kaynak, akış-modeli hep eki basar),
  `glyphHMm` (değer glif yüksekliği mm 1-30; yok → banda otomatik sığdır; dolu →
  metin elemanlarıyla AYNI ortak-payda: resolveEplTextStyle en yakın basılabilir
  kombinasyon, PPLA kendi DPL tablosundan), `wr` (genişlik oranı 0.25-4 — dar/geniş
  = "ince/kalın" görünüm; ters/reverse modda çift-vuruş XOR'lanacağı için bantta
  `bold` bilinçli YOK, kalınlık yalnız wr ile). Dört dil + raster + HTML aynı davranır;
  alanlar boşken çıktı bayt-aynı (geri uyum).
- Yapısal gerçekler: kanvas yolunda dört dil de ASCII basar; EPL_FONT tablosu
  **203dpi'a gömülü** (saha parkı kabulü — 300dpi cihaz gelirse font/mm
  ölçekleme borcu). PPLA ısı/yoğunluk (H10/D8) fiziksel testle doğrulanacak.
- Çakışma/taşma sorumluluğu **editördedir** (useCanvasLint) — backend basmayı
  reddetmez; taranabilirlik (≥1 QR|Code128) hem editörde error hem backend'te
  kayıt guard'ı.

## 6. Geri dönüş / geçiş

- Migration `20260706090000_label_studio_schema` **additive**; kolon drop'ları
  (kind/isDefault/fields/lineStepMm/qrScale/lengthBanner + /catalog/:kind ucu)
  saha onayı sonrası AYRI iş (F7).
- `isDefault` çift-yazımla senkron (eski client geri uyumu, tek kaynak
  LabelContextDefault).
- Akış→kanvas dönüşümü: `scripts/migrate_label_templates_to_canvas.ts`
  (idempotent, --dry-run/--only). **Geri dönüş = varyant satırını sil** → şablon
  akış düzenine döner, kod değişikliği gerekmez.
- Sadakat kanıtı: `test_label_canvas_equivalence.ts` — PPLA/PPLB/ZPL yapısal
  eşdeğer ±1mm (tek bilinen sapma: PPLA alt bant ~0.5mm — okunur-satır payı
  tek geometriye normalize edildi).

## 7. Kapsam dışı / açık işler

- **Kartela (SWATCH) v1 dışı**: swatch baskı hattı akış düzeninde bayt-aynı;
  müşteri ataması SWATCH'ta kaydedilebilir ama baskıda uygulanmaz (Swatch'ta
  customerId plumbing'i yok — KARTELA-TASARIM.md ile birlikte ayrı iş).
- Logo/görsel elemanı v2 (native bitmap ^GFA/GW + dithering).
- Fiziksel yazıcı doğrulaması: Argox PPLA/PPLB gerçek baskı (donanım kullanıcıda).
- Electron editör görseli YAKLAŞIKTIR; sözleşme "önizleme = baskı" backend
  önizlemesiyle sağlanır (native→SVG, `native-preview.ts`; raster modda BMP).

## 8. Raster baskı (1bpp bitmap) — 2026-07-13, cihaz-başına opt-in

Önizleme↔çıktı sapmasını (font/konum/PPLA %35-50 büyük) KÖKTEN çözer: kanvas
layout backend'de yazıcı DPI'ında **tek 1bpp bitmap**'e rasterize edilir; AYNI
bitmap hem önizlemeye (BMP data-URI) hem yazıcıya (dil grafik komutu) gider →
**önizleme = baskı tanım gereği**. Yazıcı font/konum yorumu devre dışı → Türkçe
glifler gerçek basılır (asciiFold KALKAR), PPLA/PPLB/ZPL tek boru hattı.

- **Açma:** `PeripheralDevice.rasterMode` (cihaz-başına, varsayılan **kapalı**).
  Kapalı → bugünkü komut yolu **bayt-aynı**. rawCode uzman yolu ASLA rasterlenmez;
  varyantsız şablon akış-modeli komutta kalır.
- **Çekirdek:** `src/services/helpers/raster/` — `raster-bitmap` (1bpp, MSB-first,
  1=siyah), `raster-font` (opentype.js + DejaVu `assets/fonts/`), `raster-text`
  (glif→scanline dolgu, `wr`/bold/rot), `raster-barcode` (bwip-js `raw()` → tam-dot
  blit), `raster-canvas` (7 eleman → bitmap), `raster-bmp` (BMP kodlayıcı + önizleme),
  `raster-envelope-{pplb,zpl,ppla}` (dil zarfı), `raster-render` (orkestratör).
- **Zarf:** PPLB `GW` (⚠ polarite 1=beyaz varsayımı, invert; F6 teyit), ZPL `^GFA`
  (1=siyah, invert yok, salt-ASCII), PPLA grafik indir+yerleştir (`PPLA_RASTER_VERIFIED`
  bayrağı arkasında — F6 fiziksel test öncesi KAPALI, komuta düşer).
- **Taşıma:** `encoding=b64` query/body → binary-safe base64 JSON (raster + komut TEK
  yoldan); param yoksa ham text (eski istemci/mobil bozulmaz — servis rasterMode'u
  bastırır). Electron IPC `contentB64` (main tek noktada Buffer'a çevirir), winspool/
  TCP/serial/CUPS ham byte yazar. Registry `renderedBytes()` tek geçit.
- **Fallback:** rasterize herhangi bir sebeple patlarsa (font eksik, PPLA gated) registry
  try/catch **komut moduna düşer** → baskı ASLA raster hatasıyla ölmez.
- **Bilinen açık işler (F6 fiziksel):** PPLB GW polaritesi, PPLA grafik format doğrulaması,
  barkod okunabilirliği (tam-dot modül), yoğunluk (H/D), mobil BT-SPP hız (şimdilik
  kapsam dışı — mobil komut modunda kalır). Editör tuvali @font-face ile DejaVu'ya
  yaklaştırılabilir (kozmetik; sözleşme yine CanvasPreview BMP'sinde).
