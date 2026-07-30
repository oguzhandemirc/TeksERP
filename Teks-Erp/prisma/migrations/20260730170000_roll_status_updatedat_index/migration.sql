-- Envanter sekmelerinin "son hareket" sıralaması için composite index.
--
-- NEDEN: Depo/Çuvalda/Fasonda/İstasyon-bekleyen sekmelerinde topun oraya GELİŞ anı
-- `createdAt` DEĞİLDİR — kurtarma, kapanış dispozisyonu, fason kabulü veya finalize
-- haftalar önce yaratılmış bir topu bugün depoya alır. `createdAt` sıralı listede o
-- top binlerce satırın altına düşer ve operatör "depoya gitmedi" sanır (2026-07-30
-- saha bulgusu). Sekmeler artık `updatedAt desc` sıralıyor; eşitlik kolonu (status)
-- önce, range/order kolonu (updatedAt) sonra — performans kuralı §2.
--
-- ⚠️ CANLI DB: `CREATE INDEX` yazma kilidi alır. Bu migration'ı VARDİYA DIŞINDA
-- deploy et (CLAUDE.md §14). App DB'de statement_timeout=50s aktif olduğu için
-- büyük tabloda DDL yarıda kesilir → aşağıdaki SET zorunlu.
SET statement_timeout = 0;

CREATE INDEX IF NOT EXISTS "rolls_status_updatedAt_idx" ON "rolls" ("status", "updatedAt");
