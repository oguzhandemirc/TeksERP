-- 20261107120000'in kurduğu partial "rolls_tambur_createdAt_idx" uygulama yolunda ÖLÜ:
-- Prisma 7 `in`/`notIn` enum değerlerini CAST($n::text AS "public"."RollEntrySource") olarak
-- bağlar; planlayıcı predicate'i ispatlayamaz, index hiç seçilmez (#621 incelemesi, VERITABANI DB-14).
-- Tambur listesi genel "rolls_createdAt_id_idx" ile Index Scan alır; ölü index yalnız yazma bedelidir.
DROP INDEX IF EXISTS "rolls_tambur_createdAt_idx";
