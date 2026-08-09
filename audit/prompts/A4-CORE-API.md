# Oturum A4 — `CORE.API`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/controllers/**` (22 dosya / 6.714 satır) · `src/utils/**` (7 dosya / 909 satır:
`app-error` 63, `query-parser` 272, `cursor` 290, `code-format` 176, `barcode-retry` 41, `p2002` 38) ·
`src/types/api.types.ts` · `src/controllers/base.controller.ts`

**Kapsam DIŞI:** guard kapsaması → A1. Hata middleware'inin iç dalları → A2.
Transaction bütçesi → A3. Domain iş kuralları → B fazı.

**Okunacaklar:** `audit/surface/10-tamlik-elestirisi.md` §1.2, §1.4, §1.5, §4.6 ·
`jq 'select(.cell=="CORE.guvenlik" or .cell=="CORE.ops")' audit/FINDINGS.jsonl`

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
  jq -r 'select(.cell=="CORE.API") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = CORE.API

GÖREV: İstemciye verilen sözleşme ve onu üreten iki katman: controller'lar ve utils/ sorgu çekirdeği.

NEDEN BU HÜCRE VAR: yüzey haritasını üreten dokuz ajanın HİÇBİRİ bir controller dosyasının
İÇİNE girmedi (13 controller'ın adı hiçbir belgede geçmiyor) ve src/utils/'in 6 dosyası
yalnız kavram düzeyinde anıldı. Oysa bu projenin KANITLANMIŞ en pahalı sessiz hata sınıfı
tam burada yaşadı: POST /api/traveler-cards/:id/print-event ucunun controller bind'ı eksikti,
uç 2026-08-05'te eklendi ve 2026-08-06'ya kadar HER çağrıda 500 verdi. Üç katman birden yuttu
(istemci hatayı best-effort yutuyordu, servis bekçileri controller'ı hiç geçmiyor,
TypeScript `controller.method` referansını geçerli sayıyor).

1. BAĞLAMA (bind) KONVANSİYONU. Ölçüldü: üç konvansiyon yan yana yaşıyor —
   arrow-property (6 dosya, otomatik bağlı), prototip metodu + constructor'da açık .bind(this)
   (11 dosya), statik metot (4 dosya). ÖNEMLİ: bu sınıf için ARTIK BEKÇİ VAR —
   scripts/test_controller_binds.ts (137 satır, 2026-08-06'da tam bu vakadan sonra yazıldı,
   körlük zemini taşıyor: MIN_CLASSES_WITH_BIND=10, MIN_HANDLERS=100, MIN_ROUTE_REFS=100).
   SENİN İŞİN bind'ı yeniden aramak DEĞİL. Sor: (a) bekçinin regex tabanlı taraması üç
   konvansiyonu da tanıyor mu, yoksa dördüncü bir yazım biçimi sessizce kaçar mı?
   (b) Körlük zemini sayıları bugünkü gerçeğe göre yeterince yüksek mi?
   (c) Karışık konvansiyonu tekleştirmek maliyeti neye değer — yoksa bekçi yeterli mi?

2. YANIT ZARFI TUTARLILIĞI. types/api.types.ts ApiResponse/PaginatedResponse tanımlıyor
   (fan-in 43). ÖLÇ: 500 ucun kaçı bu zarfı kullanıyor, kaçı ham nesne dönüyor?
   Başarı yanıtlarında { success, data } tutarlı mı? Sayfalı yanıtlarda meta alanları aynı mı?
   Tutarsızlık varsa hangi istemci kodu buna göre dallanmak zorunda kalıyor?

3. DURUM KODU DİSİPLİNİ. Kaynak yaratan uçlar 201 mi 200 mü dönüyor?
   Atomik claim başarısızlığı her yerde 409 mu? Yıkıcı işlemlerde 204 mü 200 mü?
   Bunlar tek tek doğrulanmalı; sözleşme ihlali sessizdir çünkü istemci genelde yalnız
   2xx/4xx ayrımına bakar.

4. GİRDİ DOĞRULAMANIN YERİ. Ölçüldü: 140 nokta `<şema>.parse(req.body)` kullanıyor,
   asyncHandler yok, 432 catch bloğunun hepsi next(err) çağırıyor. SOR: doğrulama
   controller'da mı servis girişinde mi — ikisi karışık mı? Karışıksa hangi uçlar
   doğrulanmamış gövdeyi servise geçiriyor? Express 5'te req.body parse edilmemişse
   undefined'dır (4'te {} idi) — 140 .parse çağrısı bunu ZodError'a çeviriyor,
   ama .parse KULLANMAYAN uçlar var mı?

5. utils/query-parser.ts (272 satır, fan-in 15) — BU DOSYA HİÇ AÇILMADI ve içinde
   projenin en yeni canlı vakası yaşıyor: readIdCondition (2026-08-06 çoklu-seçim CSV kuralı).
   Kök CLAUDE.md üç arıza modunu sayıyor: uuid kolonda P2007->400, uuid olmayan string
   kolonda SESSİZ 0 satır, ön-süzgeçli alanda filtrenin SESSİZCE DÜŞMESİ (en tehlikelisi:
   boş liste değil YANLIŞ liste). DOĞRULA: elle filtre okuyan TÜM liste servisleri
   readIdCondition'dan geçiyor mu? Geçmeyen bir tane bile varsa bulgu.
   Ayrıca MAX_OFFSET=10000 guard'ı burada yaşıyor — aşıldığında ne oluyor?

6. utils/cursor.ts (290 satır, fan-in 25) — SIFIR sembol eşleşmesiyle hiç incelenmemiş.
   Keyset cursor kodlama/çözme: cursor istemciden geliyor, yani GÜVENİLMEZ GİRDİ.
   Bozuk/kurcalanmış cursor ne yapıyor (500 mü, 400 mü, sessiz yanlış sayfa mı)?
   sortNullable (nulls-last) doğru mu — union'ın iki tarafında alan adı farklı olan
   dispatchedAt/shippedAt vakası CLAUDE.md'de yazılı, o kural burada mı yaşıyor?

7. utils/app-error.ts (63 satır, FAN-IN 75). Bu, kod tabanının en çok import edilen dosyası —
   doc 01'in "hub servisleri" tablosundaki en yüksek değerden (audit.service 50) BÜYÜK,
   yani o tablo eksikti. Statik fabrikalar hangi statusCode'ları üretiyor?
   `details: Record<string, unknown>` filtresiz biçimde yanıta konuyor (A2'de işaretlendi) —
   servis katmanında details'e ne konduğunu TEK TEK doğrula: iç hata metni, SQL parçası,
   kullanıcı/kayıt kimliği sızıyor mu?

8. types/express-augment.ts: req.user ve req.device'ın İKİSİ DE OPSİYONEL.
   Bu, verifyToken'ın route başına takılmasının (fail-open) TİP TARAFINDAKİ İKİZİ:
   guard'sız bir handler req.user okursa undefined görür ve TypeScript uyarmaz.
   Kaç handler req.user'ı non-null assertion (!) ile okuyor? Bunların hepsi gerçekten
   guard'lı route'ta mı? (Bu, CORE.tip-guvenligi P1 hücresiyle kesişir — related ile bağla.)

BİTİŞ KRİTERİ: 8 madde karara bağlanacak. Madde 2 ve 3 için sayısal tablo üretilecek
(kaç uç uyumlu / kaç uç değil). Madde 5'in "geçmeyen servis" listesi eksiksiz olacak.
