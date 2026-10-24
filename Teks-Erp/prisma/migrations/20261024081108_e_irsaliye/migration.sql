-- =============================================================================
-- e-İrsaliye şeması (E1-SEMA, `docs/design/E-IRSALIYE-PLAN.md` §3.1–§3.2) — üç tablo, üç enum
-- =============================================================================
-- ADDITIVE: yalnız yeni tipler + tablolar + sedler; mevcut tabloya/satıra dokunulmaz, backfill
-- YOK → eski kod ve eski istemci aynen çalışır (yazan/okuyan kod E5'te doğar).
--   e_irsaliyeler       DURUM tablosu ("şu an ne"); kaynak başına TEK canlı kayıt (partial unique)
--   e_irsaliye_xmllari  DONMUŞ XML sürümleri (append-only; mühür `e_irsaliye_xml_degismez`)
--   e_irsaliye_olaylari OLAY DEFTERİ (append-only; ortak mühür `defter_block_tamper`)
-- Sedler (Prisma ifade edemez → `scripts/test_db_invariants.ts` envanteri; davranış
-- `scripts/test_e_irsaliye_db_invariants.ts`): numaralı/gönderilmiş durum CHECK'leri (çift yüklem),
-- GİB numara biçimi, indirme sayacı ≥ 0, doğuş olayı ⇔ fromStatus NULL.
-- `defter_block_tamper()` burada TANIMLANMAZ (K-A3 `20260925160000_roll_status_events`te doğar).
-- Prisma'nın ürettiği FK düşürme satırları silindi (rolls/swatches DEFERRABLE composite FK'ları — reçete md. 11).
-- İdempotent: IF NOT EXISTS · duplicate_object yoklaması · OR REPLACE · DROP TRIGGER IF EXISTS.
-- Yeni tablo → yumuşak kapı gerekmez (sedler boş tabloya kurulur).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "EIrsaliyeSourceType" AS ENUM ('SHIPMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EIrsaliyeStatus" AS ENUM ('TASLAK', 'OLUSTURULDU', 'GONDERILDI', 'KABUL', 'KISMI_KABUL', 'REDDEDILDI', 'HATA', 'IPTAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EIrsaliyeEventType" AS ENUM ('HAZIRLANDI', 'OLUSTURULDU', 'XML_YENIDEN_URETILDI', 'GONDERILDI', 'GONDERIM_GERI_ALINDI', 'YANIT_KAYDEDILDI', 'YANIT_GERI_ALINDI', 'HATA_ALINDI', 'IPTAL_EDILDI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "e_irsaliyeler" (
    "id" UUID NOT NULL,
    "sourceType" "EIrsaliyeSourceType" NOT NULL,
    "sourceId" UUID NOT NULL,
    "shipmentId" UUID,
    "status" "EIrsaliyeStatus" NOT NULL DEFAULT 'TASLAK',
    "documentNo" VARCHAR(16),
    "ettn" UUID,
    "confirmedNo" VARCHAR(32),
    "confirmedEttn" UUID,
    "adapter" VARCHAR(32) NOT NULL,
    "printedDocumentId" UUID,
    "printedDocVersion" INTEGER,
    "currentXmlId" UUID,
    "sentXmlId" UUID,
    "licensePlate" VARCHAR(32),
    "trailerPlate" VARCHAR(32),
    "driverFirstName" VARCHAR(100),
    "driverFamilyName" VARCHAR(100),
    "driverNationalId" VARCHAR(11),
    "carrierName" VARCHAR(200),
    "carrierTaxId" VARCHAR(11),
    "recipientFirstName" VARCHAR(100),
    "recipientFamilyName" VARCHAR(100),
    "sentAt" TIMESTAMPTZ,
    "responseAt" TIMESTAMPTZ,
    "responseNote" VARCHAR(1000),
    "responseSummary" JSONB,
    "lastDownloadedAt" TIMESTAMPTZ,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "replacesId" UUID,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "e_irsaliyeler_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "e_irsaliye_xmllari" (
    "id" UUID NOT NULL,
    "eIrsaliyeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "ettn" UUID NOT NULL,
    "xml" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "validation" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "e_irsaliye_xmllari_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "e_irsaliye_olaylari" (
    "id" UUID NOT NULL,
    "eIrsaliyeId" UUID NOT NULL,
    "type" "EIrsaliyeEventType" NOT NULL,
    "fromStatus" "EIrsaliyeStatus",
    "toStatus" "EIrsaliyeStatus" NOT NULL,
    "xmlId" UUID,
    "note" VARCHAR(1000),
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "e_irsaliye_olaylari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "e_irsaliyeler_documentNo_key" ON "e_irsaliyeler"("documentNo");
CREATE UNIQUE INDEX IF NOT EXISTS "e_irsaliyeler_ettn_key" ON "e_irsaliyeler"("ettn");
CREATE UNIQUE INDEX IF NOT EXISTS "e_irsaliyeler_currentXmlId_key" ON "e_irsaliyeler"("currentXmlId");
CREATE UNIQUE INDEX IF NOT EXISTS "e_irsaliyeler_sentXmlId_key" ON "e_irsaliyeler"("sentXmlId");
CREATE UNIQUE INDEX IF NOT EXISTS "e_irsaliyeler_clientToken_key" ON "e_irsaliyeler"("clientToken");
CREATE INDEX IF NOT EXISTS "e_irsaliyeler_status_createdAt_idx" ON "e_irsaliyeler"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "e_irsaliyeler_shipmentId_idx" ON "e_irsaliyeler"("shipmentId");
CREATE INDEX IF NOT EXISTS "e_irsaliyeler_sourceType_sourceId_idx" ON "e_irsaliyeler"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "e_irsaliyeler_printedDocumentId_idx" ON "e_irsaliyeler"("printedDocumentId");
CREATE INDEX IF NOT EXISTS "e_irsaliyeler_replacesId_idx" ON "e_irsaliyeler"("replacesId");
CREATE UNIQUE INDEX IF NOT EXISTS "e_irsaliye_xmllari_eIrsaliyeId_version_key" ON "e_irsaliye_xmllari"("eIrsaliyeId", "version");
CREATE INDEX IF NOT EXISTS "e_irsaliye_olaylari_eIrsaliyeId_createdAt_id_idx" ON "e_irsaliye_olaylari"("eIrsaliyeId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "e_irsaliye_olaylari_xmlId_idx" ON "e_irsaliye_olaylari"("xmlId");

-- FK'lar. `currentXmlId`/`sentXmlId`/`xmlId`/`replacesId` NO ACTION: kontrol ifade sonunda —
-- kaydın kaskadıyla XML/olay birlikte giderken sıra sorunu yok; mühürlü satıra SET NULL (UPDATE) yazılmaz.
DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_printedDocumentId_fkey" FOREIGN KEY ("printedDocumentId") REFERENCES "printed_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_currentXmlId_fkey" FOREIGN KEY ("currentXmlId") REFERENCES "e_irsaliye_xmllari"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_sentXmlId_fkey" FOREIGN KEY ("sentXmlId") REFERENCES "e_irsaliye_xmllari"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "e_irsaliyeler"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliye_xmllari" ADD CONSTRAINT "e_irsaliye_xmllari_eIrsaliyeId_fkey" FOREIGN KEY ("eIrsaliyeId") REFERENCES "e_irsaliyeler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliye_olaylari" ADD CONSTRAINT "e_irsaliye_olaylari_eIrsaliyeId_fkey" FOREIGN KEY ("eIrsaliyeId") REFERENCES "e_irsaliyeler"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliye_olaylari" ADD CONSTRAINT "e_irsaliye_olaylari_xmlId_fkey" FOREIGN KEY ("xmlId") REFERENCES "e_irsaliye_xmllari"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Kaynak başına TEK canlı kayıt (plan §3.1). IPTAL/REDDEDILDI yer işgal etmez: yerine
--    yeni kayıt doğabilir (REDDEDILDI → `replacesId`). Prisma partial index bilmez.
CREATE UNIQUE INDEX IF NOT EXISTS "e_irsaliyeler_kaynak_canli_key"
  ON "e_irsaliyeler"("sourceType", "sourceId")
  WHERE "status" NOT IN ('IPTAL', 'REDDEDILDI');

-- ── CHECK seddi (çift yüklem; servis kapısının DB ikizi).
DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_numarali_durum_chk"
    CHECK ("status" NOT IN ('OLUSTURULDU', 'GONDERILDI', 'KABUL', 'KISMI_KABUL', 'REDDEDILDI', 'HATA')
           OR ("documentNo" IS NOT NULL AND "ettn" IS NOT NULL AND "currentXmlId" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_gonderilmis_durum_chk"
    CHECK ("status" NOT IN ('GONDERILDI', 'KABUL', 'KISMI_KABUL', 'REDDEDILDI')
           OR ("sentXmlId" IS NOT NULL AND "sentAt" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- GİB biçimi: 3 karakter seri + 20YY + 9 hane sıra (plan §0.3 K1, §3.6).
DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_document_no_bicim_chk"
    CHECK ("documentNo" IS NULL OR "documentNo" ~ '^[A-Z0-9]{3}20[0-9]{2}[0-9]{9}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "e_irsaliyeler" ADD CONSTRAINT "e_irsaliyeler_download_count_chk"
    CHECK ("downloadCount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Doğuş olayı ⇔ öncesi yok (`work_order_events_birth_has_no_from` emsali).
DO $$ BEGIN
  ALTER TABLE "e_irsaliye_olaylari" ADD CONSTRAINT "e_irsaliye_olaylari_dogus_chk"
    CHECK (("type" = 'HAZIRLANDI') = ("fromStatus" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── XML MÜHRÜ: UPDATE her zaman RED; DELETE yalnız doğrudan geldiğinde RED (kaydın FK kaskadı,
--    derinlik ≥ 2, geçer — yalnız bekçi temizliği); INSERT, kayıt gönderilmiş/terminal iken RED.
--    `FOR SHARE`: durum geçişiyle yarışan sürüm ekleme, geçiş commit olana dek bekler.
CREATE OR REPLACE FUNCTION "e_irsaliye_xml_degismez"() RETURNS trigger AS $$
DECLARE
  durum "EIrsaliyeStatus";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'e-İrsaliye XML sürümü değiştirilemez.'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Donmuş belge: düzeltme yeni sürümle (version+1) yazılır.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'e-İrsaliye XML sürümü silinemez.'
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'Donmuş belge: satır yalnız kaydıyla birlikte (FK kaskadı) gider.';
    END IF;
    RETURN OLD;
  END IF;
  SELECT "status" INTO durum FROM "e_irsaliyeler" WHERE "id" = NEW."eIrsaliyeId" FOR SHARE;
  IF durum IN ('GONDERILDI', 'KABUL', 'KISMI_KABUL', 'REDDEDILDI', 'IPTAL') THEN
    RAISE EXCEPTION 'Gönderilmiş ya da iptal edilmiş e-İrsaliyeye yeni XML sürümü yazılamaz (durum: %).', durum
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Gönderilen sürüm mühürlüdür; yeni belge için yeni kayıt açılır.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "e_irsaliye_xml_degismez" ON "e_irsaliye_xmllari";
CREATE TRIGGER "e_irsaliye_xml_degismez"
  BEFORE INSERT OR UPDATE OR DELETE ON "e_irsaliye_xmllari"
  FOR EACH ROW EXECUTE FUNCTION "e_irsaliye_xml_degismez"();

-- ── OLAY DEFTERİ MÜHRÜ: ortak fonksiyon (UPDATE her zaman, doğrudan DELETE RED).
DROP TRIGGER IF EXISTS "e_irsaliye_olaylari_block_tamper" ON "e_irsaliye_olaylari";
CREATE TRIGGER "e_irsaliye_olaylari_block_tamper"
  BEFORE UPDATE OR DELETE ON "e_irsaliye_olaylari"
  FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"();
