# Oturum D1 — `BLG.mimari`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/services/label.service.ts` (1.984) · `label-template.service.ts` (1.325) ·
`helpers/label-*` (16 dosya) · `helpers/native-*` (2) · `helpers/raster/*` (11 dosya, 1.126) ·
`services/document-render/**` (20 dosya, 5.632) · `printed-document.service.ts` (739)

**Kapsam DIŞI:** belge İÇERİĞİNİN doğruluğu (brüt kuralı vb.) → B6. Belge izinleri → P1 (BLG.GUV).
Etiket/belge CSS yerleşimi ve punto ayarları → **denetim dışı** (ürün kararı alanı).

**Okunacaklar:** `audit/raw/madge-circular.out` (14 satır, tamamı) · `audit/surface/01-modul-haritasi.md` §3, §4.2, §5.8 ·
`audit/raw/jscpd/jscpd-report.json` (yalnız BLG dosyaları, `jq` ile süz)

---

## YAPIŞTIRILACAK PROMPT

Bu bir DENETİM oturumudur. Kod DEĞİŞTİRME — salt okuma çalış.
Kod tabanı: /Users/oad/Documents/projeler/AdnanSahin/Teks-Erp (Express 5 + Prisma 7 + PostgreSQL, PRODUCTION CANLI).

ÇIKTI: bulgularını audit/FINDINGS.jsonl dosyasına APPEND et (satır başına bir JSON).
Şema ve yazım kuralları: audit/SCHEMA.md — ÖNCE ONU OKU.
Zorunlu alanlar: id, cell, severity, category, file, line, title, evidence, failure_mode,
fix_sketch, verification, status, confidence, session, found_at.

KALİTE KURALLARI:
- `failure_mode` üretemiyorsan (somut girdi -> somut yanlış sonuç) bu bir bulgu DEĞİLDİR.
  severity: bilgi ver ya da hiç yazma. "Bu kod karışık" bulgu değildir.
- Emin değilsen confidence: supheli ver ve verification alanına "nasıl kesinleşir" yaz.
- Aynı kök nedenin N tezahürü TEK bulgudur.
- CANLI SİSTEM: fix_sketch migration veya toplu veri dokunuşu öneriyorsa prod_risk: yuksek
  zorunlu ve geri alma yolu yazılmalı. `migrate reset` / reseed / toplu DELETE bu repoda YASAK.

YAZIM: Türkçe, teknik terimler İngilizce orijinaliyle. Emoji ve LaTeX kullanma.

OTURUM BAŞINDA ZORUNLU:
  jq -r 'select(.cell=="BLG.mimari") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = BLG.mimari

GÖREV: Etiket/belge alt sisteminin modüler sınırı. Bu, kod tabanının EN BÜYÜK (16.527 satır),
EN ÇOK DEĞİŞEN (churn %21,9) ve EN ÇOK MEKANİK SİNYAL VEREN context'i.

DİKKAT - BU OTURUM BİR REFACTOR ÖNERİSİ ÜRETMEZ. 16.527 satırlık çalışan bir alt sistemi
yeniden yazmak bir denetim bulgusu değildir. Aradığın şey: bu yapının HANGİ SOMUT HATA SINIFINI
üretmeye devam edeceği. "Karmaşık" bulgu değildir; "şu değişiklik yapılırsa şu sessizce bozulur" bulgudur.

DOĞRULANMIŞ TABAN:
- madge 14 circular dependency buldu, 13'ü burada.
- AMA modül haritası ajanı Tarjan SCC ile ölçtü: RUNTIME (value) import döngüsü YOK.
  14'ün hepsi `import type` kenarlarından geliyor ve derlemede silinir.
  Yani madge'in sinyali gerçek ama TEHLİKE SEVİYESİ farklı. Bunu doğrula ve doğru oku.
