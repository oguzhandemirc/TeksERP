-- TOP BARKODU ÜST SINIRI: kod sabiti → seri ayarı (2026-09-24)
--
-- ⚠️ BU MIGRATION BİR DAVRANIŞ KORUMASIDIR, yeni bir özellik değil.
-- `MAX_ROLL_SEQ = 9999` bugüne kadar KODDA yaşıyordu ve `roll` serisi YAPISAL
-- kilitli olduğu için `number_series.maxValue` hiç kullanılmadı: mevcut
-- kurulumlarda o kolon NULL. Kapasite koddan seriye taşınınca NULL "sınır yok"
-- demeye başlıyor ⇒ dokunulmazsa bugün 9999'da "gün doldu" diyen fabrikalar
-- sessizce SINIRSIZ üretime geçerdi. Varsayılan = BUGÜNKÜ DAVRANIŞ kuralı bunu
-- yasaklar, bu yüzden sınır bir kereye mahsus veriye yazılır.
--
-- ⚠️ KULLANICI TERCİHİ EZİLMİYOR: bu seri bugüne kadar panelden düzenlenemezdi
-- (`lockedReason`), yani NULL bir SEÇİM değil hiç yazılmamışlığın izidir. Bu
-- yüzden `WHERE "maxValue" IS NULL` koşulu yeterli ve güvenlidir — sınırı bilerek
-- kaldıran bir fabrika (bundan sonra olabilir) ikinci kez ezilmez.
--
-- ADDITIVE: tek satır güncellemesi, şema değişmiyor, idempotent.
UPDATE "number_series"
   SET "maxValue" = 9999
 WHERE "key" = 'roll' AND "maxValue" IS NULL;
