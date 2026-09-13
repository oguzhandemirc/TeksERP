-- =============================================================================
-- DOKUMA İŞİ TARAF XOR — `weaving_orders_party_ck` (2026-09-13, yazma yüzeyi)
-- =============================================================================
-- NE YAPIYOR: `weaving_orders`a tek CHECK — fasona verilen işte fasoncu DOLU,
--   iç işte BOŞ. P1 (20260913180000_weaving_order) bunu BİLEREK erteledi:
--   "kapısız bir CHECK, yazanı olmayan bir kısıttır" ⇒ yazma yüzeyiyle
--   (weaving-order.service, uygulama 400 = ilk hat) AYNI dilimde iner.
--   Çift yüklem: iki yazar da karşı koşulu kendi WHERE/doğrulamasına koyar,
--   DB CHECK sondur.
--
-- HACİM: tablo bugüne kadar YAZANSIZ (servis bu dilimde doğuyor) ⇒ her kurulumda
--   0 satır; NOT VALID + VALIDATE ayrımı konusuz, düz ADD CONSTRAINT.
--
-- ⚠️ `subcontractorId` NULL iken `executionKind = 'SUBCONTRACTED'` ve
--   `subcontractorId` DOLU iken `IN_HOUSE` — ikisi de REDDEDİLİR. Üçüncü bir
--   `executionKind` değeri gelirse bu CHECK onu da reddeder (fail-closed);
--   o gün yeni dal buraya AÇIKÇA yazılır.
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (elle yazıldı; `migrate dev` koşulmadı).
-- =============================================================================

ALTER TABLE "weaving_orders" ADD CONSTRAINT "weaving_orders_party_ck"
  CHECK (
    ("executionKind" = 'SUBCONTRACTED' AND "subcontractorId" IS NOT NULL)
    OR ("executionKind" = 'IN_HOUSE' AND "subcontractorId" IS NULL)
  );
