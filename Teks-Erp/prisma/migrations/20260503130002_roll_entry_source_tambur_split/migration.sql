-- =============================================================================
-- RollEntrySource enum'una TAMBUR_SPLIT eklenir
-- =============================================================================
-- Tambur'da "KES" kararı sonucu yeni Roll oluşturulduğunda parent topun
-- entrySource'u kopyalanıyordu (PRODUCTION). Bu yanlış çünkü split parça
-- yeni bir envanter girişi — kaynağı parent değil, Tambur kesimidir.
--
-- Mevcut split rollerin entrySource'u parent'tan miras alındığı için
-- HATALI durumda. Düzeltme: parentRollId NOT NULL olan ve Tambur sonrası
-- statüde (SCRAP, A1_STOCK) olanları TAMBUR_SPLIT'e güncelle.
-- =============================================================================

-- 1) Enum'a yeni değer
ALTER TYPE "RollEntrySource" ADD VALUE IF NOT EXISTS 'TAMBUR_SPLIT';