- jscpd: 32 klon ucu / ~930 satır (kod tabanının en yoğunu).
- document-render/*.html.ts dosyalarının 8'i printed-document.service'i, 2'si
  system-setting.service'i DOĞRUDAN import ediyor -> "saf renderer" değil, kendi verisini çekiyor.
- system-setting.service (fan-in 33) BLG'nin render sözleşmesine bağımlı
  (doc-style, traveler-card.density/fields/sections import ediyor) -> TERS bağımlılık.

1. TİP SÖZLEŞMESİ YANLIŞ DOSYADA. LabelPayload 20 dosyanın ortak sözleşmesi ama 1.984 satırlık
   label.service.ts'in İÇİNDE yaşıyor. 8 helper `import type { LabelPayload } from "../label.service"`
   yapıyor. SOMUT RİSK: biri `import type`'ı `import`'a çevirirse GERÇEK bir runtime döngü doğar
   ve TypeScript UYARMAZ (madge uyarır ama CI'da madge koşmuyor - doğrula).
   failure_mode: ne olur (modül yükleme sırasında undefined, boot'ta mı çalışma zamanında mı)?
   fix_sketch: sözleşmeyi ayrı bir types dosyasına almak - maliyeti ne?

2. BEŞ RENDER YOLU (PPLA, PPLB, ZPL, kanvas-HTML, raster) ve TEK UYGULAMA NOKTASI iddiası:
   config/label-elements.prepareElements. CLAUDE.md diyor ki "yeni bir emitter yazarken
   expandMultilineText'i DOĞRUDAN çağırma: koşul o dilde sessizce çalışmaz".
   DOĞRULA: beş yolun BEŞİ de gerçekten prepareElements'ten geçiyor mu? Biri atlıyorsa,
   showIf koşullu elemanlar o dilde sessizce basılır -> yanlış kalite damgası.

3. FAIL-CLOSED SÖZLEŞMESİ. CLAUDE.md: "SACK şablonu çözülemezse 400 (roll/swatch'a SAPMAZ -
   label-html-landscape.helper bilinmeyen kind'ı ROLL_FINISHED'a düşürüp tire dolu top etiketi
   basardı)". DOĞRULA: bugün her LabelKind için fail-closed mu? Yeni bir LabelKind eklenirse
   (CLAUDE.md 4 literal z.enum + KINDS dizileri + PeripheralDevices tipleri elle güncellenmeli
   diyor) hangi yol sessizce yanlış etiket basar? Bu "elle güncellenmeli" listesinin
   mekanik bir bekçisi var mı?

4. helpers/ İÇİNDE 27 DOSYA ASLINDA BLG'NİN MOTORU (label-*, native-*, raster/*).
   "helpers" adı bunların denetimde atlanmasına yol açıyor. Bunlar arasında domain kuralı
   taşıyan / DB yazan var mı? (Modül haritası §3 "domain kuralı taşıyan helper" sınıfı tanımlıyor.)

5. TERS BAĞIMLILIK: system-setting.service -> document-render/*. Ayar deposu, render
   sözleşmesine bağımlı. CLAUDE.md "dört kapı birlikte güncellenmeli" kuralının kaynağı burası
   (system-setting tipi + sanitizeDocumentsConfig + printed-document.controller.docConfigSchema
   + Electron aynası). BU DÖRT KAPININ MEKANİK BEKÇİSİ VAR MI? CLAUDE.md diyor ki bir kez
   gerçekten atlandı (docConfigSchema) ve "ayar kaydedilir, gerçek baskıda görünür, ama canlı
   önizlemede GÖRÜNMEZ" sessiz hatası doğdu. Bekçi (test_fason_ceki_html §17/§18) bugün
   dört kapıyı da kapsıyor mu, yoksa ikisini mi?

6. KLON YOĞUNLUĞU. document-render/fason-ceki.html.ts (8 klon) ve fason-direct-ship.html.ts (8).
   HTML şablonlarında kopya kısmen meşrudur. Hangileri meşru (görsel şablon), hangileri
   gerçek mantık kopyası (aynı hesap iki yerde)? Yalnız ikincisi bulgudur.

BİTİŞ KRİTERİ: 6 madde karara bağlanacak. Madde 1 ve 5 mutlaka somut failure_mode üretecek.
"Bu alt sistem karmaşık" cümlesi FINDINGS'e YAZILMAYACAK.
