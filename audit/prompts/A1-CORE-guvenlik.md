# Oturum A1 — `CORE.guvenlik`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:**
`src/middlewares/auth.middleware.ts` · `rbac.middleware.ts` · `login-lockout.ts` ·
`src/services/base.service.ts` (satır 239-300, 485-560) · `src/app.ts` (1-140) ·
`src/routes/**` (yalnız guard dizilimi açısından)

**Kapsam DIŞI:** kimlik doğrulama iş mantığı (token üretimi, PIN/kart doğrulaması) → C1'e ait.
Belge izinleri (`DOC_PERMISSIONS`) → BLG.guvenlik'e ait (P1).

**Okunacaklar:** `audit/raw/_GUARD-BASELINE.md` (tamamı) · `audit/surface/05-middleware-zinciri.md` §3, §6, §7.2

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
  jq -r 'select(.cell=="CORE.guvenlik") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = CORE.guvenlik

GÖREV: HTTP giriş katmanının yetkilendirme kapısını denetle.

Doğrulanmış taban (audit/raw/_GUARD-BASELINE.md): 500 route handler, 8'inde verifyToken yok
(5 login + 3 cihaz el sıkışması), 14'ünde izin guard'ı yok. router.use(verifyToken) HİÇ YOK.

1. FAIL-OPEN İDDİASI. verifyToken her route'a tek tek takılıyor. Bunun mekanik bir bekçisi yok
   (scripts/test_permission_catalog.ts "verifyToken" kelimesini hiç geçirmiyor - doğrula).
   Sorular: (a) route stack'ini gezip her katmanın auth taşıdığını doğrulayan bir bekçi YAZILABİLİR mi
   (emsal: scripts/test_document_template_permission.ts:90 route stack'i okuyor)?
   (b) Muaf listesi nasıl gerekçelendirilir? (c) Bu bir bulgu mu yoksa kabul edilmiş bir tasarım mı?
   Cevabı fix_sketch'e yaz.

2. BaseService.safeFilters ENUMERATION. base.service.ts:254-300'deki F30 yorumu diyor ki
   filter[] allowlist'i modelin TÜM kolonlarıdır, response select'inde gizli kolon bile
   eşitlik-probe edilebilir. Yorum kuralı da koyuyor: "DÜZ saklanan sır kolonlu modeli
   BaseService'e BAĞLAMA". DOĞRULA: BaseService'e bağlı modellerin TAM listesini çıkar
   (route dosyalarında `new BaseService({modelName})` ara) ve her birinde sır/hassas kolon
   var mı schema.prisma'dan kontrol et. quickPin, cardToken, passwordHash özellikle ara.
   Bulgu varsa kritik.

3. RATE LIMIT YOK. express-rate-limit benzeri paket kurulu değil (doğrulandı). Tek throttle
   login-lockout ve o da process-local bir Map. Hangi uçlar rate limit olmadan istismara açık:
   kimlik doğrulamasız olanlar (POST /api/devices/announce KAYIT YARATIYOR, GET /health),
   ve pahalı olanlar (rapor uçları, sack-search, accounting-export). Somut failure_mode yaz.

4. CORS. Access-Control-Allow-Origin: * ve origin allowlist yok (ölçüldü). Kimlik Authorization
   header'ında, cookie yok -> klasik CSRF doğrudan uygulanmıyor. Ama public login uçları
   herhangi bir web sayfasından çağrılabilir. Bu LAN-only duruşta kabul edilebilir mi?
   Kararı gerekçelendir, "CORS * kötüdür" deme.

5. requirePermission wildcard semantiği (rbac.middleware.ts:23-40): "*" tüm izinleri,
   "domain:*" tek seviyeli. matchesPermission'ın atlayabileceği bir kod biçimi var mı?
   Katalogdaki 67 izin kodunun hepsi tek kolonlu mu?

BİTİŞ KRİTERİ: 5 maddenin her biri için ya bir FINDINGS satırı ya da "risk yok" gerekçesi
yazılmış olacak. Madde 2'nin model listesi eksiksiz olacak.
