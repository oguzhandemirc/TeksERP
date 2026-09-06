-- BULGU-T3-001 doğrulama denemesi
-- Amaç: kuyruktan flush edilip 409 POSSIBLE_DUPLICATE alan KK1 kaydının DB'de
-- iz bırakıp bırakmadığını kontrol etmek.
--
-- ÖNEMLİ: Bu sorgu YAPISAL OLARAK ANLAMSIZDIR ve bu oturumda bu yüzden
-- ÇALIŞTIRILAMADI (DB erişimi de zaten ortam hatasıyla kapalıydı — aşağıya
-- bak). inventory.service.ts:864-901 okunarak doğrulandı: guard tetiklenince
-- AppError.conflict `tx` İÇİNDE fırlatılıyor → Prisma callback'i ROLLBACK
-- ediyor. Bu noktaya kadar hiçbir INSERT yok (barkod sayacı bile artmamış).
-- Yani reddedilen ikinci top DB'de HİÇBİR satır, hiçbir audit log, hiçbir
-- "reddedildi" kaydı BIRAKMAZ — aranacak bir "ihlal satırı" yoktur; kaybın
-- kendisi de bu yüzden görünmezdir. Bu, bulgunun S1 gerekçesinin bir parçası
-- (kaynak: kanit[6] inventory.service.ts referansı) ve K2 sorgusunun bu bulgu
-- sınıfında neden yapısal olarak sonuçsuz kalacağının kanıtıdır.

-- Denenen (ama DB erişimi kapalı olduğu için koşulamayan) dolaylı sonda:
-- barkod sayacında "boşluk" var mı (bir top numarası atlanmış mı) — teorik
-- olarak guard'ın rollback'i barkod sayacını da artırmadığından bu da iz
-- bırakmaz (generateRollBarcode guard KONTROLÜNDEN SONRA çağrılıyor).
SELECT a."id", a."barcode", a."clientEnteredAt", a."createdAt"
FROM rolls a
WHERE a."clientEnteredAt" IS NOT NULL
  AND a."createdAt" - a."clientEnteredAt" > interval '10 minutes'
ORDER BY a."createdAt" DESC
LIMIT 100;
