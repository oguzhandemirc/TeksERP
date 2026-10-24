-- =============================================================================
-- Rapor v2 çekirdeği (R1-SEMA, `docs/design/RAPORLAR-V2-PLAN.md` §3.3) — yedi tablo + bir kolon
-- =============================================================================
-- ADDITIVE: yedi yeni tablo + `defect_types."defectGroup"` (NULL'lanabilir, CHECK'siz, backfill YOK);
-- mevcut tabloya başka dokunuş yok → eski kod yeni şemayla aynen çalışır. Yazan/okuyan kod
-- R1-KAYIT (tanım · sürüm · ön ayar · paylaşım · kategori) ve R1-SEMCEK (koşu · anlık görüntü).
-- SINIFLAR: report_categories / report_definitions / report_presets = KATALOG (audit'li, "sil" =
-- durum geçişi) · report_definition_versions = APPEND-ONLY (yalnız createdAt; düzenleme/geri alma
-- YENİ SÜRÜM SATIRIDIR — `defter-beyan.ts` DURUM) · report_shares = PİVOT (saf yapılandırma,
-- replace serbest) · report_runs / report_snapshots = TELEMETRİ (budanır; silinince raporlanan
-- sayı değişmez — audit muafiyeti + budama beyanı yazıcıyla birlikte R1-SEMCEK/R1-ZAMAN'da).
-- KOLON EŞLEMESİ (plan → kolon): ad→name · ustId→parentId · sira→sortOrder · tur→kind ·
-- anahtar→key · aciklama→description · kategoriId→categoryId · sahipId→ownerId ·
-- gorunurluk→visibility · durum→status · aktifSurumId→activeVersionId · bozukMu→isBroken ·
-- tanimId→definitionId · surumNo→versionNo · govde→body · gerekenIzinler→requiredPermissions ·
-- olusturanId→createdById · not→note · parametreler→params · paylasimli→isShared ·
-- varsayilan→isDefault · yetki→access · surumId→versionId · parametreOzeti→paramsDigest ·
-- kullaniciId→userId · baslangic→startedAt · sureMs→durationMs · satir→rowCount ·
-- hataKodu→errorCode · (yeni) backendPid · runId · sonuc→result · sonGecerlilik→expiresAt.
-- Durum DEĞERLERİ Türkçe kalır (VarChar + CHECK, aşağıda). ReportRun.status'a plan kümesine ek
-- `CALISIYOR` (iptal ucu koşan satırı bulur; varsayılan). FK'lar RESTRICT (kullanıcı soft delete);
-- tek istisna snapshot.runId SET NULL (koşu 90 günde budanır, görüntü yaşar).
-- İdempotent: IF NOT EXISTS + duplicate_object yoklaması. Yeni tablo → yumuşak kapı gerekmez.
-- =============================================================================

-- AlterTable
ALTER TABLE "defect_types" ADD COLUMN IF NOT EXISTS "defectGroup" VARCHAR(16);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(48),
    "name" VARCHAR(100) NOT NULL,
    "parentId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "report_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_definitions" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "key" VARCHAR(64),
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "categoryId" UUID NOT NULL,
    "ownerId" UUID,
    "visibility" VARCHAR(16) NOT NULL DEFAULT 'OZEL',
    "status" VARCHAR(16) NOT NULL DEFAULT 'TASLAK',
    "activeVersionId" UUID,
    "isBroken" BOOLEAN NOT NULL DEFAULT false,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_definition_versions" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "requiredPermissions" TEXT[],
    "createdById" UUID,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_definition_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_presets" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "params" JSONB NOT NULL,
    "ownerId" UUID NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "report_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_shares" (
    "definitionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "access" VARCHAR(16) NOT NULL DEFAULT 'GOR',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "report_shares_pkey" PRIMARY KEY ("definitionId","userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_runs" (
    "id" UUID NOT NULL,
    "definitionId" UUID,
    "key" VARCHAR(64),
    "versionId" UUID,
    "paramsDigest" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,
    "rowCount" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'CALISIYOR',
    "errorCode" VARCHAR(64),
    "backendPid" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "report_snapshots" (
    "id" UUID NOT NULL,
    "runId" UUID,
    "definitionId" UUID NOT NULL,
    "versionId" UUID,
    "params" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'KULLANICI',
    "clientToken" UUID,
    "expiresAt" TIMESTAMPTZ,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "report_categories_code_key" ON "report_categories"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_categories_parentId_idx" ON "report_categories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "report_definitions_key_key" ON "report_definitions"("key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "report_definitions_activeVersionId_key" ON "report_definitions"("activeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "report_definitions_clientToken_key" ON "report_definitions"("clientToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_definitions_categoryId_idx" ON "report_definitions"("categoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_definitions_ownerId_idx" ON "report_definitions"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "report_definition_versions_definitionId_versionNo_key" ON "report_definition_versions"("definitionId", "versionNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_presets_definitionId_ownerId_idx" ON "report_presets"("definitionId", "ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_presets_ownerId_idx" ON "report_presets"("ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_shares_userId_idx" ON "report_shares"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_runs_userId_startedAt_idx" ON "report_runs"("userId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_runs_definitionId_idx" ON "report_runs"("definitionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_runs_versionId_idx" ON "report_runs"("versionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_runs_createdAt_idx" ON "report_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "report_snapshots_clientToken_key" ON "report_snapshots"("clientToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_snapshots_definitionId_createdAt_idx" ON "report_snapshots"("definitionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_snapshots_runId_idx" ON "report_snapshots"("runId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_snapshots_versionId_idx" ON "report_snapshots"("versionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_snapshots_createdById_idx" ON "report_snapshots"("createdById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_snapshots_expiresAt_idx" ON "report_snapshots"("expiresAt");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_categories" ADD CONSTRAINT "report_categories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_categories" ADD CONSTRAINT "report_categories_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_categories" ADD CONSTRAINT "report_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "report_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "report_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "report_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_definition_versions" ADD CONSTRAINT "report_definition_versions_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_definition_versions" ADD CONSTRAINT "report_definition_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_presets" ADD CONSTRAINT "report_presets_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_presets" ADD CONSTRAINT "report_presets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "report_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_runId_fkey" FOREIGN KEY ("runId") REFERENCES "report_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "report_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ŞEMA-DIŞI: partial unique (Prisma ifade edemez → `test_db_invariants`)
-- Kullanıcı başına rapor başına TEK varsayılan ön ayar: R1-KAYIT'ın "varsayılan yap" seddi.
CREATE UNIQUE INDEX IF NOT EXISTS "report_presets_one_default_uq"
    ON "report_presets"("definitionId", "ownerId") WHERE "isDefault" = true;

-- ŞEMA-DIŞI: CHECK'ler (kapalı kümeler VarChar + CHECK; `defectGroup` bilinçli CHECK'siz)
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_kind_ck" CHECK ("kind" IN ('SISTEM', 'OZEL')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_visibility_ck" CHECK ("visibility" IN ('OZEL', 'PAYLASIMLI', 'HERKES')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_status_ck" CHECK ("status" IN ('TASLAK', 'YAYINDA', 'ARSIV')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Biçim: SISTEM satırı katalog anahtarıyla doğar ve sahipsizdir; OZEL satır sahiplidir, anahtarsızdır.
DO $$ BEGIN ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_kind_shape_ck" CHECK (("kind" = 'SISTEM' AND "key" IS NOT NULL AND "ownerId" IS NULL) OR ("kind" = 'OZEL' AND "key" IS NULL AND "ownerId" IS NOT NULL)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_definition_versions" ADD CONSTRAINT "report_definition_versions_version_no_ck" CHECK ("versionNo" >= 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_access_ck" CHECK ("access" IN ('GOR', 'DUZENLE')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_status_ck" CHECK ("status" IN ('CALISIYOR', 'TAMAM', 'ZAMAN_ASIMI', 'IPTAL', 'HATA')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_counts_ck" CHECK (("durationMs" IS NULL OR "durationMs" >= 0) AND ("rowCount" IS NULL OR "rowCount" >= 0)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_kind_ck" CHECK ("kind" IN ('KULLANICI', 'ZAMANLANMIS')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
