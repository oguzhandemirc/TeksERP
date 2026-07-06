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
| logo/görsel | v1'de YOK (karar) | — | — | — |

- **Barkod okunur satırı** dört dilde de firmware'in sola-yasladığı satır KAPATILIP
  manuel olarak barkod ALTINDA ORTALANIR (code128WidthDots ile).
- **lengthBanner**: PPLB (saha yazıcısı) / ZPL / HTML'de siyah zemin + beyaz değer
  (reverse). PPLA/DPL'de ters-renk cihaza bağlı ve güvenilmez → değer siyah-üstü-siyah
  görünmez riskine düşmemek için ÇERÇEVELİ (kutu + siyah dikey değer). Fiziksel
  Argox-PPLA testinde reverse çalışırsa PPLA da dolguluya geçirilebilir (tek dal).
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
  önizlemesiyle sağlanır (native→SVG, `native-preview.ts`).
