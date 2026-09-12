-- =============================================================================
-- `merge_operation_refs.rowIds` DEFAULT düşürülür — şema ikizliği
-- =============================================================================
-- Prisma datamodel'inde skaler listenin DEFAULT'u YOKTUR; migration'da yazılan
-- `DEFAULT ARRAY[]::UUID[]` drift kapısında BELGESİZ fark olarak görünüyordu
-- (`test_schema_drift`). Davranış değişmez: uygulama diziyi her zaman açıkça yazar.
-- =============================================================================

ALTER TABLE "merge_operation_refs" ALTER COLUMN "rowIds" DROP DEFAULT;
