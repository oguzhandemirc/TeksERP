-- Gelen belge (D2) — DeliveryNoteAlias.rawFold → rawKey.
-- NEDEN: `Fold` son eki GENERATED kolon sözleşmesine ayrılmıştır (`base.service` yazma
-- süzgeci bu son eke bakar; sıradan kolon `Fold` ile bitince sessizce düşer —
-- `test_db_invariants` geri yön kontrolü). Idempotent: iki kez koşsa da no-op.
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_note_aliases' AND column_name = 'rawFold') THEN
    ALTER TABLE "delivery_note_aliases" RENAME COLUMN "rawFold" TO "rawKey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'delivery_note_aliases_scope_senderCustomerId_rawFold_key') THEN
    ALTER INDEX "delivery_note_aliases_scope_senderCustomerId_rawFold_key" RENAME TO "delivery_note_aliases_scope_senderCustomerId_rawKey_key";
  END IF;
END $t$;
