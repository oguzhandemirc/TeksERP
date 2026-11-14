-- =============================================================================
-- Bildirim tercih profilleri (2026-11-15) — kişisel kayıtlı profil tablosu
-- =============================================================================
-- Ne yapar: `notification_preference_profiles` tablosunu açar (kişinin adla kaydettiği tür seçimi).
-- ADDITIVE: yalnız yeni tablo; mevcut tabloya dokunulmaz, backfill YOK → eski kod aynen çalışır.
-- Şema-dışı: açık/kapalı tür kümeleri ayrık (CHECK) · kişi başına canlı ad tekil (partial unique, harf duyarsız).
-- İdempotent: IF NOT EXISTS + duplicate_object yoklaması. Yeni tablo → yumuşak kapı gerekmez.
-- =============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_preference_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "onKinds" VARCHAR(64)[] DEFAULT ARRAY[]::VARCHAR(64)[],
    "offKinds" VARCHAR(64)[] DEFAULT ARRAY[]::VARCHAR(64)[],
    "archivedAt" TIMESTAMPTZ,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preference_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preference_profiles_clientToken_key" ON "notification_preference_profiles"("clientToken");
CREATE INDEX IF NOT EXISTS "notification_preference_profiles_userId_idx" ON "notification_preference_profiles"("userId");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "notification_preference_profiles" ADD CONSTRAINT "notification_preference_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Şema-dışı: bir tür aynı profilde hem açık hem kapalı olamaz.
DO $$ BEGIN ALTER TABLE "notification_preference_profiles" ADD CONSTRAINT "notification_preference_profiles_kinds_disjoint_ck" CHECK (NOT ("onKinds" && "offKinds")); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Şema-dışı: kişi başına canlı (arşivlenmemiş) profil adı tekil, harf duyarsız; arşivli ad yeniden kullanılabilir.
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preference_profiles_user_name_live_uq" ON "notification_preference_profiles"("userId", lower("name")) WHERE "archivedAt" IS NULL;
