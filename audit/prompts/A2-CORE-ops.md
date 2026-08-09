# Oturum A2 — `CORE.ops`

> Bu dosyanın TAMAMI yeni bir oturuma yapıştırılmak içindir.
> Kaynak: audit/PLAN.md §7. Değişiklik gerekirse PLAN.md'yi düzenle ve bu dosyaları yeniden üret.

## Kapsam ve girdiler

**Kapsam:** `src/middlewares/error.middleware.ts` (515 satır) · `latency.middleware.ts` ·
`src/app.ts` (`/health`, 285-387) · `src/server.ts` (graceful shutdown) · `src/lib/pool-health.ts` ·
`src/services/audit.service.ts`

**Kapsam DIŞI:** yedekleme/db-copy operasyonları → C2. Deploy prosedürü → C2.

**Okunacaklar:** `audit/surface/05-middleware-zinciri.md` §4, §5, §7.5, §8, §9 · `07-async-yuzey.md` §10

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
  jq -r 'select(.cell=="CORE.ops") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl
  (mükerrer üretmemek için; boşsa ilk oturumdur)

VERİMLİLİK: ham araç çıktılarını (audit/raw/*.out) ve route envanterlerini BÜTÜN OLARAK OKUMA.
Hedefli grep/jq yap. Yüzey belgelerinden yalnız aşağıda listelenenleri oku.

BU OTURUMUN HÜCRESİ:  cell = CORE.ops

GÖREV: Hata yolu ve gözlemlenebilirlik. "Sessizce yanlış davranan sistem" sınıfı.

Doğrulanmış taban: instances=1 (fork mode, pazarlık dışı invariant). Bu yüzden bu oturumda
"cluster'da bozulur" DEME - onun yerine "tek process düşerse ne olur" ve "bu invariant
kırılırsa ne SESSİZ kalır" sorularını sor.

1. headersSent BOŞLUĞU. `grep -rn headersSent src/` -> 0 sonuç (doğrulandı). Tek akış yanıtı:
   admin.routes.ts:1225 `res.download(abs, name)` (callback'siz). Aktarım ortasında hata
   olursa Express next(err) verir, errorHandler res.status(500).json() dener, başlıklar
   gönderilmiştir. SOMUT OLARAK ÖLÇ: bu durumda ne olur - Express default handler'a mı düşer,
   uncaughtException mı olur, process ölür mü? server.ts:uncaughtException -> gracefulShutdown(1).
   Tek process olduğu için bu bir kullanılabilirlik riskidir. failure_mode'u somut yaz.

2. LOG/METRİK KÖR NOKTASI. express.json (app.ts:104) morgan (107) ve latency (115)
   middleware'lerinden ÖNCE. Bozuk JSON (400) ve 1MB aşımı (413) istekleri ne erişim log'una
   ne gecikme metriğine düşüyor. latency.middleware.ts'in kendi yorumu "tüm istekler ölçülür"
   diyor - bu ifade yanlış. Ayrıca preflight OPTIONS cors'ta sonlanıyor, o da ölçülmüyor.
   Düzeltmenin maliyeti ne (middleware sırasını değiştirmek neyi bozar)?

3. BİLİNMEYEN PRISMA KODU -> 400 + AUDIT YOK. error.middleware dal 6'nın sonu: tanınmayan P****
   kodu 400 döndürüyor ve audit yazmıyor, yalnız console.error. Yani sunucu kaynaklı bir arıza
   istemci hatası gibi görünür ve /health'in auditWriteFailures sayacına düşmez. Hangi Prisma
   kodları bu dala düşüyor (P2010 raw query failed dahil)?

4. KAPANIŞ UYUMSUZLUĞU. gracefulShutdown 5 sn'de process.exit(1) zorluyor (server.ts:114),
   ama global transactionOptions.timeout 20 sn. Ayrıca spawn edilen pg_dump/pg_restore child'ları
   detached DEĞİL ve öldürülmüyor -> yetim kalıyor, runBackupJob'un catch'indeki fs.rm temizliği
   koşmuyor -> yarım .dump dosyası kalıyor. Bunun bir sonraki yedek turuna etkisi ne?

5. MIDDLEWARE SIRASI KİLİTSİZ. `grep -l "helmet\|exposedHeaders\|compression" scripts/` -> 0.
   app.ts'i import eden 9 test var, hiçbiri sıra doğrulamıyor. Bir refactor helmet'i cors'un
   arkasına ya da errorHandler'ı 404'ün önüne alırsa hiçbir kırmızı çıkmaz. Bekçi yazılabilir mi?

6. /health HER ZAMAN 200 döndürüyor (DB düşse bile, gövdede db:"DOWN" diyerek). Dış izleme
   HTTP durum koduyla DB kaybını göremez. Docker'da backend healthcheck'i de yok. Bu bilinçli mi?

7. poolAcquireTimeouts sayacı YALNIZ HTTP hata yolundan artıyor - zamanlayıcı işlerindeki havuz
   zaman aşımı görünmüyor (pool-health.ts'in kendi yorumu söylüyor). Doğrula ve etkisini yaz.

BİTİŞ KRİTERİ: 7 maddenin her biri karara bağlanmış olacak. Madde 1 için failure_mode
mutlaka somut (hangi istek, hangi anda kesinti, sonuç ne).
