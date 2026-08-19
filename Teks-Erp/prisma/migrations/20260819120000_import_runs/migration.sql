-- =============================================================================
-- IMPORT RUN — toplu içe aktarım geçmişi
-- =============================================================================
-- Tasarım: docs/design/IMPORT-EXPORT-TASARIM.md (D5 — kalıcı geçmiş tablosu)
--
-- Neden ayrı tablo: SystemLog 6 ayda arşive taşınır; "bu 400 müşteriyi kim,
-- hangi dosyayla yükledi" sorusu yıllar sonra da sorulur (künye kolonlarıyla
-- aynı gerekçe).
--
-- Yeni tablo — mevcut veriye DOKUNMAZ, kilit almaz, geri alınabilir (DROP).

CREATE TYPE "ImportRunStatus" AS ENUM ('APPLIED', 'PARTIAL', 'FAILED');

CREATE TABLE "import_runs" (
    "id"             UUID NOT NULL,
    "entity"         VARCHAR(40) NOT NULL,
    "userId"         UUID,
    "fileName"       VARCHAR(255),
    "clientToken"    UUID,
    "rowCount"       INTEGER NOT NULL DEFAULT 0,
    "created"        INTEGER NOT NULL DEFAULT 0,
    "updated"        INTEGER NOT NULL DEFAULT 0,
    "skipped"        INTEGER NOT NULL DEFAULT 0,
    "failed"         INTEGER NOT NULL DEFAULT 0,
    "status"         "ImportRunStatus" NOT NULL,
    "durationMs"     INTEGER NOT NULL DEFAULT 0,
    "stoppedAtRowNo" INTEGER,
    "options"        JSONB,
    "errorReport"    JSONB,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- İdempotency anahtarı: aynı deneme (timeout-retry) ikinci kez YAZMAZ.
CREATE UNIQUE INDEX "import_runs_clientToken_key" ON "import_runs"("clientToken");

-- Geçmiş ekranının iki sorgusu: varlık bazlı liste + genel zaman sırası.
CREATE INDEX "import_runs_entity_createdAt_idx" ON "import_runs"("entity", "createdAt");
CREATE INDEX "import_runs_userId_idx" ON "import_runs"("userId");
CREATE INDEX "import_runs_createdAt_idx" ON "import_runs"("createdAt");

-- Kullanıcı silinirse koşum kaydı KALIR (kim olduğu NULL'lanır) — geçmiş
-- kaydını silmek, denetim izini silmek olurdu.
ALTER TABLE "import_runs"
    ADD CONSTRAINT "import_runs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
