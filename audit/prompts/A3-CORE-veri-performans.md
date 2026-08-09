# Oturum A3 — `CORE.veri-performans`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/lib/prisma.ts` · `src/services/base.service.ts` · `helpers/roll-barcode.helper.ts` ·
`src/middlewares/auth.middleware.ts` + `device.middleware.ts` (istek başına DB maliyeti) ·
115 transaction çağrı noktasının **envanteri** (tek tek incelenmez — o iş B fazında)

**Kapsam DIŞI:** modül bazlı transaction doğruluğu → B fazı hücreleri. Index tasarımı → P1 (ENV.VER).

**Okunacaklar:** `audit/surface/06-veri-katmani.md` §2, §3.1-3.5, §7 (tamamı) · `05-middleware-zinciri.md` §9 madde 6

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
  jq -r 'select(.cell=="CORE.veri-performans") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = CORE.veri-performans

GÖREV: Veri katmanının GLOBAL yapılandırması ve maliyeti. Tek tek transaction'ların doğruluğu
BU OTURUMUN İŞİ DEĞİL (o B fazında) - burada hepsini birden etkileyen ayarlara bakılıyor.

Doğrulanmış taban: 115 gerçek $transaction, 111'i interactive. Havuz max=30,
connectionTimeout 5s, idleTimeout 600s. transactionOptions { maxWait: 5_000, timeout: 20_000 },
per-call override HİÇ YOK. isolationLevel hiçbir yerde verilmemiş -> hepsi READ COMMITTED.

İPUCU (ana oturumda bulundu): tambur.controller.ts:39-40'taki yorum kesim tavanını
"pathological girdinin 5s tx timeout'una yol açmasını önler" diye gerekçelendiriyor —
ama global timeout 20 sn (lib/prisma.ts:91). Yorum Prisma VARSAYILANINA (5s) göre yazılmış
ve ayar ezildiğinde güncellenmemiş. Yani 200'lük tavan 5 sn varsayımıyla seçilmiş, bugün
4 kat daha uzun bir bütçe var. Bu, "tavan hâlâ doğru değer mi" sorusunu doğuruyor.

1. TEK BÜTÇE, ÇOK FARKLI İŞ. 115 tx aynı 20 sn bütçesini paylaşıyor. En uzunları:
   tambur.finalize (377 satır, döngüde 200'e kadar kesim), subcontractor.dispatch (354, belge
   dondurma), executeDirectShip (315), receive (312), workorder.replace (305).
   SOR: 20 sn yeterli mi, ölçülebilir mi? P2028 (tx timeout) üretim log'unda hiç görüldü mü
   (SystemLog'da ara)? Bir tx timeout'a düşerse kullanıcı ne görüyor (error.middleware P2028 -> 503)?
   Bütçenin işe göre farklılaşmaması bir bulgu mu, yoksa "tek değer tutmak daha güvenli" mi?

2. BARKOD SAYACI SERİLEŞTİRME NOKTASI. helpers/roll-barcode.helper.ts:40 -
   INSERT ... ON CONFLICT (day,type) DO UPDATE n=n+1 RETURNING n, tablo roll_barcode_counters.
   Sayaç gün+tip başına TEK SATIR ve tx verilirse kilit TX BOYUNCA tutuluyor (kodun kendi yorumu).
   Yani tambur.finalize 377 satırlık işini yaparken sistemdeki TÜM top yaratma işlemleri bekliyor.
   ÖLÇ: kaç çağrı yolu bu sayacı tx içinde alıyor? Vardiya pikinde bu ne demek?
   fix_sketch: sayacı tx dışına almak mümkün mü (barkod boşluğu kabul edilebilir mi)?

3. HAVUZ 30 ↔ TEK PROCESS. max=30 bağlantı, tek process. 20 sn'lik uzun tx'ler havuzu tutuyor.
   connectionTimeoutMillis 5 sn = ALMA bütçesi. classifyPoolTimeout -> 503. SOR: 30 doğru sayı mı,
   PostgreSQL tarafındaki max_connections ile ilişkisi ne (runbook §6'ya bak)?

4. İSTEK BAŞINA DB MALİYETİ. verifyToken her istekte user.findUnique + session.findUnique
   (cache YOK). resolveDevice her x-device-id taşıyan istekte device.findUnique (cache YOK),
   ve bu middleware express.static'ten ÖNCE, yani statik dosya isteklerinde bile koşuyor.
   Tablet 5 saniyede bir yokluyor (listOpenCards), durum sayfası 5 sn'de bir /health.
   ÖLÇ: N istemci x 5 sn -> taban DB yükü. Cache eklenebilir mi, invalidation maliyeti ne?

5. assertNameNotDuplicate LIMIT'SİZ FINDMANY (base.service.ts:539). Her master-data
   create/update'inde tüm adayları belleğe çekip JS'te karşılaştırıyor (gerekçe: PG lower()
   Türkçe İ/ı'da hatalı - gerekçe geçerli). ÖLÇ: hangi modellerde kaç satır? Item/Color kaç kayıt?
   Bugün küçükse bulgu değil, "bilgi" olarak yaz ve eşik öner.

6. BaseService'in create/update/softDelete/hardDelete'i TRANSACTION KULLANMIYOR.
   nestedCreateFields Prisma'nın kendi nested write'ıyla atomik ama reactivate yolunda
   nested alanlar SESSİZCE atılıyor (satır 685-691). Bu bir doğruluk riski mi?

7. hardDelete P2003'ü 409'a çeviriyor ("bağlı kayıt var") AMA ilişkilerin 92'si örtük SET NULL
   (onDelete yazılmamış opsiyonel ilişki). SET NULL P2003 fırlatmaz, sessizce NULL'lar.
   Yani "bağlı kayıt varsa silinmez" güvencesi yalnız RESTRICT'li ilişkiler için geçerli.
   Roll.colorId, Roll.parentRollId, Roll.currentStepId gibi izlenebilirlik alanları etkileniyor mu?
   guarded-hard-remove.ts'in bağımlılık guard'ları bu boşluğu kapatıyor mu - TEK TEK doğrula.

BİTİŞ KRİTERİ: 7 madde karara bağlanacak. Madde 2 ve 7 için mutlaka somut failure_mode.
Bu oturum B fazının ön koşuludur: çıktısı "her ESZ oturumunun bilmesi gereken global gerçekler"
listesi olarak audit/surface/12-tx-global-gercekler.md dosyasına yazılacak.
