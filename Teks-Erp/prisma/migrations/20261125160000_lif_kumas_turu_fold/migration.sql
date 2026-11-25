-- K7/K8 katalog araması: METİN alanları katlanmış gölge kolondan aranır (test_search_field_config).
-- `20260819060000_search_fold` deseni; Prisma tarafında `@default(dbgenerated())`.
ALTER TABLE "fabric_types" ADD COLUMN "nameFold" TEXT GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "fiber_types" ADD COLUMN "nameFold" TEXT GENERATED ALWAYS AS (public.tr_fold("name")) STORED;
ALTER TABLE "fiber_types" ADD COLUMN "abbreviationFold" TEXT GENERATED ALWAYS AS (public.tr_fold("abbreviation")) STORED;
