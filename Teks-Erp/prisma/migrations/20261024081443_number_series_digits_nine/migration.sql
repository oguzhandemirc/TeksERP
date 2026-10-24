-- =============================================================================
-- Hane sedi 8 → 9 (e-İrsaliye E2-SERI, 2026-10-24)
-- =============================================================================
-- GİB e-İrsaliye numarası 3 karakter seri + 4 hane yıl + 9 hane sıradır
-- (⚠ biçim plan §3.6'da "doğrulanacak"). Katalogdaki `eIrsaliye` serisi 9 haneyle
-- tohumlanır; eski sed (<= 8) boot uzlaştırmasının INSERT'ünü reddederdi.
--
-- GENİŞLETME, daraltma değil: var olan her satır (1..8) yeni sedde de geçerli,
-- yani migration hiçbir satırı reddedemez. Diğer serilerde 9 hane yine yazılamaz —
-- uygulama kapısı (`assertSeriesFormatAllowed`) 1..8'i tutar, 9 yalnız sabit
-- biçimli (`fixedShape`) serinin değeridir. İki tablo aynı sedi taşır (satır =
-- zaman çizgisi, `number_series` = yürürlükteki satırın önbelleği).
-- =============================================================================

ALTER TABLE "number_series" DROP CONSTRAINT IF EXISTS "number_series_digits_range";
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_digits_range"
    CHECK ("digits" >= 1 AND "digits" <= 9);

ALTER TABLE "number_series_lines" DROP CONSTRAINT IF EXISTS "number_series_lines_digits_range";
ALTER TABLE "number_series_lines" ADD CONSTRAINT "number_series_lines_digits_range"
    CHECK ("digits" >= 1 AND "digits" <= 9);
