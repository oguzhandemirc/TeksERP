-- =============================================================================
-- Başlangıç değerinin YILI (e-İrsaliye E2-SERI, 2026-10-24)
-- =============================================================================
-- e-İrsaliye sırası her yıl 1'den başlar. Başka programla yıl ortasında kesen
-- fabrika TeksERP'e geçince o yılın sırasını sürdürmeli (mükerrer GİB no olmasın)
-- ama ERTESİ yıl yine 1'den başlamalı. Yılsız `startValue` her yılın ilk
-- numarasını o değerden başlatırdı; kolon değeri tek yıla bağlar.
--
-- NULL doğar = bugünkü davranış (başlangıç her dönemde geçerli); var olan hiçbir
-- satır değişmez. Yalnız sabit biçimli seri yazar (uygulama kapısı).
-- =============================================================================

ALTER TABLE "number_series" ADD COLUMN "startValueYear" INTEGER;

-- Yıl yalnız bir başlangıç değeriyle anlamlıdır (çift yüklem: uygulama kapısı).
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_start_value_year_check"
    CHECK ("startValueYear" IS NULL OR ("startValue" IS NOT NULL AND "startValueYear" BETWEEN 2000 AND 9999));
