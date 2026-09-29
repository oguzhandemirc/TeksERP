-- Destek talebinin künye kolonu NULL alabilir (künye kuralı: createdById/updatedById NULLABLE —
-- test_record_provenance §3). Yalnız GEVŞETİR; veri ve FK (ON DELETE RESTRICT) değişmez.
ALTER TABLE "support_tickets" ALTER COLUMN "createdById" DROP NOT NULL;
