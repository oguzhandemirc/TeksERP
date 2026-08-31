-- Ticaret paketi: RUB para birimi (fiyatlama).
--
-- ⚠️ KENDİ MIGRATION'INDA GELİR ve yalnız bu satırı içerir: PostgreSQL'de
-- `ALTER TYPE ... ADD VALUE` ile eklenen enum değeri AYNI TRANSACTION içinde
-- KULLANILAMAZ. Yeni tabloları aynı dosyaya koymak, `DEFAULT 'RUB'` benzeri
-- tek bir kullanım doğduğu anda migration'ı patlatırdı.
--
-- IF NOT EXISTS: migration idempotent olsun (yarıda kesilen deploy tekrar
-- koşabilsin) — enum değeri eklemek geri alınamaz bir işlemdir.
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'RUB';
